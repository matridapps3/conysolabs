// Stats Engine UX layer.
//
// This file encodes Lean Six Sigma expertise as rules — every feature
// here is RULE-BASED, NO LLM CALLS. Runs entirely client-side or against
// the existing free-tier Python sidecar. Costs Conyso $0/call and the
// user $0/forever.
//
// What's in here:
//   - TestChooser  — wizard that picks the right test (decision tree)
//   - TrafficLights — pre-flight assumption checks before running an analysis
//   - QueryParser  — plain-English → analysis spec (regex / keyword)
//   - Recommender  — "what's next?" suggestions per analysis result
//   - SvgCharts    — vanilla-SVG interactive charts for the top 5 chart kinds
//   - Recipes      — saved analysis configs that can be re-run
//   - Annotations  — pinnable notes on chart points
//   - ActionPlan   — rule-based free-tier action plans for analyses
//   - LivePreview  — debounced parameter-change refresh
//   - HealthScore  — composite "process health" gauge
//   - Comparator   — side-by-side analysis view
//   - DeckExporter — "Add to tollgate deck" with one click
//   - Help         — inline "why this test?" tooltips
//
// Loaded after app.js. Exposes everything as window.statsUx.

(function () {
'use strict';

// ───────── Decision tree for the Test Chooser ─────────
//
// Each node is { question, options: [{label, next: nodeName | recommend: kind}] }
// Leaves carry { recommend: 'kind_name', alt_if_assumption_fails: 'fallback_kind' }
const CHOOSER_TREE = {
  root: {
    question: "What are you trying to learn?",
    options: [
      { label: 'Compare a value to a target',          next: 'one_sample' },
      { label: 'Compare two groups',                   next: 'two_groups' },
      { label: 'Compare 3+ groups',                    next: 'k_groups' },
      { label: 'Before / after on the same items',     next: 'paired' },
      { label: 'Relationship between variables',       next: 'relation' },
      { label: 'Is the process capable?',              next: 'capability' },
      { label: 'Is the process stable over time?',     next: 'stability' },
      { label: 'Find root cause of defects',           next: 'rca' },
      { label: 'Validate the measurement system',      recommend: 'msa', why: 'Gauge R&R quantifies how much variation comes from the measurement system itself.' },
      { label: 'Time-to-failure / reliability',        recommend: 'reliability', why: 'Weibull fit on failure times, with right-censoring.' },
      { label: 'Reduce dimensionality / find clusters', next: 'multivariate' },
    ],
  },
  one_sample: {
    question: 'What kind of data?',
    options: [
      { label: 'Continuous measurements',
        recommend: 'one_sample_t',
        prereq_checks: ['normality'],
        alt_if_normality_fails: 'sign_test',
        why: 'Tests whether the mean equals the target. Falls back to the sign test if normality fails.' },
      { label: 'Pass/fail (proportion)',
        recommend: 'one_proportion',
        why: 'Exact binomial test against a target proportion.' },
      { label: 'Defect counts (Poisson rate)',
        recommend: 'poisson_capability',
        why: 'Estimates defect rate with confidence interval.' },
    ],
  },
  two_groups: {
    question: 'What kind of data?',
    options: [
      { label: 'Continuous (compare means)',
        recommend: 'two_sample_t',
        prereq_checks: ['normality_per_group', 'equal_variances'],
        alt_if_normality_fails: 'mann_whitney',
        alt_if_variance_fails: 'two_sample_t_welch',
        why: 'Welch by default (no equal-variance assumption); switches to Mann-Whitney if normality fails.' },
      { label: 'Continuous (compare variances)',
        recommend: 'levene',
        why: 'Brown-Forsythe-Levene — robust to non-normality. Bartlett for known-normal data.' },
      { label: 'Pass/fail (proportions)',
        recommend: 'two_proportions',
        why: 'Z-test for two proportions. Use Fisher exact when sample sizes are tiny.' },
      { label: 'Defect counts',
        recommend: 'chi_square',
        why: 'Chi-square test of association on a 2-group contingency.' },
    ],
  },
  k_groups: {
    question: 'What kind of data?',
    options: [
      { label: 'Continuous (compare means)',
        recommend: 'one_way_anova',
        prereq_checks: ['normality_per_group', 'equal_variances'],
        alt_if_normality_fails: 'kruskal',
        alt_if_variance_fails: 'one_way_anova_welch',
        followup: 'tukey_hsd',
        why: 'One-way ANOVA. If significant, follow with Tukey HSD post-hoc. Kruskal-Wallis if data are non-normal.' },
      { label: 'Continuous, two factors',
        recommend: 'two_way_anova',
        why: 'Two-way ANOVA — main effects + interaction.' },
      { label: 'Categorical / counts',
        recommend: 'chi_square',
        why: 'Chi-square contingency. Fisher exact for small expected counts.' },
    ],
  },
  paired: {
    question: 'What kind of data?',
    options: [
      { label: 'Continuous',
        recommend: 'paired_t',
        prereq_checks: ['normality_of_diffs'],
        alt_if_normality_fails: 'wilcoxon_signed_rank',
        why: 'Paired t-test on differences. Wilcoxon if differences are non-normal.' },
      { label: 'Pass/fail',
        recommend: 'mcnemar',
        why: 'McNemar test on paired binary outcomes (before/after for the same subjects).' },
    ],
  },
  relation: {
    question: 'What kind of relationship?',
    options: [
      { label: 'One predictor → continuous response',     recommend: 'regression', followup: 'fitted_line' },
      { label: 'Many predictors → continuous response',   recommend: 'best_subsets' },
      { label: 'Predictors → binary response',            recommend: 'logistic' },
      { label: 'Predictors → count response',             recommend: 'poisson_regression' },
      { label: 'Curve shape / nonlinear',                 recommend: 'nonlinear_regression' },
    ],
  },
  capability: {
    question: 'Continuous or attribute?',
    options: [
      { label: 'Continuous (Cpk)',                          recommend: 'capability', prereq_checks: ['normality'], alt_if_normality_fails: 'capability_box_cox' },
      { label: 'Pass/fail (binomial)',                      recommend: 'binomial_capability' },
      { label: 'Defect counts (Poisson)',                   recommend: 'poisson_capability' },
    ],
  },
  stability: {
    question: 'What are you charting?',
    options: [
      { label: 'Continuous, individual obs (no subgroups)', recommend: 'control_chart_imr' },
      { label: 'Continuous, with subgroups',                recommend: 'control_chart_xbar_r' },
      { label: 'Small persistent shift (mean)',             recommend: 'control_chart_cusum' },
      { label: 'Recent obs weighted more',                  recommend: 'control_chart_ewma' },
      { label: 'Defective fraction',                        recommend: 'control_chart_p' },
      { label: 'Defect rate per unit',                      recommend: 'control_chart_u' },
    ],
  },
  rca: {
    question: 'What signals do you have?',
    options: [
      { label: 'Defect log with categories',                recommend: 'auto_rca' },
      { label: 'Just symptoms — brainstorm causes',         recommend: 'fishbone' },
      { label: 'I want to drill into one root cause',       recommend: 'five_whys' },
      { label: 'Rank candidate solutions',                  recommend: 'solution_matrix' },
    ],
  },
  multivariate: {
    question: 'What are you trying to do?',
    options: [
      { label: 'Reduce dimensionality',                     recommend: 'pca' },
      { label: 'Find clusters (unknown groups)',            recommend: 'kmeans' },
      { label: 'Classify into known groups',                recommend: 'lda' },
      { label: 'Group similarity (dendrogram)',             recommend: 'hierarchical_cluster' },
    ],
  },
};

// Human labels for recommendations (short — used in the wizard summary).
const KIND_LABEL = {
  // New Bench-only analyses
  agreement: 'Attribute Agreement Analysis',
  bootstrap: 'Bootstrap confidence interval',
  correlation: 'Correlation matrix',
  gage_linearity: 'Gage Linearity & Bias',
  robust: 'Robust regression (Huber M-estimator)',
  quantile: 'Quantile regression',
  cox_ph: 'Cox Proportional Hazards',
  changepoint: 'Changepoint detection (PELT)',
  interaction: 'Interaction plot',
  taguchi: 'Taguchi orthogonal array',
  johnson: 'Capability (Johnson transform)',
  // Leap-ahead batch
  survival: 'Kaplan-Meier + log-rank',
  mixed_effects: 'Linear mixed-effects (LMM)',
  cost_pareto: 'Cost-weighted Pareto',
  ternary: 'Mixture ternary contour',
  bootstrap_effect: 'Bootstrap effect-size CI',
  variability_gauge: 'Variability gauge chart',
  random_forest: 'Random Forest + permutation importance',
  rm_anova: 'Repeated-measures ANOVA',
  bayesian: 'Bayesian inference',
  beta_binomial: 'Beta-binomial (proportion)',
  normal_normal: 'Normal-normal (mean)',
  best_two_sample: 'BEST (Bayesian two-sample)',
  bayes_factor_ttest: 'Bayes factor t-test (JZS)',
  doe_augment: 'DOE — augment / fold / replicate',
  one_sample_t: '1-sample t-test',
  two_sample_t: '2-sample t-test (Welch)',
  two_sample_t_welch: 'Welch\'s t-test',
  paired_t: 'Paired t-test',
  one_way_anova: 'One-way ANOVA',
  one_way_anova_welch: 'Welch\'s ANOVA',
  two_way_anova: 'Two-way ANOVA',
  mann_whitney: 'Mann-Whitney U',
  wilcoxon_signed_rank: 'Wilcoxon signed-rank',
  kruskal: 'Kruskal-Wallis',
  sign_test: 'Sign test',
  levene: 'Levene\'s test',
  chi_square: 'Chi-square',
  fisher_exact: 'Fisher\'s exact',
  mcnemar: 'McNemar test',
  friedman: 'Friedman test',
  bartlett: 'Bartlett\'s test',
  mood_median: 'Mood\'s median',
  anderson_darling_normality: 'Anderson-Darling (normality)',
  ryan_joiner: 'Ryan-Joiner',
  kolmogorov_smirnov_normal: 'Kolmogorov-Smirnov',
  tost_one_sample: 'TOST (one-sample)',
  tost_two_sample: 'TOST (two-sample)',
  runs: 'Runs test',
  grubbs: 'Grubbs outlier',
  dixon_q: 'Dixon Q outlier',
  hsu_mcb: 'Hsu MCB',
  games_howell: 'Games-Howell',
  dunnett: 'Dunnett',
  hotelling: 'Hotelling T²',
  fitted_line: 'Fitted line plot',
  full_factorial: 'Full factorial design',
  plackett_burman: 'Plackett-Burman screening',
  central_composite: 'Central composite design',
  box_behnken: 'Box-Behnken design',
  definitive_screening: 'Definitive screening design',
  mixture_simplex_centroid: 'Mixture (simplex-centroid)',
  poisson_capability: 'Poisson capability',
  binomial_capability: 'Binomial capability',
  one_proportion: '1-proportion test',
  two_proportions: '2-proportion test',
  tukey_hsd: 'Tukey HSD post-hoc',
  capability: 'Capability (Cpk)',
  capability_box_cox: 'Capability with Box-Cox',
  binomial_capability: 'Binomial capability',
  poisson_capability: 'Poisson capability',
  control_chart_imr: 'I-MR chart',
  control_chart_xbar_r: 'X-bar/R chart',
  control_chart_cusum: 'CUSUM chart',
  control_chart_ewma: 'EWMA chart',
  control_chart_p: 'p chart',
  control_chart_u: 'u chart',
  regression: 'Linear regression',
  best_subsets: 'Best-subsets regression',
  logistic: 'Logistic regression',
  poisson_regression: 'Poisson regression',
  nonlinear_regression: 'Nonlinear regression',
  msa: 'Gauge R&R',
  reliability: 'Weibull / reliability',
  fishbone: 'Fishbone diagram',
  five_whys: '5 Whys',
  auto_rca: 'Auto-RCA',
  solution_matrix: 'Solution matrix',
  pca: 'Principal Components',
  kmeans: 'K-means clustering',
  lda: 'Discriminant analysis (LDA)',
  hierarchical_cluster: 'Hierarchical clustering',
};

// ───────── Test Chooser UI ─────────

function openTestChooser(onPick) {
  const overlay = h('div', { className: 'cmdk-overlay' });
  const card = h('div', { className: 'cmdk', style: 'padding:0;width:560px;max-width:92vw' });
  const head = h('div', { style: 'padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px' },
    h('strong', { style: 'font-size:15px' }, 'Test Chooser'),
    h('span', { className: 'muted', style: 'font-size:12px;flex:1' }, 'Bill picks the right test for your situation.'),
    h('button', { className: 'ghost', onclick: () => overlay.remove() }, 'Cancel'),
  );
  const body = h('div', { style: 'padding:18px;max-height:60vh;overflow:auto' });
  card.append(head, body);
  overlay.append(card);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);

  const path = [];
  function show(nodeName) {
    const node = CHOOSER_TREE[nodeName];
    body.innerHTML = '';
    if (path.length) {
      body.append(h('div', { className: 'breadcrumb', style: 'margin-bottom:8px' },
        ...path.map((p, i) =>
          h('span', { onclick: () => { path.splice(i); show(p.from); }, style: 'cursor:pointer' }, '← ', p.label, ' '),
        ),
      ));
    }
    body.append(h('h3', { style: 'margin:0 0 14px;font-size:16px' }, node.question));
    const list = h('div', { className: 'stack' });
    for (const opt of node.options) {
      const btn = h('button', {
        className: 'secondary',
        style: 'text-align:left;padding:10px 14px;width:100%;display:block',
        onclick: () => {
          if (opt.next) {
            path.push({ label: opt.label, from: nodeName });
            show(opt.next);
          } else if (opt.recommend) {
            showRecommendation(opt);
          }
        },
      },
        h('div', { style: 'font-weight:500' }, opt.label),
        opt.next ? null : h('div', { className: 'muted', style: 'font-size:12px;margin-top:2px' },
          '→ ', KIND_LABEL[opt.recommend] || opt.recommend),
      );
      list.append(btn);
    }
    body.append(list);
  }

  function showRecommendation(opt) {
    body.innerHTML = '';
    body.append(
      h('div', { className: 'pill accent', style: 'margin-bottom:10px' }, 'RECOMMENDED'),
      h('h3', { style: 'margin:0 0 6px;font-size:18px' },
        KIND_LABEL[opt.recommend]
          || (window.humanize ? window.humanize(opt.recommend) : opt.recommend)),
      h('p', { className: 'muted', style: 'margin:0 0 14px;line-height:1.55' }, opt.why || ''),
    );
    if (opt.prereq_checks?.length) {
      body.append(h('div', { className: 'card', style: 'background:var(--cream);border-color:var(--cream-line);margin-bottom:14px' },
        h('div', { style: 'font-weight:500;margin-bottom:6px' }, 'Bill will check these assumptions first:'),
        h('ul', { style: 'margin:0;padding-left:20px;font-size:13px;color:var(--ink-2)' },
          ...opt.prereq_checks.map(c => h('li', {}, ASSUMPTION_LABELS[c] || c)),
        ),
        opt.alt_if_normality_fails ? h('div', { style: 'margin-top:6px;font-size:12px;color:var(--muted)' },
          `If normality fails → switches to ${KIND_LABEL[opt.alt_if_normality_fails]}.`) : null,
      ));
    }
    if (opt.followup) {
      body.append(h('div', { style: 'margin-bottom:14px;font-size:13px;color:var(--muted)' },
        '→ If significant, recommended follow-up: ', h('strong', {}, KIND_LABEL[opt.followup])));
    }
    body.append(h('div', { className: 'row' },
      h('button', { className: 'ghost', onclick: () => { path.length = 0; show('root'); } }, '← Start over'),
      h('span', { className: 'spacer' }),
      h('a', {
        className: 'ghost', href: '#', style: 'font-size:12px;color:var(--muted)',
        onclick: (e) => { e.preventDefault(); overlay.remove();
          if (window.navigate) window.navigate({ view: 'guides', guideId: 'pick-test' }); },
      }, 'Read the guide →'),
      h('button', { className: 'primary', onclick: () => {
        overlay.remove();
        onPick?.(opt.recommend, opt);
      }}, 'Use this test'),
    ));
  }

  show('root');
}

// ───────── Assumption traffic lights ─────────

const ASSUMPTION_LABELS = {
  normality:           'Data are approximately normal',
  normality_per_group: 'Each group is approximately normal',
  normality_of_diffs:  'Paired differences are approximately normal',
  equal_variances:     'Group variances are similar',
  sample_size_t:       'Sample size adequate for t-test (n ≥ 15 / group)',
  sample_size_anova:   'Sample size adequate for ANOVA (n ≥ 10 / group)',
  independence:        'Observations are independent (no autocorrelation)',
};

// Run prereq checks. Each returns {status: 'pass'|'warn'|'fail', detail: string}
async function runAssumptionChecks(checks, datasetId, projectId, params) {
  const results = [];
  for (const check of checks) {
    try {
      results.push(await runCheck(check, datasetId, projectId, params));
    } catch (e) {
      results.push({ check, status: 'warn', detail: 'Could not verify' });
    }
  }
  return results;
}

async function runCheck(check, datasetId, projectId, params) {
  if (check === 'normality') {
    const r = await api.post(`/api/projects/${projectId}/analyses/run-sync`, {
      kind: 'hypothesis_test',
      datasetId,
      params: { test: 'anderson_darling_normality', column: params.column },
    });
    const p = r?.summary?.p_approx;
    if (p == null) return { check, status: 'warn', detail: 'Could not run AD test' };
    if (p > 0.10) return { check, status: 'pass', detail: `AD p=${p.toFixed(3)}` };
    if (p > 0.01) return { check, status: 'warn', detail: `AD p=${p.toFixed(3)} — borderline` };
    return { check, status: 'fail', detail: `AD p=${p.toFixed(3)} — non-normal` };
  }
  if (check === 'equal_variances') {
    const r = await api.post(`/api/projects/${projectId}/analyses/run-sync`, {
      kind: 'hypothesis_test',
      datasetId,
      params: { test: 'levene', column: params.column, group_col: params.group_col },
    });
    const p = r?.summary?.p;
    if (p == null) return { check, status: 'warn', detail: 'Could not run Levene' };
    if (p > 0.10) return { check, status: 'pass', detail: `Levene p=${p.toFixed(3)}` };
    if (p > 0.01) return { check, status: 'warn', detail: `Levene p=${p.toFixed(3)} — borderline` };
    return { check, status: 'fail', detail: `Levene p=${p.toFixed(3)} — unequal variances` };
  }
  if (check === 'sample_size_t' || check === 'sample_size_anova') {
    const minN = check === 'sample_size_t' ? 15 : 10;
    const ds = await api.get(`/api/projects/${projectId}/datasets/${datasetId}`);
    const n = ds?.dataset?.row_count || 0;
    if (n >= minN * 2) return { check, status: 'pass', detail: `n=${n}` };
    if (n >= minN) return { check, status: 'warn', detail: `n=${n} — minimum met` };
    return { check, status: 'fail', detail: `n=${n} — too small` };
  }
  return { check, status: 'warn', detail: '' };
}

function renderTrafficLights(results) {
  const card = h('div', { className: 'card', style: 'border-left:3px solid var(--accent)' },
    h('h3', { style: 'margin:0 0 10px;font-size:14px' }, 'Pre-flight check'));
  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
    const color = r.status === 'pass' ? 'var(--success)' : r.status === 'warn' ? 'var(--warn)' : 'var(--danger)';
    card.append(h('div', { style: `display:flex;gap:10px;padding:5px 0;align-items:flex-start;font-size:13px` },
      h('span', { style: `color:${color};font-weight:700;width:14px` }, icon),
      h('div', { style: 'flex:1' },
        h('div', {}, ASSUMPTION_LABELS[r.check] || r.check),
        r.detail ? h('div', { className: 'muted', style: 'font-size:11px' }, r.detail) : null,
      ),
    ));
  }
  return card;
}

