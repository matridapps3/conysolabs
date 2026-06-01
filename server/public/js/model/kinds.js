const ANALYSIS_KINDS = {
  capability:           { label: 'Capability (Cpk)',           params: [
    { name: 'column', kind: 'col', numeric: true },
    { name: 'lsl', kind: 'num', optional: true },
    { name: 'usl', kind: 'num', optional: true },
    { name: 'target', kind: 'num', optional: true },
    { name: 'subgroup_col', kind: 'col', optional: true },
    { name: 'transform', kind: 'enum', options: ['', 'box-cox'], optional: true },
  ]},
  hypothesis_test:      { label: 'Hypothesis test',            params: [
    { name: 'test', kind: 'enum', options: [
      'one_sample_t', 'two_sample_t', 'paired_t', 'one_way_anova', 'two_way_anova',
      'mann_whitney', 'kruskal', 'wilcoxon_signed_rank', 'sign_test', 'mood_median',
      'levene', 'bartlett', 'f_test_variances',
      'chi_square', 'fisher_exact', 'mcnemar',
      'one_proportion', 'two_proportions',
      'anderson_darling_normality', 'ryan_joiner', 'kolmogorov_smirnov_normal',
      'tost_one_sample', 'tost_two_sample', 'friedman', 'runs', 'grubbs', 'dixon_q',
      'rm_anova',
    ] },
    { name: 'column', kind: 'col' },
    { name: 'group_col', kind: 'col', optional: true },
    { name: 'column_b', kind: 'col', optional: true },
    { name: 'mu0', kind: 'num', optional: true },
    { name: 'p0', kind: 'num', optional: true },
    { name: 'delta', kind: 'num', optional: true },
    // rm_anova-only
    { name: 'subject_col', kind: 'col', optional: true,
      help: 'rm_anova — id of each subject (repeated-measures unit).' },
    { name: 'within',      kind: 'col', optional: true,
      help: 'rm_anova — the within-subjects factor (treated as categorical).' },
  ]},
  control_chart:        { label: 'Control chart',               params: [
    { name: 'kind', kind: 'enum', options: [
      'I-MR','X-bar/R','EWMA','CUSUM','MA','p','np','c','u',
      'G','T','T2','MEWMA','Z-MR','short_run',
    ], help: 'G/T are rare-event charts: G = opportunities between events (counts), T = time between events.' },
    { name: 'column', kind: 'col', optional: true },
    { name: 'columns', kind: 'cols', optional: true },
    { name: 'subgroup_col', kind: 'col', optional: true },
    { name: 'group_col', kind: 'col', optional: true },
    { name: 'n_col', kind: 'col', optional: true },
    { name: 'target', kind: 'num', optional: true },
    { name: 'phase_col', kind: 'col', optional: true },
    { name: 'alpha', kind: 'num', optional: true },
    { name: 'lam', kind: 'num', optional: true },
    { name: 'arl0', kind: 'num', optional: true },
  ]},
  regression:           { label: 'Regression',                  params: [
    { name: 'method', kind: 'enum', options: [
      'ols', 'glm', 'logistic', 'poisson', 'nonlinear',
      'stepwise', 'best_subsets', 'ordinal_logit',
      'robust', 'quantile',
      'ridge', 'lasso', 'elastic_net',
    ] },
    { name: 'response',   kind: 'col', numeric: true },
    { name: 'predictors', kind: 'cols', optional: true },
    { name: 'predictor',  kind: 'col',  optional: true },    // nonlinear
    { name: 'model',      kind: 'enum', optional: true,
      options: ['', 'exp_decay', 'logistic', 'power', 'asymptotic'] },
    { name: 'family',     kind: 'enum', optional: true,
      options: ['', 'gaussian', 'binomial', 'poisson', 'gamma'] },
    { name: 'direction',  kind: 'enum', optional: true,
      options: ['', 'forward', 'backward', 'both'] },
    { name: 'alpha_in',   kind: 'num',  optional: true, defaultValue: 0.05 },
    { name: 'alpha_out',  kind: 'num',  optional: true, defaultValue: 0.10 },
    { name: 'max_terms',  kind: 'num',  optional: true },
    { name: 'penalty',    kind: 'num',  optional: true,
      help: 'ridge/lasso/elastic-net — penalty α. Leave blank to choose by cross-validation.' },
    { name: 'l1_ratio',   kind: 'num',  optional: true,
      help: 'elastic-net only — mix of L1/L2 (0 = ridge … 1 = lasso). Default 0.5.' },
  ]},
  msa:                  { label: 'Gauge R&R (MSA)',            params: [
    { name: 'design', kind: 'enum', options: ['crossed', 'nested', 'expanded'] },
    { name: 'measurement_col', kind: 'col', numeric: true },
    { name: 'part_col', kind: 'col' },
    { name: 'operator_col', kind: 'col' },
    { name: 'factor_cols', kind: 'cols', optional: true },
    { name: 'tolerance', kind: 'num', optional: true },
  ]},
  doe:                  { label: 'DOE (factorial fit)',         params: [
    { name: 'response', kind: 'col', numeric: true },
    { name: 'factors', kind: 'cols' },
    { name: 'interactions', kind: 'bool', defaultValue: true },
  ]},
  desirability:         { label: 'Multi-response desirability',  params: [
    { name: 'factors',   kind: 'cols' },
    { name: 'responses', kind: 'json',
      help: 'JSON list: [{"name":"yield","kind":"max","low":70,"high":95,"importance":5}, ...]' },
    { name: 'n_starts',  kind: 'num', defaultValue: 24, optional: true },
  ]},
  pareto:               { label: 'Pareto',                      params: [
    { name: 'category_col', kind: 'col' },
    { name: 'threshold_pct', kind: 'num', optional: true, defaultValue: 80 },
  ]},
  predictive_cpk:       { label: 'Predictive Cpk (what-if)',    params: [
    { name: 'column', kind: 'col', numeric: true },
    { name: 'lsl', kind: 'num', optional: true },
    { name: 'usl', kind: 'num', optional: true },
  ]},
  distribution_id:      { label: 'Distribution Identifier',     params: [
    { name: 'column', kind: 'col', numeric: true },
  ]},
  reliability:          { label: 'Reliability',                 params: [
    { name: 'distribution', kind: 'enum', options: [
      'weibull','exponential','arrhenius',
      'lognormal','gamma','log_logistic',
      'smallest_extreme_value','largest_extreme_value','gev',
      'cox_ph',
    ] },
    { name: 'time_col', kind: 'col', numeric: true },
    { name: 'censor_col', kind: 'col', optional: true },
    // Cox PH only:
    { name: 'event_col', kind: 'col', optional: true,
      help: 'Cox PH only — 1=event observed, 0=censored.' },
    { name: 'predictors', kind: 'cols', optional: true,
      help: 'Cox PH only — covariate columns to fit hazard ratios for.' },
  ]},
  multivariate:         { label: 'Multivariate (PCA/KMeans/LDA)', params: [
    { name: 'method', kind: 'enum', options: ['pca','kmeans','lda','hierarchical','hotelling','manova','factor'] },
    { name: 'columns', kind: 'cols' },
    { name: 'k', kind: 'num', optional: true },
    { name: 'n_components', kind: 'num', optional: true,
      help: 'factor analysis — number of factors (blank = Kaiser rule: eigenvalues > 1).' },
    { name: 'class_col', kind: 'col', optional: true,
      help: 'lda — the known class label; manova — the grouping factor.' },
  ]},
  time_series:          { label: 'Time series',                 params: [
    { name: 'method', kind: 'enum', options: ['exp_smoothing','arima','auto_arima','decompose','acf_pacf','cross_correlation','changepoint'] },
    { name: 'value_col', kind: 'col', numeric: true },
    { name: 'time_col', kind: 'col', optional: true },
    { name: 'horizon', kind: 'num', optional: true, defaultValue: 12 },
  ]},
  survey:               { label: 'Survey / Likert (Cronbach α)', params: [
    { name: 'items', kind: 'cols', help: 'The Likert-item columns (each an ordinal response, e.g. 1–5).' },
    { name: 'scale_min', kind: 'num', optional: true, help: 'Lowest scale point (default: inferred).' },
    { name: 'scale_max', kind: 'num', optional: true, help: 'Highest scale point (default: inferred).' },
  ]},
  text_pareto:          { label: 'Comment Pareto (VOC text)',   params: [
    { name: 'text_col', kind: 'col', help: 'Free-text comment column.' },
    { name: 'top_n', kind: 'num', optional: true, defaultValue: 10 },
    { name: 'use_bigrams', kind: 'bool', optional: true, defaultValue: true },
    { name: 'threshold_pct', kind: 'num', optional: true, defaultValue: 80 },
    { name: 'themes', kind: 'json', optional: true,
      help: 'Optional taxonomy: {"Wait":["wait","queue"],"Staff":["rude","staff"]}. Omit to auto-extract keywords.' },
  ]},
  variance_budget:      { label: 'Variance Budget (Conyso Original)', params: [
    { name: 'response', kind: 'col', numeric: true },
    { name: 'factors', kind: 'cols', help: 'Named sources of variation to budget across (operator, machine, shift…).' },
  ]},
  cycle_time:           { label: 'Cycle / Lead Time (flow)',    params: [
    { name: 'time_col', kind: 'col', optional: true, help: 'Numeric duration column (days/hours). OR use start+end below.' },
    { name: 'start_col', kind: 'col', optional: true, help: 'Start timestamp (with end_col → cycle in days).' },
    { name: 'end_col', kind: 'col', optional: true, help: 'End/completion timestamp.' },
  ]},
  delivery_forecast:    { label: 'Delivery Forecast (Monte-Carlo)', params: [
    { name: 'throughput_col', kind: 'col', numeric: true, help: 'Items completed per period (sprint/week/day).' },
    { name: 'backlog', kind: 'num', optional: true, help: 'How many items remain → forecast periods to finish.' },
    { name: 'horizon', kind: 'num', optional: true, help: 'Periods ahead → forecast how many items land.' },
  ]},
  posthoc:              { label: 'Post-hoc (Tukey/Dunn/Dunnett/Hsu)', params: [
    { name: 'test', kind: 'enum', options: ['tukey_hsd','fisher_lsd','games_howell','dunn','dunnett','hsu_mcb'] },
    { name: 'value_col', kind: 'col', numeric: true },
    { name: 'group_col', kind: 'col' },
    { name: 'control_group', kind: 'string', optional: true },
    { name: 'direction', kind: 'enum', options: ['best_is_largest','best_is_smallest'], optional: true },
    { name: 'p_adjust', kind: 'enum', options: ['holm','bonferroni'], optional: true,
      help: "dunn — multiplicity correction (Holm is more powerful)." },
  ]},
  tolerance:            { label: 'Tolerance interval',          params: [
    { name: 'method', kind: 'enum', options: ['normal','nonparametric'] },
    { name: 'column', kind: 'col', numeric: true },
    { name: 'p', kind: 'num', defaultValue: 0.95 },
    { name: 'confidence', kind: 'num', defaultValue: 0.95 },
  ]},
  graph:                { label: 'Graphs (boxplot/scatter/…)',  params: [
    { name: 'chart', kind: 'enum', options: ['boxplot','histogram','scatter','matrix_plot','time_series','individual_value_plot','run_chart','multi_vari','interaction'] },
    { name: 'column', kind: 'col', optional: true },
    { name: 'columns', kind: 'cols', optional: true },
    { name: 'group_col', kind: 'col', optional: true },
    { name: 'x_col', kind: 'col', optional: true },
    { name: 'y_col', kind: 'col', optional: true },
    { name: 'time_col', kind: 'col', optional: true },
    { name: 'factor_cols', kind: 'cols', optional: true },
    // Interaction-plot only:
    { name: 'response', kind: 'col', optional: true, numeric: true },
    { name: 'factor_a', kind: 'col', optional: true },
    { name: 'factor_b', kind: 'col', optional: true },
  ]},
  attribute_capability: { label: 'Attribute capability',        params: [
    { name: 'method', kind: 'enum', options: ['binomial','poisson'] },
    { name: 'defects_col', kind: 'col', numeric: true },
    { name: 'n_col', kind: 'col', numeric: true },
    { name: 'target', kind: 'num', optional: true },
  ]},
  anom:                 { label: 'Analysis of Means (ANOM)',    params: [
    { name: 'value_col', kind: 'col', numeric: true },
    { name: 'group_col', kind: 'col' },
    { name: 'alpha', kind: 'num', defaultValue: 0.05 },
  ]},
  sixpack:              { label: 'Capability Sixpack',          params: [
    { name: 'column', kind: 'col', numeric: true },
    { name: 'lsl', kind: 'num', optional: true },
    { name: 'usl', kind: 'num', optional: true },
    { name: 'target', kind: 'num', optional: true },
  ]},
  // ─── New Bench-only analyses ───
  agreement:            { label: 'Attribute Agreement (Kappa)', params: [
    { name: 'appraiser_col', kind: 'col' },
    { name: 'part_col',      kind: 'col' },
    { name: 'rating_col',    kind: 'col' },
    { name: 'standard_col',  kind: 'col', optional: true },
    { name: 'trial_col',     kind: 'col', optional: true },
    { name: 'ordinal',       kind: 'bool', optional: true, defaultValue: false },
  ]},
  bootstrap:            { label: 'Bootstrap CI',                params: [
    { name: 'column',    kind: 'col', numeric: true },
    { name: 'statistic', kind: 'enum',
      options: ['mean','median','std','var','mad','q25','q50','q75','iqr',
                'min','max','range','skew','kurtosis','cv','proportion'],
      defaultValue: 'mean' },
    { name: 'method',    kind: 'enum', options: ['bca','percentile'], defaultValue: 'bca' },
    { name: 'n_boot',    kind: 'num', optional: true, defaultValue: 5000 },
    { name: 'alpha',     kind: 'num', optional: true, defaultValue: 0.05 },
    { name: 'group_col', kind: 'col', optional: true },
  ]},
  correlation:          { label: 'Correlation matrix',          params: [
    { name: 'columns', kind: 'cols', optional: true },
    { name: 'method',  kind: 'enum', options: ['pearson','spearman','kendall'], defaultValue: 'pearson' },
    { name: 'alpha',   kind: 'num',  optional: true, defaultValue: 0.05 },
    { name: 'min_r',   kind: 'num',  optional: true, defaultValue: 0.3 },
  ]},
  gage_linearity:       { label: 'Gage Linearity & Bias',       params: [
    { name: 'part_col',          kind: 'col' },
    { name: 'reference_col',     kind: 'col', numeric: true },
    { name: 'measurement_col',   kind: 'col', numeric: true },
    { name: 'process_variation', kind: 'num', optional: true,
      help: 'Optional. 6σ from the GR&R study; lets bias/linearity be reported as % of total process variation.' },
  ]},
  // ─── Leap-ahead batch ───
  survival:             { label: 'Kaplan-Meier + log-rank',     params: [
    { name: 'time_col',  kind: 'col', numeric: true },
    { name: 'event_col', kind: 'col', numeric: true,
      help: '1 = event observed (failure / death), 0 = censored.' },
    { name: 'group_col', kind: 'col', optional: true,
      help: 'If supplied, fits a curve per group + log-rank test.' },
  ]},
  mixed_effects:        { label: 'Mixed / correlated models (LMM · GEE · GLMM)',  params: [
    { name: 'method', kind: 'enum', options: ['lmm', 'gee', 'glmm'],
      help: 'lmm = linear mixed (normal y); gee = population-averaged (marginal); glmm = generalized mixed (binary/count y).' },
    { name: 'fixed', kind: 'string',
      help: "Statsmodels formula, e.g. 'y ~ x + treatment'" },
    { name: 'group', kind: 'col',
      help: 'Grouping column — random-effects unit (lmm/glmm) or cluster (gee), e.g. subject_id.' },
    { name: 'random', kind: 'string', optional: true, defaultValue: '1',
      help: "lmm only — random-effects formula. '1' = random intercept; '1 + x' = random slope on x." },
    { name: 'reml', kind: 'bool', optional: true, defaultValue: true,
      help: 'lmm only.' },
    { name: 'family', kind: 'enum', optional: true,
      options: ['', 'gaussian', 'binomial', 'poisson', 'gamma'],
      help: 'gee/glmm — response distribution. glmm supports binomial or poisson.' },
    { name: 'cov_struct', kind: 'enum', optional: true,
      options: ['', 'exchangeable', 'independence', 'ar1', 'unstructured'],
      help: 'gee only — working correlation structure within a cluster.' },
  ]},
  cost_pareto:          { label: 'Cost-weighted Pareto',        params: [
    { name: 'category_col', kind: 'col' },
    { name: 'cost_col',     kind: 'col', numeric: true },
    { name: 'count_col',    kind: 'col', optional: true,
      help: 'If supplied, sums this column instead of row counts as the frequency metric.' },
  ]},
  ternary:              { label: 'Mixture ternary contour',     params: [
    { name: 'components', kind: 'cols',
      help: 'Exactly 3 mixture-component columns (proportions summing to 1).' },
    { name: 'response',   kind: 'col', numeric: true },
  ]},
  bootstrap_effect:     { label: 'Bootstrap effect-size CI',    params: [
    { name: 'column',    kind: 'col', numeric: true },
    { name: 'group_col', kind: 'col' },
    { name: 'kind',      kind: 'enum',
      options: ['cohens_d','glass_delta','hedges_g','rank_biserial','eta_squared','cles'],
      defaultValue: 'cohens_d' },
    { name: 'n_boot',    kind: 'num', optional: true, defaultValue: 2000 },
    { name: 'alpha',     kind: 'num', optional: true, defaultValue: 0.05 },
  ]},
  variability_gauge:    { label: 'Variability gauge chart',     params: [
    { name: 'measurement_col', kind: 'col', numeric: true },
    { name: 'part_col',        kind: 'col' },
    { name: 'operator_col',    kind: 'col', optional: true },
  ]},
  // ─── Final completion batch ───
  bayesian:             { label: 'Bayesian inference',          params: [
    { name: 'method', kind: 'enum',
      options: ['beta_binomial','normal_normal','best_two_sample','bayes_factor_ttest'],
      defaultValue: 'best_two_sample' },
    { name: 'column',    kind: 'col', numeric: true,
      help: 'For beta_binomial: a 0/1 column. For others: the numeric measurement.' },
    { name: 'group_col', kind: 'col', optional: true,
      help: 'Required for BEST and 2-sample Bayes factor.' },
    { name: 'prior_alpha', kind: 'num', optional: true, defaultValue: 1.0,
      help: 'Beta-binomial only.' },
    { name: 'prior_beta',  kind: 'num', optional: true, defaultValue: 1.0,
      help: 'Beta-binomial only.' },
    { name: 'prior_mean',  kind: 'num', optional: true,
      help: 'Normal-normal only.' },
    { name: 'prior_se',    kind: 'num', optional: true,
      help: 'Normal-normal only — leave blank for an improper flat prior.' },
    { name: 'mu0',         kind: 'num', optional: true, defaultValue: 0.0,
      help: 'Bayes factor only — H0 mean.' },
    { name: 'n_draws',     kind: 'num', optional: true, defaultValue: 20000,
      help: 'BEST only — Monte-Carlo posterior draws.' },
    { name: 'r',           kind: 'num', optional: true, defaultValue: 0.707,
      help: 'JZS Cauchy prior scale (BF only).' },
  ]},
};

