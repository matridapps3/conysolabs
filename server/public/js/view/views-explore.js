function ExploreView() {
  const root = h('div', { className: 'explore-view' });
  const dsId = state._exploreDatasetId || state.current_dataset?.id;
  const ds = state.datasets.find(d => d.id === dsId) || state.current_dataset;
  if (!ds) {
    root.append(h('div', { className: 'card' },
      h('h3', {}, 'Pick a dataset to explore'),
      h('button', { className: 'secondary', onclick: () => { state.view = 'data'; render(); } }, '← Back to Data')));
    return root;
  }

  root.append(h('div', { className: 'row', style: 'margin-bottom:14px;gap:8px;align-items:center' },
    h('button', { className: 'ghost', onclick: () => { state.view = 'data'; render(); } }, '← Data'),
    h('h2', { style: 'margin:0;flex:1' }, '📊 Explore · ', h('span', { className: 'muted' }, ds.name)),
    h('button', { className: 'secondary',
      onclick: () => { state.view = 'analyze'; state.current_dataset = ds; render(); } },
      'Run an analysis on this →'),
  ));

  // Fetch rows once per dataset, cache on state.
  if (!state._exploreData || state._exploreData._dsId !== ds.id) {
    state._exploreData = { _dsId: ds.id, loading: true };
    api.get(`/api/datasets/${ds.id}/rows?limit=5000`).then(r => {
      state._exploreData = { _dsId: ds.id, rows: r.rows, n_total: r.n_total, truncated: r.truncated };
      render();
    }).catch((e) => {
      state._exploreData = { _dsId: ds.id, error: e.message || 'load failed' };
      render();
    });
    root.append(h('div', { className: 'card' }, skeleton({ lines: 2, block: 1 })));
    return root;
  }
  if (state._exploreData.error) {
    root.append(h('div', { className: 'card' },
      h('h3', {}, 'Could not load rows'),
      h('p', { className: 'muted' }, state._exploreData.error)));
    return root;
  }
  const rows = state._exploreData.rows || [];
  if (state._exploreData.truncated) {
    root.append(h('div', { className: 'card muted', style: 'font-size:12px;background:var(--surface);border-left:3px solid var(--accent)' },
      `Showing the first 5,000 of ${state._exploreData.n_total.toLocaleString()} rows. Statistics and analyses on the Analyze view use all rows.`));
  }

  // Infer numeric vs categorical from schema_json (preferred) or actual sample
  const schema = ds.schema_json || [];
  const numericCols  = schema.filter(c => c.type === 'number').map(c => c.name);
  const categCols    = schema.filter(c => c.type !== 'number').map(c => c.name);

  // ───── Custom chart builder ─────
  const builder = h('div', { className: 'card explore-builder' });
  builder.append(h('h3', { style: 'margin:0 0 10px' }, 'Custom chart'));
  const kindSel = h('select', { className: 'fb-input' });
  const KINDS = [
    ['histogram', 'Histogram (1 numeric)'],
    ['boxplot',   'Boxplot (1 numeric, optional group)'],
    ['scatter',   'Scatter (2 numeric)'],
    ['run',       'Run chart (1 numeric, in row order)'],
    ['bar',       'Bar chart (1 categorical → counts)'],
    ['pareto',    'Pareto (1 categorical, sorted)'],
  ];
  for (const [k, label] of KINDS) kindSel.append(h('option', { value: k }, label));
  if (state._exploreKind) kindSel.value = state._exploreKind;

  const xSel = h('select', { className: 'fb-input' });
  const ySel = h('select', { className: 'fb-input' });
  const gSel = h('select', { className: 'fb-input' });
  const populate = (sel, cols, includeNone) => {
    sel.innerHTML = '';
    if (includeNone) sel.append(h('option', { value: '' }, '— none —'));
    for (const c of cols) sel.append(h('option', { value: c }, c));
  };
  const renderHost = h('div', { className: 'explore-render', style: 'margin-top:14px' });

  function refreshControls() {
    const kind = kindSel.value;
    // X options depend on kind
    const xCols = (kind === 'bar' || kind === 'pareto') ? categCols : numericCols;
    populate(xSel, xCols, false);
    if (state._exploreX && xCols.includes(state._exploreX)) xSel.value = state._exploreX;
    // Y only for scatter
    const showY = kind === 'scatter';
    ySel.style.display = showY ? '' : 'none';
    yLbl.style.display = showY ? '' : 'none';
    if (showY) {
      populate(ySel, numericCols.filter(c => c !== xSel.value), false);
      if (state._exploreY && numericCols.includes(state._exploreY)) ySel.value = state._exploreY;
    }
    // Group only for boxplot
    const showG = kind === 'boxplot';
    gSel.style.display = showG ? '' : 'none';
    gLbl.style.display = showG ? '' : 'none';
    if (showG) populate(gSel, categCols, true);
  }

  function drawCustom() {
    renderHost.innerHTML = '';
    const kind = kindSel.value;
    state._exploreKind = kind; state._exploreX = xSel.value;
    state._exploreY = ySel.value; state._exploreG = gSel.value;
    if (!xSel.value) {
      renderHost.append(h('div', { className: 'muted', style: 'padding:18px;font-style:italic' }, 'Pick a column above.'));
      return;
    }
    try {
      renderHost.append(renderExploreChart(kind, xSel.value, ySel.value, gSel.value, rows));
    } catch (e) {
      renderHost.append(h('div', { className: 'muted' }, `Could not render: ${e.message}`));
    }
  }

  const xLbl = h('label', { className: 'kv-label' }, 'X');
  const yLbl = h('label', { className: 'kv-label' }, 'Y');
  const gLbl = h('label', { className: 'kv-label' }, 'Group by');
  const grid = h('div', { className: 'kv-form', style: 'grid-template-columns: 110px 1fr' },
    h('label', { className: 'kv-label' }, 'Chart'), kindSel,
    xLbl, xSel,
    yLbl, ySel,
    gLbl, gSel,
  );
  builder.append(grid);
  const drawBtn = h('button', { className: 'primary', style: 'margin-top:10px',
    onclick: () => drawCustom() }, 'Draw chart');
  builder.append(drawBtn);
  builder.append(renderHost);
  kindSel.addEventListener('change', () => { refreshControls(); drawCustom(); });
  xSel.addEventListener('change', () => { drawCustom(); });
  ySel.addEventListener('change', () => { drawCustom(); });
  gSel.addEventListener('change', () => { drawCustom(); });
  root.append(builder);

  refreshControls();
  // Auto-draw a sensible first chart if user has not picked anything yet.
  if (!state._exploreKind) {
    if (numericCols.length) {
      kindSel.value = 'histogram';
      xSel.value = numericCols[0];
    } else if (categCols.length) {
      kindSel.value = 'pareto';
      xSel.value = categCols[0];
    }
    refreshControls();
  }
  drawCustom();

  // ───── Auto-overview: one chart per column ─────
  const overview = h('div', { className: 'card', style: 'margin-top:14px' });
  overview.append(h('h3', { style: 'margin:0 0 4px' }, 'Auto-overview'),
    h('div', { className: 'muted', style: 'font-size:12px;margin-bottom:12px' },
      'One chart per column. Numeric → histogram. Categorical → Pareto. Hover for tooltip, drag to zoom, click to annotate, ↓ SVG / PNG to export.'));
  const grid2 = h('div', { className: 'explore-grid' });
  for (const c of schema) {
    const cell = h('div', { className: 'explore-cell' });
    cell.append(h('div', { className: 'explore-col-name' }, c.name,
      h('span', { className: 'muted', style: 'font-size:11px;margin-left:6px' },
        c.type + ' · ' + (c.n_unique != null ? c.n_unique + ' unique' : ''))));
    try {
      if (c.type === 'number') {
        const vals = rows.map(r => Number(r[c.name])).filter(v => Number.isFinite(v));
        cell.append(window.statsUx.svgHistogram(vals, { width: 360, height: 180 }));
      } else {
        const counts = {};
        for (const r of rows) {
          const k = r[c.name] == null ? '(missing)' : String(r[c.name]);
          counts[k] = (counts[k] || 0) + 1;
        }
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
        cell.append(window.statsUx.svgPareto(entries.map(e => e[0]), entries.map(e => e[1]),
          { width: 360, height: 200 }));
      }
    } catch (e) {
      cell.append(h('div', { className: 'muted', style: 'padding:18px' }, 'Could not chart: ' + e.message));
    }
    grid2.append(cell);
  }
  overview.append(grid2);
  root.append(overview);

  return root;
}

