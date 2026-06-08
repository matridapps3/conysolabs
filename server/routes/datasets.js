// Dataset routes — upload, paste, sample, list, fetch metadata.
//
// Ingestion paths supported:
//   1. POST /upload          (multipart file: CSV, TSV, XLSX, XLS, PDF, JSON)
//   2. POST /paste           (raw tabular text — paste from Excel/Sheets)
//   3. POST /sample/:id      (load a baked-in LSS sample dataset)
//
// All three converge on:
//   - sidecar parses → returns rows + schema
//   - sidecar materializeRows → writes parquet at rows_storage_key
//   - SQLite row stores name, schema, row_count, storage_key

import express from 'express';
import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { sidecar } from '../lib/sidecar.js';
import { rowToJsonObj, audit } from '../lib/db.js';
import { SAMPLE_DATASETS } from '../lib/samples.js';

const router = Router();
// Reject unwanted extensions *before* multer reads bytes — saves both
// memory and a confused error later in the upload handler.
const ALLOWED_UPLOAD_EXTS = new Set([
  'csv', 'tsv', 'txt', 'xlsx', 'xls', 'pdf', 'json',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname || '').split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
      const err = new Error(`unsupported_file_type: .${ext}`);
      err.status = 400;
      err.code = 'UNSUPPORTED_TYPE';
      return cb(err);
    }
    cb(null, true);
  },
});
// Multer-specific error → JSON. Without this wrapper, oversize/filter errors
// fall to Express's default HTML 500.
function uploadSingle(field) {
  return (req, res, next) => upload.single(field)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        detail: `Max 25 MB per upload (got ${err.field || 'file'}).`,
      });
    }
    if (err.code === 'UNSUPPORTED_TYPE') {
      return res.status(400).json({
        error: 'unsupported_file_type',
        detail: err.message,
        allowed: Array.from(ALLOWED_UPLOAD_EXTS),
      });
    }
    return res.status(400).json({ error: 'upload_failed',
      detail: err.message || String(err) });
  });
}

// Helper: persist a parsed-and-materialized dataset and return the API shape.
function persistDataset(db, workspaceId, name, mat) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO datasets (id, workspace_id, name, rows_storage_key, schema_json, row_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, name, mat.rows_storage_key, JSON.stringify(mat.schema || []), mat.n_rows);
  try { audit(db, { workspace_id: workspaceId, entity_type: 'dataset', entity_id: id, action: 'created', detail: `${name} (${mat.n_rows} rows)` }); } catch {}
  return {
    id, workspace_id: workspaceId, name,
    rows_storage_key: mat.rows_storage_key,
    schema_json: mat.schema,
    row_count: mat.n_rows,
  };
}

// Helper: take {rows, ...} from any parser, materialize, persist, return.
async function ingestRows(db, workspaceId, name, rows) {
  if (!rows || !rows.length) {
    const err = new Error('no_rows_extracted');
    err.status = 400;
    throw err;
  }
  const mat = await sidecar.materializeRows(rows);
  return persistDataset(db, workspaceId, name, mat);
}

function workspaceId(req) {
  return req.header('X-Workspace-Id') || req.query.workspace_id;
}

router.get('/', (req, res) => {
  const w = workspaceId(req);
  if (!w) return res.status(400).json({ error: 'workspace_required' });
  const rows = req.app.locals.db.prepare(
    `SELECT * FROM datasets WHERE workspace_id = ? ORDER BY created_at DESC`,
  ).all(w);
  res.json({ datasets: rows.map(r => rowToJsonObj(r, ['schema_json'])) });
});

// Sample catalogue must come BEFORE the catch-all GET /:id, otherwise
// `/samples` matches as id='samples' and 404s.
router.get('/samples', (_req, res) => {
  res.json({
    samples: SAMPLE_DATASETS.map(s => ({
      id: s.id, name: s.name, blurb: s.blurb, suggested_analysis: s.suggested_analysis,
      n_rows: s.rows.length, columns: Object.keys(s.rows[0] || {}),
    })),
  });
});

