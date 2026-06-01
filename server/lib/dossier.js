// Method dossier — printable HTML page (one analysis per page) carrying
// everything a regulated-industry validator wants: algorithm name, source
// library + version, citation, inputs, outputs, software hash + result
// hash. The user prints it to PDF from their browser.
//
// What this is NOT: a sealed signed PDF. The validation value comes from
// reproducibility (re-run gives the same hashes) + open-source (read the
// algorithm) + the citation chain, not from cryptographic signing. If you
// need signing on top, wrap the HTML in your own signing pipeline.

// Hand-curated provenance per kind. Surfaced in the dossier header.
// Keep in sync with server/public/app.js METHODS_INDEX.
const KIND_PROVENANCE = {
  capability: {
    title: 'Process Capability (Cp, Cpk, Pp, Ppk)',
    library: 'custom · NumPy + SciPy',
    reference: 'Montgomery, "Introduction to Statistical Quality Control" 7e (2012); AIAG PPAP 4th ed.',
    notes: 'Cp and Cpk use within-subgroup sigma estimated from the moving range. Pp/Ppk use overall sigma. Box-Cox transform when transform="box-cox".',
  },
  hypothesis_test: {
    title: 'Hypothesis test',
    library: 'scipy.stats / statsmodels',
    reference: 'See dispatched test for the original publication.',
    notes: 'Standard parametric and non-parametric tests implemented via scipy.stats. Welch correction applied for unequal variances.',
  },
  control_chart: {
    title: 'Control chart',
    library: 'custom · NumPy + matplotlib',
    reference: 'Shewhart, "Economic Control of Quality of Manufactured Product" (1931); AIAG SPC 2nd ed.; Page (1954) for CUSUM; Roberts (1959) for EWMA; Hotelling (1947) for T²; Lowry et al. (1992) for MEWMA.',
    notes: 'Western Electric and Nelson rules applied automatically. Violations listed in summary.',
  },
  regression: {
    title: 'Linear regression (OLS)',
    library: 'statsmodels.api.OLS',
    reference: 'Gauss (1809); Draper & Smith, "Applied Regression Analysis" 3e (1998).',
    notes: 'Heteroscedasticity-robust standard errors available via cov_type. Default reports homoscedastic SE.',
  },
  msa: {
    title: 'Gauge R&R (Measurement System Analysis)',
    library: 'statsmodels.MixedLM',
    reference: 'AIAG MSA Reference Manual, 4th edition (2010).',
    notes: 'Crossed, nested, and expanded designs supported. ANOVA-based variance components reported.',
  },
  doe: {
    title: 'DOE — Factorial fit',
    library: 'statsmodels.api.OLS',
    reference: 'Box, Hunter & Hunter, "Statistics for Experimenters" 2e (2005).',
    notes: 'Coefficients in coded units. Interactions included when interactions=true.',
  },
  desirability: {
    title: 'Multi-response desirability optimization',
    library: 'scipy.optimize.minimize (L-BFGS-B) over fitted quadratic surfaces',
    reference: 'Derringer & Suich, "Simultaneous Optimization of Several Response Variables" (Journal of Quality Technology, 1980).',
    notes: 'Per-response desirability d_i computed with weight parameter; overall D = (∏ d_i^I_i)^(1/Σ I_i). Multi-start L-BFGS-B over coded factor box.',
  },
  reliability: {
    title: 'Reliability / survival analysis',
    library: 'scipy.stats (lognormal/gamma/Fisk/Gumbel/GEV) + custom Weibull MLE',
    reference: 'Meeker & Escobar, "Statistical Methods for Reliability Data" (1998); Weibull (1951); Nelson, "Accelerated Testing" (1990) for Arrhenius.',
    notes: 'Right-censoring supported in Weibull and Exponential. B10 reported as inverse CDF at 0.10.',
  },
  multivariate: {
    title: 'Multivariate analysis',
    library: 'scikit-learn / scipy.cluster',
    reference: 'Pearson (1901) and Hotelling (1933) for PCA; MacQueen (1967) for k-means; Fisher (1936) for LDA; Hotelling (1947) for T².',
    notes: 'PCA on standardised inputs by default. Hotelling T² uses pooled covariance.',
  },
  time_series: {
    title: 'Time series',
    library: 'statsmodels.tsa',
    reference: 'Box & Jenkins, "Time Series Analysis: Forecasting and Control" (1970); Hyndman & Khandakar (2008) for auto-ARIMA.',
    notes: 'ARIMA fitted by MLE. Auto-ARIMA searches over (p, d, q) by AIC.',
  },
  posthoc: {
    title: 'Post-hoc multiple-comparison test',
    library: 'statsmodels / custom',
    reference: 'Tukey (1949); Fisher (1935); Games & Howell (1976); Dunnett (1955); Hsu (1984).',
    notes: 'Pooled MSE from the ANOVA underlying the comparison. Dunnett and Hsu MCB use a Bonferroni approximation pending exact critical values.',
  },
  tolerance: {
    title: 'Tolerance interval',
    library: 'custom · NumPy / SciPy',
    reference: 'Howe (1969); Wilks (1941) for non-parametric; ISO 16269-6.',
    notes: 'Normal-theory uses k-factor table. Non-parametric uses order statistics.',
  },
  pareto: {
    title: 'Pareto analysis',
    library: 'pandas',
    reference: 'Pareto (1896); Juran, "Quality Control Handbook" (1951).',
    notes: 'Vital-few cutoff defaults to 80%.',
  },
  predictive_cpk: {
    title: 'Predictive Cpk (what-if)',
    library: 'custom · NumPy',
    reference: 'Bissell, "How reliable is your capability index?" (Applied Statistics, 1990).',
    notes: 'Projects Cpk under hypothesised σ multipliers. Uses Bissell large-sample CI.',
  },
  distribution_id: {
    title: 'Distribution Identifier',
    library: 'scipy.stats',
    reference: 'Stephens (1974) for Anderson-Darling.',
    notes: 'Candidates ranked by A² (lower is better), tie-broken on AIC.',
  },
  attribute_capability: {
    title: 'Attribute capability',
    library: 'scipy.stats',
    reference: 'AIAG SPC Reference Manual, 2nd ed.',
    notes: 'Binomial for proportion-defective. Poisson for defects-per-unit.',
  },
  anom: {
    title: 'Analysis of Means (ANOM)',
    library: 'scipy.stats',
    reference: 'Ott, "Analysis of Means - A Graphical Procedure" (Industrial Quality Control, 1967).',
    notes: 'Decision limits at α via studentised range.',
  },
  sixpack: {
    title: 'Capability Sixpack',
    library: 'composite · capability + control_chart + distribution_id',
    reference: 'Montgomery (2012); AIAG PPAP 4th ed.',
    notes: 'Single-page report combining capability metrics, charts, and normality assessment.',
  },
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

function fmt(v) {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    if (Math.abs(v) >= 1000) return v.toFixed(2);
    if (Math.abs(v) >= 1)    return v.toFixed(4);
    return v.toFixed(6);
  }
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

function renderKV(rows) {
  return rows.map(([k, v]) =>
    `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(fmt(v))}</td></tr>`
  ).join('');
}

/**
 * Generate the dossier HTML for one analysis row from SQLite.
 * @param {object} a — the analysis row (with parsed result_json + params_json)
 * @param {object} [opts]
 * @param {string} [opts.datasetName]
 * @param {string} [opts.workspaceName]
 */
export function renderDossier(a, { datasetName = '', workspaceName = '' } = {}) {
  const kind = a.kind;
  const prov = KIND_PROVENANCE[kind] || {
    title: kind,
    library: '(see source)',
    reference: '(see /methods)',
    notes: '',
  };
  const summary = a.result_json?.summary || {};
  const rep = a.result_json?.provenance || {};
  const params = a.params_json || {};
  const created = a.created_at
    ? new Date(a.created_at * 1000).toISOString()
    : '—';

  // Flatten summary into KV rows (one level only). Nested objects become JSON.
  const summaryRows = Object.entries(summary)
    .filter(([k]) => k !== 'recipe' && k !== 'annotations')
    .map(([k, v]) => [k, v]);
  const paramRows = Object.entries(params);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Conyso Bench · Method Dossier · ${escapeHtml(a.id)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body {
    font: 11.5pt/1.55 'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #14110b; background: #ffffff;
    -webkit-font-smoothing: antialiased;
    max-width: 760px; margin: 0 auto; padding: 32px 32px 64px;
  }
  header {
    border-bottom: 1px solid #14110b;
    padding-bottom: 14px;
    margin-bottom: 24px;
    display: flex; align-items: baseline; justify-content: space-between;
  }
  header .brand { font: 600 14pt 'Inter', sans-serif; letter-spacing: 0.12em; }
  header .ref { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 10pt; color: #6f6960; }
  h1 {
    font: 400 22pt 'Inter', serif;
    margin: 8px 0 4px;
    letter-spacing: -0.005em;
  }
  .deck { color: #3a3530; font-size: 11pt; margin-bottom: 28px; }
  h2 {
    font: 500 9pt 'Inter', sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: #6f6960;
    margin: 26px 0 8px;
  }
  table.kv { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.kv th, table.kv td {
    text-align: left; padding: 7px 8px;
    border-bottom: 1px solid rgba(20,17,11,0.10);
    vertical-align: top;
  }
  table.kv th { width: 28%; font-weight: 500; color: #3a3530; }
  table.kv td {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10.5pt; color: #14110b;
    white-space: pre-wrap; word-break: break-word;
  }
  .note {
    border-left: 2px solid #6b5524;
    padding: 4px 12px;
    color: #3a3530;
    font-size: 10.5pt;
    margin: 8px 0 24px;
  }
  footer {
    border-top: 1px solid rgba(20,17,11,0.14);
    padding-top: 14px;
    margin-top: 32px;
    color: #6f6960;
    font-size: 9pt;
    line-height: 1.6;
  }
  footer code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 9pt; }
  @media print {
    body { padding: 0; }
    header { page-break-after: avoid; }
    h2 { page-break-after: avoid; }
  }
</style>
</head>
<body>

<header>
  <div class="brand">CONYSO &nbsp;BENCH</div>
  <div class="ref">Dossier · ${escapeHtml(a.id)}</div>
</header>

<h1>${escapeHtml(prov.title)}</h1>
<div class="deck">${escapeHtml(prov.notes || '')}</div>

<h2>Analysis</h2>
<table class="kv">
  ${renderKV([
    ['Kind',         kind],
    ['Dataset',      datasetName || a.dataset_id || '—'],
    ['Workspace',    workspaceName || a.workspace_id || '—'],
    ['Run at',       created],
  ])}
</table>

<h2>Method</h2>
<table class="kv">
  ${renderKV([
    ['Algorithm',    prov.title],
    ['Library',      prov.library],
    ['Reference',    prov.reference],
  ])}
</table>

<h2>Inputs (params)</h2>
<table class="kv">
  ${paramRows.length
    ? renderKV(paramRows)
    : '<tr><td colspan="2" style="color:#6f6960">(no parameters)</td></tr>'}
</table>

<h2>Outputs (summary)</h2>
<table class="kv">
  ${summaryRows.length
    ? renderKV(summaryRows)
    : '<tr><td colspan="2" style="color:#6f6960">(no summary fields)</td></tr>'}
</table>

<h2>Reproducibility</h2>
<table class="kv">
  ${renderKV([
    ['Software',     rep.software_version || '—'],
    ['Data hash',    rep.data_hash || '—'],
    ['Params hash',  rep.params_hash || '—'],
    ['Result hash',  rep.result_hash || '—'],
    ['Computed at',  rep.computed_at || '—'],
  ])}
</table>
<div class="note">
  Re-running this analysis on the same data with the same parameters produces
  identical hashes. Discrepancies between a re-run and the values above
  indicate either a software upgrade or a change in the underlying data —
  both legitimate, both auditable.
</div>

<footer>
  This dossier was generated by Conyso Bench (open-source, AGPL-3.0). The
  algorithm reference above points to the original peer-reviewed source.
  Method implementations are available for inspection at the project repository
  and indexed at the <code>/methods</code> page. Conyso Labs offers commercial
  validation packaging (IQ/OQ/PQ authoring) for regulated environments —
  <code>hello@conyso.com</code>.
  <br /><br />
  <strong>Disclaimer.</strong> This dossier records the method and inputs used;
  it does not constitute regulatory approval, validation, or qualification.
  Validate against your organisation's verification protocol.
</footer>

</body>
</html>`;
}

export { KIND_PROVENANCE };