function renderExploreChart(kind, xCol, yCol, gCol, rows) {
  const ux = window.statsUx;
  if (kind === 'histogram') {
    const vals = rows.map(r => Number(r[xCol])).filter(v => Number.isFinite(v));
    return ux.svgHistogram(vals, { width: 720, height: 320 });
  }
  if (kind === 'run') {
    const vals = rows.map(r => Number(r[xCol])).filter(v => Number.isFinite(v));
    return ux.svgRunChart(vals, { width: 720, height: 280 });
  }
  if (kind === 'scatter') {
    const xs = [], ys = [];
    for (const r of rows) {
      const x = Number(r[xCol]), y = Number(r[yCol]);
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
    return ux.svgScatter(xs, ys, { width: 720, height: 380, xLabel: xCol, yLabel: yCol });
  }
  if (kind === 'boxplot') {
    if (gCol) {
      // Group-by boxplot: render one boxplot per group, stacked.
      const wrap = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px' });
      const groups = {};
      for (const r of rows) {
        const v = Number(r[xCol]);
        const g = r[gCol] == null ? '(missing)' : String(r[gCol]);
        if (Number.isFinite(v)) (groups[g] = groups[g] || []).push(v);
      }
      for (const [g, vals] of Object.entries(groups)) {
        const col = h('div');
        col.append(h('div', { className: 'muted', style: 'font-size:11px;text-align:center' }, g + ' · n=' + vals.length));
        col.append(ux.svgBoxplot(vals, { width: 280, height: 260 }));
        wrap.append(col);
      }
      return wrap;
    }
    const vals = rows.map(r => Number(r[xCol])).filter(v => Number.isFinite(v));
    return ux.svgBoxplot(vals, { width: 380, height: 320 });
  }
  if (kind === 'bar' || kind === 'pareto') {
    const counts = {};
    for (const r of rows) {
      const k = r[xCol] == null ? '(missing)' : String(r[xCol]);
      counts[k] = (counts[k] || 0) + 1;
    }
    const sortedDesc = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
    return ux.svgPareto(sortedDesc.map(e => e[0]), sortedDesc.map(e => e[1]), { width: 720, height: 320 });
  }
  return h('div', { className: 'muted' }, 'Unknown chart kind');
}

// ═══════════════════════════════════════════════════════════════════════
//  InsightsView — Conyso Originals for LSS practitioners.
//
//  Five chart kinds that don't exist in any commercial tool: Variance Budget,
//  Capability Trajectory, RPN Heat Bubbles, Sigma Slippage, Cost-Weighted
//  Pareto. Each turns an existing LSS table-of-numbers ritual into a single
//  decision-grade visual. Originally prototyped in Lens; they live here in
//  Bench because the audience is the SPC / MSA / FMEA crowd.
//
//  All five reuse `window.statsUx.renderInteractiveChart` (hover crosshair,
//  brush-to-zoom, SVG/PNG export) where the chart is interactive, and a
//  minimal static wrapper otherwise.
// ═══════════════════════════════════════════════════════════════════════
const INSIGHTS_LIST = [
  { id: 'variancebudget', label: 'Variance Budget',
    blurb: '"Where is my variation coming from?" Total variance decomposed by η² across each categorical source. The GR&R / ANOVA story without a table.',
    inputs: [{ key: 'value',  label: 'Numeric variable', kind: 'numeric',     required: true },
             { key: 'source', label: 'Variance source (optional — defaults to all categoricals)', kind: 'categorical' }] },
  { id: 'capabilitytraj', label: 'Capability Trajectory',
    blurb: 'Current Cpk plus "what if" projections — reduce σ by 20% or 50%, centre on target, or both. Turns capability into a decision.',
    inputs: [{ key: 'x',      label: 'Variable', kind: 'numeric', required: true },
             { key: 'lsl',    label: 'LSL', kind: 'number',  required: true },
             { key: 'usl',    label: 'USL', kind: 'number',  required: true },
             { key: 'target', label: 'Target (optional)', kind: 'number' }] },
  { id: 'rpngrid', label: 'RPN Heat Bubbles',
    blurb: 'FMEA visualised: Severity × Occurrence axes, Detection = bubble size, RPN band = colour. Replaces the FMEA table for executive review.',
    inputs: [{ key: 'severity',   label: 'Severity (1–10)',   kind: 'numeric', required: true },
             { key: 'occurrence', label: 'Occurrence (1–10)', kind: 'numeric', required: true },
             { key: 'detection',  label: 'Detection (1–10)',  kind: 'numeric', required: true },
             { key: 'label',      label: 'Failure-mode label (optional)', kind: 'categorical' }] },
  { id: 'sigmaslip', label: 'Sigma Slippage',
    blurb: 'Rolling 30-obs Cpk over row order. Reveals capability drift weeks before a control chart would flag it.',
    inputs: [{ key: 'x',      label: 'Variable', kind: 'numeric', required: true },
             { key: 'lsl',    label: 'LSL', kind: 'number',  required: true },
             { key: 'usl',    label: 'USL', kind: 'number',  required: true },
             { key: 'window', label: 'Window', kind: 'integer', default: 30 }] },
  { id: 'costpareto', label: 'Cost-Weighted Pareto',
    blurb: 'Two Paretos side by side — by frequency and by total cost. Reveals when the most-frequent defect isn\'t the most expensive.',
    inputs: [{ key: 'x',    label: 'Defect / category', kind: 'categorical', required: true },
             { key: 'cost', label: 'Unit cost',         kind: 'numeric',     required: true }] },
];

// ═══════════════════════════════════════════════════════════════════════
//  DashboardView — Process Behavior Dashboard.
//
//  Aggregates every control-chart analysis in the workspace into a grid of
//  red/amber/green tiles. Red = out-of-control (any rule_violations).
//  Amber = drifting (Nelson rule 2, 5, or 6 — pattern but not 3σ).
//  Green = stable, no rules tripped.
//
//  The morning-standup view a DMAIC team can scan in five seconds to know
//  what to chase today. Minitab has nothing like this.
// ═══════════════════════════════════════════════════════════════════════
function DashboardView() {
  const root = h('div', { className: 'dashboard-view' });
  root.append(h('h2', { style: 'margin:0 0 6px' }, 'Process Behavior Dashboard'),
    h('p', { className: 'muted', style: 'margin:0 0 18px;max-width:720px;font-style:italic' },
      'Every control chart in the workspace, scored red / amber / green. '
      + 'Red = special cause this run. Amber = pattern detected (drift, shift, mixture). '
      + 'Green = in control. Click any tile to open the underlying chart.'));

  const charts = (state.analyses || []).filter(a => a.kind === 'control_chart');

  if (!charts.length) {
    root.append(h('div', { className: 'card', style: 'padding:24px;text-align:center' },
      h('p', { className: 'muted' }, 'No control charts yet. Build some from the Analyze view.'),
      h('button', { className: 'primary', style: 'margin-top:8px',
        onclick: () => { state.view = 'analyze';
                          state._chosenKind = 'control_chart';
                          render(); } }, 'Run a control chart')));
    return root;
  }

  // Classify every chart and group by status.
  const tiles = charts.map(a => {
    const s = a.result_json?.summary || {};
    const v = s.rule_violations || [];
    let status = 'green';
    let label = 'in control';
    if (v.length) {
      const rules = new Set(v.map(rv => rv.rule_number || rv.rule || 0));
      // Rule 1 (beyond 3σ) is the urgent red. Any other rule (pattern) → amber.
      if (rules.has(1) || rules.has('rule_1')) {
        status = 'red'; label = 'out of control';
      } else {
        status = 'amber'; label = 'pattern detected';
      }
    }
    return { a, s, status, label, n_violations: v.length };
  });
  const counts = { red: 0, amber: 0, green: 0 };
  for (const t of tiles) counts[t.status]++;

  // Mark which charts are stale (dataset appended since the chart was run).
  for (const t of tiles) {
    const ds = t.a.dataset_id ? state.datasets.find(d => d.id === t.a.dataset_id) : null;
    t.stale = !!(ds && t.a.dataset_version != null && ds.version != null && ds.version > t.a.dataset_version);
  }
  const staleTiles = tiles.filter(t => t.stale);

  // Status filter — clicking a KPI card toggles a filter to that status.
  const filter = state._dashFilter || null;   // 'red' | 'amber' | 'green' | null
  const kpi = (key, label, klass) => h('div', {
    className: 'metric' + (klass ? ' ' + klass : '') + (filter === key ? ' metric-active' : ''),
    style: 'cursor:pointer',
    role: 'button', tabindex: '0',
    title: filter === key ? 'Show all' : `Show only ${label.toLowerCase()}`,
    'aria-pressed': filter === key ? 'true' : 'false',
    onclick: () => { state._dashFilter = filter === key ? null : key; render(); },
  }, h('div', { className: 'label' }, label), h('div', { className: 'value' }, String(counts[key] ?? 0)));

  // Refresh-all-stale control.
  const refreshAll = h('button', { className: 'secondary', style: 'font-size:12px',
    disabled: !staleTiles.length,
    title: staleTiles.length ? `Re-run ${staleTiles.length} stale chart(s) against current data` : 'No stale charts',
    onclick: () => withLoading(refreshAll, async () => {
      let okN = 0;
      for (const t of staleTiles) {
        try { await api.post(`/api/analyses/${t.a.id}/refresh`, {}); okN++; } catch {}
      }
      toast({ kind: 'success', msg: `Refreshed ${okN} of ${staleTiles.length} stale chart(s).` });
      await refreshData(); render();
    }),
  }, `↻ Refresh stale${staleTiles.length ? ` (${staleTiles.length})` : ''}`);

  root.append(h('div', { className: 'metric-strip', style: 'margin-bottom:14px' },
    kpi('red', 'Red', 'danger'),
    kpi('amber', 'Amber', 'warn'),
    kpi('green', 'Green', 'success'),
    h('div', { className: 'metric' },
      h('div', { className: 'label' }, 'Total charts'),
      h('div', { className: 'value' }, String(tiles.length))),
  ));
  root.append(h('div', { className: 'row', style: 'gap:10px;align-items:center;margin-bottom:14px' },
    filter ? h('span', { className: 'pill accent', style: 'font-size:11px' },
      `Filtered: ${filter}`) : null,
    filter ? h('button', { className: 'ghost', style: 'font-size:11px',
      onclick: () => { state._dashFilter = null; render(); } }, 'Clear filter') : null,
    h('span', { style: 'flex:1' }),
    refreshAll));

  // Sort: red first, then amber, then green; within each by most recent.
  tiles.sort((a, b) => {
    const order = { red: 0, amber: 1, green: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (b.a.created_at || 0) - (a.a.created_at || 0);
  });
  const shown = filter ? tiles.filter(t => t.status === filter) : tiles;

  const grid = h('div', { className: 'dash-grid',
    style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:14px' });
  for (const t of shown) {
    const tile = h('div', { className: 'card dash-tile',
      style: `cursor:pointer;border-left:4px solid ${t.status === 'red' ? 'var(--danger,#b03a3a)'
                                                  : t.status === 'amber' ? '#b08400'
                                                  : 'var(--success,#2f7d3a)'};padding:14px`,
      onclick: () => {
        state._scrollToAnalysis = t.a.id;
        state.view = 'analyze';
        state._analysisFamily = 'control';
        state.formOpen = false;       // keep the form collapsed so the list shows
        render();
      },
    });
    const params = t.a.params_json || {};
    const column = params.column || params.columns?.join(',') || '—';
    tile.append(
      h('div', { style: 'font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--muted)' },
        params.kind || 'control chart'),
      h('div', { style: 'font-family:var(--font-display, serif);font-size:18px;margin-top:2px' }, column),
      h('div', { className: 'muted', style: 'font-size:11px;margin-top:6px' },
        new Date((t.a.created_at || 0) * 1000).toLocaleDateString()),
      h('div', { style: `margin-top:10px;font-size:12px;color:${t.status === 'red' ? 'var(--danger,#b03a3a)' : t.status === 'amber' ? '#b08400' : 'var(--success,#2f7d3a)'};font-weight:600` },
        t.label.toUpperCase() + (t.n_violations ? ` · ${t.n_violations} rule(s)` : '')),
      t.stale ? h('div', { style: 'margin-top:6px' },
        h('span', { className: 'pill', style: 'background:#b08400;color:white;font-size:10px;letter-spacing:0.06em',
          title: 'Dataset changed since this chart ran — use Refresh stale' }, 'STALE')) : null,
    );
    grid.append(tile);
  }
  root.append(grid);
  return root;
}

// ═══════════════════════════════════════════════════════════════════════
//  PipelinesView — chained transform + analysis "recipes" as replayable
//  units. The backend (routes/pipelines.js) was fully built but had no
//  front door; this is it.
// ═══════════════════════════════════════════════════════════════════════

// Transform ops + analysis kinds the pipeline runner supports (mirror of the
// dispatch tables in routes/pipelines.js).
const PIPELINE_TRANSFORM_OPS = [
  'compute', 'recode', 'retype', 'rename', 'drop', 'impute', 'filter',
  'stack', 'unstack', 'log', 'boxcox', 'standardize', 'bin', 'mice',
];
const PIPELINE_ANALYSIS_KINDS = [
  'capability', 'hypothesis_test', 'control_chart', 'regression', 'msa',
  'doe', 'pareto', 'distribution_id', 'reliability', 'multivariate',
  'time_series', 'posthoc', 'tolerance', 'graph', 'anom', 'sixpack',
  'agreement', 'bootstrap', 'correlation', 'survival', 'mixed_effects',
];

// Build a JSON-shape placeholder for a pipeline step's params, so users see
// which keys an op expects instead of guessing.
const PIPELINE_TRANSFORM_HINTS = {
  compute:   '{"new_column":"ratio","expression":"defects / units"}',
  recode:    '{"column":"grade","mapping":{"A":4,"B":3}}',
  retype:    '{"column":"date","type":"datetime"}',
  rename:    '{"from":"old","to":"new"}',
  drop:      '{"columns":["scratch_col"]}',
  impute:    '{"column":"yield","strategy":"median"}',
  filter:    '{"expr":"yield > 90"}',
  stack:     '{"id_vars":["id"],"value_vars":["m1","m2"]}',
  unstack:   '{"index":"id","columns":"key","values":"val"}',
  log:       '{"column":"cycle_time"}',
  boxcox:    '{"column":"cycle_time"}',
  standardize: '{"column":"value"}',
  bin:       '{"column":"value","bins":5}',
  mice:      '{"columns":["a","b"],"n_iterations":10}',
};
function pipelineParamHint(kind, op) {
  if (kind === 'transform') {
    return PIPELINE_TRANSFORM_HINTS[op] || 'params JSON';
  }
  // analyze — derive expected keys from ANALYSIS_KINDS where available.
  const spec = ANALYSIS_KINDS[op];
  if (spec && Array.isArray(spec.params) && spec.params.length) {
    const obj = {};
    for (const p of spec.params.slice(0, 4)) {
      obj[p.name] = p.kind === 'num' ? 0
        : p.kind === 'cols' ? ['col1']
        : p.kind === 'bool' ? false
        : 'col';
    }
    return JSON.stringify(obj);
  }
  return 'params JSON, e.g. {"column":"yield"}';
}

function PipelinesView() {
  const root = h('div', { className: 'pipelines-view' });
  root.append(h('div', { className: 'row', style: 'align-items:center;gap:10px;margin-bottom:6px' },
    h('h2', { style: 'margin:0;flex:1' }, 'Pipelines'),
    h('button', { className: 'primary',
      onclick: () => openPipelineBuilder() }, '+ New pipeline')));
  root.append(h('p', { className: 'muted', style: 'margin:0 0 18px;max-width:720px;font-style:italic' },
    'A pipeline chains data transforms and analyses into one replayable unit. '
    + 'Run it on new data with one click — every step’s output feeds the next.'));

  const pipelines = state.pipelines || [];
  if (!pipelines.length) {
    root.append(h('div', { className: 'card', style: 'padding:28px;text-align:center' },
      h('div', { className: 'empty-mark' }, 'No pipelines yet'),
      h('p', { className: 'muted', style: 'margin:8px 0 14px' },
        'Build a reusable transform → analyze chain — e.g. impute missings → compute a ratio → run capability.'),
      h('button', { className: 'primary', onclick: () => openPipelineBuilder() }, 'Build your first pipeline')));
    return root;
  }

  for (const p of pipelines) {
    const card = h('div', { className: 'card', style: 'margin:0 0 12px' });
    const steps = p.steps_json || [];
    const lastRun = p.last_run_at ? new Date(p.last_run_at * 1000).toLocaleString() : 'never run';
    card.append(h('div', { className: 'card-header' },
      h('h3', {}, p.name),
      h('span', { className: 'meta' }, `${steps.length} step${steps.length === 1 ? '' : 's'} · ${lastRun}`),
      h('span', { className: 'spacer' }),
      h('button', { className: 'primary', style: 'font-size:12px',
        onclick: (e) => runPipeline(p, e.currentTarget, card) }, '▶ Run'),
      h('button', { className: 'toolbar-btn', title: 'Delete pipeline', 'aria-label': 'Delete pipeline',
        onclick: async () => {
          if (!confirm(`Delete pipeline "${p.name}"?`)) return;
          await api.delete(`/api/pipelines/${p.id}`).catch(() => {});
          await refreshData(); render();
        } }, 'Delete')));
    // Step chain — compact, scannable.
    const chain = h('div', { className: 'mono muted',
      style: 'font-size:11px;background:var(--surface);border:1px solid var(--line);padding:8px 12px;border-radius:3px;line-height:1.7' });
    steps.forEach((s, i) => {
      const label = s.kind === 'transform'
        ? `${i + 1}. transform · ${s.op}`
        : `${i + 1}. analyze · ${s.analysis_kind}`;
      chain.append(h('div', {}, label));
    });
    card.append(chain);
    // Last-run result, if any.
    if (p.last_result_json) card.append(renderPipelineResult(p.last_result_json));
    root.append(card);
  }
  return root;
}

// Render the step-by-step outcome of a pipeline run (live or cached).
function renderPipelineResult(result) {
  const wrap = h('div', { style: 'margin-top:10px' });
  const ok = result.ok;
  wrap.append(h('div', {
    style: `font-size:12px;font-weight:600;margin-bottom:6px;color:${ok ? 'var(--success,#2f7d3a)' : 'var(--danger,#b03a3a)'}` },
    ok ? `✓ Completed all ${result.n_steps} steps (${result.total_ms} ms)`
       : `✗ Stopped at step ${result.n_completed + 1} of ${result.n_steps}`));
  for (const s of (result.steps || [])) {
    const line = s.ok
      ? h('div', { style: 'font-size:11px;color:var(--ink-2);padding:3px 0' },
          `✓ ${s.step}. ${s.kind === 'transform' ? s.op : s.analysis_kind}`,
          h('span', { className: 'muted' }, `  ·  ${s.ms || 0} ms`
            + (s.n_rows != null ? `  ·  ${s.n_rows} rows` : '')))
      : h('div', { style: 'font-size:11px;color:var(--danger,#b03a3a);padding:3px 0' },
          `✗ ${s.step}. ${s.kind} — ${s.error || 'failed'}`);
    wrap.append(line);
  }
  return wrap;
}

// Run a pipeline and show live progress in its card.
async function runPipeline(p, btn, card) {
  btn.disabled = true; const prev = btn.textContent; btn.textContent = 'Running…';
  // Drop any prior result block, add a live one.
  card.querySelectorAll('.pipeline-live').forEach(n => n.remove());
  const live = h('div', { className: 'pipeline-live', style: 'margin-top:10px' },
    h('div', { className: 'muted', style: 'font-size:12px' }, 'Running pipeline…'));
  card.append(live);
  try {
    const r = await api.post(`/api/pipelines/${p.id}/run`, {});
    live.innerHTML = '';
    live.append(renderPipelineResult(r));
    p.last_result_json = r;     // cache so a re-render keeps it
    toast({ kind: r.ok ? 'success' : 'warn',
      msg: r.ok ? `Pipeline finished — ${r.n_steps} steps.` : `Pipeline stopped at step ${r.n_completed + 1}.` });
    // Refresh datasets/analyses since the run may have created new ones.
    await refreshData();
  } catch (e) {
    live.innerHTML = '';
    live.append(h('div', { style: 'font-size:12px;color:var(--danger,#b03a3a)' },
      e.message || 'Pipeline run failed.'));
  } finally {
    btn.disabled = false; btn.textContent = prev;
  }
}

// Per-op parameter specs for transforms — mirror wrangle/transform.py exactly
// so the generated form fields produce params the backend accepts.
const TRANSFORM_OP_PARAMS = {
  compute:     [{ name: 'new_column', kind: 'string' }, { name: 'expression', kind: 'string' }],
  recode:      [{ name: 'column', kind: 'col' }, { name: 'mapping', kind: 'json', help: '{"A":4,"B":3}' },
                { name: 'new_column', kind: 'string', optional: true }, { name: 'default', kind: 'string', optional: true }],
  retype:      [{ name: 'column', kind: 'col' }, { name: 'type', kind: 'enum', options: ['number', 'int', 'date', 'bool', 'string'] }],
  rename:      [{ name: 'from', kind: 'col' }, { name: 'to', kind: 'string' }],
  drop:        [{ name: 'columns', kind: 'cols' }],
  impute:      [{ name: 'column', kind: 'col' }, { name: 'strategy', kind: 'enum', options: ['mean', 'median', 'mode', 'ffill', 'bfill', 'constant'] },
                { name: 'value', kind: 'string', optional: true }],
  filter:      [{ name: 'expression', kind: 'string', help: 'e.g. yield > 90' }],
  stack:       [{ name: 'id_vars', kind: 'cols' }, { name: 'value_vars', kind: 'cols' }],
  unstack:     [{ name: 'id_vars', kind: 'cols' }, { name: 'var_col', kind: 'col' }, { name: 'value_col', kind: 'col' },
                { name: 'aggfunc', kind: 'enum', options: ['first', 'mean', 'sum', 'min', 'max', 'count'], optional: true }],
  log:         [{ name: 'column', kind: 'col' }, { name: 'new_column', kind: 'string', optional: true }],
  boxcox:      [{ name: 'column', kind: 'col' }, { name: 'new_column', kind: 'string', optional: true }],
  standardize: [{ name: 'column', kind: 'col' }, { name: 'new_column', kind: 'string', optional: true }],
  bin:         [{ name: 'column', kind: 'col' }, { name: 'bins', kind: 'num', defaultValue: 5 },
                { name: 'strategy', kind: 'enum', options: ['equal_width', 'quantile'], optional: true }],
  mice:        [{ name: 'columns', kind: 'cols' }, { name: 'n_iterations', kind: 'num', defaultValue: 10, optional: true }],
};

let _datalistSeq = 0;
// Render real form controls for a list of param specs (shared by the pipeline
// builder; specs come from TRANSFORM_OP_PARAMS or ANALYSIS_KINDS[kind].params).
// `colNames` seeds a datalist so column fields autocomplete but still allow a
// computed-column name a later pipeline step produced. Returns {node, collect}.
function renderParamControls(specs, colNames, seed) {
  seed = seed || {};
  const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  let dl = null;
  if (colNames && colNames.length) {
    dl = h('datalist', { id: `dl-${++_datalistSeq}` }, ...colNames.map(c => h('option', { value: c })));
    wrap.append(dl);
  }
  const getters = [];
  for (const sp of (specs || [])) {
    const labelText = sp.name + (sp.optional ? ' (optional)' : '');
    let input;
    if (sp.kind === 'enum') {
      input = h('select', { className: 'fb-input' },
        ...(sp.optional ? [h('option', { value: '' }, '—')] : []),
        ...(sp.options || []).map(o => h('option', { value: o }, o)));
      if (seed[sp.name] != null) input.value = seed[sp.name];
    } else if (sp.kind === 'bool') {
      input = h('select', { className: 'fb-input' },
        h('option', { value: 'false' }, 'false'), h('option', { value: 'true' }, 'true'));
      if (seed[sp.name] != null) input.value = String(seed[sp.name]);
    } else if (sp.kind === 'num') {
      input = h('input', { className: 'fb-input', type: 'number',
        value: seed[sp.name] != null ? seed[sp.name] : (sp.defaultValue != null ? sp.defaultValue : '') });
    } else if (sp.kind === 'json') {
      input = h('textarea', { className: 'fb-input', rows: 2,
        placeholder: sp.help || '{}', style: 'font-family:var(--font-mono);font-size:11px' });
      if (seed[sp.name] != null) input.value = typeof seed[sp.name] === 'string' ? seed[sp.name] : JSON.stringify(seed[sp.name]);
    } else {
      // col / cols / string — text input (col + cols get the datalist).
      input = h('input', { className: 'fb-input', type: 'text',
        placeholder: sp.kind === 'cols' ? (sp.help || 'comma-separated columns') : (sp.help || ''),
        value: seed[sp.name] != null ? (Array.isArray(seed[sp.name]) ? seed[sp.name].join(', ') : seed[sp.name]) : '' });
      if (dl && (sp.kind === 'col')) input.setAttribute('list', dl.id);
    }
    wrap.append(h('label', { className: 'field', style: 'margin:0' },
      h('span', { style: 'font-size:11px;color:var(--muted)' }, labelText), input));
    getters.push({ sp, input });
  }
  const collect = () => {
    const out = {};
    for (const { sp, input } of getters) {
      const raw = input.value;
      if (raw == null || raw === '') continue;          // skip empties (optionals)
      if (sp.kind === 'num') out[sp.name] = Number(raw);
      else if (sp.kind === 'bool') out[sp.name] = raw === 'true';
      else if (sp.kind === 'cols') out[sp.name] = raw.split(',').map(s => s.trim()).filter(Boolean);
      else if (sp.kind === 'json') out[sp.name] = JSON.parse(raw);   // throws → caught by caller
      else out[sp.name] = raw;
    }
    return out;
  };
  return { node: wrap, collect };
}

// Pipeline builder modal — define name, starting dataset, and an ordered list
// of steps; each step's params are real form fields (no JSON typing).
function openPipelineBuilder() {
  if (!state.datasets.length) {
    return toast({ kind: 'warn', msg: 'Upload a dataset first — a pipeline needs a starting dataset.' });
  }
  const nameInput = h('input', { className: 'fb-input', placeholder: 'e.g. Clean → ratio → capability' });
  // Columns of the starting dataset seed the per-field autocomplete.
  const colsFor = (dsId) => (state.datasets.find(d => d.id === dsId)?.schema_json || []).map(c => c.name);
  const dsSel = h('select', { className: 'fb-input' },
    ...state.datasets.map(d => h('option', { value: d.id }, d.name)));
  if (state.current_dataset) dsSel.value = state.current_dataset.id;
  dsSel.addEventListener('change', () => renderSteps());   // refresh field datalists

  const steps = [];           // [{kind, op|analysis_kind, params:{}, _collect}]
  const stepsHost = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });

  const specFor = (st) => st.kind === 'transform'
    ? (TRANSFORM_OP_PARAMS[st.op] || [])
    : (ANALYSIS_KINDS[st.analysis_kind]?.params || []);

  const renderSteps = () => {
    stepsHost.innerHTML = '';
    if (!steps.length) {
      stepsHost.append(h('div', { className: 'muted', style: 'font-size:12px;font-style:italic;padding:6px 0' },
        'No steps yet — add a transform or an analysis below.'));
    }
    const colNames = colsFor(dsSel.value);
    steps.forEach((st, i) => {
      const kindSel = h('select', { className: 'fb-input', style: 'max-width:130px' },
        h('option', { value: 'transform' }, 'transform'),
        h('option', { value: 'analyze' }, 'analyze'));
      kindSel.value = st.kind;
      const opSel = h('select', { className: 'fb-input', style: 'max-width:190px' });
      const fieldsHost = h('div', { style: 'margin-top:6px' });
      const fillOps = () => {
        opSel.innerHTML = '';
        const opts = st.kind === 'transform' ? PIPELINE_TRANSFORM_OPS : PIPELINE_ANALYSIS_KINDS;
        for (const o of opts) opSel.append(h('option', { value: o }, o));
        opSel.value = (st.kind === 'transform' ? st.op : st.analysis_kind) || opts[0];
      };
      // (Re)build the param fields for the current op, seeding from st.params.
      const renderFields = () => {
        const ctrl = renderParamControls(specFor(st), colNames, st.params || {});
        st._collect = ctrl.collect;
        fieldsHost.innerHTML = '';
        fieldsHost.append(ctrl.node);
      };
      fillOps();
      kindSel.addEventListener('change', () => {
        st.kind = kindSel.value; fillOps();
        if (st.kind === 'transform') { st.op = opSel.value; delete st.analysis_kind; }
        else { st.analysis_kind = opSel.value; delete st.op; }
        st.params = {}; renderFields();
      });
      opSel.addEventListener('change', () => {
        if (st.kind === 'transform') st.op = opSel.value; else st.analysis_kind = opSel.value;
        st.params = {}; renderFields();
      });
      renderFields();
      const up = h('button', { className: 'ghost', title: 'Move up', 'aria-label': 'Move step up',
        disabled: i === 0,
        onclick: () => { _snapshotSteps(); [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; renderSteps(); } }, '↑');
      const del = h('button', { className: 'ghost', title: 'Remove step', 'aria-label': 'Remove step',
        style: 'color:var(--danger)', onclick: () => { _snapshotSteps(); steps.splice(i, 1); renderSteps(); } }, '×');
      stepsHost.append(h('div', { className: 'card', style: 'padding:8px;margin:0' },
        h('div', { className: 'row', style: 'gap:6px;align-items:center;margin-bottom:2px' },
          h('span', { className: 'muted', style: 'font-size:11px;width:16px' }, String(i + 1)),
          kindSel, opSel, h('span', { style: 'flex:1' }), up, del),
        fieldsHost));
    });
  };
  // Before reorder/remove, capture each step's current field values so they
  // survive the rebuild.
  const _snapshotSteps = () => {
    for (const st of steps) { try { if (st._collect) st.params = st._collect(); } catch {} }
  };
  renderSteps();

  const addBtn = h('button', { className: 'secondary', style: 'font-size:12px',
    onclick: () => { _snapshotSteps(); steps.push({ kind: 'transform', op: 'compute', params: {} }); renderSteps(); } },
    '+ Add step');
  const save = h('button', { className: 'primary' }, 'Save pipeline');
  const cancel = h('button', { className: 'ghost' }, 'Cancel');
  const status = h('div', { className: 'muted', style: 'font-size:12px;min-height:16px;margin-top:6px' });

  const modal = h('div', { className: 'modal-backdrop',
    style: 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center',
    onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) modal.remove(); } },
    h('div', { className: 'card', style: 'max-width:680px;width:92vw;max-height:88vh;overflow:auto' },
      h('h3', { style: 'margin:0 0 10px' }, 'New pipeline'),
      h('label', { className: 'field' }, 'Name', nameInput),
      h('label', { className: 'field' }, 'Starting dataset', dsSel),
      h('div', { className: 'field' },
        h('div', { style: 'font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px' }, 'Steps'),
        stepsHost),
      addBtn,
      status,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:14px' }, cancel, save)));
  document.body.append(modal);
  attachEscClose(modal);
  cancel.onclick = () => modal.remove();
  save.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { status.textContent = 'Give the pipeline a name.'; return; }
    if (!steps.length) { status.textContent = 'Add at least one step.'; return; }
    // Collect each step's field values into a params object.
    const payloadSteps = [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      let params = {};
      try { params = st._collect ? st._collect() : (st.params || {}); }
      catch { status.textContent = `Step ${i + 1}: a JSON field (e.g. mapping) isn't valid JSON.`; return; }
      payloadSteps.push(st.kind === 'transform'
        ? { kind: 'transform', op: st.op, params }
        : { kind: 'analyze', analysis_kind: st.analysis_kind, params });
    }
    save.disabled = true; status.textContent = 'Saving…';
    try {
      await api.post('/api/pipelines', { name, dataset_id: dsSel.value, steps: payloadSteps });
      modal.remove();
      toast({ kind: 'success', msg: `Pipeline "${name}" saved.` });
      await refreshData(); render();
    } catch (e) {
      status.textContent = e.message || 'Save failed.';
      save.disabled = false;
    }
  };
}

function InsightsView() {
  const root = h('div', { className: 'insights-view' });
  const ux = window.statsUx || {};
  const svgT = ux.svg;          // svg('rect',{...}) factory
  const fmtNum = ux.fmtNum || ((v) => String(v));
  const niceTicks = ux.niceTicks || ((a, b, n) => { const r=[]; for(let i=0;i<=n;i++) r.push(a + (b-a)*i/n); return r; });

  // ── Pick a dataset (mirror ExploreView's loader pattern) ──
  const dsId = state._insightsDatasetId || state.current_dataset?.id;
  const ds = state.datasets.find(d => d.id === dsId) || state.current_dataset;
  if (!ds) {
    root.append(h('div', { className: 'card' },
      h('h3', {}, 'Pick a dataset for Insights'),
      h('p', { className: 'muted' }, 'Conyso Originals run on real rows from one of your datasets.'),
      h('button', { className: 'secondary', onclick: () => { state.view = 'data'; render(); } }, '← Back to Data')));
    return root;
  }

  root.append(h('div', { className: 'row', style: 'margin-bottom:14px;gap:8px;align-items:center' },
    h('h2', { style: 'margin:0;flex:1' }, '✦ Insights · ',
      h('span', { className: 'muted' }, ds.name)),
    h('span', { className: 'muted', style: 'font-size:11px;letter-spacing:0.08em;text-transform:uppercase' },
      'Conyso Originals'),
  ));
  root.append(h('p', { className: 'muted', style: 'margin:0 0 16px;max-width:720px;font-style:italic' },
    'Five chart kinds Bench draws that no commercial tool does. Each replaces a table you\'d otherwise stare at with a single decision-grade visual.'));

  // ── Fetch rows ──
  if (!state._insightsData || state._insightsData._dsId !== ds.id) {
    state._insightsData = { _dsId: ds.id, loading: true };
    api.get(`/api/datasets/${ds.id}/rows?limit=5000`).then(r => {
      state._insightsData = { _dsId: ds.id, rows: r.rows, n_total: r.n_total, truncated: r.truncated };
      render();
    }).catch((e) => {
      state._insightsData = { _dsId: ds.id, error: e.message || 'load failed' };
      render();
    });
    root.append(h('div', { className: 'card' }, skeleton({ lines: 2, block: 1 })));
    return root;
  }
  if (state._insightsData.error) {
    root.append(h('div', { className: 'card' },
      h('h3', {}, 'Could not load rows'),
      h('p', { className: 'muted' }, state._insightsData.error)));
    return root;
  }
  const rows = state._insightsData.rows || [];
  const schema = ds.schema_json || [];
  const numericCols = schema.filter(c => c.type === 'number').map(c => c.name);
  const categCols   = schema.filter(c => c.type !== 'number').map(c => c.name);

  // ── Math helpers (local, since stats_engine_ux doesn't expose stddev/kde) ──
  const getNum = (col) => rows.map(r => Number(r[col])).filter(Number.isFinite);
  const stddev = (xs) => {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  };
  const kde1d = (xs, at, bw) => {
    let s = 0;
    for (const x of xs) {
      const u = (at - x) / bw;
      s += Math.exp(-0.5 * u * u);
    }
    return s / (xs.length * bw * Math.sqrt(2 * Math.PI));
  };
  const erf = (x) => {
    const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
    const s = x >= 0 ? 1 : -1; x = Math.abs(x);
    const t = 1 / (1 + p * x);
    return s * (1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-x*x));
  };
  const paletteFor = (n) => {
    const base = ['var(--accent)', '#6b5524', '#a48b5e', '#8a7045', '#c5a572', '#5b4a2e', '#8e6a3b', '#b08a52', '#3f3220', '#dcbf8f'];
    const out = []; for (let i = 0; i < n; i++) out.push(base[i % base.length]); return out;
  };

  // ── Static SVG wrapper — minimal export controls, matches Lens chrome ──
  const wrapStatic = (svgEl, name) => {
    const card = h('div', { className: 'card insight-card' });
    const head = h('div', { className: 'row', style: 'justify-content:flex-end;gap:6px;margin-bottom:6px' },
      h('button', { className: 'ghost small', title: 'Download SVG',
        onclick: () => ux.exportSvgEl && ux.exportSvgEl(svgEl, `${name}.svg`) }, 'SVG'),
    );
    card.append(head, svgEl);
    return card;
  };
  const emptyMsg = (msg) => h('div', { className: 'card muted', style: 'padding:24px;font-style:italic' }, msg);

  // ── Chart builders ──
  function buildVarianceBudget({ value, source }) {
    const vals = getNum(value);
    if (vals.length < 3) return emptyMsg('Need ≥ 3 numeric observations.');
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const ssTotal = vals.reduce((a, b) => a + (b - mean) ** 2, 0);
    const sourceCols = source
      ? [source]
      : schema.filter(c => c.type !== 'number' && c.n_unique >= 2 && c.n_unique <= 20).map(c => c.name);
    if (!sourceCols.length) return emptyMsg('No categorical sources available to decompose variance.');
    const contributions = [];
    for (const col of sourceCols) {
      const groups = {};
      rows.forEach(r => {
        const v = Number(r[value]);
        if (!Number.isFinite(v)) return;
        const g = r[col] == null ? '(missing)' : String(r[col]);
        (groups[g] = groups[g] || []).push(v);
      });
      let ssBetween = 0;
      for (const g of Object.values(groups)) {
        const gm = g.reduce((a, b) => a + b, 0) / g.length;
        ssBetween += g.length * (gm - mean) ** 2;
      }
      contributions.push({ name: col, eta2: Math.max(0, ssTotal > 0 ? ssBetween / ssTotal : 0) });
    }
    const explained = Math.min(1, contributions.reduce((a, b) => a + b.eta2, 0));
    const residual = Math.max(0, 1 - explained);
    contributions.sort((a, b) => b.eta2 - a.eta2);
    const W = 760, H = Math.max(280, 60 + contributions.length * 36), pad = { l: 160, r: 30, t: 30, b: 50 };
    const root = svgT('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'insight-svg' });
    const barH = 22;
    const barRowH = ((H - pad.t - pad.b) / Math.max(1, contributions.length + 1));
    const plotW = W - pad.l - pad.r;
    const palette = paletteFor(contributions.length + 1);
    root.append(svgT('text', { x: pad.l, y: pad.t - 10, 'font-size': 12,
      fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' },
      `Total variance of ${value}: σ² = ${fmtNum(ssTotal / vals.length)}`));
    contributions.forEach((c, i) => {
      const y = pad.t + i * barRowH;
      const w = c.eta2 * plotW;
      root.append(svgT('rect', { x: pad.l, y, width: Math.max(0, w), height: barH, fill: palette[i], opacity: 0.88 }));
      root.append(svgT('text', { x: pad.l - 8, y: y + barH / 2 + 4, 'font-size': 12, 'text-anchor': 'end', fill: 'var(--ink-2)' }, c.name));
      root.append(svgT('text', { x: pad.l + w + 8, y: y + barH / 2 + 4, 'font-size': 11, fill: 'var(--ink-2)' }, `${(c.eta2 * 100).toFixed(1)}%`));
    });
    const ry = pad.t + contributions.length * barRowH;
    root.append(svgT('rect', { x: pad.l, y: ry, width: residual * plotW, height: barH, fill: 'var(--line)', opacity: 0.9 }));
    root.append(svgT('text', { x: pad.l - 8, y: ry + barH / 2 + 4, 'font-size': 12, 'text-anchor': 'end', fill: 'var(--muted)', 'font-style': 'italic' }, 'residual (unexplained)'));
    root.append(svgT('text', { x: pad.l + residual * plotW + 8, y: ry + barH / 2 + 4, 'font-size': 11, fill: 'var(--muted)' }, `${(residual * 100).toFixed(1)}%`));
    for (const t of [0, 25, 50, 75, 100]) {
      const px = pad.l + (t / 100) * plotW;
      root.append(svgT('text', { x: px, y: H - pad.b + 22, 'font-size': 10, 'text-anchor': 'middle', fill: 'var(--muted)' }, `${t}%`));
    }
    return wrapStatic(root, 'variancebudget');
  }

  function buildCapabilityTraj({ x, lsl, usl, target }) {
    const vals = getNum(x);
    if (vals.length < 5) return emptyMsg('Need ≥ 5 observations.');
    const lo = Number(lsl), hi = Number(usl);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return emptyMsg('Need numeric LSL and USL.');
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = stddev(vals);
    const tgt = (target != null && target !== '') ? Number(target) : (lo + hi) / 2;
    const cpkOf = (m, s) => (s <= 0) ? null : Math.min((hi - m) / (3 * s), (m - lo) / (3 * s));
    const scenarios = [
      { id: 'now',      label: 'As-is',                     m: mean, s: sd,       color: 'var(--ink-2)' },
      { id: 's80',      label: 'σ × 0.80',                  m: mean, s: sd * 0.8, color: '#a48b5e' },
      { id: 's50',      label: 'σ × 0.50',                  m: mean, s: sd * 0.5, color: '#8a7045' },
      { id: 'center',   label: 'Centre mean on target',     m: tgt,  s: sd,       color: '#6b5524' },
      { id: 'both',     label: 'Both (σ × 0.50 + centre)',  m: tgt,  s: sd * 0.5, color: 'var(--accent)' },
    ];
    for (const s of scenarios) s.cpk = cpkOf(s.m, s.s);
    const maxCpk = Math.max(...scenarios.map(s => s.cpk || 0));
    const yMax = Math.max(2, maxCpk * 1.1);
    const W = 760, H = 420, pad = { l: 60, r: 30, t: 36, b: 80 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const slot = plotW / scenarios.length;
    const root = svgT('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'insight-svg' });
    const bands = [
      { from: 0,    to: 1.0,  color: 'rgba(176, 58, 58, 0.10)' },
      { from: 1.0,  to: 1.33, color: 'rgba(176, 132, 0, 0.10)' },
      { from: 1.33, to: 1.67, color: 'rgba(47, 125, 58, 0.10)' },
      { from: 1.67, to: yMax, color: 'rgba(47, 125, 58, 0.18)' },
    ];
    for (const b of bands) {
      if (b.to <= 0) continue;
      const yTop = pad.t + (1 - Math.min(b.to, yMax) / yMax) * plotH;
      const yBot = pad.t + (1 - b.from / yMax) * plotH;
      root.append(svgT('rect', { x: pad.l, y: yTop, width: plotW, height: Math.max(0, yBot - yTop), fill: b.color }));
    }
    for (const [v, label] of [[1.0, 'Not capable'], [1.33, 'Capable'], [1.67, 'Highly capable']]) {
      if (v > yMax) continue;
      const y = pad.t + (1 - v / yMax) * plotH;
      root.append(svgT('line', { x1: pad.l, x2: pad.l + plotW, y1: y, y2: y, stroke: 'var(--muted)', 'stroke-dasharray': '3 3', 'stroke-width': 0.5 }));
      root.append(svgT('text', { x: pad.l + plotW - 4, y: y - 3, 'font-size': 10, 'text-anchor': 'end', fill: 'var(--muted)', 'font-style': 'italic' }, `${label} (${v})`));
    }
    scenarios.forEach((s, i) => {
      const cx = pad.l + i * slot + slot / 2;
      const barW = slot * 0.55;
      const yT = pad.t + (1 - (s.cpk || 0) / yMax) * plotH;
      root.append(svgT('rect', { x: cx - barW / 2, y: yT, width: barW, height: pad.t + plotH - yT, fill: s.color, opacity: 0.90 }));
      root.append(svgT('text', { x: cx, y: yT - 8, 'font-size': 14, 'text-anchor': 'middle', fill: s.color, 'font-family': 'var(--font-display)', 'font-weight': 600 }, s.cpk == null ? '—' : s.cpk.toFixed(2)));
      root.append(svgT('text', { x: cx, y: H - pad.b + 16, 'font-size': 11, 'text-anchor': 'middle', fill: 'var(--ink-2)' }, s.label));
    });
    for (const t of niceTicks(0, yMax, 5)) {
      const y = pad.t + (1 - t / yMax) * plotH;
      root.append(svgT('text', { x: pad.l - 8, y: y + 3, 'font-size': 10, 'text-anchor': 'end', fill: 'var(--muted)' }, t.toFixed(2)));
    }
    root.append(svgT('text', { x: pad.l, y: 24, 'font-size': 12, fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' },
      `Cpk under intervention scenarios — LSL ${fmtNum(lo)}, USL ${fmtNum(hi)}, target ${fmtNum(tgt)}`));
    return wrapStatic(root, 'capabilitytraj');
  }

  function buildRPNGrid({ severity, occurrence, detection, label }) {
    const recs = [];
    for (const r of rows) {
      const s = Number(r[severity]), o = Number(r[occurrence]), d = Number(r[detection]);
      if (Number.isFinite(s) && Number.isFinite(o) && Number.isFinite(d)) {
        recs.push({ s, o, d, rpn: s * o * d, l: label ? (r[label] == null ? '' : String(r[label])) : '' });
      }
    }
    if (!recs.length) return emptyMsg('No valid (S, O, D) rows.');
    const W = 720, H = 560, pad = { l: 60, r: 18, t: 28, b: 80 };
    const xS = (v) => pad.l + ((v - 0.5) / 10) * (W - pad.l - pad.r);
    const yS = (v) => H - pad.b - ((v - 0.5) / 10) * (H - pad.t - pad.b);
    const root = svgT('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'insight-svg' });
    for (let s = 1; s <= 10; s++) {
      for (let o = 1; o <= 10; o++) {
        const r = s * o;
        const t = (r - 1) / 99;
        const color = `rgba(${Math.round(60 + 130 * t)}, ${Math.round(60)}, ${Math.round(60 - 60 * t)}, ${0.05 + 0.15 * t})`;
        const cw = (W - pad.l - pad.r) / 10, ch = (H - pad.t - pad.b) / 10;
        root.append(svgT('rect', { x: xS(s) - cw / 2, y: yS(o) - ch / 2, width: cw, height: ch, fill: color }));
      }
    }
    for (let i = 1; i <= 10; i++) {
      root.append(svgT('line', { x1: xS(i), x2: xS(i), y1: pad.t, y2: H - pad.b, stroke: 'var(--line)', 'stroke-width': 0.3, opacity: 0.5 }));
      root.append(svgT('line', { x1: pad.l, x2: W - pad.r, y1: yS(i), y2: yS(i), stroke: 'var(--line)', 'stroke-width': 0.3, opacity: 0.5 }));
      root.append(svgT('text', { x: xS(i), y: H - pad.b + 16, 'font-size': 10, 'text-anchor': 'middle', fill: 'var(--muted)' }, String(i)));
      root.append(svgT('text', { x: pad.l - 8, y: yS(i) + 3, 'font-size': 10, 'text-anchor': 'end', fill: 'var(--muted)' }, String(i)));
    }
    for (const t of [100, 200, 500]) {
      const pts = [];
      for (let s = 1; s <= 10; s += 0.2) {
        const o = t / (s * 10);
        if (o >= 1 && o <= 10) pts.push([xS(s), yS(o)]);
      }
      if (pts.length > 1) {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
        root.append(svgT('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-dasharray': '3 3', 'stroke-width': 0.6, opacity: 0.5 }));
      }
    }
    for (const r of recs) {
      const px = xS(r.s), py = yS(r.o);
      const radius = 4 + (r.d / 10) * 18;
      const band = r.rpn >= 200 ? '#b03a3a' : r.rpn >= 100 ? '#b08400' : '#2f7d3a';
      const bubble = svgT('circle', { cx: px, cy: py, r: radius, fill: band, opacity: 0.55, stroke: band, 'stroke-width': 1.5 });
      bubble.append(svgT('title', {}, r.l ? `${r.l} — S=${r.s}, O=${r.o}, D=${r.d}, RPN=${r.rpn}` : `S=${r.s}, O=${r.o}, D=${r.d}, RPN=${r.rpn}`));
      root.append(bubble);
      if (r.l && radius >= 9) {
        root.append(svgT('text', { x: px, y: py - radius - 4, 'font-size': 10, 'text-anchor': 'middle', fill: 'var(--ink)' },
          r.l.length > 14 ? r.l.slice(0, 14) + '…' : r.l));
      }
    }
    root.append(svgT('text', { x: (W - pad.r + pad.l) / 2, y: H - 18, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-family': 'var(--font-display)', 'font-style': 'italic' }, 'Severity →'));
    root.append(svgT('text', { x: 16, y: (H - pad.b + pad.t) / 2, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-family': 'var(--font-display)', 'font-style': 'italic', transform: `rotate(-90 16 ${(H - pad.b + pad.t) / 2})` }, 'Occurrence →'));
    root.append(svgT('text', { x: pad.l, y: 18, 'font-size': 10, fill: 'var(--muted)' },
      'Bubble size = Detection (large = harder to detect). Colour: green RPN<100, amber 100–200, red ≥200.'));
    return wrapStatic(root, 'rpngrid');
  }

  function buildSigmaSlip({ x, lsl, usl, window }) {
    const vals = getNum(x);
    const W_ = Math.max(10, parseInt(window) || 30);
    if (vals.length < W_ + 2) return emptyMsg(`Need ≥ ${W_ + 2} observations for a rolling window of ${W_}.`);
    const lo = Number(lsl), hi = Number(usl);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return emptyMsg('Need numeric LSL and USL.');
    const cpks = [];
    for (let i = W_ - 1; i < vals.length; i++) {
      const w = vals.slice(i - W_ + 1, i + 1);
      const m = w.reduce((a, b) => a + b, 0) / W_;
      const s = stddev(w);
      const cpk = s > 0 ? Math.min((hi - m) / (3 * s), (m - lo) / (3 * s)) : null;
      cpks.push({ i, cpk });
    }
    const ys = cpks.map(c => c.cpk).filter(v => v != null);
    const yMin = Math.min(0, ...ys), yMax = Math.max(2, ...ys);
    const points = cpks.map(c => ({ i: c.i, x: c.i + 1, y: c.cpk ?? 0,
      label: `obs ${c.i + 1}`, meta: { Cpk: c.cpk != null ? c.cpk.toFixed(2) : '—' } }));
    const card = h('div', { className: 'card insight-card' });
    card.append(ux.renderInteractiveChart({
      kind: 'sigmaslip',
      width: 760, height: 400, pad: { l: 60, r: 18, t: 18, b: 44 },
      xRange: [W_, vals.length], yRange: [yMin - 0.1, yMax + 0.1],
      xLabel: 'observation', yLabel: `rolling Cpk (window = ${W_})`,
      points,
      overlays: [
        { id: 'thresholds', label: 'Capability thresholds', defaultOn: true,
          build: (g, { yScale, plot }) => {
            for (const [v, label, color] of [
              [1.67, 'Highly capable', '#2f7d3a'],
              [1.33, 'Capable',        '#6b5524'],
              [1.0,  'Not capable',    '#b03a3a'],
            ]) {
              const y = yScale(v);
              if (y < plot.y || y > plot.y + plot.h) continue;
              g.append(svgT('line', { x1: plot.x, x2: plot.x + plot.w, y1: y, y2: y, stroke: color, 'stroke-dasharray': '4 4', 'stroke-width': 0.8 }));
              g.append(svgT('text', { x: plot.x + plot.w - 4, y: y - 3, 'font-size': 10, 'text-anchor': 'end', fill: color, 'font-style': 'italic' }, `${label} (${v})`));
            }
          },
        },
      ],
      draw: (root, { xScale, yScale }) => {
        const valid = cpks.filter(c => c.cpk != null);
        const d = valid.map((c, k) => `${k ? 'L' : 'M'} ${xScale(c.i + 1)} ${yScale(c.cpk)}`).join(' ');
        root.append(svgT('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
        for (const c of valid) {
          const color = c.cpk >= 1.33 ? '#2f7d3a' : c.cpk >= 1.0 ? '#b08400' : '#b03a3a';
          root.append(svgT('circle', { cx: xScale(c.i + 1), cy: yScale(c.cpk), r: 2.5, fill: color }));
        }
      },
    }));
    return card;
  }

  function buildCostPareto({ x, cost }) {
    const sums = {}, counts = {};
    for (const r of rows) {
      const k = r[x] == null ? '(missing)' : String(r[x]);
      const c = Number(r[cost]);
      if (!Number.isFinite(c)) continue;
      sums[k] = (sums[k] || 0) + c;
      counts[k] = (counts[k] || 0) + 1;
    }
    const keys = Object.keys(sums);
    if (!keys.length) return emptyMsg('No rows with a numeric cost.');
    const byCount = keys.map(k => ({ k, v: counts[k] })).sort((a, b) => b.v - a.v);
    const byCost  = keys.map(k => ({ k, v: sums[k]   })).sort((a, b) => b.v - a.v);
    const W = 880, H = 460, pad = { l: 110, r: 24, t: 50, b: 80 };
    const colW = (W - pad.l - pad.r) / 2 - 16;
    const root = svgT('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'insight-svg' });
    function half(items, x0, title, color) {
      const total = items.reduce((a, it) => a + it.v, 0) || 1;
      const cum = []; let acc = 0;
      for (const it of items) { acc += it.v; cum.push(acc / total); }
      const max = Math.max(...items.map(it => it.v));
      const plotH = H - pad.t - pad.b;
      const slot = colW / items.length;
      root.append(svgT('text', { x: x0 + colW / 2, y: pad.t - 20, 'font-size': 13, 'text-anchor': 'middle', fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' }, title));
      items.forEach((it, i) => {
        const cx = x0 + i * slot + slot / 2;
        const x_ = cx - slot * 0.35;
        const w = slot * 0.7;
        const yT = pad.t + (1 - it.v / max) * plotH;
        root.append(svgT('rect', { x: x_, y: yT, width: w, height: pad.t + plotH - yT, fill: color, opacity: 0.85 }));
        root.append(svgT('text', { x: cx, y: H - pad.b + 16, 'font-size': 10, 'text-anchor': 'middle', fill: 'var(--ink-2)',
          transform: it.k.length > 6 ? `rotate(-32 ${cx} ${H - pad.b + 16})` : null },
          it.k.length > 14 ? it.k.slice(0, 14) + '…' : it.k));
      });
      const d = cum.map((p, i) => `${i ? 'L' : 'M'} ${x0 + i * slot + slot / 2} ${pad.t + (1 - p) * plotH}`).join(' ');
      root.append(svgT('path', { d, fill: 'none', stroke: 'var(--danger)', 'stroke-width': 1.5 }));
      const y80 = pad.t + 0.2 * plotH;
      root.append(svgT('line', { x1: x0, x2: x0 + colW, y1: y80, y2: y80, stroke: 'var(--danger)', 'stroke-dasharray': '3 3', opacity: 0.55 }));
      root.append(svgT('text', { x: x0 + colW - 4, y: y80 - 4, 'font-size': 9, 'text-anchor': 'end', fill: 'var(--danger)' }, '80%'));
      root.append(svgT('text', { x: x0 - 4, y: pad.t - 4, 'font-size': 10, 'text-anchor': 'end', fill: 'var(--muted)' }, `max ${fmtNum(max)}`));
    }
    half(byCount, pad.l,             'BY FREQUENCY', 'var(--ink-2)');
    half(byCost,  pad.l + colW + 32, 'BY COST',      'var(--accent)');
    const top1Freq = byCount[0]?.k, top1Cost = byCost[0]?.k;
    if (top1Freq && top1Cost && top1Freq !== top1Cost) {
      root.append(svgT('text', { x: W / 2, y: 22, 'font-size': 11, 'text-anchor': 'middle', fill: 'var(--danger)', 'font-style': 'italic' },
        `Top defect by count (${top1Freq}) ≠ top defect by cost (${top1Cost}).`));
    }
    return wrapStatic(root, 'costpareto');
  }

  // Interpreters — narrative shown beneath each chart.
  function interpVarianceBudget({ value, source }) {
    const vals = getNum(value);
    if (vals.length < 3) return '';
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const ssTotal = vals.reduce((a, b) => a + (b - mean) ** 2, 0);
    const sourceCols = source
      ? [source] : schema.filter(c => c.type !== 'number' && c.n_unique >= 2 && c.n_unique <= 20).map(c => c.name);
    if (!sourceCols.length) return 'No categorical sources available to decompose variance.';
    let top = { name: '—', eta2: 0 };
    for (const col of sourceCols) {
      const groups = {};
      rows.forEach(r => {
        const v = Number(r[value]); if (!Number.isFinite(v)) return;
        const g = r[col] == null ? '(missing)' : String(r[col]);
        (groups[g] = groups[g] || []).push(v);
      });
      let ssBetween = 0;
      for (const g of Object.values(groups)) {
        const gm = g.reduce((a, b) => a + b, 0) / g.length;
        ssBetween += g.length * (gm - mean) ** 2;
      }
      const eta2 = ssTotal > 0 ? ssBetween / ssTotal : 0;
      if (eta2 > top.eta2) top = { name: col, eta2 };
    }
    return `Total variance of **${value}** decomposed by η² across ${sourceCols.length} categorical source(s). **${top.name}** explains **${(top.eta2 * 100).toFixed(1)}%** — the dominant source. Residual = noise + un-modelled sources.`;
  }
  function interpCapabilityTraj({ x, lsl, usl, target }) {
    const v = getNum(x);
    if (v.length < 5) return '';
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const s = stddev(v);
    const lo = Number(lsl), hi = Number(usl);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || s <= 0) return '';
    const cpk = Math.min((hi - m) / (3 * s), (m - lo) / (3 * s));
    const tgt = (target != null && target !== '') ? Number(target) : (lo + hi) / 2;
    const offCenter = Math.abs(m - tgt) / s;
    let lever;
    if (offCenter > 0.5 && s / ((hi - lo) / 6) < 1.2) lever = '**Centering on target** is your biggest lever — the process is more off-target than over-spread.';
    else if (offCenter < 0.25) lever = '**Variance reduction** is your only lever — the process is already centred.';
    else lever = '**Both centering and σ reduction** will lift Cpk. Pick whichever is cheapest to action first.';
    return `As-is Cpk = **${cpk.toFixed(2)}**. Each bar shows the projected Cpk under a single intervention. Capability thresholds (not capable < 1.0, capable ≥ 1.33, highly capable ≥ 1.67) shown as horizontal guides. ${lever}`;
  }
  function interpRPNGrid({ severity, occurrence, detection }) {
    const recs = [];
    for (const r of rows) {
      const s = Number(r[severity]), o = Number(r[occurrence]), d = Number(r[detection]);
      if (Number.isFinite(s) && Number.isFinite(o) && Number.isFinite(d)) recs.push({ rpn: s * o * d });
    }
    if (!recs.length) return '';
    const high = recs.filter(r => r.rpn >= 200).length;
    const mid  = recs.filter(r => r.rpn >= 100 && r.rpn < 200).length;
    return `${recs.length} failure modes plotted. **${high} red** (RPN ≥ 200) need immediate action; **${mid} amber** (100 ≤ RPN < 200) need corrective plans. Hover any bubble for the failure-mode label.`;
  }
  function interpSigmaSlip({ x, lsl, usl, window }) {
    const W_ = parseInt(window) || 30;
    const vals = getNum(x);
    const lo = Number(lsl), hi = Number(usl);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || vals.length < W_ + 2) return '';
    let lastCpk = null, slipPoint = null;
    for (let i = W_ - 1; i < vals.length; i++) {
      const w = vals.slice(i - W_ + 1, i + 1);
      const m = w.reduce((a, b) => a + b, 0) / W_;
      const s = stddev(w);
      const cpk = s > 0 ? Math.min((hi - m) / (3 * s), (m - lo) / (3 * s)) : null;
      if (lastCpk != null && lastCpk >= 1.33 && cpk != null && cpk < 1.33) slipPoint = i + 1;
      lastCpk = cpk;
    }
    let msg = `Rolling Cpk on a ${W_}-observation window. Current Cpk = **${lastCpk?.toFixed(2) ?? '—'}**.`;
    if (slipPoint) msg += ` Process **slipped below 1.33** at observation ${slipPoint} — your "when did it start" answer.`;
    else if (lastCpk != null && lastCpk >= 1.33) msg += ` Holding above 1.33 across the full window. Healthy.`;
    else msg += ` Currently below the 1.33 capability threshold.`;
    return msg + ' This is the **trajectory** view — catches slow drift weeks before a control chart would.';
  }
  function interpCostPareto({ x, cost }) {
    const sums = {}, counts = {};
    for (const r of rows) {
      const k = r[x] == null ? '(missing)' : String(r[x]);
      const c = Number(r[cost]);
      if (!Number.isFinite(c)) continue;
      sums[k] = (sums[k] || 0) + c;
      counts[k] = (counts[k] || 0) + 1;
    }
    const topFreq = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const topCost = Object.entries(sums).sort((a, b) => b[1] - a[1])[0];
    if (!topFreq || !topCost) return '';
    if (topFreq[0] !== topCost[0]) {
      return `**Top defect by frequency is "${topFreq[0]}" (${topFreq[1]} occurrences), but top defect by cost is "${topCost[0]}" (${fmtNum(topCost[1])} total cost)**. Classic Pareto trap — chasing the frequency leader leaves the cost driver untouched.`;
    }
    return `**"${topFreq[0]}"** leads on both counts AND cost — high-leverage fix-everything-with-one-action target.`;
  }
  const INTERPRETERS = {
    variancebudget: interpVarianceBudget,
    capabilitytraj: interpCapabilityTraj,
    rpngrid:        interpRPNGrid,
    sigmaslip:      interpSigmaSlip,
    costpareto:     interpCostPareto,
  };
  const BUILDERS = {
    variancebudget: buildVarianceBudget,
    capabilitytraj: buildCapabilityTraj,
    rpngrid:        buildRPNGrid,
    sigmaslip:      buildSigmaSlip,
    costpareto:     buildCostPareto,
  };

  // ── Pick chart + render input panel + chart on the right ──
  state._insightsKind = state._insightsKind || INSIGHTS_LIST[0].id;
  // Guard: a stale/invalid _insightsKind (e.g. from navigate() or an old
  // localStorage value) would make the find() below return undefined and
  // crash on spec.label. Reset to the first insight if it's not a real id.
  if (!INSIGHTS_LIST.some(c => c.id === state._insightsKind)) state._insightsKind = INSIGHTS_LIST[0].id;
  state._insightsParams = state._insightsParams || {};
  const tabs = h('div', { className: 'insight-tabs', style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px' });
  for (const c of INSIGHTS_LIST) {
    const active = state._insightsKind === c.id;
    tabs.append(h('button', {
      className: 'tab' + (active ? ' active' : ''),
      onclick: () => { state._insightsKind = c.id; state._insightsParams = {}; render(); },
    }, c.label));
  }
  root.append(tabs);

  const spec = INSIGHTS_LIST.find(c => c.id === state._insightsKind);
  const grid = h('div', { className: 'insight-grid' });

  // Inputs panel
  const inputs = h('div', { className: 'card' });
  inputs.append(h('h3', { style: 'margin:0 0 4px' }, spec.label));
  inputs.append(h('p', { className: 'muted', style: 'margin:0 0 12px;font-size:12px;font-style:italic' }, spec.blurb));
  const params = state._insightsParams;
  for (const inp of spec.inputs) {
    const lbl = h('label', { className: 'fb-label', style: 'display:block;margin-bottom:10px' },
      h('span', { style: 'display:block;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px' }, inp.label));
    let ctrl;
    if (inp.kind === 'numeric' || inp.kind === 'categorical') {
      const cols = inp.kind === 'numeric' ? numericCols : categCols;
      ctrl = h('select', { className: 'fb-input' });
      if (!inp.required) ctrl.append(h('option', { value: '' }, '— none —'));
      for (const c of cols) ctrl.append(h('option', { value: c }, c));
      ctrl.value = params[inp.key] ?? (inp.required ? cols[0] || '' : '');
      ctrl.addEventListener('change', () => { params[inp.key] = ctrl.value; render(); });
    } else {
      ctrl = h('input', { className: 'fb-input', type: 'number',
        value: params[inp.key] ?? (inp.default ?? ''),
        placeholder: inp.default != null ? String(inp.default) : '' });
      ctrl.addEventListener('change', () => { params[inp.key] = ctrl.value; render(); });
    }
    lbl.append(ctrl);
    inputs.append(lbl);
  }
  grid.append(inputs);

  // Chart panel
  const chartCol = h('div');
  // Validate required inputs
  const missing = spec.inputs.filter(i => i.required && (params[i.key] == null || params[i.key] === ''));
  if (missing.length) {
    // Auto-fill defaults from available columns / inp.default
    let changed = false;
    for (const inp of spec.inputs) {
      if (params[inp.key] != null && params[inp.key] !== '') continue;
      if (inp.kind === 'numeric' && numericCols[0]) { params[inp.key] = numericCols[0]; changed = true; }
      else if (inp.kind === 'categorical' && categCols[0]) { params[inp.key] = categCols[0]; changed = true; }
      else if (inp.kind === 'integer' && inp.default != null) { params[inp.key] = inp.default; changed = true; }
    }
    if (changed) requestAnimationFrame(render);
  }
  const stillMissing = spec.inputs.filter(i => i.required && (params[i.key] == null || params[i.key] === ''));
  if (stillMissing.length) {
    chartCol.append(emptyMsg(`Provide ${stillMissing.map(m => m.label.replace(/\s*\(.+$/, '')).join(', ')} to render.`));
  } else {
    try {
      chartCol.append(BUILDERS[spec.id](params));
      const note = INTERPRETERS[spec.id](params);
      if (note) chartCol.append(h('div', { className: 'muted', style: 'margin-top:10px;padding:12px 14px;background:var(--surface);border-left:3px solid var(--accent);font-size:13px;line-height:1.6' },
        // tiny **bold** renderer
        ...note.split(/(\*\*[^*]+\*\*)/g).map(t =>
          t.startsWith('**') && t.endsWith('**') ? h('strong', {}, t.slice(2, -2)) : t)));
    } catch (e) {
      chartCol.append(emptyMsg(`Chart error: ${e.message || e}`));
    }
  }
  grid.append(chartCol);
  root.append(grid);
  return root;
}

function MethodsView() {
  const root = h('div');
  const totalCount = METHODS_INDEX.reduce((a, c) => a + (c.count || c.methods.length), 0);
  root.append(
    h('div', { className: 'breadcrumb' }, 'Learn · Methods'),
    h('h2', {}, 'Methods & provenance'),
    h('p', { style: 'color:var(--ink-2);font-size:15px;max-width:64ch;margin:6px 0 24px' },
      'Every analysis Bench computes maps to a standard library function and a published source. ',
      h('strong', {}, `${totalCount}+ verified methods`),
      ' across hypothesis testing, SPC, capability, regression, DOE, reliability, multivariate, time series, and post-hoc comparisons. ',
      h('em', {}, 'Bench is not new math.'),
      ' It\'s a modern interface on top of SciPy, statsmodels, NumPy, and pandas — the same libraries that power academic publishing, pharma submissions, and JMP\'s scripting bridge.',
    ),
  );
  for (const cat of METHODS_INDEX) {
    // Anchor id = "methods-<slugged category>", referenced from result cards.
    const anchorId = 'methods-' + cat.category.toLowerCase()
      .replace(/&/g, '&')
      .replace(/[^\w\s/-]/g, '')
      .replace(/\s+/g, '-');
    const wrap = h('div', { className: 'methods-cat', id: anchorId });
    wrap.append(
      h('div', { className: 'methods-cat-head' },
        h('span', { className: 'methods-cat-title' }, cat.category),
        h('span', { className: 'methods-cat-count' }, `${cat.count || cat.methods.length}`),
      ),
    );
    const list = h('div', { className: 'methods-list' });
    for (const m of cat.methods) {
      const row = h('div', { className: 'methods-row' },
        h('div', { className: 'methods-row-name' }, m.name),
        h('div', { className: 'methods-row-lib' }, h('code', {}, m.lib)),
        h('div', { className: 'methods-row-ref' }, m.ref),
      );
      // "Run →" / "Open →" affordance when the method maps to a runnable kind
      // or a tool. Nothing rendered otherwise so the grid stays aligned.
      if (m.kind) {
        row.append(h('a', {
          className: 'methods-row-run', href: '#',
          'data-nav-kind': m.kind,
          ...(m.inner ? { 'data-nav-inner': m.inner, 'data-nav-inner-param': m.innerParam || 'test' } : {}),
        }, 'Run →'));
      } else if (m.toolKind) {
        row.append(h('a', {
          className: 'methods-row-run', href: '#',
          'data-nav-tool': m.toolKind,
        }, 'Open →'));
      } else {
        row.append(h('div'));
      }
      list.append(row);
    }
    wrap.append(list);
    root.append(wrap);
  }
  return root;
}

function renderDemoBanner() {
  return h('div', { className: 'demo-banner' },
    h('span', { className: 'demo-mark' }, 'Demo'),
    h('span', { style: 'flex:1' },
      'You\'re looking at synthetic ',
      h('em', {}, 'pump_cycle_test'),
      ' data with a pre-run Process Capability analysis. Upload your own dataset to replace.'),
    h('button', {
      className: 'secondary', style: 'font-size:10px;padding:6px 14px',
      onclick: () => { state.view = 'data'; render(); },
    }, 'Upload data'),
  );
}

// ────────────────── Mixed-effects formula builder ──────────────────
//
// A tiny modal that lets a GB-level user pick the response column and one or
// more fixed-effect columns without typing a statsmodels formula. Writes
// 'response ~ x1 + x2' back into the target input.

function openMixedFormulaBuilder(targetInput, columns) {
  const numericCols = columns.filter(c => c.type === 'number').map(c => c.name);
  const allCols = columns.map(c => c.name);
  if (!numericCols.length) {
    return toast({ kind: 'warn', msg: 'Need a numeric column to use as response.' });
  }

  const respSel = h('select', { className: 'fb-input' },
    ...numericCols.map(c => h('option', { value: c }, c)));
  const fixedChecks = allCols.map(name => {
    const cb = h('input', { type: 'checkbox', value: name });
    return { name, cb,
      node: h('label', { style: 'display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px' },
        cb, name) };
  });
  // Grouping (random-intercept) column — the unit of repetition (subject, batch…).
  const groupSel = h('select', { className: 'fb-input' },
    ...allCols.map(c => h('option', { value: c }, c)));
  // Optional random slope on one predictor.
  const slopeSel = h('select', { className: 'fb-input' },
    h('option', { value: '' }, 'random intercept only'));
  const refreshSlopeOptions = () => {
    // Slope options = chosen fixed predictors (a slope on a non-fixed term is unusual).
    const chosen = fixedChecks.filter(c => c.cb.checked && c.name !== respSel.value).map(c => c.name);
    const prev = slopeSel.value;
    slopeSel.innerHTML = '';
    slopeSel.append(h('option', { value: '' }, 'random intercept only'));
    for (const n of chosen) slopeSel.append(h('option', { value: n }, `+ random slope on ${n}`));
    if (chosen.includes(prev)) slopeSel.value = prev;
  };

  const preview = h('div', { className: 'mono',
    style: 'background:var(--surface);border:1px solid var(--line);padding:6px 10px;margin-top:8px;font-size:12px' });
  const computed = () => {
    const resp = respSel.value;
    const fixed = fixedChecks.filter(c => c.cb.checked && c.name !== resp).map(c => c.name);
    const fixedFormula = `${resp} ~ ${fixed.length ? fixed.join(' + ') : '1'}`;
    const random = slopeSel.value ? `1 + ${slopeSel.value}` : '1';
    return { fixedFormula, group: groupSel.value, random };
  };
  const updatePreview = () => {
    refreshSlopeOptions();
    const c = computed();
    preview.textContent = `${c.fixedFormula}   ·   group: ${c.group || '—'}   ·   random: ${c.random}`;
  };
  respSel.addEventListener('change', updatePreview);
  groupSel.addEventListener('change', updatePreview);
  slopeSel.addEventListener('change', updatePreview);
  for (const c of fixedChecks) c.cb.addEventListener('change', updatePreview);
  updatePreview();

  const apply = h('button', { className: 'primary' }, 'Apply');
  const cancel = h('button', { className: 'ghost' }, 'Cancel');
  const modal = h('div', { className: 'modal-backdrop',
    style: 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center',
    onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) modal.remove(); },
  },
    h('div', { className: 'card', style: 'max-width:560px;width:90vw;max-height:84vh;overflow:auto' },
      h('h3', { style: 'margin:0 0 4px' }, 'Mixed-effects builder'),
      h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 12px' },
        'Pick the response, the fixed-effect predictors, and the grouping column — no formula typing.'),
      h('label', { className: 'field' }, 'Response (numeric, the y)', respSel),
      h('div', { className: 'field' },
        h('div', { style: 'font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px' },
          'Fixed-effect predictors (the x’s)'),
        h('div', {}, ...fixedChecks.map(c => c.node))),
      h('label', { className: 'field' }, 'Grouping column (random intercept — subject / batch / site)', groupSel),
      h('label', { className: 'field' }, 'Random slope (optional)', slopeSel),
      preview,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:14px' },
        cancel, apply)));
  document.body.append(modal);
  attachEscClose(modal);

  cancel.onclick = () => modal.remove();
  apply.onclick = () => {
    const c = computed();
    // Write all three fields on the analyze form, dispatching input events so
    // any listeners pick them up.
    const setField = (name, val) => {
      const el = document.querySelector(`#param-host [name="${name}"]`);
      if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    targetInput.value = c.fixedFormula;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    setField('group', c.group);
    setField('random', c.random);
    modal.remove();
    toast({ kind: 'success', msg: `Set: ${c.fixedFormula} · group ${c.group} · random ${c.random}` });
  };
}

// ────────────────── Pre-flight rendering ──────────────────
//
// Renders the traffic-light card returned by /api/analyses/preflight inline
// above the Run button. If the engine recommends switching to a different
// test (e.g. Mann-Whitney instead of two-sample t when normality fails),
// the "Use recommended" button updates the form in place.

function renderPreflight(host, result, runBtn) {
  host.innerHTML = '';
  host.style.display = 'block';
  const status = result?.status || 'ok';
  const checks = result?.checks || [];
  const colour = status === 'fail' ? 'var(--danger, #b03a3a)'
               : status === 'warn' ? '#b08400'
                                   : 'var(--success, #2f7d3a)';
  const dot = (s) => s === 'fail' ? '●' : s === 'warn' ? '◐' : '✓';
  const card = h('div', { className: 'card',
    style: `border-left:3px solid ${colour};padding:10px 14px;background:var(--surface)` });
  card.append(h('div', { style: 'font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--muted);margin-bottom:6px' },
    'Pre-flight'));
  const list = h('ul', { style: 'list-style:none;padding:0;margin:0 0 6px;font-size:12px;line-height:1.6' });
  for (const c of checks) {
    const colourC = c.status === 'fail' ? 'var(--danger, #b03a3a)'
                  : c.status === 'warn' ? '#b08400'
                                        : 'var(--success, #2f7d3a)';
    list.append(h('li', { style: 'display:flex;gap:8px;align-items:flex-start' },
      h('span', { style: `color:${colourC};width:14px;flex-shrink:0` }, dot(c.status)),
      h('span', { style: 'color:var(--ink-2)' },
        h('strong', { style: 'color:var(--ink)' }, c.name + ': '),
        c.detail || '')));
  }
  card.append(list);
  if (result?.explanation) {
    card.append(h('div', { className: 'muted',
      style: 'font-size:12px;font-style:italic;margin-top:6px;line-height:1.5' },
      result.explanation));
  }
  if (result?.recommendation) {
    const rec = result.recommendation;
    const recBtn = h('button', { className: 'primary', style: 'font-size:12px;margin-top:8px' },
      `Use recommended: ${rec.label || rec.test || rec.transform}`);
    recBtn.onclick = () => {
      // Pre-flight engine recommends a swap. Route through navigate() with
      // both the inner test/transform/method AND any extra param overrides
      // (e.g. equal_var=false for Welch).
      navigate({
        kind: rec.kind || 'hypothesis_test',
        inner: rec.test || rec.transform || rec.method || null,
        innerParam: rec.test ? 'test'
                   : rec.transform ? 'transform'
                   : rec.method ? 'method' : null,
        params: rec.params || {},
      });
    };
    card.append(recBtn);
  }
  host.append(card);
}

// ────────────────── Transform modal ──────────────────
//
// In-app column wrangling — the Minitab gap closed. Opens a modal where the
// user picks an op (compute / recode / retype / impute / filter / stack /
// unstack / log / boxcox / standardize / bin / rename / drop) and fills in
// op-specific params. POST /api/datasets/:id/transform produces a NEW
// dataset (the original is never mutated), so the chain is replayable.

// Append-rows modal — paste CSV/TSV that matches the dataset's columns and
// POST it to /:id/append. Bumps the dataset version, so any analysis built on
// it shows the STALE badge + Refresh until re-run.
function openAppendModal(dataset) {
  const schema = dataset.schema_json || [];
  const colNames = schema.map(c => c.name);
  const numericCols = new Set(schema.filter(c => c.type === 'number').map(c => c.name));

  const ta = h('textarea', { rows: 8,
    placeholder: `Paste rows (CSV or TSV). Columns, in order:\n${colNames.join(', ')}\n\nA header row is optional — if present it must match these names.`,
    style: 'width:100%;font-family:var(--font-mono);font-size:12px' });
  const status = h('div', { className: 'muted', style: 'font-size:12px;min-height:16px;margin-top:6px' });
  const save = h('button', { className: 'primary' }, 'Append');
  const cancel = h('button', { className: 'ghost' }, 'Cancel');

  // Parse pasted tabular text into row objects keyed by schema column.
  const parseRows = (text) => {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
    if (!lines.length) return [];
    const delim = lines[0].includes('\t') ? '\t' : ',';
    let start = 0;
    const first = lines[0].split(delim).map(s => s.trim());
    // Treat the first line as a header only if it matches the schema names.
    const looksHeader = first.length === colNames.length
      && first.every((v, i) => v.toLowerCase() === colNames[i].toLowerCase());
    if (looksHeader) start = 1;
    const rows = [];
    for (let i = start; i < lines.length; i++) {
      const cells = lines[i].split(delim).map(s => s.trim());
      const row = {};
      colNames.forEach((name, j) => {
        let v = cells[j];
        if (v === undefined || v === '') { row[name] = null; return; }
        if (numericCols.has(name)) {
          const n = Number(v); row[name] = Number.isFinite(n) ? n : null;
        } else row[name] = v;
      });
      rows.push(row);
    }
    return rows;
  };

  const modal = h('div', { className: 'modal-backdrop',
    style: 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center',
    onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) modal.remove(); } },
    h('div', { className: 'card', style: 'max-width:600px;width:92vw;max-height:88vh;overflow:auto' },
      h('h3', { style: 'margin:0 0 6px' }, '➕ Append rows · ', h('span', { className: 'muted' }, dataset.name)),
      h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
        `Current size: ${dataset.row_count} rows. New rows are added in place; analyses built on this dataset will show as stale until refreshed.`),
      ta, status,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:12px' }, cancel, save)));
  document.body.append(modal);
  attachEscClose(modal);
  cancel.onclick = () => modal.remove();
  save.onclick = () => withLoading(save, async () => {
    const rows = parseRows(ta.value);
    if (!rows.length) { status.textContent = 'No rows parsed — check the format.'; return; }
    try {
      const r = await api.post(`/api/datasets/${dataset.id}/append`, { rows });
      modal.remove();
      toast({ kind: 'success', title: 'Rows appended',
        msg: `${r.n_appended} added — dataset now ${r.dataset.row_count} rows (v${r.new_version}).` });
      await refreshData();
      state.current_dataset = state.datasets.find(d => d.id === dataset.id) || state.current_dataset;
      render();
    } catch (e) {
      const map = {
        too_many_rows_to_append: 'Too many rows in one append (max 50,000).',
        dataset_would_exceed_cap: 'This would exceed the 200,000-row dataset cap — create a new dataset.',
      };
      status.textContent = map[e.body?.error] || e.message || 'Append failed.';
    }
  });
}

function openTransformModal(dataset) {
  const cols = (dataset.schema_json || []).map(c => c.name);
  const numericCols = (dataset.schema_json || []).filter(c => c.type === 'number').map(c => c.name);

  const opSel = h('select', { className: 'fb-input' },
    ...[
      ['compute',     'Compute — new column from a formula'],
      ['recode',      'Recode — map values via a dictionary'],
      ['retype',      'Retype — coerce a column to number / date / bool / string'],
      ['rename',      'Rename — rename a column'],
      ['drop',        'Drop — remove one or more columns'],
      ['impute',      'Impute — fill missing values'],
      ['filter',      'Filter — keep rows matching a condition'],
      ['stack',       'Stack — wide → long (unpivot)'],
      ['unstack',     'Unstack — long → wide (pivot)'],
      ['log',         'Log — natural-log transform of a numeric column'],
      ['boxcox',      'Box-Cox — λ-fitted power transform (positive only)'],
      ['standardize', 'Standardize — z-score scaling'],
      ['bin',         'Bin — bucket a numeric column into categories'],
    ].map(([v, l]) => h('option', { value: v }, l)));

  const paramsHost = h('div', { style: 'margin-top:10px;display:grid;grid-template-columns:1fr;gap:8px' });
  let getParams = () => ({});

  const colSelect = (labelTxt, key, opts = {}) => {
    const sel = h('select', { className: 'fb-input' },
      ...(opts.optional ? [h('option', { value: '' }, '— none —')] : []),
      ...(opts.numeric ? numericCols : cols).map(c => h('option', { value: c }, c)));
    return { node: h('label', { className: 'field' }, labelTxt, sel), get: () => sel.value };
  };
  const textInput = (labelTxt, placeholder = '', opts = {}) => {
    const inp = h('input', { className: 'fb-input', type: opts.type || 'text', placeholder });
    if (opts.defaultValue != null) inp.value = String(opts.defaultValue);
    return { node: h('label', { className: 'field' }, labelTxt, inp), get: () => inp.value };
  };
  const textArea = (labelTxt, placeholder = '') => {
    const inp = h('textarea', { className: 'fb-input', rows: 3, placeholder });
    return { node: h('label', { className: 'field' }, labelTxt, inp), get: () => inp.value };
  };

  function renderForm() {
    paramsHost.innerHTML = '';
    const op = opSel.value;
    if (op === 'compute') {
      const newCol = textInput('New column name', 'e.g. yield_ratio');
      const expr = textArea('Expression', 'e.g. defects / units * 100');
      paramsHost.append(newCol.node, expr.node,
        h('div', { className: 'muted', style: 'font-size:11px' },
          'Refer to columns by name. Math funcs available: sqrt, log, exp, abs, min, max, round, floor, ceil, isna, notna, where. No code injection — restricted AST.'));
      getParams = () => ({ new_column: newCol.get(), expression: expr.get() });
    } else if (op === 'recode') {
      const col = colSelect('Column', 'column');
      const newCol = textInput('New column name (blank = overwrite)', '');
      const mapping = textArea('Mapping (JSON)', '{"A":4,"B":3,"C":2,"D":1}');
      const def = textInput('Default for unmapped (blank = keep original)', '');
      paramsHost.append(col.node, newCol.node, mapping.node, def.node);
      getParams = () => {
        let mapObj = {};
        try { mapObj = JSON.parse(mapping.get() || '{}'); } catch { throw new Error('Mapping must be valid JSON.'); }
        return { column: col.get(), mapping: mapObj,
                 new_column: newCol.get() || undefined,
                 default: def.get() === '' ? undefined : def.get() };
      };
    } else if (op === 'retype') {
      const col = colSelect('Column', 'column');
      const typeSel = h('select', { className: 'fb-input' },
        ...['number','int','date','bool','string'].map(t => h('option', { value: t }, t)));
      paramsHost.append(col.node,
        h('label', { className: 'field' }, 'Target type', typeSel));
      getParams = () => ({ column: col.get(), type: typeSel.value });
    } else if (op === 'rename') {
      const from = colSelect('From', 'from');
      const to = textInput('To', '');
      paramsHost.append(from.node, to.node);
      getParams = () => ({ from: from.get(), to: to.get() });
    } else if (op === 'drop') {
      const colsHost = h('div', { className: 'field' }, 'Columns to drop');
      const checks = cols.map(c => {
        const cb = h('input', { type: 'checkbox', value: c });
        return { c, cb, node: h('label', { style: 'display:inline-flex;align-items:center;gap:4px;margin-right:10px' }, cb, c) };
      });
      colsHost.append(h('div', {}, ...checks.map(c => c.node)));
      paramsHost.append(colsHost);
      getParams = () => ({ columns: checks.filter(c => c.cb.checked).map(c => c.c) });
    } else if (op === 'impute') {
      const col = colSelect('Column', 'column');
      const strat = h('select', { className: 'fb-input' },
        ...['mean','median','mode','ffill','bfill','constant'].map(s => h('option', { value: s }, s)));
      const val = textInput('Value (if strategy = constant)', '');
      paramsHost.append(col.node,
        h('label', { className: 'field' }, 'Strategy', strat),
        val.node);
      getParams = () => ({ column: col.get(), strategy: strat.value, value: val.get() || undefined });
    } else if (op === 'filter') {
      const expr = textArea('Expression', 'e.g. (yield > 90) & (line == "A")');
      paramsHost.append(expr.node,
        h('div', { className: 'muted', style: 'font-size:11px' }, 'Same safe expression rules as compute.'));
      getParams = () => ({ expression: expr.get() });
    } else if (op === 'stack') {
      const id = textInput('id_vars (comma-separated)', 'id,subject');
      const vv = textInput('value_vars (comma-separated)', 'q1,q2,q3');
      paramsHost.append(id.node, vv.node);
      getParams = () => ({ id_vars: id.get().split(',').map(s => s.trim()).filter(Boolean),
                            value_vars: vv.get().split(',').map(s => s.trim()).filter(Boolean) });
    } else if (op === 'unstack') {
      const id = textInput('id_vars (comma-separated)', 'id');
      const vc = colSelect('Variable column (the one to spread)', 'var_col');
      const vv = colSelect('Value column (the cell values)', 'value_col');
      const agg = h('select', { className: 'fb-input' },
        ...['first','mean','sum','count','median','max','min'].map(a => h('option', { value: a }, a)));
      paramsHost.append(id.node, vc.node, vv.node,
        h('label', { className: 'field' }, 'Aggregation (for duplicates)', agg));
      getParams = () => ({ id_vars: id.get().split(',').map(s => s.trim()).filter(Boolean),
                            var_col: vc.get(), value_col: vv.get(), aggfunc: agg.value });
    } else if (op === 'log' || op === 'standardize' || op === 'boxcox') {
      const col = colSelect('Column', 'column', { numeric: true });
      const newCol = textInput('New column name (blank = auto)', '');
      paramsHost.append(col.node, newCol.node);
      getParams = () => ({ column: col.get(), new_column: newCol.get() || undefined });
    } else if (op === 'bin') {
      const col = colSelect('Column', 'column', { numeric: true });
      const newCol = textInput('New column name (blank = auto)', '');
      const bins = textInput('Number of bins', '5', { type: 'number', defaultValue: 5 });
      const strat = h('select', { className: 'fb-input' },
        ...['equal_width','quantile'].map(s => h('option', { value: s }, s)));
      paramsHost.append(col.node, newCol.node, bins.node,
        h('label', { className: 'field' }, 'Strategy', strat));
      getParams = () => ({ column: col.get(), new_column: newCol.get() || undefined,
                            bins: Number(bins.get()) || 5, strategy: strat.value });
    }
  }
  opSel.addEventListener('change', renderForm);
  renderForm();

  const status = h('div', { className: 'muted', style: 'margin-top:8px;min-height:18px' });
  const runBtn = h('button', { className: 'primary' }, 'Apply');
  const cancelBtn = h('button', { className: 'ghost' }, 'Cancel');

  const modal = h('div', { className: 'modal-backdrop',
    style: 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center',
    onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) modal.remove(); },
  },
    h('div', { className: 'card', style: 'max-width:640px;width:90vw;max-height:90vh;overflow:auto' },
      h('h3', { style: 'margin:0 0 10px' }, '🔧 Transform · ', h('span', { className: 'muted' }, dataset.name)),
      h('p', { className: 'muted', style: 'margin:0 0 12px;font-size:12px' },
        'Produces a NEW dataset with the transform applied. Original is preserved.'),
      h('label', { className: 'field' }, 'Operation', opSel),
      paramsHost,
      status,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:12px' },
        cancelBtn, runBtn),
    ));
  document.body.append(modal);
  attachEscClose(modal);
  cancelBtn.onclick = () => modal.remove();
  runBtn.onclick = async () => {
    runBtn.disabled = true; status.textContent = 'Applying…';
    try {
      const params = getParams();
      const r = await api.post(`/api/datasets/${dataset.id}/transform`,
                               { op: opSel.value, params });
      toast({ kind: 'success', title: 'Transform applied',
              msg: `Created "${r.dataset.name}" (${r.dataset.row_count} rows)` });
      modal.remove();
      await refreshData();
      state.current_dataset = state.datasets.find(d => d.id === r.dataset.id) || state.current_dataset;
      render();
    } catch (e) {
      status.textContent = e.message || 'Transform failed.';
      runBtn.disabled = false;
    }
  };
}

// ════════════════════════════════════════════════════════════════════════
//  ValidationView — NIST StRD numerical-accuracy certification.
//  The trust wedge: closed-source tools rarely publish their StRD agreement.
// ════════════════════════════════════════════════════════════════════════
// Printable audit-trail export — the governance deliverable for a review or
// regulated submission. Reuses the open-a-styled-window pattern (no backend).
async function exportAuditTrail() {
  let entries = state._auditLog;
  if (!Array.isArray(entries)) {
    try { entries = (await api.get('/api/analyses/audit/log?limit=1000')).entries || []; }
    catch (e) { toast({ kind: 'error', msg: e.message }); return; }
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = entries.map(e => `<tr><td>${new Date(e.at * 1000).toLocaleString()}</td><td><b>${esc(e.action)}</b></td><td>${esc(e.entity_type)}</td><td>${esc(e.detail)}</td><td class="mono">${esc((e.entity_id || '').slice(0, 8))}</td></tr>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Conyso Bench — Audit Trail</title>
  <style>body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:900px;margin:32px auto;padding:0 24px}
  h1{font-size:20px;margin:0 0 2px} .sub{color:#666;margin:0 0 18px}
  table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #e2e2e2;font-size:12.5px}
  th{border-bottom:2px solid #999;text-transform:uppercase;font-size:10px;letter-spacing:.06em;color:#666}
  .mono{font-family:ui-monospace,monospace;color:#888} @media print{body{margin:0}}</style>
  <h1>Audit Trail</h1>
  <p class="sub">Conyso Bench · append-only governance log · ${entries.length} entries · exported ${new Date().toLocaleString()}</p>
  <table><thead><tr><th>When</th><th>Action</th><th>Type</th><th>Detail</th><th>ID</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5">No entries.</td></tr>'}</tbody></table>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
  else toast({ kind: 'error', msg: 'Pop-up blocked — allow pop-ups to export.' });
}

// ════════════════════════════════════════════════════════════════════════
//  Learning Paths — guided, hands-on GB→BB sequences. Each step pairs a
//  concept with a one-click "load the sample data and run it yourself."
//  The education wedge (Conyso's Vault pillar): learn by doing, not reading.
// ════════════════════════════════════════════════════════════════════════
const LEARNING_PATHS = [
  {
    id: 'foundations', title: 'Foundations: your first capability study', level: 'Green Belt',
    blurb: 'The single most-used LSS analysis, end to end. Learn what Cp/Cpk actually mean and run one yourself in two minutes.',
    steps: [
      { title: 'What capability measures', blurb: 'Cp is the spread vs. the spec width; Cpk also penalises being off-centre.',
        concept: 'Cp = (USL − LSL) / 6σ answers “does the process even fit between the spec limits?” Cpk = min(USL − μ, μ − LSL) / 3σ takes the worse of the two distances to the spec limits, so a tight but off-centre process scores low even when Cp looks fine. Rule of thumb: Cpk ≥ 1.33 is capable, ≥ 1.67 is excellent, < 1.0 means you are making defects. Pp/Ppk are the same maths but with long-term (overall) variation instead of within-subgroup.',
        guideId: 'capability' },
      { title: 'Run it on real data', blurb: 'Load a pump-cycle-time sample and run a capability study — read Cpk, its CI, and the verdict.',
        concept: 'You will load 248 real pump cycle times (LSL 4.5, USL 6.5, target 5.5) and run capability. Notice Bench reports a confidence interval on Cpk — a point estimate of 0.87 with a CI of [0.78, 0.96] tells you the process is firmly sub-capable, not just unlucky. The headline narrative states the verdict in plain English.',
        sample: 'capability_cycle_time', kind: 'capability' },
      { title: 'Is the process even stable?', blurb: 'Capability only means something if the process is in control. Run an I-MR chart first.',
        concept: 'Capability indices assume a stable process. If the mean is drifting, “Cpk” is a fiction averaged over a moving target. Always run a control chart first — here an Individuals & Moving-Range chart on the same data. A process must be in control before its capability number means anything. This habit separates Belts from button-pushers.',
        sample: 'control_chart_imr', kind: 'control_chart', inner: 'I-MR', innerParam: 'kind' },
    ],
  },
  {
    id: 'dmaic_core', title: 'The DMAIC backbone (Measure → Analyze → Improve)', level: 'Green → Black Belt',
    blurb: 'Walk the canonical project spine: trust your gauge, baseline, find the driver, prove the fix.',
    steps: [
      { title: 'Measure: trust the gauge first', blurb: 'Validate the measurement system before any number. %R&R over 30% means you are studying noise.',
        concept: 'A Gauge R&R study splits observed variation into part-to-part (real) and measurement-system (repeatability + reproducibility) components. If %R&R exceeds 30%, your measurement is too noisy to trust any downstream analysis — fix the gauge before you touch the process. This sample is a classic 10-part × 3-operator × 2-trial crossed study.',
        sample: 'msa_gauge_rr', kind: 'msa' },
      { title: 'Analyze: find what differs', blurb: 'Compare machines with one-way ANOVA, then localise with a post-hoc test if significant.',
        concept: 'ANOVA tests whether ≥3 group means differ; a significant F only says “at least one is different,” not which. That is what post-hoc tests (Tukey, Games-Howell) are for. In this sample one machine clearly under-performs — ANOVA flags it, and the follow-up isolates the culprit while controlling family-wise error.',
        sample: 'anova_machine_compare', kind: 'hypothesis_test', inner: 'one_way_anova', innerParam: 'test' },
      { title: 'Analyze: budget the variation', blurb: 'A Conyso original — decompose total variation into named sources so you attack the biggest bar first.',
        concept: 'The Variance Budget runs a Type-II ANOVA decomposition and attributes total variation to named sources (machine, operator, material…) as a stacked bar. Instead of “the process varies,” you get “62% of variation is the material lot” — which tells you exactly where to aim the Improve phase.',
        sample: 'anova_machine_compare', kind: 'variance_budget' },
      { title: 'Improve: forecast the gain', blurb: 'Use Monte-Carlo simulation to predict the output distribution at new settings before you change anything.',
        concept: 'Design for Six Sigma in miniature: define the transfer function and the input distributions, and Monte-Carlo propagates them to a predicted output distribution — with a sensitivity (variance-contribution) breakdown so you know which input to tighten. Predict the gain before you spend a shift changing settings.',
        toolKind: 'monte_carlo' },
    ],
  },
  {
    id: 'voc', title: 'Voice of the Customer (services & software)', level: 'Green Belt',
    blurb: 'The transactional side of LSS: turn complaints, surveys, and cycle times into decisions.',
    steps: [
      { title: 'Pareto the pain', blurb: 'Concentrate on the vital few. A cost-weighted Pareto ranks by impact, not just frequency.',
        concept: 'The 80/20 rule, with a twist: the most frequent defect is often not the most expensive. A cost-weighted Pareto multiplies frequency × cost, so a rare-but-ruinous failure rises to the top where it belongs. This sample is the classic trap — the loudest defect and the costliest defect are different.',
        sample: 'cost_pareto_defects', kind: 'cost_pareto' },
      { title: 'Survey the customer (and trust the scale)', blurb: 'Run Cronbach’s alpha on a 5-item Likert survey to check the questionnaire actually measures one thing.',
        concept: 'Before you act on survey averages, check the instrument. Cronbach’s alpha measures internal consistency — whether the items hang together as one construct (α ≥ 0.7 is acceptable). Alpha-if-deleted flags a weak item dragging the scale down. This sample has one deliberately weaker item for you to spot.',
        sample: 'survey_likert_scale', kind: 'survey' },
      { title: 'Forecast delivery (no velocity fiction)', blurb: 'Monte-Carlo “when will it be done?” from real throughput history — commit to the 85th percentile, not an average.',
        concept: 'Averaging velocity hides risk. A Monte-Carlo delivery forecast resamples your historical weekly throughput thousands of times to produce a distribution of completion dates. You commit to the 85th-percentile date, not the mean — the difference between a date you hit and a date you hope for.',
        sample: 'delivery_throughput', kind: 'delivery_forecast' },
      { title: 'Little’s Law', blurb: 'WIP = throughput × cycle time. The lever Agile teams forget: cut WIP to cut lead time.',
        concept: 'Little’s Law is the conservation law of flow: average WIP = average throughput × average cycle time. Rearranged, lead time = WIP / throughput — so the fastest way to shorten lead time without working harder is to limit work-in-progress. Plug in two of the three and Bench solves for the third.',
        toolKind: 'littles_law' },
    ],
  },
  {
    id: 'control_phase', title: 'Control: hold the gains (SPC)', level: 'Green → Black Belt',
    blurb: 'Statistical process control — detect real shifts, ignore noise, and lock in improvements so they don’t erode.',
    steps: [
      { title: 'Why control charts beat “eyeballing it”', blurb: 'Control limits separate signal (special cause) from noise (common cause) statistically.',
        concept: 'Every process varies. The skill is telling routine common-cause noise from a genuine special-cause signal worth chasing. Control charts draw 3σ limits from the process’s own voice, plus run-rules (Nelson/Western Electric) that catch shifts the limits alone miss. Reacting to noise (“tampering”) makes things worse — Deming proved it.',
        guideId: 'control-charts' },
      { title: 'I-MR for individual measurements', blurb: 'Plot individuals + moving range and let the run-rules flag a deliberate process shift.',
        concept: 'When you measure one unit at a time (not subgroups), the Individuals & Moving-Range chart is the workhorse. The MR chart estimates short-term variation to set the I-chart limits. This sample has an upward shift halfway through — watch the rules catch it.',
        sample: 'control_chart_imr', kind: 'control_chart', inner: 'I-MR', innerParam: 'kind' },
      { title: 'The capability six-pack', blurb: 'Control charts + capability histogram + normality, all in one board, on subgrouped data.',
        concept: 'The “six-pack” is the one-glance health check: Xbar/R (or I-MR) charts to confirm stability, a capability histogram against the specs, a normal probability plot, and the indices — together. If the charts aren’t in control, the capability numbers below them are meaningless, and the layout makes that obvious.',
        sample: 'sixpack_subgroups', kind: 'sixpack' },
    ],
  },
  {
    id: 'design_improve', title: 'Improve: Design of Experiments', level: 'Black Belt',
    blurb: 'Change several factors at once, learn more from fewer runs, and find the settings that actually optimise the output.',
    steps: [
      { title: 'Why DOE beats one-factor-at-a-time', blurb: 'Factorial designs reveal interactions that OFAT testing is mathematically blind to.',
        concept: 'Testing one factor at a time can’t detect interactions — when the effect of A depends on the level of B. Factorial designs vary factors together, so you estimate main effects AND interactions from far fewer runs, with the precision of replication. This is the heart of the Improve phase.',
        guideId: 'doe' },
      { title: 'Run a 2³ factorial', blurb: 'Fit a replicated three-factor factorial and read the main effects and the interaction.',
        concept: 'This sample is a full 2³ design (three factors at ±1), each combination run twice. Factors A and C have real main effects with an A×C interaction baked in — the factorial fit will surface both, and the effect estimates tell you which knobs matter and which don’t.',
        sample: 'doe_factorial_2k', kind: 'doe' },
      { title: 'Optimise competing responses', blurb: 'When you must maximise yield AND minimise cost, desirability finds the best compromise.',
        concept: 'Real processes have competing goals. Desirability optimisation converts each response to a 0–1 desirability (maximise / minimise / hit-target), combines them into one score, and finds the factor settings that best satisfy all of them at once — the mathematically defensible compromise.',
        sample: 'desirability_multi_response', kind: 'desirability' },
      { title: 'De-risk the change with Monte-Carlo', blurb: 'Before rolling out new settings, simulate the output distribution and its tolerances.',
        concept: 'A model gives you the mean; Monte-Carlo gives you the spread. Propagate the input variation through your transfer function to see the full predicted output distribution and the chance of exceeding spec — so you roll out a change you’ve already stress-tested on paper.',
        toolKind: 'monte_carlo' },
    ],
  },
  {
    id: 'analyze_relationships', title: 'Analyze: find the real drivers', level: 'Green → Black Belt',
    blurb: 'Move from “what differs” to “what drives it” — correlation, regression, and the assumptions that keep you honest.',
    steps: [
      { title: 'Correlation first (and its traps)', blurb: 'A correlation matrix shows which inputs move together — and warns you about multicollinearity.',
        concept: 'Correlation quantifies how strongly variables move together (−1 to +1), but correlation ≠ causation, and two highly-correlated predictors (multicollinearity) will destabilise a regression. This sample has two deliberately collinear inputs — spot them before you model.',
        sample: 'correlation_multi_kpi', kind: 'correlation' },
      { title: 'Build a regression model', blurb: 'Model the response from several predictors and read which ones actually matter.',
        concept: 'Multiple regression estimates each predictor’s effect while holding the others constant. Read the coefficients, their significance, and R² — but also the diagnostics. Here, temperature and catalyst are real drivers while pressure is mostly noise; a good model says so.',
        sample: 'regression_yield_drivers', kind: 'regression' },
      { title: 'Check the distribution', blurb: 'Identify the right distribution before you assume normal — it changes every downstream test.',
        concept: 'Many tools assume normality. Distribution identification fits candidate distributions (normal, lognormal, Weibull, gamma…) and ranks them by goodness-of-fit. This sample is clearly right-skewed — using a normal model on it would give wrong capability and wrong control limits.',
        sample: 'distribution_id_skewed', kind: 'distribution_id' },
    ],
  },
  {
    id: 'reliability_path', title: 'Reliability & life data', level: 'Green → Black Belt',
    blurb: 'Time-to-failure isn’t normal data — learn Weibull thinking, censoring, and comparing survival between groups.',
    steps: [
      { title: 'Why life data is different', blurb: 'Failure times are skewed and often censored — ordinary stats mislead. Weibull is the workhorse.',
        concept: 'Time-to-failure data is right-skewed and usually censored (some units haven’t failed yet). The Weibull distribution’s shape parameter β tells the story: β < 1 = infant mortality, β = 1 = random failures, β > 1 = wear-out. Reading β points you at the right intervention.',
        guideId: 'reliability-primer' },
      { title: 'Fit a Weibull model', blurb: 'Fit time-to-failure data and read MTBF, B10 life, and reliability at a mission time.',
        concept: 'This sample is 30 components with β > 1 (wear-out). The fit reports characteristic life, MTBF, and B10 (the time by which 10% have failed) — so you can schedule preventive replacement before the knee of the failure curve rather than after.',
        sample: 'reliability_weibull', kind: 'reliability', inner: 'weibull', innerParam: 'distribution' },
      { title: 'Compare survival between groups', blurb: 'Kaplan-Meier curves + a log-rank test show whether one treatment outlasts another, with censoring handled.',
        concept: 'When you have two arms and censored data, Kaplan-Meier estimates each survival curve without assuming a distribution, and the log-rank test asks whether the curves genuinely differ. This sample has two arms with different medians and light censoring — the curves separate and the test should flag it.',
        sample: 'survival_two_arms', kind: 'survival' },
    ],
  },
];

// ── Learning-path progress (localStorage). A step is keyed "<pathId>:<idx>". ──
