function learnProgress() {
  if (!state._learnDone) {
    try { state._learnDone = JSON.parse(localStorage.getItem('bench_learn_done') || '{}'); }
    catch { state._learnDone = {}; }
  }
  return state._learnDone;
}
function learnKey(pathId, i) { return `${pathId}:${i}`; }
function isStepDone(pathId, i) { return !!learnProgress()[learnKey(pathId, i)]; }
function setStepDone(pathId, i, done) {
  const p = learnProgress(); const k = learnKey(pathId, i);
  if (done) p[k] = 1; else delete p[k];
  try { localStorage.setItem('bench_learn_done', JSON.stringify(p)); } catch {}
}
function pathDoneCount(path) {
  return path.steps.reduce((n, _s, i) => n + (isStepDone(path.id, i) ? 1 : 0), 0);
}

async function startLearningStep(step, pathId, idx) {
  try {
    // Launching a step counts as doing it — mark complete so progress fills.
    if (pathId != null && idx != null) setStepDone(pathId, idx, true);
    if (step.toolKind) { state.view = 'tools'; state._toolKind = step.toolKind; render(); return; }
    if (step.sample) {
      const r = await api.post(`/api/datasets/samples/${step.sample}`, {});
      await refreshData();
      state.current_dataset = state.datasets.find(d => d.id === (r.dataset?.id || r.id)) || state.current_dataset;
    }
    navigate({ kind: step.kind, inner: step.inner, innerParam: step.innerParam });
    toast({ kind: 'success', msg: 'Sample loaded — fill the form and run it.' });
  } catch (e) { toast({ kind: 'error', msg: e.message || 'Could not start this step.' }); }
}

// ════════════════════════════════════════════════════════════════════════
//  CatalogView — the "here's everything Bench does" surface. Every analysis,
//  calculator, and platform capability in one searchable, grouped catalog so
//  the breadth is visible (and reachable) instead of buried in the nav.
// ════════════════════════════════════════════════════════════════════════
const CATALOG_PLATFORM = [
  { label: 'DMAIC Copilot', blurb: 'Guided projects that recommend your next analysis from your actual results, with tollgates + A3 export.', go: () => { state.view = 'projects'; render(); } },
  { label: 'Graph Builder', blurb: 'Interactive scatter / box / histogram / bar — pick X·Y·color, hover for values.', go: () => { state.view = 'graph_builder'; render(); } },
  { label: 'Recipe Pipelines', blurb: 'Chain transforms + analyses into one replayable unit; re-run on new data.', go: () => { state.view = 'pipelines'; render(); } },
  { label: 'Process Behavior dashboard', blurb: 'Every control chart for a process, RAG-scored, in one board.', go: () => { state.view = 'dashboard'; render(); } },
  { label: 'Numerical Validation', blurb: 'NIST StRD certification — Bench reproduces benchmark values to 10+ digits.', go: () => { state.view = 'validation'; render(); } },
  { label: 'Governance & audit', blurb: 'Lock verified results, append-only audit trail, exportable.', go: () => { state.view = 'validation'; render(); } },
  { label: 'Learning Paths', blurb: 'Guided GB→BB sequences — learn each method by running it on sample data.', go: () => { state.view = 'learn_paths'; render(); } },
  { label: 'Worksheet', blurb: 'Minitab-style data grid with per-column quick stats.', go: () => { state.view = 'worksheet'; render(); } },
];
// One-line purpose per analysis family (DMAIC-phase hints).
const FAMILY_BLURB = {
  hypothesis: 'Compare groups · Analyze', control: 'Monitor stability · Control', capability: 'Process capability · Measure',
  msa: 'Trust the gauge · Measure', regression: 'Model relationships · Analyze', doe: 'Optimize · Improve',
  reliability: 'Life data & survival', multivariate: 'Many variables at once', time: 'Trends & forecasting',
  graphs: 'Visualize & prioritize', other: 'Identify distributions', voc: 'Surveys & comments · Define/Measure',
  flow: 'Lead time & delivery · services/Agile', originals: 'Branded analyses unique to Bench',
};

function CatalogView() {
  const root = h('div');
  const q = (state._catalogQ || '').toLowerCase();
  const fams = ANALYSIS_FAMILIES.filter(f => f.id !== 'all');
  const nAnalyses = fams.reduce((s, f) => s + (f.subs ? f.subs.length : 0), 0);
  const nTools = (typeof TOOLS_INDEX !== 'undefined' ? TOOLS_INDEX.length : 0);

  root.append(
    h('div', { className: 'breadcrumb' }, 'Workspace · Catalog'),
    h('h2', {}, 'Catalog', h('span', { className: 'muted' }, ' · everything Bench can do')),
    h('p', { className: 'deck' },
      `${nAnalyses} analyses across ${fams.length} families · ${nTools} calculators · ${CATALOG_PLATFORM.length} platform tools — all free, deterministic, no LLM. Search or browse by phase.`));

  const search = h('input', { type: 'search', placeholder: 'Search analyses, calculators, tools…',
    value: state._catalogQ || '', style: 'width:100%;max-width:420px;margin-bottom:18px',
    oninput: (e) => { state._catalogQ = e.target.value; render();
      requestAnimationFrame(() => { const el = document.querySelector('.catalog-search'); if (el) el.focus(); }); },
    className: 'catalog-search' });
  root.append(search);

  const match = (label, blurb) => !q || (label + ' ' + (blurb || '')).toLowerCase().includes(q);
  const cardGrid = () => h('div', { className: 'tool-index' });
  const card = (label, blurb, onclick, eyebrow) => h('a', {
    className: 'tool-card', href: '#', onclick: (e) => { e.preventDefault(); onclick(); } },
    h('div', { className: 'tool-eyebrow' }, eyebrow || 'Analysis'),
    h('div', { className: 'tool-title' }, label),
    h('div', { className: 'tool-desc' }, blurb || ''),
    h('div', { className: 'tool-go' }, 'Open →'));

  const section = (title, cards) => {
    if (!cards.length) return;
    root.append(h('div', { className: 'section-label', style: 'margin:22px 0 8px' }, title));
    const g = cardGrid(); cards.forEach(c => g.append(c)); root.append(g);
  };

  // Platform capabilities first — the differentiators.
  section('Platform', CATALOG_PLATFORM.filter(p => match(p.label, p.blurb))
    .map(p => card(p.label, p.blurb, p.go, 'Platform')));

  // Every analysis family.
  for (const f of fams) {
    const subs = (f.subs || []).filter(s => match(s.label, FAMILY_BLURB[f.id]));
    section(`${f.label}  ·  ${FAMILY_BLURB[f.id] || ''}`,
      subs.map(s => card(s.label, '', () => navigate({ kind: s.kind, inner: s.inner, innerParam: s.innerParam }),
        f.id === 'originals' ? 'Conyso Original' : 'Analysis')));
  }

  // Calculators (no dataset needed).
  section('Calculators', (typeof TOOLS_INDEX !== 'undefined' ? TOOLS_INDEX : [])
    .filter(t => match(t.label, t.blurb))
    .map(t => card(t.label, t.blurb, () => { state.view = 'tools'; state._toolKind = t.id; render(); }, 'Calculator')));

  return root;
}