// ───────── Plain-English query parser ─────────
//
// Pattern matching, no LLM. Recognises the verb + the kind + the column.
// Conservative: returns null if it can't parse confidently. Caller falls
// back to the form.

const QUERY_PATTERNS = [
  // capability on X
  { rx: /(?:run\s+)?(?:capability|cpk|process\s+capability)\s+(?:on|of|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'capability', column: m[1].trim() }) },
  // i-mr / control chart on X
  { rx: /(?:i-?mr|control\s+chart|spc)\s+(?:on|of|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'control_chart', chart_kind: 'I-MR', column: m[1].trim() }) },
  // x-bar chart
  { rx: /(?:x-?bar|xbar)\s+(?:on|of|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'control_chart', chart_kind: 'X-bar/R', column: m[1].trim() }) },
  // compare X between Y / vs / by
  { rx: /(?:compare|test)\s+(.+?)\s+(?:between|vs|by|across)\s+(.+)/i,
    out: (m) => ({ kind: 'hypothesis_test', test: 'two_sample_t',
                   column: m[1].trim(), group_col: m[2].trim() }) },
  // is X different by Y / does X differ by Y
  { rx: /(?:is|does)\s+(.+?)\s+(?:differ|different)\s+(?:by|across|between|in)\s+(.+)/i,
    out: (m) => ({ kind: 'hypothesis_test', test: 'one_way_anova',
                   column: m[1].trim(), group_col: m[2].trim() }) },
  // pareto on X
  { rx: /(?:run\s+)?pareto\s+(?:on|of|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'pareto', column: m[1].trim() }) },
  // gauge r&r / msa on X
  { rx: /(?:gauge\s*r[&\s]*r|msa)\s+(?:on|of|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'msa', column: m[1].trim() }) },
  // regression of Y on X1 X2 ...
  { rx: /(?:regress(?:ion)?)\s+(.+?)\s+(?:on|with|using|by)\s+(.+)/i,
    out: (m) => ({ kind: 'regression', response: m[1].trim(),
                   predictors: m[2].split(/[,\s]+and\s+|\s*,\s*|\s+/).filter(Boolean) }) },
  // fishbone / 5 whys / root cause
  { rx: /(?:fishbone|ishikawa|6m)/i,
    out: () => ({ kind: 'fishbone' }) },
  { rx: /(?:5\s*whys?|five\s+whys?)/i,
    out: () => ({ kind: 'five_whys' }) },
  // weibull / reliability
  { rx: /(?:weibull|reliability|mtbf|b10)\s+(?:on|of|for)?\s*(.+)?/i,
    out: (m) => ({ kind: 'reliability', distribution: 'weibull', time_col: m[1]?.trim() }) },
  // power / sample size for X
  { rx: /(?:sample\s*size|power)\s+(?:for|to)\s+(?:detect)?\s*(.+)?/i,
    out: () => ({ kind: 'sample_size' }) },
  // distribution id / what shape
  { rx: /(?:what\s*shape|distribution\s*id|fit\s*distribution)\s+(?:of|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'distribution_id', column: m[1].trim() }) },
];

function parseQuery(q) {
  q = (q || '').trim();
  if (!q) return null;
  for (const { rx, out } of QUERY_PATTERNS) {
    const m = q.match(rx);
    if (m) return out(m);
  }
  return null;
}

// ───────── "What's next?" recommendations per analysis result ─────────
//
// Pure rules — no LLM. Each entry is a function that takes the analysis
// summary and returns 0..N {label, hint, run} suggestions. `run` is the
// click handler that the caller binds (it knows projectId + datasetId).

const NEXT_ANALYSIS = {
  capability: (s) => {
    const out = [];
    const cpk = s?.cpk;
    if (cpk != null && cpk < 1.33) {
      out.push({ label: 'Run Gauge R&R',
        hint: 'Cpk below 1.33 may be measurement noise — verify the gauge before tearing the process apart.',
        analysis: { kind: 'msa' } });
      out.push({ label: 'Run X-bar/R chart',
        hint: 'Check whether the process is even stable before drawing capability conclusions.',
        analysis: { kind: 'control_chart', params: { kind: 'X-bar/R' } } });
    }
    if (s?.shapiro?.p < 0.05) {
      out.push({ label: 'Run Distribution ID',
        hint: 'Shapiro-Wilk failed normality. Pick the right distribution before re-running capability.',
        analysis: { kind: 'distribution_id' } });
      out.push({ label: 'Re-run with Box-Cox transform',
        hint: 'Recompute Cpk in transformed space when raw data are non-normal.',
        analysis: { kind: 'capability', params: { transform: 'box-cox' } } });
    }
    if (cpk != null && cpk >= 1.33) {
      out.push({ label: 'Set up an SPC monitor',
        hint: 'Capability is good — keep it that way. Schedule a control chart to alert on drift.',
        analysis: { kind: 'monitor', params: { chart_kind: 'I-MR' } } });
    }
    return out;
  },
  hypothesis_test: (s) => {
    const out = [];
    if (s?.test === 'one_way_anova' && s?.p < 0.05) {
      out.push({ label: 'Run Tukey HSD post-hoc',
        hint: 'ANOVA tells you they differ. Tukey tells you which pairs.',
        analysis: { kind: 'posthoc', params: { test: 'tukey_hsd' } } });
    }
    if (s?.test === 'two_sample_t' && s?.p > 0.05) {
      out.push({ label: 'Run an equivalence test (TOST)',
        hint: 'A non-significant t-test does not prove equivalence. TOST does.',
        analysis: { kind: 'hypothesis_test', params: { test: 'tost_two_sample' } } });
    }
    if (s?.test === 'levene' && s?.p < 0.05) {
      out.push({ label: 'Use Welch\'s t-test instead',
        hint: 'Variances differ. Welch handles unequal variance.',
        analysis: { kind: 'hypothesis_test', params: { test: 'two_sample_t', equal_var: false } } });
    }
    return out;
  },
  control_chart: (s) => {
    const out = [];
    const totalViolations = (s?.violations?.length || 0)
      + (s?.we_rules ? Object.values(s.we_rules).reduce((a, v) => a + (v?.length || 0), 0) : 0);
    if (totalViolations > 0) {
      out.push({ label: 'Run Auto-RCA',
        hint: 'Process is not in control. Cluster the defect log to find vital-few causes.',
        analysis: { kind: 'auto_rca' } });
      out.push({ label: 'Run Pareto on cause categories',
        hint: 'Where are the violations concentrated?',
        analysis: { kind: 'pareto' } });
    }
    if (totalViolations === 0) {
      out.push({ label: 'Now run capability',
        hint: 'Process is stable. Capability becomes meaningful.',
        analysis: { kind: 'capability' } });
    }
    if (s?.kind === 'I-MR' || s?.kind === 'X-bar/R') {
      out.push({ label: 'Run CUSUM',
        hint: 'Catches small persistent shifts that I-MR can miss.',
        analysis: { kind: 'control_chart', params: { kind: 'CUSUM' } } });
    }
    return out;
  },
  msa: (s) => {
    const out = [];
    const totalRR = s?.gauge_rr_pct ?? s?.percent_study_var;
    if (totalRR != null && totalRR > 30) {
      out.push({ label: 'Improve the gauge first',
        hint: '%R&R > 30% means the measurement system is unfit. Investigate calibration / operator training before any process work.',
        analysis: null });
    } else if (totalRR != null && totalRR < 10) {
      out.push({ label: 'Now run capability',
        hint: 'Gauge is acceptable (<10%). Capability indices are trustworthy.',
        analysis: { kind: 'capability' } });
    }
    return out;
  },
  regression: (s) => {
    const out = [];
    if (s?.adj_r2 != null && s.adj_r2 < 0.4) {
      out.push({ label: 'Try best-subsets regression',
        hint: 'Low adjusted R² — maybe missing predictors or wrong subset. Best-subsets sweeps options.',
        analysis: { kind: 'best_subsets' } });
    }
    if (s?.f_p != null && s.f_p < 0.05) {
      out.push({ label: 'Plot residuals to check linearity',
        hint: 'F-test passed; verify linear assumption with residual scatter.',
        analysis: { kind: 'graph', params: { chart: 'scatter' } } });
    }
    return out;
  },
  pareto: (s) => {
    const out = [];
    if (s?.vital_few?.length) {
      out.push({ label: 'Run Auto-RCA on the vital few',
        hint: 'Cluster top categories by underlying mechanism to find shared root causes.',
        analysis: { kind: 'auto_rca' } });
      out.push({ label: 'Run a fishbone',
        hint: 'Brainstorm causes for the top category before measuring.',
        analysis: { kind: 'fishbone' } });
    }
    return out;
  },
  reliability: (s) => {
    const out = [];
    if (s?.shape_beta != null) {
      const b = s.shape_beta;
      if (b < 0.9) out.push({ label: 'Investigate infant mortality',
        hint: `β=${b.toFixed(2)} suggests early-life failures. Check incoming-quality + burn-in.`, analysis: null });
      else if (b > 1.5) out.push({ label: 'Investigate wear-out',
        hint: `β=${b.toFixed(2)} suggests wear-out. Plan preventive replacement before B10 life.`, analysis: null });
    }
    return out;
  },
  distribution_id: (s) => {
    const out = [];
    if (s?.best_fit && s.best_fit !== 'normal') {
      out.push({ label: `Re-run capability assuming ${s.best_fit}`,
        hint: `Best fit was ${s.best_fit}. Capability indices computed under the wrong distribution lie.`,
        analysis: { kind: 'capability', params: { transform: 'box-cox' } } });
    }
    return out;
  },
};

function renderNextSteps(analysisKind, summary, onRun) {
  const fn = NEXT_ANALYSIS[analysisKind];
  if (!fn) return null;
  const suggestions = fn(summary) || [];
  if (!suggestions.length) return null;
  const card = h('div', { className: 'card', style: 'background:var(--accent-bg);border-color:rgba(37,99,235,0.2)' },
    h('h3', { style: 'margin:0 0 8px;font-size:14px;color:var(--accent-2)' }, "What's next?"));
  for (const s of suggestions) {
    card.append(h('div', { style: 'padding:8px 0;border-bottom:1px solid rgba(37,99,235,0.1);font-size:13px;line-height:1.5' },
      h('div', { className: 'row' },
        h('div', { style: 'flex:1' },
          h('strong', {}, s.label),
          h('div', { className: 'muted', style: 'font-size:12px;margin-top:2px' }, s.hint)),
        s.analysis ? h('button', { className: 'secondary', style: 'font-size:12px;padding:4px 10px',
          onclick: () => onRun?.(s.analysis) }, 'Run →') : null,
      ),
    ));
  }
  return card;
}

// ───────── Rule-based action plan for analyses (free-tier) ─────────
//
// AI-generated action plans are gated to paid tier. Free-tier users get
// rule-based action plans here — same shape (action / owner / effort /
// impact / priority / rationale), generated from the result summary
// using LSS heuristics. This is what makes the free engine USEFUL and
// not just feature-checked.

