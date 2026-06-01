const ICON_PATHS = {
  // Brand mark — four ascending bars with a baseline. Histogram archetype.
  brand: { vb: '0 0 28 28', size: 28, lines: [
    [4, 22, 4, 17], [10, 22, 10, 11], [16, 22, 16, 7], [22, 22, 22, 13],
  ], baselines: [[2, 24, 26, 24]] },
  // Workspace
  datasets:  { lines: [[2,4,12,4],[2,7,12,7],[2,10,12,10],[2,13,12,13]] },
  analyses:  { lines: [[3,12,3,9],[6,12,6,5],[9,12,9,7],[12,12,12,3],[1,13,13,13]] },
  recipes:   { paths: ['M3 2 L11 2 L11 13 L7 10 L3 13 Z'] },
  reports:   { lines: [[3,2,11,2],[3,5,11,5],[3,8,9,8],[3,11,11,11]], paths: ['M2 1 L13 1 L13 14 L2 14 Z'] },
  // Families
  hypothesis: { paths: ['M1 12 Q4 12 7 7 Q10 2 13 12'] },
  control:    { paths: ['M1 10 L3 6 L5 9 L7 4 L9 8 L11 5 L13 7'] },
  capability: { paths: ['M1 12 Q4 12 7 7 Q10 2 13 12'], lines: [[4,2,4,13],[10,2,10,13]] },
  msa:        { circles: [[3,4,1],[7,4,1],[11,4,1],[3,8,1],[7,8,1],[11,8,1],[3,12,1],[7,12,1],[11,12,1]] },
  regression: { paths: ['M1 12 L13 2'], circles: [[3,11,0.9],[5,9,0.9],[7,8,0.9],[9,5,0.9],[11,4,0.9]] },
  doe:        { lines: [[2,2,12,2],[2,7,12,7],[2,12,12,12],[2,2,2,12],[7,2,7,12],[12,2,12,12]] },
  reliability:{ paths: ['M1 3 Q5 4 7 7 Q10 11 13 12'] },
  multivariate:{ circles: [[3,3,1.2],[6,5,1.2],[4,7,1.2],[10,4,1.2],[9,8,1.2],[12,10,1.2],[5,11,1.2]] },
  time:       { paths: ['M1 8 Q3 4 5 8 T9 8 T13 8'] },
  graphs:     { lines: [[3,12,3,8],[7,12,7,4],[11,12,11,6],[1,13,13,13]] },
  other:      { paths: ['M1 12 Q4 12 7 7 Q10 2 13 12'] },
  // Tools
  tools:      { lines: [[3,4,11,4],[3,7,11,7],[3,10,11,10]] },
};