// rm_anova is exposed as a hypothesis_test inner; no top-level kind needed,
// but we extend the hypothesis_test param list inline below.

function applyChosenTest(kind) {
  // Map chooser-recommendation → (form kind, inner test/method, inner param name).
  // Every test the chooser can recommend MUST appear here, otherwise clicking
  // "Use this test" silently sets state to a kind ANALYSIS_KINDS doesn't know
  // and the form falls back to whatever was previously selected.
  const FORM_MAP = {
    // ── hypothesis_test (test=...) ──────────────────────────────────────
    one_sample_t:               ['hypothesis_test', 'one_sample_t',               'test'],
    two_sample_t:               ['hypothesis_test', 'two_sample_t',               'test'],
    paired_t:                   ['hypothesis_test', 'paired_t',                   'test'],
    one_way_anova:              ['hypothesis_test', 'one_way_anova',              'test'],
    two_way_anova:              ['hypothesis_test', 'two_way_anova',              'test'],
    mann_whitney:               ['hypothesis_test', 'mann_whitney',               'test'],
    kruskal:                    ['hypothesis_test', 'kruskal',                    'test'],
    wilcoxon_signed_rank:       ['hypothesis_test', 'wilcoxon_signed_rank',       'test'],
    sign_test:                  ['hypothesis_test', 'sign_test',                  'test'],
    mood_median:                ['hypothesis_test', 'mood_median',                'test'],
    levene:                     ['hypothesis_test', 'levene',                     'test'],
    bartlett:                   ['hypothesis_test', 'bartlett',                   'test'],
    f_test_variances:           ['hypothesis_test', 'f_test_variances',           'test'],
    chi_square:                 ['hypothesis_test', 'chi_square',                 'test'],
    fisher_exact:               ['hypothesis_test', 'fisher_exact',               'test'],
    mcnemar:                    ['hypothesis_test', 'mcnemar',                    'test'],
    one_proportion:             ['hypothesis_test', 'one_proportion',             'test'],
    two_proportions:            ['hypothesis_test', 'two_proportions',            'test'],
    anderson_darling_normality: ['hypothesis_test', 'anderson_darling_normality', 'test'],
    ryan_joiner:                ['hypothesis_test', 'ryan_joiner',                'test'],
    kolmogorov_smirnov_normal:  ['hypothesis_test', 'kolmogorov_smirnov_normal',  'test'],
    tost_one_sample:            ['hypothesis_test', 'tost_one_sample',            'test'],
    tost_two_sample:            ['hypothesis_test', 'tost_two_sample',            'test'],
    friedman:                   ['hypothesis_test', 'friedman',                   'test'],
    runs:                       ['hypothesis_test', 'runs',                       'test'],
    grubbs:                     ['hypothesis_test', 'grubbs',                     'test'],
    dixon_q:                    ['hypothesis_test', 'dixon_q',                    'test'],

    // ── post-hoc ────────────────────────────────────────────────────────
    tukey_hsd:    ['posthoc', 'tukey_hsd',    'test'],
    fisher_lsd:   ['posthoc', 'fisher_lsd',   'test'],
    games_howell: ['posthoc', 'games_howell', 'test'],
    dunnett:      ['posthoc', 'dunnett',      'test'],
    hsu_mcb:      ['posthoc', 'hsu_mcb',      'test'],

    // ── capability family ──────────────────────────────────────────────
    capability:           ['capability',  null,                          null],
    capability_box_cox:   ['capability',  'box-cox',                     'transform'],
    poisson_capability:   ['attribute_capability', 'poisson',            'method'],
    binomial_capability:  ['attribute_capability', 'binomial',           'method'],

    // ── control charts (kind=...) ──────────────────────────────────────
    control_chart_imr:    ['control_chart', 'I-MR',    'kind'],
    control_chart_xbar_r: ['control_chart', 'X-bar/R', 'kind'],
    control_chart_cusum:  ['control_chart', 'CUSUM',   'kind'],
    control_chart_ewma:   ['control_chart', 'EWMA',    'kind'],
    control_chart_p:      ['control_chart', 'p',       'kind'],
    control_chart_u:      ['control_chart', 'u',       'kind'],

    // ── regression family ──────────────────────────────────────────────
    regression:           ['regression', null, null],
    fitted_line:          ['regression', null, null],

    // ── MSA / reliability / pareto ─────────────────────────────────────
    msa:                  ['msa',         null, null],
    pareto:               ['pareto',      null, null],
    auto_rca:             ['pareto',      null, null],
    reliability:          ['reliability', 'weibull',     'distribution'],

    // ── multivariate (method=...) ──────────────────────────────────────
    pca:                  ['multivariate', 'pca',          'method'],
    kmeans:               ['multivariate', 'kmeans',       'method'],
    lda:                  ['multivariate', 'lda',          'method'],
    hierarchical_cluster: ['multivariate', 'hierarchical', 'method'],
    hotelling:            ['multivariate', 'hotelling',    'method'],

    // ── DOE design recommendations → drop the user into the design tool ─
    full_factorial:           ['__tool__', 'doe_design', null],
    plackett_burman:          ['__tool__', 'doe_design', null],
    central_composite:        ['__tool__', 'doe_design', null],
    box_behnken:              ['__tool__', 'doe_design', null],
    definitive_screening:     ['__tool__', 'doe_design', null],
    mixture_simplex_centroid: ['__tool__', 'doe_design', null],
  };

  const entry = FORM_MAP[kind];
  if (!entry) {
    toast({ kind: 'warn', msg: `“${kind}” isn’t wired into the form yet — open it manually from the rail.` });
    return;
  }
  const [target, inner, innerParam] = entry;
  if (target === '__tool__') {
    state.view = 'tools';
    state._toolKind = inner;
    render();
    toast({ kind: 'success', msg: `Opened ${(TOOLS_INDEX.find(t => t.id === inner) || {}).label || inner}.` });
    return;
  }
  state._chosenKind = target;
  state._chosenInnerKind = inner;
  state._chosenInnerParam = innerParam;
  state.view = 'analyze';
  state.formOpen = true;
  // Sync the family rail to whatever family the chosen kind belongs to.
  const fam = ANALYSIS_FAMILIES.find(f => (f.kinds || []).includes(target));
  if (fam) state._analysisFamily = fam.id;
  render();
  const label = window.statsUx?.KIND_LABEL?.[inner] || window.statsUx?.KIND_LABEL?.[kind]
              || ANALYSIS_KINDS[target]?.label || target;
  toast({ kind: 'success', msg: `Form set: ${label}` });
}

