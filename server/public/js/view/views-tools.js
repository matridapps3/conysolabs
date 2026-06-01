const TOOLS_INDEX = [
  { id: 'dpmo',         label: 'DPMO ↔ Sigma',         blurb: 'Convert defects-per-million-opportunities to sigma level (with or without the 1.5σ shift).',                         render: () => DpmoCalc() },
  { id: 'littles_law',  label: "Little's Law",         blurb: 'WIP = throughput × cycle time. Solve for any term. The fundamental flow equation for Agile/transactional LSS.', render: () => LittlesLawCalc() },
  { id: 'monte_carlo',  label: 'Monte-Carlo Simulation', blurb: 'Predict output distribution & capability from input variation + a transfer function. Ranks which inputs drive the spread (DFSS).', render: () => MonteCarloCalc() },
  { id: 'tolerance_stack', label: 'Tolerance Stack-Up', blurb: 'Worst-case and RSS tolerance stacks for a linear assembly; finds the dominant component tolerance.', render: () => ToleranceStackCalc() },
  { id: 'power_curve',  label: 'Power & Sample-Size Curve', blurb: 'Plot power vs. sample size across effect sizes for t-tests, proportions, and ANOVA. Find the n that hits your target power.', render: () => PowerCurveCalc() },
  { id: 'doe_power',    label: 'DOE Power',            blurb: 'Power to detect a factor effect in a two-level factorial — given run count, replicates, and standardized effect size.', render: () => DoePowerCalc() },
  { id: 'sample_size',  label: 'Sample Size & Power',  blurb: 'Required n for one-/two-sample t, ANOVA, proportions, and equivalence tests — at any α, β, effect.',                  render: () => SampleSizeCalc() },
  { id: 'distribution', label: 'Probability Distribution', blurb: 'P(X ≤ x), inverse CDF, and density for Normal, t, F, χ², Binomial, Poisson, Weibull.',                              render: () => ProbabilityCalc() },
  { id: 'doe_design',   label: 'DOE Design Generator', blurb: 'Full factorial, fractional (resolution III/IV/V), Plackett-Burman, CCD, Box-Behnken, definitive-screening, mixture.',  render: () => DesignGenerator() },
  { id: 'acceptance',   label: 'Acceptance Sampling',  blurb: 'Single/double/multiple sampling plans by attributes or variables. OC curves, AOQ, ATI.',                                render: () => AcceptanceSamplingTool() },
  { id: 'random',       label: 'Random Data',          blurb: 'Generate synthetic data from any distribution — for teaching, what-ifs, and method validation.',                       render: () => RandomDataGenerator() },
  { id: 'arl_design',   label: 'CUSUM / EWMA ARL Design', blurb: 'Pick chart parameters for a target in-control ARL₀ and a target shift to detect.',                                     render: () => ArlDesignCalc() },
  { id: 'mil_std_414',  label: 'Variables Sampling (Z1.9)', blurb: 'Sample size n and acceptance constant k for variables sampling plans, per MIL-STD-414 / ANSI/ASQ Z1.9.',           render: () => MilStd414Calc() },
  { id: 'stress_strength', label: 'Stress-Strength Reliability', blurb: 'P(strength > stress) for two normal populations — pure design-for-reliability calc.',                          render: () => StressStrengthCalc() },
  { id: 'discrete_prob', label: 'Discrete Probability', blurb: 'PMF / CDF for Binomial, Poisson, hypergeometric, negative-binomial, geometric.',                                       render: () => DiscreteProbCalc() },
];

