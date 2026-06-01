#!/usr/bin/env node
// Conyso Bench Monitor — a tiny, self-contained continuous-SPC watchdog.
//
// Polls a CSV data source on an interval, computes I-MR control limits, and
// fires a webhook (Slack/Teams/any JSON endpoint) when a NEW out-of-control
// signal appears. No database, no AI, no dependency on a running Bench — one
// Node process you can hand to anyone and deploy as its own service.
//
// Configure with env vars (or a JSON file path as argv[2]):
//   MONITOR_SOURCE_URL   public CSV URL (e.g. a published Google Sheet)
//   MONITOR_COLUMN       numeric column to chart
//   MONITOR_INTERVAL_SEC poll interval in seconds            (default 300)
//   MONITOR_ALERT_WEBHOOK   POST target for alerts           (optional)
//   MONITOR_LABEL        a name for this monitor             (default the column)
import fs from 'node:fs';
import { detectSignals, parseCsv, assertSafeUrl } from './spc.js';

function loadConfig() {
  const fileArg = process.argv[2];
  let cfg = {};
  if (fileArg && fs.existsSync(fileArg)) cfg = JSON.parse(fs.readFileSync(fileArg, 'utf-8'));
  return {
    sourceUrl: cfg.sourceUrl || process.env.MONITOR_SOURCE_URL,
    column: cfg.column || process.env.MONITOR_COLUMN,
    intervalSec: Number(cfg.intervalSec || process.env.MONITOR_INTERVAL_SEC || 300),
    webhook: cfg.webhook || process.env.MONITOR_ALERT_WEBHOOK || null,
    label: cfg.label || process.env.MONITOR_LABEL || null,
  };
}

async function fetchValues(url, column) {
  const safe = assertSafeUrl(url);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);
  try {
    const r = await fetch(safe, { signal: ac.signal, headers: { 'user-agent': 'ConysoBenchMonitor/1.0' } });
    if (!r.ok) throw new Error(`source returned ${r.status}`);
    const rows = parseCsv(await r.text());
    if (!rows.length) throw new Error('source produced no rows');
    if (!(column in rows[0])) throw new Error(`column "${column}" not found (have: ${Object.keys(rows[0]).join(', ')})`);
    return rows.map((row) => Number(row[column])).filter((v) => Number.isFinite(v));
  } finally { clearTimeout(t); }
}

async function alert(cfg, payload) {
  const line = `⚠️  [${cfg.label}] ${payload.signals.length} out-of-control signal(s): ` +
    payload.signals.map((s) => s.rule).join(', ');
  console.error(line);
  if (!cfg.webhook) return;
  try {
    await fetch(cfg.webhook, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // `text` keys make it render in Slack/Teams; full data travels alongside.
      body: JSON.stringify({ text: line, monitor: cfg.label, ...payload }),
    });
  } catch (e) { console.error('alert webhook failed:', e.message); }
}

// State across polls: how many signals we'd already reported, so we only alert
// on NEW ones (avoids re-paging on every poll for the same point).
let lastSignalCount = 0;
let lastDataLen = 0;

async function poll(cfg) {
  try {
    const values = await fetchValues(cfg.sourceUrl, cfg.column);
    const { limits, signals } = detectSignals(values);
    const stamp = new Date().toISOString();
    // Reset the baseline if the source shrank/reset.
    if (values.length < lastDataLen) lastSignalCount = 0;
    lastDataLen = values.length;
    console.log(`[${stamp}] ${cfg.label}: n=${values.length} mean=${limits.mean.toFixed(3)} ` +
      `UCL=${limits.ucl.toFixed(3)} LCL=${limits.lcl.toFixed(3)} signals=${signals.length}`);
    if (signals.length > lastSignalCount) {
      await alert(cfg, { timestamp: stamp, limits, signals, n: values.length });
    }
    lastSignalCount = signals.length;
  } catch (e) {
    console.error(`[${new Date().toISOString()}] poll error: ${e.message}`);
  }
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.sourceUrl || !cfg.column) {
    console.error('Conyso Bench Monitor — missing config.\n' +
      'Set MONITOR_SOURCE_URL and MONITOR_COLUMN (env or a JSON config file as arg 1).');
    process.exit(1);
  }
  cfg.label = cfg.label || cfg.column;
  console.log(`Conyso Bench Monitor started · watching "${cfg.column}" from ${cfg.sourceUrl} ` +
    `every ${cfg.intervalSec}s${cfg.webhook ? ' · alerts → webhook' : ' · alerts → stderr only'}`);
  await poll(cfg);
  setInterval(() => poll(cfg), cfg.intervalSec * 1000);
}

// Only auto-run when invoked directly (so spc.js stays importable for tests).
if (import.meta.url === `file://${process.argv[1]}`) main();