const ACTION_RULES = {
  capability: (s) => {
    const out = [];
    const cpk = s?.cpk;
    if (cpk != null && cpk < 1.0) {
      out.push({ priority: 1, action: 'Verify the measurement system (Gauge R&R)',
        effort: 'low', impact: 'high', owner: '[needs input]',
        rationale: `Cpk=${cpk.toFixed(2)}. Before redesigning the process, confirm the gauge isn't inflating the apparent variation.` });
      out.push({ priority: 2, action: 'Stabilize the process (control chart + reduce special-cause variation)',
        effort: 'medium', impact: 'high', owner: '[needs input]',
        rationale: 'Capability indices are only meaningful when the process is in statistical control.' });
      out.push({ priority: 3, action: 'Reduce common-cause variation (DOE on suspected factors)',
        effort: 'high', impact: 'high', owner: '[needs input]',
        rationale: 'Once stable, identify and reduce the dominant variance contributors.' });
    } else if (cpk != null && cpk < 1.33) {
      out.push({ priority: 1, action: 'Center the process if mean is off-target',
        effort: 'low', impact: 'medium', owner: '[needs input]',
        rationale: `Cpk=${cpk.toFixed(2)}. Off-centering may cost ~0.2 of capability index — easy win.` });
      out.push({ priority: 2, action: 'Set up an SPC monitor on this characteristic',
        effort: 'low', impact: 'medium', owner: '[needs input]',
        rationale: 'Marginally capable. Detect drift before it becomes a non-conformance.' });
    } else if (cpk != null && cpk >= 1.33) {
      out.push({ priority: 1, action: 'Document the current state and lock controls',
        effort: 'low', impact: 'medium', owner: '[needs input]',
        rationale: `Cpk=${cpk.toFixed(2)} — capable. Hand off to Control phase with a control plan.` });
    }
    return out;
  },
  control_chart: (s) => {
    const out = [];
    const r1 = s?.we_rules?.rule_1?.length || 0;
    const r2 = s?.we_rules?.rule_2?.length || 0;
    const r3 = s?.we_rules?.rule_3?.length || 0;
    if (r1 > 0) out.push({ priority: 1, action: 'Investigate out-of-control points (rule-1 violations)',
      effort: 'low', impact: 'high', owner: '[needs input]',
      rationale: `${r1} point(s) beyond ±3σ. Each is a special cause — investigate while the trail is fresh.` });
    if (r2 > 0) out.push({ priority: 2, action: 'Investigate sustained shift (rule-2 violation)',
      effort: 'medium', impact: 'high', owner: '[needs input]',
      rationale: `${r2} run(s) of 9 same-side points indicate a process shift.` });
    if (r3 > 0) out.push({ priority: 2, action: 'Investigate trend (rule-3 violation)',
      effort: 'medium', impact: 'high', owner: '[needs input]',
      rationale: `${r3} run(s) of 6 monotone points — tool wear, drift, or warm-up effect.` });
    return out;
  },
  pareto: (s) => {
    const out = [];
    if (s?.vital_few?.length) {
      out.push({ priority: 1, action: `Tackle the vital few first: ${s.vital_few.slice(0, 3).join(', ')}`,
        effort: 'medium', impact: 'high', owner: '[needs input]',
        rationale: `Top categories account for ≥80% of defects. 80/20 rule.` });
    }
    return out;
  },
  msa: (s) => {
    const out = [];
    const rr = s?.gauge_rr_pct ?? s?.percent_study_var;
    if (rr != null && rr > 30) {
      out.push({ priority: 1, action: 'Replace or recalibrate the gauge',
        effort: 'medium', impact: 'high', owner: '[needs input]',
        rationale: `%R&R=${rr.toFixed(1)}% — measurement system is unfit (>30%).` });
    } else if (rr != null && rr > 10) {
      out.push({ priority: 1, action: 'Improve operator training and standardize the procedure',
        effort: 'low', impact: 'medium', owner: '[needs input]',
        rationale: `%R&R=${rr.toFixed(1)}% — marginally acceptable (10-30%).` });
    }
    return out;
  },
  hypothesis_test: (s) => {
    const out = [];
    if (s?.p != null && s.p < 0.05) {
      out.push({ priority: 1, action: 'Validate the difference is operationally meaningful',
        effort: 'low', impact: 'medium', owner: '[needs input]',
        rationale: `Statistical p=${s.p.toFixed(3)} < 0.05. Statistical ≠ operational. Confirm the magnitude matters.` });
    }
    return out;
  },
  reliability: (s) => {
    const out = [];
    const beta = s?.shape_beta;
    const b10 = s?.B10_life;
    if (beta != null && beta < 0.9) out.push({ priority: 1, action: 'Investigate infant mortality',
      effort: 'medium', impact: 'high', owner: '[needs input]',
      rationale: `β=${beta.toFixed(2)} — decreasing hazard. Check incoming-quality and assembly defects.` });
    else if (beta != null && beta > 1.5) out.push({ priority: 1, action: 'Plan preventive replacement before B10 life',
      effort: 'low', impact: 'high', owner: '[needs input]',
      rationale: `β=${beta.toFixed(2)} — wear-out. B10=${b10?.toFixed?.(1)}. Replace before then to avoid customer impact.` });
    return out;
  },
};

function renderActionPlanFree(analysisKind, summary) {
  const fn = ACTION_RULES[analysisKind];
  if (!fn) return null;
  const items = fn(summary);
  if (!items?.length) return null;
  const card = h('div', { className: 'card', style: 'border-left:3px solid var(--success)' },
    h('h3', { style: 'margin:0 0 4px;font-size:14px' }, 'Suggested action plan'),
    h('div', { className: 'muted', style: 'font-size:12px;margin-bottom:10px' },
      'Rule-based recommendations from LSS heuristics. Solo+ adds AI-tailored plans grounded in your project context.'),
  );
  items.sort((a, b) => a.priority - b.priority);
  for (const it of items) {
    card.append(h('div', { style: 'padding:8px 0;border-bottom:1px solid var(--line-2);font-size:13px;line-height:1.55' },
      h('div', { className: 'row' },
        h('span', { className: 'pill accent', style: 'font-size:10px' }, `P${it.priority}`),
        h('strong', { style: 'flex:1' }, it.action),
        h('span', { className: 'muted', style: 'font-size:11px' },
          `effort ${it.effort} · impact ${it.impact}`),
      ),
      h('div', { className: 'muted', style: 'font-size:12px;margin-top:4px' },
        h('em', {}, 'Why: '), it.rationale),
    ));
  }
  return card;
}

// ───────── Vanilla SVG charts ─────────
//
// Built on a shared interactive frame: hover crosshair + tooltip,
// click-to-annotate, brush-to-zoom (double-click resets), per-overlay
// toggles, and SVG/PNG export. No library bundle.

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
}

// Fallback card rendered when a chart has no usable input. Keeps the
// surrounding layout (metrics strip, narrative, etc.) from collapsing or
// throwing — and gives the user a hint instead of a broken SVG.
function emptyChartCard(msg) {
  return h('div', { className: 'chart-wrap chart-empty' },
    h('div', { className: 'muted', style: 'padding:28px 18px;text-align:center;font-style:italic;font-size:13px' }, msg || 'No data to chart.'),
  );
}

function fmtNum(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

function niceTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const range = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(range / count)));
  const err = (count / range) * step0;
  let factor = 1;
  if (err <= 0.15) factor = 10;
  else if (err <= 0.35) factor = 5;
  else if (err <= 0.75) factor = 2;
  const tick = step0 * factor;
  const start = Math.ceil(min / tick) * tick;
  const out = [];
  for (let v = start; v <= max + tick * 1e-9; v += tick) out.push(Number(v.toFixed(10)));
  return out;
}