function ToolsView() {
  const root = h('div');
  const toolId = state._toolKind;
  const tool = TOOLS_INDEX.find(t => t.id === toolId);

  if (!tool) {
    // Index page — six tools as editorial cards, no calculators inlined.
    root.append(
      h('div', { className: 'breadcrumb' }, 'Workspace · Calculators'),
      h('h2', {}, 'Calculators',
        h('span', { className: 'muted' }, ' — standalone, no dataset required')),
      h('p', { className: 'deck' },
        `${TOOLS_INDEX.length} self-contained calculators — each a single answer to a single question. No dataset required: sample size & power, DPMO, distributions, DOE designs & power, Monte-Carlo, tolerance stacks, Little's Law, acceptance plans, and more.`),
    );
    const grid = h('div', { className: 'tool-index' });
    for (const t of TOOLS_INDEX) {
      grid.append(h('a', {
        className: 'tool-card', href: '#',
        onclick: (e) => { e.preventDefault(); state._toolKind = t.id; render(); },
      },
        h('div', { className: 'tool-eyebrow' }, 'Calculator'),
        h('div', { className: 'tool-title' }, t.label),
        h('div', { className: 'tool-desc' }, t.blurb),
        h('div', { className: 'tool-go' }, 'Open →'),
      ));
    }
    root.append(grid);
    return root;
  }

  // Single-tool page — editorial hero + form below.
  root.append(
    h('div', { className: 'breadcrumb' },
      h('a', {
        href: '#', onclick: (e) => { e.preventDefault(); state._toolKind = null; render(); },
        style: 'color:var(--muted);text-decoration:none;letter-spacing:0.18em',
      }, 'Calculators'),
      ' · ', tool.label),
    h('div', { className: 'tool-hero' },
      h('h2', {}, tool.label),
      h('p', { className: 'deck' }, tool.blurb),
    ),
  );
  root.append(tool.render());
  return root;
}

function DpmoCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'DPMO ↔ Sigma Level'));
  const defects = h('input', { type: 'number', value: 50 });
  const units = h('input', { type: 'number', value: 1000 });
  const opps = h('input', { type: 'number', value: 1 });
  const result = h('div', { className: 'muted', style: 'margin-top:8px;font-size:13px' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const r = await api.post('/api/tools/dpmo', {
      defects: Number(defects.value), units: Number(units.value),
      opportunities_per_unit: Number(opps.value), apply_shift: true,
    });
    const s = r.summary || r;
    result.innerHTML = `<strong>DPMO ${s.dpmo?.toLocaleString?.()}</strong> · ` +
      `Sigma (with 1.5σ shift): <strong>${s.sigma_level_shifted?.toFixed?.(2)}</strong> · ` +
      `(without shift): ${s.sigma_level_no_shift?.toFixed?.(2)}`;
  })}, 'Compute');
  card.append(h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
    h('label', { className: 'field', style: 'flex:1;min-width:120px;margin:0' }, 'Defects', defects),
    h('label', { className: 'field', style: 'flex:1;min-width:120px;margin:0' }, 'Units', units),
    h('label', { className: 'field', style: 'flex:1;min-width:140px;margin:0' }, 'Opps / unit', opps),
  ), btn, result);
  return card;
}

function SampleSizeCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Sample Size / Power'));
  const kindSel = h('select', {},
    h('option', { value: 't_test' }, 't-test (mean shift)'),
    h('option', { value: 'proportion_test' }, 'Proportion test'),
    h('option', { value: 'anova' }, 'One-way ANOVA'),
    h('option', { value: 'regression' }, 'Multiple regression'),
    h('option', { value: 'cpk_validation' }, 'Cpk validation'),
  );
  const params = h('div', { className: 'stack', style: 'margin-top:8px' });
  const result = h('div', { className: 'muted', style: 'margin-top:8px;font-size:13px' });
  function build() {
    params.innerHTML = '';
    const kind = kindSel.value;
    const I = (label, name, value = '') => h('label', { className: 'field' }, label,
      h('input', { name, type: 'number', step: 'any', value }));
    if (kind === 't_test') params.append(I('delta (shift to detect)', 'delta', 1),
      I('sigma', 'sigma', 1), I('alpha', 'alpha', 0.05), I('power', 'power', 0.80));
    if (kind === 'proportion_test') params.append(I('p1', 'p1', 0.1),
      I('p2', 'p2', 0.15), I('alpha', 'alpha', 0.05), I('power', 'power', 0.80));
    if (kind === 'anova') params.append(I('k_groups', 'k_groups', 3),
      I("Cohen's f (effect)", 'effect_size_f', 0.25),
      I('alpha', 'alpha', 0.05), I('power', 'power', 0.80));
    if (kind === 'regression') params.append(I('n_predictors', 'n_predictors', 3),
      I("Cohen's f² (effect)", 'effect_size_f2', 0.15),
      I('alpha', 'alpha', 0.05), I('power', 'power', 0.80));
    if (kind === 'cpk_validation') params.append(I('cpk_target', 'cpk_target', 1.33),
      I('cpk_estimate', 'cpk_estimate', 1.50), I('confidence', 'confidence', 0.95));
  }
  kindSel.addEventListener('change', build); build();
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const body = { kind: kindSel.value };
    params.querySelectorAll('input').forEach(i => { body[i.name] = i.value === '' ? undefined : Number(i.value); });
    const r = await api.post('/api/tools/sample-size', body);
    result.innerHTML = '<pre style="background:var(--surface-2);padding:8px;border-radius:6px;font-size:12px;overflow:auto">' +
      escapeHtml(JSON.stringify(r.summary || r, null, 2)) + '</pre>';
  })}, 'Compute');
  card.append(h('label', { className: 'field' }, 'Test kind', kindSel), params, btn, result);
  return card;
}

function ProbabilityCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Probability Distribution Calculator'));
  const distSel = h('select', {},
    h('option', { value: 'normal' }, 'Normal'),
    h('option', { value: 't' }, 't'),
    h('option', { value: 'f' }, 'F'),
    h('option', { value: 'chi2' }, 'χ²'),
    h('option', { value: 'binomial' }, 'Binomial'),
    h('option', { value: 'poisson' }, 'Poisson'),
    h('option', { value: 'weibull' }, 'Weibull'),
    h('option', { value: 'exponential' }, 'Exponential'),
  );
  const modeSel = h('select', {},
    h('option', { value: 'pdf' }, 'PDF / PMF'),
    h('option', { value: 'cdf' }, 'CDF'),
    h('option', { value: 'ppf' }, 'Inverse CDF (quantile)'),
  );
  const xInput = h('input', { type: 'number', step: 'any', value: 1.96 });
  const paramsInput = h('textarea', { rows: 3, placeholder: 'JSON params, e.g. {"mean":0,"stdev":1}',
    value: '{"mean":0,"stdev":1}', style: 'font-family:var(--font-mono);font-size:12px' });
  const result = h('div', { className: 'muted', style: 'margin-top:8px;font-size:13px' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    try {
      const r = await api.post('/api/tools/probability', {
        distribution: distSel.value, mode: modeSel.value,
        x: Number(xInput.value),
        params: JSON.parse(paramsInput.value || '{}'),
      });
      result.innerHTML = `<strong>Result:</strong> ${typeof r.summary.result === 'number' ? r.summary.result.toFixed(6) : JSON.stringify(r.summary.result)}`;
    } catch { result.textContent = 'Bad JSON in params.'; }
  })}, 'Compute');
  card.append(
    h('div', { className: 'row', style: 'gap:10px' },
      h('label', { className: 'field', style: 'flex:1;margin:0' }, 'Distribution', distSel),
      h('label', { className: 'field', style: 'flex:1;margin:0' }, 'Mode', modeSel),
      h('label', { className: 'field', style: 'flex:1;margin:0' }, 'x', xInput),
    ),
    h('label', { className: 'field' }, 'Parameters (JSON)', paramsInput),
    btn, result,
  );
  return card;
}

