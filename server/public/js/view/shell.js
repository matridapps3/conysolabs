function renderHeader() {
  // Both labels rendered; CSS shows only the one for the *other* mode so the
  // label flips instantly without a re-render when toggleDarkMode runs.
  const themeBtn = h('button', {
    className: 'icon-btn theme-toggle', title: 'Toggle theme', onclick: toggleDarkMode,
  },
    h('span', { className: 'label-dark' }, 'Light'),
    h('span', { className: 'label-light' }, 'Dark'),
  );

  const menuBtn = h('button', {
    className: 'icon-btn menu-toggle',
    'aria-label': state._mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu',
    'aria-expanded': state._mobileNavOpen ? 'true' : 'false',
    onclick: () => { state._mobileNavOpen = !state._mobileNavOpen; render(); },
  }, state._mobileNavOpen ? '✕' : '☰');

  return h('header', {},
    menuBtn,
    h('div', { className: 'brand' },
      h('span', { className: 'brand-mark' }, icon('brand', { stroke: 1.4 })),
      h('span', { className: 'mark' }, 'CONYSO  BENCH'),
      h('small', {}, 'Statistical Workbench'),
    ),
    h('span', { className: 'spacer' }),
    h('div', { className: 'header-meta' },
      h('a', { href: 'https://conyso.com', target: '_blank',
        style: 'color:var(--ink-2);font-size:11px;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none' },
        'Conyso'),
      h('span', { className: 'pill accent' }, 'Free'),
      h('button', { className: 'icon-btn', title: 'Re-run the welcome tour',
        onclick: startTour }, 'Tour'),
      h('button', { className: 'icon-btn', title: 'Command palette (⌘K / Ctrl-K)',
        onclick: openCmdK }, '⌘K'),
      themeBtn,
    ),
  );
}