function exportSvgEl(rootEl, filename, format) {
  const clone = rootEl.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  (function walk(c, o) {
    if (!c || c.nodeType !== 1 || !o) return;
    const cs = getComputedStyle(o);
    for (const p of ['fill', 'stroke', 'opacity', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-family']) {
      const v = cs.getPropertyValue(p);
      if (v && v.trim() && v !== 'none' && !c.getAttribute(p)) c.setAttribute(p, v.trim());
    }
    const cc = c.childNodes, oc = o.childNodes;
    for (let i = 0; i < cc.length && i < oc.length; i++) walk(cc[i], oc[i]);
  })(clone, rootEl);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const vb = (rootEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  const w = vb[2] || 720, hgt = vb[3] || 240;
  if (format === 'png') {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale; canvas.height = hgt * scale;
      const ctx = canvas.getContext('2d');
      const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fff';
      ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `${filename}.png`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); URL.revokeObjectURL(url); }, 100);
      }, 'image/png');
    };
    img.src = url;
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${filename}.svg`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
}

// Generic interactive chart frame.
function renderInteractiveChart(spec) {
  const W = spec.width, H = spec.height;
  const wrap = h('div', { className: 'chart-wrap', 'data-kind': spec.kind || '' });
  if (spec.title) wrap.append(h('div', { className: 'chart-title' }, spec.title));
  const ctrl = h('div', { className: 'chart-controls' });
  const toggleState = {};
  for (const ov of (spec.overlays || [])) {
    toggleState[ov.id] = ov.defaultOn !== false;
    const chip = h('button', {
      type: 'button',
      className: 'chart-chip' + (toggleState[ov.id] ? ' on' : ''),
    }, ov.label);
    chip.addEventListener('click', () => {
      toggleState[ov.id] = !toggleState[ov.id];
      chip.classList.toggle('on', toggleState[ov.id]);
      redraw();
    });
    ctrl.append(chip);
  }
  ctrl.append(h('span', { style: 'flex:1' }));
  if (spec.brushable !== false) {
    ctrl.append(h('span', { className: 'chart-hint' }, 'drag to zoom · dbl-click resets · click to annotate'));
  } else if (spec.points?.length) {
    ctrl.append(h('span', { className: 'chart-hint' }, 'click point to annotate'));
  }
  const fname = (spec.kind || 'chart');
  const btnSvg = h('button', { type: 'button', className: 'chart-chip', title: 'Download SVG' }, '↓ SVG');
  const btnPng = h('button', { type: 'button', className: 'chart-chip', title: 'Download PNG' }, '↓ PNG');
  btnSvg.addEventListener('click', () => exportSvgEl(svgRoot, fname, 'svg'));
  btnPng.addEventListener('click', () => exportSvgEl(svgRoot, fname, 'png'));
  ctrl.append(btnSvg, btnPng);
  wrap.append(ctrl);

  const host = h('div', { className: 'chart-host' });
  const svgRoot = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'chart',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const tooltip = h('div', { className: 'chart-tooltip' });
  tooltip.style.display = 'none';
  host.append(svgRoot, tooltip);
  wrap.append(host);
  const annoList = h('div', { className: 'chart-annotations' });
  wrap.append(annoList);

  const annotations = [];
  let view = { xMin: spec.xRange[0], xMax: spec.xRange[1], yMin: spec.yRange[0], yMax: spec.yRange[1] };
  let cache = null;
  const cross = {};

  function makeScales() {
    const pad = spec.pad;
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const xS = (x) => pad.l + (x - view.xMin) / (view.xMax - view.xMin || 1) * plotW;
    const yS = (y) => pad.t + (1 - (y - view.yMin) / (view.yMax - view.yMin || 1)) * plotH;
    const xI = (px) => view.xMin + (px - pad.l) / plotW * (view.xMax - view.xMin);
    const yI = (py) => view.yMin + (1 - (py - pad.t) / plotH) * (view.yMax - view.yMin);
    return { xS, yS, xI, yI, plot: { x: pad.l, y: pad.t, w: plotW, h: plotH } };
  }

  function redraw() {
    while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);
    const s = makeScales();
    cache = s;
    svgRoot.append(svg('rect', { x: s.plot.x, y: s.plot.y, width: s.plot.w, height: s.plot.h,
      fill: 'none', stroke: 'var(--line-2, var(--line))', 'stroke-width': 0.5 }));
    if (spec.showAxes !== false) {
      for (const t of niceTicks(view.yMin, view.yMax, 5)) {
        const y = s.yS(t);
        svgRoot.append(svg('line', { x1: s.plot.x - 3, x2: s.plot.x, y1: y, y2: y, stroke: 'var(--muted)', 'stroke-width': 0.5 }));
        svgRoot.append(svg('text', { x: s.plot.x - 5, y: y + 3, 'font-size': 10,
          'text-anchor': 'end', fill: 'var(--muted)' }, (spec.formatY || fmtNum)(t)));
      }
      if (spec.xLabels) {
        spec.xLabels.forEach((lbl, i) => {
          if (!lbl) return;
          const x = s.xS(i + 1);
          svgRoot.append(svg('text', { x, y: s.plot.y + s.plot.h + 14, 'font-size': 10,
            'text-anchor': 'middle', fill: 'var(--muted)',
            transform: lbl.length > 8 ? `rotate(-30 ${x} ${s.plot.y + s.plot.h + 14})` : null,
          }, lbl.length > 14 ? lbl.slice(0, 14) + '…' : lbl));
        });
      } else {
        for (const t of niceTicks(view.xMin, view.xMax, 6)) {
          const x = s.xS(t);
          svgRoot.append(svg('line', { x1: x, x2: x, y1: s.plot.y + s.plot.h, y2: s.plot.y + s.plot.h + 3, stroke: 'var(--muted)', 'stroke-width': 0.5 }));
          svgRoot.append(svg('text', { x, y: s.plot.y + s.plot.h + 14, 'font-size': 10,
            'text-anchor': 'middle', fill: 'var(--muted)' }, (spec.formatX || fmtNum)(t)));
        }
      }
    }
    for (const ov of (spec.overlays || [])) {
      if (!toggleState[ov.id]) continue;
      const g = svg('g', { 'data-overlay': ov.id });
      ov.build(g, { xScale: s.xS, yScale: s.yS, plot: s.plot, view });
      svgRoot.append(g);
    }
    if (spec.draw) spec.draw(svgRoot, { xScale: s.xS, yScale: s.yS, plot: s.plot, view });
    for (const a of annotations) {
      if (a.x < view.xMin || a.x > view.xMax) continue;
      const ax = s.xS(a.x);
      const ay = a.y != null ? s.yS(a.y) : (s.plot.y + 12);
      svgRoot.append(svg('circle', { cx: ax, cy: ay, r: 5, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5 }));
      svgRoot.append(svg('text', { x: ax + 8, y: ay - 6, 'font-size': 10, fill: 'var(--accent)', 'font-style': 'italic' }, a.note));
    }
    cross.h = svg('line', { x1: 0, y1: s.plot.y, x2: 0, y2: s.plot.y + s.plot.h, stroke: 'var(--accent)', 'stroke-width': 0.5, 'stroke-dasharray': '2 2', visibility: 'hidden', 'pointer-events': 'none' });
    cross.v = svg('line', { x1: s.plot.x, y1: 0, x2: s.plot.x + s.plot.w, y2: 0, stroke: 'var(--accent)', 'stroke-width': 0.5, 'stroke-dasharray': '2 2', visibility: 'hidden', 'pointer-events': 'none' });
    cross.dot = svg('circle', { r: 4, fill: 'var(--accent)', visibility: 'hidden', 'pointer-events': 'none' });
    cross.brush = svg('rect', { fill: 'var(--accent)', opacity: 0.12, stroke: 'var(--accent)', 'stroke-dasharray': '2 2', 'stroke-width': 0.5, visibility: 'hidden', 'pointer-events': 'none' });
    svgRoot.append(cross.h, cross.v, cross.dot, cross.brush);
  }

  function evtToData(evt) {
    const rect = svgRoot.getBoundingClientRect();
    const sx = (evt.clientX - rect.left) / rect.width * W;
    const sy = (evt.clientY - rect.top) / rect.height * H;
    const inPlot = sx >= cache.plot.x && sx <= cache.plot.x + cache.plot.w
                && sy >= cache.plot.y && sy <= cache.plot.y + cache.plot.h;
    return { sx, sy, inPlot, dx: cache.xI(sx), dy: cache.yI(sy) };
  }

  function nearestPoint(sx, sy) {
    if (!spec.points?.length) return null;
    let best = null, bestD = Infinity;
    for (const p of spec.points) {
      if (p.x < view.xMin || p.x > view.xMax) continue;
      const px = cache.xS(p.x), py = cache.yS(p.y);
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return bestD < 900 ? best : null;
  }

  let drag = null;
  let lastDragged = false;

  svgRoot.addEventListener('mousemove', (e) => {
    if (!cache) return;
    const m = evtToData(e);
    if (drag) {
      const x = Math.min(drag.sx, m.sx), x2 = Math.max(drag.sx, m.sx);
      cross.brush.setAttribute('x', Math.max(cache.plot.x, x));
      cross.brush.setAttribute('y', cache.plot.y);
      cross.brush.setAttribute('width', Math.min(cache.plot.x + cache.plot.w, x2) - Math.max(cache.plot.x, x));
      cross.brush.setAttribute('height', cache.plot.h);
      cross.brush.setAttribute('visibility', 'visible');
      if (Math.abs(m.sx - drag.sx) > 4) drag.dragged = true;
      return;
    }
    if (!m.inPlot) { hideHover(); return; }
    const near = nearestPoint(m.sx, m.sy);
    if (near) showHover(near);
    else hideHover();
  });
  svgRoot.addEventListener('mouseleave', () => { if (!drag) hideHover(); });

  function showHover(p) {
    const px = cache.xS(p.x), py = cache.yS(p.y);
    cross.h.setAttribute('x1', px); cross.h.setAttribute('x2', px);
    cross.v.setAttribute('y1', py); cross.v.setAttribute('y2', py);
    cross.dot.setAttribute('cx', px); cross.dot.setAttribute('cy', py);
    cross.h.setAttribute('visibility', 'visible');
    cross.v.setAttribute('visibility', 'visible');
    cross.dot.setAttribute('visibility', 'visible');
    const lines = [];
    if (p.label) lines.push(p.label);
    lines.push(`${spec.xLabel || 'x'}: ${spec.xLabels ? (spec.xLabels[p.i] || '—') : (spec.formatX || fmtNum)(p.x)}`);
    lines.push(`${spec.yLabel || 'y'}: ${(spec.formatY || fmtNum)(p.y)}`);
    if (p.meta) for (const [k, v] of Object.entries(p.meta)) lines.push(`${k}: ${v}`);
    tooltip.innerHTML = lines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    tooltip.style.display = 'block';
    const rect = svgRoot.getBoundingClientRect();
    const pxScreen = (px / W) * rect.width;
    const pyScreen = (py / H) * rect.height;
    // Default: tooltip above point. Flip below if it would clip the top,
    // and clamp to bottom if it would overflow the chart-host bottom.
    let tipLeft = pxScreen + 12;
    let tipTop  = pyScreen - tooltip.offsetHeight - 8;
    if (tipTop < 4) tipTop = pyScreen + 16;                                 // flip below
    if (tipTop + tooltip.offsetHeight > rect.height - 4)                    // bottom clamp
      tipTop = rect.height - tooltip.offsetHeight - 4;
    if (tipLeft + tooltip.offsetWidth > rect.width - 4)                     // right clamp
      tipLeft = pxScreen - tooltip.offsetWidth - 12;                        //   place left of point
    if (tipLeft < 4) tipLeft = 4;                                           // left clamp
    if (tipTop  < 4) tipTop  = 4;                                           // top safety
    tooltip.style.left = `${tipLeft}px`;
    tooltip.style.top  = `${tipTop}px`;
  }
  function hideHover() {
    cross.h?.setAttribute('visibility', 'hidden');
    cross.v?.setAttribute('visibility', 'hidden');
    cross.dot?.setAttribute('visibility', 'hidden');
    tooltip.style.display = 'none';
  }

  svgRoot.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || spec.brushable === false) return;
    const m = evtToData(e);
    if (!m.inPlot) return;
    drag = { ...m, dragged: false };
    e.preventDefault();
  });

  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const m = evtToData(e);
    if (drag.dragged && Math.abs(m.sx - drag.sx) > 4) {
      const a = Math.min(drag.dx, m.dx), b = Math.max(drag.dx, m.dx);
      view = { ...view, xMin: a, xMax: b };
      redraw();
      lastDragged = true;
    }
    cross.brush?.setAttribute('visibility', 'hidden');
    drag = null;
  }, true);

  svgRoot.addEventListener('click', (e) => {
    if (lastDragged) { lastDragged = false; return; }
    if (!cache) return;
    const m = evtToData(e);
    if (!m.inPlot) return;
    const near = nearestPoint(m.sx, m.sy);
    if (near) promptAnnotation(near);
  });

  svgRoot.addEventListener('dblclick', () => {
    view = { xMin: spec.xRange[0], xMax: spec.xRange[1], yMin: spec.yRange[0], yMax: spec.yRange[1] };
    redraw();
  });

  function promptAnnotation(point) {
    host.querySelectorAll('.chart-anno-pop').forEach(p => p.remove());
    const pop = h('div', { className: 'chart-anno-pop' });
    const input = h('input', { type: 'text', placeholder: 'Note (Enter saves, Esc cancels)' });
    const head = h('div', { className: 'chart-anno-pop-head' },
      point.label || `${spec.xLabel || 'x'}=${(spec.formatX || fmtNum)(point.x)}, ${spec.yLabel || 'y'}=${(spec.formatY || fmtNum)(point.y)}`);
    pop.append(head, input);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        annotations.push({ id: Math.random().toString(36).slice(2), x: point.x, y: point.y, i: point.i, note: input.value.trim(), at: Date.now() });
        pop.remove(); redraw(); renderAnnoList();
      } else if (e.key === 'Escape') pop.remove();
    });
    const rect = svgRoot.getBoundingClientRect();
    const px = cache.xS(point.x), py = cache.yS(point.y);
    pop.style.left = `${(px / W) * rect.width + 12}px`;
    pop.style.top = `${(py / H) * rect.height + 12}px`;
    host.append(pop);
    setTimeout(() => input.focus(), 0);
    const dismiss = (ev) => {
      if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss, true); }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
  }

  function renderAnnoList() {
    annoList.innerHTML = '';
    if (!annotations.length) return;
    annoList.append(h('div', { className: 'chart-anno-list-head' }, `Annotations (${annotations.length})`));
    for (const a of annotations) {
      const row = h('div', { className: 'chart-anno-row' });
      const xVal = spec.xLabels ? (spec.xLabels[a.i] || '—') : (spec.formatX || fmtNum)(a.x);
      const del = h('button', { type: 'button', className: 'chart-anno-x', title: 'Remove' }, '×');
      del.addEventListener('click', () => {
        const i = annotations.indexOf(a);
        if (i >= 0) annotations.splice(i, 1);
        redraw(); renderAnnoList();
      });
      row.append(
        h('span', { className: 'mono chart-anno-tag' }, `${spec.xLabel || 'x'}=${xVal}`),
        h('span', { className: 'chart-anno-note' }, a.note),
        del,
      );
      annoList.append(row);
    }
  }

  redraw();
  return wrap;
}

function svgRunChart(values, opts = {}) {
  const w = opts.width || 720, hgt = opts.height || 220;
  if (!Array.isArray(values) || values.length === 0) return emptyChartCard('No data to chart.');
  const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const mn = Math.min(...values), mx = Math.max(...values);
  const range = (mx - mn) || 1;
  return renderInteractiveChart({
    kind: 'run-chart',
    width: w, height: hgt,
    pad: { l: 48, r: 14, t: 12, b: 28 },
    xRange: [1, Math.max(2, values.length)],
    yRange: [mn - range * 0.1, mx + range * 0.1],
    xLabel: 'obs', yLabel: 'value',
    points: values.map((v, i) => ({ i, x: i + 1, y: v, label: `obs ${i + 1}` })),
    overlays: [{
      id: 'median', label: 'Median', defaultOn: true,
      build: (g, { yScale, plot }) => {
        const py = yScale(median);
        g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: py, y2: py,
          stroke: 'var(--muted)', 'stroke-dasharray': '4 4' }));
        g.append(svg('text', { x: plot.x + plot.w - 4, y: py - 4, 'font-size': 10,
          'text-anchor': 'end', fill: 'var(--muted)' }, `median ${fmtNum(median)}`));
      },
    }],
    draw: (root, { xScale, yScale, view }) => {
      const vis = [];
      for (let i = 0; i < values.length; i++) {
        if (i + 1 >= view.xMin && i + 1 <= view.xMax) vis.push(i);
      }
      if (vis.length > 1) {
        const d = vis.map((i, k) => `${k ? 'L' : 'M'} ${xScale(i + 1)} ${yScale(values[i])}`).join(' ');
        root.append(svg('path', { d, stroke: 'var(--ink-2)', 'stroke-width': 1.5, fill: 'none' }));
      }
      for (const i of vis) {
        root.append(svg('circle', { cx: xScale(i + 1), cy: yScale(values[i]), r: 3, fill: 'var(--ink-2)' }));
      }
    },
  });
}

function svgControlChart(values, center, ucl, lcl, opts = {}) {
  const w = opts.width || 720, hgt = opts.height || 240;
  if (!Array.isArray(values) || values.length === 0) return emptyChartCard('No data to chart.');
  if (!Number.isFinite(center) || !Number.isFinite(ucl) || !Number.isFinite(lcl)) {
    return emptyChartCard('Control limits could not be computed.');
  }
  const span = (ucl - lcl) || 1;
  const yMin = Math.min(lcl, ...values) - span * 0.06;
  const yMax = Math.max(ucl, ...values) + span * 0.06;
  const sigma = (ucl - center) / 3;
  return renderInteractiveChart({
    kind: 'control-chart',
    width: w, height: hgt,
    pad: { l: 56, r: 14, t: 12, b: 28 },
    xRange: [1, Math.max(2, values.length)],
    yRange: [yMin, yMax],
    xLabel: 'obs', yLabel: 'value',
    points: values.map((v, i) => {
      const viol = v > ucl || v < lcl;
      return { i, x: i + 1, y: v, label: `obs ${i + 1}`,
        meta: { status: viol ? 'OUT OF CONTROL' : 'in control' } };
    }),
    overlays: [
      { id: 'limits', label: 'Control limits', defaultOn: true,
        build: (g, { yScale, plot }) => {
          for (const [val, lbl, dash, color] of [
            [center, 'CL', null, 'var(--muted)'],
            [ucl, 'UCL', '4 4', 'var(--danger)'],
            [lcl, 'LCL', '4 4', 'var(--danger)'],
          ]) {
            g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yScale(val), y2: yScale(val),
              stroke: color, 'stroke-dasharray': dash, 'stroke-width': 1 }));
            g.append(svg('text', { x: plot.x + plot.w - 4, y: yScale(val) - 3, 'font-size': 10,
              'text-anchor': 'end', fill: color }, `${lbl} ${fmtNum(val)}`));
          }
        },
      },
      { id: 'zones', label: 'σ zones', defaultOn: false,
        build: (g, { yScale, plot }) => {
          for (let k = 1; k <= 2; k++) {
            const yU = yScale(center + k * sigma), yL = yScale(center - k * sigma);
            g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yU, y2: yU,
              stroke: 'var(--muted)', 'stroke-dasharray': '1 4', 'stroke-width': 0.5, opacity: 0.6 }));
            g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yL, y2: yL,
              stroke: 'var(--muted)', 'stroke-dasharray': '1 4', 'stroke-width': 0.5, opacity: 0.6 }));
          }
        },
      },
    ],
    draw: (root, { xScale, yScale, view }) => {
      const vis = [];
      for (let i = 0; i < values.length; i++) {
        if (i + 1 >= view.xMin && i + 1 <= view.xMax) vis.push(i);
      }
      if (vis.length > 1) {
        const d = vis.map((i, k) => `${k ? 'L' : 'M'} ${xScale(i + 1)} ${yScale(values[i])}`).join(' ');
        root.append(svg('path', { d, stroke: 'var(--ink-2)', 'stroke-width': 1.5, fill: 'none' }));
      }
      for (const i of vis) {
        const v = values[i];
        const viol = v > ucl || v < lcl;
        root.append(svg('circle', { cx: xScale(i + 1), cy: yScale(v),
          r: viol ? 5 : 3,
          fill: viol ? 'var(--danger)' : 'var(--ink-2)',
          stroke: viol ? 'var(--bg)' : 'none', 'stroke-width': viol ? 1 : 0 }));
      }
    },
  });
}

function svgHistogram(values, opts = {}) {
  const w = opts.width || 480, hgt = opts.height || 220;
  if (!Array.isArray(values) || values.length === 0) return emptyChartCard('No data to chart.');
  const mn = Math.min(...values), mx = Math.max(...values);
  if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn === mx) {
    return emptyChartCard('Histogram needs values with non-zero range.');
  }
  const nBins = Math.min(20, Math.max(5, Math.round(Math.sqrt(values.length))));
  const binW = (mx - mn) / nBins || 1;
  const counts = new Array(nBins).fill(0);
  for (const v of values) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor((v - mn) / binW)));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  const binCenters = counts.map((c, i) => ({
    i, x: mn + (i + 0.5) * binW, y: c,
    label: `bin ${i + 1}`,
    meta: { range: `[${(mn + i * binW).toFixed(2)}, ${(mn + (i + 1) * binW).toFixed(2)}]`, count: c },
  }));
  // Make sure spec lines + target fall inside the visible plot. The data
  // can be entirely inside the spec band (good!) so the chart's x-range
  // has to expand to include LSL / USL / target with a small margin —
  // otherwise the line lands on or past the right edge and the label gets
  // clipped (which is the "where tf is USL" symptom).
  const specVals = [opts.lsl, opts.usl, opts.target].filter(v => v != null && Number.isFinite(Number(v))).map(Number);
  const xLo = Math.min(mn, ...specVals);
  const xHi = Math.max(mx, ...specVals);
  const xMargin = (xHi - xLo) * 0.04 || 0.5;
  // Place spec-line label inside the plot — left of line if it sits near
  // the right edge, else right of line. Caps the y-position to the plot
  // interior so the label is never on top of the border.
  const drawSpec = (g, x, plot, color, label) => {
    g.append(svg('line', { x1: x, x2: x, y1: plot.y, y2: plot.y + plot.h,
      stroke: color, 'stroke-dasharray': '3 3', 'stroke-width': 1.5 }));
    const nearRight = x > plot.x + plot.w - 60;
    g.append(svg('text', {
      x: nearRight ? x - 4 : x + 4,
      y: plot.y + 12,
      'font-size': 10,
      'text-anchor': nearRight ? 'end' : 'start',
      fill: color,
    }, label));
  };
  const overlays = [];
  if (opts.lsl != null) overlays.push({
    id: 'lsl', label: 'LSL', defaultOn: true,
    build: (g, { xScale, plot }) =>
      drawSpec(g, xScale(opts.lsl), plot, 'var(--danger)', `LSL ${fmtNum(opts.lsl)}`),
  });
  if (opts.usl != null) overlays.push({
    id: 'usl', label: 'USL', defaultOn: true,
    build: (g, { xScale, plot }) =>
      drawSpec(g, xScale(opts.usl), plot, 'var(--danger)', `USL ${fmtNum(opts.usl)}`),
  });
  if (opts.target != null) overlays.push({
    id: 'target', label: 'Target', defaultOn: true,
    build: (g, { xScale, plot }) =>
      drawSpec(g, xScale(opts.target), plot, 'var(--accent)', `Target ${fmtNum(opts.target)}`),
  });
  return renderInteractiveChart({
    kind: 'histogram',
    width: w, height: hgt,
    pad: { l: 44, r: 14, t: 12, b: 28 },
    xRange: [xLo - xMargin, xHi + xMargin],
    yRange: [0, maxCount * 1.12],
    xLabel: 'value', yLabel: 'count',
    points: binCenters,
    overlays,
    draw: (root, { xScale, yScale, plot }) => {
      counts.forEach((c, i) => {
        const x0 = xScale(mn + i * binW);
        const x1 = xScale(mn + (i + 1) * binW);
        const y = yScale(c);
        root.append(svg('rect', { x: x0 + 0.5, y, width: Math.max(0, x1 - x0 - 1),
          height: plot.y + plot.h - y, fill: 'var(--chart-fill)', opacity: 0.75 }));
      });
    },
  });
}

function svgScatter(xs, ys, opts = {}) {
  const w = opts.width || 480, hgt = opts.height || 320;
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length === 0 || xs.length !== ys.length) {
    return emptyChartCard('Scatter needs equal-length x and y arrays.');
  }
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.05 || 1;
  const yPad = (yMax - yMin) * 0.05 || 1;
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sxx = xs.reduce((a, x) => a + x * x, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const intercept = (sy - slope * sx) / n;
  const mx_ = sx / n, my_ = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - my_) ** 2;
    ssRes += (ys[i] - (intercept + slope * xs[i])) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const overlays = [];
  if (opts.fit !== false) overlays.push({
    id: 'fit',
    label: `Fit y=${slope.toFixed(2)}x+${intercept.toFixed(2)} · R²=${r2.toFixed(2)}`,
    defaultOn: true,
    build: (g, { xScale, yScale, view }) => {
      const a = view.xMin, b = view.xMax;
      g.append(svg('line', {
        x1: xScale(a), x2: xScale(b),
        y1: yScale(intercept + slope * a), y2: yScale(intercept + slope * b),
        stroke: 'var(--accent)', 'stroke-dasharray': '4 3', 'stroke-width': 1.5,
      }));
    },
  });
  return renderInteractiveChart({
    kind: 'scatter',
    width: w, height: hgt,
    pad: { l: 48, r: 14, t: 12, b: 30 },
    xRange: [xMin - xPad, xMax + xPad],
    yRange: [yMin - yPad, yMax + yPad],
    xLabel: opts.xLabel || 'x', yLabel: opts.yLabel || 'y',
    points: xs.map((x, i) => ({ i, x, y: ys[i] })),
    overlays,
    draw: (root, { xScale, yScale }) => {
      for (let i = 0; i < xs.length; i++) {
        root.append(svg('circle', { cx: xScale(xs[i]), cy: yScale(ys[i]), r: 3, fill: 'var(--ink-2)', opacity: 0.7 }));
      }
    },
  });
}

function svgBoxplot(values, opts = {}) {
  const w = opts.width || 320, hgt = opts.height || 260;
  if (!Array.isArray(values) || values.length === 0) return emptyChartCard('No data to chart.');
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)];
  const median = sorted[Math.floor(n * 0.5)];
  const iqr = q3 - q1;
  const minV = Math.max(sorted[0], q1 - 1.5 * iqr);
  const maxV = Math.min(sorted[n - 1], q3 + 1.5 * iqr);
  const yMin = Math.min(...values) - iqr * 0.2;
  const yMax = Math.max(...values) + iqr * 0.2;
  const outliers = [];
  values.forEach((v, i) => { if (v < minV || v > maxV) outliers.push({ i, v }); });
  return renderInteractiveChart({
    kind: 'boxplot',
    width: w, height: hgt,
    pad: { l: 44, r: 70, t: 16, b: 28 },
    xRange: [0, 2], yRange: [yMin, yMax],
    xLabel: '', yLabel: 'value', xLabels: ['', ''],
    points: outliers.map(o => ({ i: o.i, x: 1, y: o.v, label: `outlier obs ${o.i + 1}` })),
    brushable: false,
    overlays: [{
      id: 'stats', label: 'Quartile labels', defaultOn: true,
      build: (g, { xScale, yScale, plot }) => {
        const cx = xScale(1);
        const lblX = cx + 38;
        for (const [val, lbl] of [[q3, 'Q3'], [median, 'Md'], [q1, 'Q1']]) {
          g.append(svg('text', { x: lblX, y: yScale(val) + 3, 'font-size': 10, fill: 'var(--muted)' },
            `${lbl} ${fmtNum(val)}`));
        }
      },
    }],
    draw: (root, { xScale, yScale }) => {
      const cx = xScale(1);
      const boxW = 60;
      root.append(svg('line', { x1: cx, x2: cx, y1: yScale(minV), y2: yScale(maxV), stroke: 'var(--ink-2)' }));
      root.append(svg('line', { x1: cx - 10, x2: cx + 10, y1: yScale(minV), y2: yScale(minV), stroke: 'var(--ink-2)' }));
      root.append(svg('line', { x1: cx - 10, x2: cx + 10, y1: yScale(maxV), y2: yScale(maxV), stroke: 'var(--ink-2)' }));
      root.append(svg('rect', { x: cx - boxW / 2, y: yScale(q3), width: boxW, height: yScale(q1) - yScale(q3), fill: 'none', stroke: 'var(--ink-2)' }));
      root.append(svg('line', { x1: cx - boxW / 2, x2: cx + boxW / 2, y1: yScale(median), y2: yScale(median), stroke: 'var(--ink)', 'stroke-width': 2 }));
      for (const o of outliers) {
        root.append(svg('circle', { cx, cy: yScale(o.v), r: 3, fill: 'var(--danger)' }));
      }
    },
  });
}

function svgPareto(categories, counts, opts = {}) {
  const w = opts.width || 720, hgt = opts.height || 300;
  if (!Array.isArray(categories) || !Array.isArray(counts) || categories.length === 0 || categories.length !== counts.length) {
    return emptyChartCard('Pareto needs equal-length categories and counts.');
  }
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const maxCount = Math.max(...counts) || 1;
  const cum = counts.reduce((acc, c, i) => { acc.push((i ? acc[i - 1] : 0) + c); return acc; }, []);
  const cumPct = cum.map(c => c / total);
  return renderInteractiveChart({
    kind: 'pareto',
    width: w, height: hgt,
    pad: { l: 52, r: 52, t: 12, b: 68 },
    xRange: [0.5, categories.length + 0.5],
    yRange: [0, maxCount * 1.08],
    xLabels: categories,
    xLabel: 'category', yLabel: 'count',
    points: counts.map((c, i) => ({
      i, x: i + 1, y: c, label: categories[i],
      meta: { count: c, share: `${(c / total * 100).toFixed(1)}%`, cumulative: `${(cumPct[i] * 100).toFixed(1)}%` },
    })),
    brushable: false,
    overlays: [
      { id: 'cum', label: 'Cumulative %', defaultOn: true,
        build: (g, { xScale, plot }) => {
          const d = cumPct.map((p, i) => {
            const x = xScale(i + 1);
            const y = plot.y + (1 - p) * plot.h;
            return `${i ? 'L' : 'M'} ${x} ${y}`;
          }).join(' ');
          g.append(svg('path', { d, fill: 'none', stroke: 'var(--danger)', 'stroke-width': 1.5 }));
          for (const p of [0, 0.25, 0.5, 0.75, 1.0]) {
            const y = plot.y + (1 - p) * plot.h;
            g.append(svg('text', { x: plot.x + plot.w + 6, y: y + 3,
              'font-size': 10, fill: 'var(--muted)' }, `${(p * 100).toFixed(0)}%`));
          }
        },
      },
      { id: 'eighty', label: '80% line', defaultOn: true,
        build: (g, { plot }) => {
          const y = plot.y + 0.2 * plot.h;
          g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: y, y2: y,
            stroke: 'var(--danger)', 'stroke-dasharray': '3 3', opacity: 0.5 }));
          g.append(svg('text', { x: plot.x + plot.w - 4, y: y - 4, 'font-size': 10, 'text-anchor': 'end', fill: 'var(--danger)' }, '80%'));
        },
      },
    ],
    draw: (root, { xScale, yScale, plot }) => {
      const barSlot = plot.w / categories.length;
      counts.forEach((c, i) => {
        const cx = xScale(i + 1);
        const x = cx - barSlot / 2 + 4;
        const y = yScale(c);
        root.append(svg('rect', { x, y, width: barSlot - 8, height: plot.y + plot.h - y,
          fill: 'var(--chart-fill)', opacity: 0.78 }));
      });
    },
  });
}

function svgFittedLine(xs, ys, opts = {}) {
  const wrap = h('div');
  wrap.append(svgScatter(xs, ys, { ...opts, height: opts.height || 260, fit: true }));
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sxx = xs.reduce((a, x) => a + x * x, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const intercept = (sy - slope * sx) / n;
  const resid = xs.map((x, i) => ys[i] - (intercept + slope * x));
  wrap.append(h('div', { className: 'chart-subhead' }, 'Residuals'));
  wrap.append(svgRunChart(resid, { height: 150 }));
  return wrap;
}

// ───────── Process Health Score (composite gauge) ─────────
//
// Single number per project blending Cpk (40%), control-chart violation
// rate (30%), MSA acceptability (15%), and recent-trend stability (15%).
// Color-coded gauge for the Portfolio + Settings views.

function computeHealthScore(analyses) {
  // analyses is the list of recent analyses with their result_json.summary
  let cpkScore = null, controlScore = null, msaScore = null, trendScore = null;
  for (const a of analyses) {
    const s = a.result_json?.summary || {};
    if (a.kind === 'capability' && s.cpk != null) {
      // Cpk → score 0-100. 1.33 → 80, 2.0 → 100, 0 → 0.
      cpkScore = Math.max(0, Math.min(100, (s.cpk / 2.0) * 100));
    }
    if (a.kind === 'control_chart') {
      const v = (s.violations?.length || 0)
        + (s.we_rules ? Object.values(s.we_rules).reduce((sum, arr) => sum + (arr?.length || 0), 0) : 0);
      const n = s.n_subgroups || s.n || 25;
      const rate = v / n;
      controlScore = Math.max(0, 100 - rate * 200);
    }
    if (a.kind === 'msa') {
      const rr = s.gauge_rr_pct ?? s.percent_study_var;
      if (rr != null) msaScore = Math.max(0, 100 - rr * 2.5); // 30% → 25, 10% → 75
    }
  }
  // Trend: simple — if last analysis is more recent than 14 days, +; else penalize.
  if (analyses.length) {
    const newest = Math.max(...analyses.map(a => new Date(a.created_at).getTime()));
    const days = (Date.now() - newest) / 86400000;
    trendScore = Math.max(0, 100 - days * 4);
  }
  const components = [
    { name: 'Capability',          weight: 0.40, score: cpkScore },
    { name: 'Control / stability', weight: 0.30, score: controlScore },
    { name: 'Measurement system',  weight: 0.15, score: msaScore },
    { name: 'Recency / momentum',  weight: 0.15, score: trendScore },
  ];
  const present = components.filter(c => c.score != null);
  if (!present.length) return { score: null, components };
  const totalWeight = present.reduce((a, b) => a + b.weight, 0);
  const score = present.reduce((a, b) => a + b.score * b.weight, 0) / totalWeight;
  return { score: Math.round(score), components };
}

function renderHealthGauge(health) {
  const score = health.score;
  const color = score == null ? 'var(--muted)'
    : score >= 80 ? 'var(--success)'
    : score >= 60 ? 'var(--warn)'
    : 'var(--danger)';
  const label = score == null ? 'Insufficient data'
    : score >= 80 ? 'Healthy'
    : score >= 60 ? 'Watch'
    : 'At risk';
  const wrap = h('div', { className: 'card', style: 'display:flex;align-items:center;gap:18px' },
    h('div', { style: `width:80px;height:80px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;flex-shrink:0` },
      score != null ? score : '—'),
    h('div', {},
      h('div', { style: 'font-weight:600;font-size:15px' }, 'Process Health'),
      h('div', { className: 'muted', style: 'font-size:12px;margin-bottom:6px' }, label),
      ...health.components.map(c =>
        h('div', { style: 'font-size:11px;color:var(--muted);display:flex;gap:6px' },
          h('span', { style: 'width:120px' }, c.name),
          h('span', { className: 'mono' },
            c.score == null ? '—' : `${Math.round(c.score)}/100`,
            ` · w=${(c.weight * 100).toFixed(0)}%`),
        ),
      ),
    ),
  );
  return wrap;
}

// ───────── Comparator (side-by-side) ─────────

function openComparator(analyses) {
  const overlay = h('div', { className: 'cmdk-overlay' });
  const panel = h('div', { style: 'background:var(--surface);width:96vw;max-width:1400px;height:90vh;border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);display:flex;flex-direction:column' });
  const head = h('div', { style: 'padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center' },
    h('strong', { style: 'flex:1' }, 'Compare analyses (side-by-side)'),
    h('button', { className: 'ghost', onclick: () => overlay.remove() }, 'Close'),
  );
  const body = h('div', { style: 'flex:1;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)' });
  for (const a of analyses.slice(0, 4)) {
    const cell = h('div', { style: 'background:var(--surface);padding:18px;overflow:auto' });
    cell.append(h('div', { className: 'breadcrumb' }, a.kind),
      h('h3', { style: 'margin:0 0 12px' }, KIND_LABEL[a.kind] || a.kind));
    if (a.chart_storage_key) {
      // Load the chart through the same same-origin /artifact proxy the result
      // card uses. (Previously POSTed to /api/projects/:id/storage/presign,
      // which doesn't exist → 404 swallowed → every comparator cell was blank.)
      cell.append(h('img', { className: 'chart',
        src: `/artifact/${a.chart_storage_key}`,
        alt: `${KIND_LABEL[a.kind] || a.kind} chart` }));
    }
    cell.append(h('pre', { style: 'background:var(--surface-2);padding:10px;border-radius:6px;font-size:11.5px;max-height:240px;overflow:auto;margin-top:10px' },
      JSON.stringify(a.result_json?.summary || {}, null, 2)));
    body.append(cell);
  }
  panel.append(head, body);
  overlay.append(panel);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);
}

// ───────── Help ("why this test?") ─────────

const TEST_HELP = {
  one_sample_t: 'Tests whether the mean of one sample equals a known target value. Assumes the data are approximately normal — falls back to the sign test if not.',
  two_sample_t: 'Tests whether the means of two groups differ. Welch by default (no equal-variance assumption). Switches to Mann-Whitney if data are non-normal.',
  paired_t: 'Tests whether the mean difference between paired observations is zero. Use for before/after on the same subjects.',
  one_way_anova: 'Tests whether the means of three or more groups differ. F-test on between- vs within-group variance. Assumes normality + equal variances.',
  mann_whitney: 'Non-parametric two-sample test on medians. Use when t-test assumptions fail.',
  kruskal: 'Non-parametric ANOVA. Use when ANOVA assumptions fail.',
  chi_square: 'Tests whether two categorical variables are associated. Pearson\'s χ² on a contingency table.',
  capability: 'Cp, Cpk, Pp, Ppk plus a histogram with spec lines. Cpk ≥ 1.33 is "capable" by convention; ≥ 1.67 is "highly capable."',
  control_chart_imr: 'Individuals + Moving Range chart. Shows process drift on individual observations (no subgroups).',
  control_chart_xbar_r: 'X-bar/R chart. Plots subgroup means and ranges; standard SPC chart for continuous data with subgroups.',
  control_chart_cusum: 'Cumulative sum chart. Detects small persistent shifts that I-MR misses (e.g. 1σ shifts in mean).',
  control_chart_ewma: 'Exponentially weighted moving average. Like I-MR but recent points weighted more.',
  msa: 'Gauge Repeatability & Reproducibility. %R&R < 10% is acceptable; 10-30% marginal; >30% unfit.',
  reliability: 'Weibull or exponential fit on time-to-failure data, with optional right-censoring. Reports MTBF, B10 life, and reliability at mission times.',
  pareto: 'Bar chart of categories sorted by frequency, with a cumulative line. The "vital few" categories cause ≥80% of effects.',
  fishbone: 'Ishikawa diagram. Brainstorm causes by 6M categories: Manpower, Machine, Method, Material, Measurement, Mother Nature.',
  five_whys: 'Iterative root-cause drill: ask "why?" five times until you reach an actionable system-level cause.',

  // ── Top-level ANALYSIS_KINDS keys. The "About this analysis" button passes
  // the selected kind (e.g. "hypothesis_test", "control_chart"), so every kind
  // needs an entry here or the button has nothing to show. Sub-kind entries
  // above (e.g. one_sample_t) are resolved first when a specific test is picked.
  hypothesis_test: 'Compare means, proportions, variances, or distributions. Pick a specific test (t, ANOVA, chi-square, or a nonparametric one) or let "Pick the right test" choose — Bench flags assumption failures and the correct fallback.',
  control_chart: 'Statistical process control: plots your process over time with control limits and flags out-of-control points and shifts (Western Electric / Nelson run rules). Includes I-MR, Xbar-R/S, EWMA, CUSUM, p/np/c/u, rare-event G/T, and multivariate T²/MEWMA.',
  regression: 'Model a response from one or more predictors — from OLS through logistic, Poisson, robust, regularized (ridge/lasso/elastic-net), PLS, splines, and random forest. Reports coefficients, fit, and diagnostics.',
  doe: 'Design of Experiments — plan and analyze factorial, fractional, response-surface, and optimal designs to learn which factors matter and their best settings with the fewest runs.',
  desirability: 'Multi-response optimization. Combines several response goals (maximize / minimize / target) into one desirability score and finds the factor settings that best satisfy all of them.',
  predictive_cpk: 'Projects future process capability (Cpk), accounting for drift and within/between variation — a forward-looking complement to a snapshot capability study.',
  distribution_id: 'Identifies which probability distribution best fits your data (normal, lognormal, Weibull, gamma…) via goodness-of-fit, so downstream analyses use the right model.',
  multivariate: 'Multivariate methods — PCA, clustering, discriminant analysis, MANOVA, factor analysis — to find structure across many correlated variables at once.',
  time_series: 'Models data ordered in time — trend/seasonal decomposition and ARIMA / auto-ARIMA forecasting with confidence bounds.',
  survey: 'Survey & Likert analysis: scale reliability (Cronbach\'s alpha), item-total correlations, and alpha-if-deleted to validate a questionnaire.',
  text_pareto: 'Turns free-text comments (complaints, VOC) into a themed Pareto automatically — deterministic keyword/bigram or theme-map extraction, no AI.',
  variance_budget: 'Conyso original. Decomposes total variation (Type-II ANOVA) into named sources as a stacked bar — see exactly where your variability comes from.',
  cycle_time: 'Flow analytics for cycle time — distribution, percentiles, and stability — for transactional and Agile processes.',
  delivery_forecast: 'Monte-Carlo delivery forecast: resamples historical throughput to answer "when will it be done?" with probabilistic dates instead of a single guess.',
  posthoc: 'Post-hoc multiple comparisons after a significant ANOVA (Tukey, Games-Howell, Dunnett, Hsu MCB) — which specific groups differ, controlling family-wise error.',
  tolerance: 'Tolerance intervals — a range that contains a stated proportion of the population with stated confidence (distinct from a confidence interval on the mean).',
  graph: 'Exploratory graphs — build a chart from your columns to see shape, spread, and relationships before formal analysis.',
  attribute_capability: 'Capability for pass/fail (attribute) data — estimates defect rate, DPMO, and process sigma level.',
  anom: 'Analysis of Means — a graphical alternative to ANOVA showing which group means differ from the overall mean against decision limits.',
  sixpack: 'Capability "six-pack" — control charts, capability histogram, normal plot, and capability indices in one dashboard view.',
  agreement: 'Attribute agreement analysis — how consistently appraisers rate the same items (within, between, and vs a standard); Kappa / Kendall.',
  bootstrap: 'Bootstrap resampling — empirical confidence intervals for a statistic without distributional assumptions.',
  correlation: 'Correlation between variables (Pearson / Spearman) with a matrix and significance — strength and direction of association.',
  gage_linearity: 'Gauge linearity & bias study — whether measurement bias stays consistent across the operating range of the gauge.',
  survival: 'Survival analysis — Kaplan-Meier curves and log-rank tests on time-to-event data with censoring.',
  mixed_effects: 'Mixed-effects models (LMM / GLMM / GEE) for grouped, repeated, or hierarchical data — separates fixed effects from random / cluster variation.',
  cost_pareto: 'Cost-weighted Pareto — ranks categories by cost impact (frequency × cost), not just count, to target the most expensive few.',
  ternary: 'Mixture / ternary contour plot — response surface across three components that sum to a constant (formulations, blends).',
  bootstrap_effect: 'Bootstrap confidence intervals for effect sizes (Cohen\'s d, etc.) — quantifies practical significance, not just p-values.',
  variability_gauge: 'Variability (multi-vari) gauge chart — visualizes how measurement variation breaks down across parts, operators, and trials.',
  bayesian: 'Lightweight Bayesian estimation — posterior intervals and probabilities for parameters using conjugate / scipy methods.',
};

function helpFor(kind) {
  return TEST_HELP[kind] || null;
}

function renderHelpButton(kind) {
  const help = helpFor(kind);
  if (!help) return null;
  return h('button', {
    className: 'ghost',
    style: 'font-size:11px;padding:2px 8px;color:var(--muted)',
    onclick: () => toast({ kind: 'info', title: KIND_LABEL[kind] || kind, msg: help, duration: 8000 }),
    title: help,
  }, '? Help');
}

// ───────── Live preview / debounced re-run ─────────

function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ───────── Plain-English result interpreter (rule-based) ─────────
//
// The single biggest free-tier UX win. Every analysis kind gets a
// templated paragraph explaining what the numbers mean. Solo+ replaces
// this with LLM-tailored narrative, but the free version is genuinely
// useful — it teaches the LSS interpretation a Yellow/Green Belt needs.

const INTERPRETERS = {
  capability: (s) => {
    const cpk = s?.cpk;
    const mean = s?.mean, sd = s?.stdev;
    const lsl = s?.lsl, usl = s?.usl;
    if (cpk == null) return 'Capability indices could not be computed — supply both LSL and USL.';
    const dpmo = Math.round((s.z_bench != null) ? (1 - normalCdf(s.z_bench)) * 1_000_000 : null);
    const band = cpk >= 1.67 ? 'highly capable'
               : cpk >= 1.33 ? 'capable'
               : cpk >= 1.00 ? 'marginally capable'
               : 'not capable';
    const off_centering = (mean != null && lsl != null && usl != null)
      ? Math.abs(mean - (lsl + usl) / 2) / sd
      : null;
    let centering_note = '';
    if (off_centering != null) {
      if (off_centering < 0.25) centering_note = ' Mean is centered between the spec limits.';
      else if (off_centering < 1.0) centering_note = ` Mean is ${off_centering.toFixed(1)}σ off-center — re-centering would lift Cpk meaningfully.`;
      else centering_note = ` Mean is ${off_centering.toFixed(1)}σ off-center — centering is the dominant problem before any variance work.`;
    }
    let lines = [
      `Cpk = ${cpk.toFixed(2)} → process is **${band}** (${cpk >= 1.33 ? '≥' : '<'} the 1.33 conventional threshold).`,
    ];
    if (dpmo != null && Number.isFinite(dpmo)) lines.push(`Predicted defect rate ≈ **${dpmo.toLocaleString()} DPMO** (parts per million out of spec).`);
    if (centering_note) lines.push(centering_note.trim());
    if (s.shapiro && s.shapiro.p < 0.05) {
      lines.push(`Shapiro-Wilk p = ${s.shapiro.p.toFixed(3)} — the data are **not normal**; the Cpk above assumes normality, so the real defect rate may differ. Run Distribution ID or re-run with Box-Cox.`);
    }
    lines.push('Capability indices only mean something for a **stable** (in-control) process — confirm with a control chart first.');
    return lines.join(' ');
  },
  hypothesis_test: (s) => {
    if (!s?.test) return '';
    const p = s.p ?? s.p_approx;
    const sig = p != null && p < 0.05;
    const test = s.test;
    // Post-hoc power adds the "was the test even powerful enough?" caveat.
    // Without it, a non-significant result is ambiguous: real null or just
    // an underpowered test? With it, the user can decide for themselves.
    const pwrTail = (s.power != null && s.power_label && !sig)
      ? ` ⚠ Achieved power = ${(s.power * 100).toFixed(0)}% (${s.power_label}). ${
          s.power < 0.8 ? 'The non-significant result may simply reflect insufficient sample size — re-run with sample-size planning before concluding "no difference".' : ''}`
      : (s.power != null && sig
          ? ` Achieved power = ${(s.power * 100).toFixed(0)}%.`
          : '');
    const verdict = sig ? '**Reject H₀** — the difference is statistically significant.'
                        : 'Fail to reject H₀ — no significant difference detected.';
    if (test === 'one_sample_t') {
      const d = s.cohens_d;
      const dLabel = d == null ? '' : ` Cohen's d = ${d.toFixed(2)}.`;
      return `Mean ${s.mean?.toFixed?.(3)} vs target ${s.mu0}. t = ${s.t?.toFixed?.(3)}, p = ${p?.toFixed?.(3)}.${dLabel} ${verdict}${s.ci_95 ? ` 95% CI for the mean: [${s.ci_95[0].toFixed(3)}, ${s.ci_95[1].toFixed(3)}].` : ''}${pwrTail}`;
    }
    if (test === 'two_sample_t') {
      const d = s.cohens_d;
      const dLabel = d == null ? '' : ` Cohen's d = ${d.toFixed(2)} (${Math.abs(d) < 0.2 ? 'negligible' : Math.abs(d) < 0.5 ? 'small' : Math.abs(d) < 0.8 ? 'medium' : 'large'} effect).`;
      const ciTail = s.ci_95_diff ? ` 95% CI for the difference: [${s.ci_95_diff[0].toFixed(3)}, ${s.ci_95_diff[1].toFixed(3)}].` : '';
      return `t = ${s.t?.toFixed?.(3)}, p = ${p?.toFixed?.(3)}. Mean difference = ${s.mean_diff?.toFixed?.(3)}.${dLabel}${ciTail} ${verdict}${sig ? '' : ' If you need to prove equivalence, run TOST instead.'}${pwrTail}`;
    }
    if (test === 'paired_t') {
      const d = s.cohens_dz;
      const dLabel = d == null ? '' : ` Cohen's dz = ${d.toFixed(2)}.`;
      return `Mean of differences = ${s.mean_diff?.toFixed?.(3)}, sd = ${s.stdev_diff?.toFixed?.(3)}, n = ${s.n}. p = ${p?.toFixed?.(3)}.${dLabel} ${verdict}${pwrTail}`;
    }
    if (test === 'one_way_anova' || test === 'anova') {
      const eta = s.eta_squared, omega = s.omega_squared;
      const etaLabel = eta == null ? '' : ` η² = ${eta.toFixed(2)}${omega != null ? ` (ω² = ${omega.toFixed(2)})` : ''} — group differences explain ${(eta * 100).toFixed(0)}% of the variance.`;
      return `F = ${s.F?.toFixed?.(2)}, p = ${p?.toFixed?.(3)}, k = ${s.k} groups.${etaLabel} ${verdict}${sig ? ' Run Tukey HSD to identify which pairs differ.' : ''}${pwrTail}`;
    }
    if (test === 'mann_whitney') {
      const r = s.rank_biserial_r;
      const rLabel = r == null ? '' : ` Rank-biserial r = ${r.toFixed(2)} (${Math.abs(r) < 0.1 ? 'negligible' : Math.abs(r) < 0.3 ? 'small' : Math.abs(r) < 0.5 ? 'medium' : 'large'} effect).`;
      return `U = ${s.U?.toFixed?.(0)}, p = ${p?.toFixed?.(3)}. Median A = ${s.median_a}, Median B = ${s.median_b}.${rLabel} ${verdict}`;
    }
    if (test === 'kruskal') {
      const eps = s.epsilon_squared;
      const epsLabel = eps == null ? '' : ` ε² = ${eps.toFixed(2)}.`;
      return `H = ${s.H?.toFixed?.(2)}, p = ${p?.toFixed?.(3)}.${epsLabel} ${verdict}`;
    }
    if (test === 'levene' || test === 'bartlett') {
      return `${test === 'levene' ? "Levene's W" : "Bartlett's T"} = ${(s.W ?? s.T)?.toFixed?.(2)}, p = ${p?.toFixed?.(3)}. ${sig ? 'Variances are **unequal** — use Welch\'s t-test or Games-Howell post-hoc.' : 'Variances are similar — equal-variance methods are valid.'}`;
    }
    if (test === 'chi_square') {
      const v = s.cramers_v;
      const vLabel = v == null ? '' : ` Cramér's V = ${v.toFixed(2)} (${v < 0.1 ? 'negligible' : v < 0.3 ? 'small' : v < 0.5 ? 'medium' : 'large'} association strength).`;
      return `χ² = ${s.chi2?.toFixed?.(2)}, df = ${s.dof}, n = ${s.n}, p = ${p?.toFixed?.(3)}.${vLabel} ${sig ? 'The two categorical variables are **associated**.' : 'No significant association.'}`;
    }
    if (test === 'fisher_exact')   return `Odds ratio = ${s.odds_ratio?.toFixed?.(2)}, p = ${p?.toFixed?.(3)}. ${verdict}`;
    if (test === 'one_proportion') return `p̂ = ${s.p_hat?.toFixed?.(3)} vs target ${s.p0}, n = ${s.n}, p-value = ${p?.toFixed?.(3)}. ${verdict}`;
    if (test === 'two_proportions') return `p₁ - p₂ = ${s.diff?.toFixed?.(3)}, z = ${s.z?.toFixed?.(2)}, p = ${p?.toFixed?.(3)}. ${verdict}`;
    if (test === 'anderson_darling_normality') return `AD = ${s.AD?.toFixed?.(3)}, approximate p = ${p?.toFixed?.(3)}. ${p != null && p < 0.05 ? 'Reject normality — use non-parametric methods or transform.' : 'Normality is plausible.'}`;
    if (test === 'tost_one_sample' || test === 'tost_two_sample')
      return `TOST: max(p_lower, p_upper) = ${p?.toFixed?.(3)}. ${s.equivalent ? '**Equivalent** within ±' + s.delta + '.' : 'Equivalence **not** demonstrated within ±' + s.delta + '.'}`;
    if (test === 'wilcoxon_signed_rank') return `W = ${s.W?.toFixed?.(0)}, n = ${s.n}, p = ${p?.toFixed?.(3)}. Median diff = ${s.median_diff}. ${verdict}`;
    if (test === 'sign_test')      return `${s.plus} of ${s.n} non-zero differences positive. p = ${p?.toFixed?.(3)}. ${verdict}`;
    if (test === 'mood_median')    return `χ² = ${s.chi2?.toFixed?.(2)}, p = ${p?.toFixed?.(3)}. Grand median = ${s.grand_median}. ${verdict}`;
    if (test === 'grubbs')         return `Grubbs G = ${s.G?.toFixed?.(2)} (critical ${s.critical_value?.toFixed?.(2)}). ${s.is_outlier_alpha_0_05 ? `Value ${s.outlier_value} is an **outlier** at α = 0.05.` : 'No statistical outlier at α = 0.05.'}`;
    if (test === 'dixon_q')        return `Q = ${s.Q?.toFixed?.(3)} (critical ${s.critical_value_alpha_0_05?.toFixed?.(3)}). Suspect = ${s.suspect_value}. ${s.is_outlier_alpha_0_05 ? '**Outlier**.' : 'Not an outlier at α = 0.05.'}`;
    if (test === 'runs')           return `${s.runs} runs (n above = ${s.n_above}, below = ${s.n_below}). p = ${p?.toFixed?.(3)}. ${p != null && p < 0.05 ? 'Sequence is **non-random** — clustering, mixtures, or trend.' : 'Sequence appears random.'}`;
    return `${test}: p = ${p?.toFixed?.(3)}. ${verdict}`;
  },
  control_chart: (s) => {
    const v = (s.violations?.length || 0)
      + (s.we_rules ? Object.values(s.we_rules).reduce((a, x) => a + (x?.length || 0), 0) : 0);
    const stable = v === 0;
    let lines = [];
    if (s.kind) lines.push(`${s.kind} chart with center ${s.center?.toFixed?.(3) ?? s.x_bar?.toFixed?.(3) ?? s.p_bar?.toFixed?.(3) ?? '—'}, ${s.n_subgroups || s.n} points.`);
    if (stable) lines.push('Process is **in statistical control** — no rule violations. Capability indices are interpretable.');
    else {
      lines.push(`**${v} rule violation(s)** detected — process is not yet stable. Investigate special-cause variation before drawing capability conclusions.`);
      if (s.we_rules) {
        const breakdown = [];
        if (s.we_rules.rule_1?.length) breakdown.push(`Rule 1 (beyond 3σ): ${s.we_rules.rule_1.length}`);
        if (s.we_rules.rule_2?.length) breakdown.push(`Rule 2 (9 same-side): ${s.we_rules.rule_2.length}`);
        if (s.we_rules.rule_3?.length) breakdown.push(`Rule 3 (6 monotone): ${s.we_rules.rule_3.length}`);
        if (s.we_rules.rule_4?.length) breakdown.push(`Rule 4 (14 alternating): ${s.we_rules.rule_4.length}`);
        if (breakdown.length) lines.push(breakdown.join(' · '));
      }
    }
    return lines.join(' ');
  },
  msa: (s) => {
    const rr = s?.gauge_rr_pct ?? s?.percent_study_var;
    if (rr == null) return 'Gauge R&R results unavailable.';
    const band = rr < 10 ? 'acceptable (<10%)'
               : rr < 30 ? 'marginal (10–30%)'
               : 'unacceptable (>30%)';
    return `**%R&R = ${rr.toFixed(1)}%** — measurement system is ${band}. ${rr >= 30 ? 'The gauge contributes too much variation. Recalibrate, retrain operators, or replace before drawing capability conclusions.' : rr >= 10 ? 'Borderline. Reduce by tightening the procedure or training; consider a measurement system upgrade.' : 'Trust the gauge; capability and control-chart results are reliable.'}`;
  },
  regression: (s) => {
    const r2 = s?.r2, adj = s?.adj_r2, fp = s?.f_p;
    if (r2 == null) return '';
    const fitBand = r2 >= 0.7 ? 'strong' : r2 >= 0.4 ? 'moderate' : r2 >= 0.15 ? 'weak' : 'very weak';
    let lines = [`R² = ${r2.toFixed(3)} (adjusted ${adj?.toFixed?.(3)}). The model explains ${(r2 * 100).toFixed(0)}% of the variance — a ${fitBand} fit.`];
    if (fp != null) lines.push(`F-test p = ${fp.toFixed(3)} → ${fp < 0.05 ? '**at least one predictor matters**.' : 'no predictor reaches significance.'}`);
    const sigCoefs = (s.coefficients || []).filter(c => c.name !== '(Intercept)' && c.p != null && c.p < 0.05);
    if (sigCoefs.length) {
      lines.push(`Significant predictors (p<0.05): ${sigCoefs.map(c => `${c.name} (β=${c.coef.toFixed(3)})`).join(', ')}.`);
    } else if (fp != null && fp < 0.05) {
      lines.push('Overall F is significant but no individual predictor is — likely collinearity. Try best-subsets.');
    }
    if (sigCoefs.length) lines.push('A significant coefficient shows **association, not causation** — confirm a driver with a designed experiment (DOE) before acting on it.');
    return lines.join(' ');
  },
  pareto: (s) => {
    if (!s?.vital_few) return '';
    const total = s.total_defects ?? '—';
    const vital = s.vital_few;
    return `Top ${vital.length} categories ("vital few") account for ≥${s.threshold_pct ?? 80}% of ${total} defects: **${vital.join(', ')}**. Concentrate root-cause work here.`;
  },
  reliability: (s) => {
    if (s?.distribution !== 'weibull') return '';
    const beta = s.shape_beta, eta = s.scale_eta, mtbf = s.MTBF, b10 = s.B10_life;
    const interp = beta < 0.9 ? '**β < 1 → infant mortality** (decreasing hazard). Investigate incoming-quality and assembly defects.'
                : beta > 1.5 ? '**β > 1 → wear-out** (increasing hazard). Plan preventive replacement before B10 life.'
                : '**β ≈ 1 → random failures** (constant hazard, exponential-like). Component is in the "useful life" phase.';
    return `Weibull β = ${beta.toFixed(2)}, η (characteristic life) = ${eta.toFixed(1)}. MTBF ≈ ${mtbf.toFixed(1)}. B10 life (10% failed) = ${b10.toFixed(1)}. ${interp}`;
  },
  distribution_id: (s) => {
    if (!s?.best_fit) return '';
    return `Best-fit distribution: **${s.best_fit}** (lowest Anderson-Darling). Use this distribution for capability and tolerance analysis. ${s.best_fit !== 'normal' ? 'Re-run capability with a Box-Cox transform if the underlying scale is naturally bounded.' : ''}`;
  },
  doe: (s) => {
    const sig = (s?.effects || []).filter(e => e.p != null && e.p < 0.05 && e.term !== '(Intercept)');
    if (!sig.length) return `R² = ${s?.r2?.toFixed?.(2)}. No effects reached significance at α=0.05. Consider higher-power follow-up or a different design.`;
    const top = sig.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 3);
    return `R² = ${s.r2?.toFixed?.(2)}. Significant effects (p<0.05): ${top.map(t => `${t.term} (effect=${t.effect.toFixed(2)})`).join(', ')}. Move forward with these as the vital few drivers.`;
  },
  attribute_capability: (s) => {
    if (s?.method === 'binomial_capability') {
      return `Defective rate p̂ = ${s.p_hat.toFixed(4)} (${(s.p_hat * 100).toFixed(2)}%) → ${s.DPMO.toLocaleString()} DPMO. Sigma level Z = ${s.z_bench?.toFixed?.(2)}. ${s.stable ? 'Process appears stable on the p-chart.' : 'p-chart shows out-of-control points — investigate before drawing conclusions.'}`;
    }
    if (s?.method === 'poisson_capability') {
      return `Defects per unit DPU = ${s.DPU.toFixed(3)} → ${s.DPMO.toLocaleString()} DPMO. ${s.stable ? 'u-chart is stable.' : 'u-chart shows out-of-control subgroups.'}`;
    }
    return '';
  },

  // ─── New Bench-only interpreters ───

  agreement: (s) => {
    if (!s) return '';
    const k = s.kappa;
    const lines = [];
    if (k && k.kappa != null) {
      lines.push(`**${k.kind === 'cohen' ? "Cohen's" : "Fleiss'"} kappa = ${k.kappa.toFixed(2)}** → ${k.interpretation} agreement (Landis-Koch).`);
    }
    if (s.between_appraisers) {
      const ba = s.between_appraisers;
      lines.push(`Between appraisers: ${ba.matched}/${ba.total} parts matched (${ba.pct?.toFixed?.(1)}%).`);
    }
    if (s.all_vs_standard) {
      const vs = s.all_vs_standard;
      lines.push(`All appraisers vs known standard: ${vs.matched}/${vs.total} (${vs.pct?.toFixed?.(1)}%) — this is the metric AIAG calls "effectiveness".`);
    }
    if (s.within_appraiser) {
      const worst = Object.entries(s.within_appraiser)
        .filter(([, v]) => v.pct != null)
        .sort((a, b) => a[1].pct - b[1].pct)[0];
      if (worst) lines.push(`Weakest within-appraiser repeatability: **${worst[0]}** at ${worst[1].pct?.toFixed?.(0)}% (${worst[1].matched}/${worst[1].total}).`);
    }
    return lines.join(' ');
  },

  bootstrap: (s) => {
    if (!s) return '';
    if (s.groups) {
      const g = Object.entries(s.groups);
      const parts = g.map(([name, v]) =>
        v.theta_hat == null ? `${name}: insufficient data`
        : `${name}: ${v.theta_hat.toFixed(3)} [${v.ci_low.toFixed(3)}, ${v.ci_high.toFixed(3)}]`);
      return `Bootstrap ${s.statistic} per group (${s.method.toUpperCase()}, ${100 * (1 - s.alpha)}% CI): ${parts.join(' · ')}. Non-overlapping intervals → groups differ on this statistic with no normality assumption.`;
    }
    if (s.theta_hat == null) return 'Not enough data to bootstrap. Need at least 3 finite observations.';
    return `Bootstrap ${s.statistic} = **${s.theta_hat.toFixed(3)}** with ${(100 * (1 - s.alpha)).toFixed(0)}% ${s.method.toUpperCase()} CI = [${s.ci_low.toFixed(3)}, ${s.ci_high.toFixed(3)}] (n=${s.n}, ${s.n_boot} resamples, SE_boot=${s.se_boot?.toFixed?.(3)}). Distribution-free — no normality required.`;
  },

  correlation: (s) => {
    if (!s) return '';
    const top = (s.significant || []).slice(0, 5);
    const lines = [`Correlation matrix (${s.method}) on ${s.columns.length} variables. **${s.n_pairs} pair(s) significant** at α = ${s.alpha} with |r| ≥ ${s.min_r}.`];
    if (top.length) {
      lines.push('Top: ' + top.map(p => `${p.x} ↔ ${p.y} (r=${p.r.toFixed(2)}, p=${p.p.toFixed(3)})`).join(' · ') + '.');
    }
    if (s.multicollinearity?.length) {
      lines.push(`⚠️ Multicollinearity (|r|>0.8) in: ${s.multicollinearity.map(p => `${p.x}↔${p.y}`).join(', ')}. Drop one of each pair before fitting regression.`);
    }
    return lines.join(' ');
  },

  gage_linearity: (s) => {
    if (!s) return '';
    const lin = s.linearity || {}; const bias = s.bias_overall || {};
    const lines = [];
    lines.push(`Linearity slope = ${lin.slope?.toFixed?.(4)} (p = ${lin.p_slope?.toFixed?.(3)}) → **${lin.verdict}**.`);
    lines.push(`Overall bias = ${bias.mean_bias?.toFixed?.(3)} with 95% CI [${bias.ci_95?.[0]?.toFixed?.(3)}, ${bias.ci_95?.[1]?.toFixed?.(3)}] (p = ${bias.p?.toFixed?.(3)}) → **${bias.verdict}**.`);
    if (lin.pct_process_variation != null) lines.push(`Linearity as % of process variation: ${lin.pct_process_variation.toFixed(1)}%.`);
    if (bias.pct_process_variation != null) lines.push(`Bias as % of process variation: ${bias.pct_process_variation.toFixed(1)}%.`);
    lines.push(`Verdict: ${lin.verdict === 'acceptable' && bias.verdict === 'acceptable' ? 'gage is **fit-for-purpose**.' : 'gage **needs calibration** — fix bias and/or address the slope.'}`);
    return lines.join(' ');
  },
};