router.get('/:id', (req, res) => {
  const row = req.app.locals.db.prepare(
    `SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`,
  ).get(req.params.id, workspaceId(req));
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ dataset: rowToJsonObj(row, ['schema_json']) });
});

// Quality preview: per-column data-quality flags + small sample. Shown
// right after upload so the user can see whether a column got mis-parsed
// (mixed numeric/text, dates-as-strings, ID-like, high nulls).
router.get('/:id/preview', async (req, res, next) => {
  try {
    const row = req.app.locals.db.prepare(`SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`).get(req.params.id, workspaceId(req));
    if (!row) return res.status(404).json({ error: 'not_found' });
    const r = await sidecar.datasetPreview(row.rows_storage_key, Number(req.query.n) || 20);
    res.json(r);
  } catch (e) { next(e); }
});

// Full rows (capped) for client-side visualization.
router.get('/:id/rows', async (req, res, next) => {
  try {
    const row = req.app.locals.db.prepare(`SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`).get(req.params.id, workspaceId(req));
    if (!row) return res.status(404).json({ error: 'not_found' });
    const limit = Math.min(Number(req.query.limit) || 5000, 20000);
    const columns = req.query.columns ? String(req.query.columns).split(',').filter(Boolean) : null;
    const r = await sidecar.datasetRows(row.rows_storage_key, { limit, columns });
    res.json(r);
  } catch (e) { next(e); }
});

