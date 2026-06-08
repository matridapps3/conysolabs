function AnalyzeView() {
  const root = h('div');
  if (!state.datasets.length) {
    root.append(
      h('h2', {}, 'Analyze'),
      h('div', { className: 'empty' },
        h('div', { className: 'empty-mark' }, 'Awaiting data'),
        h('div', { className: 'empty-title' }, 'Upload a dataset first.'),
        h('div', { className: 'empty-desc' },
          'Then run any of 27 hypothesis tests, 9 control charts, capability, MSA, DOE, regression, reliability, multivariate, or time-series analyses — all free.'),
        h('button', { className: 'primary', onclick: () => { state.view = 'data'; render(); } }, 'Go to Data'),
      ),
    );
    return root;
  }
  const familyId = state._analysisFamily || 'all';
  const family = ANALYSIS_FAMILIES.find(f => f.id === familyId);
  const familyLabel = family && family.id !== 'all' ? family.label : 'Analyses';
  root.append(
    h('div', { className: 'breadcrumb' }, `Workspace · ${familyLabel}`),
    h('h2', {}, familyLabel,
      state.current_dataset ? h('span', { className: 'muted' }, ` · ${state.current_dataset.name}`) : null),
    AnalyzeForm(),
    AnalyzeList(),
  );
  return root;
}

