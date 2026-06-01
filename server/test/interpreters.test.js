// Interpretation correctness tests.
//
// stats_engine_ux.js exposes window.statsUx.INTERPRETERS / ACTION_RULES /
// NEXT_ANALYSIS — pure functions that take a result summary and return a
// plain-English narrative + suggested follow-ups. The whole "Bench tells
// you what to do" value-prop sits on this layer, so its conclusions need
// to match published LSS practice, not aspirational marketing copy.
//
// Approach: stub a browser global and load the IIFE in a Node vm sandbox.
// Then exercise each interpreter against synthetic summaries pinned to
// known LSS thresholds (Cpk ≥ 1.33 / 1.67, AIAG %R&R bands, Cohen d,
// Weibull β bands, Western Electric rules).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, '..', 'public', 'js', 'view', 'stats-ux.js');
const src = readFileSync(SRC_PATH, 'utf8');

// Build a sandbox with the minimum browser surface the IIFE touches at
// MODULE LOAD time (event-handler attach happens lazily inside chart
// renderers, which we don't exercise here).
const sandbox = {
  console,
  window: {},
  document: {
    createElement: () => ({
      setAttribute() {}, append() {}, appendChild() {}, addEventListener() {},
      classList: { toggle() {}, add() {}, remove() {} },
      style: {},
    }),
    createElementNS: () => ({ setAttribute() {}, append() {} }),
    body: { append() {} },
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
  },
  h: (..._a) => ({ append() {}, setAttribute() {}, classList: { toggle() {} }, style: {} }),
  api: { get: () => Promise.resolve({}), post: () => Promise.resolve({}),
          patch: () => Promise.resolve({}), delete: () => Promise.resolve({}) },
  toast: () => {},
  fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  XMLSerializer: class { serializeToString() { return ''; } },
  Blob: class { constructor(){} },
  URL: { createObjectURL: () => 'blob:', revokeObjectURL: () => {} },
  Image: class {},
  navigate: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const { INTERPRETERS, ACTION_RULES, NEXT_ANALYSIS, TEST_HELP, KIND_LABEL } = sandbox.window.statsUx;

// ════════════════════════════════════════════════════════════════════
// CAPABILITY — Cpk band thresholds + DPMO + centering note
// ════════════════════════════════════════════════════════════════════

test('capability: Cpk = 1.67 → "highly capable"', () => {
  const t = INTERPRETERS.capability({ cpk: 1.70, z_bench: 5.0, mean: 10, stdev: 1, lsl: 5, usl: 15 });
  assert.match(t, /highly capable/);
  assert.match(t, /≥ the 1\.33 conventional threshold/);
});

test('capability: Cpk = 1.4 → "capable"', () => {
  const t = INTERPRETERS.capability({ cpk: 1.40, z_bench: 4.2, mean: 10, stdev: 1, lsl: 5, usl: 15 });
  assert.match(t, /\*\*capable\*\*/);
  assert.doesNotMatch(t, /not capable/);
});

test('capability: Cpk = 1.1 → "marginally capable"', () => {
  const t = INTERPRETERS.capability({ cpk: 1.10, z_bench: 3.3, mean: 10, stdev: 1, lsl: 5, usl: 15 });
  assert.match(t, /marginally capable/);
  assert.match(t, /< the 1\.33 conventional threshold/);
});

test('capability: Cpk = 0.6 → "not capable"', () => {
  const t = INTERPRETERS.capability({ cpk: 0.60, z_bench: 1.8, mean: 10, stdev: 1, lsl: 8, usl: 12 });
  assert.match(t, /not capable/);
});

test('capability: missing Cpk warns about specs', () => {
  const t = INTERPRETERS.capability({ cpk: null });
  assert.match(t, /supply both LSL and USL/);
});

test('capability: off-center > 1σ flagged as dominant problem', () => {
  // Mean at 12, midpoint at 10, σ=1 → 2σ off-center
  const t = INTERPRETERS.capability({ cpk: 1.0, z_bench: 3.0, mean: 12, stdev: 1, lsl: 5, usl: 15 });
  assert.match(t, /2\.0σ off-center/);
  assert.match(t, /centering is the dominant problem/);
});

test('capability: centered process gets the centered note', () => {
  const t = INTERPRETERS.capability({ cpk: 1.5, z_bench: 4.5, mean: 10, stdev: 1, lsl: 5, usl: 15 });
  assert.match(t, /Mean is centered/);
});

test('capability: DPMO is computed from z_bench (single-tail)', () => {
  // z_bench = 3.0 → tail prob ≈ 0.00135 → ~1350 DPMO
  const t = INTERPRETERS.capability({ cpk: 1.0, z_bench: 3.0, mean: 10, stdev: 1, lsl: 7, usl: 13 });
  assert.match(t, /1,[0-9]{3} DPMO|1,[0-9]{2,3} DPMO/);  // should be ≈1350
});

// ════════════════════════════════════════════════════════════════════
// HYPOTHESIS TESTS — verdict direction + effect-size bands
// ════════════════════════════════════════════════════════════════════

test('hypothesis: significant p → reject H0', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'two_sample_t', t: 3.5, p: 0.001, mean_diff: 2.1, cohens_d: 0.9 });
  assert.match(t, /Reject H₀/);
  assert.match(t, /large effect/);
});