// Export a (possibly transformed) dataset back out as CSV. A "workbench" you
// can't get your cleaned data out of is half a tool — this closes that gap.
router.get('/:id/export.csv', async (req, res, next) => {
  try {
    const row = req.app.locals.db.prepare(`SELECT * FROM datasets WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const { rows } = await sidecar.datasetRows(row.rows_storage_key, { limit: 1_000_000 });
    if (!rows || !rows.length) return res.status(404).json({ error: 'no_rows' });
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(',')];
    for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(','));
    const safeName = String(row.name || 'dataset').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) { next(e); }
});

router.post('/upload', uploadSingle('file'), async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    if (!req.file) return res.status(400).json({ error: 'file_required' });

    const ext = (req.file.originalname || '').split('.').pop()?.toLowerCase() || '';

    // JSON: parse client-side, ship rows direct (skip upload-to-sidecar step).
    if (ext === 'json') {
      let payload;
      try { payload = JSON.parse(req.file.buffer.toString('utf8')); }
      catch (e) { return res.status(400).json({ error: 'json_parse_failed', detail: String(e) }); }
      const parsed = await sidecar.parseJsonData(payload, req.file.originalname);
      const name = (req.body?.name || req.file.originalname || 'dataset').slice(0, 120);
      const dataset = await ingestRows(req.app.locals.db, w, name, parsed.rows);
      return res.json({ dataset });
    }

    // 1. Upload bytes to sidecar storage.
    const sidecarBase = process.env.SIDECAR_URL || 'http://localhost:8000';
    const fd = new FormData();
    fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }),
              req.file.originalname);
    // Same timeout discipline as the sidecar JSON client. 60s ceiling so a
    // hung sidecar surfaces as a 504 instead of hanging the upload forever.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    let uploadResp;
    try {
      uploadResp = await fetch(`${sidecarBase}/upload`,
        { method: 'POST', body: fd, signal: ac.signal });
    } catch (e) {
      clearTimeout(timer);
      const code = e.name === 'AbortError' ? 504 : 502;
      return res.status(code).json({ error: 'sidecar_upload_failed',
        detail: e.message || String(e) });
    }
    clearTimeout(timer);
    if (!uploadResp.ok) {
      let body = '';
      try { body = await uploadResp.text(); } catch {}
      return res.status(502).json({ error: 'sidecar_upload_failed',
        sidecar_status: uploadResp.status, detail: body.slice(0, 200) });
    }
    const { storage_key } = await uploadResp.json();

    // 2. Parse based on file type.
    let parsed;
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt')
      parsed = await sidecar.parseCsv(storage_key);    // smart parser auto-detects delimiter
    else if (ext === 'xlsx' || ext === 'xls')         parsed = await sidecar.parseExcel(storage_key);
    else if (ext === 'pdf')                           parsed = await sidecar.parsePdf(storage_key);
    else return res.status(400).json({ error: 'unsupported_file_type', detail: ext });

    // 3. Pull rows out — parsers return { rows: [...] } or { sheets: [{ tables: [{ rows }] }] }
    let rows = parsed.rows;
    if (!rows && parsed.tables?.[0]?.rows) rows = parsed.tables[0].rows;
    if (!rows && parsed.sheets?.[0]?.tables?.[0]?.rows) rows = parsed.sheets[0].tables[0].rows;
    if (!rows || !rows.length) return res.status(400).json({ error: 'no_rows_extracted' });

    // 4. Materialize + persist
    const name = (req.body?.name || req.file.originalname || 'dataset').slice(0, 120);
    const dataset = await ingestRows(req.app.locals.db, w, name, rows);
    // Surface parser meta (delimiter, encoding, skipped lines) so the UI can
    // show a small "detected as TSV / UTF-8 / skipped 2 metadata rows" hint.
    if (parsed.meta) dataset.parse_meta = parsed.meta;
    res.json({ dataset });
  } catch (e) { next(e); }
});

// ───────── Paste from clipboard ─────────
//
// Power-user path: paste tabular text (CSV / TSV from Excel copy) into a
// textarea, get a dataset without ever leaving the keyboard. The smart
// csv_parser handles delimiter / encoding / blank-row detection.

router.post('/paste', express.json({ limit: '5mb' }), async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const text = req.body?.text;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text_required' });
    }
    const parsed = await sidecar.parseText(text, req.body?.name);
    const name = (req.body?.name || 'Pasted data').slice(0, 120);
    const dataset = await ingestRows(req.app.locals.db, w, name, parsed.rows);
    if (parsed.meta) dataset.parse_meta = parsed.meta;
    res.json({ dataset });
  } catch (e) { next(e); }
});

// ─── Live data connector: pull a dataset from a URL (Google Sheets CSV, any
// public CSV/TSV endpoint) and remember the source so it can be refreshed.
// SSRF-guarded: only http/https, no private/loopback hosts. The web-native
// "connect your data once" win a desktop tool structurally can't match.
function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { const e = new Error('invalid_url'); e.status = 400; throw e; }
  if (!/^https?:$/.test(u.protocol)) { const e = new Error('only http/https URLs are allowed'); e.status = 400; throw e; }
  const host = u.hostname.toLowerCase();
  const blocked = host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local') ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' || host.startsWith('fd') || host.startsWith('fe80');
  if (blocked) { const e = new Error('private/loopback hosts are not allowed'); e.status = 400; throw e; }
  return u.toString();
}

async function fetchSourceText(url) {
  const safe = assertSafeUrl(url);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const r = await fetch(safe, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': 'ConysoBench/1.0' } });
    if (!r.ok) { const e = new Error(`source returned ${r.status}`); e.status = 502; throw e; }
    // Cap at ~25 MB to avoid memory blowups.
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 25 * 1024 * 1024) { const e = new Error('source file exceeds 25 MB'); e.status = 413; throw e; }
    return Buffer.from(buf).toString('utf-8');
  } finally { clearTimeout(timer); }
}

router.post('/from-url', express.json(), async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const url = req.body?.url;
    if (!url) return res.status(400).json({ error: 'url_required' });
    const text = await fetchSourceText(url);
    const parsed = await sidecar.parseText(text, req.body?.name);
    const name = (req.body?.name || 'Linked data').slice(0, 120);
    const dataset = await ingestRows(req.app.locals.db, w, name, parsed.rows);
    req.app.locals.db.prepare(`UPDATE datasets SET source_url = ? WHERE id = ?`).run(url, dataset.id);
    try { audit(req.app.locals.db, { workspace_id: w, entity_type: 'dataset', entity_id: dataset.id, action: 'linked', detail: url.slice(0, 200) }); } catch {}
    dataset.source_url = url;
    res.json({ dataset });
  } catch (e) { next(e); }
});

router.post('/:id/refresh-source', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const db = req.app.locals.db;
    const row = db.prepare(`SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (!row.source_url) return res.status(400).json({ error: 'no_source_url', detail: 'This dataset is not linked to a URL.' });
    const text = await fetchSourceText(row.source_url);
    const parsed = await sidecar.parseText(text, row.name);
    if (!parsed.rows || !parsed.rows.length) return res.status(400).json({ error: 'no_rows_extracted' });
    const mat = await sidecar.materializeRows(parsed.rows);
    const newVersion = (row.version || 1) + 1;
    db.prepare(`UPDATE datasets SET rows_storage_key = ?, schema_json = ?, row_count = ?, version = ? WHERE id = ?`)
      .run(mat.rows_storage_key, JSON.stringify(mat.schema || []), mat.n_rows, newVersion, req.params.id);
    try { audit(db, { workspace_id: w, entity_type: 'dataset', entity_id: req.params.id, action: 'refreshed', detail: `v${newVersion} · ${mat.n_rows} rows` }); } catch {}
    res.json({ ok: true, version: newVersion, row_count: mat.n_rows });
  } catch (e) { next(e); }
});

// ───────── Sample datasets ─────────
//
// Pre-loaded LSS examples that the user can drop in with one click — no
// upload, no typing. Each is a small, real-looking dataset designed to
// land cleanly on a specific analysis kind (capability, GR&R, ANOVA,
// reliability, Pareto). Critical for onboarding + the in-app tour.

router.post('/samples/:id', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const sample = SAMPLE_DATASETS.find(s => s.id === req.params.id);
    if (!sample) return res.status(404).json({ error: 'unknown_sample', detail: req.params.id });
    const dataset = await ingestRows(req.app.locals.db, w, sample.name, sample.rows);
    dataset.parse_meta = { source: 'sample', sample_id: sample.id,
                          suggested_analysis: sample.suggested_analysis };
    res.json({ dataset });
  } catch (e) { next(e); }
});