function AnalyzeForm() {
  // Collapsed by default once there's at least one result on the active dataset
  // — the form takes 600px of space otherwise and pushes results off-screen.
  if (state.formOpen === undefined) {
    state.formOpen = state.analyses.length === 0;
  }
  const card = h('div', { className: 'card analyze-form' + (state.formOpen ? '' : ' collapsed') });

  const kindLabel = ANALYSIS_KINDS[state._chosenKind]?.label || 'Choose analysis';
  const dsName = state.current_dataset?.name || '';
  const summaryLine = state.formOpen
    ? null
    : h('span', { className: 'form-summary' },
        h('span', {}, kindLabel),
        dsName ? h('span', { className: 'muted' }, ` on ${dsName}`) : null,
      );

  const toggleBtn = h('button', {
    className: 'ghost form-toggle',
    onclick: () => { state.formOpen = !state.formOpen; render(); },
    title: state.formOpen ? 'Hide form' : 'Show form',
  }, state.formOpen ? '−' : '+');

  card.append(h('div', { className: 'card-header' },
    h('h3', {}, state.formOpen ? 'Run analysis' : 'Configure'),
    summaryLine,
    h('span', { className: 'spacer' }),
    state.formOpen
      ? h('button', { className: 'secondary', style: 'font-size:11px',
          onclick: () => window.statsUx?.openTestChooser(applyChosenTest),
        }, 'Pick the right test')
      : h('button', { className: 'secondary', style: 'font-size:11px',
          onclick: () => { state.formOpen = true; render(); },
        }, 'Edit & re-run'),
    toggleBtn,
  ));

  // ── Plain-English query bar — ALWAYS visible, even when the form below is
  // collapsed, so the fastest way into an analysis is never hidden. (It used
  // to live inside the collapsible form and vanished the moment any result
  // existed.) On a collapsed form, Enter opens the form and applies the query
  // once it re-renders (via state._pendingQuery + applyQuery, hoisted below).
  const queryInput = h('input', {
    className: 'query-bar-input',
    placeholder: 'Describe it in plain English — e.g. “capability on cycle_time”, “compare yield by line”, “is thickness normal?”',
    style: 'flex:1',
    onkeydown: (e) => {
      if (e.key !== 'Enter' || !queryInput.value.trim()) return;
      if (!state.formOpen) { state._pendingQuery = queryInput.value; state.formOpen = true; render(); return; }
      applyQuery(queryInput.value);
    },
  });
  card.append(h('div', { className: 'query-bar' },
    h('span', { className: 'query-bar-ico' }, '⌕'),
    queryInput,
    h('button', { className: 'ghost query-bar-go', title: 'Fill the form from your query',
      onclick: () => {
        if (!queryInput.value.trim()) return;
        if (!state.formOpen) { state._pendingQuery = queryInput.value; state.formOpen = true; render(); return; }
        applyQuery(queryInput.value);
      } }, 'Go'),
  ));

  if (!state.formOpen) return card;

  const dsSel = h('select', {
    onchange: () => {
      state.current_dataset = state.datasets.find(d => d.id === dsSel.value);
      renderParams(kindSel.value);
    },
  },
    ...state.datasets.map(d => h('option', { value: d.id, selected: state.current_dataset?.id === d.id }, d.name)),
  );

  // Filter kinds by the family the user picked in the left rail (if any).
  const familyId = state._analysisFamily || 'all';
  const family = ANALYSIS_FAMILIES.find(f => f.id === familyId);
  const visibleKinds = family && family.kinds
    ? Object.entries(ANALYSIS_KINDS).filter(([k]) => family.kinds.includes(k))
    : Object.entries(ANALYSIS_KINDS);
  const kindSel = h('select', { onchange: () => renderParams(kindSel.value) },
    ...visibleKinds.map(([k, v]) =>
      h('option', { value: k, selected: state._chosenKind === k }, v.label)),
  );
  card.append(h('div', { className: 'row', style: 'flex-wrap:wrap;gap:10px' },
    h('label', { className: 'field', style: 'flex:1;min-width:160px;margin:0' }, 'Dataset', dsSel),
    h('label', { className: 'field', style: 'flex:1;min-width:160px;margin:0' }, 'Analysis', kindSel),
  ));
  const paramsHost = h('div', { id: 'param-host', style: 'margin-top:10px' });
  card.append(paramsHost);
  const status = h('span', { className: 'muted', style: 'margin-left:10px' });
  const runBtn = h('button', { className: 'primary',
    onclick: () => withLoading(runBtn, submit),
  }, 'Run');
  // Pre-flight host — populated when the user clicks "✓ Check assumptions".
  // Minitab's Assistant does this AFTER the analysis; Bench does it BEFORE
  // so the user picks the right test the first time.
  const preflightHost = h('div', { className: 'preflight-host',
    style: 'margin-top:12px;display:none' });
  card.append(preflightHost);

  card.append(h('div', { style: 'margin-top:12px' },
    runBtn,
    h('button', { className: 'ghost', style: 'margin-left:6px',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const dsId = state.current_dataset?.id;
        if (!dsId) return toast({ kind: 'error', msg: 'Pick a dataset first.' });
        btn.disabled = true;
        const prevText = btn.textContent; btn.textContent = 'Checking…';
        try {
          const params = collectParams();
          const r = await api.post('/api/analyses/preflight',
            { datasetId: dsId, kind: kindSel.value, params });
          renderPreflight(preflightHost, r, runBtn);
        } catch (err) {
          toast({ kind: 'error', msg: err.message || 'Pre-flight failed.' });
        }
        btn.disabled = false; btn.textContent = prevText;
      },
    }, '✓ Check assumptions'),
    h('button', { className: 'ghost', style: 'margin-left:6px',
      onclick: () => {
        const kind = kindSel.value;
        const ux = window.statsUx;
        // Resolve the most specific help: hypothesis tests carry their own
        // per-test blurb keyed by the selected `test` value; otherwise the
        // top-level kind. Always show something — never a silent no-op.
        let key = kind;
        if (kind === 'hypothesis_test') {
          const t = paramsHost.querySelector('[name="test"]');
          if (t && t.value) key = t.value;
        }
        const help = ux?.helpFor(key) || ux?.helpFor(kind) ||
          `${ANALYSIS_KINDS[kind]?.label || kind}. See Methods for the formula and assumptions, or the Learn section for a guided walkthrough.`;
        toast({ kind: 'info', title: ANALYSIS_KINDS[kind]?.label || kind,
          msg: help, duration: 9000 });
      },
    }, '? About this analysis'),
    status,
  ));

  function renderParams(kind) {
    paramsHost.innerHTML = '';
    const cols = state.current_dataset?.schema_json || [];
    const spec = ANALYSIS_KINDS[kind];
    if (!cols.length) {
      paramsHost.append(h('p', { className: 'muted' }, 'Dataset has no schema yet.'));
      return;
    }
    // Track which columns have already been auto-assigned so multi-slot
    // forms (e.g. Gauge R&R: measurement / part / operator) don't all
    // default to the same column. Each col-slot picks the first unused
    // candidate from its filtered pool.
    const usedCols = new Set();
    for (const p of spec.params) paramsHost.append(renderParam(kind, p, cols, usedCols));
    // Apply chosen-test prefill if any. Two paths:
    //   - sidebar route: state._chosenInnerParam names the form field directly
    //     (e.g. 'test', 'method', 'distribution', 'chart', 'kind').
    //   - TestChooser legacy route: writes 'test' or maps via ckMap → 'kind'.
    if (state._chosenInnerKind && kind === state._chosenKind) {
      const inner = state._chosenInnerKind;
      if (state._chosenInnerParam) {
        const el = paramsHost.querySelector(`[name="${state._chosenInnerParam}"]`);
        if (el && el.querySelector(`option[value="${inner}"]`)) el.value = inner;
      } else {
        const t = paramsHost.querySelector('[name=test]');
        if (t && t.querySelector(`option[value="${inner}"]`)) t.value = inner;
        const ck = paramsHost.querySelector('[name=kind]');
        const ckMap = { control_chart_imr: 'I-MR', control_chart_xbar_r: 'X-bar/R',
          control_chart_cusum: 'CUSUM', control_chart_ewma: 'EWMA',
          control_chart_p: 'p', control_chart_u: 'u' };
        if (ck && ckMap[inner]) ck.value = ckMap[inner];
      }
      state._chosenInnerKind = null;
      state._chosenInnerParam = null;
    }

    // Follow-up chip / pre-flight recommendation prefill. Walk every field
    // the chip set and write it into the matching form element. Consumed
    // once per render so a refresh doesn't keep re-applying stale params.
    if (state._prefillParams) {
      for (const [name, value] of Object.entries(state._prefillParams)) {
        const el = paramsHost.querySelector(`[name="${name}"]`);
        if (!el) continue;
        if (Array.isArray(value) && el.multiple) {
          for (const opt of el.options) opt.selected = value.includes(opt.value);
        } else if (typeof value === 'boolean') {
          el.value = String(value);
        } else if (value != null) {
          // For <select>, only set if the option actually exists; otherwise
          // leave the auto-pick alone.
          if (el.tagName === 'SELECT') {
            if (el.querySelector(`option[value="${String(value).replace(/"/g, '\\"')}"]`)) {
              el.value = String(value);
            }
          } else {
            el.value = String(value);
          }
        }
      }
      state._prefillParams = null;
    }
  }

  function renderParam(kind, spec, columns, usedCols) {
    const wrap = h('div', { className: 'param-row' });
    const human = (PARAM_LABELS[kind] && PARAM_LABELS[kind][spec.name]) || spec.name;
    const labelText = spec.optional ? `${human} ` : human;
    const helpIcon = window.statsUx?.renderParamHelpIcon(kind, spec.name);
    wrap.append(h('label', { className: 'param-label' },
      h('span', {}, labelText),
      spec.optional ? h('span', { className: 'param-optional' }, 'optional') : null,
      helpIcon));
    let input;
    if (spec.kind === 'col') {
      // Type-aware filtering:
      //   - numeric:true   → numeric only
      //   - CATEGORICAL_SLOTS (part_col, operator_col, group_col, …)
      //                    → prefer non-numeric, fall back to numeric if none
      //   - other          → all columns
      let filtered;
      if (spec.numeric) {
        filtered = columns.filter(c => c.type === 'number');
      } else if (CATEGORICAL_SLOTS.has(spec.name)) {
        const cats = columns.filter(c => c.type !== 'number');
        filtered = cats.length ? cats : columns;
      } else {
        filtered = columns;
      }
      // Pick a default that hasn't been used by an earlier slot in the same
      // form. Avoids the "all three dropdowns default to measurement_col" bug.
      let defaultName = filtered.find(c => !usedCols?.has(c.name))?.name
                     || (spec.optional ? '' : filtered[0]?.name || '');
      if (defaultName) usedCols?.add(defaultName);
      const opts = [];
      // Show a "Select column…" placeholder when:
      //   - the slot is optional, OR
      //   - the pool has only one candidate AND we're a non-first col slot
      //     (i.e. the only candidate is already taken — user must confirm)
      const onlyOneAvailable = filtered.length <= 1 && usedCols && usedCols.size > 1
                            && !filtered.some(c => c.name === defaultName);
      if (spec.optional || onlyOneAvailable) {
        opts.push(h('option', { value: '' }, 'Select column…'));
      }
      for (const c of filtered) {
        const o = h('option', { value: c.name }, `${humanize(c.name)} · ${c.type}`);
        if (c.name === defaultName) o.selected = true;
        opts.push(o);
      }
      input = h('select', { name: spec.name }, ...opts);
    } else if (spec.kind === 'cols') {
      input = h('select', { name: spec.name, multiple: true, size: Math.min(6, Math.max(3, columns.length)) },
        ...columns.map(c => h('option', { value: c.name }, `${humanize(c.name)} · ${c.type}`)));
    } else if (spec.kind === 'enum') {
      input = h('select', { name: spec.name },
        ...spec.options.map(o => h('option', { value: o }, o ? humanize(o) : '(none)')));
    } else if (spec.kind === 'bool') {
      input = h('select', { name: spec.name },
        h('option', { value: 'true', selected: spec.defaultValue === true ? 'selected' : null }, 'true'),
        h('option', { value: 'false', selected: spec.defaultValue === false ? 'selected' : null }, 'false'),
      );
    } else if (spec.kind === 'num') {
      input = h('input', { name: spec.name, type: 'number', step: 'any',
        value: spec.defaultValue ?? '', placeholder: spec.optional ? '(optional)' : '' });
    } else if (spec.kind === 'json') {
      input = h('textarea', { name: spec.name, rows: 4,
        placeholder: spec.help || 'Paste JSON value',
        style: 'font-family:var(--font-mono);font-size:12px' });
    } else if (spec.kind === 'string') {
      // Explicit string kind — surface spec.help as a visible hint and
      // give mixed-effects formulas a friendly monospace styling.
      input = h('input', { name: spec.name, type: 'text',
        placeholder: spec.help || (spec.optional ? '(optional)' : ''),
        style: 'font-family:var(--font-mono);font-size:12px' });
      if (spec.defaultValue != null) input.value = String(spec.defaultValue);
    } else {
      input = h('input', { name: spec.name, type: 'text',
        placeholder: spec.optional ? '(optional)' : '' });
    }
    wrap.append(input);
    // For mixed_effects: add a "Build formula" helper next to the `fixed`
    // field that opens a column-picker modal and writes the statsmodels
    // formula back into the input.
    if (kind === 'mixed_effects' && spec.name === 'fixed') {
      const helper = h('button', { type: 'button', className: 'ghost', style: 'font-size:11px;margin-top:4px',
        onclick: () => openMixedFormulaBuilder(input, columns),
      }, '🛠 Build formula');
      wrap.append(helper);
    }
    return wrap;
  }

  // Shared param collector — used by both submit() and pre-flight. Returns
  // {params, missing}; doesn't toast or short-circuit so the pre-flight
  // button can issue its own messaging.
  function collectParams() {
    const kind = kindSel.value;
    const params = {};
    paramsHost.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    const missing = [];
    let jsonError = false;
    for (const p of ANALYSIS_KINDS[kind].params) {
      const el = paramsHost.querySelector(`[name="${p.name}"]`);
      if (!el) continue;
      if (p.kind === 'cols') {
        const vals = Array.from(el.selectedOptions).map(o => o.value);
        if (vals.length) params[p.name] = vals;
        else if (!p.optional) { missing.push(p.name); el.classList.add('error'); }
      } else if (p.kind === 'bool') params[p.name] = el.value === 'true';
      else if (p.kind === 'num')   { if (el.value !== '') params[p.name] = Number(el.value); }
      else if (p.kind === 'col') {
        if (el.value) params[p.name] = el.value;
        else if (!p.optional) { missing.push(p.name); el.classList.add('error'); }
      }
      else if (p.kind === 'json') {
        if (el.value) {
          try { params[p.name] = JSON.parse(el.value); }
          catch (_) { el.classList.add('error'); jsonError = p.name; }
        } else if (!p.optional) { missing.push(p.name); el.classList.add('error'); }
      }
      else { if (el.value) params[p.name] = el.value; }
    }
    return { params, missing, jsonError };
  }

  async function submit() {
    const datasetId = dsSel.value;
    const kind = kindSel.value;
    const { params, missing, jsonError } = collectParams();
    if (jsonError) {
      toast({ kind: 'warn', msg: `Invalid JSON in "${jsonError}".` }); return;
    }
    if (missing.length) {
      toast({ kind: 'warn', title: 'Missing fields',
        msg: `Pick a column for: ${missing.join(', ')}.` });
      return;
    }
    try {
      status.textContent = 'Running…';
      await api.post('/api/analyses/run', { kind, datasetId, params });
      status.textContent = '';
      toast({ kind: 'success', msg: 'Analysis complete.' });
      await refreshData(); render();
    } catch {/* toasted */}
  }

  // Parse a plain-English query and fill the form. Hoisted; closes over
  // kindSel / renderParams / paramsHost which exist by the time it's called.
  function applyQuery(qstr) {
    const parsed = window.statsUx?.parseQuery(qstr);
    if (!parsed) { toast({ kind: 'warn', msg: "Couldn't parse that — try the form below, or ⌘K to search." }); return; }
    const kindMap = { capability: 'capability', control_chart: 'control_chart',
      hypothesis_test: 'hypothesis_test', pareto: 'pareto', msa: 'msa',
      regression: 'regression', reliability: 'reliability',
      distribution_id: 'distribution_id', kmeans: 'multivariate', pca: 'multivariate' };
    const target = kindMap[parsed.kind] || parsed.kind;
    if (!ANALYSIS_KINDS[target]) { toast({ kind: 'warn', msg: `"${parsed.kind}" isn't wired here yet — try ⌘K.` }); return; }
    kindSel.value = target;
    renderParams(target);
    setTimeout(() => {
      for (const [k, v] of Object.entries(parsed)) {
        if (k === 'kind') continue;
        const el = paramsHost.querySelector(`[name="${k === 'chart_kind' ? 'kind' : k}"]`);
        if (el) {
          if (Array.isArray(v) && el.multiple) Array.from(el.options).forEach(o => { o.selected = v.includes(o.value); });
          else el.value = v;
        }
      }
      toast({ kind: 'success', msg: 'Form filled from your query — review and click Run.' });
    }, 60);
  }

  renderParams(kindSel.value);

  // If the form was just opened by an Enter in the (collapsed) query bar,
  // apply the stashed query now that the params host exists.
  if (state._pendingQuery) {
    const q = state._pendingQuery; state._pendingQuery = null;
    setTimeout(() => applyQuery(q), 0);
  }
  return card;
}