test('hypothesis: non-significant p → fail to reject', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'two_sample_t', t: 0.5, p: 0.6, mean_diff: 0.1, cohens_d: 0.1 });
  assert.match(t, /Fail to reject/);
  assert.match(t, /negligible effect/);
  assert.match(t, /TOST/);  // should suggest equivalence
});

test('hypothesis: Cohen d bands', () => {
  // d = 0.3 → "small"
  let t = INTERPRETERS.hypothesis_test({ test: 'two_sample_t', t: 1, p: 0.05, mean_diff: 1, cohens_d: 0.3 });
  assert.match(t, /small effect/);
  // d = 0.6 → "medium"
  t = INTERPRETERS.hypothesis_test({ test: 'two_sample_t', t: 1, p: 0.05, mean_diff: 1, cohens_d: 0.6 });
  assert.match(t, /medium effect/);
  // d = 1.0 → "large"
  t = INTERPRETERS.hypothesis_test({ test: 'two_sample_t', t: 1, p: 0.05, mean_diff: 1, cohens_d: 1.0 });
  assert.match(t, /large effect/);
});

test('hypothesis: ANOVA p<0.05 suggests Tukey', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'one_way_anova', F: 12.5, p: 0.001, k: 3, eta_squared: 0.4 });
  assert.match(t, /Reject H₀/);
  assert.match(t, /Tukey HSD/);
  assert.match(t, /40% of the variance/);
});

test('hypothesis: Levene significant → recommends Welch', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'levene', W: 4.5, p: 0.01 });
  assert.match(t, /unequal/);
  assert.match(t, /Welch/);
});

test('hypothesis: Levene non-significant → equal-variance methods OK', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'levene', W: 0.5, p: 0.6 });
  assert.match(t, /Variances are similar/);
  assert.match(t, /valid/);
});

test('hypothesis: chi-square significant → variables associated', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'chi_square', chi2: 25.3, dof: 4, n: 200, p: 0.0001 });
  assert.match(t, /associated/);
});

test('hypothesis: AD normality non-significant → normality plausible', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'anderson_darling_normality', AD: 0.4, p_approx: 0.35, p: 0.35 });
  assert.match(t, /Normality is plausible/);
});

test('hypothesis: AD normality significant → recommends transform', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'anderson_darling_normality', AD: 2.1, p_approx: 0.001, p: 0.001 });
  assert.match(t, /Reject normality/);
  assert.match(t, /non-parametric|transform/);
});

test('hypothesis: TOST equivalent → equivalence demonstrated', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'tost_two_sample', p: 0.02, equivalent: true, delta: 0.5 });
  assert.match(t, /\*\*Equivalent\*\*/);
});