function DesignGenerator() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'DOE Design Generator'));
  const designSel = h('select', {},
    h('option', { value: 'full_factorial' }, 'Full factorial 2^k'),
    h('option', { value: 'fractional_factorial' }, 'Fractional factorial'),
    h('option', { value: 'central_composite' }, 'Central Composite (CCD)'),
    h('option', { value: 'box_behnken' }, 'Box-Behnken'),
    h('option', { value: 'plackett_burman' }, 'Plackett-Burman'),
    h('option', { value: 'definitive_screening' }, 'Definitive screening'),
    h('option', { value: 'mixture_simplex_centroid' }, 'Mixture (simplex centroid)'),
    h('option', { value: 'mixture_simplex_lattice' }, 'Mixture (simplex lattice)'),
    h('option', { value: 'd_optimal' }, 'D-optimal (custom)'),
    h('option', { value: 'i_optimal' }, 'I-optimal (custom)'),
  );
  const factorsInput = h('input', { placeholder: 'Comma-separated factor names', value: 'A,B,C' });
  // Optimal-design-only controls (ignored by the classical designs).
  const nRunsInput = h('input', { type: 'number', value: 12, min: 2, style: 'width:80px' });
  const modelSel = h('select', {},
    ...['linear', 'interaction', 'quadratic'].map(m => h('option', { value: m }, m)));
  modelSel.value = 'interaction';
  const optRow = h('div', { className: 'row', style: 'gap:10px;margin-top:8px;display:none' },
    h('label', { className: 'field', style: 'margin:0' }, 'Run budget', nRunsInput),
    h('label', { className: 'field', style: 'margin:0' }, 'Model', modelSel));
  const syncOpt = () => {
    optRow.style.display = designSel.value.endsWith('optimal') ? 'flex' : 'none';
  };
  designSel.addEventListener('change', syncOpt); syncOpt();
  const result = h('div', { style: 'margin-top:8px' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const factors = factorsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const body = { design: designSel.value, factors };
    if (designSel.value.endsWith('optimal')) {
      body.n_runs = Number(nRunsInput.value);
      body.model = modelSel.value;
    }
    const r = await api.post('/api/tools/doe-design', body);
    const runs = r.summary?.runs || [];
    const cols = Object.keys(runs[0] || {});
    result.innerHTML = '';
    if (!runs.length) { result.textContent = 'No runs.'; return; }
    const effNote = r.summary.d_efficiency != null
      ? ` · D-efficiency ${(r.summary.d_efficiency).toFixed(3)}` : '';
    result.append(h('p', { className: 'muted', style: 'font-size:12px' },
      `${r.summary.n_runs} runs · ${r.summary.design}${effNote}`));
    const table = h('table', { className: 'table' });
    table.append(h('thead', {}, h('tr', {}, ...cols.map(c => h('th', {}, c)))));
    const tbody = h('tbody');
    for (const r of runs) tbody.append(h('tr', {}, ...cols.map(c => h('td', { className: 'mono' }, String(r[c])))));
    table.append(tbody); result.append(table);
  })}, 'Generate');
  card.append(
    h('div', { className: 'row', style: 'gap:10px' },
      h('label', { className: 'field', style: 'flex:1;margin:0' }, 'Design', designSel),
      h('label', { className: 'field', style: 'flex:2;margin:0' }, 'Factors', factorsInput),
    ), optRow, btn, result,
  );
  return card;
}