function AnalyzeList() {
  const wrap = h('div');
  if (!state.analyses.length) {
    wrap.append(h('div', { className: 'empty' },
      h('div', { className: 'empty-mark' }, 'No results'),
      h('div', { className: 'empty-title' }, 'No analyses yet.'),
      h('div', { className: 'empty-desc' }, 'Run one above. Or use "Pick the right test" if you\'re not sure which.'),
    ));
    return wrap;
  }
  let pinned = new Set();
  let filterText = '';

  function refresh() {
    wrap.innerHTML = '';
    const filtered = window.statsUx?.filterAnalyses(state.analyses, filterText) || state.analyses;
    const head = h('div', { className: 'card-header', style: 'margin-bottom:8px' },
      h('h3', {}, 'Results'),
      h('span', { className: 'meta' }, `${filtered.length} of ${state.analyses.length}`),
      h('span', { className: 'spacer' }),
      window.statsUx?.renderAnalysesSearchBar((v) => { filterText = v; refresh(); }),
      h('button', { className: 'secondary', style: 'font-size:12px',
        disabled: pinned.size < 2,
        title: pinned.size < 2 ? 'Pin two or more analyses to compare them' : 'Compare pinned analyses side by side',
        onclick: () => {
          const sel = state.analyses.filter(a => pinned.has(a.id));
          if (sel.length >= 2) window.statsUx?.openComparator(sel);
        },
      }, pinned.size >= 2 ? `Compare (${pinned.size})` : 'Compare'));
    wrap.append(head);

    for (const a of filtered) wrap.append(renderAnalysisCard(a, pinned, refresh));
  }
  refresh();
  return wrap;
}