function normalCdf(z) {
  // Abramowitz & Stegun approximation — accurate enough for the
  // narrative.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function renderInterpretation(kind, summary) {
  const fn = INTERPRETERS[kind];
  if (!fn) return null;
  const text = fn(summary);
  if (!text || text.length < 20) return null;
  // Render with markdown-ish bolding (**word**).
  const html = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const wrap = h('div', {},
    h('span', { className: 'section-label' }, 'Interpretation'),
    h('div', { className: 'interp-block', innerHTML: html }),
  );
  return wrap;
}

// ───────── Metric strip ─────────
//
// Horizontal hairline-divided strip of headline numerics for a result.
// Editorial pattern from Mockup A: a small set of key metrics shown big and
// austere, with status-tinted values where there's a clear threshold.
//
// Returns null for kinds with no canonical "top metrics" so the result card
// silently falls back to the interpretation paragraph + chart.

function fmt(v, digits = 2) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  if (typeof v === 'number') {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10)   return v.toFixed(1);
    return v.toFixed(digits);
  }
  return String(v);
}

function cpkClass(v) {
  if (v == null) return '';
  if (v < 1.0)  return 'danger';
  if (v < 1.33) return 'warn';
  return 'success';
}

// Helper — render a CI as a sub-line under a metric.
function _ciSub(arr, digits = 3) {
  if (!Array.isArray(arr) || arr.length !== 2) return null;
  const [lo, hi] = arr;
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return `95% CI [${fmt(lo, digits)}, ${fmt(hi, digits)}]`;
}

