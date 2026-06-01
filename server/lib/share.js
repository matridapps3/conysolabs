// Server-rendered, self-contained, embeddable view of one shared analysis.
// No SPA, no auth, no JS framework — just a branded HTML page that renders
// anywhere (including cross-origin iframes). This is Bench's "link, don't
// attach" wedge: a live result you paste into a wiki, not a .mpx file.

const KIND_LABELS = {
  capability: 'Process Capability', hypothesis_test: 'Hypothesis Test',
  control_chart: 'Control Chart', regression: 'Regression', msa: 'Gauge R&R',
  doe: 'Designed Experiment', pareto: 'Pareto', survey: 'Survey / Likert',
  text_pareto: 'Comment Pareto', variance_budget: 'Variance Budget',
  monte_carlo: 'Monte-Carlo Simulation', reliability: 'Reliability',
  multivariate: 'Multivariate', time_series: 'Time Series', sixpack: 'Capability Six-Pack',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const FMT = (v) => {
  if (typeof v !== 'number') return esc(v);
  if (!isFinite(v)) return '—';
  return (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.001)) ? v.toPrecision(4) : (Math.round(v * 1000) / 1000);
};

// Pull a few headline metrics generically from a result summary.
function pickMetrics(kind, s) {
  const out = [];
  const add = (label, key) => { if (s[key] != null && typeof s[key] !== 'object') out.push([label, FMT(s[key])]); };
  if (s.n != null) add('n', 'n'); if (s.n_respondents != null) add('n', 'n_respondents');
  add('Cp', 'cp'); add('Cpk', 'cpk'); add('Pp', 'pp'); add('Ppk', 'ppk');
  add('p-value', 'p'); add('R²', 'r2'); add('F', 'F');
  add("Cronbach α", 'cronbach_alpha'); add('%GR&R', 'total_grr_pct');
  add('mean', 'mean'); add('σ', 'sd'); add('σ', 'stdev');
  if (s.largest_pct != null) out.push(['Top source', `${esc(s.largest_source)} (${FMT(s.largest_pct)}%)`]);
  return out.slice(0, 6);
}

export function renderSharePage(analysis, { embed = false } = {}) {
  const { kind, params, result, chart_storage_key, created_at } = analysis;
  const s = (result && result.summary) || {};
  const label = KIND_LABELS[kind] || kind.replace(/_/g, ' ');
  const headline = (result && result.headline && (result.headline.verdict || result.headline.message))
    || s.headline || s.note || '';
  const metrics = pickMetrics(kind, s);
  const prov = result && result.provenance;
  const date = created_at ? new Date(created_at * 1000).toLocaleDateString() : '';

  const metricCards = metrics.map(([k, v]) =>
    `<div class="m"><div class="ml">${esc(k)}</div><div class="mv">${esc(v)}</div></div>`).join('');
  const paramLine = params && Object.keys(params).length
    ? Object.entries(params).map(([k, v]) => `${esc(k)}=${esc(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' · ') : '';

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(label)} — Conyso Bench</title>
<style>
  :root{--ink:#1a1a1a;--muted:#6b6b6b;--line:#e3e3e3;--accent:#b5942f;--bg:#fff}
  *{box-sizing:border-box} body{margin:0;font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
  .wrap{max-width:820px;margin:0 auto;padding:${embed ? '18px' : '36px 28px'}}
  .eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700}
  h1{font-size:22px;margin:2px 0 2px} .date{color:var(--muted);font-size:12px;margin-bottom:16px}
  .headline{font-size:15px;line-height:1.5;background:#faf7ef;border-left:3px solid var(--accent);padding:11px 14px;border-radius:5px;margin:14px 0}
  .metrics{display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:14px 0}
  .m{flex:1;min-width:90px;padding:11px 14px;border-right:1px solid var(--line)}
  .m:last-child{border-right:0} .ml{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)} .mv{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
  img{max-width:100%;border:1px solid var(--line);border-radius:8px;margin:12px 0}
  .params{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--muted);background:#f7f7f5;border:1px solid var(--line);padding:7px 11px;border-radius:5px;word-break:break-word}
  .prov{margin-top:16px;font-size:11px;color:var(--muted)} .prov code{font-family:ui-monospace,monospace}
  footer{margin-top:26px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
  a{color:var(--accent);text-decoration:none}
</style></head><body><div class="wrap">
  <div class="eyebrow">Conyso Bench${prov ? ' · reproducible result' : ''}</div>
  <h1>${esc(label)}</h1>
  <div class="date">${esc(date)}</div>
  ${headline ? `<div class="headline">${esc(headline)}</div>` : ''}
  ${metricCards ? `<div class="metrics">${metricCards}</div>` : ''}
  ${chart_storage_key ? `<img src="/artifact/${esc(chart_storage_key)}" alt="${esc(label)} chart">` : ''}
  ${paramLine ? `<div class="params">${paramLine}</div>` : ''}
  ${prov ? `<div class="prov">Reproducibility · data <code>${esc((prov.data_hash || '').slice(0, 12))}</code> · params <code>${esc((prov.params_hash || '').slice(0, 12))}</code> · result <code>${esc((prov.result_hash || '').slice(0, 12))}</code><br>Re-running on the same data yields identical hashes.</div>` : ''}
  <footer>
    <span>Made with <a href="https://bench.conyso.com" target="_blank" rel="noopener">Conyso Bench</a> — the free Lean Six Sigma workbench</span>
    <span>Read-only shared view</span>
  </footer>
</div></body></html>`;
}