// Generic "Results" table built straight from the summary object. The result
// card only shows a metric strip / interpretation for kinds wired into the
// METRIC_PICKERS / INTERPRETERS maps (~10 of 35). Without this fallback, the
// other ~25 kinds (survey, variance_budget, delivery_forecast, multivariate,
// time_series, posthoc, tolerance, …) render a chart but NEVER display the
// numbers they computed. This guarantees every analysis shows its statistics.
function renderSummaryFallback(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const fmt = (v) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') {
      return window.statsUx?.fmtNum ? window.statsUx.fmtNum(v)
        : (Number.isInteger(v) ? String(v) : v.toFixed(4));
    }
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v);
  };
  // Skip noise: chart bytes, raw arrays we plot elsewhere, nested provenance.
  const SKIP = /(_png|_b64|chart|image|demo_values|provenance|annotations|storage_key)$/i;
  const rows = [];
  for (const [k, v] of Object.entries(summary)) {
    if (SKIP.test(k) || v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      if (v.every(x => typeof x !== 'object')) {
        rows.push([k, v.slice(0, 12).map(fmt).join(', ') + (v.length > 12 ? ` … (${v.length})` : '')]);
      } else {
        rows.push([k, `${v.length} rows`]);
      }
    } else if (typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) {
        if (SKIP.test(k2) || v2 === null || v2 === undefined || typeof v2 === 'object') continue;
        rows.push([`${k} · ${k2}`, fmt(v2)]);
      }
    } else {
      rows.push([k, fmt(v)]);
    }
  }
  if (!rows.length) return null;
  const humanize = (s) => s.replace(/_/g, ' ').replace(/(^|\s)\w/g, c => c.toUpperCase());
  return h('div', { className: 'summary-fallback' },
    h('div', { className: 'section-label', style: 'margin-bottom:8px' }, 'Results'),
    h('div', { className: 'summary-fallback-grid' },
      ...rows.map(([k, v]) => h('div', { className: 'sf-row' },
        h('span', { className: 'sf-key' }, humanize(k)),
        h('span', { className: 'sf-val' }, v)))));
}