test('hypothesis: TOST not-equivalent', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'tost_two_sample', p: 0.20, equivalent: false, delta: 0.5 });
  assert.match(t, /Equivalence \*\*not\*\* demonstrated/);
});

test('hypothesis: runs test p<0.05 → non-random', () => {
  const t = INTERPRETERS.hypothesis_test({ test: 'runs', runs: 4, n_above: 50, n_below: 50, p: 0.01 });
  assert.match(t, /non-random/);
});

// ════════════════════════════════════════════════════════════════════
// CONTROL CHART — stability + WE rule labels
// ════════════════════════════════════════════════════════════════════

test('control_chart: stable when no violations', () => {
  const t = INTERPRETERS.control_chart({ kind: 'I-MR', center: 10, n: 50, violations: [], we_rules: { rule_1: [], rule_2: [], rule_3: [], rule_4: [] } });
  assert.match(t, /in statistical control/);
  assert.match(t, /Capability indices are interpretable/);
});

test('control_chart: violations → recommends investigation BEFORE capability', () => {
  const t = INTERPRETERS.control_chart({ kind: 'I-MR', center: 10, n: 50,
    violations: [], we_rules: { rule_1: [12, 35], rule_2: [], rule_3: [22], rule_4: [] } });
  assert.match(t, /rule violation/);
  assert.match(t, /Investigate special-cause/);
  assert.match(t, /before drawing capability/);
});

test('control_chart: WE rule labels match AIAG SPC names', () => {
  const t = INTERPRETERS.control_chart({ kind: 'I-MR', center: 10, n: 50,
    violations: [], we_rules: { rule_1: [5], rule_2: [10], rule_3: [15], rule_4: [20] } });
  assert.match(t, /Rule 1 \(beyond 3σ\)/);
  assert.match(t, /Rule 2 \(9 same-side\)/);
  assert.match(t, /Rule 3 \(6 monotone\)/);
  assert.match(t, /Rule 4 \(14 alternating\)/);
});

// ════════════════════════════════════════════════════════════════════
// MSA — AIAG bands at 10% and 30%
// ════════════════════════════════════════════════════════════════════

test('msa: %R&R < 10 → acceptable', () => {
  const t = INTERPRETERS.msa({ gauge_rr_pct: 7.5 });
  assert.match(t, /acceptable.*<10%/);
  assert.match(t, /Trust the gauge/);
});

test('msa: %R&R = 18 → marginal', () => {
  const t = INTERPRETERS.msa({ gauge_rr_pct: 18.0 });
  assert.match(t, /marginal.*10–30%/);
  assert.match(t, /Borderline/);
});

test('msa: %R&R = 42 → unacceptable', () => {
  const t = INTERPRETERS.msa({ gauge_rr_pct: 42.0 });
  assert.match(t, /unacceptable.*>30%/);
  assert.match(t, /Recalibrate|retrain|replace/);
});

// ════════════════════════════════════════════════════════════════════
// REGRESSION — fit-quality bands + collinearity hint
// ════════════════════════════════════════════════════════════════════

test('regression: R² ≥ 0.7 → strong', () => {
  const t = INTERPRETERS.regression({ r2: 0.82, adj_r2: 0.80, f_p: 0.0001, coefficients: [{ name: 'x', coef: 1.2, p: 0.001 }] });
  assert.match(t, /strong/);
  assert.match(t, /at least one predictor matters/);
});

test('regression: R² ≥ 0.4 → moderate', () => {
  const t = INTERPRETERS.regression({ r2: 0.50, adj_r2: 0.48, f_p: 0.001, coefficients: [{ name: 'x', coef: 1.2, p: 0.01 }] });
  assert.match(t, /moderate/);
});

test('regression: R² < 0.15 → very weak', () => {
  const t = INTERPRETERS.regression({ r2: 0.08, adj_r2: 0.05, f_p: 0.3, coefficients: [] });
  assert.match(t, /very weak/);
});