// ───────── Append — add new rows to an existing dataset ─────────
//
// Bumps the dataset's `version` column. Any analysis whose dataset_version is
// now behind is "stale" and can be refreshed with a single click.
router.post('/:id/append', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const ds = req.app.locals.db.prepare(
      `SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`,
    ).get(req.params.id, w);
    if (!ds) return res.status(404).json({ error: 'not_found' });
    const newRows = req.body?.rows;
    if (!Array.isArray(newRows) || !newRows.length) {
      return res.status(400).json({ error: 'rows_array_required' });
    }
    // Guard against memory blow-up — both the rows you bring AND the rows
    // we have to load to concat against. Empirically Node stays healthy
    // under 200k total rows; cap there.
    const MAX_APPEND_ROWS = 50_000;
    const MAX_TOTAL_ROWS = 200_000;
    if (newRows.length > MAX_APPEND_ROWS) {
      return res.status(413).json({ error: 'too_many_rows_to_append',
        detail: `max ${MAX_APPEND_ROWS} rows per append; got ${newRows.length}` });
    }
    if (ds.row_count + newRows.length > MAX_TOTAL_ROWS) {
      return res.status(413).json({ error: 'dataset_would_exceed_cap',
        detail: `combined row count ${ds.row_count + newRows.length} > ${MAX_TOTAL_ROWS}; create a new dataset instead.` });
    }
    // Read existing rows, concat, rematerialise — keeps the storage_key
    // model intact (parquet is rewritten on each append).
    const existing = await sidecar.datasetRows(ds.rows_storage_key, { limit: 1_000_000 });
    const combined = (existing.rows || []).concat(newRows);
    const mat = await sidecar.materializeRows(combined);
    req.app.locals.db.prepare(
      `UPDATE datasets
         SET rows_storage_key = ?, schema_json = ?, row_count = ?, version = version + 1
       WHERE id = ?`,
    ).run(mat.rows_storage_key, JSON.stringify(mat.schema || []), mat.n_rows, ds.id);
    const updated = req.app.locals.db.prepare(
      `SELECT * FROM datasets WHERE id = ?`,
    ).get(ds.id);
    res.json({ dataset: rowToJsonObj(updated, ['schema_json']),
               n_appended: newRows.length,
               new_version: updated.version });
  } catch (e) { next(e); }
});