// Two-rail navigation: a narrow primary icon rail of top-level sections, and a
// contextual secondary panel that shows ONLY the active section's items. Keeps
// the breadth navigable without a 30-row wall.
function renderSidebar() {
  const wrap = h('nav', { className: 'sidebar two-rail' + (state._mobileNavOpen ? ' open' : '') });
  wrap.addEventListener('click', (e) => {
    if (state._mobileNavOpen && e.target.closest('li,.rail-btn')) state._mobileNavOpen = false;
  }, true);
  const v = state.view, fam = state._analysisFamily || 'all';

  const SECTIONS = [
    { id: 'catalog',  label: 'Catalog',  icon: 'tools',
      go: () => { state.view = 'catalog'; }, match: () => v === 'catalog' },
    { id: 'data',     label: 'Data',     icon: 'datasets',
      go: () => { state.view = 'data'; }, match: () => ['data','worksheet','graph_builder','pipelines','insights','dashboard','recipes'].includes(v) },
    { id: 'analyze',  label: 'Analyze',  icon: 'analyses',
      go: () => { state.view = 'analyze'; state._analysisFamily = 'all'; }, match: () => v === 'analyze' },
    { id: 'tools',    label: 'Tools',    icon: 'control',
      go: () => { state.view = 'tools'; state._toolKind = null; }, match: () => v === 'tools' },
    { id: 'projects', label: 'Projects', icon: 'doe',
      go: () => { state.view = 'projects'; }, match: () => ['projects','project'].includes(v) },
    { id: 'reports',  label: 'Reports',  icon: 'reports',
      go: () => { state.view = 'reports'; state._reportId = null; }, match: () => ['reports','report'].includes(v) },
    { id: 'learn',    label: 'Learn',    icon: 'recipes',
      go: () => { state.view = 'learn_paths'; }, match: () => ['learn_paths','guides','articles','faq'].includes(v) },
    { id: 'more',     label: 'More',     icon: 'other',
      go: () => { state.view = 'methods'; }, match: () => ['methods','validation','resources','feedback','feedback_item'].includes(v) },
  ];
  const active = SECTIONS.find(s => s.match()) || SECTIONS[1];

  // ── Primary rail ──
  const rail = h('div', { className: 'nav-rail' });
  for (const s of SECTIONS) {
    rail.append(h('button', { className: 'rail-btn' + (s.id === active.id ? ' active' : ''),
      title: s.label, 'aria-label': s.label, 'data-rail': s.id,
      'aria-current': s.id === active.id ? 'page' : null,
      onclick: () => { s.go(); render(); } },
      h('span', { className: 'rail-ico' }, icon(s.icon)),
      h('span', { className: 'rail-lbl' }, s.label)));
  }
  wrap.append(rail);

  // ── Contextual panel ──
  const panel = h('div', { className: 'nav-panel' });
  panel.append(h('div', { className: 'panel-title' }, active.label));
  const ul = h('ul');
  const item = (label, isActive, onclick) =>
    ul.append(h('li', { className: isActive ? 'active' : '', onclick }, h('span', {}, label)));

  if (active.id === 'catalog') {
    panel.append(h('p', { className: 'muted', style: 'font-size:12px;padding:2px 4px 10px;line-height:1.5' },
      'Every analysis, calculator, and platform tool — searchable, grouped by phase.'));
    item('Browse the catalog', true, () => { state.view = 'catalog'; render(); });
  } else if (active.id === 'data') {
    item(`Datasets · ${state.datasets.length}`, v === 'data', () => { state.view = 'data'; render(); });
    item('Worksheet', v === 'worksheet', () => { state.view = 'worksheet'; render(); });
    item('Graph Builder', v === 'graph_builder', () => { state.view = 'graph_builder'; render(); });
    item(`Pipelines · ${(state.pipelines || []).length}`, v === 'pipelines', () => { state.view = 'pipelines'; render(); });
    item(`Recipes · ${(state.analyses.filter(a => a.result_json?.recipe).length) || 0}`, v === 'recipes', () => { state.view = 'recipes'; render(); });
    item('Insights · originals', v === 'insights', () => { state.view = 'insights'; render(); });
    item('Process Behavior', v === 'dashboard', () => { state.view = 'dashboard'; render(); });
  } else if (active.id === 'analyze') {
    item(`All analyses · ${state.analyses.length}`, fam === 'all', () => { state.view = 'analyze'; state._analysisFamily = 'all'; render(); });
    for (const f of ANALYSIS_FAMILIES) {
      if (f.id === 'all') continue;
      const isActive = fam === f.id;
      const hasSubs = Array.isArray(f.subs) && f.subs.length > 0;
      const isExpanded = isActive && hasSubs && !state._familyCollapsed;
      ul.append(h('li', { className: isActive ? 'active' : '',
        onclick: () => {
          if (isActive && hasSubs) { state._familyCollapsed = !state._familyCollapsed; render(); return; }
          state.view = 'analyze'; state._analysisFamily = f.id; state._familyCollapsed = false;
          if (f.kind) state._chosenKind = f.kind; else if (f.kinds?.[0]) state._chosenKind = f.kinds[0];
          state._chosenInnerKind = null; state._chosenInnerParam = null; render();
        } },
        h('span', {}, f.label),
        hasSubs ? h('span', { className: 'chev' }, isExpanded ? '−' : '+') : null));
      if (isExpanded) {
        const subList = h('ul', { className: 'sub-list' });
        for (const s of f.subs) {
          const subActive = state._chosenKind === s.kind && (!s.inner || state._chosenInnerKind === s.inner || state._lastInner === s.inner);
          subList.append(h('li', { className: 'sub' + (subActive ? ' active' : ''),
            onclick: (e) => { e.stopPropagation(); state.view = 'analyze'; state._analysisFamily = f.id;
              state._chosenKind = s.kind; state._chosenInnerKind = s.inner || null; state._chosenInnerParam = s.innerParam || null; state._lastInner = s.inner || null; render(); } },
            h('span', {}, s.label)));
        }
        ul.append(subList);
      }
    }
  } else if (active.id === 'tools') {
    for (const t of (typeof TOOLS_INDEX !== 'undefined' ? TOOLS_INDEX : []))
      item(t.label, v === 'tools' && state._toolKind === t.id, () => { state.view = 'tools'; state._toolKind = t.id; render(); });
  } else if (active.id === 'projects') {
    item(`All projects · ${(state.projects || []).length}`, v === 'projects', () => { state.view = 'projects'; render(); });
    for (const p of (state.projects || []).slice(0, 8))
      item('• ' + p.name, v === 'project' && state._projectId === p.id, () => { state.view = 'project'; state._projectId = p.id; render(); });
  } else if (active.id === 'reports') {
    item(`All reports · ${(state.reports || []).length}`, v === 'reports', () => { state.view = 'reports'; state._reportId = null; render(); });
    for (const r of (state.reports || []).slice(0, 8))
      item('• ' + (r.title || r.name || 'Report'), v === 'report' && state._reportId === r.id, () => { state.view = 'report'; state._reportId = r.id; render(); });
  } else if (active.id === 'learn') {
    panel.append(h('p', { className: 'muted', style: 'font-size:12px;padding:2px 4px 10px;line-height:1.5' },
      'Learn Lean Six Sigma by doing — guided paths, how-to guides, deep-dive articles, and answers.'));
    item('Learning Paths', v === 'learn_paths', () => { state.view = 'learn_paths'; render(); });
    item('Guides', v === 'guides', () => { state.view = 'guides'; state._guideId = null; render(); });
    item('Articles', v === 'articles', () => { state.view = 'articles'; state._articleId = null; render(); });
    item('FAQ', v === 'faq', () => { state.view = 'faq'; render(); });
  } else if (active.id === 'more') {
    panel.append(h('p', { className: 'muted', style: 'font-size:12px;padding:2px 4px 10px;line-height:1.5' },
      'Reference, proof, and roadmap — the method index, validation & governance, downloads, and what’s next.'));
    item('Methods', v === 'methods', () => { state.view = 'methods'; render(); });
    item('Validation & Governance', v === 'validation', () => { state.view = 'validation'; render(); });
    item('Resources', v === 'resources', () => { state.view = 'resources'; render(); });
    item('Feedback & roadmap', v === 'feedback' || v === 'feedback_item', () => { state.view = 'feedback'; state._feedbackId = null; render(); });
    item('Lens · charts & visuals ↗', false, () => { window.open('/lens', '_blank', 'noopener'); });
  }
  panel.append(ul);
  panel.append(h('div', { style: 'flex:1' }));
  panel.append(h('div', { style: 'padding:14px 4px 0;font-size:10px;color:var(--faint);line-height:1.7;letter-spacing:0.08em' },
    h('div', {}, h('kbd', {}, '⌘K'), ' palette'),
    h('div', {}, h('kbd', {}, 'g'), '+', h('kbd', {}, 'd/a/t/r'), ' views')));
  wrap.append(panel);
  return wrap;
}