// Methodological provenance — every analysis Bench computes, mapped to the
// underlying library function + a citation. Lets the comparison page link to
// proof rather than make claims. Counts shipped: 27 hypothesis tests, 9
// control charts, 6 post-hoc methods, 10 distribution fits, 11 sample-size
// cases — total 108+ verified test paths.
const METHODS_INDEX = [
  { category: 'Hypothesis testing', count: 27, methods: [
    { name: 'One-sample t',        lib: 'scipy.stats.ttest_1samp',            ref: 'Student (1908)' },
    { name: 'Two-sample t (Welch)',lib: 'scipy.stats.ttest_ind(equal_var=False)', ref: 'Welch (1947)' },
    { name: 'Paired t',            lib: 'scipy.stats.ttest_rel',              ref: 'Student (1908)' },
    { name: 'One-way ANOVA',       lib: 'scipy.stats.f_oneway',               ref: 'Fisher (1925)' },
    { name: 'Two-way ANOVA',       lib: 'statsmodels.formula.api.ols',        ref: 'Fisher (1925)' },
    { name: 'Mann-Whitney U',      lib: 'scipy.stats.mannwhitneyu',           ref: 'Mann & Whitney (1947)' },
    { name: 'Wilcoxon signed-rank',lib: 'scipy.stats.wilcoxon',               ref: 'Wilcoxon (1945)' },
    { name: 'Kruskal-Wallis',      lib: 'scipy.stats.kruskal',                ref: 'Kruskal & Wallis (1952)' },
    { name: 'Sign test',           lib: 'scipy.stats.binomtest',              ref: 'Arbuthnot (1710)' },
    { name: 'Mood\'s median',      lib: 'scipy.stats.median_test',            ref: 'Mood (1954)' },
    { name: 'Levene',              lib: 'scipy.stats.levene',                 ref: 'Levene (1960)' },
    { name: 'Bartlett',            lib: 'scipy.stats.bartlett',               ref: 'Bartlett (1937)' },
    { name: 'F-test of variances', lib: 'scipy.stats.f',                      ref: 'Fisher (1924)' },
    { name: 'Chi-square',          lib: 'scipy.stats.chi2_contingency',       ref: 'Pearson (1900)' },
    { name: 'Fisher\'s exact',     lib: 'scipy.stats.fisher_exact',           ref: 'Fisher (1922)' },
    { name: '1-proportion (exact)',lib: 'scipy.stats.binomtest',              ref: 'Clopper-Pearson (1934)' },
    { name: '2-proportion',        lib: 'statsmodels.stats.proportions_ztest', ref: 'Agresti & Caffo (2000)' },
    { name: 'Anderson-Darling',    lib: 'scipy.stats.anderson',               ref: 'Stephens (1974)' },
    { name: 'Ryan-Joiner',         lib: 'custom · Pearson r vs normal scores', ref: 'Ryan & Joiner (1976)' },
    { name: 'Kolmogorov-Smirnov',  lib: 'scipy.stats.kstest',                 ref: 'Kolmogorov (1933)' },
    { name: 'TOST (one/two)',      lib: 'statsmodels.stats.weightstats',      ref: 'Schuirmann (1987)' },
    { name: 'Friedman',            lib: 'scipy.stats.friedmanchisquare',      ref: 'Friedman (1937)' },
    { name: 'Runs test',           lib: 'statsmodels.sandbox.stats.runs',     ref: 'Wald & Wolfowitz (1940)' },
    { name: 'Grubbs',              lib: 'custom · max |z| vs G_critical',     ref: 'Grubbs (1950)' },
    { name: 'Dixon Q',             lib: 'custom · Dixon ratio',               ref: 'Dixon (1953)' },
  ]},
  { category: 'Control charts', count: 9, methods: [
    { name: 'I-MR',                lib: 'custom · Shewhart',                  ref: 'Shewhart (1931); AIAG SPC' },
    { name: 'X-bar/R',             lib: 'custom · Shewhart',                  ref: 'Shewhart (1931); AIAG SPC' },
    { name: 'X-bar/S',             lib: 'custom · Shewhart',                  ref: 'Shewhart (1931); AIAG SPC' },
    { name: 'p / np / c / u',      lib: 'custom · attribute charts',          ref: 'Shewhart (1931); Montgomery (2012)' },
    { name: 'CUSUM',               lib: 'custom · tabular CUSUM',             ref: 'Page (1954); Hawkins & Olwell (1998)' },
    { name: 'EWMA',                lib: 'custom · λ-weighted recursion',      ref: 'Roberts (1959)' },
    { name: 'Hotelling T² (multivariate)', lib: 'custom · scipy.stats',        ref: 'Hotelling (1947)' },
    { name: 'MEWMA',               lib: 'custom · vector EWMA',               ref: 'Lowry et al. (1992)' },
    { name: 'Western Electric / Nelson rules', lib: 'custom',                  ref: 'WECO (1958); Nelson (1984)' },
  ]},
  { category: 'Capability & measurement', count: 8, methods: [
    { name: 'Cp / Cpk / Pp / Ppk', lib: 'custom · per Montgomery',            ref: 'Kane (1986); AIAG PPAP; Montgomery (2012)' },
    { name: 'Cpm (Taguchi)',       lib: 'custom',                             ref: 'Chan, Cheng, Spiring (1988)' },
    { name: 'Z-bench',             lib: 'custom · inverse normal',            ref: 'Six Sigma (Motorola, 1986)' },
    { name: 'Box-Cox transform',   lib: 'scipy.stats.boxcox',                 ref: 'Box & Cox (1964)' },
    { name: 'Attribute capability (binomial)', lib: 'scipy.stats.binomtest',  ref: 'AIAG SPC' },
    { name: 'Attribute capability (Poisson)',  lib: 'scipy.stats.poisson',    ref: 'AIAG SPC' },
    { name: 'Tolerance interval (normal)',     lib: 'custom · k-factor table', ref: 'Howe (1969); ISO 16269-6' },
    { name: 'Tolerance interval (non-parametric)', lib: 'scipy.stats.beta',   ref: 'Wilks (1941)' },
  ]},
  { category: 'Gauge R&R / MSA', count: 1, methods: [
    { name: 'Crossed / nested / expanded GR&R', lib: 'statsmodels.MixedLM', ref: 'AIAG MSA Reference Manual' },
  ]},
  { category: 'Regression', count: 5, methods: [
    { name: 'OLS',                 lib: 'statsmodels.OLS',                    ref: 'Gauss (1809)' },
    { name: 'GLM',                 lib: 'statsmodels.GLM',                    ref: 'Nelder & Wedderburn (1972)' },
    { name: 'Logistic',            lib: 'statsmodels.Logit',                  ref: 'Cox (1958)' },
    { name: 'Poisson',             lib: 'statsmodels.GLM(family=Poisson)',    ref: 'Nelder & Wedderburn (1972)' },
    { name: 'Stepwise / best-subsets', lib: 'custom · AIC search',            ref: 'Efroymson (1960); Miller (2002)' },
  ]},
  { category: 'Design of Experiments', count: 8, methods: [
    { name: 'Full factorial',      lib: 'custom · Yates order',               ref: 'Box, Hunter & Hunter (1978)' },
    { name: 'Fractional factorial',lib: 'custom · generator-driven',          ref: 'Box & Hunter (1961)' },
    { name: 'Plackett-Burman',     lib: 'custom · Hadamard matrices',         ref: 'Plackett & Burman (1946)' },
    { name: 'Central Composite (CCD)', lib: 'custom',                         ref: 'Box & Wilson (1951)' },
    { name: 'Box-Behnken',         lib: 'custom',                             ref: 'Box & Behnken (1960)' },
    { name: 'Mixture (simplex)',   lib: 'custom',                             ref: 'Scheffé (1958)' },
    { name: 'Definitive screening',lib: 'custom',                             ref: 'Jones & Nachtsheim (2011)' },
    { name: 'Derringer-Suich desirability', lib: 'scipy.optimize.minimize',   ref: 'Derringer & Suich (1980)' },
  ]},
  { category: 'Reliability', count: 9, methods: [
    { name: 'Weibull (MLE + censoring)', lib: 'custom · MLE',                 ref: 'Weibull (1951); Meeker & Escobar (1998)' },
    { name: 'Exponential',         lib: 'custom · MLE',                       ref: 'Epstein (1953)' },
    { name: 'Lognormal',           lib: 'scipy.stats.lognorm',                ref: 'Galton (1879)' },
    { name: 'Gamma',               lib: 'scipy.stats.gamma',                  ref: 'Pearson (1893)' },
    { name: 'Log-logistic',        lib: 'scipy.stats.fisk',                   ref: 'Fisk (1961)' },
    { name: 'Smallest extreme value', lib: 'scipy.stats.gumbel_l',            ref: 'Gumbel (1958)' },
    { name: 'Largest extreme value',  lib: 'scipy.stats.gumbel_r',            ref: 'Gumbel (1958)' },
    { name: 'Generalized extreme value', lib: 'scipy.stats.genextreme',       ref: 'Coles (2001)' },
    { name: 'Arrhenius accelerated life', lib: 'statsmodels.OLS',             ref: 'Nelson (1990)' },
  ]},
  { category: 'Multivariate', count: 5, methods: [
    { name: 'PCA',                 lib: 'sklearn / numpy SVD',                ref: 'Pearson (1901); Hotelling (1933)' },
    { name: 'K-means',             lib: 'sklearn.cluster.KMeans',             ref: 'MacQueen (1967)' },
    { name: 'LDA',                 lib: 'sklearn.LinearDiscriminantAnalysis', ref: 'Fisher (1936)' },
    { name: 'Hierarchical',        lib: 'scipy.cluster.hierarchy',            ref: 'Ward (1963)' },
    { name: 'Hotelling T²',        lib: 'custom · scipy.stats',               ref: 'Hotelling (1947)' },
  ]},
  { category: 'Time series', count: 6, methods: [
    { name: 'Holt-Winters / exp smoothing', lib: 'statsmodels.tsa.holtwinters', ref: 'Winters (1960)' },
    { name: 'ARIMA',               lib: 'statsmodels.tsa.arima.model',        ref: 'Box & Jenkins (1970)' },
    { name: 'Auto-ARIMA',          lib: 'custom · AIC search',                ref: 'Hyndman & Khandakar (2008)' },
    { name: 'Decomposition',       lib: 'statsmodels.tsa.seasonal_decompose', ref: 'Cleveland (1990)' },
    { name: 'ACF / PACF',          lib: 'statsmodels.tsa.stattools',          ref: 'Box & Jenkins (1970)' },
    { name: 'Cross-correlation',   lib: 'statsmodels.tsa.stattools.ccf',      ref: 'Box & Jenkins (1970)' },
  ]},
  { category: 'Post-hoc multiple comparisons', count: 6, methods: [
    { name: 'Tukey HSD',           lib: 'statsmodels.stats.pairwise_tukeyhsd', ref: 'Tukey (1949)' },
    { name: 'Fisher LSD',          lib: 'custom · pooled t',                  ref: 'Fisher (1935)' },
    { name: 'Games-Howell',        lib: 'custom · Welch + studentised range', ref: 'Games & Howell (1976)' },
    { name: "Dunn's test",         lib: 'custom · scipy.stats.rankdata',      ref: 'Dunn (1964)' },
    { name: 'Dunnett (Bonferroni)',lib: 'custom · scipy.stats.t',             ref: 'Dunnett (1955)' },
    { name: 'Hsu MCB',             lib: 'custom · MCB',                       ref: 'Hsu (1984)' },
  ]},
  { category: 'Sample size & power', count: 11, methods: [
    { name: 't-test (1/2-sample)', lib: 'custom · z-approx',                  ref: 'Cohen (1988)' },
    { name: 'Proportion (1/2)',    lib: 'custom · z-approx',                  ref: 'Fleiss (1981)' },
    { name: 'ANOVA',               lib: 'scipy.stats.ncf',                    ref: 'Cohen (1988)' },
    { name: 'Regression (R²)',     lib: 'scipy.stats.ncf',                    ref: 'Cohen (1988)' },
    { name: 'Chi-square',          lib: 'scipy.stats.ncx2',                   ref: 'Cohen (1988)' },
    { name: 'Equivalence (TOST)',  lib: 'custom · z-approx',                  ref: 'Schuirmann (1987)' },
    { name: 'Log-rank (survival)', lib: 'custom · Schoenfeld',                ref: 'Schoenfeld (1983)' },
    { name: 'Cluster-randomized',  lib: 'custom · design effect',             ref: 'Donner & Klar (2000)' },
    { name: 'Cpk validation CI',   lib: 'custom · Bissell',                   ref: 'Bissell (1990)' },
    { name: 'Variance test',       lib: 'custom · z-approx',                  ref: 'NIST SEMATECH 1.3.5.9' },
    { name: 'Correlation (r ≠ 0)', lib: 'custom · Fisher z',                  ref: 'Fisher (1921)' },
    { name: 'Finite population correction', lib: 'custom · Cochran',          ref: 'Cochran (1977)' },
  ]},
  { category: 'Specialty', count: 5, methods: [
    { name: 'Pareto',              lib: 'pandas + custom',                    ref: 'Pareto (1896); Juran (1951)' },
    { name: 'DPMO ↔ sigma',        lib: 'scipy.stats.norm',                   ref: 'Six Sigma (Motorola, 1986)' },
    { name: 'Distribution identifier', lib: 'scipy.stats · A² ranking',       ref: 'Stephens (1974)' },
    { name: 'Acceptance sampling', lib: 'scipy.stats.binom / hypergeom',      ref: 'ANSI/ASQ Z1.4' },
    { name: 'ANOM',                lib: 'scipy.stats.f',                      ref: 'Ott (1967)' },
  ]},
  // ── Bench-only additions vs Minitab/JMP ──
  { category: 'Survival & reliability (extended)', count: 4, methods: [
    { name: 'Kaplan-Meier estimator', lib: 'custom · cumulative product',     ref: 'Kaplan & Meier (1958)' },
    { name: 'Log-rank test (k-sample)', lib: 'custom · hypergeometric variance', ref: 'Mantel (1966); Peto & Peto (1972)' },
    { name: 'Cox proportional hazards', lib: 'custom · Breslow partial likelihood', ref: 'Cox (1972); Breslow (1974)' },
    { name: 'Restricted mean survival time', lib: 'custom · area under KM',   ref: 'Royston & Parmar (2013)' },
  ]},
  { category: 'Advanced regression', count: 5, methods: [
    { name: 'Random Forest + permutation importance', lib: 'scikit-learn',    ref: 'Breiman (2001); Strobl et al. (2008)' },
    { name: 'Linear mixed-effects (LMM)', lib: 'statsmodels.MixedLM (REML)',  ref: 'Pinheiro & Bates (2000); Laird & Ware (1982)' },
    { name: 'Robust regression (Huber)', lib: 'statsmodels.RLM',              ref: 'Huber (1964)' },
    { name: 'Quantile regression',     lib: 'statsmodels.QuantReg',           ref: 'Koenker & Bassett (1978)' },
    { name: 'Variance Inflation Factor', lib: 'custom · 1/(1−R²)',            ref: 'Belsley, Kuh & Welsch (1980)' },
  ]},
  { category: 'Effect sizes & decision support', count: 6, methods: [
    { name: 'Cohen\'s d / dz / h',    lib: 'custom',                           ref: 'Cohen (1988)' },
    { name: 'Hedges\' g (small-sample correction)', lib: 'custom',             ref: 'Hedges (1981)' },
    { name: 'Rank-biserial r (Mann-Whitney)', lib: 'custom',                   ref: 'Glass (1965); Kerby (2014)' },
    { name: 'ε² / ω² for ANOVA',      lib: 'custom',                           ref: 'Hays (1963); Kelley (1935)' },
    { name: 'Cramér\'s V',            lib: 'custom',                           ref: 'Cramér (1946)' },
    { name: 'Post-hoc power',         lib: 'scipy.stats.nct / scipy.stats.ncf', ref: 'Cohen (1988); Faul et al. (2007)' },
  ]},
  { category: 'MSA (extended)', count: 4, methods: [
    { name: 'Attribute Agreement (Cohen\'s κ)', lib: 'custom',                 ref: 'Cohen (1960); Landis & Koch (1977)' },
    { name: 'Attribute Agreement (Fleiss\' κ)', lib: 'custom',                 ref: 'Fleiss (1971)' },
    { name: 'Gage Linearity & Bias',  lib: 'custom · per-part t + slope regression', ref: 'AIAG MSA 4th ed. (2010)' },
    { name: 'Variability gauge chart', lib: 'custom · matplotlib',             ref: 'AIAG MSA 4th ed.' },
  ]},
  { category: 'Time series (extended)', count: 1, methods: [
    { name: 'Changepoint detection (PELT)', lib: 'custom · L2 cost',           ref: 'Killick, Fearnhead & Eckley (2012)' },
  ]},
  { category: 'DOE (extended)', count: 4, methods: [
    { name: 'Mixture ternary contour', lib: 'custom · Scheffé quadratic',     ref: 'Scheffé (1958); Cornell (2002)' },
    { name: 'Taguchi orthogonal arrays (L4, L8, L9, L12, L16)', lib: 'custom', ref: 'Taguchi (1986); Roy (2001)' },
    { name: 'Taguchi signal-to-noise', lib: 'custom · larger/smaller/nominal', ref: 'Taguchi (1986)' },
    { name: 'Mixture simplex-lattice / -centroid', lib: 'custom',              ref: 'Scheffé (1963)' },
  ]},
  { category: 'Tukey letters & post-hoc (extended)', count: 1, methods: [
    { name: 'Tukey HSD compact letter display', lib: 'custom · maximal cliques', ref: 'Piepho (2004)' },
  ]},
  { category: 'Resampling', count: 2, methods: [
    { name: 'Bootstrap CI (BCa)',     lib: 'custom · jackknife acceleration',  ref: 'Efron (1987)' },
    { name: 'Bootstrap effect-size CI', lib: 'custom · paired resampling',     ref: 'Kirby & Gerlanc (2013)' },
  ]},
  { category: 'Pre-flight, narrative & follow-ups (Bench-only)', count: 3, methods: [
    { name: 'Auto-assumption pre-flight', lib: 'custom · Shapiro / Levene / Cochran rules', ref: 'AIAG; Minitab Assistant playbook' },
    { name: 'Decision-grade headline',  lib: 'custom · rule grid (3×3 sig × effect)', ref: 'Wasserstein & Lazar (2016) on p-values' },
    { name: 'Auto-follow-up rules',     lib: 'custom · result → next-step table', ref: 'Conyso original' },
  ]},
  { category: 'Conyso Originals (LSS-specific)', count: 5, methods: [
    { name: 'Variance Budget (η² decomp)', lib: 'custom',                      ref: 'Conyso original' },
    { name: 'Capability Trajectory',  lib: 'custom · what-if Cpk scenarios',   ref: 'Conyso original' },
    { name: 'RPN Heat Bubbles (FMEA)', lib: 'custom',                          ref: 'AIAG FMEA 4th ed. (2008)' },
    { name: 'Sigma Slippage (rolling Cpk)', lib: 'custom',                     ref: 'Conyso original' },
    { name: 'Cost-weighted Pareto',   lib: 'custom · dual-axis Pareto',        ref: 'Conyso original' },
  ]},
  { category: 'Advanced models & commercial-parity methods', count: 10, methods: [
    { name: 'Ridge / Lasso / Elastic-net', lib: 'sklearn.linear_model (RidgeCV/LassoCV/ElasticNetCV)', ref: 'Hoerl & Kennard (1970); Tibshirani (1996); Zou & Hastie (2005)' },
    { name: 'GEE (population-averaged)', lib: 'statsmodels.genmod.GEE',          ref: 'Liang & Zeger (1986)' },
    { name: 'GLMM (Bayesian mixed GLM)', lib: 'statsmodels.genmod.bayes_mixed_glm', ref: 'Breslow & Clayton (1993)' },
    { name: 'MANOVA',                  lib: 'statsmodels.multivariate.MANOVA',   ref: 'Wilks (1932); Pillai (1955)' },
    { name: 'Exploratory factor analysis', lib: 'sklearn.decomposition.FactorAnalysis + varimax', ref: 'Kaiser (1958)' },
    { name: 'G chart (rare-event count)', lib: 'custom · geometric probability limits', ref: 'Benneyan (2001)' },
    { name: 'T chart (time-between)',  lib: "custom · Nelson y=t^(1/3.6) transform", ref: 'Nelson (1994)' },
    { name: 'Power & sample-size curves', lib: 'statsmodels.stats.power (noncentral)', ref: 'Cohen (1988)' },
    { name: 'D-/I-optimal custom DOE', lib: 'custom · Fedorov exchange algorithm', ref: 'Fedorov (1972); Mitchell (1974)' },
    { name: 'Cpk/Ppk confidence intervals', lib: 'custom · Bissell large-sample SE', ref: 'Bissell (1990)' },
  ]},
  { category: 'Numerical validation', count: 1, methods: [
    { name: 'NIST StRD certification', lib: 'engine vs. NIST certified values',  ref: 'NIST Statistical Reference Datasets' },
  ]},
];