// Turn machine-y identifiers into something a human would read on a form.
//   "cycle_time_minutes" → "Cycle time minutes"
//   "one_sample_t"       → "1-sample t" (via the dictionary; else snake_case fallback)
//   "X-bar/R"            → "X-bar/R"    (already formatted; leave alone)
//   "ANOVA"              → "ANOVA"      (already all caps; leave alone)
// The raw identifier remains the <option value> so server-side code is unchanged.
const HUMAN_OVERRIDE = {
  one_sample_t: '1-sample t', two_sample_t: '2-sample t',
  two_sample_t_welch: 'Welch 2-sample t', paired_t: 'Paired t',
  one_way_anova: 'One-way ANOVA', two_way_anova: 'Two-way ANOVA',
  one_way_anova_welch: 'Welch one-way ANOVA',
  mann_whitney: 'Mann-Whitney U', wilcoxon_signed_rank: 'Wilcoxon signed-rank',
  kruskal: 'Kruskal-Wallis', sign_test: 'Sign test',
  mood_median: 'Mood\'s median', levene: 'Levene\'s test',
  bartlett: 'Bartlett\'s test', f_test_variances: 'F-test of variances',
  chi_square: 'Chi-square', fisher_exact: 'Fisher\'s exact',
  mcnemar: 'McNemar test',
  one_proportion: '1-proportion', two_proportions: '2-proportion',
  anderson_darling_normality: 'Anderson-Darling (normality)',
  ryan_joiner: 'Ryan-Joiner', kolmogorov_smirnov_normal: 'Kolmogorov-Smirnov',
  tost_one_sample: 'TOST (one-sample)', tost_two_sample: 'TOST (two-sample)',
  friedman: 'Friedman', runs: 'Runs test',
  grubbs: 'Grubbs (outlier)', dixon_q: 'Dixon Q (outlier)',
  tukey_hsd: 'Tukey HSD', fisher_lsd: 'Fisher LSD',
  games_howell: 'Games-Howell', dunn: "Dunn's test", dunnett: 'Dunnett',
  hsu_mcb: 'Hsu MCB',
  smallest_extreme_value: 'Smallest extreme value',
  largest_extreme_value: 'Largest extreme value',
  log_logistic: 'Log-logistic', gev: 'Generalized extreme value',
  exp_smoothing: 'Exponential smoothing', auto_arima: 'Auto-ARIMA',
  acf_pacf: 'ACF / PACF', cross_correlation: 'Cross-correlation',
  multi_vari: 'Multi-vari', best_is_largest: 'Higher is better',
  best_is_smallest: 'Lower is better',
  ols: 'OLS (linear)', glm: 'GLM', logistic: 'Logistic',
  poisson: 'Poisson', nonlinear: 'Nonlinear', stepwise: 'Stepwise',
  best_subsets: 'Best subsets', ordinal_logit: 'Ordinal logit',
};
// ────────────────── Cross-linking ──────────────────
//
// Single in-app router. Anything that wants to send the user to another part
// of the SPA calls navigate({...}). Centralising it keeps all link shapes
// consistent and means a future "deep link" / hash-router upgrade is a
// one-place change.
//
// Target shape:
//   { kind, inner?, innerParam? }        → open analyser pre-filled
//   { view: 'methods', anchor?: '...' }  → /methods (+scroll to section)
//   { view: 'guides', guideId: '...' }   → open a specific guide
//   { view: 'tools',  toolKind: '...' }  → open a calculator
//   { view: 'projects' | 'project',
//     projectId?: '...' }                → DMAIC views
function navigate(target = {}) {
  if (target.kind) {
    const fam = ANALYSIS_FAMILIES.find(f => (f.kinds || []).includes(target.kind));
    state._analysisFamily = fam ? fam.id : 'all';
    state._chosenKind     = target.kind;
    state._chosenInnerKind  = target.inner       || null;
    state._chosenInnerParam = target.innerParam  || null;
    // Carry pre-fill params (from follow-up chips or pre-flight recommendations).
    if (target.params) state._prefillParams = target.params;
    state.view = 'analyze';
    state.formOpen = true;
    render();
    if (state._chosenInnerKind) {
      const label = window.statsUx?.KIND_LABEL?.[state._chosenInnerKind]
                 || humanize(state._chosenInnerKind);
      toast({ kind: 'success', msg: `Opened ${label}.` });
    }
    return;
  }
  if (target.view === 'guides') {
    state.view = 'guides';
    state._guideId = target.guideId || null;
    render();
    if (target.anchor) requestAnimationFrame(() => {
      const el = document.getElementById(target.anchor);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }
  if (target.view === 'methods') {
    state.view = 'methods';
    render();
    if (target.anchor) requestAnimationFrame(() => {
      const el = document.getElementById(target.anchor);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }
  if (target.view === 'tools') {
    state.view = 'tools';
    state._toolKind = target.toolKind || null;
    render();
    return;
  }
  if (target.view === 'projects' || target.view === 'project') {
    state.view = target.view;
    if (target.projectId) state._projectId = target.projectId;
    render();
    return;
  }
  if (target.view === 'reports' || target.view === 'report') {
    state.view = target.view;
    if (target.reportId) state._reportId = target.reportId;
    render();
    return;
  }
  if (target.view === 'feedback' || target.view === 'feedback_item') {
    state.view = target.view;
    if (target.feedbackId) state._feedbackId = target.feedbackId;
    // Drop stale single-item cache when switching items.
    if (target.view === 'feedback_item' && state._feedbackItem?.id !== target.feedbackId) {
      state._feedbackItem = null; state._feedbackComments = null;
    }
    if (target.kind) state._feedbackKind = target.kind;
    render();
    return;
  }
  if (target.view) {
    state.view = target.view;
    render();
  }
}
window.navigate = navigate;

// Map analysis kinds → guide + methods-page section. Used in the result
// card footer to send the user from a finished analysis back to context.
const KIND_TO_GUIDE = {
  capability: 'capability', sixpack: 'capability', predictive_cpk: 'capability',
  hypothesis_test: 'pick-test', posthoc: 'pick-test',
  control_chart: 'control-charts',
  msa: 'dmaic',
  regression: 'doe', doe: 'doe', desirability: 'doe',
  reliability: 'getting-started',
  multivariate: 'control-charts',
  time_series: 'control-charts',
  tolerance: 'capability',
  attribute_capability: 'capability',
  pareto: 'dmaic',
  distribution_id: 'capability',
  anom: 'pick-test',
  graph: 'getting-started',
  // Newer kinds — point at the closest existing guide.
  survey: 'getting-started',
  text_pareto: 'cost-pareto',
  variance_budget: 'msa-deep',
  cycle_time: 'control-charts',
  delivery_forecast: 'control-charts',
  cost_pareto: 'cost-pareto',
  correlation: 'pick-test',
  gage_linearity: 'msa-deep',
  variability_gauge: 'msa-deep',
  agreement: 'agreement',
  mixed_effects: 'mixed-effects',
  survival: 'survival',
  bootstrap: 'hypothesis-deep',
  bootstrap_effect: 'hypothesis-deep',
  bayesian: 'hypothesis-deep',
  ternary: 'doe',
};
const KIND_TO_METHOD_ANCHOR = {
  capability: 'methods-capability-measurement', sixpack: 'methods-capability-measurement',
  predictive_cpk: 'methods-capability-measurement', attribute_capability: 'methods-capability-measurement',
  tolerance: 'methods-capability-measurement',
  hypothesis_test: 'methods-hypothesis-testing', posthoc: 'methods-post-hoc-multiple-comparisons',
  control_chart: 'methods-control-charts',
  msa: 'methods-gauge-rr-/-msa',
  regression: 'methods-regression',
  doe: 'methods-design-of-experiments', desirability: 'methods-design-of-experiments',
  reliability: 'methods-reliability',
  multivariate: 'methods-multivariate',
  time_series: 'methods-time-series',
  pareto: 'methods-specialty', distribution_id: 'methods-specialty', anom: 'methods-specialty',
  graph: 'methods-specialty',
  // Newer kinds — map to the closest methods-page section.
  survey: 'methods-specialty', text_pareto: 'methods-specialty',
  variance_budget: 'methods-specialty', cost_pareto: 'methods-specialty',
  cycle_time: 'methods-control-charts', delivery_forecast: 'methods-control-charts',
  correlation: 'methods-regression', mixed_effects: 'methods-regression',
  survival: 'methods-reliability', ternary: 'methods-design-of-experiments',
  agreement: 'methods-gauge-rr-/-msa', gage_linearity: 'methods-gauge-rr-/-msa',
  variability_gauge: 'methods-gauge-rr-/-msa',
  bootstrap: 'methods-hypothesis-testing', bootstrap_effect: 'methods-hypothesis-testing',
  bayesian: 'methods-hypothesis-testing',
};

// DMAIC phase → suggested analyses (label + nav target). Surfaced on the
// project phase page so users have a one-click launch into the right tool.
const PHASE_SUGGESTIONS = {
  define: [
    { label: 'Pareto of defects',        target: { kind: 'pareto' } },
    { label: 'Distribution identifier',  target: { kind: 'distribution_id' } },
  ],
  measure: [
    { label: 'Gauge R&R (crossed)',      target: { kind: 'msa', inner: 'crossed', innerParam: 'design' } },
    { label: 'Baseline capability',      target: { kind: 'capability' } },
    { label: 'Distribution identifier',  target: { kind: 'distribution_id' } },
    { label: 'Sample size & power',      target: { view: 'tools', toolKind: 'sample_size' } },
  ],
  analyze: [
    { label: 'Pareto',                   target: { kind: 'pareto' } },
    { label: 'One-way ANOVA',            target: { kind: 'hypothesis_test', inner: 'one_way_anova', innerParam: 'test' } },
    { label: 'Mann-Whitney U',           target: { kind: 'hypothesis_test', inner: 'mann_whitney',  innerParam: 'test' } },
    { label: 'Regression (OLS)',         target: { kind: 'regression', inner: 'ols', innerParam: 'method' } },
    { label: 'Hsu MCB (which is best)',  target: { kind: 'posthoc', inner: 'hsu_mcb', innerParam: 'test' } },
  ],
  improve: [
    { label: 'DOE — factorial fit',      target: { kind: 'doe' } },
    { label: 'DOE design generator',     target: { view: 'tools', toolKind: 'doe_design' } },
    { label: 'Multi-response desirability', target: { kind: 'desirability' } },
    { label: 'Predictive Cpk (what-if)', target: { kind: 'predictive_cpk' } },
  ],
  control: [
    { label: 'Control chart (I-MR)',     target: { kind: 'control_chart', inner: 'I-MR',    innerParam: 'kind' } },
    { label: 'Control chart (X-bar/R)',  target: { kind: 'control_chart', inner: 'X-bar/R', innerParam: 'kind' } },
    { label: 'Capability (sustained)',   target: { kind: 'capability' } },
    { label: 'Tolerance interval',       target: { kind: 'tolerance' } },
  ],
};

// Global click delegation — any anchor with data-nav-* attributes is treated
// as an internal SPA link. Lets us embed clickable analyses inside guide HTML.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-nav-kind], [data-nav-guide], [data-nav-tool], [data-nav-methods]');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.navKind)     navigate({ kind: a.dataset.navKind, inner: a.dataset.navInner || null, innerParam: a.dataset.navInnerParam || null });
  else if (a.dataset.navGuide)   navigate({ view: 'guides',  guideId: a.dataset.navGuide });
  else if (a.dataset.navTool)    navigate({ view: 'tools',   toolKind: a.dataset.navTool });
  else if (a.dataset.navMethods) navigate({ view: 'methods', anchor: a.dataset.navMethods });
});

window.humanize = humanize;
function humanize(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw);
  if (HUMAN_OVERRIDE[s]) return HUMAN_OVERRIDE[s];
  // Already mixed-case / has punctuation → leave alone.
  if (/[A-Z]/.test(s) && !/^[A-Z_]+$/.test(s)) return s;
  if (/[/\-]/.test(s) && !s.includes('_')) return s;
  // snake_case → "Sentence case"
  const spaced = s.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function icon(name, opts = {}) {
  const def = ICON_PATHS[name];
  if (!def) return null;
  const vb = def.vb || '0 0 14 14';
  const size = opts.size || def.size || 14;
  const stroke = opts.stroke || 1.2;
  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('viewBox', vb);
  root.setAttribute('width', size);
  root.setAttribute('height', size);
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', 'currentColor');
  root.setAttribute('stroke-width', stroke);
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  root.style.flexShrink = '0';
  for (const [x1, y1, x2, y2] of (def.lines || [])) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    root.appendChild(l);
  }
  for (const d of (def.paths || [])) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    root.appendChild(p);
  }
  for (const [cx, cy, r] of (def.circles || [])) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', 'currentColor'); c.setAttribute('stroke', 'none');
    root.appendChild(c);
  }
  for (const [x1, y1, x2, y2] of (def.baselines || [])) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke-opacity', '0.4');
    root.appendChild(l);
  }
  return root;
}