// ───────── Transform — in-app column wrangling ─────────
//
// POST /:id/transform { op, params } → produces a NEW dataset with the
// transform applied. Original is never mutated. Useful for compute,
// recode, retype, impute, filter, stack/unstack, log/boxcox/standardize,
// and equal-width / quantile binning. Closes the "you can't edit data
// in Minitab without re-importing" gap.

router.post('/:id/transform', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const row = req.app.locals.db.prepare(
      `SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`,
    ).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const op = req.body?.op;
    const params = req.body?.params || {};
    if (!op) return res.status(400).json({ error: 'op_required' });
    const r = await sidecar.wrangleTransform(row.rows_storage_key, op, params);
    if (!r.materialized) return res.status(502).json({ error: 'transform_failed', detail: r });
    // Persist the new dataset, scoped to same workspace, with a derived name.
    const baseName = row.name.replace(/\s*\(transform.*?\)$/, '');
    const tag = op === 'compute'    ? `+${params.new_column || 'col'}`
              : op === 'recode'     ? `recode ${params.column || ''}`
              : op === 'retype'     ? `${params.column || ''} as ${params.type || '?'}`
              : op === 'rename'     ? 'rename'
              : op === 'drop'       ? `drop ${(params.columns || []).join(',')}`
              : op === 'impute'     ? `impute ${params.column || ''}`
              : op === 'filter'     ? `filter`
              : op === 'stack'      ? `stack`
              : op === 'unstack'    ? `unstack`
              : op;
    const newName = `${baseName} (${tag})`.slice(0, 120);
    const dataset = persistDataset(req.app.locals.db, w, newName, r.materialized);
    dataset.parse_meta = { source: 'transform', op, params,
                           parent_dataset_id: row.id, summary: r.summary };
    res.json({ dataset, transform: r.summary });
  } catch (e) { next(e); }
});

// In-place column edit (rename / drop) for direct worksheet editing — mutates
// THIS dataset and bumps its version (no new "(rename)" dataset spawned), so
// it feels like editing a spreadsheet. Version bump flags dependent analyses.
router.post('/:id/edit', express.json(), async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const db = req.app.locals.db;
    const row = db.prepare(`SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const op = req.body?.op, params = req.body?.params || {};
    if (!['rename', 'drop', 'set_cell', 'compute'].includes(op))
      return res.status(400).json({ error: 'unsupported_edit', detail: 'op must be rename, drop, set_cell, or compute' });
    const r = await sidecar.wrangleTransform(row.rows_storage_key, op, params);
    if (!r.materialized) return res.status(502).json({ error: 'edit_failed', detail: r });
    const newVersion = (row.version || 1) + 1;
    db.prepare(`UPDATE datasets SET rows_storage_key = ?, schema_json = ?, row_count = ?, version = ? WHERE id = ?`)
      .run(r.materialized.rows_storage_key, JSON.stringify(r.materialized.schema || []), r.materialized.n_rows, newVersion, req.params.id);
    const detail = op === 'rename' ? `rename ${params.from}→${params.to}`
                 : op === 'drop'   ? `drop ${params.columns || params.column}`
                 : op === 'set_cell' ? `set ${params.column}[${params.row}]=${params.value}`
                 : op === 'compute' ? `+column ${params.new_column}`
                 : op;
    try { audit(db, { workspace_id: w, entity_type: 'dataset', entity_id: req.params.id, action: 'edited', detail }); } catch {}
    res.json({ ok: true, version: newVersion, schema: r.materialized.schema });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    // Scope by workspace so cross-tenant deletes can't happen even with a
    // guessed id. SQLite returns 0 changes if id+workspace combo doesn't exist.
    const r = req.app.locals.db.prepare(
      `DELETE FROM datasets WHERE id = ? AND workspace_id = ?`,
    ).run(req.params.id, w);
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