function LearningPathsView() {
  const root = h('div');
  state._learnExpanded = state._learnExpanded || {};

  // Overall progress across every path.
  const totalSteps = LEARNING_PATHS.reduce((n, p) => n + p.steps.length, 0);
  const doneSteps = LEARNING_PATHS.reduce((n, p) => n + pathDoneCount(p), 0);
  const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;

  root.append(
    h('div', { className: 'breadcrumb' }, 'Learn · Learning Paths'),
    h('h2', {}, 'Learning Paths', h('span', { className: 'muted' }, ' · learn by doing')),
    h('p', { className: 'deck' },
      'Guided GB→BB sequences. Each step pairs a concept with one-click hands-on — Bench loads a real sample dataset and drops you into the analysis. Expand a step to read the concept, then try it. Progress is saved on this device.'));

  // Overall progress bar + reset.
  const overall = h('div', { className: 'learn-overall' },
    h('div', { className: 'row', style: 'align-items:baseline;gap:10px' },
      h('span', { className: 'section-label' }, `Your progress — ${doneSteps} of ${totalSteps} steps`),
      h('span', { className: 'spacer' }),
      doneSteps
        ? h('button', { className: 'ghost', style: 'font-size:11px',
            onclick: () => {
              if (!confirm('Reset all Learning Path progress on this device?')) return;
              state._learnDone = {};
              try { localStorage.removeItem('bench_learn_done'); } catch {}
              render();
            } }, 'Reset progress')
        : null),
    h('div', { className: 'learn-progress' }, h('div', { className: 'learn-progress-fill', style: `width:${pct}%` })));
  root.append(overall);

  for (const path of LEARNING_PATHS) {
    const done = pathDoneCount(path);
    const total = path.steps.length;
    const ppct = total ? Math.round((done / total) * 100) : 0;
    const complete = done === total;

    const card = h('div', { className: 'card learn-path' + (complete ? ' complete' : ''), style: 'margin-bottom:16px' });
    card.append(h('div', { className: 'row', style: 'align-items:baseline;gap:10px;flex-wrap:wrap' },
      h('h3', { style: 'margin:0' }, path.title),
      h('span', { className: 'pill accent', style: 'font-size:10px' }, path.level),
      h('span', { className: 'spacer' }),
      h('span', { className: 'learn-count' + (complete ? ' done' : '') },
        complete ? '✓ Complete' : `${done}/${total}`)));
    card.append(h('div', { className: 'learn-progress', style: 'margin:8px 0 12px' },
      h('div', { className: 'learn-progress-fill', style: `width:${ppct}%` })));
    card.append(h('p', { className: 'muted', style: 'font-size:13px;margin:0 0 6px' }, path.blurb));

    path.steps.forEach((step, i) => {
      const key = learnKey(path.id, i);
      const isDone = isStepDone(path.id, i);
      const open = !!state._learnExpanded[key];

      const stepEl = h('div', { className: 'learn-step' + (isDone ? ' done' : '') + (open ? ' open' : '') });

      // Clickable header: badge + title + chevron.
      const header = h('button', { className: 'learn-step-head',
        'aria-expanded': open ? 'true' : 'false',
        onclick: () => { state._learnExpanded[key] = !open; render(); } },
        h('span', { className: 'learn-badge' }, isDone ? '✓' : String(i + 1)),
        h('span', { className: 'learn-step-title' }, step.title),
        h('span', { className: 'learn-chev' }, open ? '−' : '+'));
      stepEl.append(header);

      if (open) {
        const bodyWrap = h('div', { className: 'learn-step-body' });
        bodyWrap.append(h('p', { className: 'learn-concept' }, step.concept || step.blurb));
        if (step.note) bodyWrap.append(h('p', { className: 'muted', style: 'font-size:12px;font-style:italic;margin:0 0 8px' }, step.note));

        const actions = h('div', { className: 'row', style: 'gap:8px;flex-wrap:wrap' });
        if (step.guideId) actions.append(h('button', { className: 'ghost', style: 'font-size:12px',
          onclick: () => { state.view = 'guides'; state._guideId = step.guideId; render(); } }, 'Read the guide'));
        if (step.kind || step.toolKind) actions.append(h('button', { className: 'primary', style: 'font-size:12px',
          onclick: () => startLearningStep(step, path.id, i) },
          step.sample ? 'Load sample & try →' : 'Open →'));
        // Mark-done toggle.
        actions.append(h('button', { className: (isDone ? 'secondary' : 'ghost') + ' learn-done-btn', style: 'font-size:12px',
          onclick: () => { setStepDone(path.id, i, !isDone); render(); } },
          isDone ? '✓ Done — undo' : 'Mark done'));
        bodyWrap.append(actions);
        stepEl.append(bodyWrap);
      } else {
        // Collapsed teaser line.
        stepEl.append(h('div', { className: 'learn-step-teaser muted' }, step.blurb));
      }
      card.append(stepEl);
    });
    root.append(card);
  }
  return root;
}

function ValidationView() {
  const root = h('div');
  root.append(
    h('div', { className: 'breadcrumb' }, 'Learn · Validation'),
    h('h2', {}, 'Numerical Validation',
      h('span', { className: 'muted' }, ' · NIST StRD certification')),
    h('p', { className: 'deck' },
      'Conyso Bench runs the U.S. National Institute of Standards & Technology Statistical Reference Datasets — benchmark problems with values certified to 15 significant digits — through its own analysis functions, and reports the digits of agreement. Several are deliberately constructed to break numerically naive code.'));

  if (!state._nistResult) {
    root.append(h('div', { className: 'card' }, skeleton({ lines: 2, block: 1 })));
    api.get('/api/tools/validation/nist').then(r => {
      state._nistResult = r.summary || r; render();
    }).catch(e => { state._nistResult = { error: e.message || 'failed' }; render(); });
    return root;
  }
  const s = state._nistResult;
  if (s.error) { root.append(h('div', { className: 'card' }, h('p', { className: 'muted' }, s.error))); return root; }

  // Headline metric strip.
  root.append(h('div', { className: 'metric-strip', style: 'margin:14px 0' },
    h('div', { className: 'metric' }, h('div', { className: 'label' }, 'Checks passed'), h('div', { className: 'value' }, `${s.n_passed}/${s.n_checks}`)),
    h('div', { className: 'metric' }, h('div', { className: 'label' }, 'Min sig. digits'), h('div', { className: 'value' }, String(s.min_sig_digits))),
    h('div', { className: 'metric' }, h('div', { className: 'label' }, 'Median sig. digits'), h('div', { className: 'value' }, String(s.median_sig_digits))),
    h('div', { className: 'metric' }, h('div', { className: 'label' }, 'Overall'), h('div', { className: 'value', style: s.all_passed ? 'color:var(--good,#3a7)' : 'color:var(--bad,#c55)' }, s.all_passed ? '✓ PASS' : '✗ FAIL'))));

  const table = h('table', { className: 'table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, 'Dataset'), h('th', {}, 'Statistic'), h('th', {}, 'Difficulty'),
    h('th', { style: 'text-align:right' }, 'Certified'),
    h('th', { style: 'text-align:right' }, 'Bench'),
    h('th', { style: 'text-align:right' }, 'Sig. digits'),
    h('th', {}, ''))));
  const tb = h('tbody');
  for (const c of (s.checks || [])) {
    if (c.error) { tb.append(h('tr', {}, h('td', { colspan: 7, className: 'muted' }, `${c.dataset}: ${c.error}`))); continue; }
    tb.append(h('tr', {},
      h('td', {}, c.dataset), h('td', {}, c.test),
      h('td', { className: 'muted' }, c.difficulty),
      h('td', { className: 'mono', style: 'text-align:right' }, Number(c.certified).toPrecision(8)),
      h('td', { className: 'mono', style: 'text-align:right' }, Number(c.computed).toPrecision(8)),
      h('td', { className: 'mono', style: 'text-align:right' }, c.sig_digits.toFixed(2)),
      h('td', { style: 'color:' + (c.pass ? 'var(--good,#3a7)' : 'var(--bad,#c55)') }, c.pass ? '✓' : '✗')));
  }
  table.append(tb);
  root.append(h('div', { className: 'card', style: 'overflow-x:auto' }, table));
  root.append(h('p', { className: 'muted', style: 'font-size:12px;margin-top:10px' },
    s.note, ' Source: ',
    h('a', { href: s.source, target: '_blank', rel: 'noopener', style: 'color:var(--accent)' }, 'NIST StRD'), '.'));

  // ── Governance: append-only audit trail ──
  root.append(h('div', { className: 'row', style: 'align-items:center;gap:12px;margin-top:32px' },
    h('h2', { style: 'margin:0' }, 'Audit Trail',
      h('span', { className: 'muted' }, ' · append-only governance log')),
    h('span', { style: 'flex:1' }),
    h('button', { className: 'ghost', title: 'Export the audit trail as a printable page',
      onclick: () => exportAuditTrail() }, '📄 Export audit')));
  root.append(h('p', { className: 'deck' },
    'Every analysis run, lock, and deletion is recorded with a timestamp — an immutable record for reviews and regulated environments. Locked analyses cannot be silently re-run or deleted.'));
  const auditBox = h('div', { className: 'card' });
  root.append(auditBox);
  if (!state._auditLog) {
    auditBox.append(skeleton({ lines: 3 }));
    api.get('/api/analyses/audit/log?limit=100')
      .then(r => { state._auditLog = r.entries || []; render(); })
      .catch(e => { state._auditLog = { error: e.message }; render(); });
  } else if (state._auditLog.error) {
    auditBox.append(h('p', { className: 'muted' }, state._auditLog.error));
  } else if (!state._auditLog.length) {
    auditBox.append(h('p', { className: 'muted' }, 'No audited actions yet. Run or lock an analysis to populate the trail.'));
  } else {
    const t = h('table', { className: 'table' });
    t.append(h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Action'), h('th', {}, 'Type'), h('th', {}, 'Detail'))));
    const tb = h('tbody');
    const ACT = { created: '#3a7ca5', locked: '#c9a24b', unlocked: '#7a7a7a', deleted: '#c0504d', advanced: '#5a8f69' };
    for (const e of state._auditLog) {
      tb.append(h('tr', {},
        h('td', { className: 'muted', style: 'font-size:12px;white-space:nowrap' }, new Date(e.at * 1000).toLocaleString()),
        h('td', {}, h('span', { style: `color:${ACT[e.action] || 'var(--ink)'};font-weight:600;font-size:12px` }, e.action)),
        h('td', { className: 'muted', style: 'font-size:12px' }, e.entity_type),
        h('td', { className: 'mono', style: 'font-size:11.5px' }, e.detail || '')));
    }
    t.append(tb); auditBox.append(h('div', { style: 'overflow-x:auto' }, t));
  }
  return root;
}