function renderAnalysisCard(a, pinned, refreshFn) {
  // data-analysis-id lets the dashboard / follow-up navigation scroll to a
  // specific card after render. Set state._scrollToAnalysis to the id and
  // the next render() will smooth-scroll to it.
  const isScrollTarget = state._scrollToAnalysis === a.id;
  const card = h('div', {
    className: 'card' + (isScrollTarget ? ' highlight-flash' : ''),
    style: 'margin:0 0 10px',
    'data-analysis-id': a.id,
  });
  if (isScrollTarget) {
    // Defer to after layout so getBoundingClientRect is meaningful.
    requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.transition = 'background 1.2s ease-out';
      card.style.background = 'var(--accent-tint, rgba(197,165,114,0.18))';
      setTimeout(() => { card.style.background = ''; }, 1400);
    });
    state._scrollToAnalysis = null;
  }
  const summary = a.result_json?.summary;
  // Stale check — analysis was run against an older snapshot of the dataset.
  const linkedDs = a.dataset_id ? state.datasets.find(d => d.id === a.dataset_id) : null;
  const isStale = linkedDs && a.dataset_version != null
                  && linkedDs.version != null
                  && linkedDs.version > a.dataset_version;
  const headRow = h('div', { className: 'card-header' },
    h('h3', {}, ANALYSIS_KINDS[a.kind]?.label || a.kind),
    h('span', { className: 'meta' }, new Date(a.created_at * 1000).toLocaleString()),
    a.result_json?.recipe?.name
      ? h('span', { className: 'pill accent', style: 'margin-left:6px' }, a.result_json.recipe.name)
      : null,
    isStale ? h('span', { className: 'pill',
      style: 'margin-left:6px;background:#b08400;color:white;font-size:10px;letter-spacing:0.06em',
      title: `Dataset has new rows (v${linkedDs.version} vs v${a.dataset_version}). Click Refresh to re-run.` },
      'STALE') : null,
    isStale ? h('button', { className: 'toolbar-btn', style: 'margin-left:4px',
      title: 'Re-run this analysis against the current dataset',
      'aria-label': 'Refresh analysis against current dataset',
      onclick: async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true; const prev = btn.textContent; btn.textContent = '↻ refreshing…';
        try {
          await api.post(`/api/analyses/${a.id}/refresh`, {});
          toast({ kind: 'success', msg: 'Analysis refreshed.' });
          await refreshData(); render();
        } catch (err) {
          toast({ kind: 'error', msg: err.message || 'Refresh failed.' });
          btn.disabled = false; btn.textContent = prev;
        }
      },
    }, '↻ Refresh') : null,
    h('span', { className: 'spacer' }),
    h('button', { className: 'toolbar-btn', title: pinned.has(a.id) ? 'Unpin' : 'Pin for comparison',
      'aria-label': pinned.has(a.id) ? 'Unpin analysis' : 'Pin analysis for comparison',
      'aria-pressed': pinned.has(a.id) ? 'true' : 'false',
      onclick: () => { pinned.has(a.id) ? pinned.delete(a.id) : pinned.add(a.id); refreshFn(); },
    }, pinned.has(a.id) ? 'Pinned' : 'Pin'),
    h('button', { className: 'toolbar-btn', title: 'Save as recipe', 'aria-label': 'Save as reusable recipe',
      onclick: async () => {
        const name = prompt('Recipe name?');
        if (!name) return;
        await api.patch(`/api/analyses/${a.id}/recipe`, { name }).catch(() => {});
        toast({ kind: 'success', msg: `Saved as "${name}".` });
        await refreshData(); render();
      },
    }, 'Save'),
    // Primary action: turn the result into an LSS report.
    a._demo ? null : h('button', { className: 'toolbar-btn accent-tint',
      title: 'Make an LSS report from this analysis — Capability study, Gauge R&R write-up, Tollgate, A3, FMEA, more',
      'aria-label': 'Make a report from this analysis',
      onclick: (e) => { e.stopPropagation(); openMakeReportMenu(a, e.currentTarget); } }, '📝 Make Report'),
    // All download/copy actions collapsed into one menu (was 5 buttons).
    h('button', { className: 'toolbar-btn',
      title: 'Export & share — Copy, CSV, Excel, Bundle, Dossier',
      'aria-label': 'Export and share this analysis',
      onclick: (e) => { e.stopPropagation(); openExportMenu(a, e.currentTarget); } }, 'Export ▾'),
    // Governance: lock freezes the verified result (no re-run/delete) and is audited.
    a._demo ? null : h('button', { className: 'toolbar-btn' + (a.locked ? ' accent-tint' : ''),
      title: a.locked ? 'Locked — verified result is frozen. Click to unlock.' : 'Lock this result to prevent re-run/delete drift',
      'aria-label': a.locked ? 'Unlock analysis' : 'Lock analysis',
      'aria-pressed': a.locked ? 'true' : 'false',
      onclick: async () => {
        await api.post(`/api/analyses/${a.id}/lock`, { lock: !a.locked }).catch((e) => toast({ kind: 'error', msg: e.message }));
        await refreshData(); render();
        toast({ kind: 'success', msg: a.locked ? 'Analysis unlocked.' : 'Analysis locked — result frozen.' });
      },
    }, a.locked ? '🔒 Locked' : '🔓 Lock'),
    h('button', { className: 'toolbar-btn', title: 'Delete analysis',
      'aria-label': 'Delete analysis',
      onclick: async () => {
        if (!confirm('Delete this analysis?')) return;
        const r = await api.delete(`/api/analyses/${a.id}`).catch((e) => { toast({ kind: 'error', msg: e.message }); return null; });
        if (r) { await refreshData(); render(); }
      },
    }, 'Delete'),
  );
  card.append(headRow);

  card.append(h('div', { className: 'mono muted', style: 'font-size:11px;background:var(--surface);border:1px solid var(--line);padding:8px 12px;border-radius:3px;margin-bottom:14px;letter-spacing:0.02em' },
    Object.entries(a.params_json || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' · ')));

  // Decision-grade headline card — populated asynchronously via /api/analyses/narrative.
  // Renders immediately as a placeholder so the layout doesn't jump.
  const headline = h('div', { className: 'headline-card',
    style: 'background:var(--surface);border-left:3px solid var(--accent);padding:12px 16px;margin-bottom:14px;border-radius:2px' },
    h('div', { className: 'headline-text', style: 'font-family:var(--font-display, serif);font-size:15px;line-height:1.4;color:var(--ink)' }, ''),
    h('div', { className: 'headline-sub', style: 'font-size:12px;color:var(--muted);margin-top:4px;line-height:1.5' }, ''),
  );
  card.append(headline);
  // Apply a narrative payload (from cache or fresh fetch) to the headline DOM.
  const applyNarrative = (r) => {
    if (!r || !r.headline) { headline.remove(); return; }
    headline.querySelector('.headline-text').textContent = r.headline;
    if (r.subhead) headline.querySelector('.headline-sub').textContent = r.subhead;
    if (r.verdict) {
      const colour = r.verdict === 'act' ? 'var(--success, #2f7d3a)'
                   : r.verdict === 'caution' || r.verdict === 'underpowered' ? 'var(--danger, #b03a3a)'
                   : 'var(--accent)';
      headline.style.borderLeftColor = colour;
    }
  };
  // Cache on the analysis object so re-renders (search keystroke, pin toggle,
  // delete) don't re-POST for every card every time. `a` is replaced when the
  // analysis is refreshed, so the cache invalidates naturally.
  if (a._narrative !== undefined) {
    applyNarrative(a._narrative);
  } else {
    api.post('/api/analyses/narrative', { kind: a.kind, summary }).then(r => {
      a._narrative = r || null; applyNarrative(r);
    }).catch(() => { a._narrative = null; headline.remove(); });
  }

  // Metric strip — premium hairline row of headline numerics (capability,
  // hypothesis_test, regression, msa). Null for kinds without a canonical set.
  const strip = window.statsUx?.renderMetricStrip(a.kind, summary);
  if (strip) card.append(strip);

  // Plain-English interpretation (rule-based)
  const interp = window.statsUx?.renderInterpretation(a.kind, summary);
  if (interp) card.append(interp);

  // Generic numbers fallback — if no metric strip covers this kind, render the
  // computed statistics straight from the summary so the card is never just a
  // chart with no numbers. (Kinds WITH a strip already show headline numerics.)
  if (!strip) {
    const fb = renderSummaryFallback(summary);
    if (fb) card.append(fb);
  }

  // Annotations
  const ann = window.statsUx?.renderAnnotations(a.result_json?.annotations);
  if (ann) card.append(ann);

  // Chart
  if (a.chart_storage_key) {
    const img = h('img', { className: 'chart',
      src: `/artifact/${a.chart_storage_key}`,
      alt: `${ANALYSIS_KINDS[a.kind]?.label || a.kind} chart`,
      style: 'margin-bottom:8px;cursor:zoom-in' });
    img.addEventListener('click', async (e) => {
      if (!e.shiftKey) return;
      e.stopPropagation();
      const note = prompt('Annotation:'); if (!note) return;
      await api.patch(`/api/analyses/${a.id}/annotation`, { note }).catch(() => {});
      toast({ kind: 'success', msg: 'Annotation added.' });
      await refreshData(); render();
    });
    card.append(img);
    card.append(h('div', { className: 'muted', style: 'font-size:11px;margin-bottom:8px' },
      'Tip: click chart to zoom · ', h('kbd', {}, 'shift'), '+click to annotate.'));
  } else if (a.result_json?.demo_values && window.statsUx?.svgHistogram) {
    // Demo/sidecar-offline fallback: render an inline SVG histogram with spec
    // lines so the result card still has a chart.
    const s = a.result_json.summary || {};
    const chartWrap = h('div', {
      style: 'background:var(--surface);border:1px solid var(--line);padding:14px 18px;margin-bottom:14px;box-shadow:var(--shadow-sm)',
    });
    chartWrap.append(h('div', {
      style: 'font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.22em;margin-bottom:10px',
    }, 'Distribution vs. Specification'));
    chartWrap.append(window.statsUx.svgHistogram(a.result_json.demo_values, {
      width: 760, height: 220, lsl: s.lsl, usl: s.usl,
    }));
    card.append(chartWrap);
  }

  // Auto-follow-up chips — what the user should run NEXT given this result.
  // Lazy-loaded so the result card paints first.
  const fuHost = h('div', { className: 'followups', style: 'margin:8px 0 14px;display:none' });
  card.append(fuHost);
  const applyFollowups = (items) => {
    if (!items || !items.length) return;
    fuHost.style.display = 'block';
    fuHost.append(h('div', { style: 'font-size:10px;letter-spacing:0.16em;color:var(--muted);text-transform:uppercase;margin-bottom:6px' },
      'Suggested follow-ups'));
    const chipRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' });
    const colorOf = (pri) => pri === 'high' ? 'var(--accent)' : pri === 'medium' ? 'var(--ink-2)' : 'var(--muted)';
    for (const f of items) {
      // Priority is signalled by colour AND a leading dot glyph so it's not
      // colour-only (colour-blind / greyscale accessible).
      const priMark = f.priority === 'high' ? '●' : f.priority === 'medium' ? '◐' : '○';
      const chip = h('button', {
        className: 'chip',
        style: `font-size:11px;padding:5px 10px;border:1px solid ${colorOf(f.priority)};
                background:transparent;color:${colorOf(f.priority)};cursor:pointer;
                border-radius:99px;line-height:1.3;text-align:left`,
        title: `${f.priority || 'low'} priority — ${f.reason || ''}`,
        'aria-label': `Follow-up (${f.priority || 'low'} priority): ${f.label}`,
        onclick: () => {
          // Navigate to the follow-up analysis, pre-filling params via the
          // centralised navigate() so target.params is the canonical path.
          navigate({ kind: f.kind, params: f.params || {} });
          toast({ kind: 'info', msg: f.reason || `Opening ${f.label}` });
        },
      }, `${priMark} ${f.label}`);
      chipRow.append(chip);
    }
    fuHost.append(chipRow);
  };
  // Cache followups on the analysis object — same reasoning as narrative.
  if (a._followups !== undefined) {
    applyFollowups(a._followups);
  } else {
    api.post('/api/analyses/followups', {
      kind: a.kind, summary, request: a.params_json || {},
    }).then(r => {
      a._followups = (r && r.followups) || [];
      applyFollowups(a._followups);
    }).catch(() => { a._followups = []; });
  }

  // Reproducibility quartet — Bench's audit-trail differentiator vs Minitab.
  if (a.result_json?.provenance) {
    const p = a.result_json.provenance;
    const short = (s) => s ? s.slice(0, 12) + '…' : '—';
    const prov = h('details', { className: 'provenance' },
      h('summary', {}, h('span', { className: 'section-label' }, 'Reproducibility')),
      h('div', { className: 'provenance-grid' },
        h('div', {}, h('label', {}, 'Software'),    h('code', {}, p.software_version || '—')),
        h('div', {}, h('label', {}, 'Data hash'),   h('code', { title: p.data_hash || '' },   short(p.data_hash))),
        h('div', {}, h('label', {}, 'Params hash'), h('code', { title: p.params_hash || '' }, short(p.params_hash))),
        h('div', {}, h('label', {}, 'Result hash'), h('code', { title: p.result_hash || '' }, short(p.result_hash))),
        h('div', {}, h('label', {}, 'Computed at'), h('code', {}, p.computed_at || '—')),
      ),
      h('div', { className: 'provenance-note' },
        'Re-run on the same data → identical hashes. Closed-source tools can’t prove this.'),
    );
    card.append(prov);
  }

  // Free-tier action plan
  const action = window.statsUx?.renderActionPlanFree(a.kind, summary);
  if (action) card.append(action);

  // Next-steps
  const next = window.statsUx?.renderNextSteps(a.kind, summary, async (suggestion) => {
    if (!suggestion?.kind || !ANALYSIS_KINDS[suggestion.kind]) return;
    state._chosenKind = suggestion.kind;
    state.view = 'analyze';
    render();
    setTimeout(() => {
      for (const [k, v] of Object.entries(suggestion.params || {})) {
        const el = document.querySelector(`#param-host [name="${k}"]`);
        if (el) el.value = v;
      }
    }, 100);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  if (next) card.append(next);

  // Cross-link footer: send the user from a finished result back to context
  // (the guide explaining this analysis, the method/citation page).
  const guideId = KIND_TO_GUIDE[a.kind];
  const methodAnchor = KIND_TO_METHOD_ANCHOR[a.kind];
  if (guideId || methodAnchor) {
    const links = h('div', { className: 'result-crosslinks' });
    links.append(h('span', { className: 'crosslink-label' }, 'Learn more'));
    if (guideId) {
      const g = GUIDES.find(x => x.id === guideId);
      links.append(h('a', { 'data-nav-guide': guideId, href: '#' },
        `Guide: ${g ? g.title : guideId}`));
    }
    if (methodAnchor) {
      links.append(h('a', { 'data-nav-methods': methodAnchor, href: '#' },
        'Method provenance'));
    }
    links.append(h('a', { 'data-nav-kind': a.kind, href: '#' }, 'Run again'));
    card.append(links);
  }
  return card;
}

// ────────────────── TOOLS VIEW ──────────────────

function PowerCurveCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Power & Sample-Size Curve'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'Plots statistical power against sample size for a range of effect sizes — so you can see the diminishing-returns knee and defend your n.'));
  const kind = h('select', { className: 'fb-input' },
    ...['two_sample_t', 'one_sample_t', 'two_proportions', 'anova'].map(k =>
      h('option', { value: k }, k.replace(/_/g, ' '))));
  const es = h('input', { type: 'number', step: '0.05', value: 0.5 });
  const k_groups = h('input', { type: 'number', value: 3 });
  const alpha = h('input', { type: 'number', step: '0.01', value: 0.05 });
  const power = h('input', { type: 'number', step: '0.05', value: 0.8 });
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px;line-height:1.6' });
  const chart = h('div', { style: 'margin-top:12px' });
  const btn = h('button', { className: 'primary',
    onclick: () => withLoading(btn, async () => {
      const r = await api.post('/api/tools/power-curve', {
        kind: kind.value, effect_size: Number(es.value),
        k_groups: Number(k_groups.value), alpha: Number(alpha.value),
        power: Number(power.value),
      });
      const s = r.summary || r;
      result.innerHTML = `Required <strong>n = ${s.n_required}</strong>` +
        `${s.kind?.includes('two') || s.kind === 'anova' ? ' per group' : ''} ` +
        `for ${(s.power_target * 100).toFixed(0)}% power at ${s.effect_label}=${s.effect_size?.toFixed?.(3)}, α=${s.alpha}.`;
      chart.innerHTML = '';
      if (r.chart_storage_key) {
        chart.append(h('img', { src: `/artifact/${r.chart_storage_key}`,
          alt: 'Power vs. sample size curve', style: 'max-width:100%;border-radius:6px' }));
      }
    })}, 'Plot power curve');
  card.append(h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:flex-end' },
    h('label', { className: 'field' }, 'Test', kind),
    h('label', { className: 'field' }, 'Effect size', es),
    h('label', { className: 'field' }, 'Groups (ANOVA)', k_groups),
    h('label', { className: 'field' }, 'α', alpha),
    h('label', { className: 'field' }, 'Target power', power),
  ), btn, result, chart);
  return card;
}

function DoePowerCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'DOE Power'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'Power to detect a factor effect in a two-level factorial, given run count, replicates, and the standardized effect size (effect ÷ σ).'));
  const n_runs = h('input', { type: 'number', value: 8 });
  const n_factors = h('input', { type: 'number', value: 3 });
  const es = h('input', { type: 'number', step: '0.25', value: 1.0 });
  const reps = h('input', { type: 'number', value: 1 });
  const model = h('select', { className: 'fb-input' },
    ...['interaction', 'linear', 'quadratic'].map(m => h('option', { value: m }, m)));
  const alpha = h('input', { type: 'number', step: '0.01', value: 0.05 });
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px;line-height:1.6' });
  const btn = h('button', { className: 'primary',
    onclick: () => withLoading(btn, async () => {
      const r = await api.post('/api/tools/doe-power', {
        n_runs: Number(n_runs.value), n_factors: Number(n_factors.value),
        effect_size: Number(es.value), n_replicates: Number(reps.value),
        model: model.value, alpha: Number(alpha.value),
      });
      const s = r.summary || r;
      result.innerHTML = `Power = <strong>${(s.power * 100).toFixed(1)}%</strong> ` +
        `(N=${s.N_total} runs, ${s.df} residual df). ` +
        `<span class="muted">${s.adequate ? 'Adequate (≥80%).' : 'Below 80% — add runs or replicates.'}</span>`;
    })}, 'Compute power');
  card.append(h('div', { className: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:flex-end' },
    h('label', { className: 'field' }, 'Base runs', n_runs),
    h('label', { className: 'field' }, 'Factors', n_factors),
    h('label', { className: 'field' }, 'Effect size', es),
    h('label', { className: 'field' }, 'Replicates', reps),
    h('label', { className: 'field' }, 'Model', model),
    h('label', { className: 'field' }, 'α', alpha),
  ), btn, result);
  return card;
}

function MonteCarloCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Monte-Carlo Simulation'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'Predict an output’s distribution and capability before you build it. Model each input’s variation, propagate it through a transfer function, and see which inputs drive the spread.'));
  // mutable inputs model
  const inputs = [{ name: 'a', mean: 10, sd: 1 }, { name: 'b', mean: 5, sd: 1 }];
  const rowsBox = h('div');
  const renderRows = () => {
    rowsBox.innerHTML = '';
    inputs.forEach((inp, i) => {
      const row = h('div', { className: 'row', style: 'gap:6px;margin-bottom:5px;align-items:center' },
        h('input', { value: inp.name, placeholder: 'name', style: 'width:80px',
          oninput: e => inp.name = e.target.value }),
        h('span', { className: 'muted', style: 'font-size:11px' }, 'N( μ'),
        h('input', { type: 'number', value: inp.mean, step: 'any', style: 'width:70px',
          oninput: e => inp.mean = Number(e.target.value) }),
        h('span', { className: 'muted', style: 'font-size:11px' }, 'σ'),
        h('input', { type: 'number', value: inp.sd, step: 'any', style: 'width:60px',
          oninput: e => inp.sd = Number(e.target.value) }),
        h('span', { className: 'muted', style: 'font-size:11px' }, ')'),
        h('button', { className: 'ghost', style: 'font-size:11px',
          onclick: () => { inputs.splice(i, 1); renderRows(); } }, '×'));
      rowsBox.append(row);
    });
  };
  renderRows();
  const addBtn = h('button', { className: 'ghost', style: 'font-size:12px',
    onclick: () => { inputs.push({ name: 'x' + (inputs.length + 1), mean: 0, sd: 1 }); renderRows(); } }, '+ input');
  const transferSel = h('select', { className: 'fb-input', style: 'width:160px' },
    ...['sum', 'linear', 'formula'].map(t => h('option', { value: t }, t)));
  const formulaInput = h('input', { placeholder: 'e.g. sqrt(a*a + b*b)', style: 'width:220px;display:none' });
  transferSel.addEventListener('change', () => { formulaInput.style.display = transferSel.value === 'formula' ? '' : 'none'; });
  const lsl = h('input', { type: 'number', step: 'any', value: 10, style: 'width:70px' });
  const usl = h('input', { type: 'number', step: 'any', value: 20, style: 'width:70px' });
  const result = h('div', { style: 'margin-top:10px' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const payload = {
      inputs: inputs.map(i => ({ name: i.name, dist: 'normal', params: { mean: i.mean, sd: i.sd } })),
      transfer: transferSel.value === 'formula' ? { type: 'formula', expr: formulaInput.value }
              : transferSel.value === 'linear' ? { type: 'linear', coeffs: Object.fromEntries(inputs.map(i => [i.name, 1])) }
              : { type: 'sum' },
      lsl: Number(lsl.value), usl: Number(usl.value), n_runs: 50000,
    };
    const r = await api.post('/api/tools/monte-carlo', payload);
    const s = r.summary || r;
    result.innerHTML = '';
    const cap = s.capability;
    result.append(h('p', { className: 'muted', style: 'font-size:13px' },
      `Predicted output: mean ${s.mean?.toFixed?.(3)}, σ ${s.sd?.toFixed?.(3)}` +
      (cap && cap.cpk != null ? ` · Cpk ${cap.cpk.toFixed(2)} · ${Math.round(cap.predicted_dpmo).toLocaleString()} DPMO predicted` : '')));
    const tbl = h('table', { className: 'table' });
    tbl.append(h('thead', {}, h('tr', {}, h('th', {}, 'Input'), h('th', { style: 'text-align:right' }, '% of output variance'))));
    const tb = h('tbody');
    for (const c of (s.sensitivity || [])) tb.append(h('tr', {}, h('td', {}, c.name), h('td', { className: 'mono', style: 'text-align:right' }, c.contribution_pct?.toFixed?.(1) + '%')));
    tbl.append(tb); result.append(tbl);
    if (r.chart_storage_key) result.append(h('img', { src: `/artifact/${r.chart_storage_key}`, alt: 'Predicted output distribution', style: 'max-width:100%;border-radius:6px;margin-top:10px' }));
  }) }, 'Simulate');
  card.append(h('div', { className: 'section-label' }, 'Inputs'), rowsBox, addBtn,
    h('div', { className: 'row', style: 'gap:10px;margin:12px 0;align-items:center;flex-wrap:wrap' },
      h('label', { className: 'field', style: 'margin:0' }, 'Transfer', transferSel), formulaInput,
      h('label', { className: 'field', style: 'margin:0' }, 'LSL', lsl),
      h('label', { className: 'field', style: 'margin:0' }, 'USL', usl)),
    btn, result);
  return card;
}

function ToleranceStackCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, 'Tolerance Stack-Up'),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'Worst-case and RSS (statistical) tolerance stack for a linear assembly. Shows which component tolerance dominates the stack.'));
  const comps = [{ name: 'A', nominal: 10, tol: 0.1, coeff: 1 }, { name: 'B', nominal: 20, tol: 0.1, coeff: 1 }];
  const rowsBox = h('div');
  const renderRows = () => {
    rowsBox.innerHTML = '';
    comps.forEach((c, i) => rowsBox.append(h('div', { className: 'row', style: 'gap:6px;margin-bottom:5px;align-items:center' },
      h('input', { value: c.name, style: 'width:70px', oninput: e => c.name = e.target.value }),
      h('span', { className: 'muted', style: 'font-size:11px' }, 'nom'),
      h('input', { type: 'number', value: c.nominal, step: 'any', style: 'width:70px', oninput: e => c.nominal = Number(e.target.value) }),
      h('span', { className: 'muted', style: 'font-size:11px' }, '±tol'),
      h('input', { type: 'number', value: c.tol, step: 'any', style: 'width:60px', oninput: e => c.tol = Number(e.target.value) }),
      h('span', { className: 'muted', style: 'font-size:11px' }, '×coeff'),
      h('input', { type: 'number', value: c.coeff, step: 'any', style: 'width:55px', oninput: e => c.coeff = Number(e.target.value) }),
      h('button', { className: 'ghost', style: 'font-size:11px', onclick: () => { comps.splice(i, 1); renderRows(); } }, '×'))));
  };
  renderRows();
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px;line-height:1.7' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const r = await api.post('/api/tools/tolerance-stack', { inputs: comps });
    const s = r.summary || r;
    result.innerHTML = `Assembly nominal <strong>${s.assembly_nominal}</strong><br>` +
      `Worst-case: ±${s.worst_case_tol?.toFixed?.(4)} → [${s.worst_case_interval?.[0]?.toFixed?.(3)}, ${s.worst_case_interval?.[1]?.toFixed?.(3)}]<br>` +
      `RSS (statistical): ±${s.rss_tol?.toFixed?.(4)} → [${s.rss_interval?.[0]?.toFixed?.(3)}, ${s.rss_interval?.[1]?.toFixed?.(3)}]<br>` +
      `<span class="muted">Dominant component: <strong>${s.components?.[0]?.name}</strong> (${s.components?.[0]?.rss_share_pct?.toFixed?.(0)}% of the RSS stack)</span>`;
  }) }, 'Compute stack');
  card.append(h('div', { className: 'section-label' }, 'Components'), rowsBox,
    h('button', { className: 'ghost', style: 'font-size:12px', onclick: () => { comps.push({ name: 'C', nominal: 0, tol: 0.1, coeff: 1 }); renderRows(); } }, '+ component'),
    h('div', { style: 'margin-top:10px' }, btn), result);
  return card;
}

function LittlesLawCalc() {
  const card = h('div', { className: 'card' });
  card.append(h('h3', {}, "Little's Law"),
    h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      'WIP = throughput × cycle time. Enter any two; leave the third blank to solve for it. The fundamental flow equation.'));
  const wip = h('input', { type: 'number', step: 'any', placeholder: 'items', style: 'width:90px' });
  const tp = h('input', { type: 'number', step: 'any', placeholder: 'items/period', style: 'width:90px' });
  const ct = h('input', { type: 'number', step: 'any', placeholder: 'periods', style: 'width:90px' });
  const result = h('div', { className: 'muted', style: 'margin-top:10px;font-size:13px' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const body = {};
    if (wip.value !== '') body.wip = Number(wip.value);
    if (tp.value !== '') body.throughput = Number(tp.value);
    if (ct.value !== '') body.cycle_time = Number(ct.value);
    const r = await api.post('/api/tools/littles-law', body);
    const s = r.summary || r;
    result.innerHTML = `<strong>${s.headline}</strong><br><span class="muted">Solved for ${s.solved_for}. ${s.note}</span>`;
  }) }, 'Solve');
  card.append(h('div', { className: 'row', style: 'gap:12px;align-items:flex-end;flex-wrap:wrap' },
    h('label', { className: 'field', style: 'margin:0' }, 'WIP', wip),
    h('label', { className: 'field', style: 'margin:0' }, 'Throughput', tp),
    h('label', { className: 'field', style: 'margin:0' }, 'Cycle time', ct)), btn, result);
  return card;
}