function AcceptanceSamplingTool() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Acceptance Sampling'));
  const aql = h('input', { type: 'number', step: 'any', value: 0.01 });
  const rql = h('input', { type: 'number', step: 'any', value: 0.05 });
  const alpha = h('input', { type: 'number', step: 'any', value: 0.05 });
  const beta = h('input', { type: 'number', step: 'any', value: 0.10 });
  const result = h('div', { className: 'muted', style: 'margin-top:8px;font-size:13px' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const r = await api.post('/api/tools/acceptance-sampling', {
      method: 'design', aql: +aql.value, rql: +rql.value,
      alpha: +alpha.value, beta: +beta.value,
    });
    const s = r.summary || r;
    result.innerHTML = `<strong>Plan: n=${s.n}, c=${s.c}</strong> · P(accept|AQL)=${(s.P_accept_at_AQL*100).toFixed(1)}% · P(accept|RQL)=${(s.P_accept_at_RQL*100).toFixed(1)}%`;
  })}, 'Design plan');
  card.append(
    h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
      h('label', { className: 'field', style: 'flex:1;min-width:80px;margin:0' }, 'AQL', aql),
      h('label', { className: 'field', style: 'flex:1;min-width:80px;margin:0' }, 'RQL', rql),
      h('label', { className: 'field', style: 'flex:1;min-width:80px;margin:0' }, 'α (producer)', alpha),
      h('label', { className: 'field', style: 'flex:1;min-width:80px;margin:0' }, 'β (consumer)', beta),
    ), btn, result,
  );
  return card;
}

function RandomDataGenerator() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Random Data Generator'));
  const distSel = h('select', {},
    h('option', { value: 'normal' }, 'Normal'),
    h('option', { value: 'uniform' }, 'Uniform'),
    h('option', { value: 'exponential' }, 'Exponential'),
    h('option', { value: 'weibull' }, 'Weibull'),
    h('option', { value: 'binomial' }, 'Binomial'),
    h('option', { value: 'poisson' }, 'Poisson'),
  );
  const n = h('input', { type: 'number', value: 100, min: 1 });
  const params = h('input', { value: '{"mean":0,"stdev":1}', placeholder: 'JSON',
    style: 'font-family:var(--font-mono);font-size:12px' });
  const result = h('pre', { style: 'background:var(--surface-2);padding:8px;border-radius:6px;font-size:11px;max-height:200px;overflow:auto' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    try {
      const r = await api.post('/api/tools/random-data', {
        distribution: distSel.value, n: Number(n.value),
        params: JSON.parse(params.value || '{}'),
      });
      result.textContent = JSON.stringify(r.summary, null, 2).slice(0, 4000);
    } catch { result.textContent = 'Bad JSON in params.'; }
  })}, 'Generate');
  card.append(
    h('div', { className: 'row', style: 'gap:10px' },
      h('label', { className: 'field', style: 'flex:1;margin:0' }, 'Distribution', distSel),
      h('label', { className: 'field', style: 'flex:1;margin:0' }, 'n', n),
    ),
    h('label', { className: 'field' }, 'Parameters (JSON)', params),
    btn, result,
  );
  return card;
}

// ────────────────── Final-batch calculators ──────────────────

function ArlDesignCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'CUSUM / EWMA ARL Design'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'Choose chart parameters for a target in-control ARL₀ and a target shift to detect.'));
  const chart = h('select', { className: 'fb-input' },
    h('option', { value: 'cusum' }, 'CUSUM'),
    h('option', { value: 'ewma' }, 'EWMA'));
  const arl0 = h('input', { type: 'number', value: 370.4 });
  const shift = h('input', { type: 'number', step: 0.1, value: 1.0 });
  const lam = h('input', { type: 'number', step: 0.05, value: 0.2,
    placeholder: 'EWMA only' });
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px;line-height:1.6' });
  const btn = h('button', { className: 'primary',
    onclick: () => withLoading(btn, async () => {
      const r = await api.post('/api/tools/arl-design', {
        chart_kind: chart.value, target_arl0: Number(arl0.value),
        shift: Number(shift.value),
        lam: chart.value === 'ewma' ? Number(lam.value) : null,
      });
      const s = r.summary || r;
      result.innerHTML = chart.value === 'cusum'
        ? `<strong>k = ${s.k.toFixed(2)}σ</strong>, <strong>h = ${s.h.toFixed(2)}σ</strong>. ARL₁ at the target shift ≈ ${s.approx_arl1_at_target_shift.toFixed(1)}.`
        : `<strong>λ = ${s.lambda.toFixed(2)}</strong>, <strong>L = ${s.L.toFixed(2)}</strong>. ARL₁ at the target shift ≈ ${s.approx_arl1_at_target_shift.toFixed(1)}.`;
      result.innerHTML += `<br><span class="muted">${s.decision_rule}</span>`;
    })}, 'Compute');
  card.append(h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
    h('label', { className: 'field' }, 'Chart', chart),
    h('label', { className: 'field' }, 'Target ARL₀', arl0),
    h('label', { className: 'field' }, 'Shift (σ)', shift),
    h('label', { className: 'field' }, 'λ (EWMA)', lam),
  ), btn, result);
  return card;
}