// ════════════════════════════════════════════════════════════════════════
//  GraphBuilderView — interactive, client-side chart builder (JMP Graph
//  Builder-lite). Pick chart type + X/Y/color columns; renders live SVG with
//  hover tooltips. No sidecar round-trip — instant, exploratory.
// ════════════════════════════════════════════════════════════════════════
function _gbLoadRows(ds, onReady) {
  // Returns rows synchronously if cached, else kicks off a fetch and returns null.
  if (state._gbData && state._gbData._dsId === ds.id) return state._gbData.rows;
  if (ds._demo) {
    const demoVals = state.analyses.find(a => a.dataset_id === ds.id)?.result_json?.demo_values || [];
    const shifts = ['A', 'B', 'C'];
    state._gbData = { _dsId: ds.id, rows: demoVals.map((v, i) => ({
      cycle_time_minutes: Math.round(v * 1000) / 1000, shift: shifts[i % 3] })) };
    return state._gbData.rows;
  }
  state._gbData = { _dsId: ds.id, loading: true, rows: null };
  api.get(`/api/datasets/${ds.id}/rows?limit=5000`)
    .then(r => { state._gbData = { _dsId: ds.id, rows: r.rows }; onReady(); })
    .catch(e => { state._gbData = { _dsId: ds.id, error: e.message || 'load failed' }; onReady(); });
  return null;
}

function _svgEl(tag, attrs, ...kids) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  for (const c of kids) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

const GB_PALETTE = ['#c9a24b', '#3a7ca5', '#b5654a', '#5a8f69', '#8a6fae', '#c06c84', '#7a7a7a'];

function GraphBuilderView() {
  const root = h('div', { className: 'graph-builder' });
  if (!state.datasets.length) {
    root.append(h('h2', {}, 'Graph Builder'),
      h('div', { className: 'card', style: 'padding:24px;text-align:center' },
        h('p', { className: 'muted' }, 'Load a dataset first.'),
        h('button', { className: 'primary', onclick: () => { state.view = 'data'; render(); } }, 'Go to Data')));
    return root;
  }
  const dsId = state._gbDatasetId || state.current_dataset?.id || state.datasets[0].id;
  const ds = state.datasets.find(d => d.id === dsId) || state.datasets[0];
  state._gb = state._gb || { type: 'scatter', x: null, y: null, color: null };
  const cfg = state._gb;

  const rows = _gbLoadRows(ds, render);
  const schema = ds.schema_json || (rows && rows[0] ? Object.keys(rows[0]).map(n => ({ name: n, type: 'string' })) : []);
  const numCols = schema.filter(c => c.type === 'number').map(c => c.name);
  const allCols = schema.map(c => c.name);
  // Sensible defaults.
  if (!cfg.x) cfg.x = (cfg.type === 'histogram' || cfg.type === 'box') ? (numCols[0] || allCols[0]) : (numCols[0] || allCols[0]);
  if (!cfg.y && numCols.length > 1) cfg.y = numCols[1];

  // ─ Controls ─
  const typeSel = h('select', { className: 'fb-input', onchange: () => { cfg.type = typeSel.value; render(); } },
    ...['scatter', 'line', 'histogram', 'box', 'bar'].map(t => h('option', { value: t, selected: t === cfg.type }, t)));
  const dsSel = h('select', { className: 'fb-input',
    onchange: () => { state._gbDatasetId = dsSel.value; state._gbData = null; state._gb = { type: cfg.type, x: null, y: null, color: null }; render(); } },
    ...state.datasets.map(d => h('option', { value: d.id, selected: d.id === ds.id }, d.name)));
  const colSelect = (label, val, opts, onPick, allowNone) => {
    const sel = h('select', { className: 'fb-input', onchange: () => { onPick(sel.value || null); render(); } },
      ...(allowNone ? [h('option', { value: '', selected: !val }, '— none —')] : []),
      ...opts.map(c => h('option', { value: c, selected: c === val }, c)));
    return h('label', { className: 'field', style: 'margin:0' }, label, sel);
  };
  const needsY = cfg.type === 'scatter' || cfg.type === 'line' || cfg.type === 'bar';
  const xOpts = (cfg.type === 'histogram' || cfg.type === 'box') ? numCols : allCols;
  const controls = h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px' },
    h('label', { className: 'field', style: 'margin:0' }, 'Chart', typeSel),
    h('label', { className: 'field', style: 'margin:0' }, 'Dataset', dsSel),
    colSelect(cfg.type === 'box' ? 'Measure' : 'X', cfg.x, xOpts, v => cfg.x = v, false),
    ...(needsY ? [colSelect('Y', cfg.y, numCols, v => cfg.y = v, false)] : []),
    colSelect(cfg.type === 'box' || cfg.type === 'bar' ? 'Group' : 'Color', cfg.color, allCols, v => cfg.color = v, true));
  root.append(h('div', { className: 'row', style: 'align-items:center;gap:10px;margin-bottom:6px' },
    h('h2', { style: 'margin:0' }, 'Graph Builder'),
    h('span', { className: 'muted', style: 'font-size:12px' }, 'interactive · client-side')), controls);

  if (!rows) { root.append(h('div', { className: 'card' }, state._gbData?.error
    ? h('p', { className: 'muted' }, state._gbData.error) : skeleton({ lines: 1, block: 1 }))); return root; }

  const chartBox = h('div', { className: 'card', style: 'overflow-x:auto;position:relative' });
  const tip = h('div', { className: 'gb-tip', style: 'position:absolute;pointer-events:none;opacity:0;background:var(--bg);border:1px solid var(--line-2);border-radius:5px;padding:4px 8px;font-size:11px;white-space:nowrap;z-index:5;transition:opacity .08s' });
  try {
    chartBox.append(_gbRender(cfg, rows, tip));
  } catch (e) {
    chartBox.append(h('p', { className: 'muted' }, `Cannot plot: ${e.message}`));
  }
  chartBox.append(tip);
  root.append(chartBox);
  root.append(h('p', { className: 'muted', style: 'font-size:11px;margin-top:8px' },
    `${rows.length.toLocaleString()} rows · hover points/bars for values · charts render in your browser (no server round-trip).`));
  return root;
}

