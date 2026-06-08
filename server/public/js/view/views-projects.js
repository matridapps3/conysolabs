const DMAIC_PHASES = ['define', 'measure', 'analyze', 'improve', 'control'];
const PHASE_LABEL = {
  define: 'Define', measure: 'Measure', analyze: 'Analyze',
  improve: 'Improve', control: 'Control',
};

function ProjectsView() {
  const root = h('div');
  root.append(
    h('div', { className: 'breadcrumb' }, 'Workspace · Projects'),
    h('div', { className: 'row between', style: 'align-items:baseline' },
      h('h2', {}, 'DMAIC projects',
        h('span', { className: 'muted' }, ` · ${(state.projects || []).length}`)),
      h('button', { className: 'primary',
        onclick: async () => {
          const name = prompt('Project name?');
          if (!name) return;
          const r = await api.post('/api/projects', { name });
          await refreshData();
          state.view = 'project'; state._projectId = r.project.id; render();
        },
      }, 'New project'),
    ),
  );
  if (!(state.projects || []).length) {
    root.append(h('div', { className: 'empty', style: 'margin-top:18px' },
      h('div', { className: 'empty-title' }, 'No projects yet'),
      h('div', { className: 'empty-desc' },
        'A project bundles a DMAIC effort: a checklist for each phase plus the analyses you ran to support it. Lightweight project management without the SKU upgrade.'),
    ));
    return root;
  }
  const grid = h('div', { className: 'tool-index', style: 'margin-top:18px' });
  for (const p of state.projects) {
    const phaseIx = DMAIC_PHASES.indexOf(p.current_phase);
    grid.append(h('a', { className: 'tool-card', href: '#',
      onclick: (e) => { e.preventDefault(); state.view = 'project'; state._projectId = p.id; render(); },
    },
      h('div', { className: 'tool-eyebrow' }, 'DMAIC project'),
      h('div', { className: 'tool-title' }, p.name),
      h('div', { className: 'project-progress' },
        ...DMAIC_PHASES.map((ph, i) =>
          h('span', { className: 'project-phase-pip' + (i <= phaseIx ? ' on' : '') }, PHASE_LABEL[ph][0])),
      ),
      h('div', { className: 'tool-desc' },
        p.description || h('span', { className: 'muted' }, '(no description)')),
      h('div', { className: 'tool-go' }, `${PHASE_LABEL[p.current_phase]} →`),
    ));
  }
  root.append(grid);
  return root;
}

// ── DMAIC Copilot panel: live, data-aware recommendations + tollgate verdict.
// The recommendation brain lives in the sidecar; this renders its output and
// wires each suggestion to a one-click, params-prefilled launch.
const _PRIO = {
  blocker: { label: 'Blocker', color: '#c0504d', bg: 'rgba(192,80,77,0.12)' },
  high:    { label: 'High',    color: '#c9a24b', bg: 'rgba(201,162,75,0.12)' },
  medium:  { label: 'Medium',  color: '#3a7ca5', bg: 'rgba(58,124,165,0.12)' },
  low:     { label: 'Optional',color: '#7a7a7a', bg: 'rgba(127,127,127,0.10)' },
};

function renderCopilotPanel(p, ph) {
  const panel = h('div', { className: 'phase-block copilot-panel' });
  const key = `${p.id}:${ph}:${p.updated_at || 0}`;
  if (!state._reco || state._reco.key !== key) {
    state._reco = { key, loading: true };
    api.post(`/api/projects/${p.id}/recommend`, { phase: ph })
      .then(r => { if (state._reco && state._reco.key === key) { state._reco = { key, data: r.summary }; render(); } })
      .catch(e => { if (state._reco && state._reco.key === key) { state._reco = { key, error: e.message || 'failed' }; render(); } });
  }
  panel.append(h('div', { className: 'row', style: 'align-items:center;gap:8px;margin-bottom:8px' },
    h('div', { className: 'section-label', style: 'margin:0' }, '◆ Copilot — what to do next'),
    h('span', { className: 'muted', style: 'font-size:11px' }, 'deterministic · reads your results')));

  const reco = state._reco;
  if (!reco || reco.loading) { panel.append(skeleton({ lines: 2, block: 1 })); return panel; }
  if (reco.error) { panel.append(h('p', { className: 'muted' }, `Couldn't load recommendations: ${reco.error}`)); return panel; }
  const s = reco.data || {};
  const recs = Array.isArray(s.recommendations) ? s.recommendations : [];

  // Tollgate verdict banner.
  const g = s.gate || {};
  const ready = g.ready;
  panel.append(h('div', { style: `border-left:3px solid ${ready ? '#5a8f69' : '#c0504d'};background:${ready ? 'rgba(90,143,105,0.10)' : 'rgba(192,80,77,0.08)'};border-radius:6px;padding:10px 12px;margin-bottom:12px` },
    h('div', { style: 'font-weight:600;font-size:13px' }, `${ready ? '✓' : '⛔'} ${PHASE_LABEL[ph]} tollgate: ${ready ? 'ready to advance' : 'not ready'}`),
    h('div', { className: 'muted', style: 'font-size:12px;margin-top:3px' }, g.verdict || ''),
    (g.missing_artifacts && g.missing_artifacts.length)
      ? h('div', { className: 'muted', style: 'font-size:11.5px;margin-top:4px' }, 'Missing: ' + g.missing_artifacts.join('; ')) : null));

  // Ranked recommendation cards.
  if (!recs.length) {
    panel.append(h('p', { className: 'muted', style: 'font-size:12.5px' }, 'No outstanding recommendations for this phase — nice work.'));
  }
  for (const rec of recs) {
    const pr = _PRIO[rec.priority] || _PRIO.low;
    const card = h('div', { style: 'border:1px solid var(--line);border-radius:7px;padding:11px 13px;margin-bottom:8px' });
    card.append(h('div', { className: 'row', style: 'align-items:center;gap:8px;margin-bottom:3px' },
      h('span', { style: `font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${pr.color};background:${pr.bg};padding:2px 7px;border-radius:4px` }, pr.label),
      h('span', { style: 'font-weight:600;font-size:13.5px' }, rec.title)));
    card.append(h('div', { className: 'muted', style: 'font-size:12.5px;line-height:1.5;margin-bottom:8px' }, rec.rationale));
    const actions = h('div', { className: 'row', style: 'gap:8px;align-items:center' });
    if (rec.action) {
      actions.append(h('button', { className: 'primary', style: 'font-size:12px;padding:5px 12px',
        onclick: () => navigate(rec.action) }, 'Run this →'));
    }
    if (rec.based_on && rec.based_on.length) {
      actions.append(h('span', { className: 'muted', style: 'font-size:11px' },
        `based on ${rec.based_on.length} prior result${rec.based_on.length > 1 ? 's' : ''}`));
    }
    card.append(actions);
    panel.append(card);
  }

  // Phase advance / tollgate sign-off.
  const ix = DMAIC_PHASES.indexOf(ph);
  if (ix < DMAIC_PHASES.length - 1) {
    const next = DMAIC_PHASES[ix + 1];
    panel.append(h('button', {
      className: ready ? 'primary' : 'ghost',
      style: 'margin-top:6px',
      onclick: async () => {
        if (!ready && !confirm(`The ${PHASE_LABEL[ph]} tollgate isn't met (blockers or missing artifacts remain). Advance to ${PHASE_LABEL[next]} anyway?`)) return;
        await api.patch(`/api/projects/${p.id}`, { current_phase: next });
        await refreshData(); state._reco = null; render();
        toast({ kind: 'success', msg: `Advanced to ${PHASE_LABEL[next]}.` });
      },
    }, ready ? `✓ Pass tollgate → ${PHASE_LABEL[next]}` : `Advance to ${PHASE_LABEL[next]} →`));
  }
  return panel;
}