// Effect-size magnitude → human label using Cohen 1988 conventions.
function _dLabel(d) {
  if (d == null) return null;
  const a = Math.abs(d);
  return a < 0.2 ? 'negligible' : a < 0.5 ? 'small' : a < 0.8 ? 'medium' : 'large';
}

const METRIC_PICKERS = {
  capability(s) {
    if (!s) return null;
    // Sidecar now returns mean/stdev + spec — compute a Wald-ish CI for the
    // mean as a hint about precision. We approximate σ_mean = stdev/√n with
    // a normal approx (n is usually big in capability studies).
    const ci_mean = (s.mean != null && s.stdev != null && s.n)
      ? [s.mean - 1.96 * s.stdev / Math.sqrt(s.n), s.mean + 1.96 * s.stdev / Math.sqrt(s.n)]
      : null;
    // Prefer the engine's exact Cpk/Ppk confidence intervals (Bissell SE);
    // every commercial tool prints these so users can judge the estimate.
    const cpkCI = s.cpk_ci ? [s.cpk_ci.lo, s.cpk_ci.hi] : null;
    const ppkCI = s.ppk_ci ? [s.ppk_ci.lo, s.ppk_ci.hi] : null;
    return [
      { label: 'n',        value: fmt(s.n, 0) },
      { label: 'Mean',     value: fmt(s.mean), sub: _ciSub(ci_mean) },
      { label: 'Cp',       value: fmt(s.cp),  klass: cpkClass(s.cp)  },
      { label: 'Cpk',      value: fmt(s.cpk), klass: cpkClass(s.cpk), sub: _ciSub(cpkCI) },
      { label: 'Pp',       value: fmt(s.pp),  klass: cpkClass(s.pp)  },
      { label: 'Ppk',      value: fmt(s.ppk), klass: cpkClass(s.ppk), sub: _ciSub(ppkCI) },
    ];
  },
  sixpack(s) { return METRIC_PICKERS.capability(s); },
  hypothesis_test(s) {
    if (!s) return null;
    const out = [];
    if (s.n != null)         out.push({ label: 'n',        value: fmt(s.n, 0) });
    // Statistic + main mean / mean-diff with CI when available.
    if (s.mean != null && s.test === 'one_sample_t') {
      out.push({ label: 'Mean', value: fmt(s.mean), sub: _ciSub(s.ci_95) });
    } else if (s.mean_diff != null) {
      out.push({ label: 'Δ mean', value: fmt(s.mean_diff),
                 sub: _ciSub(s.ci_95_diff || s.ci_95) });
    } else if (s.p_hat != null) {
      out.push({ label: 'p̂', value: fmt(s.p_hat, 3),
                 sub: _ciSub(s.ci_95_wilson) });
    } else if (s.diff != null) {
      out.push({ label: 'Δ p', value: fmt(s.diff, 3), sub: _ciSub(s.ci_95_diff) });
    } else if (s.statistic != null) {
      out.push({ label: 'Statistic', value: fmt(s.statistic) });
    }
    // p-value (sidecar key is 'p'; some responses use 'p_value' / 'p_approx').
    const pv = s.p ?? s.p_value ?? s.p_approx;
    if (pv != null) {
      const klass = pv < 0.05 ? 'success' : 'warn';
      out.push({ label: 'p-value', value: fmt(pv, 4), klass });
    }
    // Effect size — prefer Cohen's d, fall back to η²/ε²/Cramér's V/etc.
    const es = s.cohens_d ?? s.cohens_dz ?? s.eta_squared ?? s.epsilon_squared
            ?? s.cramers_v ?? s.rank_biserial_r ?? s.cohens_h ?? s.effect_size;
    if (es != null) {
      const lbl = s.cohens_d != null ? "Cohen's d"
                 : s.cohens_dz != null ? "Cohen's dz"
                 : s.eta_squared != null ? 'η²'
                 : s.epsilon_squared != null ? 'ε²'
                 : s.cramers_v != null ? "Cramér's V"
                 : s.rank_biserial_r != null ? 'r_rb'
                 : s.cohens_h != null ? "Cohen's h"
                 : 'Effect';
      out.push({ label: lbl, value: fmt(es, 2), sub: _dLabel(es) });
    }
    // Power (post-hoc) — the third leg of the BB decision triangle.
    if (s.power != null) {
      const klass = s.power >= 0.8 ? 'success' : s.power >= 0.5 ? 'warn' : 'danger';
      out.push({ label: 'Power', value: fmt(s.power * 100, 0) + '%', klass,
                 sub: s.power_label });
    }
    return out.length ? out : null;
  },
  regression(s) {
    if (!s) return null;
    const out = [];
    if (s.r_squared != null || s.r2 != null)     out.push({ label: 'R²',     value: fmt(s.r_squared ?? s.r2, 3) });
    if (s.adj_r_squared != null || s.adj_r2 != null) out.push({ label: 'Adj R²', value: fmt(s.adj_r_squared ?? s.adj_r2, 3) });
    if (s.f_statistic != null || s.f_stat != null) out.push({ label: 'F',      value: fmt(s.f_statistic ?? s.f_stat) });
    const fp = s.f_p_value ?? s.f_p;
    if (fp != null) {
      const klass = fp < 0.05 ? 'success' : 'warn';
      out.push({ label: 'p',     value: fmt(fp, 4), klass });
    }
    if (s.rmse != null) out.push({ label: 'RMSE', value: fmt(s.rmse) });
    if (s.n != null)             out.push({ label: 'n',      value: fmt(s.n, 0) });
    // VIF warning chip — if any predictor has VIF > 5, surface it here.
    if (Array.isArray(s.vif) && s.vif.length) {
      const worst = s.vif.reduce((a, b) => (b.vif != null && b.vif > (a?.vif ?? 0)) ? b : a, null);
      if (worst && worst.vif != null && Number.isFinite(worst.vif)) {
        const klass = worst.vif > 10 ? 'danger' : worst.vif > 5 ? 'warn' : 'success';
        out.push({ label: 'Max VIF', value: fmt(worst.vif, 1), klass, sub: worst.name });
      }
    }
    // AUC for logistic — sidecar puts it under s.roc.auc.
    if (s.roc?.available && s.roc.auc != null) {
      const klass = s.roc.auc >= 0.8 ? 'success' : s.roc.auc >= 0.7 ? 'warn' : 'danger';
      out.push({ label: 'AUC', value: fmt(s.roc.auc, 3), klass, sub: s.roc.interpretation });
    }
    return out.length ? out : null;
  },
  msa(s) {
    if (!s) return null;
    const out = [];
    if (s.total_grr_pct != null) {
      const klass = s.total_grr_pct > 30 ? 'danger' : s.total_grr_pct > 10 ? 'warn' : 'success';
      out.push({ label: '% GR&R', value: fmt(s.total_grr_pct, 1) + '%', klass });
    }
    if (s.ndc != null) {
      const klass = s.ndc < 5 ? 'danger' : 'success';
      out.push({ label: 'ndc', value: fmt(s.ndc, 1), klass });
    }
    if (s.repeatability_pct != null) out.push({ label: 'Repeat.',  value: fmt(s.repeatability_pct, 1) + '%' });
    if (s.reproducibility_pct != null) out.push({ label: 'Reprod.', value: fmt(s.reproducibility_pct, 1) + '%' });
    return out.length ? out : null;
  },
};