function _renderSidebarOLD() {
  const nav = h('nav', { className: 'sidebar' + (state._mobileNavOpen ? ' open' : '') });
  // On mobile the drawer should close once the user picks a destination.
  // Any click that lands on a nav <li> closes it; the item's own handler
  // (which calls render()) then repaints with the drawer shut.
  nav.addEventListener('click', (e) => {
    if (state._mobileNavOpen && e.target.closest('li')) state._mobileNavOpen = false;
  }, true);
  const v = state.view, fam = state._analysisFamily || 'all';

  // ─ Workspace — only the user's own stuff (data + projects). ─
  // Collapsible nav groups (progressive disclosure) — state persisted so the
  // sidebar stays as tidy as the user left it.
  state._nav = state._nav || (() => {
    try { return JSON.parse(localStorage.getItem('bench_nav') || '{}'); } catch { return {}; }
  })();
  const navToggle = (key) => {
    state._nav[key] = !state._nav[key];
    try { localStorage.setItem('bench_nav', JSON.stringify(state._nav)); } catch {}
    render();
  };
  const isCollapsed = (key, startCollapsed) =>
    (key in state._nav) ? state._nav[key] : !!startCollapsed;
  // A clickable, chevroned group header. Returns whether the body should render.
  const groupHeader = (label, key, startCollapsed) => {
    const collapsed = isCollapsed(key, startCollapsed);
    nav.append(h('div', { className: 'group-label group-toggle', role: 'button',
      'aria-expanded': collapsed ? 'false' : 'true',
      onclick: () => navToggle(key) },
      h('span', {}, label),
      h('span', { className: 'chev', style: 'opacity:.55' }, collapsed ? '+' : '−')));
    return !collapsed;
  };
  const liFor = (it) => h('li', { className: it.active ? 'active' : '', onclick: it.onclick },
    h('span', { className: 'ico' }, icon(it.iconName)), h('span', {}, it.label));

  // renderGroup(label, items, { startCollapsed, secondary })
  // `secondary` items hide behind a "More" toggle so primary actions stay short.
  const renderGroup = (label, items, opts = {}) => {
    if (!groupHeader(label, 'g:' + label, opts.startCollapsed)) return;
    const ul = h('ul');
    for (const it of items) ul.append(liFor(it));
    if (opts.secondary && opts.secondary.length) {
      const moreKey = 'more:' + label;
      const open = !!state._nav[moreKey];
      if (open) for (const it of opts.secondary) ul.append(liFor(it));
      ul.append(h('li', { className: 'nav-more', onclick: () => navToggle(moreKey) },
        h('span', { className: 'ico' }, ''),
        h('span', { className: 'muted', style: 'font-size:12px' },
          open ? '− Less' : `+ ${opts.secondary.length} more`)));
    }
    nav.append(ul);
  };

  // Primary = daily core; secondary (Worksheet, Graph Builder, Recipes,
  // Pipelines, Insights, Process Behavior) hides behind "+ N more" so the
  // workspace list is short by default.
  // Catalog sits above the groups — the one-click map of everything Bench does.
  nav.append(h('ul', { style: 'margin-bottom:6px' },
    h('li', { className: (v === 'catalog' ? 'active' : '') + ' nav-catalog',
      onclick: () => { state.view = 'catalog'; render(); } },
      h('span', { className: 'ico' }, icon('tools')),
      h('span', {}, 'Catalog'),
      h('span', { className: 'chev', style: 'opacity:.5' }, '▦'))));

  renderGroup('Workspace', [
    { iconName: 'datasets', label: `Datasets · ${state.datasets.length}`,
      active: v === 'data',
      onclick: () => { state.view = 'data'; render(); } },
    { iconName: 'analyses', label: `Analyses · ${state.analyses.length}`,
      active: v === 'analyze' && fam === 'all',
      onclick: () => { state.view = 'analyze'; state._analysisFamily = 'all'; render(); } },
    { iconName: 'doe', label: `Projects · ${(state.projects || []).length}`,
      active: v === 'projects' || v === 'project',
      onclick: () => { state.view = 'projects'; render(); } },
    { iconName: 'reports', label: `Reports · ${(state.reports || []).length}`,
      active: v === 'reports' || v === 'report',
      onclick: () => { state.view = 'reports'; state._reportId = null; render(); } },
    { iconName: 'datasets', label: 'Worksheet',
      active: v === 'worksheet', onclick: () => { state.view = 'worksheet'; render(); } },
    { iconName: 'graphs', label: 'Graph Builder',
      active: v === 'graph_builder', onclick: () => { state.view = 'graph_builder'; render(); } },
    { iconName: 'recipes', label: `Recipes · ${(state.analyses.filter(a => a.result_json?.recipe).length) || 0}`,
      active: v === 'recipes', onclick: () => { state.view = 'recipes'; render(); } },
    { iconName: 'recipes', label: `Pipelines · ${(state.pipelines || []).length}`,
      active: v === 'pipelines', onclick: () => { state.view = 'pipelines'; render(); } },
    { iconName: 'graphs', label: 'Insights · originals',
      active: v === 'insights', onclick: () => { state.view = 'insights'; render(); } },
    { iconName: 'control', label: 'Process Behavior',
      active: v === 'dashboard', onclick: () => { state.view = 'dashboard'; render(); } },
  ]);

  // ─ Analysis families ─ collapsible group; active family expands inline.
  const showFams = groupHeader('Analysis', 'g:Analysis', false);
  const fams = h('ul');
  if (showFams)
  for (const f of ANALYSIS_FAMILIES) {
    if (f.id === 'all') continue;
    const isActive = (v === 'analyze' && fam === f.id);
    const hasSubs = Array.isArray(f.subs) && f.subs.length > 0;
    const isExpanded = isActive && hasSubs && !state._familyCollapsed;
    fams.append(h('li', {
      className: isActive ? 'active' : '',
      onclick: () => {
        if (isActive && hasSubs) {
          // Active + has subs: clicking toggles expand/collapse without
          // navigating away.
          state._familyCollapsed = !state._familyCollapsed;
          render();
          return;
        }
        state.view = 'analyze';
        state._analysisFamily = f.id;
        state._familyCollapsed = false;
        if (f.kind)            state._chosenKind      = f.kind;
        else if (f.kinds?.[0]) state._chosenKind      = f.kinds[0];
        state._chosenInnerKind  = null;
        state._chosenInnerParam = null;
        render();
      },
    }, h('span', { className: 'ico' }, icon(f.id)),
       h('span', {}, f.label),
       hasSubs ? h('span', { className: 'chev' }, isExpanded ? '−' : '+') : null));
    if (isExpanded) {
      const subList = h('ul', { className: 'sub-list' });
      for (const s of f.subs) {
        const subActive = state._chosenKind === s.kind && (
          !s.inner || (state._chosenInnerKind === s.inner) || (state._lastInner === s.inner)
        );
        subList.append(h('li', {
          className: 'sub' + (subActive ? ' active' : ''),
          onclick: (e) => {
            e.stopPropagation();
            state.view = 'analyze';
            state._analysisFamily = f.id;
            state._chosenKind = s.kind;
            state._chosenInnerKind = s.inner || null;
            state._chosenInnerParam = s.innerParam || null;
            state._lastInner = s.inner || null;
            render();
          },
        }, h('span', {}, s.label)));
      }
      fams.append(subList);
    }
  }
  nav.append(fams);

  // ─ Tools ─ collapsible; Calculators expands inline when on the tools view.
  const showTools = groupHeader('Tools', 'g:Tools', false);
  const tools = h('ul');
  const toolsActive = v === 'tools';
  if (showTools) {
  tools.append(h('li', {
    className: toolsActive ? 'active' : '',
    onclick: () => { state.view = 'tools'; state._toolKind = null; render(); },
  }, h('span', { className: 'ico' }, icon('tools')),
     h('span', {}, 'Calculators'),
     h('span', { className: 'chev' }, toolsActive ? '−' : '+')));
  if (toolsActive) {
    const subList = h('ul', { className: 'sub-list' });
    for (const t of (typeof TOOLS_INDEX !== 'undefined' ? TOOLS_INDEX : [])) {
      subList.append(h('li', {
        className: 'sub' + (state._toolKind === t.id ? ' active' : ''),
        onclick: (e) => { e.stopPropagation(); state.view = 'tools'; state._toolKind = t.id; render(); },
      }, h('span', {}, t.label)));
    }
    tools.append(subList);
  }
  }
  nav.append(tools);

  // ─ Learn — reference / educational content. Distinct from Workspace
  //   so the sidebar makes it clear which entries are *your* data vs *our*
  //   library.
  renderGroup('Learn', [
    { iconName: 'recipes',    label: 'Learning Paths',
      active: v === 'learn_paths',
      onclick: () => { state.view = 'learn_paths'; render(); } },
    { iconName: 'recipes',    label: 'Guides',
      active: v === 'guides',
      onclick: () => { state.view = 'guides'; state._guideId = null; render(); } },
    { iconName: 'hypothesis', label: 'Articles',
      active: v === 'articles',
      onclick: () => { state.view = 'articles'; state._articleId = null; render(); } },
    { iconName: 'analyses',   label: 'FAQ',
      active: v === 'faq',
      onclick: () => { state.view = 'faq'; render(); } },
    { iconName: 'tools',      label: 'Methods',
      active: v === 'methods',
      onclick: () => { state.view = 'methods'; render(); } },
    { iconName: 'analyses',   label: 'Validation',
      active: v === 'validation',
      onclick: () => { state.view = 'validation'; render(); } },
    { iconName: 'datasets',   label: 'Resources',
      active: v === 'resources',
      onclick: () => { state.view = 'resources'; render(); } },
  ]);

  // ─ Sibling product — Conyso Lens. External link styled like a sidebar
  //   entry so users discover the data-viz studio without leaving Bench.
  if (groupHeader('Conyso family', 'g:Conyso', true)) {
    const sib = h('ul');
    sib.append(h('li', { onclick: () => { window.open('/lens', '_blank', 'noopener'); } },
      h('span', { className: 'ico' }, icon('graphs')),
      h('span', {}, 'Lens · charts & visuals'),
      h('span', { className: 'chev', style: 'opacity:0.5' }, '↗'),
    ));
    nav.append(sib);
  }

  // ─ Community — feedback / roadmap. Pinned at the bottom of Learn so
  //   users can find it from anywhere.
  renderGroup('Community', [
    { iconName: 'recipes',    label: 'Feedback & roadmap',
      active: v === 'feedback' || v === 'feedback_item',
      onclick: () => { state.view = 'feedback'; state._feedbackId = null; render(); } },
  ], { startCollapsed: true });

  nav.append(h('div', { style: 'flex:1' }));
  nav.append(h('div', { style: 'padding:14px 0 0;font-size:10px;color:var(--faint);line-height:1.7;letter-spacing:0.08em' },
    h('div', {}, h('kbd', {}, '⌘K'), ' palette'),
    h('div', {}, h('kbd', {}, 'g'), '+', h('kbd', {}, 'd/a/t/r'), ' views'),
  ));
  return nav;
}

// Map of view name → view function. Centralising makes the dispatcher one
// table lookup + one try/catch instead of a 15-arm if/else where a typo or
// a thrown error in any view kills the whole SPA.