// Auto-decorate every METHODS_INDEX row with its analyser kind so the
// Methods page becomes a launchpad (one click → open the analyser).
(function _crosslinkMethods() {
  const HT = (inner) => ({ kind: 'hypothesis_test', inner, innerParam: 'test' });
  const PH = (inner) => ({ kind: 'posthoc',         inner, innerParam: 'test' });
  const CC = (inner) => ({ kind: 'control_chart',   inner, innerParam: 'kind' });
  const RG = (inner) => ({ kind: 'regression',      inner, innerParam: 'method' });
  const RL = (inner) => ({ kind: 'reliability',     inner, innerParam: 'distribution' });
  const MV = (inner) => ({ kind: 'multivariate',    inner, innerParam: 'method' });
  const TS = (inner) => ({ kind: 'time_series',     inner, innerParam: 'method' });
  const SS = (toolKind) => ({ kind: null, toolKind });   // tool-only links
  const NAME_TO_LINK = {
    // Hypothesis testing
    'One-sample t': HT('one_sample_t'),
    'Two-sample t (Welch)': HT('two_sample_t'),
    'Paired t': HT('paired_t'),
    'One-way ANOVA': HT('one_way_anova'),
    'Two-way ANOVA': HT('two_way_anova'),
    'Mann-Whitney U': HT('mann_whitney'),
    'Wilcoxon signed-rank': HT('wilcoxon_signed_rank'),
    'Kruskal-Wallis': HT('kruskal'),
    'Sign test': HT('sign_test'),
    "Mood's median": HT('mood_median'),
    'Levene': HT('levene'),
    'Bartlett': HT('bartlett'),
    'F-test of variances': HT('f_test_variances'),
    'Chi-square': HT('chi_square'),
    "Fisher's exact": HT('fisher_exact'),
    '1-proportion (exact)': HT('one_proportion'),
    '2-proportion': HT('two_proportions'),
    'Anderson-Darling': HT('anderson_darling_normality'),
    'Ryan-Joiner': HT('ryan_joiner'),
    'Kolmogorov-Smirnov': HT('kolmogorov_smirnov_normal'),
    'TOST (one/two)': HT('tost_one_sample'),
    'Friedman': HT('friedman'),
    'Runs test': HT('runs'),
    'Grubbs': HT('grubbs'),
    'Dixon Q': HT('dixon_q'),
    // Control charts
    'I-MR': CC('I-MR'),
    'X-bar/R': CC('X-bar/R'),
    'X-bar/S': CC('X-bar/S'),
    'p / np / c / u': CC('p'),
    "Laney p′ (overdispersion-adjusted)": CC("Laney p'"),
    'CUSUM': CC('CUSUM'),
    'EWMA': CC('EWMA'),
    'Hotelling T² (multivariate)': CC('T2'),
    'MEWMA': CC('MEWMA'),
    'Z-MR (short-run)': CC('Z-MR'),
    // Capability
    'Cp / Cpk / Pp / Ppk': { kind: 'capability' },
    'Cpm (Taguchi)':       { kind: 'capability' },
    'Z-bench':             { kind: 'capability' },
    'Box-Cox transform':   { kind: 'capability', inner: 'box-cox', innerParam: 'transform' },
    'Attribute capability (binomial)': { kind: 'attribute_capability', inner: 'binomial', innerParam: 'method' },
    'Attribute capability (Poisson)':  { kind: 'attribute_capability', inner: 'poisson',  innerParam: 'method' },
    'Tolerance interval (normal)':         { kind: 'tolerance', inner: 'normal',        innerParam: 'method' },
    'Tolerance interval (non-parametric)': { kind: 'tolerance', inner: 'nonparametric', innerParam: 'method' },
    // GR&R
    'Crossed / nested / expanded GR&R': { kind: 'msa' },
    // Regression
    'OLS':            RG('ols'),
    'GLM':            RG('glm'),
    'Logistic':       RG('logistic'),
    'Poisson':        RG('poisson'),
    'Stepwise / best-subsets': RG('stepwise'),
    // DOE
    'Full factorial':            { view: 'tools', toolKind: 'doe_design' },
    'Fractional factorial':      { view: 'tools', toolKind: 'doe_design' },
    'Plackett-Burman':           { view: 'tools', toolKind: 'doe_design' },
    'Central Composite (CCD)':   { view: 'tools', toolKind: 'doe_design' },
    'Box-Behnken':               { view: 'tools', toolKind: 'doe_design' },
    'Mixture (simplex)':         { view: 'tools', toolKind: 'doe_design' },
    'Definitive screening':      { view: 'tools', toolKind: 'doe_design' },
    'Derringer-Suich desirability': { kind: 'desirability' },
    // Reliability
    'Weibull (MLE + censoring)':   RL('weibull'),
    'Exponential':                 RL('exponential'),
    'Lognormal':                   RL('lognormal'),
    'Gamma':                       RL('gamma'),
    'Log-logistic':                RL('log_logistic'),
    'Smallest extreme value':      RL('smallest_extreme_value'),
    'Largest extreme value':       RL('largest_extreme_value'),
    'Generalized extreme value':   RL('gev'),
    'Arrhenius accelerated life':  RL('arrhenius'),
    // Multivariate
    'PCA': MV('pca'),
    'K-means': MV('kmeans'),
    'LDA': MV('lda'),
    'Hierarchical': MV('hierarchical'),
    'Hotelling T²': MV('hotelling'),
    // Time series
    'Holt-Winters / exp smoothing': TS('exp_smoothing'),
    'ARIMA':                        TS('arima'),
    'Auto-ARIMA':                   TS('auto_arima'),
    'Decomposition':                TS('decompose'),
    'ACF / PACF':                   TS('acf_pacf'),
    'Cross-correlation':            TS('cross_correlation'),
    // Post-hoc
    'Tukey HSD':       PH('tukey_hsd'),
    'Fisher LSD':      PH('fisher_lsd'),
    'Games-Howell':    PH('games_howell'),
    "Dunn's test":     PH('dunn'),
    'Dunnett (Bonferroni)': PH('dunnett'),
    'Hsu MCB':         PH('hsu_mcb'),
    // Sample size & power → Tools calculator
    't-test (1/2-sample)':     SS('sample_size'),
    'Proportion (1/2)':        SS('sample_size'),
    'ANOVA':                   SS('sample_size'),
    'Regression (R²)':         SS('sample_size'),
    'Chi-square':              SS('sample_size'),
    'Equivalence (TOST)':      SS('sample_size'),
    'Log-rank (survival)':     SS('sample_size'),
    'Cluster-randomized':      SS('sample_size'),
    'Cpk validation CI':       SS('sample_size'),
    'Variance test':           SS('sample_size'),
    'Correlation (r ≠ 0)':     SS('sample_size'),
    'Finite population correction': SS('sample_size'),
    // Specialty
    'Pareto':                  { kind: 'pareto' },
    'DPMO ↔ sigma':            { view: 'tools', toolKind: 'dpmo' },
    'Distribution identifier': { kind: 'distribution_id' },
    'Acceptance sampling':     { view: 'tools', toolKind: 'acceptance' },
    'ANOM':                    { kind: 'anom' },
  };
  for (const cat of METHODS_INDEX) {
    for (const m of cat.methods) {
      const link = NAME_TO_LINK[m.name];
      if (!link) continue;
      m.kind       = link.kind || null;
      m.inner      = link.inner || null;
      m.innerParam = link.innerParam || null;
      m.toolKind   = link.toolKind || null;
      m.targetView = link.view || null;
    }
  }
})();