function renderMetricStrip(kind, summary) {
  const picker = METRIC_PICKERS[kind];
  if (!picker) return null;
  const metrics = picker(summary);
  if (!metrics || !metrics.length) return null;
  const strip = h('div', { className: 'metric-strip' });
  for (const m of metrics) {
    strip.append(
      h('div', { className: 'metric' + (m.klass ? ' ' + m.klass : '') },
        h('div', { className: 'label' }, m.label),
        h('div', { className: 'value' }, m.value),
        m.sub ? h('div', { className: 'sub' }, m.sub) : null,
      ),
    );
  }
  return strip;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

// ───────── Inline parameter help ─────────
//
// Tooltip text per (kind, paramName). Surfaced as a `?` icon next to
// each form input so a Yellow Belt isn't lost.

const PARAM_HELP = {
  capability: {
    column: 'The continuous measurement you want to assess (e.g. cycle_time, dim_A).',
    lsl: 'Lower Spec Limit. Anything below this is out of spec. Leave empty for one-sided upper-only.',
    usl: 'Upper Spec Limit. Anything above this is out of spec. Leave empty for one-sided lower-only.',
    target: 'Optional target value. Used to compute Cpm (Taguchi capability).',
    transform: 'Set to "box-cox" to handle non-normal data — Bill picks the transform automatically.',
  },
  control_chart: {
    column: 'The measurement to chart over time.',
    kind: 'I-MR for individuals (no subgroups). X-bar/R when you have subgroups. CUSUM/EWMA for small persistent shifts.',
    subgroup_col: 'For X-bar/R only — column that identifies subgroups (e.g. "shift", "lot_id").',
    target: 'Optional in-control target. CUSUM uses this as the reference; defaults to sample mean.',
    k: 'CUSUM allowance (in σ). 0.5σ is standard — half the smallest shift you want to detect.',
    h: 'CUSUM decision interval (in σ). 4σ ≈ 0.27% false-alarm rate, 5σ ≈ 0.05%.',
    lam: 'EWMA smoothing constant (0–1). 0.2 weights recent obs ~5× more than old; smaller = smoother.',
  },
  hypothesis_test: {
    test: 'Pick from the dropdown — Bill\'s Test Chooser will recommend the right one if unsure.',
    column: 'The variable being tested.',
    group_col: 'For two/k-group tests — column whose distinct values define the groups.',
    column_b: 'For paired tests — the second measurement on the same items (e.g. "after").',
    mu0: 'For one-sample t — the target mean to test against.',
    p0: 'For one-proportion — the target proportion (e.g. 0.5).',
    delta: 'For TOST equivalence tests — the half-width of the equivalence margin.',
  },
  regression: {
    response: 'The dependent variable Y you want to predict.',
    predictors: 'The independent X variables. Use Ctrl/Cmd-click to select multiple.',
  },
  msa: {
    measurement_col: 'The measurement values from the study.',
    part_col: 'Column identifying the parts being measured.',
    operator_col: 'Column identifying the operators.',
  },
  doe: {
    response: 'The output Y you measured.',
    factors: 'The input X factors (each must have exactly two levels).',
    interactions: 'true to include all 2-way interaction terms; false for main effects only.',
  },
  pareto: {
    column: 'Categorical column (defect codes, error types). Bill counts and ranks them.',
    threshold_pct: 'The cumulative-percent line for "vital few". 80 is conventional.',
  },
};

function getParamHelp(kind, paramName) {
  return PARAM_HELP[kind]?.[paramName] || null;
}

function renderParamHelpIcon(kind, paramName) {
  const help = getParamHelp(kind, paramName);
  if (!help) return null;
  // Subtle hairline glyph — no filled background, no bold weight. Editorial,
  // not form-y. Tooltip on hover via the `title` attribute.
  return h('span', {
    title: help,
    style: 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid var(--line-2);color:var(--muted);font-size:9px;font-weight:400;cursor:help;font-family:var(--font-mono);line-height:1',
  }, '?');
}

// ───────── More query patterns (extended) ─────────

QUERY_PATTERNS.push(
  { rx: /(?:tukey|post[-\s]*hoc|which\s+groups\s+differ)/i,
    out: () => ({ kind: 'posthoc', test: 'tukey_hsd' }) },
  { rx: /(?:tolerance\s+interval|tol\s+int)\s+(?:on|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'tolerance', column: m[1].trim() }) },
  { rx: /(?:run|do)\s+(?:a\s+)?(?:capability\s+)?sixpack\s+(?:on|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'sixpack', column: m[1].trim() }) },
  { rx: /(?:t-?test|compare\s+mean)\s+(.+)/i,
    out: (m) => ({ kind: 'hypothesis_test', test: 'two_sample_t', column: m[1].trim() }) },
  { rx: /(?:anova)\s+(?:on)?\s*(.+?)\s+(?:by|across)\s+(.+)/i,
    out: (m) => ({ kind: 'hypothesis_test', test: 'one_way_anova', column: m[1].trim(), group_col: m[2].trim() }) },
  { rx: /(?:check|test|is\s+it)\s+normal(?:ity)?\s+(?:of|on|for)?\s*(.+)/i,
    out: (m) => ({ kind: 'hypothesis_test', test: 'anderson_darling_normality', column: m[1].trim() }) },
  { rx: /(?:correlat|cross[-\s]*corr)/i, out: () => ({ kind: 'cross_correlation' }) },
  { rx: /(?:cluster|group\s+similar|kmeans)/i, out: () => ({ kind: 'kmeans' }) },
  { rx: /(?:pca|principal\s+components?|reduce\s+dimensions?)/i, out: () => ({ kind: 'pca' }) },
  { rx: /(?:warranty|life\s+test|accelerated\s+life|arrhenius)/i,
    out: () => ({ kind: 'reliability', distribution: 'arrhenius' }) },
  { rx: /(?:fit|forecast|arima|holt[-\s]*winters?)\s+(?:on|of|for)?\s*(.+)?/i,
    out: (m) => ({ kind: 'time_series', method: 'auto_arima', value_col: m[1]?.trim() }) },
  { rx: /(?:design\s+(?:an?\s+)?experiment|fractional|plackett|box[-\s]*behnken|ccd|definitive\s+screen)/i,
    out: () => ({ kind: 'doe_design' }) },
);