test('regression: F sig but no individual coef → collinearity warning', () => {
  const t = INTERPRETERS.regression({ r2: 0.5, adj_r2: 0.48, f_p: 0.01,
    coefficients: [{ name: '(Intercept)', coef: 1 }, { name: 'x1', coef: 0.5, p: 0.4 }] });
  assert.match(t, /collinearity/);
  assert.match(t, /best-subsets/);
});

// ════════════════════════════════════════════════════════════════════
// RELIABILITY — Weibull β bands
// ════════════════════════════════════════════════════════════════════

test('reliability: β = 0.6 → infant mortality, decreasing hazard', () => {
  const t = INTERPRETERS.reliability({ distribution: 'weibull', shape_beta: 0.6, scale_eta: 100, MTBF: 150, B10_life: 18 });
  assert.match(t, /infant mortality/);
  assert.match(t, /decreasing hazard/);
});

test('reliability: β = 2.5 → wear-out, increasing hazard', () => {
  const t = INTERPRETERS.reliability({ distribution: 'weibull', shape_beta: 2.5, scale_eta: 100, MTBF: 88, B10_life: 36 });
  assert.match(t, /wear-out/);
  assert.match(t, /increasing hazard/);
  assert.match(t, /preventive replacement/);
});

test('reliability: β ≈ 1 → random failures (useful life)', () => {
  const t = INTERPRETERS.reliability({ distribution: 'weibull', shape_beta: 1.05, scale_eta: 100, MTBF: 98, B10_life: 10 });
  assert.match(t, /random failures/);
  assert.match(t, /useful life/);
});

// ════════════════════════════════════════════════════════════════════
// PARETO — vital few callout
// ════════════════════════════════════════════════════════════════════

test('pareto: lists vital-few categories with cumulative threshold', () => {
  const t = INTERPRETERS.pareto({ vital_few: ['A', 'B'], total_defects: 200, threshold_pct: 80 });
  assert.match(t, /vital few/);
  assert.match(t, /A, B/);
  assert.match(t, /200 defects/);
  assert.match(t, /80%/);
});

// ════════════════════════════════════════════════════════════════════
// DISTRIBUTION ID — Box-Cox recommendation for non-normal
// ════════════════════════════════════════════════════════════════════

test('distribution_id: non-normal best-fit triggers Box-Cox suggestion', () => {
  const t = INTERPRETERS.distribution_id({ best_fit: 'lognormal' });
  assert.match(t, /lognormal/);
  assert.match(t, /Box-Cox/);
});

test('distribution_id: normal best-fit gives no transform suggestion', () => {
  const t = INTERPRETERS.distribution_id({ best_fit: 'normal' });
  assert.match(t, /normal/);
  assert.doesNotMatch(t, /Box-Cox/);
});

// ════════════════════════════════════════════════════════════════════
// DOE — significant effects ranked by magnitude
// ════════════════════════════════════════════════════════════════════