// Human-friendly form-field labels per kind. Keys are the spec.name in
// ANALYSIS_KINDS; the value is what users actually see above the input.
// Anything not in this map falls back to the raw spec.name.
const PARAM_LABELS = {
  capability:           { column: 'Measurement', lsl: 'Lower spec limit', usl: 'Upper spec limit', target: 'Target value', subgroup_col: 'Subgroup column', transform: 'Transform' },
  sixpack:              { column: 'Measurement', lsl: 'Lower spec limit', usl: 'Upper spec limit', target: 'Target value' },
  predictive_cpk:       { column: 'Measurement', lsl: 'Lower spec limit', usl: 'Upper spec limit' },
  hypothesis_test:      { test: 'Test', column: 'Variable', group_col: 'Group by', column_b: 'Second measurement', mu0: 'Target mean (μ₀)', p0: 'Target proportion (p₀)', delta: 'Equivalence margin' },
  control_chart:        { kind: 'Chart type', column: 'Measurement', subgroup_col: 'Subgroup column', n_col: 'Sample size column', target: 'Center / target', phase_col: 'Phase column' },
  regression:           { response: 'Response (Y)', predictors: 'Predictors (X)' },
  msa:                  { design: 'Design', measurement_col: 'Measurement', part_col: 'Part column', operator_col: 'Operator column', factor_cols: 'Additional factor columns', tolerance: 'Tolerance' },
  doe:                  { response: 'Response (Y)', factors: 'Factors (X)', interactions: 'Include interactions' },
  pareto:               { category_col: 'Category column', threshold_pct: 'Vital-few cutoff (%)' },
  distribution_id:      { column: 'Measurement' },
  reliability:          { distribution: 'Distribution', time_col: 'Time-to-failure', censor_col: 'Censoring column' },
  multivariate:         { method: 'Method', columns: 'Variables', k: 'k (clusters / components)', class_col: 'Class column' },
  time_series:          { method: 'Method', value_col: 'Value', time_col: 'Time column', horizon: 'Forecast horizon' },
  posthoc:              { test: 'Test', value_col: 'Value', group_col: 'Group', control_group: 'Control group' },
  tolerance:            { method: 'Method', column: 'Measurement', p: 'Proportion (p)', confidence: 'Confidence' },
  graph:                { chart: 'Chart type', column: 'Variable', columns: 'Variables', group_col: 'Group by', x_col: 'X', y_col: 'Y', time_col: 'Time', factor_cols: 'Factors' },
  attribute_capability: { method: 'Method', defects_col: 'Defects column', n_col: 'Sample size', target: 'Target' },
  anom:                 { value_col: 'Value', group_col: 'Group', alpha: 'α (significance)' },
};