// ───────── More chooser branches (DOE detail, MSA detail) ─────────

CHOOSER_TREE.relation = {
  question: 'What kind of relationship?',
  options: [
    { label: 'One predictor → continuous response',          recommend: 'regression', followup: 'fitted_line' },
    { label: 'Many predictors → continuous response',        recommend: 'best_subsets', why: 'Searches all subsets up to size k and ranks by adjusted R².' },
    { label: 'Predictors → binary response',                 recommend: 'logistic' },
    { label: 'Predictors → ordered category response',       recommend: 'ordinal_logit' },
    { label: 'Predictors → count response',                  recommend: 'poisson_regression' },
    { label: 'Curve shape / nonlinear',                      recommend: 'nonlinear_regression', why: 'Choose from exp_decay, logistic, power, asymptotic.' },
    { label: 'Just visualize the relationship',              recommend: 'scatter', why: 'Scatter plot with optional fit line — quickest way to see if a relationship exists.' },
  ],
};

CHOOSER_TREE.doe = {
  question: 'What stage is your DOE work at?',
  options: [
    { label: 'I have many factors — screen which matter',
      recommend: 'plackett_burman',
      why: 'Plackett-Burman screens k factors in n=ceil(k/4)*4+something runs. Resolution III — main effects only.' },
    { label: 'I have a few factors — full study with interactions',
      recommend: 'full_factorial',
      why: '2^k full factorial. Estimates all main effects and interactions.' },
    { label: 'I want the optimum (response surface)',
      recommend: 'central_composite',
      why: 'CCD = factorial cube + axial points + center. Fit a quadratic model and find the optimum.' },
    { label: 'Cheaper response surface (no corner points)',
      recommend: 'box_behnken',
      why: 'Box-Behnken — three-level RSM design, no corner points. Use for k=3..5.' },
    { label: 'Mixture / formulation (components sum to 1)',
      recommend: 'mixture_simplex_centroid',
      why: 'Components are proportions that must sum to 1 (e.g. drug formulations).' },
    { label: 'Maximum information per run (advanced)',
      recommend: 'definitive_screening',
      why: 'DSD — three-level screening that estimates main effects + selected interactions in 2k+1 runs.' },
  ],
};
CHOOSER_TREE.root.options.push({ label: 'Design an experiment (DOE)', next: 'doe' });

// ───────── Chart annotations (lightweight, persisted in result_json) ─────────
//
// Click-to-add notes pinned to a chart point. Persisted on the analysis
// row by PATCHing result_json.annotations. Annotations travel with the
// analysis — they show up wherever the chart is rendered.

async function addAnnotation(projectId, analysisId, annotation) {
  // Server-side: PATCH route appends to result_json.annotations.
  return api.patch(`/api/projects/${projectId}/analyses/${analysisId}/annotation`, annotation);
}

function renderAnnotations(annotations) {
  if (!annotations?.length) return null;
  const list = h('div', { className: 'card', style: 'background:var(--cream);border-color:var(--cream-line)' });
  list.append(h('div', { style: 'font-size:11px;font-weight:700;letter-spacing:0.05em;color:#6b4f00;margin-bottom:6px;text-transform:uppercase' }, 'Annotations'));
  for (const a of annotations) {
    list.append(h('div', { style: 'padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:13px' },
      h('span', { className: 'mono', style: 'background:rgba(0,0,0,0.05);padding:1px 6px;border-radius:3px;font-size:11px;margin-right:8px' },
        a.point != null ? `pt ${a.point + 1}` : a.x != null ? `x=${a.x}` : '∙'),
      h('span', {}, a.note),
      h('span', { className: 'muted', style: 'font-size:11px;margin-left:8px' },
        new Date(a.at || Date.now()).toLocaleDateString()),
    ));
  }
  return list;
}

// ───────── Saved Recipes ─────────
//
// Every analysis run is implicitly a recipe — but with no name and no
// tag it's hard to find again. The Save-as-Recipe path stores name +
// tags + the params on the analysis row's recipes column (a tag array).
// Re-run is one click.

async function saveAsRecipe(projectId, analysisId, name, tags = []) {
  return api.patch(`/api/projects/${projectId}/analyses/${analysisId}/recipe`, { name, tags });
}

async function listRecipes(projectId) {
  const r = await api.get(`/api/projects/${projectId}/recipes`).catch(() => ({ recipes: [] }));
  return r.recipes || [];
}

// ───────── Live preview (debounced capability re-run) ─────────
//
// When the user changes LSL / USL on a capability run, re-fetch the
// /run-sync result on a debounce so they see Cpk update in real time
// without clicking Run.

function attachLivePreview(formEl, projectId, kind, callback) {
  if (!['capability'].includes(kind)) return;
  const refresh = debounce(async () => {
    const datasetId = formEl.querySelector('[name=dataset]')?.value
                   || formEl.querySelector('#analyze-dataset')?.value;
    const column = formEl.querySelector('[name=column]')?.value;
    const lsl = formEl.querySelector('[name=lsl]')?.value;
    const usl = formEl.querySelector('[name=usl]')?.value;
    if (!datasetId || !column || (!lsl && !usl)) return;
    try {
      const r = await api.post(`/api/projects/${projectId}/analyses/run-sync`, {
        kind, datasetId,
        params: { column,
          lsl: lsl ? Number(lsl) : null,
          usl: usl ? Number(usl) : null },
      });
      callback(r);
    } catch {/* swallow — live preview is best-effort */}
  }, 400);
  formEl.querySelectorAll('[name=lsl], [name=usl], [name=column]').forEach(el => {
    el.addEventListener('input', refresh);
  });
  return refresh;
}

// ───────── Search / filter analyses list ─────────

function filterAnalyses(analyses, query) {
  if (!query?.trim()) return analyses;
  const q = query.toLowerCase();
  return analyses.filter(a => {
    const blob = JSON.stringify({
      kind: a.kind,
      label: KIND_LABEL[a.kind] || a.kind,
      params: a.params_json,
      narrative: a.narrative_md,
    }).toLowerCase();
    return blob.includes(q);
  });
}

function renderAnalysesSearchBar(onChange) {
  return h('input', {
    placeholder: 'Filter analyses (kind, column, params, narrative)…',
    style: 'flex:1;font-size:13px',
    oninput: (e) => onChange(e.target.value),
  });
}

// svgPareto and svgFittedLine are defined in the interactive charts block above.

// ───────── Export to CSV / clipboard ─────────

function summaryToCsv(summary) {
  const rows = [];
  function flatten(obj, prefix = '') {
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key);
      else rows.push([key, Array.isArray(v) ? v.join(';') : String(v ?? '')]);
    }
  }
  flatten(summary);
  return 'key,value\n' + rows.map(r => `"${r[0]}","${r[1].replace(/"/g, '""')}"`).join('\n');
}

function copySummary(summary) {
  const text = JSON.stringify(summary, null, 2);
  navigator.clipboard?.writeText(text).then(
    () => toast({ kind: 'success', msg: 'Copied summary to clipboard.' }),
    () => toast({ kind: 'error', msg: 'Clipboard write failed.' }),
  );
}

function downloadCsv(filename, summary) {
  const blob = new Blob([summaryToCsv(summary)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

// ───────── Add to tollgate deck ─────────

async function addToTollgateDeck(projectId, analysis) {
  // Append a slide-equivalent block to the tollgate_deck doc for the
  // current phase. Server returns the updated document.
  const phase = await api.get(`/api/projects/${projectId}`).then(r => r?.project?.phase || 'measure').catch(() => 'measure');
  return api.post(`/api/projects/${projectId}/documents/append-to-deck`, {
    phase,
    analysis_id: analysis.id,
    chart_storage_key: analysis.chart_storage_key,
    title: KIND_LABEL[analysis.kind] || analysis.kind,
    summary: analysis.result_json?.summary,
    narrative: analysis.narrative_md,
  });
}

// ───────── Export ─────────

window.statsUx = {
  // Test chooser
  openTestChooser, KIND_LABEL,
  // Assumption checks
  runAssumptionChecks, renderTrafficLights, ASSUMPTION_LABELS,
  // Plain-English query
  parseQuery,
  // Recommendations
  renderNextSteps, NEXT_ANALYSIS,
  // Free-tier action plans
  renderActionPlanFree, ACTION_RULES,
  // Plain-English interpretation (NEW)
  renderInterpretation, INTERPRETERS,
  // Metric strip — horizontal hairline-divided headline numerics
  renderMetricStrip, METRIC_PICKERS,
  // SVG charts (extended with pareto + fittedLine)
  svgRunChart, svgControlChart, svgHistogram, svgScatter, svgBoxplot,
  svgPareto, svgFittedLine,
  // Interactive frame + SVG helpers (used by Bench Insights view)
  renderInteractiveChart, emptyChartCard, fmtNum, niceTicks, exportSvgEl, svg,
  // Comparator
  openComparator,
  // Help
  helpFor, renderHelpButton, TEST_HELP, getParamHelp, renderParamHelpIcon, PARAM_HELP,
  // Health score
  computeHealthScore, renderHealthGauge,
  // Annotations
  addAnnotation, renderAnnotations,
  // Recipes
  saveAsRecipe, listRecipes,
  // Live preview
  attachLivePreview,
  // Search / filter
  filterAnalyses, renderAnalysesSearchBar,
  // Export
  summaryToCsv, copySummary, downloadCsv,
  // Tollgate handoff
  addToTollgateDeck,
  // Utilities
  debounce, escapeHtml,
};

})();