test('doe: top 3 effects ranked by absolute magnitude', () => {
  const t = INTERPRETERS.doe({ r2: 0.85, effects: [
    { term: '(Intercept)', effect: 50, p: 0.001 },
    { term: 'A', effect: 8.5, p: 0.001 },
    { term: 'B', effect: -3.2, p: 0.01 },
    { term: 'C', effect: 1.5, p: 0.3 },   // not significant
    { term: 'AB', effect: -6.1, p: 0.001 },
  ]});
  // Should list A (8.5) then AB (6.1) then B (3.2), exclude C
  assert.match(t, /A \(effect=8\.50\)/);
  assert.match(t, /AB \(effect=-6\.10\)/);
  assert.match(t, /B \(effect=-3\.20\)/);
  assert.doesNotMatch(t, /\bC \(/);  // C is not significant
});

test('doe: no significant effects → recommends higher-power follow-up', () => {
  const t = INTERPRETERS.doe({ r2: 0.20, effects: [
    { term: 'A', effect: 0.5, p: 0.6 },
    { term: 'B', effect: 0.3, p: 0.7 },
  ]});
  assert.match(t, /No effects reached significance/);
  assert.match(t, /higher-power|different design/);
});

// ════════════════════════════════════════════════════════════════════
// ATTRIBUTE CAPABILITY — DPMO + sigma + stability note
// ════════════════════════════════════════════════════════════════════

test('attribute_capability: binomial reports DPMO + sigma', () => {
  const t = INTERPRETERS.attribute_capability({
    method: 'binomial_capability', p_hat: 0.03, DPMO: 30000, z_bench: 3.4, stable: true,
  });
  assert.match(t, /3\.00%/);
  assert.match(t, /30,000 DPMO/);
  assert.match(t, /3\.40/);
  assert.match(t, /stable/);
});

test('attribute_capability: unstable p-chart triggers warning', () => {
  const t = INTERPRETERS.attribute_capability({
    method: 'binomial_capability', p_hat: 0.05, DPMO: 50000, z_bench: 3.15, stable: false,
  });
  assert.match(t, /out-of-control|investigate before/);
});

// ════════════════════════════════════════════════════════════════════
// NEXT_ANALYSIS — recommendations are correct LSS practice
// ════════════════════════════════════════════════════════════════════

test('next: low Cpk recommends Gauge R&R FIRST', () => {
  const sugg = NEXT_ANALYSIS.capability({ cpk: 0.8 });
  const labels = sugg.map(s => s.label);
  assert.ok(labels.some(l => /Gauge R&R/.test(l)), 'should suggest MSA when Cpk low');
  assert.ok(labels.some(l => /X-bar.*R chart|control chart/i.test(l)), 'should also suggest control chart');
});

test('next: capable process recommends SPC monitor', () => {
  const sugg = NEXT_ANALYSIS.capability({ cpk: 1.5 });
  const labels = sugg.map(s => s.label);
  assert.ok(labels.some(l => /SPC|monitor/i.test(l)));
});

test('next: ANOVA sig recommends Tukey post-hoc', () => {
  const sugg = NEXT_ANALYSIS.hypothesis_test({ test: 'one_way_anova', p: 0.001 });
  assert.ok(sugg.some(s => /Tukey HSD/.test(s.label)));
});

test('next: non-sig 2-sample t recommends TOST equivalence', () => {
  const sugg = NEXT_ANALYSIS.hypothesis_test({ test: 'two_sample_t', p: 0.3 });
  assert.ok(sugg.some(s => /TOST|equivalence/i.test(s.label)));
});

test('next: Levene sig recommends Welch', () => {
  const sugg = NEXT_ANALYSIS.hypothesis_test({ test: 'levene', p: 0.01 });
  assert.ok(sugg.some(s => /Welch/i.test(s.label)));
});

test('next: control chart violations → Auto-RCA + Pareto', () => {
  const sugg = NEXT_ANALYSIS.control_chart({ kind: 'I-MR', we_rules: { rule_1: [5, 12] } });
  const labels = sugg.map(s => s.label);
  assert.ok(labels.some(l => /Auto-RCA/i.test(l)));
  assert.ok(labels.some(l => /Pareto/i.test(l)));
});

test('next: stable process → capability becomes meaningful', () => {
  const sugg = NEXT_ANALYSIS.control_chart({ kind: 'I-MR', we_rules: {} });
  assert.ok(sugg.some(s => /capability/i.test(s.label)));
});

test('next: MSA > 30% → fix gauge first', () => {
  const sugg = NEXT_ANALYSIS.msa({ gauge_rr_pct: 45 });
  assert.ok(sugg.some(s => /Improve the gauge/i.test(s.label)));
});

test('next: MSA < 10% → run capability', () => {
  const sugg = NEXT_ANALYSIS.msa({ gauge_rr_pct: 5 });
  assert.ok(sugg.some(s => /capability/i.test(s.label)));
});

test('next: low R² recommends best-subsets', () => {
  const sugg = NEXT_ANALYSIS.regression({ adj_r2: 0.25, f_p: 0.05 });
  assert.ok(sugg.some(s => /best-subsets/i.test(s.label)));
});

test('next: Weibull β<1 → infant mortality investigation', () => {
  const sugg = NEXT_ANALYSIS.reliability({ shape_beta: 0.5 });
  assert.ok(sugg.some(s => /infant mortality/i.test(s.label)));
});

test('next: Weibull β>1.5 → wear-out + preventive replacement', () => {
  const sugg = NEXT_ANALYSIS.reliability({ shape_beta: 2.8, B10_life: 50 });
  assert.ok(sugg.some(s => /wear-out/i.test(s.label)));
});

// ════════════════════════════════════════════════════════════════════
// ACTION_RULES — same heuristics, action format
// ════════════════════════════════════════════════════════════════════

test('action: low Cpk → P1 Gauge R&R, P2 stabilise, P3 DOE', () => {
  const acts = ACTION_RULES.capability({ cpk: 0.7 });
  assert.equal(acts.length, 3);
  assert.match(acts[0].action, /Gauge R&R|Verify the measurement/);
  assert.equal(acts[0].priority, 1);
  assert.match(acts[1].action, /Stabilize/i);
  assert.equal(acts[1].priority, 2);
  assert.match(acts[2].action, /variation|DOE/i);
});

test('action: marginal Cpk → centering first', () => {
  const acts = ACTION_RULES.capability({ cpk: 1.2 });
  assert.match(acts[0].action, /Center the process/);
});

test('action: capable Cpk → lock + handoff', () => {
  const acts = ACTION_RULES.capability({ cpk: 1.6 });
  assert.match(acts[0].action, /Document.*lock controls/);
});

test('action: control-chart rule_1 violation → P1 investigate', () => {
  const acts = ACTION_RULES.control_chart({ we_rules: { rule_1: [12], rule_2: [], rule_3: [] } });
  assert.match(acts[0].action, /Investigate out-of-control/);
  assert.equal(acts[0].priority, 1);
});

test('action: MSA >30% → replace/recalibrate gauge', () => {
  const acts = ACTION_RULES.msa({ gauge_rr_pct: 40 });
  assert.match(acts[0].action, /Replace or recalibrate/);
});

test('action: MSA 10-30% → improve operator training', () => {
  const acts = ACTION_RULES.msa({ gauge_rr_pct: 18 });
  assert.match(acts[0].action, /operator training|standardize/i);
});

test('action: significant hypothesis test → validate operational meaning', () => {
  const acts = ACTION_RULES.hypothesis_test({ p: 0.001 });
  assert.match(acts[0].action, /operationally meaningful/);
});

test('action: reliability β<0.9 → infant-mortality investigation', () => {
  const acts = ACTION_RULES.reliability({ shape_beta: 0.6 });
  assert.match(acts[0].action, /infant mortality/i);
});

test('action: reliability β>1.5 → preventive replacement before B10', () => {
  const acts = ACTION_RULES.reliability({ shape_beta: 2.5, B10_life: 100 });
  assert.match(acts[0].action, /preventive replacement before B10/i);
});

// ════════════════════════════════════════════════════════════════════
// TEST_HELP — every claimed test has a help string
// ════════════════════════════════════════════════════════════════════

test('test_help: every standard test has help text', () => {
  const required = [
    'one_sample_t', 'two_sample_t', 'paired_t', 'one_way_anova',
    'mann_whitney', 'kruskal', 'chi_square',
    'capability', 'control_chart_imr', 'control_chart_xbar_r',
    'control_chart_cusum', 'control_chart_ewma', 'msa', 'reliability',
    'pareto', 'fishbone', 'five_whys',
  ];
  for (const t of required) {
    assert.ok(TEST_HELP[t], `missing help for ${t}`);
    assert.ok(TEST_HELP[t].length > 30, `help text too short for ${t}`);
  }
});

test('kind_label: every interpreter kind has a human label', () => {
  // Every interpreter key should round-trip through KIND_LABEL or fall back gracefully.
  // Sanity-check a few canonical ones.
  assert.ok(KIND_LABEL.one_sample_t);
  assert.ok(KIND_LABEL.capability);
  assert.ok(KIND_LABEL.msa);
  assert.ok(KIND_LABEL.reliability);
});