function _gbRender(cfg, rows, tip) {
  const W = 760, H = 420, m = { l: 64, r: 24, t: 20, b: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = _svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', width: '100%' });
  const showTip = (e, html) => { tip.innerHTML = html; tip.style.opacity = '1';
    const r = svg.getBoundingClientRect(); tip.style.left = (e.clientX - r.left + 10) + 'px'; tip.style.top = (e.clientY - r.top + 10) + 'px'; };
  const hideTip = () => { tip.style.opacity = '0'; };
  const axis = (x1, y1, x2, y2) => _svgEl('line', { x1, y1, x2, y2, stroke: 'var(--line-2,#888)', 'stroke-width': 1 });
  const num = v => (typeof v === 'number' ? v : parseFloat(v));
  const fmt = v => (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01)) ? v.toPrecision(3) : (Math.round(v * 1000) / 1000);

  function linScale(dmin, dmax, rmin, rmax) {
    if (dmin === dmax) { dmin -= 1; dmax += 1; }
    return v => rmin + (v - dmin) / (dmax - dmin) * (rmax - rmin);
  }
  function yAxisTicks(sc, dmin, dmax) {
    const g = _svgEl('g', {});
    for (let i = 0; i <= 4; i++) {
      const val = dmin + (dmax - dmin) * i / 4, yy = sc(val);
      g.appendChild(axis(m.l - 4, yy, m.l, yy));
      g.appendChild(_svgEl('text', { x: m.l - 8, y: yy + 3, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted,#999)' }, String(fmt(val))));
    }
    return g;
  }

  // Color grouping.
  const colorBy = cfg.color;
  const groupsOf = () => {
    if (!colorBy) return [{ key: null, rows }];
    const map = new Map();
    for (const r of rows) { const k = String(r[colorBy]); if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
    return [...map.entries()].map(([key, rs]) => ({ key, rows: rs }));
  };

  if (cfg.type === 'scatter' || cfg.type === 'line') {
    const xs = rows.map(r => num(r[cfg.x])), ys = rows.map(r => num(r[cfg.y]));
    const xv = xs.filter(Number.isFinite), yv = ys.filter(Number.isFinite);
    if (!xv.length || !yv.length) throw new Error('need numeric X and Y');
    const sx = linScale(Math.min(...xv), Math.max(...xv), m.l, m.l + iw);
    const sy = linScale(Math.min(...yv), Math.max(...yv), m.t + ih, m.t);
    svg.appendChild(axis(m.l, m.t + ih, m.l + iw, m.t + ih));
    svg.appendChild(axis(m.l, m.t, m.l, m.t + ih));
    svg.appendChild(yAxisTicks(sy, Math.min(...yv), Math.max(...yv)));
    const groups = groupsOf();
    groups.forEach((g, gi) => {
      const color = GB_PALETTE[gi % GB_PALETTE.length];
      const pts = g.rows.map(r => [num(r[cfg.x]), num(r[cfg.y])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (cfg.type === 'line') {
        pts.sort((a, b) => a[0] - b[0]);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
        svg.appendChild(_svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.6 }));
      }
      for (const [px, py] of pts) {
        const c = _svgEl('circle', { cx: sx(px), cy: sy(py), r: 3, fill: color, 'fill-opacity': 0.7, stroke: color });
        c.addEventListener('mousemove', e => showTip(e, `${cfg.x}: <b>${fmt(px)}</b><br>${cfg.y}: <b>${fmt(py)}</b>${g.key != null ? `<br>${colorBy}: ${g.key}` : ''}`));
        c.addEventListener('mouseleave', hideTip);
        svg.appendChild(c);
      }
    });
    svg.appendChild(_svgEl('text', { x: m.l + iw / 2, y: H - 14, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-2,#bbb)' }, cfg.x));
    svg.appendChild(_svgEl('text', { x: 16, y: m.t + ih / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-2,#bbb)', transform: `rotate(-90 16 ${m.t + ih / 2})` }, cfg.y));
  } else if (cfg.type === 'histogram') {
    const vals = rows.map(r => num(r[cfg.x])).filter(Number.isFinite);
    if (!vals.length) throw new Error('need a numeric column');
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const k = Math.max(5, Math.min(20, Math.ceil(Math.sqrt(vals.length))));
    const bw = (mx - mn) / k || 1;
    const bins = Array.from({ length: k }, () => 0);
    for (const v of vals) bins[Math.min(k - 1, Math.floor((v - mn) / bw))]++;
    const ymax = Math.max(...bins);
    const sx = linScale(mn, mx, m.l, m.l + iw);
    const sy = linScale(0, ymax, m.t + ih, m.t);
    svg.appendChild(axis(m.l, m.t + ih, m.l + iw, m.t + ih));
    svg.appendChild(axis(m.l, m.t, m.l, m.t + ih));
    svg.appendChild(yAxisTicks(sy, 0, ymax));
    bins.forEach((cnt, i) => {
      const x0 = sx(mn + i * bw), x1 = sx(mn + (i + 1) * bw), y0 = sy(cnt);
      const bar = _svgEl('rect', { x: x0 + 1, y: y0, width: Math.max(1, x1 - x0 - 2), height: (m.t + ih) - y0, fill: GB_PALETTE[0], 'fill-opacity': 0.8 });
      bar.addEventListener('mousemove', e => showTip(e, `[${fmt(mn + i * bw)}, ${fmt(mn + (i + 1) * bw)})<br>count: <b>${cnt}</b>`));
      bar.addEventListener('mouseleave', hideTip);
      svg.appendChild(bar);
    });
    svg.appendChild(_svgEl('text', { x: m.l + iw / 2, y: H - 14, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-2,#bbb)' }, cfg.x));
  } else if (cfg.type === 'box') {
    const groups = colorBy ? groupsOf() : [{ key: 'all', rows }];
    const series = groups.map(g => ({ key: g.key, vals: g.rows.map(r => num(r[cfg.x])).filter(Number.isFinite).sort((a, b) => a - b) })).filter(s => s.vals.length);
    if (!series.length) throw new Error('need a numeric measure');
    const all = series.flatMap(s => s.vals);
    const sy = linScale(Math.min(...all), Math.max(...all), m.t + ih, m.t);
    svg.appendChild(axis(m.l, m.t, m.l, m.t + ih));
    svg.appendChild(yAxisTicks(sy, Math.min(...all), Math.max(...all)));
    const q = (a, p) => { const idx = (a.length - 1) * p, lo = Math.floor(idx); return a[lo] + (a[Math.ceil(idx)] - a[lo]) * (idx - lo); };
    const bwid = iw / series.length;
    series.forEach((s, i) => {
      const cx = m.l + bwid * (i + 0.5), q1 = q(s.vals, 0.25), med = q(s.vals, 0.5), q3 = q(s.vals, 0.75);
      const lo = s.vals[0], hi = s.vals[s.vals.length - 1], color = GB_PALETTE[i % GB_PALETTE.length], bw2 = Math.min(54, bwid * 0.5);
      svg.appendChild(axis(cx, sy(lo), cx, sy(hi)));
      const box = _svgEl('rect', { x: cx - bw2 / 2, y: sy(q3), width: bw2, height: Math.max(1, sy(q1) - sy(q3)), fill: color, 'fill-opacity': 0.35, stroke: color });
      box.addEventListener('mousemove', e => showTip(e, `${s.key}<br>median <b>${fmt(med)}</b><br>Q1 ${fmt(q1)} · Q3 ${fmt(q3)}<br>min ${fmt(lo)} · max ${fmt(hi)}`));
      box.addEventListener('mouseleave', hideTip);
      svg.appendChild(box);
      svg.appendChild(_svgEl('line', { x1: cx - bw2 / 2, y1: sy(med), x2: cx + bw2 / 2, y2: sy(med), stroke: color, 'stroke-width': 2 }));
      svg.appendChild(_svgEl('text', { x: cx, y: m.t + ih + 16, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted,#999)' }, String(s.key).slice(0, 12)));
    });
  } else if (cfg.type === 'bar') {
    // Mean of Y per category of X (group/color overrides X if both numeric-ish).
    const cat = cfg.x, yc = cfg.y;
    const map = new Map();
    for (const r of rows) { const k = String(r[cat]); const v = num(r[yc]); if (!Number.isFinite(v)) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(v); }
    const cats = [...map.entries()].map(([k, vs]) => ({ k, mean: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length }));
    if (!cats.length) throw new Error('need a category X and numeric Y');
    const ymax = Math.max(...cats.map(c => c.mean)), ymin = Math.min(0, ...cats.map(c => c.mean));
    const sy = linScale(ymin, ymax, m.t + ih, m.t);
    svg.appendChild(axis(m.l, sy(0), m.l + iw, sy(0)));
    svg.appendChild(axis(m.l, m.t, m.l, m.t + ih));
    svg.appendChild(yAxisTicks(sy, ymin, ymax));
    const bwid = iw / cats.length;
    cats.forEach((c, i) => {
      const x0 = m.l + bwid * i + bwid * 0.15, w = bwid * 0.7, y0 = sy(c.mean);
      const bar = _svgEl('rect', { x: x0, y: Math.min(y0, sy(0)), width: w, height: Math.abs(sy(0) - y0), fill: GB_PALETTE[i % GB_PALETTE.length], 'fill-opacity': 0.85 });
      bar.addEventListener('mousemove', e => showTip(e, `${c.k}<br>mean ${yc}: <b>${fmt(c.mean)}</b><br>n=${c.n}`));
      bar.addEventListener('mouseleave', hideTip);
      svg.appendChild(bar);
      svg.appendChild(_svgEl('text', { x: x0 + w / 2, y: m.t + ih + 16, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted,#999)' }, String(c.k).slice(0, 10)));
    });
    svg.appendChild(_svgEl('text', { x: 16, y: m.t + ih / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-2,#bbb)', transform: `rotate(-90 16 ${m.t + ih / 2})` }, `mean ${yc}`));
  }
  return svg;
}

// ────────────────── DATA VIEW ──────────────────

// Direct worksheet edits — rename/drop a column inline. The demo dataset is
// client-side only, so we mutate it in memory; real datasets hit the in-place
// /edit endpoint (mutates the same dataset, bumps version).
async function wsRenameColumn(ds, from, to) {
  if (ds._demo) {
    (ds.schema_json || []).forEach(c => { if (c.name === from) c.name = to; });
    const wd = state._worksheetData;
    if (wd && wd.rows) wd.rows.forEach(r => { r[to] = r[from]; delete r[from]; });
    state._gbData = null;
    render(); toast({ kind: 'success', msg: `Renamed to "${to}" (demo — not persisted).` });
    return;
  }
  try {
    await api.post(`/api/datasets/${ds.id}/edit`, { op: 'rename', params: { from, to } });
    state._worksheetData = null;
    await refreshData(); render();
    toast({ kind: 'success', msg: `Renamed "${from}" → "${to}".` });
  } catch (e) { toast({ kind: 'error', msg: e.message || 'Rename failed.' }); render(); }
}

async function wsSetCell(ds, rowIndex, column, value) {
  if (ds._demo) {
    const wd = state._worksheetData;
    if (wd && wd.rows && wd.rows[rowIndex]) {
      const isNum = (ds.schema_json || []).find(c => c.name === column)?.type === 'number';
      wd.rows[rowIndex][column] = isNum && value !== '' && !isNaN(Number(value)) ? Number(value) : value;
    }
    render(); return;
  }
  try {
    await api.post(`/api/datasets/${ds.id}/edit`, { op: 'set_cell', params: { row: rowIndex, column, value } });
    state._worksheetData = null; await refreshData(); render();
  } catch (e) { toast({ kind: 'error', msg: e.message || 'Edit failed.' }); render(); }
}

async function wsAddColumn(ds) {
  const name = prompt('New column name:');
  if (!name || !name.trim()) return;
  const expr = prompt(`Formula for "${name.trim()}" (e.g. cycle_time_minutes * 60). Leave blank for an empty column.`);
  if (ds._demo) {
    (ds.schema_json || []).push({ name: name.trim(), type: 'string' });
    const wd = state._worksheetData;
    if (wd && wd.rows) wd.rows.forEach(r => { r[name.trim()] = ''; });
    render(); toast({ kind: 'success', msg: `Added "${name.trim()}" (demo — formulas need uploaded data).` });
    return;
  }
  if (!expr || !expr.trim()) { toast({ kind: 'warn', msg: 'A formula is required to add a column to a real dataset.' }); return; }
  try {
    await api.post(`/api/datasets/${ds.id}/edit`, { op: 'compute', params: { new_column: name.trim(), expression: expr.trim() } });
    state._worksheetData = null; await refreshData(); render();
    toast({ kind: 'success', msg: `Added column "${name.trim()}".` });
  } catch (e) { toast({ kind: 'error', msg: e.message || 'Add column failed.' }); render(); }
}

async function wsDropColumn(ds, name) {
  if (ds._demo) {
    ds.schema_json = (ds.schema_json || []).filter(c => c.name !== name);
    const wd = state._worksheetData;
    if (wd && wd.rows) wd.rows.forEach(r => { delete r[name]; });
    state._gbData = null;
    render(); toast({ kind: 'success', msg: `Dropped "${name}" (demo — not persisted).` });
    return;
  }
  try {
    await api.post(`/api/datasets/${ds.id}/edit`, { op: 'drop', params: { columns: [name] } });
    state._worksheetData = null;
    await refreshData(); render();
    toast({ kind: 'success', msg: `Dropped column "${name}".` });
  } catch (e) { toast({ kind: 'error', msg: e.message || 'Drop failed.' }); render(); }
}

// ═══════════════════════════════════════════════════════════════════════
//  WorksheetView — the always-available data grid Minitab/JMP users expect.
//  Dataset switcher + per-column quick stats + scrollable sticky-header table.
// ═══════════════════════════════════════════════════════════════════════
function WorksheetView() {
  const root = h('div', { className: 'worksheet-view' });
  if (!state.datasets.length) {
    root.append(h('div', { className: 'card', style: 'padding:24px;text-align:center' },
      h('div', { className: 'empty-mark' }, 'No data yet'),
      h('p', { className: 'muted', style: 'margin:8px 0 12px' }, 'Upload, paste, or load a sample to see it as a worksheet.'),
      h('button', { className: 'primary', onclick: () => { state.view = 'data'; render(); } }, 'Go to Data')));
    return root;
  }
  const dsId = state._worksheetDatasetId || state.current_dataset?.id || state.datasets[0].id;
  const ds = state.datasets.find(d => d.id === dsId) || state.datasets[0];

  // Header: title + dataset switcher + row actions.
  const dsSel = h('select', { className: 'fb-input', style: 'max-width:280px',
    onchange: () => { state._worksheetDatasetId = dsSel.value; state._worksheetData = null; render(); } },
    ...state.datasets.map(d => h('option', { value: d.id, selected: d.id === ds.id }, `${d.name} · ${d.row_count} rows`)));
  root.append(h('div', { className: 'row', style: 'align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap' },
    h('h2', { style: 'margin:0' }, 'Worksheet'),
    dsSel,
    h('span', { style: 'flex:1' }),
    h('button', { className: 'ghost', title: 'Analyze this dataset',
      onclick: () => { state.current_dataset = ds; state.view = 'analyze'; render(); } }, 'Analyze →'),
    h('button', { className: 'ghost', title: 'Transform',
      onclick: () => openTransformModal(ds) }, '🔧 Advanced transform'),
    h('button', { className: 'ghost', title: 'Add a column (formula or blank)',
      onclick: () => wsAddColumn(ds) }, '➕ Column'),
    h('button', { className: 'ghost', title: 'Append rows',
      onclick: () => openAppendModal(ds) }, '➕ Append'),
    ds._demo ? null : h('a', { className: 'ghost', title: 'Download as CSV',
      href: `/api/datasets/${ds.id}/export.csv`, download: '',
      style: 'text-decoration:none' }, '⬇ Export CSV'),
    ds.source_url ? h('button', { className: 'ghost', title: `Re-fetch from ${ds.source_url}`,
      onclick: async (e) => {
        const btn = e.currentTarget;
        await withLoading(btn, async () => {
          try {
            const r = await api.post(`/api/datasets/${ds.id}/refresh-source`, {});
            state._worksheetData = null;
            await refreshData(); render();
            toast({ kind: 'success', msg: `Refreshed to v${r.version} (${r.row_count} rows). Linked analyses are flagged stale.` });
          } catch (err) { toast({ kind: 'error', msg: err.message || 'Refresh failed.' }); }
        });
      } }, '🔄 Refresh source') : null));

  // Demo dataset is client-side synthetic (no server-side rows). Reconstruct
  // a worksheet from the demo analysis's inline values so the grid is populated.
  if (ds._demo && (!state._worksheetData || state._worksheetData._dsId !== ds.id)) {
    const demoVals = state.analyses.find(a => a.dataset_id === ds.id)?.result_json?.demo_values || [];
    const shifts = ['A', 'B', 'C'];
    const demoRows = demoVals.map((v, i) => ({
      cycle_time_minutes: Math.round(v * 1000) / 1000,
      shift: shifts[i % 3],
    }));
    state._worksheetData = { _dsId: ds.id, rows: demoRows, n_total: demoRows.length, truncated: false };
  }

  // Fetch rows once per dataset, cache on state (mirror ExploreView).
  if (!state._worksheetData || state._worksheetData._dsId !== ds.id) {
    state._worksheetData = { _dsId: ds.id, loading: true };
    api.get(`/api/datasets/${ds.id}/rows?limit=5000`).then(r => {
      state._worksheetData = { _dsId: ds.id, rows: r.rows, n_total: r.n_total, truncated: r.truncated };
      render();
    }).catch((e) => { state._worksheetData = { _dsId: ds.id, error: e.message || 'load failed' }; render(); });
    root.append(h('div', { className: 'card' }, skeleton({ lines: 1, block: 1 })));
    return root;
  }
  if (state._worksheetData.error) {
    root.append(h('div', { className: 'card' }, h('p', { className: 'muted' }, state._worksheetData.error)));
    return root;
  }
  const rows = state._worksheetData.rows || [];
  const schema = ds.schema_json || (rows[0] ? Object.keys(rows[0]).map(n => ({ name: n, type: 'string' })) : []);
  const cols = schema.map(c => c.name);

  // Per-column quick stats (computed client-side over the loaded rows).
  const statFor = (col, type) => {
    const vals = rows.map(r => r[col]).filter(v => v != null && v !== '');
    const nNull = rows.length - vals.length;
    if (type === 'number') {
      const nums = vals.map(Number).filter(Number.isFinite);
      if (!nums.length) return `n=0 · ${nNull} null`;
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const mn = Math.min(...nums), mx = Math.max(...nums);
      return `mean ${(window.statsUx?.fmtNum ? window.statsUx.fmtNum(mean) : mean.toFixed(3))} · min ${mn} · max ${mx}${nNull ? ` · ${nNull} null` : ''}`;
    }
    const distinct = new Set(vals.map(String)).size;
    return `${distinct} distinct${nNull ? ` · ${nNull} null` : ''}`;
  };

  if (state._worksheetData.truncated) {
    root.append(h('div', { className: 'card muted', style: 'font-size:12px;border-left:3px solid var(--accent)' },
      `Showing the first 5,000 of ${state._worksheetData.n_total.toLocaleString()} rows. Analyses use all rows.`));
  }

  // The grid — sticky header with type badge + quick stat, monospace numerics.
  const table = h('table', { className: 'worksheet-grid' });
  const thead = h('thead');
  const hRow = h('tr');
  hRow.append(h('th', { className: 'ws-rownum' }, '#'));
  for (const c of schema) {
    // Editable column name — click to rename inline (Enter applies, Esc cancels).
    const nameEl = h('div', { className: 'ws-col-name ws-editable', title: 'Click to rename',
      onclick: (e) => {
        const cell = e.currentTarget;
        const input = h('input', { className: 'ws-rename-input', value: c.name });
        const commit = (apply) => {
          const v = input.value.trim();
          if (apply && v && v !== c.name) wsRenameColumn(ds, c.name, v);
          else { cell.textContent = c.name; }   // revert label; full re-render on apply
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
        });
        input.addEventListener('blur', () => commit(false));
        cell.textContent = ''; cell.appendChild(input); input.focus(); input.select();
      } }, c.name);
    const drop = h('button', { className: 'ws-col-drop', title: `Drop column "${c.name}"`,
      'aria-label': `Drop column ${c.name}`,
      onclick: () => { if (confirm(`Drop column "${c.name}"? This creates a new dataset; the original is preserved.`)) wsDropColumn(ds, c.name); } }, '×');
    hRow.append(h('th', {},
      h('div', { className: 'ws-col-head' }, nameEl, drop),
      h('div', { className: 'ws-col-type' }, c.type || 'string'),
      h('div', { className: 'ws-col-stat' }, statFor(c.name, c.type))));
  }
  thead.append(hRow);
  table.append(thead);
  const tbody = h('tbody');
  const MAX_DISPLAY = 500;   // DOM cap; truncation note below
  rows.slice(0, MAX_DISPLAY).forEach((r, i) => {
    const tr = h('tr');
    tr.append(h('td', { className: 'ws-rownum' }, String(i + 1)));
    for (const c of schema) {
      const v = r[c.name];
      const isNum = c.type === 'number';
      // Editable cell — double-click (or Enter on focus) to edit; commit on Enter/blur.
      const td = h('td', { className: (isNum ? 'ws-num' : '') + ' ws-cell', title: 'Double-click to edit',
        ondblclick: (e) => {
          const cell = e.currentTarget;
          const input = h('input', { className: 'ws-cell-input', value: (v == null ? '' : String(v)) });
          const done = (apply) => {
            const nv = input.value;
            if (apply && nv !== (v == null ? '' : String(v))) wsSetCell(ds, i, c.name, nv);
            else render();   // revert
          };
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
            else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
          });
          input.addEventListener('blur', () => done(false));
          cell.textContent = ''; cell.appendChild(input); input.focus(); input.select();
        } },
        v == null || v === '' ? h('span', { className: 'ws-null' }, '·') : String(v));
      tr.append(td);
    }
    tbody.append(tr);
  });
  table.append(tbody);
  const scroller = h('div', { className: 'worksheet-scroll' }, table);
  root.append(scroller);
  if (rows.length > MAX_DISPLAY) {
    root.append(h('div', { className: 'muted', style: 'font-size:12px;margin-top:8px' },
      `Displaying the first ${MAX_DISPLAY} of ${rows.length.toLocaleString()} loaded rows for performance. Column stats above use all loaded rows.`));
  }
  return root;
}

function DataView() {
  const root = h('div');
  root.append(
    h('h2', {}, 'Data', h('span', { className: 'muted' }, ' · upload, paste, samples')),
    h('div', { className: 'breadcrumb' }, 'Workbench · Data'),
  );

  // ───── Three ingestion paths, side-by-side: Upload · Paste · Sample ─────
  const ingestGrid = h('div', { className: 'ingest-grid' });

  // 1. Upload
  const uploadCard = h('div', { className: 'card ingest-card' });
  const uploadHead = h('h3', { className: 'row', style: 'gap:8px;align-items:center;margin:0 0 4px' },
    h('span', { style: 'flex:1' }, 'Upload a file'),
    h('button', { className: 'upload-guide-btn',
      title: 'What works? What goes wrong?',
      'aria-label': 'Upload help — supported formats and common problems',
      onclick: () => openUploadGuide() }, '?'),
  );
  uploadCard.append(uploadHead,
    h('p', { className: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      'CSV, TSV, Excel, PDF, or JSON. Up to 25 MB. Auto-detects delimiter and encoding — semicolon-CSV, TSV, and metadata-prefixed exports all parse cleanly.'),
  );
  const fileInput = h('input', { type: 'file',
    accept: '.csv,.tsv,.txt,.xlsx,.xls,.pdf,.json',
    style: 'margin-bottom:8px;width:100%' });
  const nameInput = h('input', { placeholder: 'Optional name',
    style: 'margin-bottom:8px;width:100%' });
  const uploadBtn = h('button', { className: 'primary',
    onclick: () => withLoading(uploadBtn, async () => {
      if (!fileInput.files[0]) { toast({ kind: 'warn', msg: 'Pick a file first.' }); return; }
      try {
        const r = await api.upload('/api/datasets/upload',
          { file: fileInput.files[0], name: nameInput.value || undefined });
        const meta = r?.dataset?.parse_meta;
        const detail = meta
          ? `Detected ${meta.delimiter === '\t' ? 'TSV' : meta.delimiter === ',' ? 'CSV' : 'delimiter ' + JSON.stringify(meta.delimiter)} · ${meta.encoding}${meta.skipped_leading_lines ? ` · skipped ${meta.skipped_leading_lines} metadata rows` : ''}.`
          : '';
        toast({ kind: 'success', msg: 'Dataset added.', title: detail });
        // Remember the just-uploaded id so we can show a quality card.
        state._lastUploadedDatasetId = r?.dataset?.id;
        state._lastUploadedQuality = null;  // will fetch on next render
        fileInput.value = ''; nameInput.value = '';
        await refreshData(); render();
      } catch {/* toasted */}
    }),
  }, 'Upload');
  uploadCard.append(fileInput, nameInput, uploadBtn);

  // 2. Paste
  const pasteCard = h('div', { className: 'card ingest-card' },
    h('h3', {}, 'Paste from Excel'),
    h('p', { className: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      'Copy a range from Excel / Google Sheets / Minitab worksheet (with headers) and paste here. Tab and comma delimiters both work.'),
  );
  const pasteArea = h('textarea', {
    placeholder: 'Paste tabular data here (Ctrl/⌘+V)…\n\nExample:\npart\tdiameter\toperator\n1\t10.05\tA\n2\t10.12\tB',
    rows: 6,
    style: 'width:100%;font:12px var(--font-mono, monospace);padding:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;resize:vertical;margin-bottom:8px',
  });
  const pasteName = h('input', { placeholder: 'Optional name (e.g. "Q4 cycle times")',
    style: 'margin-bottom:8px;width:100%' });
  const pasteBtn = h('button', { className: 'primary',
    onclick: () => withLoading(pasteBtn, async () => {
      if (!pasteArea.value.trim()) { toast({ kind: 'warn', msg: 'Paste some data first.' }); return; }
      try {
        const r = await api.post('/api/datasets/paste', {
          text: pasteArea.value, name: pasteName.value || undefined,
        });
        const meta = r?.dataset?.parse_meta;
        toast({ kind: 'success', msg: 'Dataset added.',
          title: meta ? `Detected delimiter: ${meta.delimiter === '\t' ? 'tab' : JSON.stringify(meta.delimiter)}.` : '' });
        pasteArea.value = ''; pasteName.value = '';
        await refreshData(); render();
      } catch {/* toasted */}
    }),
  }, 'Paste & save');
  pasteCard.append(pasteArea, pasteName, pasteBtn);

  // 3. Sample datasets — one-click LSS examples
  const sampleCard = h('div', { className: 'card ingest-card' },
    h('h3', {}, 'Load a sample'),
    h('p', { className: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      'Pre-built LSS datasets that land cleanly on a canonical analysis. Great for learning, demos, and the in-app guides.'),
  );
  // Render asynchronously — fetch sample catalogue once and cache.
  const sampleList = h('div', { className: 'sample-chips' });
  if (!state._sampleCatalogue) {
    api.get('/api/datasets/samples').then(r => {
      state._sampleCatalogue = r.samples || [];
      render();
    }).catch(() => { state._sampleCatalogue = []; });
    sampleList.append(skeleton({ lines: 3, withTitle: false }));
  } else if (!state._sampleCatalogue.length) {
    sampleList.append(h('div', { className: 'muted', style: 'font-size:12px;font-style:italic' }, 'No samples available.'));
  } else {
    for (const s of state._sampleCatalogue) {
      const chip = h('button', { className: 'sample-chip', title: s.blurb,
        onclick: () => withLoading(chip, async () => {
          try {
            const r = await api.post(`/api/datasets/samples/${s.id}`, {});
            toast({ kind: 'success', msg: `Loaded "${s.name}".`,
              title: `Try a ${s.suggested_analysis} analysis on it.` });
            await refreshData();
            state.current_dataset = r.dataset;
            render();
          } catch {/* toasted */}
        }),
      },
        h('div', { className: 'sample-name' }, s.name),
        h('div', { className: 'muted', style: 'font-size:11px;margin-top:2px' },
          `${s.n_rows} rows · ${s.suggested_analysis}`),
      );
      sampleList.append(chip);
    }
  }
  sampleCard.append(sampleList);

  // 4. Import a reproducibility bundle — the receiving end of Export ▸ Bundle.
  const bundleCard = h('div', { className: 'card ingest-card' },
    h('h3', {}, 'Import a bundle'),
    h('p', { className: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      'Load a reproducibility bundle exported from another Bench instance. '
      + 'It recreates the dataset + analysis and re-runs it to verify the hashes match.'));
  const bundleInput = h('input', { type: 'file', accept: '.json,application/json',
    style: 'font-size:12px', 'aria-label': 'Choose a bundle JSON file' });
  const bundleBtn = h('button', { className: 'secondary', style: 'font-size:12px;margin-top:8px' }, 'Import bundle');
  bundleBtn.onclick = () => withLoading(bundleBtn, async () => {
    const file = bundleInput.files?.[0];
    if (!file) { toast({ kind: 'warn', msg: 'Pick a .json bundle first.' }); return; }
    let bundle;
    try { bundle = JSON.parse(await file.text()); }
    catch { toast({ kind: 'error', msg: 'That file isn’t valid JSON.' }); return; }
    try {
      const r = await api.post('/api/analyses/import', bundle);
      await refreshData();
      // Match-verification feedback.
      if (r.rerun_error) {
        toast({ kind: 'warn', title: 'Imported, but not re-verified',
          msg: `Re-run failed on this sidecar: ${r.rerun_error}` });
      } else if (r.rerun_hashes_match === true) {
        toast({ kind: 'success', title: 'Imported — hashes match',
          msg: 'Audit chain verified: this instance reproduces the result byte-for-byte.' });
      } else if (r.rerun_hashes_match === false) {
        toast({ kind: 'warn', title: 'Imported — hashes differ',
          msg: 'Re-ran cleanly but the result differs from the bundle (sidecar version skew?).' });
      } else {
        toast({ kind: 'success', msg: 'Bundle imported.' });
      }
      // Jump to the imported analysis.
      if (r.analysis_id) {
        state._scrollToAnalysis = r.analysis_id;
        state.view = 'analyze'; state._analysisFamily = 'all'; state.formOpen = false;
      }
      render();
    } catch (e) {
      const map = {
        not_a_bench_bundle: 'That JSON isn’t a Bench bundle.',
        unsupported_bundle_version: 'This bundle was made by a newer Bench — upgrade to import it.',
        bundle_too_large: 'Bundle exceeds the 50,000-row import cap.',
        bundle_missing_analysis: 'Bundle has no analysis to import.',
      };
      toast({ kind: 'error', msg: map[e.body?.error] || e.message || 'Import failed.' });
    }
  });
  bundleCard.append(bundleInput, h('div', {}, bundleBtn));

  // 5. Connect a URL — live data source (Google Sheets CSV, any public CSV/TSV).
  const urlCard = h('div', { className: 'card ingest-card' });
  const urlInput = h('input', { type: 'url', placeholder: 'https://…/data.csv (or published Google Sheet CSV)',
    style: 'width:100%' });
  const urlName = h('input', { placeholder: 'Dataset name (optional)', style: 'width:100%;margin-top:6px' });
  const urlBtn = h('button', { className: 'primary', style: 'margin-top:8px', onclick: () => withLoading(urlBtn, async () => {
    if (!urlInput.value.trim()) { toast({ kind: 'warn', msg: 'Paste a CSV URL first.' }); return; }
    try {
      const r = await api.post('/api/datasets/from-url', { url: urlInput.value.trim(), name: urlName.value.trim() || undefined });
      toast({ kind: 'success', msg: `Linked "${r.dataset.name}" (${r.dataset.row_count} rows). Refresh any time from the worksheet.` });
      await refreshData(); state.current_dataset = state.datasets.find(d => d.id === r.dataset.id) || state.current_dataset;
      render();
    } catch (e) { toast({ kind: 'error', msg: e.message || 'Could not fetch that URL.' }); }
  }) }, 'Connect');
  urlCard.append(
    h('h3', { className: 'row', style: 'gap:8px;align-items:center;margin:0 0 4px' }, 'Connect a URL',
      h('span', { className: 'pill accent', style: 'font-size:9px' }, 'LIVE')),
    h('p', { className: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      'Pull from a published Google Sheet or any public CSV/TSV link, then one-click refresh when the source updates. The thing a desktop tool can’t do.'),
    urlInput, urlName, h('div', {}, urlBtn));

  ingestGrid.append(uploadCard, pasteCard, sampleCard, bundleCard, urlCard);
  root.append(ingestGrid);

  // Post-upload quality card — surfaces flags (mostly-numeric text columns,
  // dates-stored-as-strings, ID columns, high nulls) so the user catches
  // mistakes before running stats.
  if (state._lastUploadedDatasetId) {
    root.append(renderQualityCard(state._lastUploadedDatasetId));
  }

  // Datasets list
  if (!state.datasets.length) {
    root.append(h('div', { className: 'empty' },
      h('div', { className: 'empty-mark' }, 'Empty workspace'),
      h('div', { className: 'empty-title' }, 'No datasets yet.'),
      h('div', { className: 'empty-desc' },
        'Upload a CSV, Excel, or PDF above. Or generate random data from the Tools view to play with.'),
    ));
    return root;
  }
  const listCard = h('div', { className: 'card' },
    h('div', { className: 'card-header' }, h('h3', {}, 'Your datasets'),
      h('span', { className: 'meta' }, `${state.datasets.length}`)),
  );
  const table = h('table', { className: 'table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, 'Name'), h('th', {}, 'Columns'), h('th', {}, 'Rows'), h('th', {}, 'Added'), h('th', {}, ''))));
  const tbody = h('tbody');
  for (const d of state.datasets) {
    tbody.append(h('tr', { className: 'clickable',
      onclick: () => { state.current_dataset = d; state.view = 'analyze'; render(); },
    },
      h('td', {}, d.name),
      h('td', {}, String(d.schema_json?.length || 0)),
      h('td', {}, String(d.row_count)),
      h('td', { className: 'muted' }, new Date(d.created_at * 1000).toLocaleDateString()),
      h('td', { style: 'text-align:right;white-space:nowrap' },
        h('button', { className: 'ghost', title: 'Visualize this dataset',
          onclick: (e) => { e.stopPropagation();
            state.current_dataset = d; state.view = 'explore';
            state._exploreDatasetId = d.id; state._exploreData = null;
            render();
          },
        }, '📊 Explore'),
        h('button', { className: 'ghost', title: 'Transform data (compute, recode, retype, impute, filter, stack…)',
          onclick: (e) => { e.stopPropagation(); openTransformModal(d); },
        }, '🔧 Transform'),
        h('button', { className: 'ghost', title: 'Append rows — add new data; analyses flag as stale until refreshed',
          onclick: (e) => { e.stopPropagation(); openAppendModal(d); },
        }, '➕ Append'),
        h('button', { className: 'ghost', title: 'Delete dataset',
          onclick: (e) => { e.stopPropagation();
            if (!confirm(`Delete "${d.name}"?`)) return;
            api.delete(`/api/datasets/${d.id}`).then(() => { refreshData().then(render); });
          },
        }, 'Remove')),
    ));
  }
  table.append(tbody);
  listCard.append(table);
  root.append(listCard);

  // Schema preview for selected dataset
  if (state.current_dataset?.schema_json?.length) {
    const schemaCard = h('div', { className: 'card' },
      h('h3', {}, `Schema · ${state.current_dataset.name}`),
      h('table', { className: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Column'), h('th', {}, 'Type'),
          h('th', {}, 'Distinct'), h('th', {}, 'Null'))),
        h('tbody', {}, ...state.current_dataset.schema_json.map(s =>
          h('tr', {}, h('td', { className: 'mono' }, s.name),
            h('td', {}, h('span', { className: 'pill ' + (s.type === 'number' ? 'accent' : '') }, s.type)),
            h('td', {}, String(s.n_unique)),
            h('td', {}, String(s.n_null))))),
      ));
    root.append(schemaCard);
  }
  return root;
}

function triggerUpload() {
  state.view = 'data'; render();
  setTimeout(() => document.querySelector('input[type=file]')?.click(), 100);
}

// ────────────────── ANALYZE VIEW ──────────────────

// Column slots that should accept categorical/string columns by default.
// When a slot is in this set the form prefers non-numeric columns; if none
// exist it falls back to all columns. Fixes the bug where Gauge R&R defaulted
// part_col / operator_col to the same numeric measurement column.
const CATEGORICAL_SLOTS = new Set([
  'part_col', 'operator_col', 'group_col', 'subgroup_col',
  'phase_col', 'category_col', 'class_col', 'factor_cols',
  'time_col',
]);

// Maps a "chooser-recommended" kind back to ANALYSIS_KINDS form rendering.