// Analysis families — left-rail taxonomy. Each family has a default `kind`
// (the analyzer to open when the family is clicked) and a curated `subs`
// list of common sub-analyses. Sub-kinds with `inner`/`innerParam` set
// pre-fill that param on the analyzer form (e.g. test=mann_whitney inside
// hypothesis_test). The full enum is still reachable via the form dropdown
// — `subs` is the editorial shortcut, not the complete list.
const ANALYSIS_FAMILIES = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'hypothesis', label: 'Hypothesis tests', kinds: ['hypothesis_test', 'posthoc', 'bootstrap', 'bootstrap_effect', 'bayesian'],
    kind: 'hypothesis_test', subs: [
      { label: '1-sample t',        kind: 'hypothesis_test', inner: 'one_sample_t',  innerParam: 'test' },
      { label: '2-sample t',        kind: 'hypothesis_test', inner: 'two_sample_t',  innerParam: 'test' },
      { label: 'Paired t',          kind: 'hypothesis_test', inner: 'paired_t',      innerParam: 'test' },
      { label: 'ANOVA (one-way)',   kind: 'hypothesis_test', inner: 'one_way_anova', innerParam: 'test' },
      { label: 'ANOVA (two-way)',   kind: 'hypothesis_test', inner: 'two_way_anova', innerParam: 'test' },
      { label: 'Mann-Whitney U',    kind: 'hypothesis_test', inner: 'mann_whitney',  innerParam: 'test' },
      { label: 'Kruskal-Wallis',    kind: 'hypothesis_test', inner: 'kruskal',       innerParam: 'test' },
      { label: 'Wilcoxon',          kind: 'hypothesis_test', inner: 'wilcoxon_signed_rank', innerParam: 'test' },
      { label: 'Chi-square',        kind: 'hypothesis_test', inner: 'chi_square',    innerParam: 'test' },
      { label: 'Fisher\'s exact',   kind: 'hypothesis_test', inner: 'fisher_exact',  innerParam: 'test' },
      { label: '1-proportion',      kind: 'hypothesis_test', inner: 'one_proportion',innerParam: 'test' },
      { label: '2-proportion',      kind: 'hypothesis_test', inner: 'two_proportions',innerParam:'test' },
      { label: 'Levene\'s',         kind: 'hypothesis_test', inner: 'levene',        innerParam: 'test' },
      { label: 'AD normality',      kind: 'hypothesis_test', inner: 'anderson_darling_normality', innerParam: 'test' },
      { label: 'Tukey HSD',         kind: 'posthoc',         inner: 'tukey_hsd',     innerParam: 'test' },
      { label: 'Dunnett',           kind: 'posthoc',         inner: 'dunnett',       innerParam: 'test' },
      { label: 'Hsu MCB',           kind: 'posthoc',         inner: 'hsu_mcb',       innerParam: 'test' },
      { label: 'Bootstrap CI',      kind: 'bootstrap' },
      { label: 'Bootstrap effect-size CI', kind: 'bootstrap_effect' },
      { label: 'Repeated-measures ANOVA', kind: 'hypothesis_test', inner: 'rm_anova', innerParam: 'test' },
      { label: 'Bayesian · BEST',         kind: 'bayesian', inner: 'best_two_sample',   innerParam: 'method' },
      { label: 'Bayesian · beta-binomial', kind: 'bayesian', inner: 'beta_binomial',    innerParam: 'method' },
      { label: 'Bayesian · normal-normal', kind: 'bayesian', inner: 'normal_normal',    innerParam: 'method' },
      { label: 'Bayes factor t-test',      kind: 'bayesian', inner: 'bayes_factor_ttest', innerParam: 'method' },
    ]},
  { id: 'control', label: 'Control charts', kinds: ['control_chart'],
    kind: 'control_chart', subs: [
      { label: 'I-MR',     kind: 'control_chart', inner: 'I-MR',     innerParam: 'kind' },
      { label: 'X-bar/R',  kind: 'control_chart', inner: 'X-bar/R',  innerParam: 'kind' },
      { label: 'EWMA',     kind: 'control_chart', inner: 'EWMA',     innerParam: 'kind' },
      { label: 'CUSUM',    kind: 'control_chart', inner: 'CUSUM',    innerParam: 'kind' },
      { label: 'MA',       kind: 'control_chart', inner: 'MA',       innerParam: 'kind' },
      { label: 'p',        kind: 'control_chart', inner: 'p',        innerParam: 'kind' },
      { label: 'np',       kind: 'control_chart', inner: 'np',       innerParam: 'kind' },
      { label: 'c',        kind: 'control_chart', inner: 'c',        innerParam: 'kind' },
      { label: 'u',        kind: 'control_chart', inner: 'u',        innerParam: 'kind' },
      { label: 'Hotelling T² (multivariate)', kind: 'control_chart', inner: 'T2',        innerParam: 'kind' },
      { label: 'MEWMA (multivariate)',        kind: 'control_chart', inner: 'MEWMA',     innerParam: 'kind' },
      { label: 'Z-MR (short-run)',            kind: 'control_chart', inner: 'Z-MR',      innerParam: 'kind' },
      { label: 'DNOM (short-run)',            kind: 'control_chart', inner: 'short_run', innerParam: 'kind' },
    ]},
  { id: 'capability', label: 'Capability', kinds: ['capability', 'sixpack', 'predictive_cpk', 'attribute_capability', 'tolerance'],
    kind: 'capability', subs: [
      { label: 'Cpk',                kind: 'capability' },
      { label: 'Cpk (Box-Cox)',      kind: 'capability', inner: 'box-cox', innerParam: 'transform' },
      { label: 'Cpk (Johnson)',      kind: 'capability', inner: 'johnson', innerParam: 'transform' },
      { label: 'Capability Sixpack', kind: 'sixpack' },
      { label: 'Predictive Cpk',     kind: 'predictive_cpk' },
      { label: 'Attribute (binomial)', kind: 'attribute_capability', inner: 'binomial', innerParam: 'method' },
      { label: 'Attribute (Poisson)',  kind: 'attribute_capability', inner: 'poisson',  innerParam: 'method' },
      { label: 'Tolerance interval', kind: 'tolerance' },
    ]},
  { id: 'msa', label: 'MSA · Gauge', kinds: ['msa', 'gage_linearity', 'agreement', 'variability_gauge'],
    kind: 'msa', subs: [
      { label: 'GR&R · Crossed',   kind: 'msa', inner: 'crossed',  innerParam: 'design' },
      { label: 'GR&R · Nested',    kind: 'msa', inner: 'nested',   innerParam: 'design' },
      { label: 'GR&R · Expanded',  kind: 'msa', inner: 'expanded', innerParam: 'design' },
      { label: 'Gage Linearity & Bias', kind: 'gage_linearity' },
      { label: 'Attribute Agreement',   kind: 'agreement' },
      { label: 'Variability gauge chart', kind: 'variability_gauge' },
    ]},
  { id: 'regression', label: 'Regression', kinds: ['regression', 'mixed_effects'],
    kind: 'regression', subs: [
      { label: 'OLS (linear)',     kind: 'regression', inner: 'ols',           innerParam: 'method' },
      { label: 'GLM',              kind: 'regression', inner: 'glm',           innerParam: 'method' },
      { label: 'Logistic',         kind: 'regression', inner: 'logistic',      innerParam: 'method' },
      { label: 'Poisson',          kind: 'regression', inner: 'poisson',       innerParam: 'method' },
      { label: 'Nonlinear',        kind: 'regression', inner: 'nonlinear',     innerParam: 'method' },
      { label: 'Stepwise',         kind: 'regression', inner: 'stepwise',      innerParam: 'method' },
      { label: 'Best subsets',     kind: 'regression', inner: 'best_subsets',  innerParam: 'method' },
      { label: 'Ordinal logit',    kind: 'regression', inner: 'ordinal_logit', innerParam: 'method' },
      { label: 'Robust (Huber)',   kind: 'regression', inner: 'robust',        innerParam: 'method' },
      { label: 'Quantile',         kind: 'regression', inner: 'quantile',      innerParam: 'method' },
      { label: 'Random Forest',    kind: 'regression', inner: 'random_forest', innerParam: 'method' },
      { label: 'Mixed-effects (LMM)', kind: 'mixed_effects' },
    ]},
  { id: 'doe', label: 'DOE', kinds: ['doe', 'desirability', 'ternary'],
    kind: 'doe', subs: [
      { label: 'Factorial fit',         kind: 'doe' },
      { label: 'Multi-response (desirability)', kind: 'desirability' },
      { label: 'Mixture ternary contour', kind: 'ternary' },
    ]},
  { id: 'reliability', label: 'Reliability · Survival', kinds: ['reliability', 'survival'],
    kind: 'reliability', subs: [
      { label: 'Kaplan-Meier + log-rank', kind: 'survival' },
      { label: 'Weibull',         kind: 'reliability', inner: 'weibull',         innerParam: 'distribution' },
      { label: 'Exponential',     kind: 'reliability', inner: 'exponential',     innerParam: 'distribution' },
      { label: 'Lognormal',       kind: 'reliability', inner: 'lognormal',       innerParam: 'distribution' },
      { label: 'Gamma',           kind: 'reliability', inner: 'gamma',           innerParam: 'distribution' },
      { label: 'Log-logistic',    kind: 'reliability', inner: 'log_logistic',    innerParam: 'distribution' },
      { label: 'EV (smallest)',   kind: 'reliability', inner: 'smallest_extreme_value', innerParam: 'distribution' },
      { label: 'EV (largest)',    kind: 'reliability', inner: 'largest_extreme_value',  innerParam: 'distribution' },
      { label: 'GEV',             kind: 'reliability', inner: 'gev',             innerParam: 'distribution' },
      { label: 'Arrhenius',       kind: 'reliability', inner: 'arrhenius',       innerParam: 'distribution' },
      { label: 'Cox PH (survival)', kind: 'reliability', inner: 'cox_ph',        innerParam: 'distribution' },
    ]},
  { id: 'multivariate', label: 'Multivariate', kinds: ['multivariate', 'correlation'],
    kind: 'multivariate', subs: [
      { label: 'Correlation matrix', kind: 'correlation' },
      { label: 'PCA',           kind: 'multivariate', inner: 'pca',          innerParam: 'method' },
      { label: 'K-means',       kind: 'multivariate', inner: 'kmeans',       innerParam: 'method' },
      { label: 'LDA',           kind: 'multivariate', inner: 'lda',          innerParam: 'method' },
      { label: 'Hierarchical',  kind: 'multivariate', inner: 'hierarchical', innerParam: 'method' },
      { label: 'Hotelling T²',  kind: 'multivariate', inner: 'hotelling',    innerParam: 'method' },
    ]},
  { id: 'time', label: 'Time series', kinds: ['time_series'],
    kind: 'time_series', subs: [
      { label: 'Exp. smoothing',  kind: 'time_series', inner: 'exp_smoothing',  innerParam: 'method' },
      { label: 'ARIMA',           kind: 'time_series', inner: 'arima',          innerParam: 'method' },
      { label: 'Auto-ARIMA',      kind: 'time_series', inner: 'auto_arima',     innerParam: 'method' },
      { label: 'Decompose',       kind: 'time_series', inner: 'decompose',      innerParam: 'method' },
      { label: 'ACF/PACF',        kind: 'time_series', inner: 'acf_pacf',       innerParam: 'method' },
      { label: 'Changepoint',     kind: 'time_series', inner: 'changepoint',    innerParam: 'method' },
    ]},
  { id: 'graphs', label: 'Graphs', kinds: ['graph', 'pareto', 'cost_pareto'],
    kind: 'graph', subs: [
      { label: 'Cost-weighted Pareto', kind: 'cost_pareto' },
      { label: 'Histogram',    kind: 'graph',  inner: 'histogram',  innerParam: 'chart' },
      { label: 'Boxplot',      kind: 'graph',  inner: 'boxplot',    innerParam: 'chart' },
      { label: 'Scatter',      kind: 'graph',  inner: 'scatter',    innerParam: 'chart' },
      { label: 'Time series',  kind: 'graph',  inner: 'time_series',innerParam: 'chart' },
      { label: 'Multi-vari',   kind: 'graph',  inner: 'multi_vari', innerParam: 'chart' },
      { label: 'Interaction plot', kind: 'graph', inner: 'interaction', innerParam: 'chart' },
      { label: 'Pareto',       kind: 'pareto' },
    ]},
  { id: 'other', label: 'Distribution · ANOM', kinds: ['distribution_id', 'anom'],
    kind: 'distribution_id', subs: [
      { label: 'Distribution ID', kind: 'distribution_id' },
      { label: 'ANOM',            kind: 'anom' },
    ]},
  // Voice of Customer — survey + free-text analytics (services/transactional LSS).
  { id: 'voc', label: 'Voice of Customer', kinds: ['survey', 'text_pareto', 'cost_pareto'],
    kind: 'survey', subs: [
      { label: 'Survey / Likert (Cronbach α)', kind: 'survey' },
      { label: 'Comment Pareto (text)',        kind: 'text_pareto' },
      { label: 'Cost-weighted Pareto',         kind: 'cost_pareto' },
    ]},
  // Flow & Agile — transactional/software delivery analytics.
  { id: 'flow', label: 'Flow & Agile', kinds: ['cycle_time', 'delivery_forecast'],
    kind: 'cycle_time', subs: [
      { label: 'Cycle / Lead time',           kind: 'cycle_time' },
      { label: 'Delivery forecast (Monte-Carlo)', kind: 'delivery_forecast' },
    ]},
  // Conyso Originals — branded analyses unique to Bench.
  { id: 'originals', label: 'Conyso Originals', kinds: ['variance_budget'],
    kind: 'variance_budget', subs: [
      { label: 'Variance Budget', kind: 'variance_budget' },
    ]},
];

function renderFamilyRail() {
  const current = state._analysisFamily || 'all';
  const rail = h('div', { className: 'family-rail' },
    h('div', { className: 'rail-label' }, 'Analysis'),
  );
  const list = h('ul');
  for (const fam of ANALYSIS_FAMILIES) {
    list.append(h('li', {
      className: fam.id === current ? 'active' : '',
      onclick: () => {
        state._analysisFamily = fam.id;
        // Reset chosen kind if it's no longer in the visible set.
        if (fam.kinds && state._chosenKind && !fam.kinds.includes(state._chosenKind)) {
          state._chosenKind = fam.kinds[0];
        } else if (!fam.kinds) {
          // 'all' — leave whatever was selected
        }
        render();
      },
    }, fam.label));
  }
  rail.append(list);
  return rail;
}

