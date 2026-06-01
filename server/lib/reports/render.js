// Conyso Bench — report renderer.
//
// Takes a saved report row + a template + linked analyses + project context
// and produces:
//   - printable HTML (browser print → PDF)
//   - Markdown text (for README / wiki paste)
//   - Word-flavored HTML wrapped in MS Office MIME (.doc) — opens cleanly
//     in Word, Pages, Google Docs
//
// All three formats share the same section-by-section walk; only the
// emitter differs.

import { TEMPLATES_BY_ID } from './templates.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function nl2br(s) { return escapeHtml(s).replace(/\n/g, '<br />'); }
function fmtDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toISOString().slice(0, 10);
}
function fmtCurrency(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// ───────── Conyso branding shell ─────────

const CONYSO_MARK_SVG = `
<svg viewBox="0 0 28 28" width="22" height="22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <line x1="4"  y1="22" x2="4"  y2="17" stroke="#6b5524" stroke-width="2.5"/>
  <line x1="10" y1="22" x2="10" y2="11" stroke="#6b5524" stroke-width="2.5"/>
  <line x1="16" y1="22" x2="16" y2="7"  stroke="#6b5524" stroke-width="2.5"/>
  <line x1="22" y1="22" x2="22" y2="13" stroke="#6b5524" stroke-width="2.5"/>
  <line x1="2"  y1="24" x2="26" y2="24" stroke="#14110b" stroke-width="1.2"/>
</svg>`;

const REPORT_CSS = `
  @page { size: A4; margin: 16mm 18mm 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font: 11pt/1.55 'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #14110b; background: #ffffff;
    -webkit-font-smoothing: antialiased;
    max-width: 880px; margin: 0 auto; padding: 28px 28px 56px;
  }
  .doc-header {
    border-bottom: 1px solid #14110b;
    padding-bottom: 14px;
    margin-bottom: 26px;
    display: flex; align-items: center; gap: 12px;
  }
  .doc-header .mark { flex-shrink: 0; }
  .doc-header .brand-text { flex: 1; }
  .doc-header .brand {
    font: 600 13pt 'Inter', sans-serif;
    letter-spacing: 0.18em; color: #14110b; line-height: 1;
  }
  .doc-header .brand-sub {
    font: 400 9pt 'Inter', sans-serif;
    color: #6f6960; margin-top: 3px; letter-spacing: 0.04em;
  }
  .doc-header .ref {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 9.5pt; color: #6f6960; text-align: right; line-height: 1.45;
  }
  h1 {
    font: 400 24pt 'Playfair Display', Georgia, serif;
    margin: 6px 0 4px; letter-spacing: -0.005em;
  }
  .subtitle {
    font: 400 12pt 'Inter', sans-serif;
    color: #3a3530; margin: 0 0 26px;
  }
  h2 {
    font: 500 9pt 'Inter', sans-serif;
    text-transform: uppercase; letter-spacing: 0.22em;
    color: #6b5524;
    margin: 28px 0 10px; padding-bottom: 4px;
    border-bottom: 1px solid rgba(107,85,36,0.25);
  }
  .hint {
    font-size: 9.5pt; color: #8a847a; font-style: italic;
    margin: -4px 0 8px;
  }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  table.kv th, table.kv td {
    text-align: left; padding: 7px 8px;
    border-bottom: 1px solid rgba(20,17,11,0.10);
    vertical-align: top; font-size: 10.5pt;
  }
  table.kv th { width: 32%; font-weight: 500; color: #3a3530; }
  table.kv td { color: #14110b; white-space: pre-wrap; word-break: break-word; }
  table.grid th, table.grid td {
    text-align: left; padding: 6px 8px;
    border: 1px solid rgba(20,17,11,0.18);
    font-size: 10pt; vertical-align: top;
  }
  table.grid th {
    background: #faf6ee;
    font-weight: 500; color: #3a3530;
    border-bottom: 1px solid #6b5524;
  }
  .block { font-size: 11pt; line-height: 1.65; color: #14110b; white-space: pre-wrap; }
  .empty { color: #b3aea4; font-style: italic; }
  .metric-strip {
    display: flex; gap: 24px; padding: 12px 0;
    border-top: 1px solid rgba(20,17,11,0.12);
    border-bottom: 1px solid rgba(20,17,11,0.12);
    margin-bottom: 8px;
  }
  .metric-strip .m { flex: 1; }
  .metric-strip .m .lbl {
    font: 500 9pt 'Inter', sans-serif; text-transform: uppercase;
    letter-spacing: 0.12em; color: #6f6960;
  }
  .metric-strip .m .val {
    font: 500 18pt 'Playfair Display', Georgia, serif;
    color: #14110b; margin-top: 4px;
  }
  .metric-strip .m.warn .val { color: #b08400; }
  .metric-strip .m.danger .val { color: #b03a3a; }
  .metric-strip .m.success .val { color: #2f7d3a; }
  .chart-embed {
    margin: 10px 0;
    border: 1px solid rgba(20,17,11,0.10);
    padding: 6px; background: #fdfbf7;
  }
  .chart-embed img { width: 100%; display: block; }
  .chart-embed .cap {
    font-size: 9.5pt; color: #6f6960; text-align: center;
    margin-top: 4px; font-style: italic;
  }
  .analysis-block {
    border-left: 2px solid #6b5524;
    padding: 6px 14px; margin: 16px 0 22px;
    background: #faf6ee;
  }
  .analysis-block h3 {
    font: 500 12pt 'Playfair Display', Georgia, serif;
    margin: 0 0 6px;
  }
  .analysis-block .interp {
    font-size: 10.5pt; line-height: 1.65; margin: 6px 0;
  }
  .signoff-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 8px;
  }
  .signoff-grid .cell {
    border-top: 1px solid #14110b;
    padding-top: 6px;
  }
  .signoff-grid .cell .role {
    font: 500 9pt 'Inter', sans-serif; text-transform: uppercase;
    letter-spacing: 0.12em; color: #6f6960;
  }
  .signoff-grid .cell .name {
    margin: 16px 0 2px; height: 22px;
    border-bottom: 1px dashed rgba(20,17,11,0.35);
  }
  .signoff-grid .cell .meta {
    font-size: 9pt; color: #6f6960; display: flex; gap: 18px; margin-top: 4px;
  }
  footer {
    border-top: 1px solid rgba(20,17,11,0.14);
    padding-top: 14px; margin-top: 36px;
    color: #6f6960; font-size: 9pt; line-height: 1.55;
  }
  footer .accent { color: #6b5524; font-weight: 500; }
  footer code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 8.5pt; }
  .watermark {
    position: fixed; bottom: 6mm; right: 8mm;
    font: 400 8pt 'Inter', sans-serif; color: rgba(107,85,36,0.55);
    letter-spacing: 0.18em; text-transform: uppercase;
  }
  @media print {
    body { padding: 0; }
    .doc-header, h2 { page-break-after: avoid; }
    .analysis-block, .signoff-grid { page-break-inside: avoid; }
  }
`;

// ───────── Section emitters (HTML) ─────────

function renderKvHtml(section, value) {
  const v = value || {};
  const rows = section.fields.map(f => {
    let display;
    const raw = v[f.name];
    if (raw == null || raw === '') {
      display = '<span class="empty">—</span>';
    } else if (f.kind === 'currency') {
      display = escapeHtml(fmtCurrency(raw));
    } else if (f.kind === 'date') {
      display = escapeHtml(raw);
    } else if (f.kind === 'longtext') {
      display = nl2br(raw);
    } else {
      display = escapeHtml(raw);
    }
    return `<tr><th>${escapeHtml(f.label)}</th><td>${display}</td></tr>`;
  }).join('');
  return `<table class="kv">${rows}</table>`;
}

function renderLongtextHtml(section, value) {
  if (!value || !String(value).trim()) return `<div class="block empty">(empty)</div>`;
  // Basic markdown: **bold**, line breaks. Keep it conservative.
  const html = nl2br(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return `<div class="block">${html}</div>`;
}

function renderTableHtml(section, value) {
  const cols = section.columns;
  const rows = Array.isArray(value) && value.length ? value
              : (section.defaultRows || Array.from({ length: section.rows || 3 }, () => cols.map(() => '')));
  // For FMEA, recompute RPN = S × O × D before render.
  if (section.rpnCols) {
    rows.forEach(row => {
      const s = Number(row[section.rpnCols.s]);
      const o = Number(row[section.rpnCols.o]);
      const d = Number(row[section.rpnCols.d]);
      if (Number.isFinite(s) && Number.isFinite(o) && Number.isFinite(d)) {
        row[section.rpnCols.rpn] = String(s * o * d);
      }
    });
  }
  const head = cols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows.map(r => {
    const cells = cols.map((_, i) => {
      const cell = r[i] ?? '';
      let css = '';
      // RPN highlight
      if (section.rpnCols && i === section.rpnCols.rpn) {
        const n = Number(cell);
        if (Number.isFinite(n)) {
          if (n >= 200) css = 'background:#fbe4e4;color:#8a1c1c;font-weight:600;';
          else if (n >= 100) css = 'background:#fcf2dc;color:#8a6a1c;font-weight:600;';
        }
      }
      return `<td${css ? ` style="${css}"` : ''}>${escapeHtml(cell)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderSignoffHtml(section, value) {
  const v = value || {};
  const cells = section.roles.map(role => {
    const r = v[role] || {};
    return `<div class="cell">
      <div class="role">${escapeHtml(role)}</div>
      <div class="name">${r.name ? escapeHtml(r.name) : ''}</div>
      <div class="meta"><span>Title: ${escapeHtml(r.title || '')}</span><span>Date: ${escapeHtml(r.date || '')}</span></div>
    </div>`;
  }).join('');
  return `<div class="signoff-grid">${cells}</div>`;
}

function pickMetrics(analysis) {
  // Pull the canonical top metrics for the analysis kind. Mirrors
  // METRIC_PICKERS in stats_engine_ux.js but server-side.
  if (!analysis?.result_json?.summary) return [];
  const s = analysis.result_json.summary;
  const kind = analysis.kind;
  const fmt = (v, d = 2) => v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '—'
    : (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d)) : String(v));
  const cpkClass = (v) => v == null ? '' : v < 1 ? 'danger' : v < 1.33 ? 'warn' : 'success';
  if (kind === 'capability' || kind === 'sixpack') {
    return [
      { lbl: 'n',    val: fmt(s.n, 0) },
      { lbl: 'Mean', val: fmt(s.mean) },
      { lbl: 'Cp',   val: fmt(s.cp),  cls: cpkClass(s.cp) },
      { lbl: 'Cpk',  val: fmt(s.cpk), cls: cpkClass(s.cpk) },
      { lbl: 'Pp',   val: fmt(s.pp),  cls: cpkClass(s.pp) },
      { lbl: 'Ppk',  val: fmt(s.ppk), cls: cpkClass(s.ppk) },
    ];
  }
  if (kind === 'msa') {
    const rr = s.total_grr_pct ?? s.gauge_rr_pct ?? s.percent_study_var;
    const rrClass = rr == null ? '' : rr > 30 ? 'danger' : rr > 10 ? 'warn' : 'success';
    const ndcClass = s.ndc == null ? '' : s.ndc < 5 ? 'danger' : 'success';
    return [
      { lbl: '% R&R', val: rr != null ? `${fmt(rr, 1)}%` : '—', cls: rrClass },
      { lbl: 'ndc',   val: fmt(s.ndc, 1), cls: ndcClass },
      { lbl: 'Repeat.', val: s.repeatability_pct != null ? `${fmt(s.repeatability_pct, 1)}%` : '—' },
      { lbl: 'Reprod.', val: s.reproducibility_pct != null ? `${fmt(s.reproducibility_pct, 1)}%` : '—' },
    ];
  }
  if (kind === 'hypothesis_test') {
    return [
      { lbl: 'Test', val: s.test || '—' },
      { lbl: 'Statistic', val: fmt(s.statistic ?? s.t ?? s.F ?? s.U ?? s.W ?? s.chi2) },
      { lbl: 'p-value', val: fmt(s.p ?? s.p_value ?? s.p_approx, 4),
        cls: ((s.p ?? s.p_value ?? s.p_approx) < 0.05) ? 'success' : 'warn' },
      { lbl: 'n', val: fmt(s.n, 0) },
    ];
  }
  if (kind === 'regression') {
    return [
      { lbl: 'R²', val: fmt(s.r2 ?? s.r_squared, 3) },
      { lbl: 'Adj R²', val: fmt(s.adj_r2 ?? s.adj_r_squared, 3) },
      { lbl: 'F-p',  val: fmt(s.f_p ?? s.f_p_value, 4) },
      { lbl: 'n',    val: fmt(s.n, 0) },
    ];
  }
  if (kind === 'control_chart') {
    const v = (s.violations?.length || 0)
      + (s.we_rules ? Object.values(s.we_rules).reduce((a, x) => a + (x?.length || 0), 0) : 0);
    return [
      { lbl: 'Chart', val: s.kind || '—' },
      { lbl: 'Center', val: fmt(s.center ?? s.x_bar ?? s.p_bar) },
      { lbl: 'UCL', val: fmt(s.ucl) },
      { lbl: 'LCL', val: fmt(s.lcl) },
      { lbl: 'Violations', val: String(v), cls: v > 0 ? 'danger' : 'success' },
    ];
  }
  return [];
}

function renderMetricsHtml(section, _value, analyses) {
  const a = analyses[0];
  const metrics = pickMetrics(a);
  if (!metrics.length) return `<div class="block empty">Link a ${a?.kind || ''} analysis to populate metrics.</div>`;
  const cells = metrics.map(m => `<div class="m ${m.cls || ''}"><div class="lbl">${escapeHtml(m.lbl)}</div><div class="val">${escapeHtml(m.val)}</div></div>`).join('');
  return `<div class="metric-strip">${cells}</div>`;
}

function renderChartHtml(section, _value, analyses, opts) {
  const a = analyses[0];
  if (!a?.chart_storage_key) return `<div class="block empty">(no chart available)</div>`;
  const url = `${opts.publicBase || ''}/artifact/${a.chart_storage_key}`;
  return `<div class="chart-embed"><img src="${escapeHtml(url)}" alt="chart" /><div class="cap">${escapeHtml(a.kind)} · ${escapeHtml(a.id)}</div></div>`;
}

function renderSummaryHtml(section, _value, analyses) {
  const a = analyses[0];
  const interp = a?.narrative_md;
  const text = (a?.result_json?.summary && typeof a.result_json.summary === 'object')
    ? Object.entries(a.result_json.summary).filter(([k]) => !['recipe', 'annotations', 'provenance'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).slice(0, 12).join(' · ')
    : '';
  const body = interp ? nl2br(interp) : escapeHtml(text || '');
  return `<div class="block">${body}</div>`;
}

function renderHashesHtml(section, _value, analyses) {
  const a = analyses[0];
  const rep = a?.result_json?.provenance || {};
  return `<table class="kv">
    <tr><th>Software</th><td>${escapeHtml(rep.software_version || '—')}</td></tr>
    <tr><th>Data hash</th><td>${escapeHtml(rep.data_hash || '—')}</td></tr>
    <tr><th>Params hash</th><td>${escapeHtml(rep.params_hash || '—')}</td></tr>
    <tr><th>Result hash</th><td>${escapeHtml(rep.result_hash || '—')}</td></tr>
    <tr><th>Computed at</th><td>${escapeHtml(rep.computed_at || '—')}</td></tr>
  </table>`;
}

function renderAnalysesListHtml(section, _value, analyses, opts) {
  if (!analyses?.length) return `<div class="block empty">No analyses linked. Use the "Add to report" button on any analysis result to link it here.</div>`;
  return analyses.map(a => {
    const metrics = pickMetrics(a);
    const metricsHtml = metrics.length
      ? `<div class="metric-strip">${metrics.map(m => `<div class="m ${m.cls || ''}"><div class="lbl">${escapeHtml(m.lbl)}</div><div class="val">${escapeHtml(m.val)}</div></div>`).join('')}</div>`
      : '';
    const chart = a.chart_storage_key
      ? `<div class="chart-embed"><img src="${escapeHtml((opts.publicBase || '') + '/artifact/' + a.chart_storage_key)}" alt="chart"/></div>`
      : '';
    const interp = a.narrative_md ? nl2br(a.narrative_md) : '';
    return `<div class="analysis-block">
      <h3>${escapeHtml(a.kind)} · <span class="muted" style="font-size:9.5pt;color:#6f6960">${escapeHtml(a.id.slice(0, 8))}</span></h3>
      ${metricsHtml}
      ${interp ? `<div class="interp">${interp}</div>` : ''}
      ${chart}
    </div>`;
  }).join('\n');
}

// ───────── Markdown emitters ─────────

function renderKvMd(section, value) {
  const v = value || {};
  return section.fields.map(f => {
    const raw = v[f.name];
    const val = (raw == null || raw === '') ? '—'
      : f.kind === 'currency' ? fmtCurrency(raw)
      : String(raw);
    return `- **${f.label}:** ${val}`;
  }).join('\n');
}
function renderLongtextMd(_section, value) { return value || '_(empty)_'; }
function renderTableMd(section, value) {
  const cols = section.columns;
  const rows = Array.isArray(value) && value.length ? value
              : (section.defaultRows || Array.from({ length: section.rows || 3 }, () => cols.map(() => '')));
  if (section.rpnCols) {
    rows.forEach(row => {
      const s = Number(row[section.rpnCols.s]), o = Number(row[section.rpnCols.o]), d = Number(row[section.rpnCols.d]);
      if (Number.isFinite(s) && Number.isFinite(o) && Number.isFinite(d)) row[section.rpnCols.rpn] = String(s * o * d);
    });
  }
  const head = `| ${cols.join(' | ')} |`;
  const sep  = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${cols.map((_, i) => (r[i] ?? '').toString().replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}
function renderSignoffMd(section, value) {
  const v = value || {};
  return section.roles.map(role => {
    const r = v[role] || {};
    return `- **${role}:** ${r.name || '_________________'}  (${r.title || ''} · ${r.date || ''})`;
  }).join('\n');
}
function renderMetricsMd(_section, _value, analyses) {
  const metrics = pickMetrics(analyses[0]);
  if (!metrics.length) return '_(no metrics)_';
  return '| ' + metrics.map(m => m.lbl).join(' | ') + ' |\n| ' + metrics.map(() => '---').join(' | ') + ' |\n| ' + metrics.map(m => m.val).join(' | ') + ' |';
}
function renderChartMd(_section, _value, analyses, opts) {
  const a = analyses[0];
  if (!a?.chart_storage_key) return '_(no chart)_';
  return `![chart](${(opts.publicBase || '') + '/artifact/' + a.chart_storage_key})`;
}
function renderSummaryMd(_section, _value, analyses) {
  return analyses[0]?.narrative_md || '_(no interpretation)_';
}
function renderHashesMd(_section, _value, analyses) {
  const rep = analyses[0]?.result_json?.provenance || {};
  return `- **Software:** \`${rep.software_version || '—'}\`
- **Data hash:** \`${rep.data_hash || '—'}\`
- **Params hash:** \`${rep.params_hash || '—'}\`
- **Result hash:** \`${rep.result_hash || '—'}\`
- **Computed at:** ${rep.computed_at || '—'}`;
}
function renderAnalysesListMd(_section, _value, analyses, opts) {
  if (!analyses?.length) return '_(no analyses linked)_';
  return analyses.map(a => {
    const metrics = pickMetrics(a);
    const m = metrics.length ? `${metrics.map(x => `**${x.lbl}** ${x.val}`).join(' · ')}\n\n` : '';
    const chart = a.chart_storage_key ? `![chart](${(opts.publicBase || '') + '/artifact/' + a.chart_storage_key})\n\n` : '';
    return `### ${a.kind} · \`${a.id.slice(0, 8)}\`\n\n${m}${a.narrative_md ? a.narrative_md + '\n\n' : ''}${chart}`;
  }).join('\n');
}

// ───────── Master walk ─────────

const SECTION_HTML = {
  kv: renderKvHtml,
  longtext: renderLongtextHtml,
  table: renderTableHtml,
  signoff: renderSignoffHtml,
  metrics: renderMetricsHtml,
  chart: renderChartHtml,
  summary: renderSummaryHtml,
  hashes: renderHashesHtml,
  analyses_list: renderAnalysesListHtml,
};
const SECTION_MD = {
  kv: renderKvMd,
  longtext: renderLongtextMd,
  table: renderTableMd,
  signoff: renderSignoffMd,
  metrics: renderMetricsMd,
  chart: renderChartMd,
  summary: renderSummaryMd,
  hashes: renderHashesMd,
  analyses_list: renderAnalysesListMd,
};

export function renderReportHtml(report, { project = null, analyses = [], publicBase = '' } = {}) {
  const tpl = TEMPLATES_BY_ID[report.template_id];
  if (!tpl) return `<html><body><h1>Unknown template</h1></body></html>`;
  const data = report.data_json || {};
  const opts = { publicBase, project };
  const linkedAnalyses = (report.analyses_json || []).map(id => analyses.find(a => a.id === id)).filter(Boolean);

  const sectionsHtml = (tpl.sections || []).map(section => {
    // For section kinds that consume an analysis, pass the linked list.
    const analysesForSection = ['chart', 'metrics', 'summary', 'hashes', 'analyses_list'].includes(section.kind)
      ? linkedAnalyses
      : [];
    const renderer = SECTION_HTML[section.kind];
    if (!renderer) return '';
    const body = renderer(section, data[section.id], analysesForSection, opts);
    return `
      <section data-section="${escapeHtml(section.id)}">
        <h2>${escapeHtml(section.label)}</h2>
        ${section.hint ? `<div class="hint">${escapeHtml(section.hint)}</div>` : ''}
        ${body}
      </section>
    `;
  }).join('\n');

  // Extra ad-hoc sections (added by user via "+ Section" in editor).
  const extras = (data.__extras || []).map(ex => `
    <section data-section="extra-${escapeHtml(ex.id || '')}">
      <h2>${escapeHtml(ex.title || 'Section')}</h2>
      ${renderLongtextHtml(null, ex.body || '')}
    </section>
  `).join('\n');

  const created = report.created_at ? fmtDate(report.created_at) : fmtDate(Date.now() / 1000);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.title || tpl.name)} · Conyso Bench</title>
<style>${REPORT_CSS}</style>
</head>
<body>

<header class="doc-header">
  <span class="mark">${CONYSO_MARK_SVG}</span>
  <div class="brand-text">
    <div class="brand">CONYSO &nbsp;BENCH</div>
    <div class="brand-sub">${escapeHtml(tpl.name)} · ${escapeHtml(tpl.phase === 'all' ? '' : tpl.phase.toUpperCase())}</div>
  </div>
  <div class="ref">
    Report · ${escapeHtml(report.id.slice(0, 8))}<br />
    ${escapeHtml(created)}
  </div>
</header>

<h1>${escapeHtml(report.title || tpl.name)}</h1>
${report.subtitle ? `<div class="subtitle">${escapeHtml(report.subtitle)}</div>` : ''}

${sectionsHtml}
${extras}

<footer>
  <span class="accent">Conyso Bench</span> — open-source LSS stats engine · AGPL-3.0 · conyso.com
  &nbsp;·&nbsp; Report id <code>${escapeHtml(report.id)}</code>
  ${linkedAnalyses.length ? `&nbsp;·&nbsp; Backed by ${linkedAnalyses.length} analyses with reproducibility hashes` : ''}
  <br /><br />
  <em>Editable template — re-open this report in Conyso Bench to add sections, link analyses, or export to Word.</em>
</footer>
<div class="watermark">conyso · bench</div>

</body>
</html>`;
}

export function renderReportMarkdown(report, { project = null, analyses = [], publicBase = '' } = {}) {
  const tpl = TEMPLATES_BY_ID[report.template_id];
  if (!tpl) return `# Unknown template`;
  const data = report.data_json || {};
  const opts = { publicBase, project };
  const linkedAnalyses = (report.analyses_json || []).map(id => analyses.find(a => a.id === id)).filter(Boolean);

  const parts = [
    `# ${report.title || tpl.name}`,
    report.subtitle ? `*${report.subtitle}*` : '',
    `> _Conyso Bench · ${tpl.name} · ${tpl.phase === 'all' ? '' : tpl.phase.toUpperCase()} · Report \`${report.id.slice(0,8)}\` · ${fmtDate(report.created_at || Date.now() / 1000)}_`,
    '',
  ];

  for (const section of (tpl.sections || [])) {
    const renderer = SECTION_MD[section.kind];
    if (!renderer) continue;
    const analysesForSection = ['chart', 'metrics', 'summary', 'hashes', 'analyses_list'].includes(section.kind)
      ? linkedAnalyses : [];
    parts.push(`## ${section.label}`);
    if (section.hint) parts.push(`_${section.hint}_`);
    parts.push(renderer(section, data[section.id], analysesForSection, opts));
    parts.push('');
  }
  for (const ex of (data.__extras || [])) {
    parts.push(`## ${ex.title || 'Section'}`);
    parts.push(ex.body || '');
    parts.push('');
  }
  parts.push('---');
  parts.push(`*Generated by Conyso Bench — open-source LSS stats engine. conyso.com*`);
  return parts.join('\n');
}

// Word-flavored HTML: same HTML, wrapped in an Office mhtml-ish single-file
// envelope with the application/msword Content-Type so it opens in Word.
export function renderReportWordDoc(report, ctx) {
  const html = renderReportHtml(report, ctx);
  return `MIME-Version: 1.0
Content-Type: multipart/related; boundary="boundary-CONYSO"

--boundary-CONYSO
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Location: file:///doc.htm

${html}

--boundary-CONYSO--`;
}

export { TEMPLATES_BY_ID };