// One-page A3 / project charter — the classic LSS storyboard, auto-populated
// from the project's attached analyses per phase. Opens a styled, printable
// page (Cmd-P → Save as PDF). No backend round-trip.
function generateA3(p) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const analysesFor = (ph) => ((p.phase_data?.[ph]?.analysis_ids) || [])
    .map(id => (state.analyses || []).find(a => a.id === id)).filter(Boolean);
  const lineFor = (a) => {
    const label = ANALYSIS_KINDS[a.kind]?.label || a.kind;
    const s = a.result_json?.summary || {};
    let metric = '';
    if (s.cpk != null) metric = `Cpk ${(+s.cpk).toFixed(2)}`;
    else if (s.p != null) metric = `p ${(+s.p).toFixed(3)}`;
    else if (s.total_grr_pct != null) metric = `%GR&R ${(+s.total_grr_pct).toFixed(0)}`;
    else if (s.r2 != null) metric = `R² ${(+s.r2).toFixed(2)}`;
    const head = (a.result_json?.headline?.verdict) || (a.narrative_md || '').split('\n')[0] || '';
    return `<li><b>${esc(label)}</b>${metric ? ` — ${esc(metric)}` : ''}${head ? `<br><span class="muted">${esc(head).slice(0, 140)}</span>` : ''}</li>`;
  };
  const box = (title, ph, fallback) => {
    const items = analysesFor(ph);
    const body = items.length ? `<ul>${items.map(lineFor).join('')}</ul>`
      : `<p class="muted">${fallback}</p>`;
    const notes = p.phase_data?.[ph]?.notes;
    return `<section><h2>${title}</h2>${notes ? `<p>${esc(notes)}</p>` : ''}${body}</section>`;
  };
  const html = `<!doctype html><meta charset="utf-8"><title>A3 — ${esc(p.name)}</title>
  <style>
    body{font:13px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:1100px;margin:32px auto;padding:0 28px}
    h1{font-size:22px;margin:0 0 2px} .sub{color:#666;margin:0 0 18px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    section{border:1px solid #ddd;border-radius:8px;padding:12px 14px}
    section h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#b5942f;margin:0 0 6px}
    ul{margin:4px 0 0;padding-left:18px} li{margin-bottom:5px} .muted{color:#777}
    .full{grid-column:1 / -1}
    @media print{body{margin:0}}
  </style>
  <h1>${esc(p.name)}</h1>
  <p class="sub">DMAIC A3 · current phase: ${esc(PHASE_LABEL[p.current_phase] || p.current_phase)} · generated by Conyso Bench</p>
  ${p.description ? `<section class="full"><h2>Problem / Background</h2><p>${esc(p.description)}</p></section><div style="height:14px"></div>` : ''}
  <div class="grid">
    ${box('Define', 'define', 'No Define-phase analyses linked.')}
    ${box('Measure — baseline', 'measure', 'No baseline measurement linked.')}
    ${box('Analyze — root cause', 'analyze', 'No analysis linked.')}
    ${box('Improve — countermeasures', 'improve', 'No improvement experiment linked.')}
    ${box('Control — sustain', 'control', 'No control plan linked.')}
    <section><h2>Provenance</h2><p class="muted">Every linked analysis carries a reproducibility hash (data · params · result). Re-running on the same data yields identical hashes.</p></section>
  </div>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
  else toast({ kind: 'error', msg: 'Pop-up blocked — allow pop-ups to export the A3.' });
}

function ProjectView() {
  const root = h('div');
  const p = (state.projects || []).find(x => x.id === state._projectId);
  if (!p) {
    root.append(h('div', { className: 'empty' },
      h('div', { className: 'empty-title' }, 'Project not found'),
      h('button', { className: 'secondary',
        onclick: () => { state.view = 'projects'; render(); } }, 'Back to projects'),
    ));
    return root;
  }
  root.append(
    h('div', { className: 'breadcrumb' },
      h('a', { href: '#',
        onclick: (e) => { e.preventDefault(); state.view = 'projects'; render(); },
        style: 'color:var(--muted);text-decoration:none',
      }, 'Projects'),
      ' · ', p.name),
    h('div', { className: 'row', style: 'align-items:center;gap:12px' },
      h('h2', { style: 'margin:0' }, p.name),
      h('span', { style: 'flex:1' }),
      h('button', { className: 'ghost', title: 'Export a one-page A3 storyboard (printable / PDF)',
        onclick: () => generateA3(p) }, '📄 Export A3')),
    p.description ? h('p', { style: 'color:var(--muted);max-width:62ch;margin:6px 0 22px' }, p.description) : null,
  );

  // Phase tabs
  const tabs = h('div', { className: 'phase-tabs' });
  for (const ph of DMAIC_PHASES) {
    const active = p.current_phase === ph;
    tabs.append(h('button', {
      className: 'phase-tab' + (active ? ' active' : ''),
      onclick: async () => {
        await api.patch(`/api/projects/${p.id}`, { current_phase: ph });
        await refreshData(); render();
      },
    }, PHASE_LABEL[ph]));
  }
  root.append(tabs);

  const ph = p.current_phase;
  const data = p.phase_data?.[ph] || { checklist: [], analysis_ids: [], notes: '' };

  // ── Copilot recommendation panel (the star of the project view) ──
  root.append(renderCopilotPanel(p, ph));

  // Checklist
  // Suggested analyses for this phase — one-click launches into the right
  // tool/form. Pinned analyses sit just below; users can attach the result.
  const suggestions = PHASE_SUGGESTIONS[ph] || [];
  if (suggestions.length) {
    const sug = h('div', { className: 'phase-block' });
    sug.append(h('div', { className: 'section-label' }, `Recommended for ${PHASE_LABEL[ph]}`));
    const pills = h('div', { className: 'phase-suggestions' });
    for (const s of suggestions) {
      pills.append(h('button', {
        className: 'phase-suggestion',
        onclick: () => navigate(s.target),
      }, s.label));
    }
    sug.append(pills);
    root.append(sug);
  }

  const list = h('div', { className: 'phase-block' });
  list.append(h('div', { className: 'section-label' }, `${PHASE_LABEL[ph]} · checklist`));
  for (let i = 0; i < data.checklist.length; i++) {
    const item = data.checklist[i];
    const row = h('label', { className: 'check-row' });
    const box = h('input', { type: 'checkbox', checked: item.done ? 'checked' : null,
      onchange: async (e) => {
        const next = JSON.parse(JSON.stringify(p.phase_data || {}));
        next[ph].checklist[i].done = e.target.checked;
        await api.patch(`/api/projects/${p.id}`, { phase_data: { [ph]: next[ph] } });
        await refreshData(); render();
      },
    });
    row.append(box, h('span', { style: item.done ? 'text-decoration:line-through;color:var(--muted)' : '' }, item.item));
    list.append(row);
  }
  root.append(list);

  // Pinned analyses
  const pinned = h('div', { className: 'phase-block' });
  pinned.append(h('div', { className: 'section-label' }, 'Linked analyses'));
  if (!data.analysis_ids.length) {
    pinned.append(h('p', { className: 'muted' }, 'No analyses linked yet. Run one and attach it here.'));
  } else {
    for (const aid of data.analysis_ids) {
      const ax = (state.analyses || []).find(a => a.id === aid);
      pinned.append(h('div', { className: 'linked-analysis' },
        h('div', {}, ax ? (ANALYSIS_KINDS[ax.kind]?.label || ax.kind) : `Analysis ${aid.slice(0, 8)}…`),
        ax ? h('span', { className: 'muted' }, new Date(ax.created_at * 1000).toLocaleDateString()) : null,
        h('button', { className: 'ghost', title: 'Detach analysis from this phase',
          'aria-label': 'Detach analysis from this phase',
          onclick: async () => {
            await api.post(`/api/projects/${p.id}/detach`, { analysis_id: aid, phase: ph });
            await refreshData(); render();
          },
        }, '×'),
      ));
    }
  }
  // Attach picker
  const attachSel = h('select', {},
    h('option', { value: '' }, 'Attach an analysis…'),
    ...(state.analyses || []).filter(a => !data.analysis_ids.includes(a.id))
      .map(a => h('option', { value: a.id },
        `${ANALYSIS_KINDS[a.kind]?.label || a.kind} · ${new Date(a.created_at * 1000).toLocaleDateString()}`)),
  );
  pinned.append(h('div', { className: 'row', style: 'margin-top:10px' },
    attachSel,
    h('button', { className: 'secondary', style: 'font-size:11px',
      onclick: async () => {
        if (!attachSel.value) return;
        await api.post(`/api/projects/${p.id}/attach`,
          { analysis_id: attachSel.value, phase: ph });
        await refreshData(); render();
      },
    }, 'Attach'),
  ));
  root.append(pinned);

  // Notes
  const notes = h('div', { className: 'phase-block' });
  notes.append(h('div', { className: 'section-label' }, 'Notes'));
  const ta = h('textarea', { rows: 4, value: data.notes || '', style: 'font-family:var(--font-body)',
    onchange: async (e) => {
      const next = JSON.parse(JSON.stringify(p.phase_data || {}));
      next[ph].notes = e.target.value;
      await api.patch(`/api/projects/${p.id}`, { phase_data: { [ph]: next[ph] } });
      await refreshData();
    },
  });
  notes.append(ta);
  root.append(notes);
  return root;
}

// ═══════════════════════ Reports ═══════════════════════
//
// LSS standard deliverables — Charter, SIPOC, A3, FMEA, Control Plan, 8D,
// per-analysis reports, Tollgate, Closure. Editable section-by-section in
// the browser; downloadable as printable HTML (browser → PDF), Markdown,
// or Word .doc.

function ReportsView() {
  const root = h('div');
  root.append(h('div', { className: 'breadcrumb' }, 'Workspace · Reports'));

  // Header row: title + "+ New Report"
  const head = h('div', { className: 'row', style: 'align-items:flex-end;margin-bottom:14px' },
    h('div', { style: 'flex:1' },
      h('h2', { style: 'margin:0' }, 'Reports'),
      h('div', { className: 'muted', style: 'font-size:13px;margin-top:4px' },
        'Standard LSS deliverables — Charter, A3, FMEA, Control Plan, Tollgate, and more. Editable in the browser; export to PDF, Markdown, or Word.'),
    ),
    h('button', { className: 'primary', onclick: () => openTemplatePicker() }, '+ New Report'),
  );
  root.append(head);

  if (!state.reports.length) {
    root.append(renderEmptyReports());
    return root;
  }

  // Group by template
  const byTpl = new Map();
  for (const r of state.reports) {
    if (!byTpl.has(r.template_id)) byTpl.set(r.template_id, []);
    byTpl.get(r.template_id).push(r);
  }

  const list = h('div', { className: 'tool-index' });
  for (const r of state.reports) {
    const tpl = state.reportTemplates.find(t => t.id === r.template_id);
    const card = h('div', { className: 'tool-card',
      style: 'cursor:pointer',
      onclick: () => navigate({ view: 'report', reportId: r.id }),
    },
      h('div', { className: 'tool-eyebrow' }, tpl?.name || r.template_id),
      h('div', { className: 'tool-title' }, r.title || tpl?.name || '(untitled)'),
      h('div', { className: 'tool-desc' }, r.subtitle || tpl?.blurb || ''),
      h('div', { className: 'muted', style: 'font-size:11px;margin-top:10px' },
        `Updated ${new Date((r.updated_at || r.created_at) * 1000).toLocaleDateString()} · ${(r.analyses_json || []).length} analyses linked`),
      h('div', { className: 'tool-go' }, 'Open →'),
    );
    list.append(card);
  }
  root.append(list);
  return root;
}

function renderEmptyReports() {
  const card = h('div', { className: 'card', style: 'text-align:center;padding:42px 24px' });
  card.append(
    h('h3', { style: 'margin:0 0 8px' }, 'No reports yet'),
    h('p', { className: 'muted', style: 'max-width:540px;margin:0 auto 18px;line-height:1.6' },
      'Reports turn your analyses into the standard LSS deliverables — Project Charters, FMEAs, A3s, Control Plans, Tollgates, Capability studies. Pick a template to get started; most auto-populate from your project and recent analyses.'),
    h('button', { className: 'primary', onclick: () => openTemplatePicker() }, 'Browse templates'),
  );
  // Quick template suggestions
  if (state.reportTemplates?.length) {
    const quick = h('div', { className: 'row', style: 'justify-content:center;flex-wrap:wrap;gap:10px;margin-top:28px' });
    for (const t of state.reportTemplates.slice(0, 6)) {
      quick.append(h('button', { className: 'secondary', style: 'font-size:12px',
        onclick: () => createReport({ template_id: t.id }) }, t.name));
    }
    card.append(quick);
  }
  return card;
}

function openTemplatePicker({ presetAnalysisId = null, presetProjectId = null } = {}) {
  const overlay = h('div', { className: 'cmdk-overlay' });
  const card = h('div', { className: 'cmdk',
    style: 'padding:0;width:780px;max-width:94vw;max-height:84vh;display:flex;flex-direction:column' });
  const head = h('div', { style: 'padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px' },
    h('strong', { style: 'font-size:15px' }, 'Choose a report template'),
    h('span', { className: 'muted', style: 'font-size:12px;flex:1' },
      'All 10 standard LSS deliverables. Each is fully editable after creation.'),
    h('button', { className: 'ghost', onclick: () => overlay.remove() }, 'Cancel'),
  );
  const body = h('div', { style: 'padding:18px;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:12px' });
  for (const tpl of state.reportTemplates) {
    const phasePill = tpl.phase === 'all' ? '' : tpl.phase.toUpperCase();
    const item = h('div', { className: 'card', style: 'cursor:pointer;padding:14px;transition:border-color 120ms' });
    item.append(
      h('div', { className: 'row', style: 'gap:6px;margin-bottom:6px' },
        h('strong', { style: 'flex:1;font-size:14px' }, tpl.name),
        phasePill ? h('span', { className: 'pill', style: 'font-size:10px' }, phasePill) : null,
      ),
      h('div', { className: 'muted', style: 'font-size:12px;line-height:1.5' }, tpl.blurb),
    );
    if (tpl.requires_analysis) {
      item.append(h('div', { className: 'muted', style: 'font-size:11px;margin-top:8px;font-style:italic' },
        `Auto-pulls from a ${tpl.requires_analysis} analysis.`));
    }
    item.addEventListener('click', () => {
      overlay.remove();
      createReport({ template_id: tpl.id, analysis_ids: presetAnalysisId ? [presetAnalysisId] : [], project_id: presetProjectId });
    });
    item.addEventListener('mouseenter', () => item.style.borderColor = 'var(--accent)');
    item.addEventListener('mouseleave', () => item.style.borderColor = '');
    body.append(item);
  }
  card.append(head, body);
  overlay.append(card);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const onEsc = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  };
  document.addEventListener('keydown', onEsc);
  document.body.append(overlay);
}

// Make-report popover anchored to the analysis result card button.
// Two paths: create a new report (suggested template highlighted), or
// add the analysis to an existing report.
function openMakeReportMenu(analysis, anchor) {
  document.querySelectorAll('.make-report-pop').forEach(p => p.remove());
  const pop = h('div', { className: 'make-report-pop card', style: 'position:fixed;z-index:200;width:340px;padding:14px;box-shadow:var(--shadow-lg)' });
  // Suggested template
  let suggested = null;
  if (analysis.kind === 'capability' || analysis.kind === 'sixpack') suggested = 'capability_report';
  else if (analysis.kind === 'msa') suggested = 'msa_report';
  else suggested = 'tollgate';

  pop.append(h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:4px' }, 'Make a report'));
  pop.append(h('div', { className: 'muted', style: 'font-size:11.5px;margin-bottom:10px' },
    `From this ${analysis.kind} result. The report opens for editing immediately.`));

  pop.append(h('div', { className: 'muted', style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px' }, 'New report from template'));
  const tplList = h('div', { style: 'display:flex;flex-direction:column;gap:4px;margin-bottom:12px' });
  // Suggested first
  const ordered = [
    ...state.reportTemplates.filter(t => t.id === suggested),
    ...state.reportTemplates.filter(t => t.id !== suggested && (t.phase === 'all' || !t.requires_analysis)),
  ];
  for (const t of ordered.slice(0, 6)) {
    const isSug = t.id === suggested;
    tplList.append(h('button', { className: 'secondary',
      style: `text-align:left;font-size:12px;padding:6px 10px;${isSug ? 'border-color:var(--accent);color:var(--accent)' : ''}`,
      onclick: async () => {
        pop.remove();
        await createReport({ template_id: t.id, analysis_ids: [analysis.id] });
      } },
      h('strong', {}, t.name + (isSug ? ' · suggested' : '')),
      h('div', { className: 'muted', style: 'font-size:10.5px;margin-top:1px' }, t.blurb),
    ));
  }
  pop.append(tplList);

  if (state.reports.length) {
    pop.append(h('div', { className: 'muted', style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px' }, 'Or add to existing report'));
    const sel = h('select', { style: 'width:100%;padding:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px;font-size:12px' });
    sel.append(h('option', { value: '' }, 'Pick a report…'));
    for (const r of state.reports) sel.append(h('option', { value: r.id }, r.title));
    sel.addEventListener('change', async (e) => {
      const rid = e.target.value;
      if (!rid) return;
      pop.remove();
      try {
        await api.post(`/api/reports/${rid}/link-analysis`, { analysis_id: analysis.id });
        await refreshData();
        toast({ kind: 'success', msg: 'Analysis added to report.' });
        navigate({ view: 'report', reportId: rid });
      } catch {
        toast({ kind: 'error', msg: 'Could not link.' });
      }
    });
    pop.append(sel);
  }

  const cancel = h('button', { className: 'ghost', style: 'font-size:11px;margin-top:10px;width:100%' }, 'Cancel');
  cancel.addEventListener('click', () => close());
  pop.append(cancel);

  // Append first so we can measure offsetHeight, then clamp into viewport.
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect();
  const ph = pop.offsetHeight || 360;
  const pw = pop.offsetWidth || 340;
  let top = rect.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 6); // flip above
  let left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 12;
  if (left < 8) left = 8;
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  const dismiss = (e) => {
    if (!pop.contains(e.target)) { close(); }
  };
  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', dismiss, true);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

// Export menu — collapses the five download/copy actions (Copy, CSV, Dossier,
// Bundle, Excel) into one popover so the result-card header isn't a wall of
// buttons. Same anchored-popover mechanics as openMakeReportMenu.
// Mint (or fetch) a public read-only share link + embed snippet, in a modal.
async function shareAnalysis(a) {
  let data;
  try { data = await api.post(`/api/analyses/${a.id}/share`); }
  catch (e) { toast({ kind: 'error', msg: e.message }); return; }
  const origin = window.location.origin;
  const fullUrl = origin + data.url;
  const embed = `<iframe src="${fullUrl}?embed=1" style="width:100%;height:560px;border:0"></iframe>`;

  const overlay = h('div', { className: 'modal-overlay',
    onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const field = (label, value, isCode) => {
    const input = isCode
      ? h('textarea', { readonly: true, rows: 3, style: 'width:100%;font-family:ui-monospace,monospace;font-size:11px;resize:none' }, value)
      : h('input', { readonly: true, value, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px' });
    return h('div', { style: 'margin-bottom:12px' },
      h('div', { className: 'row', style: 'align-items:center;gap:8px;margin-bottom:4px' },
        h('span', { className: 'section-label', style: 'margin:0' }, label),
        h('span', { style: 'flex:1' }),
        h('button', { className: 'ghost', style: 'font-size:11px',
          onclick: () => { navigator.clipboard?.writeText(value); toast({ kind: 'success', msg: 'Copied.' }); } }, 'Copy')),
      input);
  };
  const modal = h('div', { className: 'modal card', style: 'max-width:560px' },
    h('h3', {}, 'Share this result'),
    h('p', { className: 'muted', style: 'font-size:12.5px;margin:0 0 14px' },
      'A public, read-only view of just this analysis — no login, embeds anywhere. Revoke any time.'),
    field('Link', fullUrl, false),
    field('Embed (iframe)', embed, true),
    h('div', { className: 'row', style: 'gap:8px;margin-top:8px' },
      h('button', { className: 'primary', onclick: () => window.open(fullUrl, '_blank', 'noopener') }, 'Open ↗'),
      h('span', { style: 'flex:1' }),
      h('button', { className: 'ghost', style: 'color:var(--danger,#c55)',
        onclick: async () => {
          await api.delete(`/api/analyses/${a.id}/share`).catch(() => {});
          overlay.remove(); toast({ kind: 'success', msg: 'Share link revoked.' });
          await refreshData(); render();
        } }, 'Revoke'),
      h('button', { className: 'ghost', onclick: () => overlay.remove() }, 'Close')));
  overlay.append(modal);
  document.body.append(overlay);
  attachEscClose(overlay);
}

function openExportMenu(a, anchor) {
  document.querySelectorAll('.export-pop').forEach(p => p.remove());
  const summary = a.result_json?.summary || {};
  const pop = h('div', { className: 'export-pop card',
    style: 'position:fixed;z-index:200;width:240px;padding:8px;box-shadow:var(--shadow-lg)' });
  pop.append(h('div', { className: 'muted',
    style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.08em;padding:4px 8px 6px' },
    'Export & share'));

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', dismiss, true);
    document.removeEventListener('keydown', onKey);
  };
  const item = (label, desc, fn) => {
    const b = h('button', { className: 'ghost',
      style: 'display:block;width:100%;text-align:left;font-size:12px;padding:7px 8px',
      onclick: () => { close(); fn(); } },
      h('strong', {}, label),
      desc ? h('div', { className: 'muted', style: 'font-size:10.5px;margin-top:1px' }, desc) : null);
    pop.append(b);
  };

  item('Copy summary', 'Plain-text to clipboard',
    () => window.statsUx?.copySummary(summary));
  item('Download CSV', 'Summary numbers as .csv',
    () => window.statsUx?.downloadCsv(`${a.kind}.csv`, summary));
  if (!a._demo) {
    item('Excel (.xlsx)', 'Summary + tables + provenance',
      () => downloadAuthed(`/api/analyses/${a.id}/xlsx`,
        `bench-${a.kind}-${a.id.slice(0, 8)}.xlsx`, 'Excel exported.'));
    item('Reproducibility bundle', 'Dataset + params + result + hashes (JSON)',
      () => downloadAuthed(`/api/analyses/${a.id}/bundle`,
        `bench-bundle-${a.kind}-${a.id.slice(0, 8)}.json`, 'Bundle downloaded.'));
    item('Method dossier (PDF)', 'Algorithm, citation, inputs, hashes',
      () => window.open(`/api/analyses/${a.id}/dossier`, '_blank', 'noopener'));
    item('🔗 Share / embed link', 'Public read-only URL + iframe snippet',
      () => shareAnalysis(a));
  }

  document.body.append(pop);
  const rect = anchor.getBoundingClientRect();
  const ph = pop.offsetHeight || 240, pw = pop.offsetWidth || 240;
  let top = rect.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 6);
  let left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 12;
  if (left < 8) left = 8;
  pop.style.top = `${top}px`; pop.style.left = `${left}px`;

  const dismiss = (e) => { if (!pop.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

async function createReport({ template_id, analysis_ids = [], project_id = null, title, subtitle }) {
  const body = { template_id };
  if (analysis_ids?.length) body.analysis_ids = analysis_ids;
  if (project_id) body.project_id = project_id;
  if (title) body.title = title;
  if (subtitle) body.subtitle = subtitle;
  try {
    const r = await api.post('/api/reports', body);
    await refreshData();
    toast({ kind: 'success', msg: `Created ${r.report.title}.` });
    navigate({ view: 'report', reportId: r.report.id });
  } catch (e) {
    toast({ kind: 'error', msg: 'Could not create report.' });
  }
}

// ───── Editor ─────

function ReportEditorView() {
  const root = h('div', { className: 'report-editor' });
  const report = state.reports.find(r => r.id === state._reportId);
  if (!report) {
    root.append(h('div', { className: 'card' },
      h('h3', {}, 'Report not found'),
      h('p', { className: 'muted' }, 'It may have been deleted.'),
      h('button', { className: 'secondary',
        onclick: () => navigate({ view: 'reports' }) }, '← Back to Reports'),
    ));
    return root;
  }
  const tpl = state.reportTemplates.find(t => t.id === report.template_id);
  if (!tpl) {
    root.append(h('div', { className: 'card' }, h('p', { className: 'muted' }, 'Unknown template.')));
    return root;
  }

  // Local draft — mutates report data_json + saves on blur / button click
  const draft = JSON.parse(JSON.stringify({
    title: report.title,
    subtitle: report.subtitle || '',
    data: report.data_json || {},
    analyses: report.analyses_json || [],
  }));

  let saving = false;
  let saveTimer = null;
  let previewTimer = null;
  let previewBust = Date.now();

  // Refresh debounced by 1.4s so the iframe doesn't flicker on every keystroke.
  // The save() flow now JUST persists; refreshPreview() schedules its own redraw.
  const refreshPreview = (immediate = false) => {
    if (previewTimer) clearTimeout(previewTimer);
    const fire = () => {
      previewBust = Date.now();
      const iframe = root.querySelector('iframe.report-preview');
      if (!iframe) return;
      // Fade out, swap src, fade in on load. Keeps the old content visible
      // until the new one paints, no white flash.
      iframe.style.opacity = '0.55';
      iframe.src = `/api/reports/${report.id}/preview?t=${previewBust}`;
      iframe.onload = () => { iframe.style.opacity = '1'; };
    };
    if (immediate) fire();
    else previewTimer = setTimeout(fire, 1400);
  };

  const save = async ({ silent = false } = {}) => {
    saving = true;
    statusEl.textContent = 'Saving…';
    try {
      await api.patch(`/api/reports/${report.id}`, {
        title: draft.title,
        subtitle: draft.subtitle,
        data_json: draft.data,
        analyses_json: draft.analyses,
      });
      Object.assign(report, {
        title: draft.title, subtitle: draft.subtitle,
        data_json: draft.data, analyses_json: draft.analyses,
        updated_at: Math.floor(Date.now() / 1000),
      });
      statusEl.textContent = 'Saved · ' + new Date().toLocaleTimeString();
      if (!silent) refreshPreview();
    } catch (e) {
      statusEl.textContent = 'Save failed';
      toast({ kind: 'error', msg: 'Save failed.' });
    } finally { saving = false; }
  };
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 700);
  };

  // Header bar
  const statusEl = h('span', { className: 'muted', style: 'font-size:11px;margin-left:10px' }, '');
  const headBar = h('div', { className: 'row', style: 'align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap' },
    h('button', { className: 'ghost', onclick: () => navigate({ view: 'reports' }) }, '← Reports'),
    h('span', { className: 'pill accent', style: 'font-size:10px' }, tpl.name),
    h('span', { style: 'flex:1' }),
    statusEl,
    renderDownloadMenu(report),
    h('button', { className: 'ghost', style: 'font-size:11px',
      onclick: async () => {
        const r = await api.post(`/api/reports/${report.id}/duplicate`, {});
        await refreshData();
        toast({ kind: 'success', msg: 'Duplicated.' });
        navigate({ view: 'report', reportId: r.report.id });
      } }, 'Duplicate'),
    h('button', { className: 'ghost', style: 'font-size:11px;color:var(--danger)',
      onclick: async () => {
        if (!confirm('Delete this report?')) return;
        await api.delete(`/api/reports/${report.id}`);
        await refreshData();
        navigate({ view: 'reports' });
      } }, 'Delete'),
  );
  root.append(headBar);

  // Title + subtitle
  const titleRow = h('div', { className: 'card', style: 'padding:18px;margin-bottom:14px' });
  const titleInput = h('input', { type: 'text', value: draft.title || '',
    'data-keep-focus': `r-${report.id}-title`,
    style: 'font:600 22px/1.2 var(--font-display, inherit);width:100%;border:none;background:transparent;color:var(--ink);padding:2px 0;outline:none;border-bottom:1px solid transparent',
    placeholder: 'Report title',
    oninput: (e) => { draft.title = e.target.value; debouncedSave(); },
  });
  const subInput = h('input', { type: 'text', value: draft.subtitle || '',
    'data-keep-focus': `r-${report.id}-subtitle`,
    style: 'font:400 13px/1.4 inherit;width:100%;border:none;background:transparent;color:var(--muted);padding:6px 0;outline:none;margin-top:2px',
    placeholder: 'Subtitle (project, scope, etc.)',
    oninput: (e) => { draft.subtitle = e.target.value; debouncedSave(); },
  });
  titleRow.append(titleInput, subInput);
  root.append(titleRow);

  // Split: editor (left) + live preview (right)
  const split = h('div', { className: 'report-split' });
  const editorCol = h('div', { className: 'report-editor-col', 'data-keep-scroll': `editor-${report.id}` });
  const previewCol = h('div', { className: 'report-preview-col' });

  // Each section: render an editor based on kind
  for (const section of tpl.sections) {
    editorCol.append(renderSectionEditor(section, draft, debouncedSave, save, refreshPreview));
  }

  // Custom sections (free-form longtext)
  const extras = draft.data.__extras || [];
  const extrasWrap = h('div', { className: 'report-section card' });
  extrasWrap.append(h('h3', { style: 'margin:0 0 8px;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:var(--accent)' }, 'Custom sections'));
  for (const ex of extras) extrasWrap.append(renderExtraEditor(ex, extras, draft, debouncedSave));
  extrasWrap.append(h('button', { className: 'secondary', style: 'font-size:12px;margin-top:6px',
    onclick: () => {
      const id = Math.random().toString(36).slice(2, 8);
      extras.push({ id, title: 'New section', body: '' });
      draft.data.__extras = extras;
      save().then(() => render());
    } }, '+ Add custom section'));
  editorCol.append(extrasWrap);

  // Linked analyses panel
  editorCol.append(renderLinkedAnalysesEditor(draft, save));

  split.append(editorCol);

  // Live preview iframe
  const iframe = h('iframe', { className: 'report-preview',
    src: `/api/reports/${report.id}/preview?t=${previewBust}`,
    style: 'width:100%;height:88vh;border:1px solid var(--line);background:#fff;border-radius:6px;transition:opacity 200ms ease;opacity:1',
  });
  iframe.onload = () => { iframe.style.opacity = '1'; };
  const previewHead = h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px' },
    h('div', { className: 'muted', style: 'font-size:11px;text-transform:uppercase;letter-spacing:0.08em' }, 'Live preview'),
    h('button', { className: 'ghost', style: 'font-size:11px', onclick: () => refreshPreview(true) }, 'Refresh'),
  );
  previewCol.append(previewHead, iframe);
  split.append(previewCol);

  root.append(split);
  return root;
}

function renderDownloadMenu(report) {
  const wrap = h('div', { className: 'dl-menu' });
  const btn = h('button', { className: 'primary', style: 'font-size:12px' }, 'Download ▾');
  const menu = h('div', { className: 'dl-menu-pop' });
  const link = (label, fmt, hint) => {
    const a = h('a', { href: `/api/reports/${report.id}/download.${fmt}`, target: '_blank', rel: 'noopener' });
    a.append(h('strong', {}, label), h('span', { className: 'muted', style: 'display:block;font-size:11px' }, hint));
    return a;
  };
  menu.append(
    link('Printable HTML', 'html', 'Open + print to PDF from your browser'),
    link('Word document', 'doc', 'Opens in Word / Pages / Google Docs'),
    link('PowerPoint deck', 'ppt', 'One slide per section · opens in PowerPoint / Keynote / Slides'),
    link('Markdown', 'md', 'Wiki / README paste'),
  );
  let open = false;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    open = !open;
    menu.style.display = open ? 'block' : 'none';
  });
  document.addEventListener('click', () => { open = false; menu.style.display = 'none'; });
  menu.style.display = 'none';
  wrap.append(btn, menu);
  return wrap;
}

// ───── Per-section editors ─────

function renderSectionEditor(section, draft, debouncedSave, save, refreshPreview) {
  const wrap = h('div', { className: 'report-section card' });
  wrap.append(h('h3', { style: 'margin:0 0 4px;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:var(--accent)' }, section.label));
  if (section.hint) wrap.append(h('div', { className: 'muted', style: 'font-size:11.5px;font-style:italic;margin-bottom:8px' }, section.hint));

  const value = draft.data[section.id];

  if (section.kind === 'kv') {
    const v = value || {};
    const grid = h('div', { className: 'kv-form' });
    for (const f of (section.fields || [])) {
      grid.append(h('label', { className: 'kv-label' }, f.label));
      grid.append(renderFieldInput(f, v[f.name] ?? '', (val) => {
        if (!draft.data[section.id]) draft.data[section.id] = {};
        draft.data[section.id][f.name] = val;
        debouncedSave();
      }));
    }
    wrap.append(grid);
  } else if (section.kind === 'longtext') {
    const ta = h('textarea', {
      className: 'longtext',
      style: 'width:100%;min-height:120px;font:13px/1.6 inherit;padding:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;resize:vertical',
      placeholder: section.hint || '…',
      value: value || '',
      oninput: (e) => { draft.data[section.id] = e.target.value; debouncedSave(); },
    });
    wrap.append(ta);
  } else if (section.kind === 'table') {
    wrap.append(renderTableEditor(section, draft, debouncedSave));
  } else if (section.kind === 'signoff') {
    const v = value || {};
    const grid = h('div', { className: 'signoff-form' });
    for (const role of (section.roles || [])) {
      const cell = h('div', { className: 'signoff-cell' });
      const r = v[role] || {};
      cell.append(
        h('div', { className: 'kv-label' }, role),
        h('input', { type: 'text', placeholder: 'Name', value: r.name || '',
          oninput: (e) => { setNested(draft.data, [section.id, role, 'name'], e.target.value); debouncedSave(); } }),
        h('input', { type: 'text', placeholder: 'Title', value: r.title || '',
          oninput: (e) => { setNested(draft.data, [section.id, role, 'title'], e.target.value); debouncedSave(); } }),
        h('input', { type: 'date', value: r.date || '',
          oninput: (e) => { setNested(draft.data, [section.id, role, 'date'], e.target.value); debouncedSave(); } }),
      );
      grid.append(cell);
    }
    wrap.append(grid);
  } else if (['chart', 'metrics', 'summary', 'hashes', 'analyses_list'].includes(section.kind)) {
    wrap.append(h('div', { className: 'muted', style: 'font-size:12px' },
      section.kind === 'analyses_list'
        ? 'Auto-populated from the analyses linked to this report (see "Linked analyses" panel below).'
        : `Auto-populated from the first linked analysis. ${draft.analyses.length === 0 ? 'Link an analysis below.' : ''}`));
  }
  return wrap;
}

function setNested(obj, path, val) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!o[path[i]] || typeof o[path[i]] !== 'object') o[path[i]] = {};
    o = o[path[i]];
  }
  o[path[path.length - 1]] = val;
}

function renderFieldInput(field, value, onChange) {
  if (field.kind === 'longtext') {
    return h('textarea', { value, rows: 2,
      style: 'width:100%;font:13px inherit;padding:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px;resize:vertical',
      oninput: (e) => onChange(e.target.value) });
  }
  if (field.kind === 'select') {
    const sel = h('select', { style: 'width:100%;padding:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px',
      onchange: (e) => onChange(e.target.value) });
    sel.append(h('option', { value: '' }, '—'));
    for (const opt of (field.options || [])) {
      const o = h('option', { value: opt }, opt);
      if (value === opt) o.selected = true;
      sel.append(o);
    }
    return sel;
  }
  const type = field.kind === 'number' ? 'number'
            : field.kind === 'currency' ? 'number'
            : field.kind === 'date' ? 'date'
            : field.kind === 'percent' ? 'number'
            : 'text';
  return h('input', { type, value: value ?? '',
    placeholder: field.placeholder || '',
    style: 'width:100%;padding:6px 8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px;font:13px inherit',
    oninput: (e) => onChange(e.target.value) });
}

function renderTableEditor(section, draft, debouncedSave) {
  const cols = section.columns;
  let rows = draft.data[section.id];
  if (!Array.isArray(rows) || !rows.length) {
    rows = section.defaultRows
      ? section.defaultRows.map(r => [...r])
      : Array.from({ length: section.rows || 3 }, () => cols.map(() => ''));
    draft.data[section.id] = rows;
  }
  const tbl = h('table', { className: 'editable-grid' });
  const thead = h('thead');
  const headTr = h('tr');
  for (const c of cols) headTr.append(h('th', {}, c));
  headTr.append(h('th', { style: 'width:30px' }, ''));
  thead.append(headTr);
  tbl.append(thead);
  const tbody = h('tbody');
  const renderRows = () => {
    tbody.innerHTML = '';
    rows.forEach((row, ri) => {
      const tr = h('tr');
      cols.forEach((_, ci) => {
        // FMEA: RPN column is auto-computed
        const isRpn = section.rpnCols && ci === section.rpnCols.rpn;
        if (isRpn) {
          const s = Number(row[section.rpnCols.s]);
          const o = Number(row[section.rpnCols.o]);
          const d = Number(row[section.rpnCols.d]);
          const rpn = (Number.isFinite(s) && Number.isFinite(o) && Number.isFinite(d)) ? s * o * d : '';
          row[ci] = rpn === '' ? '' : String(rpn);
          const klass = rpn >= 200 ? 'cell-danger' : rpn >= 100 ? 'cell-warn' : '';
          tr.append(h('td', { className: klass + ' rpn-cell' }, String(rpn || '')));
        } else {
          const td = h('td');
          const inp = h('input', { type: 'text', value: row[ci] ?? '',
            oninput: (e) => {
              row[ci] = e.target.value;
              // If FMEA SOD changed, recompute RPN in place
              if (section.rpnCols && (ci === section.rpnCols.s || ci === section.rpnCols.o || ci === section.rpnCols.d)) {
                renderRows();
              }
              debouncedSave();
            } });
          td.append(inp);
          tr.append(td);
        }
      });
      const del = h('button', { className: 'ghost cell-del', title: 'Remove row',
        'aria-label': 'Remove row',
        onclick: () => { rows.splice(ri, 1); renderRows(); debouncedSave(); } }, '×');
      tr.append(h('td', {}, del));
      tbody.append(tr);
    });
  };
  renderRows();
  tbl.append(tbody);
  const wrap = h('div');
  wrap.append(tbl);
  wrap.append(h('button', { className: 'secondary', style: 'font-size:11px;margin-top:6px',
    onclick: () => { rows.push(cols.map(() => '')); renderRows(); debouncedSave(); } }, '+ Add row'));
  return wrap;
}

function renderExtraEditor(ex, extras, draft, debouncedSave) {
  const row = h('div', { style: 'border-top:1px dashed var(--line);padding-top:10px;margin-top:10px' });
  row.append(
    h('div', { className: 'row', style: 'gap:6px;margin-bottom:6px' },
      h('input', { type: 'text', value: ex.title || '', placeholder: 'Section title',
        style: 'flex:1;font-weight:500;padding:4px 6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px',
        oninput: (e) => { ex.title = e.target.value; debouncedSave(); } }),
      h('button', { className: 'ghost', style: 'font-size:11px;color:var(--danger)',
        title: 'Remove section', 'aria-label': 'Remove section',
        onclick: () => {
          const i = extras.indexOf(ex);
          if (i >= 0) extras.splice(i, 1);
          draft.data.__extras = extras;
          debouncedSave();
          setTimeout(render, 200);
        } }, '×'),
    ),
    h('textarea', { value: ex.body || '', rows: 4,
      style: 'width:100%;font:13px/1.6 inherit;padding:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px;resize:vertical',
      oninput: (e) => { ex.body = e.target.value; draft.data.__extras = extras; debouncedSave(); } }),
  );
  return row;
}

function renderLinkedAnalysesEditor(draft, save) {
  const wrap = h('div', { className: 'report-section card' });
  wrap.append(h('h3', { style: 'margin:0 0 8px;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:var(--accent)' }, 'Linked analyses'));
  wrap.append(h('div', { className: 'muted', style: 'font-size:11.5px;margin-bottom:10px' },
    'Charts, metrics, and reproducibility hashes are auto-pulled from these analyses.'));

  const list = h('div', { className: 'linked-analyses' });
  for (const aid of draft.analyses) {
    const a = state.analyses.find(x => x.id === aid);
    const row = h('div', { className: 'linked-row' });
    row.append(
      h('span', { className: 'pill accent', style: 'font-size:10px' }, a?.kind || 'unknown'),
      h('span', { className: 'mono', style: 'font-size:11.5px;flex:1' },
        a ? (a.params_json?.column || a.id.slice(0, 8)) : aid.slice(0, 8)),
      h('button', { className: 'ghost', style: 'font-size:11px;color:var(--danger)',
        onclick: () => {
          draft.analyses = draft.analyses.filter(x => x !== aid);
          save();
          // No full re-render — local DOM update via render() jumps scroll.
          // The preview iframe refreshes after save; user sees the change there.
          setTimeout(() => render(), 200);
        } }, 'Unlink'),
    );
    list.append(row);
  }
  if (!draft.analyses.length) list.append(h('div', { className: 'muted', style: 'font-size:12px;padding:6px 0' }, 'No analyses linked yet.'));
  wrap.append(list);

  const picker = h('select', {
    style: 'padding:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px;font-size:12px;margin-top:6px',
    onchange: (e) => {
      const id = e.target.value;
      if (!id) return;
      if (!draft.analyses.includes(id)) draft.analyses.push(id);
      e.target.value = '';
      save();
      setTimeout(render, 200);
    },
  });
  picker.append(h('option', { value: '' }, '+ Link analysis…'));
  for (const a of state.analyses) {
    if (draft.analyses.includes(a.id)) continue;
    picker.append(h('option', { value: a.id }, `${a.kind} · ${a.params_json?.column || a.id.slice(0, 8)}`));
  }
  wrap.append(picker);
  return wrap;
}

// ═══════════════════════ Community Feedback ═══════════════════════
//
// Anyone on a Conyso Bench instance can file a feature request or bug,
// upvote others', and comment. The Conyso team uses this list to pick
// what gets built next — top-voted open items first. Author identity
// is the anonymous workspace_id (already in localStorage); no auth.

const FEEDBACK_STATUS = {
  open:        { label: 'Open',         color: '#6f6960', desc: 'Submitted; awaiting triage' },
  planned:     { label: 'Planned',      color: '#6b5524', desc: 'On the roadmap' },
  in_progress: { label: 'In progress',  color: '#2563eb', desc: 'Actively being built' },
  shipped:     { label: 'Shipped',      color: '#2f7d3a', desc: 'Available now' },
  wontfix:     { label: 'Won\'t fix',   color: '#b03a3a', desc: 'Out of scope' },
};
const FEEDBACK_KIND = {
  feature: { label: 'Feature', icon: '✦' },
  bug:     { label: 'Bug',     icon: '⚠' },
  idea:    { label: 'Idea',    icon: '◆' },
};

async function loadFeedbackList() {
  const params = new URLSearchParams();
  if (state._feedbackFilter && state._feedbackFilter !== 'all') params.set('status', state._feedbackFilter);
  if (state._feedbackKind && state._feedbackKind !== 'all') params.set('kind', state._feedbackKind);
  if (state._feedbackSort) params.set('sort', state._feedbackSort);
  if (state._feedbackQ) params.set('q', state._feedbackQ);
  try {
    const r = await api.get(`/api/feedback?${params.toString()}`);
    state._feedback = r.items;
    state._feedbackCounts = r.counts;
    state._feedbackAdmin = !!r.admin;
  } catch {
    state._feedback = [];
    state._feedbackCounts = {};
  }
}

function FeedbackView() {
  const root = h('div', { className: 'feedback-view' });

  root.append(h('div', { className: 'breadcrumb' }, 'Community · Feedback & roadmap'));

  // Hero / explainer
  root.append(h('div', { className: 'card', style: 'border-left:3px solid var(--accent);margin-bottom:18px' },
    h('h2', { style: 'margin:0 0 6px' }, 'Help shape Conyso Bench'),
    h('p', { className: 'muted', style: 'margin:0;line-height:1.6;max-width:680px' },
      'File a feature request or a bug, upvote what matters to you. The Conyso Labs team works the top-voted ',
      h('strong', {}, 'Open'),
      ' items first. Status changes show up here as we plan, build, and ship.'),
    h('div', { className: 'row', style: 'margin-top:10px;gap:8px' },
      h('button', { className: 'primary',
        onclick: () => openFeedbackForm() }, '+ New request'),
      h('button', { className: 'ghost', onclick: () => navigate({ view: 'feedback', kind: 'bug' }) }, 'Report a bug'),
    ),
  ));

  // Filter chips: status counts
  const counts = state._feedbackCounts || {};
  const filt = h('div', { className: 'feedback-filters' });
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  const mkChip = (key, label, n) => {
    const active = (state._feedbackFilter || 'all') === key;
    const b = h('button', { className: 'chip' + (active ? ' on' : '') },
      label, n != null ? h('span', { className: 'chip-count' }, n) : null);
    b.addEventListener('click', async () => {
      state._feedbackFilter = key;
      await loadFeedbackList();
      render();
    });
    return b;
  };
  filt.append(
    mkChip('all',         'All',          total),
    mkChip('open',        FEEDBACK_STATUS.open.label,        counts.open),
    mkChip('planned',     FEEDBACK_STATUS.planned.label,     counts.planned),
    mkChip('in_progress', FEEDBACK_STATUS.in_progress.label, counts.in_progress),
    mkChip('shipped',     FEEDBACK_STATUS.shipped.label,     counts.shipped),
    mkChip('wontfix',     FEEDBACK_STATUS.wontfix.label,     counts.wontfix),
  );

  const sortWrap = h('div', { className: 'feedback-sort' });
  const sorts = [['top', 'Top'], ['hot', 'Hot'], ['new', 'New'], ['discussed', 'Discussed']];
  for (const [key, label] of sorts) {
    const b = h('button', { className: 'chip' + ((state._feedbackSort || 'top') === key ? ' on' : '') }, label);
    b.addEventListener('click', async () => {
      state._feedbackSort = key;
      await loadFeedbackList();
      render();
    });
    sortWrap.append(b);
  }
  filt.append(h('span', { style: 'flex:1' }), sortWrap);

  // Kind filter (smaller chip set)
  const kindWrap = h('div', { className: 'feedback-filters', style: 'margin-top:6px' });
  for (const [key, def] of Object.entries({ all: { label: 'All kinds' }, ...FEEDBACK_KIND })) {
    const b = h('button', { className: 'chip' + ((state._feedbackKind || 'all') === key ? ' on' : '') },
      def.icon ? def.icon + ' ' : '', def.label || key);
    b.addEventListener('click', async () => {
      state._feedbackKind = key;
      await loadFeedbackList();
      render();
    });
    kindWrap.append(b);
  }
  // Search box
  const searchInput = h('input', { type: 'search', placeholder: 'Search requests…',
    value: state._feedbackQ || '',
    'data-keep-focus': 'feedback-search',
    style: 'flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px;font:13px inherit' });
  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    if (searchTimer) clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(async () => {
      state._feedbackQ = v;
      await loadFeedbackList();
      render();
    }, 350);
  });
  kindWrap.append(h('span', { style: 'flex:1' }), searchInput);

  root.append(filt, kindWrap);

  // List
  const items = state._feedback || [];
  if (!items.length) {
    if (state._feedback === undefined) {
      // Not loaded yet — kick off load + lightweight placeholder.
      loadFeedbackList().then(render);
      root.append(h('div', { className: 'card' }, skeleton({ lines: 4 })),
                  h('div', { className: 'card' }, skeleton({ lines: 3 })));
    } else {
      root.append(renderFeedbackEmpty());
    }
    return root;
  }

  const list = h('div', { className: 'feedback-list' });
  for (const it of items) list.append(renderFeedbackCard(it));
  root.append(list);
  return root;
}

function renderFeedbackEmpty() {
  const card = h('div', { className: 'card', style: 'text-align:center;padding:42px 24px' });
  card.append(
    h('h3', { style: 'margin:0 0 8px' }, 'No matching requests'),
    h('p', { className: 'muted', style: 'max-width:540px;margin:0 auto 18px;line-height:1.6' },
      'Be the first to file one. Tell us what would make Bench more useful, or what is broken.'),
    h('button', { className: 'primary', onclick: () => openFeedbackForm() }, '+ Start a request'),
  );
  return card;
}

function renderFeedbackCard(item) {
  const status = FEEDBACK_STATUS[item.status] || FEEDBACK_STATUS.open;
  const kind   = FEEDBACK_KIND[item.kind] || FEEDBACK_KIND.feature;
  const card = h('div', { className: 'feedback-card' });

  // Vote column
  const voteCol = h('div', { className: 'vote-col' });
  const upBtn = h('button', { className: 'vote-btn up' + (item.your_vote === 1 ? ' on' : ''),
    title: item.your_vote === 1 ? 'Remove upvote' : 'Upvote', 'aria-label': 'Upvote' }, '▲');
  upBtn.addEventListener('click', (e) => { e.stopPropagation(); vote(item, item.your_vote === 1 ? 0 : 1); });
  const downBtn = h('button', { className: 'vote-btn down' + (item.your_vote === -1 ? ' on' : ''),
    title: item.your_vote === -1 ? 'Remove downvote' : 'Downvote', 'aria-label': 'Downvote' }, '▼');
  downBtn.addEventListener('click', (e) => { e.stopPropagation(); vote(item, item.your_vote === -1 ? 0 : -1); });
  voteCol.append(upBtn, h('span', { className: 'vote-score' + (item.vote_score > 0 ? ' pos' : item.vote_score < 0 ? ' neg' : '') }, item.vote_score), downBtn);
  card.append(voteCol);

  // Body
  const body = h('div', { className: 'fb-body' });
  body.append(
    h('div', { className: 'row', style: 'gap:8px;align-items:center;margin-bottom:6px' },
      item.pinned ? h('span', { className: 'pill accent', style: 'font-size:10px' }, '★ PINNED') : null,
      h('span', { className: 'pill', style: 'font-size:10px' }, kind.icon + ' ' + kind.label),
      h('span', { className: 'fb-status-pill', style: `color:${status.color};border-color:${status.color}` }, status.label),
      h('span', { style: 'flex:1' }),
      h('span', { className: 'muted', style: 'font-size:11px' },
        `${item.comment_count} comment${item.comment_count === 1 ? '' : 's'} · ${new Date(item.created_at * 1000).toLocaleDateString()}`),
    ),
    h('h3', { className: 'fb-title' }, item.title),
  );
  if (item.body) body.append(h('div', { className: 'fb-snippet muted' }, (item.body || '').slice(0, 220) + (item.body.length > 220 ? '…' : '')));
  if (item.author_name) body.append(h('div', { className: 'muted', style: 'font-size:11px;margin-top:6px;font-style:italic' }, '— ' + item.author_name));
  card.append(body);

  card.style.cursor = 'pointer';
  card.addEventListener('click', () => navigate({ view: 'feedback_item', feedbackId: item.id }));
  return card;
}

async function vote(item, value) {
  try {
    const r = await api.post(`/api/feedback/${item.id}/vote`, { value });
    // Patch state in place so we don't re-render the whole world.
    if (state._feedback) {
      const i = state._feedback.findIndex(x => x.id === item.id);
      if (i >= 0) state._feedback[i] = r.item;
    }
    if (state._feedbackItem?.id === item.id) state._feedbackItem = r.item;
    render();
  } catch {
    toast({ kind: 'error', msg: 'Vote failed.' });
  }
}

function openFeedbackForm({ kind = 'feature' } = {}) {
  const overlay = h('div', { className: 'cmdk-overlay' });
  const card = h('div', { className: 'cmdk', style: 'padding:0;width:560px;max-width:94vw' });
  const head = h('div', { style: 'padding:14px 18px;border-bottom:1px solid var(--line)' },
    h('strong', { style: 'font-size:15px' }, 'New request'),
    h('div', { className: 'muted', style: 'font-size:12px;margin-top:2px' },
      'Anonymous by default — add your name if you want credit on the roadmap.'));
  const body = h('div', { style: 'padding:18px;display:flex;flex-direction:column;gap:10px' });
  const kindSel = h('select', { className: 'fb-input' });
  for (const [k, d] of Object.entries(FEEDBACK_KIND)) {
    const o = h('option', { value: k }, `${d.icon} ${d.label}`);
    if (k === kind) o.selected = true;
    kindSel.append(o);
  }
  const titleInput = h('input', { type: 'text', placeholder: 'Short, descriptive title (4–200 chars)', maxlength: 200, className: 'fb-input' });
  const bodyInput = h('textarea', { placeholder: 'What would make Bench more useful, or what is broken? Steps to reproduce help bug reports a lot.',
    rows: 6, className: 'fb-input', maxlength: 5000 });
  const nameInput = h('input', { type: 'text', placeholder: 'Display name (optional)', maxlength: 60, className: 'fb-input',
    value: localStorage.getItem('feedback_name') || '' });
  body.append(
    h('label', {},
      h('div', { className: 'fb-label' }, 'Kind'),
      kindSel),
    h('label', {},
      h('div', { className: 'fb-label' }, 'Title'),
      titleInput),
    h('label', {},
      h('div', { className: 'fb-label' }, 'Details'),
      bodyInput),
    h('label', {},
      h('div', { className: 'fb-label' }, 'Your name (optional, public)'),
      nameInput),
  );
  const foot = h('div', { className: 'row', style: 'padding:12px 18px;border-top:1px solid var(--line);gap:8px' },
    h('span', { className: 'muted', style: 'flex:1;font-size:11px' }, 'Auto-upvoted by you on submit.'),
    h('button', { className: 'ghost', onclick: () => overlay.remove() }, 'Cancel'),
    h('button', { className: 'primary',
      onclick: async () => {
        if (!titleInput.value.trim() || titleInput.value.trim().length < 4) {
          toast({ kind: 'error', msg: 'Title must be at least 4 characters.' });
          return;
        }
        try {
          if (nameInput.value.trim()) localStorage.setItem('feedback_name', nameInput.value.trim());
          const r = await api.post('/api/feedback', {
            kind: kindSel.value,
            title: titleInput.value.trim(),
            body: bodyInput.value.trim(),
            author_name: nameInput.value.trim(),
          });
          overlay.remove();
          toast({ kind: 'success', msg: 'Request filed. Auto-upvoted.' });
          await loadFeedbackList();
          navigate({ view: 'feedback_item', feedbackId: r.item.id });
        } catch (e) {
          toast({ kind: 'error', msg: e.message || 'Failed to submit.' });
        }
      } }, 'Submit'),
  );
  card.append(head, body, foot);
  overlay.append(card);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
  document.body.append(overlay);
  setTimeout(() => titleInput.focus(), 50);
}

function FeedbackDetailView() {
  const root = h('div', { className: 'feedback-detail' });
  const id = state._feedbackId;
  if (!id) {
    root.append(h('div', { className: 'card' }, 'No request selected.'));
    return root;
  }
  // If we don't have it cached, fetch
  if (!state._feedbackItem || state._feedbackItem.id !== id) {
    api.get(`/api/feedback/${id}`).then(r => {
      state._feedbackItem = r.item;
      state._feedbackComments = r.comments;
      state._feedbackAdmin = !!r.admin;
      render();
    }).catch(() => {
      state._feedbackItem = { _missing: true, id };
      render();
    });
    root.append(h('div', { className: 'card' }, skeleton({ lines: 5 })));
    return root;
  }
  const item = state._feedbackItem;
  if (item._missing) {
    root.append(h('div', { className: 'card' },
      h('h3', {}, 'Request not found'),
      h('button', { className: 'secondary', onclick: () => navigate({ view: 'feedback' }) }, '← Back'),
    ));
    return root;
  }
  const status = FEEDBACK_STATUS[item.status] || FEEDBACK_STATUS.open;
  const kind   = FEEDBACK_KIND[item.kind] || FEEDBACK_KIND.feature;
  const isAdmin = state._feedbackAdmin;

  root.append(h('div', { className: 'breadcrumb' },
    h('a', { href: '#', onclick: (e) => { e.preventDefault(); navigate({ view: 'feedback' }); } }, 'Feedback'),
    ' · ', item.title.slice(0, 60)));

  // Header with vote column + title
  const head = h('div', { className: 'feedback-card', style: 'cursor:default' });
  const voteCol = h('div', { className: 'vote-col' });
  const upBtn = h('button', { className: 'vote-btn up' + (item.your_vote === 1 ? ' on' : '') }, '▲');
  upBtn.addEventListener('click', () => vote(item, item.your_vote === 1 ? 0 : 1));
  const downBtn = h('button', { className: 'vote-btn down' + (item.your_vote === -1 ? ' on' : '') }, '▼');
  downBtn.addEventListener('click', () => vote(item, item.your_vote === -1 ? 0 : -1));
  voteCol.append(upBtn, h('span', { className: 'vote-score' + (item.vote_score > 0 ? ' pos' : '') }, item.vote_score), downBtn);
  head.append(voteCol);

  const meta = h('div', { className: 'fb-body' });
  meta.append(
    h('div', { className: 'row', style: 'gap:8px;align-items:center;margin-bottom:6px' },
      h('span', { className: 'pill', style: 'font-size:10px' }, kind.icon + ' ' + kind.label),
      h('span', { className: 'fb-status-pill', style: `color:${status.color};border-color:${status.color}` }, status.label),
      item.is_yours ? h('span', { className: 'pill accent', style: 'font-size:10px' }, 'YOURS') : null,
      h('span', { style: 'flex:1' }),
      h('span', { className: 'muted', style: 'font-size:11px' },
        new Date(item.created_at * 1000).toLocaleString()),
    ),
    h('h2', { style: 'margin:0 0 8px;font-family:var(--font-display);font-size:22px' }, item.title),
  );
  if (item.body) meta.append(h('div', { className: 'fb-body-prose' }, item.body));
  if (item.author_name) meta.append(h('div', { className: 'muted', style: 'font-size:12px;margin-top:8px;font-style:italic' }, '— ' + item.author_name));

  // Admin / author actions
  const actionRow = h('div', { className: 'row', style: 'margin-top:14px;gap:6px;flex-wrap:wrap' });
  if (isAdmin) {
    actionRow.append(h('span', { className: 'muted', style: 'font-size:11px;text-transform:uppercase;letter-spacing:0.08em;align-self:center' }, 'Set status:'));
    for (const [s, def] of Object.entries(FEEDBACK_STATUS)) {
      const chip = h('button', { className: 'chip' + (item.status === s ? ' on' : ''),
        style: `border-color:${def.color};color:${item.status === s ? '#fff' : def.color};background:${item.status === s ? def.color : 'transparent'}` },
        def.label);
      chip.addEventListener('click', async () => {
        try {
          const r = await api.patch(`/api/feedback/${item.id}`, { status: s });
          state._feedbackItem = r.item;
          await loadFeedbackList();
          render();
        } catch {
          toast({ kind: 'error', msg: 'Status change failed (admin token required).' });
        }
      });
      actionRow.append(chip);
    }
    const pinBtn = h('button', { className: 'chip' + (item.pinned ? ' on' : '') }, item.pinned ? '★ Unpin' : '☆ Pin to top');
    pinBtn.addEventListener('click', async () => {
      const r = await api.patch(`/api/feedback/${item.id}`, { pinned: !item.pinned }).catch(() => null);
      if (r) { state._feedbackItem = r.item; await loadFeedbackList(); render(); }
    });
    actionRow.append(pinBtn);
  }
  if (item.is_yours || isAdmin) {
    actionRow.append(h('span', { style: 'flex:1' }));
    actionRow.append(h('button', { className: 'ghost', style: 'font-size:11px;color:var(--danger)',
      onclick: async () => {
        if (!confirm('Delete this request? Comments + votes go with it.')) return;
        await api.delete(`/api/feedback/${item.id}`);
        await loadFeedbackList();
        navigate({ view: 'feedback' });
      } }, 'Delete'));
  }
  if (actionRow.children.length) meta.append(actionRow);

  head.append(meta);
  root.append(head);

  // Comments
  const cwrap = h('div', { className: 'card', style: 'margin-top:14px' });
  cwrap.append(h('h3', { style: 'margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent)' },
    `Comments · ${state._feedbackComments?.length || 0}`));
  for (const c of (state._feedbackComments || [])) {
    const row = h('div', { className: 'fb-comment' + (c.is_team ? ' team' : '') });
    row.append(
      h('div', { className: 'row', style: 'gap:6px;align-items:center;margin-bottom:4px' },
        c.is_team ? h('span', { className: 'pill accent', style: 'font-size:10px' }, 'CONYSO LABS') : null,
        c.author_name ? h('strong', { style: 'font-size:12px' }, c.author_name) : h('span', { className: 'muted', style: 'font-size:11px' }, 'Anonymous'),
        h('span', { style: 'flex:1' }),
        h('span', { className: 'muted', style: 'font-size:11px' }, new Date(c.created_at * 1000).toLocaleString()),
        (c.is_yours || isAdmin) ? (() => {
          const x = h('button', { className: 'ghost', style: 'font-size:11px;color:var(--danger);padding:0 6px',
            title: 'Delete comment', 'aria-label': 'Delete comment' }, '×');
          x.addEventListener('click', async () => {
            if (!confirm('Delete comment?')) return;
            await api.delete(`/api/feedback/comments/${c.id}`);
            const r = await api.get(`/api/feedback/${item.id}`);
            state._feedbackComments = r.comments;
            state._feedbackItem = r.item;
            render();
          });
          return x;
        })() : null,
      ),
      h('div', { className: 'fb-comment-body' }, c.body),
    );
    cwrap.append(row);
  }
  // New comment form
  const newComment = h('div', { style: 'margin-top:14px;padding-top:12px;border-top:1px dashed var(--line)' });
  const ta = h('textarea', { rows: 3, placeholder: 'Add a comment — clarification, use case, or +1 with detail',
    style: 'width:100%;font:13px inherit;padding:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px;resize:vertical' });
  const nameForComment = h('input', { type: 'text', placeholder: 'Name (optional)', maxlength: 60,
    value: localStorage.getItem('feedback_name') || '',
    style: 'flex:1;font:12px inherit;padding:4px 8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:3px' });
  const submitBtn = h('button', { className: 'primary', style: 'font-size:12px' }, 'Post comment');
  submitBtn.addEventListener('click', async () => {
    if (!ta.value.trim()) return;
    try {
      if (nameForComment.value.trim()) localStorage.setItem('feedback_name', nameForComment.value.trim());
      await api.post(`/api/feedback/${item.id}/comments`, { body: ta.value.trim(), author_name: nameForComment.value.trim() });
      ta.value = '';
      const r = await api.get(`/api/feedback/${item.id}`);
      state._feedbackComments = r.comments;
      state._feedbackItem = r.item;
      render();
    } catch (e) {
      toast({ kind: 'error', msg: e.message || 'Comment failed.' });
    }
  });
  newComment.append(ta, h('div', { className: 'row', style: 'gap:6px;margin-top:6px' }, nameForComment, submitBtn));
  cwrap.append(newComment);
  root.append(cwrap);

  return root;
}

// ═══════════════════════ Explore (data visualization) ═══════════════════════
//
// One-stop visual exploration of a dataset before (or instead of) running a
// formal analysis. Builds on the interactive SVG chart helpers in
// stats_engine_ux.js (hover crosshair / brush-zoom / click-annotate / export).
//
// Auto-overview: one chart per column (histogram for numeric, bar for
// categorical) so the user can scan the whole dataset at a glance.
// Custom builder: pick chart type + columns and render.

// Per-column data quality card. Fetches `/api/datasets/:id/preview` once
// and caches on state. Shows: column type, n_unique / n_null, mean/range
// for numerics, and a list of flags (warn / info) the sidecar produced.
function renderQualityCard(datasetId) {
  const card = h('div', { className: 'card', style: 'margin:14px 0;border-left:3px solid var(--accent)' });
  const head = h('div', { className: 'row', style: 'align-items:center;margin-bottom:6px' },
    h('h3', { style: 'margin:0;flex:1;font-size:14px' }, 'Data check'),
    h('span', { className: 'muted', style: 'font-size:11.5px' }, 'auto-generated · click "Explore" to chart'),
    h('button', { className: 'ghost', style: 'font-size:11px',
      onclick: () => { state._lastUploadedDatasetId = null; state._lastUploadedQuality = null; render(); } },
      'Dismiss'),
  );
  card.append(head);
  if (!state._lastUploadedQuality || state._lastUploadedQuality._dsId !== datasetId) {
    state._lastUploadedQuality = { _dsId: datasetId, loading: true };
    api.get(`/api/datasets/${datasetId}/preview?n=10`).then(r => {
      state._lastUploadedQuality = { _dsId: datasetId, ...r };
      render();
    }).catch(() => {
      state._lastUploadedQuality = { _dsId: datasetId, error: true };
      render();
    });
    card.append(h('div', { className: 'muted', style: 'padding:8px 0;font-style:italic' }, 'Inspecting columns…'));
    return card;
  }
  const q = state._lastUploadedQuality;
  if (q.error) {
    card.append(h('div', { className: 'muted' }, 'Could not run quality check.'));
    return card;
  }
  if (q.overall_flags?.length) {
    for (const f of q.overall_flags) {
      card.append(h('div', { className: 'quality-banner ' + f.level }, f.msg));
    }
  }
  const tbl = h('table', { className: 'table quality-table', style: 'margin-top:8px' });
  tbl.append(h('thead', {}, h('tr', {},
    h('th', {}, 'Column'),
    h('th', {}, 'Type'),
    h('th', {}, 'Unique'),
    h('th', {}, 'Null'),
    h('th', {}, 'Range'),
    h('th', {}, 'Notes'),
  )));
  const tbody = h('tbody');
  let warnings = 0;
  for (const c of (q.columns || [])) {
    const flagsCell = h('td', { className: 'quality-flags-cell' });
    if (!c.flags?.length) flagsCell.append(h('span', { className: 'quality-ok' }, '✓ clean'));
    else for (const f of c.flags) {
      if (f.level === 'warn') warnings++;
      flagsCell.append(h('div', { className: 'quality-flag ' + f.level },
        h('span', { className: 'quality-icon' }, f.level === 'warn' ? '⚠' : 'ℹ'),
        h('span', {}, f.msg),
      ));
    }
    const range = c.type === 'number' && c.min != null
      ? `${c.min.toFixed(2)} – ${c.max.toFixed(2)} (mean ${c.mean.toFixed(2)})`
      : '—';
    tbody.append(h('tr', {},
      h('td', { className: 'mono', style: 'font-weight:500' }, c.name),
      h('td', { className: 'muted' }, c.type),
      h('td', { className: 'muted' }, String(c.n_unique)),
      h('td', { className: 'muted' }, String(c.n_null)),
      h('td', { className: 'muted', style: 'font-size:11px' }, range),
      flagsCell,
    ));
  }
  tbl.append(tbody);
  card.append(tbl);
  if (warnings > 0) {
    card.append(h('div', { className: 'muted', style: 'font-size:11px;margin-top:6px;font-style:italic' },
      `${warnings} column${warnings === 1 ? '' : 's'} flagged — review before running analyses on them.`));
  }
  // Quick path to Explore
  card.append(h('div', { style: 'margin-top:10px' },
    h('button', { className: 'secondary', style: 'font-size:12px',
      onclick: () => {
        const ds = state.datasets.find(d => d.id === datasetId);
        if (!ds) return;
        state.current_dataset = ds;
        state.view = 'explore'; state._exploreDatasetId = datasetId; state._exploreData = null;
        render();
      } }, '📊 Visualize this →'),
  ));
  return card;
}

// "What works?" modal — answers the most common upload questions inline
// so users don't get stuck guessing what file types / shapes Bench accepts.
function openUploadGuide() {
  const overlay = h('div', { className: 'cmdk-overlay' });
  const card = h('div', { className: 'cmdk', style: 'width:640px;max-width:94vw;max-height:84vh;display:flex;flex-direction:column' });
  const head = h('div', { style: 'padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center' },
    h('strong', { style: 'font-size:15px;flex:1' }, 'How to upload data'),
    h('button', { className: 'ghost', onclick: () => overlay.remove() }, 'Close'),
  );
  const body = h('div', { className: 'upload-guide', style: 'padding:18px;overflow:auto' });

  const section = (title, items) => {
    body.append(h('h4', {}, title));
    const ul = h('ul');
    for (const it of items) ul.append(h('li', {}, ...(Array.isArray(it) ? it : [it])));
    body.append(ul);
  };

  section('Supported file types', [
    [h('strong', {}, 'CSV / TSV (.csv, .tsv, .txt)'), ' — the smart parser auto-detects the delimiter (comma, tab, semicolon, pipe), encoding (UTF-8, Latin-1, Windows-1252), and skips leading metadata or comment lines (lines starting with # or %).'],
    [h('strong', {}, 'Excel (.xlsx, .xls)'), ' — the first sheet, first contiguous table is used. Header is auto-detected as the first non-empty row.'],
    [h('strong', {}, 'PDF (.pdf)'), ' — table extraction via pdfplumber. Works well for clean tabular PDFs (Minitab printouts, ASTM reports); poor for scanned image-PDFs.'],
    [h('strong', {}, 'JSON (.json)'), ' — either an array of records ', h('code', {}, '[{col:val,...}]'), ' or column-oriented ', h('code', {}, '{col:[v1,v2,...]}'), '.'],
    [h('strong', {}, 'Paste from Excel / Google Sheets'), ' — select a range with headers, copy, and paste into the middle card. Tab- and comma-delimited both work.'],
  ]);

  section('Layout the parser expects', [
    'One row per observation. Each column is one variable.',
    'First row = column headers (one short, descriptive name per column).',
    'Numeric columns should contain numbers — clean stray "N/A", "TBD", "-" before upload.',
    'Mix of numeric and categorical columns is fine and expected — capability needs a numeric measurement, ANOVA needs a numeric value column and a categorical group column, etc.',
    'Date columns are detected if formatted like ', h('code', {}, '2025-01-15'), ' or ', h('code', {}, '01/15/2025'), '. Otherwise they are treated as text.',
  ]);

  section('What goes wrong (and how Bench tells you)', [
    'Mixed-type column — Bench shows "87% numeric — clean stray text entries". The analysis dropdowns won\'t see this as a numeric column until you fix it.',
    'Constant column — flagged as "no information". Capability and ANOVA refuse to use it.',
    'High nulls — flagged at ≥10%. Most tests still run, but consider why values are missing.',
    'ID-looking columns — flagged as "probably not a useful grouping variable" (e.g. a UUID per row).',
    'Empty file or no header — clean 400 with "csv is empty or has no parseable rows" or similar.',
  ]);

  section('When in doubt', [
    'Click ', h('strong', {}, 'Load a sample'), ' on the right and inspect what a clean LSS dataset looks like.',
    'After uploading, the ', h('strong', {}, 'Data check'), ' card highlights anything Bench is worried about — review before running stats.',
    'Hit ', h('strong', {}, 'Explore'), ' on any dataset to see its shape visually before formal analysis.',
  ]);

  card.append(head, body);
  overlay.append(card);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
  document.body.append(overlay);
}