function MilStd414Calc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Variables Acceptance Sampling (Z1.9)'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'Sample size n and acceptance constant k for variables sampling plans, per MIL-STD-414 / ANSI/ASQ Z1.9.'));
  const aql = h('input', { type: 'number', step: 0.1, value: 1.0 });
  const lot = h('input', { type: 'number', value: 500 });
  const lvl = h('select', { className: 'fb-input' },
    h('option', { value: 'I' }, 'I (tightened)'),
    h('option', { value: 'II', selected: true }, 'II (normal)'),
    h('option', { value: 'III' }, 'III (reduced)'));
  const sd = h('input', { type: 'checkbox' });
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px;line-height:1.6' });
  const btn = h('button', { className: 'primary',
    onclick: () => withLoading(btn, async () => {
      const r = await api.post('/api/tools/acceptance-sampling', {
        method: 'variables_z1_9',
        aql: Number(aql.value), lot_size: Number(lot.value),
        inspection_level: lvl.value, sd_known: sd.checked,
      });
      const s = r.summary || r;
      result.innerHTML =
        `Code <strong>${s.sample_size_code}</strong> · n = <strong>${s.n}</strong> · k = <strong>${s.k.toFixed(3)}</strong><br>` +
        `<span class="muted">${s.decision_rule}</span>`;
    })}, 'Design plan');
  card.append(h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
    h('label', { className: 'field' }, 'AQL (%)', aql),
    h('label', { className: 'field' }, 'Lot size', lot),
    h('label', { className: 'field' }, 'Inspection level', lvl),
    h('label', { className: 'field', style: 'display:flex;align-items:center;gap:6px' },
      sd, h('span', {}, 'σ known (Form 1)')),
  ), btn, result);
  return card;
}

function StressStrengthCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Stress-Strength Reliability'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'P(strength > stress) for two normal populations. The textbook design-for-reliability calculation.'));
  const sm = h('input', { type: 'number', value: 50 });
  const ss = h('input', { type: 'number', value: 5 });
  const tm = h('input', { type: 'number', value: 80 });
  const ts = h('input', { type: 'number', value: 8 });
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px;line-height:1.6' });
  const btn = h('button', { className: 'primary',
    onclick: () => withLoading(btn, async () => {
      const r = await api.post('/api/tools/stress-strength', {
        stress_mean: Number(sm.value), stress_sd: Number(ss.value),
        strength_mean: Number(tm.value), strength_sd: Number(ts.value),
      });
      const s = r.summary || r;
      result.innerHTML = `Reliability = <strong>${(s.reliability * 100).toFixed(4)}%</strong> · ` +
        `Safety index z = ${s.z_safety_index.toFixed(2)}<br>` +
        `<span class="muted">${s.interpretation}</span>`;
    })}, 'Compute');
  card.append(h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
    h('label', { className: 'field' }, 'Stress μ', sm),
    h('label', { className: 'field' }, 'Stress σ', ss),
    h('label', { className: 'field' }, 'Strength μ', tm),
    h('label', { className: 'field' }, 'Strength σ', ts),
  ), btn, result);
  return card;
}

function DiscreteProbCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Discrete Probability Calculator'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'PMF / CDF for binomial, Poisson, hypergeometric, negative-binomial, geometric.'));
  const dist = h('select', { className: 'fb-input' },
    h('option', { value: 'binomial' }, 'binomial'),
    h('option', { value: 'poisson' }, 'poisson'),
    h('option', { value: 'hypergeometric' }, 'hypergeometric'),
    h('option', { value: 'neg_binomial' }, 'negative binomial'),
    h('option', { value: 'geometric' }, 'geometric'));
  const params = h('textarea', { rows: 3,
    placeholder: 'Distribution params as JSON, e.g. {"n":10,"p":0.3}',
    style: 'font-family:var(--font-mono);font-size:12px;width:100%' });
  params.value = '{"n": 10, "p": 0.3}';
  const x = h('input', { type: 'number', value: 3 });
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px;line-height:1.6' });
  const btn = h('button', { className: 'primary',
    onclick: () => withLoading(btn, async () => {
      let p;
      try { p = JSON.parse(params.value); }
      catch (e) { return toast({ kind: 'warn', msg: 'Invalid JSON params.' }); }
      const r = await api.post('/api/tools/discrete-probability', {
        distribution: dist.value, params: p, x: Number(x.value),
      });
      const s = r.summary || r;
      result.innerHTML =
        `P(X = ${s.x}) = <strong>${s.pmf.toFixed(6)}</strong> · ` +
        `P(X ≤ ${s.x}) = <strong>${s.cdf.toFixed(6)}</strong> · ` +
        `P(X > ${s.x}) = ${s.survival.toFixed(6)}<br>` +
        `<span class="muted">μ = ${s.mean.toFixed(3)} · σ² = ${s.variance.toFixed(3)}</span>`;
    })}, 'Compute');
  card.append(h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap' },
    h('label', { className: 'field' }, 'Distribution', dist),
    h('label', { className: 'field' }, 'X value', x),
  ),
    h('label', { className: 'field' }, 'Parameters (JSON)', params),
    btn, result);
  return card;
}

// ────────────────── RECIPES VIEW ──────────────────

function RecipesView() {
  const root = h('div');
  root.append(
    h('div', { className: 'breadcrumb' }, 'Workbench · Recipes'),
    h('h2', {}, 'Saved recipes', h('span', { className: 'muted' }, ' · pin analyses to re-run')),
  );
  const list = h('div', { className: 'card' });
  api.get('/api/analyses/recipes/list').then(({ recipes }) => {
    list.innerHTML = '';
    if (!recipes?.length) {
      list.append(h('div', { className: 'empty' },
        h('div', { className: 'empty-mark' }, 'Untagged'),
        h('div', { className: 'empty-title' }, 'No recipes yet.'),
        h('div', { className: 'empty-desc' }, 'Run an analysis you like, then click "Save" on its result card to keep it as a re-runnable recipe.'),
      ));
      return;
    }
    list.append(h('h3', {}, `${recipes.length} recipes`));
    const t = h('table', { className: 'table' });
    t.append(h('thead', {}, h('tr', {},
      h('th', {}, 'Name'), h('th', {}, 'Analysis'), h('th', {}, 'Tags'), h('th', {}, 'Saved'))));
    const tb = h('tbody');
    for (const r of recipes) {
      tb.append(h('tr', { className: 'clickable',
        onclick: () => { state.view = 'analyze'; render(); },
      },
        h('td', {}, h('strong', {}, r.name)),
        h('td', {}, ANALYSIS_KINDS[r.kind]?.label || r.kind),
        h('td', {}, r.tags?.join(', ') || ''),
        h('td', { className: 'muted' }, new Date(r.saved_at).toLocaleDateString()),
      ));
    }
    t.append(tb); list.append(t);
  }).catch(() => {});
  root.append(list);
  return root;
}

// ────────────────── Bootstrap ──────────────────

boot();
