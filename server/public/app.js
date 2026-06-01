// Conyso Bench — minimal SPA.
//
// No auth. Anonymous workspace generated on first visit and stored in
// localStorage. Three views: Data, Analyze, Tools. All stats UX features
// from stats_engine_ux.js are wired in.
//
// Loaded as a non-module script so top-level `const h = ...` etc. are
// visible to stats_engine_ux.js (which expects them as globals).

// ────────────────── Tiny helpers ──────────────────

const $ = (sel, root = document) => root.querySelector(sel);

const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    // Hyphenated keys (data-*, aria-*, role) must go via setAttribute —
    // assigning them as JS properties creates an invisible field that the
    // .dataset / .getAttribute APIs can't see. This was silently breaking
    // every data-nav-* link in the Methods page and in guide articles.
    if (k.includes('-') || k === 'role') el.setAttribute(k, v);
    else el[k] = v;
  }
  for (const k of kids.flat()) if (k != null) el.append(k?.nodeType ? k : document.createTextNode(k));
  return el;
};

// ────────────────── Workspace ID — stored in localStorage ──────────────────

function getOrCreateWorkspaceId() {
  let id = localStorage.getItem('workspace_id');
  if (!id) {
    // First visit — we'll create one on the server in boot().
    return null;
  }
  return id;
}
function setWorkspaceId(id) { localStorage.setItem('workspace_id', id); }

// ────────────────── API wrapper with toast + workspace header ──────────────────

const api = {
  async _do(method, p, body, isUpload = false) {
    let opts = { method, headers: {} };
    const w = state.workspace?.id;
    if (w) opts.headers['X-Workspace-Id'] = w;
    if (body && !isUpload) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (isUpload) {
      const fd = new FormData();
      fd.append('file', body.file);
      if (body.name) fd.append('name', body.name);
      opts.body = fd;
    }
    // 90s ceiling — longer than sidecar's 60s by a comfortable margin so
    // a slow sidecar surfaces its own 504 before fetch aborts.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    opts.signal = ac.signal;
    let r;
    try {
      r = await fetch(p, opts);
    } catch (e) {
      clearTimeout(timer);
      // Network failure (offline, server down, CORS, abort) — distinct from
      // an HTTP error response. Give the user a recognisable message rather
      // than a raw TypeError.
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      const msg = e.name === 'AbortError' ? 'Request timed out after 90s.'
                : offline                  ? 'You appear to be offline.'
                                           : `Cannot reach server (${e.message || 'network error'}).`;
      toast({ kind: 'error', title: 'Network error', msg });
      throw Object.assign(new Error(msg), { status: 0, code: 'network_error' });
    }
    clearTimeout(timer);
    let json; try { json = await r.json(); } catch { json = {}; }
    if (!r.ok) {
      const msg = json.error || `${r.status} ${r.statusText}`;
      toast({ kind: 'error', title: 'Request failed', msg });
      throw Object.assign(new Error(msg), { status: r.status, body: json });
    }
    return json;
  },
  get(p)         { return api._do('GET', p); },
  post(p, b)     { return api._do('POST', p, b); },
  patch(p, b)    { return api._do('PATCH', p, b); },
  delete(p)      { return api._do('DELETE', p); },
  upload(p, fileOrPayload) { return api._do('POST', p, fileOrPayload, true); },
};

// Shared download helper — workspace header travels, JSON error bodies are
// parsed and surfaced in the toast (so the user sees the server's actual
// message instead of `failed: 500`).
async function downloadAuthed(url, filename, successMsg) {
  const w = state.workspace?.id;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);    // 2 minutes for big xlsx
  try {
    const r = await fetch(url,
      { headers: w ? { 'X-Workspace-Id': w } : {}, signal: ac.signal });
    if (!r.ok) {
      // Try JSON first; fall back to text.
      let msg;
      try {
        const j = await r.json();
        msg = j.error || j.detail || `HTTP ${r.status}`;
      } catch {
        const t = await r.text().catch(() => '');
        msg = t.slice(0, 160) || `HTTP ${r.status}`;
      }
      throw Object.assign(new Error(msg), { status: r.status });
    }
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = h('a', { href: blobUrl, download: filename });
    link.click();
    URL.revokeObjectURL(blobUrl);
    if (successMsg) toast({ kind: 'success', msg: successMsg });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Download timed out after 2 minutes.'
              : (e.message || 'Download failed.');
    toast({ kind: 'error', msg });
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────── App state ──────────────────

const state = {
  workspace: null,
  datasets: [],
  analyses: [],
  reports: [],
  reportTemplates: [],
  current_dataset: null,
  view: 'data',                    // 'data' | 'analyze' | 'tools' | 'recipes' | 'reports' | 'report'
  cmdkOpen: false,
};

// ────────────────── Toasts ──────────────────

function toast({ kind = 'info', title, msg, duration = 4000 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) { host = h('div', { className: 'toasts' }); document.body.append(host); }
  const el = h('div', { className: `toast ${kind}` },
    h('div', { className: 'toast-body' },
      title ? h('div', { className: 'toast-title' }, title) : null,
      msg ? h('div', { className: 'toast-msg' }, msg) : null,
    ),
    h('button', { className: 'close', onclick: () => el.remove() }, '×'),
  );
  host.append(el);
  if (duration > 0) setTimeout(() => el.remove(), duration);
  return el;
}

// ────────────────── Global error safety nets ──────────────────
//
// Without these, an uncaught error in an event handler or an unhandled
// promise rejection produces a silent dead UI — no toast, no console hint
// for the user. These catch-alls surface as a toast and a console line so
// users have something to report and developers have a stack to follow.
//
// We dedupe by message + 2s window so a runaway loop doesn't spam toasts.
const _errToastSeen = new Map();
function _reportError(label, err) {
  try {
    const msg = (err && (err.message || err.reason || String(err))) || 'unknown_error';
    const key = `${label}:${msg}`;
    const now = Date.now();
    if (_errToastSeen.get(key) && now - _errToastSeen.get(key) < 2000) return;
    _errToastSeen.set(key, now);
    console.error(`[${label}]`, err);
    toast({ kind: 'error', title: 'Something broke',
      msg: msg.length > 200 ? msg.slice(0, 200) + '…' : msg, duration: 6000 });
  } catch { /* never let the error handler throw */ }
}
window.addEventListener('error', (e) => {
  // Swallow ResizeObserver loop notices — Chrome reports them as errors
  // but they're benign (e.g. recharts during animation).
  if (e.message && /ResizeObserver loop/i.test(e.message)) return;
  _reportError('window.error', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  _reportError('promise', e.reason);
});

function skeleton({ lines = 3, withTitle = true } = {}) {
  const wrap = h('div');
  if (withTitle) wrap.append(h('div', { className: 'skel title' }));
  for (let i = 0; i < lines; i++) {
    wrap.append(h('div', { className: 'skel line', style: `width:${60 + Math.random() * 40}%` }));
  }
  return wrap;
}

async function withLoading(btn, fn) {
  if (!btn) return fn();
  btn.classList.add('loading'); btn.disabled = true;
  try { return await fn(); }
  finally { btn.classList.remove('loading'); btn.disabled = false; }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

// Click-to-zoom on chart images.
document.addEventListener('click', (e) => {
  if (e.target.matches?.('img.chart')) {
    const overlay = h('div', { className: 'chart-zoom-overlay', onclick: () => overlay.remove() },
      h('img', { src: e.target.src }));
    document.body.append(overlay);
  }
});

// Escape closes any modal-style overlay (chart zoom, test chooser, comparator).
// The cmdK palette has its own handler on its input; this catches the rest.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const z = document.querySelector('.chart-zoom-overlay');
  if (z) { z.remove(); return; }
  if (state.cmdkOpen) return;  // cmdK handles its own escape inside its input
  const overlays = document.querySelectorAll('.cmdk-overlay');
  if (overlays.length) overlays[overlays.length - 1].remove();
});

// ────────────────── Theme ──────────────────

function toggleDarkMode() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch {}
}
(function applyStoredTheme() {
  try {
    const t = localStorage.getItem('theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch {}
})();

// ────────────────── Command palette ──────────────────

function openCmdK() {
  if (state.cmdkOpen) return;
  state.cmdkOpen = true;

  const items = [
    { kind: 'view',    label: 'Data',     action: () => { state.view = 'data'; render(); } },
    { kind: 'view',    label: 'Analyze',  action: () => { state.view = 'analyze'; render(); } },
    { kind: 'view',    label: 'Tools',    action: () => { state.view = 'tools'; render(); } },
    { kind: 'view',    label: 'Recipes',  action: () => { state.view = 'recipes'; render(); } },
    { kind: 'action',  label: 'Upload dataset', action: () => triggerUpload() },
    { kind: 'action',  label: 'Test Chooser', action: () => window.statsUx?.openTestChooser(applyChosenTest) },
    { kind: 'action',  label: 'Toggle dark mode', action: () => { closeCmdK(); toggleDarkMode(); } },
  ];
  for (const d of state.datasets) {
    items.push({ kind: 'dataset', label: `Use dataset: ${d.name}`,
      action: () => { state.current_dataset = d; state.view = 'analyze'; render(); } });
  }

  let active = 0; let filtered = items.slice();

  const input = h('input', {
    placeholder: 'Search views, actions, datasets…', autofocus: true,
    oninput: () => { active = 0; refresh(); },
    onkeydown: (e) => {
      if (e.key === 'Escape') return closeCmdK();
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(filtered.length - 1, active + 1); refresh(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); active = Math.max(0, active - 1); refresh(); }
      if (e.key === 'Enter')     { if (filtered[active]) { closeCmdK(); filtered[active].action(); } }
    },
  });
  const list = h('div', { className: 'results' });
  const overlay = h('div', { className: 'cmdk-overlay', onclick: (e) => { if (e.target === overlay) closeCmdK(); } },
    h('div', { className: 'cmdk' }, input, list));
  document.body.append(overlay);
  state._cmdkOverlay = overlay;
  setTimeout(() => input.focus(), 0);
  refresh();

  function refresh() {
    const q = input.value.trim().toLowerCase();
    filtered = items.filter(it => !q || it.label.toLowerCase().includes(q) || it.kind.includes(q));
    list.innerHTML = '';
    if (!filtered.length) { list.append(h('div', { className: 'empty' }, 'No matches')); return; }
    filtered.forEach((it, i) => {
      list.append(h('div', {
        className: `item ${i === active ? 'active' : ''}`,
        onclick: () => { closeCmdK(); it.action(); },
        onmouseover: () => { active = i; refresh(); },
      },
        h('span', {}, it.label),
        h('span', { className: 'item-kind' }, it.kind),
      ));
    });
  }
}
function closeCmdK() {
  state.cmdkOpen = false;
  state._cmdkOverlay?.remove();
  state._cmdkOverlay = null;
}

// ────────────────── Keyboard shortcuts ──────────────────

document.addEventListener('keydown', (e) => {
  const inField = e.target.matches?.('input, textarea, select, [contenteditable]');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    state.cmdkOpen ? closeCmdK() : openCmdK();
    return;
  }
  if (state.cmdkOpen) return;
  if (inField) return;
  if (e.key === 'g') { state._gPressed = Date.now(); return; }
  if (state._gPressed && Date.now() - state._gPressed < 1500) {
    const map = { d: 'data', a: 'analyze', t: 'tools', r: 'recipes' };
    if (map[e.key]) { state.view = map[e.key]; render(); state._gPressed = 0; }
  }
});

// ────────────────── Boot ──────────────────

async function boot() {
  document.documentElement.setAttribute('data-theme',
    localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  // Ensure a workspace exists.
  let wId = getOrCreateWorkspaceId();
  if (!wId) {
    const r = await api.post('/api/workspaces', { name: 'My workspace' });
    setWorkspaceId(r.workspace.id);
    state.workspace = r.workspace;
  } else {
    try {
      const r = await api.get(`/api/workspaces/${wId}`);
      state.workspace = r.workspace;
    } catch {
      // Workspace ID was stale (e.g. DB rebuilt). Create a fresh one.
      const r = await api.post('/api/workspaces', { name: 'My workspace' });
      setWorkspaceId(r.workspace.id);
      state.workspace = r.workspace;
    }
  }

  await refreshData();
  // First-visit walkthrough — runs once per browser.
  try {
    if (!localStorage.getItem('bench-onboarded')) state.tour = { step: 0 };
  } catch {}
  render();
}

async function refreshData() {
  const [ds, an, pj, rp, rt] = await Promise.all([
    api.get('/api/datasets').catch(() => ({ datasets: [] })),
    api.get('/api/analyses').catch(() => ({ analyses: [] })),
    api.get('/api/projects').catch(() => ({ projects: [] })),
    api.get('/api/reports').catch(() => ({ reports: [] })),
    state.reportTemplates?.length
      ? Promise.resolve({ templates: state.reportTemplates })
      : api.get('/api/reports/templates').catch(() => ({ templates: [] })),
  ]);
  state.datasets = ds.datasets || [];
  state.analyses = an.analyses || [];
  state.projects = pj.projects || [];
  state.reports = rp.reports || [];
  state.reportTemplates = rt.templates || [];
  state._demoMode = false;  // cleared whenever the server has real rows
  // Demo mode: when the workspace is empty, seed an in-memory dataset +
  // capability analysis so the empty state still shows the result page.
  // Cleared the moment the user uploads anything real.
  if (!state.datasets.length && !state.analyses.length) {
    seedDemo();
    // Demo lands on the Analyses view so the user sees the result page
    // straight away (matches the mockup).
    state.view = 'analyze';
    state._analysisFamily = 'capability';
  }
  if (!state.current_dataset && state.datasets.length) state.current_dataset = state.datasets[0];
}

// Deterministic Normal(mu, sd) sample of size n via Box-Muller seeded with a
// fixed-quality LCG — same numbers every reload so the demo result is stable.
function _demoSample(n, mu, sd, seed = 0x6362626e) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
  const out = [];
  while (out.length < n) {
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(mu + sd * z);
  }
  return out;
}

function seedDemo() {
  const values = _demoSample(248, 5.41, 0.31);
  state.datasets = [{
    id: 'demo',
    name: 'Pump cycle test (demo)',
    row_count: 248,
    schema_json: [
      { name: 'cycle_time_minutes', type: 'number' },
      { name: 'shift',              type: 'string' },
    ],
    _demo: true,
  }];
  state.analyses = [{
    id: 'demo-cap',
    kind: 'capability',
    dataset_id: 'demo',
    created_at: Math.floor(Date.now() / 1000),
    params_json: { column: 'cycle_time_minutes', lsl: 4.5, usl: 6.5, target: 5.5 },
    chart_storage_key: null,
    result_json: {
      summary: {
        n: 248, mean: 5.41, stdev: 0.31,
        cp: 1.06, cpk: 0.87, pp: 1.02, ppk: 0.81, cpm: 0.95, z_bench: 2.61,
        lsl: 4.5, usl: 6.5, target: 5.5,
      },
      // Inline values let the SPA render an SVG histogram with spec lines
      // when no sidecar PNG is available (demo mode, sidecar offline, etc.).
      demo_values: values,
      // Fake-but-shaped-correctly provenance so demo also showcases the audit
      // trail. Real runs get real hashes from server/lib/provenance.js.
      provenance: {
        software_version: 'conyso-bench-server@1.0.0',
        data_hash:   'demo-deadbeef0000000000000000000000000000000000000000000000000000',
        params_hash: 'demo-c0ffee0000000000000000000000000000000000000000000000000000',
        result_hash: 'demo-f1f2f30000000000000000000000000000000000000000000000000000',
        computed_at: new Date().toISOString(),
      },
    },
    _demo: true,
  }];
  state._demoMode = true;
}

// ────────────────── Render shell ──────────────────

// Scroll preservation. render() replaces #app wholesale, which loses every
// scroll position. We snapshot the window + every [data-keep-scroll] node
// before clearing, then restore after rAF (post-layout). Active focus +
// caret position on text inputs are also preserved so typing into a field
// that triggers a re-render doesn't lose the cursor.
const _scrollSnap = {};
let _focusSnap = null;
function _snapshotUiState(app) {
  _scrollSnap.__win = window.scrollY;
  app.querySelectorAll('[data-keep-scroll]').forEach(el => {
    _scrollSnap[el.dataset.keepScroll] = el.scrollTop;
  });
  const ae = document.activeElement;
  if (ae && app.contains(ae) && ae.dataset && ae.dataset.keepFocus) {
    _focusSnap = {
      key: ae.dataset.keepFocus,
      start: ae.selectionStart ?? null,
      end: ae.selectionEnd ?? null,
    };
  } else _focusSnap = null;
}
function _restoreUiState(app) {
  if (_scrollSnap.__win != null) window.scrollTo(0, _scrollSnap.__win);
  app.querySelectorAll('[data-keep-scroll]').forEach(el => {
    const v = _scrollSnap[el.dataset.keepScroll];
    if (v != null) el.scrollTop = v;
  });
  if (_focusSnap) {
    const el = app.querySelector(`[data-keep-focus="${_focusSnap.key}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (_focusSnap.start != null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(_focusSnap.start, _focusSnap.end); } catch {}
      }
    }
  }
}

function render() {
  const app = $('#app');
  if (!app) {
    console.error('render(): #app not in DOM');
    return;
  }
  // A thrown function inside renderHeader/Sidebar/Workspace used to leave
  // #app empty (we clear before building, then bail on first throw). Build
  // each region defensively so the chrome stays visible even if a single
  // panel errors out.
  let header, sidebar, workspace;
  try { header = renderHeader(); } catch (e) {
    console.error('renderHeader failed', e);
    header = h('div', { style: 'padding:8px;border-bottom:1px solid var(--line);color:var(--danger);font-size:12px' },
      'Header failed to render — see console.');
  }
  try { sidebar = renderSidebar(); } catch (e) {
    console.error('renderSidebar failed', e);
    sidebar = h('div', { style: 'padding:12px;color:var(--danger);font-size:12px' }, 'Sidebar error');
  }
  try { workspace = renderWorkspace(); } catch (e) {
    console.error('renderWorkspace failed', e);
    workspace = h('div', { className: 'card', style: 'margin:16px;border-left:3px solid var(--danger)' },
      h('h3', {}, 'Workspace render error'), h('p', { className: 'muted' }, e.message || String(e)));
  }
  try {
    _snapshotUiState(app);
    app.innerHTML = '';
    app.append(header, h('main', {}, sidebar, workspace));
    requestAnimationFrame(() => { try { _restoreUiState(app); } catch (e) { console.error('restoreUiState', e); } });
    try { syncTour(); } catch (e) { console.error('syncTour', e); }
  } catch (e) {
    // If even the DOM append fails (extremely rare — would mean #app was
    // detached or React-style children mutated), surface inline rather than
    // leaving a white page.
    console.error('render() final assembly failed', e);
    app.innerHTML = '<div style="padding:24px;font-family:sans-serif">Render error: ' +
      (e.message || String(e)).replace(/[<>]/g, '') + '. Reload the page.</div>';
  }
}
window.addEventListener('resize', () => { if (state.tour) positionTour(); });
window.addEventListener('scroll', () => { if (state.tour) positionTour(); }, true);

// ────────────────── First-visit walkthrough ──────────────────
//
// Seven-step modal tour shown on first visit (or via the "Take the tour"
// button). State lives in state.tour = { step }. Persisting completion in
// localStorage means returning users aren't bothered.

// Tour steps. Each step optionally targets a real UI element (CSS selector)
// and the tour spotlights that element while showing a tooltip nearby.
// `setup` runs before measuring (e.g. switch view so the target is on screen).
const TOUR_STEPS = [
  {
    title: 'Welcome to Conyso Bench',
    body: `The free Lean Six Sigma statistical workbench. Sixty seconds and
           you'll know your way around. You can skip anytime, or reopen this
           tour from the header.`,
    // No target → centered modal.
  },
  {
    selector: 'header .brand',
    placement: 'bottom',
    title: 'Conyso Bench',
    body: `Editorial wordmark up top. The histogram glyph is the brand mark.
           To the right of the header you'll find the Conyso link, the free
           pill, the Tour button, the ⌘K palette, and the theme toggle.`,
  },
  {
    selector: 'nav.sidebar',
    placement: 'right',
    title: 'Everything is in the left rail',
    body: `<strong>Workspace</strong> shows your datasets, runs, recipes,
           methods, projects, and guides. <strong>Analysis</strong> lists every
           family — 27 hypothesis tests, 9 control charts, capability, GR&R,
           DOE, reliability, multivariate, time series. Click a family to
           expand its sub-kinds.`,
  },
  {
    selector: 'input[placeholder*="capability on"]',
    placement: 'bottom',
    setup: () => { state.view = 'analyze'; state.formOpen = true; },
    title: 'Plain-English query bar',
    body: `Type what you want. <em>capability on cycle_time</em> or
           <em>compare yield by line</em> fills the form automatically — Bench
           parses the intent and picks the analysis kind.`,
  },
  {
    selector: '.analyze-form button.secondary',
    placement: 'bottom',
    setup: () => { state.view = 'analyze'; state.formOpen = true; },
    title: 'Pick the right test',
    body: `Three or four questions, Bench picks the right test — including
           the fallback if your data fails normality or equal-variance checks.`,
  },
  {
    selector: '.metric-strip',
    placement: 'bottom',
    setup: () => { state.view = 'analyze'; },
    title: 'Anatomy of a result',
    body: `Every result has a <strong>metric strip</strong> at the top with
           headline numerics, colour-coded by threshold (gold = warning,
           red = action needed). Below it: plain-English interpretation,
           chart, action plan.`,
  },
  {
    selector: 'details.provenance',
    placement: 'top',
    setup: () => { state.view = 'analyze'; },
    title: 'Reproducibility',
    body: `Every result is bound to a four-part hash —
           <code>software · data · params · result</code>. Re-run the same
           recipe → identical hashes. Closed-source tools can't prove this.
           Open the block to read the hashes.`,
  },
  {
    selector: 'header .header-meta',
    placement: 'bottom',
    title: 'You\'re set',
    body: `<kbd>⌘K</kbd> opens the command palette. The <strong>Tour</strong>
           button reopens this walkthrough. The theme toggle flips dark / light.
           When in doubt, head to <strong>Guides</strong> in the sidebar.`,
  },
];

// Track the highlighted element so we can clean its class on step change.
let _tourHighlighted = null;

function startTour() {
  state.tour = { step: 0 };
  render();
}
function nextTourStep() {
  if (!state.tour) return;
  if (state.tour.step >= TOUR_STEPS.length - 1) return endTour(true);
  state.tour.step += 1;
  render();
}
function prevTourStep() {
  if (!state.tour) return;
  state.tour.step = Math.max(0, state.tour.step - 1);
  render();
}
function endTour(persist) {
  state.tour = null;
  if (persist) {
    try { localStorage.setItem('bench-onboarded', '1'); } catch {}
  }
  render();
}
// One tour root shell, kept across step changes so transitions animate.
// syncTour() builds it when state.tour appears, destroys when it goes away,
// and otherwise updates the card content + repositions on each call.
let _tourRoot = null;

function syncTour() {
  if (!state.tour) {
    if (_tourRoot && _tourRoot.parentNode) _tourRoot.parentNode.removeChild(_tourRoot);
    _tourRoot = null;
    return;
  }
  const step = TOUR_STEPS[state.tour.step];
  if (step.setup) step.setup();
  const isAnchored = !!step.selector;

  if (!_tourRoot) {
    _tourRoot = isAnchored ? buildAnchoredShell() : buildCenteredShell();
    document.body.appendChild(_tourRoot);
  } else if ((_tourRoot.dataset.mode === 'anchored') !== isAnchored) {
    // Step type changed (centered ↔ anchored): swap shells.
    _tourRoot.parentNode.removeChild(_tourRoot);
    _tourRoot = isAnchored ? buildAnchoredShell() : buildCenteredShell();
    document.body.appendChild(_tourRoot);
  }
  fillTourCard(_tourRoot.querySelector('.tour-card'));
  if (isAnchored) requestAnimationFrame(positionTour);
}

function buildCenteredShell() {
  const overlay = h('div', { className: 'tour-overlay',
    onclick: (e) => { if (e.target === overlay) endTour(true); } },
    h('div', { className: 'tour-card centered' }),
  );
  overlay.dataset.mode = 'centered';
  return overlay;
}
function buildAnchoredShell() {
  const root = h('div', { className: 'tour-anchored',
    onclick: (e) => { if (e.target.classList.contains('tour-mask')) endTour(true); } },
    h('div', { className: 'tour-mask tour-mask-top' }),
    h('div', { className: 'tour-mask tour-mask-right' }),
    h('div', { className: 'tour-mask tour-mask-bottom' }),
    h('div', { className: 'tour-mask tour-mask-left' }),
    h('div', { className: 'tour-ring' }),
    h('div', { className: 'tour-card anchored' }),
  );
  root.dataset.mode = 'anchored';
  return root;
}

function fillTourCard(card) {
  if (!card) return;
  const i = state.tour.step;
  const total = TOUR_STEPS.length;
  const step = TOUR_STEPS[i];
  card.innerHTML = '';
  card.append(
    h('div', { className: 'tour-card-meta' }, `Step ${i + 1} of ${total} · Welcome tour`),
    h('h3', {}, step.title),
    h('div', { className: 'tour-body', innerHTML: step.body }),
    h('div', { className: 'tour-progress' },
      ...Array.from({ length: total }, (_, j) =>
        h('span', {
          className: 'tour-pip' + (j === i ? ' on' : j < i ? ' done' : ''),
          onclick: () => { state.tour.step = j; render(); },
          title: TOUR_STEPS[j].title,
        })),
    ),
    h('div', { className: 'tour-actions' },
      h('button', { className: 'ghost',
        onclick: () => endTour(true) }, 'Skip tour'),
      h('span', { className: 'spacer' }),
      i > 0 ? h('button', { className: 'secondary', onclick: prevTourStep }, 'Back') : null,
      i < total - 1
        ? h('button', { className: 'primary', onclick: nextTourStep }, 'Next')
        : h('button', { className: 'primary', onclick: () => endTour(true) }, 'Finish'),
    ),
  );
}

// Compute the layout for an anchored tour step. Runs after every render so
// the ring, masks, and tooltip card track the target precisely. Uses CSS
// transitions on the mask + ring so subsequent steps animate smoothly.
function positionTour() {
  if (!state.tour) return;
  const step = TOUR_STEPS[state.tour.step];
  if (!step || !step.selector) return;

  const target = document.querySelector(step.selector);
  const card = document.querySelector('.tour-card');
  if (!card) return;
  if (!target) {
    // Target not in the DOM yet — try again next frame (e.g. an async view
    // hasn't rendered its content). Bail after a few retries.
    state.tour._retries = (state.tour._retries || 0) + 1;
    if (state.tour._retries < 8) requestAnimationFrame(positionTour);
    return;
  }
  state.tour._retries = 0;

  const r = target.getBoundingClientRect();
  // Padding around the target so the ring isn't flush against text.
  const pad = step.pad ?? 6;
  const rTop    = Math.max(0, r.top - pad);
  const rLeft   = Math.max(0, r.left - pad);
  const rRight  = Math.min(window.innerWidth,  r.right + pad);
  const rBottom = Math.min(window.innerHeight, r.bottom + pad);
  const rW      = rRight - rLeft;
  const rH      = rBottom - rTop;

  // Four mask rectangles tile around the target.
  const masks = {
    top:    { top: 0,       left: 0,     width: '100vw',     height: `${rTop}px` },
    bottom: { top: `${rBottom}px`, left: 0, width: '100vw', height: `calc(100vh - ${rBottom}px)` },
    left:   { top: `${rTop}px`,   left: 0, width: `${rLeft}px`, height: `${rH}px` },
    right:  { top: `${rTop}px`,   left: `${rRight}px`, width: `calc(100vw - ${rRight}px)`, height: `${rH}px` },
  };
  for (const [side, s] of Object.entries(masks)) {
    const el = document.querySelector(`.tour-mask-${side}`);
    if (!el) continue;
    Object.assign(el.style, {
      top: typeof s.top === 'number' ? s.top + 'px' : s.top,
      left: typeof s.left === 'number' ? s.left + 'px' : s.left,
      width: s.width, height: s.height,
    });
  }
  // Ring around the target.
  const ring = document.querySelector('.tour-ring');
  if (ring) Object.assign(ring.style, {
    top:    `${rTop}px`,
    left:   `${rLeft}px`,
    width:  `${rW}px`,
    height: `${rH}px`,
  });

  // Tooltip card placement.
  const placement = step.placement || 'bottom';
  const gap = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = card.offsetWidth  || 460;
  const ch = card.offsetHeight || 280;
  let top, left;
  switch (placement) {
    case 'top':
      top  = rTop - ch - gap;
      left = rLeft + rW / 2 - cw / 2;
      break;
    case 'right':
      top  = rTop + rH / 2 - ch / 2;
      left = rRight + gap;
      break;
    case 'left':
      top  = rTop + rH / 2 - ch / 2;
      left = rLeft - cw - gap;
      break;
    case 'bottom':
    default:
      top  = rBottom + gap;
      left = rLeft + rW / 2 - cw / 2;
  }
  const m = 14;
  top  = Math.max(m, Math.min(top,  vh - ch - m));
  left = Math.max(m, Math.min(left, vw - cw - m));
  Object.assign(card.style, {
    position: 'fixed',
    top:  `${top}px`,
    left: `${left}px`,
    transform: 'none',
  });

  // Scroll the target into view if it's clipped.
  if (r.top < 0 || r.bottom > vh) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Keyboard nav while the tour is open: ← back, → next, Esc skip.
window.addEventListener('keydown', (e) => {
  if (!state.tour) return;
  if (e.key === 'Escape')     { e.preventDefault(); endTour(true); }
  if (e.key === 'ArrowRight') { e.preventDefault(); nextTourStep(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); prevTourStep(); }
});

// ────────────────── Icon library ──────────────────
//
// Hairline SVG glyphs, stroke=currentColor so they inherit the surrounding
// text color (sidebar muted ink, active bronze, etc.). 14x14 by default;
// override with size:.
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
  games_howell: 'Games-Howell', dunnett: 'Dunnett',
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
};
const KIND_TO_METHOD_ANCHOR = {
  capability: 'methods-capability', sixpack: 'methods-capability',
  predictive_cpk: 'methods-capability', attribute_capability: 'methods-capability',
  tolerance: 'methods-capability',
  hypothesis_test: 'methods-hypothesis-testing', posthoc: 'methods-post-hoc-multiple-comparisons',
  control_chart: 'methods-control-charts',
  msa: 'methods-gauge-r&r-/-msa',
  regression: 'methods-regression',
  doe: 'methods-design-of-experiments', desirability: 'methods-design-of-experiments',
  reliability: 'methods-reliability',
  multivariate: 'methods-multivariate',
  time_series: 'methods-time-series',
  pareto: 'methods-specialty', distribution_id: 'methods-specialty', anom: 'methods-specialty',
  graph: 'methods-specialty',
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

function renderHeader() {
  // Both labels rendered; CSS shows only the one for the *other* mode so the
  // label flips instantly without a re-render when toggleDarkMode runs.
  const themeBtn = h('button', {
    className: 'icon-btn theme-toggle', title: 'Toggle theme', onclick: toggleDarkMode,
  },
    h('span', { className: 'label-dark' }, 'Light'),
    h('span', { className: 'label-light' }, 'Dark'),
  );

  return h('header', {},
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

function renderSidebar() {
  const nav = h('nav', { className: 'sidebar' });
  const v = state.view, fam = state._analysisFamily || 'all';

  // ─ Workspace — only the user's own stuff (data + projects). ─
  const renderGroup = (label, items) => {
    nav.append(h('div', { className: 'group-label' }, label));
    const ul = h('ul');
    for (const it of items) {
      ul.append(h('li', {
        className: it.active ? 'active' : '',
        onclick: it.onclick,
      }, h('span', { className: 'ico' }, icon(it.iconName)),
         h('span', {}, it.label)));
    }
    nav.append(ul);
  };

  renderGroup('Workspace', [
    { iconName: 'datasets', label: `Datasets · ${state.datasets.length}`,
      active: v === 'data',
      onclick: () => { state.view = 'data'; render(); } },
    { iconName: 'analyses', label: `Analyses · ${state.analyses.length}`,
      active: v === 'analyze' && fam === 'all',
      onclick: () => { state.view = 'analyze'; state._analysisFamily = 'all'; render(); } },
    { iconName: 'recipes', label: `Recipes · ${(state.analyses.filter(a => a.result_json?.recipe).length) || 0}`,
      active: v === 'recipes',
      onclick: () => { state.view = 'recipes'; render(); } },
    { iconName: 'doe', label: `Projects · ${(state.projects || []).length}`,
      active: v === 'projects' || v === 'project',
      onclick: () => { state.view = 'projects'; render(); } },
    { iconName: 'reports', label: `Reports · ${(state.reports || []).length}`,
      active: v === 'reports' || v === 'report',
      onclick: () => { state.view = 'reports'; state._reportId = null; render(); } },
    { iconName: 'graphs', label: 'Insights · originals',
      active: v === 'insights',
      onclick: () => { state.view = 'insights'; render(); } },
    { iconName: 'control', label: 'Process Behavior',
      active: v === 'dashboard',
      onclick: () => { state.view = 'dashboard'; render(); } },
  ]);

  // ─ Analysis families ─ active family expands inline to show its sub-kinds.
  nav.append(h('div', { className: 'group-label' }, 'Analysis'));
  const fams = h('ul');
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

  // ─ Tools ─ Calculators expands inline when on the tools view.
  nav.append(h('div', { className: 'group-label' }, 'Tools'));
  const tools = h('ul');
  const toolsActive = v === 'tools';
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
  nav.append(tools);

  // ─ Learn — reference / educational content. Distinct from Workspace
  //   so the sidebar makes it clear which entries are *your* data vs *our*
  //   library.
  renderGroup('Learn', [
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
    { iconName: 'datasets',   label: 'Resources',
      active: v === 'resources',
      onclick: () => { state.view = 'resources'; render(); } },
  ]);

  // ─ Sibling product — Conyso Lens. External link styled like a sidebar
  //   entry so users discover the data-viz studio without leaving Bench.
  nav.append(h('div', { className: 'group-label' }, 'Conyso family'));
  const sib = h('ul');
  sib.append(h('li', { onclick: () => { window.open('/lens', '_blank', 'noopener'); } },
    h('span', { className: 'ico' }, icon('graphs')),
    h('span', {}, 'Lens · charts & visuals'),
    h('span', { className: 'chev', style: 'opacity:0.5' }, '↗'),
  ));
  nav.append(sib);

  // ─ Community — feedback / roadmap. Pinned at the bottom of Learn so
  //   users can find it from anywhere.
  renderGroup('Community', [
    { iconName: 'recipes',    label: 'Feedback & roadmap',
      active: v === 'feedback' || v === 'feedback_item',
      onclick: () => { state.view = 'feedback'; state._feedbackId = null; render(); } },
  ]);

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
const VIEW_REGISTRY = {
  data: () => DataView(),
  analyze: () => AnalyzeView(),
  tools: () => ToolsView(),
  recipes: () => RecipesView(),
  methods: () => MethodsView(),
  projects: () => ProjectsView(),
  project: () => ProjectView(),
  reports: () => ReportsView(),
  report: () => ReportEditorView(),
  explore: () => ExploreView(),
  insights: () => InsightsView(),
  dashboard: () => DashboardView(),
  guides: () => GuidesView(),
  articles: () => ArticlesView(),
  faq: () => FaqView(),
  resources: () => ResourcesView(),
  feedback: () => FeedbackView(),
  feedback_item: () => FeedbackDetailView(),
};

function renderWorkspace() {
  const sec = h('section', { className: 'workspace' });
  if (state._demoMode) sec.append(renderDemoBanner());
  const viewFn = VIEW_REGISTRY[state.view];
  if (!viewFn) {
    // Unknown route → recover gracefully to Data view rather than blank screen.
    sec.append(h('div', { className: 'card' },
      h('h3', {}, 'Unknown view'),
      h('p', { className: 'muted' }, `No view named "${state.view}". Reset to Data.`),
      h('button', { className: 'secondary', onclick: () => { state.view = 'data'; render(); } }, 'Go to Data')));
    return sec;
  }
  try {
    sec.append(viewFn());
  } catch (e) {
    // One thrown view function used to white-screen the entire SPA. Now it
    // surfaces as an inline error card so the sidebar / header still work
    // and the user can navigate elsewhere.
    console.error(`[view:${state.view}] render failed`, e);
    sec.append(h('div', { className: 'card', style: 'border-left:3px solid var(--danger)' },
      h('h3', {}, 'This view hit an error'),
      h('p', { className: 'muted' }, `${e.message || e}`),
      h('p', { className: 'muted', style: 'font-size:11px;font-family:var(--font-mono, monospace)' },
        (e.stack || '').split('\n').slice(0, 3).join(' · ')),
      h('div', { className: 'row', style: 'gap:8px;margin-top:8px' },
        h('button', { className: 'secondary', onclick: () => { state.view = 'data'; render(); } }, '← Data'),
        h('button', { className: 'ghost', onclick: () => render() }, 'Retry'),
      )));
  }
  return sec;
}

function ArticlesView() {
  const root = h('div');
  root.append(h('div', { className: 'breadcrumb' }, 'Learn · Articles'));
  if (!state._articleId) {
    root.append(
      h('h2', {}, 'Articles',
        h('span', { className: 'muted' }, ' · essays, case studies, opinion from Conyso Labs')),
      h('p', { className: 'guide-deck', style: 'margin-top:6px' },
        'Editorial pieces — longer than guides, sharper voice. New posts arrive as the product evolves.'),
    );
    const grid = h('div', { className: 'tool-index', style: 'margin-top:18px' });
    for (const a of ARTICLES) {
      const card = h('a', { className: 'tool-card', href: '#',
        onclick: (e) => { e.preventDefault(); state._articleId = a.id; render(); window.scrollTo(0,0); } },
        h('div', { className: 'tool-eyebrow' },
          (a.tags || []).join(' · ') || 'Article'),
        h('div', { className: 'tool-title' }, a.title),
        h('div', { className: 'tool-desc' }, a.blurb),
        h('div', { className: 'tool-go article-meta' },
          a.date, ' · ', a.byline || 'Conyso Labs'),
      );
      grid.append(card);
    }
    root.append(grid);
    return root;
  }
  const art = ARTICLES.find(x => x.id === state._articleId);
  if (!art) { state._articleId = null; render(); return root; }
  const i = ARTICLES.findIndex(x => x.id === art.id);
  const prev = i > 0 ? ARTICLES[i - 1] : null;
  const next = i < ARTICLES.length - 1 ? ARTICLES[i + 1] : null;
  const related = (art.related || [])
    .map(id => ARTICLES.find(x => x.id === id) || GUIDES.find(x => x.id === id))
    .filter(Boolean);
  root.append(
    h('div', { className: 'breadcrumb' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); state._articleId = null; render(); },
        style: 'color:var(--muted);text-decoration:none' }, 'Articles'),
      ' · ', art.title),
    h('div', { className: 'article-meta-line' },
      h('span', {}, art.date),
      h('span', {}, '·'),
      h('span', {}, art.byline || 'Conyso Labs'),
      ...(art.tags || []).map(t => h('span', { className: 'article-tag' }, t)),
    ),
    h('h2', { className: 'article-title' }, art.title),
    h('div', { className: 'guide-deck' }, art.blurb),
    h('article', { className: 'guide-body article-body', innerHTML: art.html }),
    related.length ? h('div', { className: 'guide-related' },
      h('div', { className: 'section-label' }, 'Related'),
      h('div', { className: 'guide-related-list' },
        ...related.map(r => {
          // r could be an article or a guide — disambiguate by checking ARTICLES.
          const isArt = ARTICLES.includes(r);
          return h('a', { href: '#',
            ...(isArt ? { onclick: (e) => { e.preventDefault(); state._articleId = r.id; render(); window.scrollTo(0,0); } }
                      : { 'data-nav-guide': r.id }) },
            h('span', { className: 'guide-related-title' }, r.title),
            h('span', { className: 'guide-related-blurb' }, r.blurb),
          );
        }),
      ),
    ) : null,
    h('div', { className: 'guide-nav' },
      prev ? h('a', { href: '#', className: 'guide-nav-prev',
        onclick: (e) => { e.preventDefault(); state._articleId = prev.id; render(); window.scrollTo(0,0); } },
        h('span', { className: 'guide-nav-label' }, '← Previous'),
        h('span', { className: 'guide-nav-title' }, prev.title),
      ) : h('span'),
      next ? h('a', { href: '#', className: 'guide-nav-next',
        onclick: (e) => { e.preventDefault(); state._articleId = next.id; render(); window.scrollTo(0,0); } },
        h('span', { className: 'guide-nav-label' }, 'Next →'),
        h('span', { className: 'guide-nav-title' }, next.title),
      ) : h('span'),
    ),
  );
  return root;
}

function FaqView() {
  const root = h('div');
  root.append(
    h('div', { className: 'breadcrumb' }, 'Learn · FAQ'),
    h('h2', {}, 'FAQ',
      h('span', { className: 'muted' }, ' · answers to the questions we hear most often')),
    h('p', { className: 'guide-deck', style: 'margin-top:6px' },
      'Organised by category. Click any question to expand. Missing answer? Email ',
      h('a', { href: 'mailto:hello@conyso.com', style: 'color:var(--accent)' }, 'hello@conyso.com'),
      '.'),
  );
  for (const grp of FAQ_GROUPS) {
    const block = h('div', { className: 'faq-group' });
    block.append(h('div', { className: 'methods-cat-head' },
      h('span', { className: 'methods-cat-title' }, grp.category),
      h('span', { className: 'methods-cat-count' }, `${grp.items.length}`),
    ));
    for (const item of grp.items) {
      block.append(h('details', { className: 'faq-item' },
        h('summary', {}, item.q),
        h('div', { className: 'faq-answer', innerHTML: item.a }),
      ));
    }
    root.append(block);
  }
  return root;
}

function ResourcesView() {
  const root = h('div');
  root.append(
    h('div', { className: 'breadcrumb' }, 'Learn · Resources'),
    h('h2', {}, 'Resources',
      h('span', { className: 'muted' }, ' · the references behind every method')),
    h('p', { className: 'guide-deck', style: 'margin-top:6px' },
      'Bench stands on standard scientific Python plus 50 years of statistical-quality scholarship. Here\'s where to dig deeper.'),
  );
  for (const grp of RESOURCES) {
    const block = h('div', { className: 'resource-group' });
    block.append(h('div', { className: 'methods-cat-head' },
      h('span', { className: 'methods-cat-title' }, grp.category),
      h('span', { className: 'methods-cat-count' }, `${grp.items.length}`),
    ));
    const list = h('div', { className: 'resource-list' });
    for (const r of grp.items) {
      list.append(h('a', { className: 'resource-row',
        href: r.url, target: '_blank', rel: 'noopener noreferrer' },
        h('div', { className: 'resource-name' }, r.name),
        h('div', { className: 'resource-desc' }, r.desc),
        h('div', { className: 'resource-open' }, 'Visit ↗'),
      ));
    }
    block.append(list);
    root.append(block);
  }
  return root;
}

// ────────────────── GUIDES ──────────────────

const GUIDES = [
  {
    id: 'getting-started', title: 'Getting started', blurb: 'Upload → analyse → read the result in three minutes.',
    related: ['pick-test', 'capability', 'control-charts'],
    html: `
<p>Bench is a workbench, not a wizard. The whole flow is three steps.</p>
<h3>1. Bring in data</h3>
<p>Open <strong>Datasets</strong> in the left rail and upload a CSV, Excel file, or PDF.
Bench auto-detects column types and previews the schema. Files stay on the server you're
running Bench on — nothing leaves the host, no telemetry, no LLM.</p>
<h3>2. Pick the analysis</h3>
<p>Two ways:</p>
<ul>
  <li><strong>Plain English query bar</strong> at the top of the Analyses page —
      try <em>"capability on cycle_time"</em> or <em>"compare yield by line"</em>.
      Bench parses the intent, picks the right analysis kind, and fills the form.</li>
  <li><strong>Left rail</strong> — click an analysis family (Hypothesis tests,
      Control charts, Capability, …). The family expands to show its sub-kinds;
      click one to open its form pre-filled.</li>
</ul>
<p>Unsure? Read <a data-nav-guide="pick-test">Choosing the right test</a> or
launch the wizard from any analyse form. Jump straight to a worked example:
<a data-nav-kind="capability">Capability analysis</a> ·
<a data-nav-kind="control_chart" data-nav-inner="I-MR" data-nav-inner-param="kind">I-MR chart</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="one_way_anova" data-nav-inner-param="test">One-way ANOVA</a>.</p>
<h3>3. Read the result</h3>
<p>Every result card has the same shape:</p>
<ul>
  <li><strong>Metric strip</strong> — headline numerics (e.g. Cp, Cpk, p-value), colour-coded by threshold.</li>
  <li><strong>Interpretation</strong> — plain-English "what this means" paragraph.</li>
  <li><strong>Chart</strong> — sidecar-rendered or inline SVG.</li>
  <li><strong>Action plan</strong> — rule-based next steps.</li>
  <li><strong>Reproducibility</strong> — the audit-trail hash quartet (open the collapsed block).</li>
</ul>
<p>Pin (★) the results you care about to compare side-by-side later. Save analyses as
<strong>recipes</strong> for one-click re-runs on new data.</p>
`},
  {
    id: 'pick-test', title: 'Choosing the right test', blurb: 'A decision tree, demystified.',
    related: ['capability', 'control-charts', 'dmaic'],
    html: `
<p>The most common mistake in hypothesis testing isn't running the wrong test —
it's running the right test on data that doesn't meet its assumptions. Bench
checks assumptions for you before the test runs.</p>
<h3>The four-question decision</h3>
<ol>
  <li><strong>What are you comparing?</strong> One sample to a target → 1-sample t.
      Two samples → 2-sample t. Three or more → ANOVA. Same subjects measured twice → paired.</li>
  <li><strong>Is the response continuous or categorical?</strong> Categorical →
      Chi-square (independence), Fisher's exact (small cells), proportion test.</li>
  <li><strong>Is the data approximately normal?</strong> Bench runs Anderson-Darling
      automatically. If <em>p &lt; 0.05</em>, the parametric test's p-value may be unreliable.
      Fall back to the non-parametric equivalent — Mann-Whitney for 2-sample, Kruskal-Wallis for k-sample.</li>
  <li><strong>Are the group variances equal?</strong> Levene checks this. If they're
      not, swap the standard 2-sample t for Welch's t (Bench's default) or use Games-Howell post-hoc.</li>
</ol>
<h3>Use the Test Chooser</h3>
<p>The <strong>Pick the right test</strong> button on the Analyse form answers
these in plain language. It always names the fallback so you don't get stuck.</p>
<h3>The pre-flight traffic lights</h3>
<p>Before you click Run, Bench shows green/amber/red dots for the assumptions
that matter for your chosen test. Amber doesn't always mean bail out — it means
you're now in a region where you should know what you're doing.</p>
<p style="margin-top:18px">Common tests:
<a data-nav-kind="hypothesis_test" data-nav-inner="one_sample_t"     data-nav-inner-param="test">1-sample t</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="two_sample_t"     data-nav-inner-param="test">2-sample t</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="one_way_anova"    data-nav-inner-param="test">ANOVA</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="mann_whitney"     data-nav-inner-param="test">Mann-Whitney</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="chi_square"       data-nav-inner-param="test">Chi-square</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="mcnemar"          data-nav-inner-param="test">McNemar</a> ·
<a data-nav-kind="posthoc"         data-nav-inner="tukey_hsd"        data-nav-inner-param="test">Tukey HSD</a>.</p>
`},
  {
    id: 'capability', title: 'Reading a capability result', blurb: 'Cp, Cpk, Pp, Ppk — what each number means and what to do.',
    html: `
<p>Process capability tells you whether your process can hit specification. Bench
reports six numbers; here's how to read them.</p>
<h3>Cp — potential capability (spread)</h3>
<p>How wide is your distribution relative to the spec? Cp ≥ 1.33 is standard;
≥ 1.67 for critical-to-quality. <strong>Cp ignores centring.</strong></p>
<h3>Cpk — actual capability (spread + centring)</h3>
<p>Cp adjusted for how off-centre the process is. If Cpk &lt; Cp, you're off the
target. Cpk &lt; 1.0 means defects are happening; Cpk between 1.0 and 1.33 is
marginal.</p>
<h3>Pp / Ppk — long-term equivalents</h3>
<p>Use the overall (long-term) standard deviation instead of the within-subgroup
σ. If Cp and Pp disagree significantly, you have drift or shift between
subgroups — investigate.</p>
<h3>The action plan</h3>
<p>Bench picks one of three diagnoses automatically:</p>
<ul>
  <li><strong>Cpk &lt; Cp by &gt;15%</strong> — process is off-centre. Centre first, before chasing variance.</li>
  <li><strong>Cp &lt; 1</strong> — variance is too high for spec. Tighten the process or widen the spec.</li>
  <li><strong>Cp / Pp gap</strong> — between-subgroup drift. Look upstream of the
      sampling boundary.</li>
</ul>
<p>If everything is bad at once, the recommendation defaults to <strong>Gauge R&amp;R first</strong> —
sometimes the noise you're chasing is in the measurement, not the process.</p>
<p style="margin-top:18px">Run it now:
<a data-nav-kind="capability">Capability (Cpk)</a> ·
<a data-nav-kind="sixpack">Capability Sixpack</a> ·
<a data-nav-kind="msa">Gauge R&amp;R</a> ·
<a data-nav-kind="predictive_cpk">Predictive Cpk</a>.</p>
`,
    related: ['pick-test', 'control-charts', 'dmaic']},
  {
    id: 'control-charts', title: 'Building a control chart', blurb: 'Which chart for which data.',
    html: `
<p>The chart family you pick depends on your data shape.</p>
<table style="margin: 14px 0; border-collapse: collapse; width: 100%">
<tr><th style="text-align: left; padding: 8px 0; border-bottom: 1px solid var(--line)">Your data</th>
    <th style="text-align: left; padding: 8px 0; border-bottom: 1px solid var(--line)">Use</th></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Individual readings, no subgroups</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">I-MR</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Subgroups of n=2..10</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">X-bar/R</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Subgroups of n &gt; 10</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">X-bar/S</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Defective proportion (varying n)</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">p</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Defect count per unit</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">c (constant n) or u (varying n)</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Looking for small persistent shifts</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">CUSUM or EWMA</td></tr>
<tr><td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Multivariate (correlated outputs)</td>
    <td style="padding: 8px 0; border-bottom: 1px solid var(--line)">Hotelling T² or MEWMA</td></tr>
<tr><td style="padding: 8px 0">Short runs / many part numbers</td>
    <td style="padding: 8px 0">Z-MR or DNOM</td></tr>
</table>
<h3>Out-of-control rules</h3>
<p>Bench applies the Western Electric + Nelson rules automatically. Violations
are flagged in red on the chart and listed in the result summary. The rule set:</p>
<ul>
  <li>One point beyond 3σ</li>
  <li>Nine points on one side of the centre line</li>
  <li>Six points in a row trending up or down</li>
  <li>Two of three points beyond 2σ on the same side</li>
  <li>Fourteen points alternating up and down</li>
</ul>
<p>If you're getting too many false-positives, narrow the rule set in the form.</p>
<p style="margin-top:18px">Run a chart:
<a data-nav-kind="control_chart" data-nav-inner="I-MR"    data-nav-inner-param="kind">I-MR</a> ·
<a data-nav-kind="control_chart" data-nav-inner="X-bar/R" data-nav-inner-param="kind">X-bar/R</a> ·
<a data-nav-kind="control_chart" data-nav-inner="EWMA"    data-nav-inner-param="kind">EWMA</a> ·
<a data-nav-kind="control_chart" data-nav-inner="CUSUM"   data-nav-inner-param="kind">CUSUM</a> ·
<a data-nav-kind="control_chart" data-nav-inner="T2"      data-nav-inner-param="kind">Hotelling T²</a> ·
<a data-nav-kind="control_chart" data-nav-inner="MEWMA"   data-nav-inner-param="kind">MEWMA</a>.</p>
`,
    related: ['capability', 'doe', 'dmaic']},
  {
    id: 'doe', title: 'DOE and multi-response optimisation', blurb: 'Pick a design, fit a surface, optimise — the short version.',
    html: `
<p>DOE is three steps in Bench: choose a design, run the experiment, then either
fit a model or optimise.</p>
<h3>Choose a design</h3>
<p>Under <strong>Tools › DOE Design Generator</strong>:</p>
<ul>
  <li><strong>Full factorial</strong> — 2 to 5 factors, full coverage. Becomes expensive past 4 factors.</li>
  <li><strong>Fractional factorial</strong> — half (or quarter, eighth) of full. Pick the resolution that matches your budget.</li>
  <li><strong>Plackett-Burman</strong> — screen 7+ factors in 8/12/16/20 runs. Main effects only.</li>
  <li><strong>Definitive Screening (Jones-Nachtsheim, 2011)</strong> — screen and detect curvature in one shot.</li>
  <li><strong>CCD / Box-Behnken</strong> — response-surface designs for fitting curvature.</li>
  <li><strong>Mixture (simplex)</strong> — when factors are proportions summing to 1.</li>
</ul>
<h3>Fit a surface</h3>
<p>After running the experiment, upload the results and run
<strong>DOE → Factorial fit</strong> or the <strong>Response surface</strong> kind.
Bench reports coefficients, p-values per term, R², adjusted R², and the
predicted single-response optimum (vertex of the quadratic).</p>
<h3>Optimise across multiple responses</h3>
<p>If you care about more than one Y (yield AND cost AND purity), use
<strong>DOE → Multi-response (desirability)</strong>. Paste a JSON spec like:</p>
<pre style="background: var(--surface); padding: 14px; font-size: 12px; font-family: var(--font-mono); border: 1px solid var(--line); border-radius: 3px">[
  {"name": "yield",  "kind": "max", "low": 70, "high": 95, "importance": 5},
  {"name": "cost",   "kind": "min", "low": 8,  "high": 20, "importance": 3},
  {"name": "purity", "kind": "target", "low": 95, "high": 99.5, "target": 98.5, "importance": 5}
]</pre>
<p>Bench fits a quadratic surface per response, then maximises the overall
desirability D (Derringer-Suich, 1980) via multi-start L-BFGS-B over the
coded factor box. The result is the factor settings that best satisfy all
constraints simultaneously, with each response's individual desirability score.</p>
<p style="margin-top:18px">Tools and analyses:
<a data-nav-tool="doe_design">DOE Design Generator</a> ·
<a data-nav-kind="doe">DOE factorial fit</a> ·
<a data-nav-kind="desirability">Multi-response desirability</a>.</p>
`,
    related: ['capability', 'dmaic', 'pick-test']},
  {
    id: 'dmaic', title: 'DMAIC workflow with Bench', blurb: 'Five phases, one project view.',
    html: `
<p>A DMAIC project in Bench bundles a phase checklist with the analyses you ran
to support each phase. Open <strong>Projects</strong> in the sidebar and click
<strong>New project</strong>.</p>
<h3>Define</h3>
<p>Default checklist: charter, SIPOC, voice of the customer, scope. Use this
phase as a notepad — Bench doesn't author the charter for you, but it tracks
what's done.</p>
<h3>Measure</h3>
<p>Run <strong>Gauge R&amp;R</strong> first; if the measurement system fails (% R&amp;R &gt; 30%),
nothing else in the project is reliable. Then run a baseline
<strong>Capability</strong> analysis on the response. Attach both to the Measure
phase.</p>
<h3>Analyze</h3>
<p>Pareto on the defect categories, then hypothesis tests on the suspected X's
(or a regression / DOE if you have many candidates). Pin the analyses that
confirmed each cause. Use <strong>Post-hoc → Hsu MCB</strong> if you have many
groups and want to identify which are the best/worst.</p>
<h3>Improve</h3>
<p>If the cause-effect is well-understood, jump to a solution. Otherwise run a
<strong>DOE</strong> (factorial fit for screening, RSM for optimisation). Use
<strong>Multi-response desirability</strong> when you have competing Ys.</p>
<h3>Control</h3>
<p>Set up a control chart on the improved process. Document a control plan
(checklist item). Re-run capability to confirm sustained gains. Hand over to
the process owner.</p>
<p><strong>What Bench doesn't do (yet):</strong> authoring SIPOC diagrams, fishbone
trees, or value-stream maps. Pair with your project tool of choice.</p>
<p style="margin-top:18px">Start a project:
<a data-nav-guide="capability">Capability primer</a> ·
<a data-nav-guide="doe">DOE primer</a> ·
<a data-nav-guide="reproducibility">Reproducibility</a>.
Or open the <a href="#" onclick="event.preventDefault(); navigate({view:'projects'})">Projects view</a> and start one now.</p>
`,
    related: ['getting-started', 'capability', 'doe']},
  {
    id: 'reproducibility', title: 'Reproducibility & dossiers', blurb: "The audit-trail story Minitab can't tell.",
    html: `
<p>Every Bench result is bound to a four-part hash:</p>
<ul>
  <li><code>software_version</code> — the build of Bench that ran it.</li>
  <li><code>data_hash</code> — SHA-256 of the input data (storage key).</li>
  <li><code>params_hash</code> — SHA-256 of the canonical params JSON.</li>
  <li><code>result_hash</code> — SHA-256 of the canonical result JSON (volatile fields stripped).</li>
</ul>
<p>Re-run the same recipe on the same data and you get bit-identical hashes.
This is impossible to prove with closed-source software — it's why
reproducibility is suddenly Bench's biggest defensive advantage.</p>
<h3>Method dossier (printable)</h3>
<p>Every result has a <strong>Dossier</strong> button. It opens a printable
one-page HTML page listing:</p>
<ul>
  <li>Algorithm name + plain-English description</li>
  <li>The exact library function (e.g. <code>scipy.stats.f_oneway</code>)</li>
  <li>The peer-reviewed citation (e.g. <em>Fisher (1925)</em>)</li>
  <li>Software version + the four hashes</li>
  <li>Every input parameter</li>
  <li>Every output value</li>
</ul>
<p>Print to PDF for your validation package. For regulated industries that need
sealed IQ/OQ/PQ paperwork, Conyso Labs offers commercial authoring — contact
<code>hello@conyso.com</code>.</p>
<h3>When hashes disagree across runs</h3>
<p>If you re-run today and the result_hash differs from yesterday, three
things to check: did the software version change? did the dataset change?
did any default parameter shift? Bench's dossier surfaces all three so the
diff is one-click.</p>
`},
  {
    id: 'migrate', title: 'Migrating from Minitab', blurb: "What comes over, what doesn't, and how to bridge the gaps.",
    html: `
<p>Most teams that try Bench come with years of Minitab muscle memory. Here's
how to move efficiently.</p>
<h3>What comes over</h3>
<ul>
  <li><strong>Your CSVs.</strong> Bench reads CSV, Excel, and even PDF tables.</li>
  <li><strong>Your mental model.</strong> Capability is still Cpk; ANOVA is still ANOVA. Bench's
      Test Chooser uses the same decision tree a Minitab Assistant user would expect.</li>
  <li><strong>Your training.</strong> Every method in Bench cites the original publication
      — see the <strong>Methods</strong> page.</li>
</ul>
<h3>What doesn't come over</h3>
<ul>
  <li><strong>Minitab macros (.MTB / .Exec)</strong> — Bench has no macro language.
      The equivalent is <strong>Recipes</strong> (saved analyses with their params)
      plus the REST API. If you live in macros today, the migration is real work —
      port the most-used 5–10 macros first.</li>
  <li><strong>.mpj project files</strong> — closed format, can't be imported directly.
      Re-run from the source CSV.</li>
  <li><strong>Companion / Workspace project tracking</strong> — Bench's
      <strong>Projects</strong> view covers DMAIC phase + checklist + linked analyses.
      It does <em>not</em> author SIPOC / VSM / fishbone diagrams; pair with another tool.</li>
</ul>
<h3>Validation-equivalence checklist</h3>
<p>Before swapping Bench in for a Minitab-validated workflow:</p>
<ol>
  <li>Re-run 5–10 representative past analyses in both tools. Hashes won't
      match (different software), but the headline numerics should agree to 4
      decimal places.</li>
  <li>For each analysis kind you use, open the Bench source for the relevant
      algorithm (the Methods page links each).</li>
  <li>Decide whether your validation framework accepts open-source provenance.
      Many do today; some still require a sealed kit. For the latter, the
      Conyso Labs commercial validation engagement is the bridge.</li>
</ol>
`},

  // ───────── deeper-dive practitioner guides ─────────

  { id: 'msa-deep', title: 'Gauge R&R: how much measurement noise is too much?',
    blurb: 'Crossed vs nested vs expanded, AIAG criteria, ndc, and when to stop arguing.',
    related: ['capability', 'dmaic', 'pick-test'],
    html: `
<p>If your measurement system is bad, every analysis downstream is contaminated.
Gauge R&amp;R quantifies <em>how much</em> of the variation you see is the gauge,
not the part. Run this <strong>before</strong> any capability study or DOE.</p>

<h3>Pick the design</h3>
<ul>
  <li><strong>Crossed</strong> — every operator measures every part, multiple
      times. The default. Use whenever the measurement is non-destructive.</li>
  <li><strong>Nested</strong> — each operator measures different parts.
      Use for destructive tests (tensile strength, single-shot chemistries).
      You lose the operator×part interaction term — that's the trade-off.</li>
  <li><strong>Expanded</strong> — like crossed but you add variance sources
      (environment, day, gauge serial). Use when the gauge is one of several
      that the team rotates through, or when day-to-day drift is suspected.</li>
</ul>

<h3>Read the result</h3>
<table style="margin:14px 0;border-collapse:collapse;width:100%">
<tr><th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">% GR&amp;R (of study variation)</th>
    <th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Verdict</th></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">&lt; 10%</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Excellent. Trust the gauge.</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">10–30%</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Acceptable for non-critical applications; problematic for tight specs.</td></tr>
<tr><td style="padding:8px 0">&gt; 30%</td>
    <td style="padding:8px 0">Unacceptable. Fix the gauge before continuing the project.</td></tr>
</table>

<h3>ndc — number of distinct categories</h3>
<p>If <strong>ndc &lt; 5</strong>, your gauge can't reliably distinguish the parts
in your range. Even a study with low % GR&amp;R can fail this if the parts
themselves are too similar. AIAG MSA target is ndc ≥ 5.</p>

<h3>Common mistakes</h3>
<ol>
  <li><strong>Treating ndc as advisory.</strong> It isn't. ndc &lt; 5 means
      you cannot do meaningful SPC with this gauge on these parts.</li>
  <li><strong>Running too few parts.</strong> 10 parts spanning the full
      tolerance is the AIAG minimum.</li>
  <li><strong>Operators all measure the same way.</strong> Defeats the point —
      you want them to use their normal technique.</li>
  <li><strong>Ignoring repeatability (EV) vs reproducibility (AV).</strong>
      High EV = the gauge itself is noisy → fix the gauge. High AV = operators
      disagree → fix the procedure / training.</li>
</ol>

<p style="margin-top:18px">Run it now:
<a data-nav-kind="msa" data-nav-inner="crossed"  data-nav-inner-param="design">Crossed GR&amp;R</a> ·
<a data-nav-kind="msa" data-nav-inner="nested"   data-nav-inner-param="design">Nested GR&amp;R</a> ·
<a data-nav-kind="msa" data-nav-inner="expanded" data-nav-inner-param="design">Expanded GR&amp;R</a>.</p>
`},

  { id: 'sample-size', title: 'Sample size & power without the hand-waving',
    blurb: 'How big does n need to be — and why "big enough" depends on three things you have to specify.',
    related: ['pick-test', 'capability', 'doe'],
    html: `
<p>"How many samples do we need?" is the most asked, least-understood question
in Lean Six Sigma. You need three inputs before a calculator can answer:</p>
<ol>
  <li><strong>α</strong> — false-positive rate you accept. Convention: 0.05.</li>
  <li><strong>β / power</strong> — false-negative rate you accept. Power = 1−β.
      Convention: power = 0.80 (so β = 0.20).</li>
  <li><strong>Effect size</strong> — the smallest difference worth detecting.
      <em>This is the one most people skip.</em> "Detect anything" requires
      infinite samples.</li>
</ol>

<h3>Effect-size conventions</h3>
<table style="margin:14px 0;border-collapse:collapse;width:100%">
<tr><th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Family</th>
    <th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Effect-size metric</th>
    <th style="text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">Small / Medium / Large</th></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">t-test</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">δ / σ (Cohen's d)</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.2 / 0.5 / 0.8</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">ANOVA</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Cohen's f</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.10 / 0.25 / 0.40</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">Regression</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Cohen's f² = R²/(1−R²)</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.02 / 0.15 / 0.35</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid var(--line)">Chi-square</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">Cohen's w</td>
    <td style="padding:8px 0;border-bottom:1px solid var(--line)">0.10 / 0.30 / 0.50</td></tr>
<tr><td style="padding:8px 0">Correlation</td>
    <td style="padding:8px 0">r</td>
    <td style="padding:8px 0">0.10 / 0.30 / 0.50</td></tr>
</table>

<p>For a Cpk validation study, the analogy is reversed — you specify the
<em>Cpk margin</em> you need the lower confidence bound to clear, not an
effect size.</p>

<h3>Special cases Bench covers</h3>
<ul>
  <li><strong>TOST equivalence</strong> — to <em>demonstrate</em> two means are
      within a margin. Larger n than the corresponding superiority test.</li>
  <li><strong>Log-rank (survival)</strong> — Schoenfeld's formula via hazard
      ratio and event probability.</li>
  <li><strong>Cluster-randomized</strong> — applies design effect
      <code>DEFF = 1 + (m−1)·ρ</code> to the standard formula.</li>
  <li><strong>Finite population correction</strong> — when sampling &gt; 5% of
      a known population, the required n shrinks via Cochran's FPC.</li>
</ul>

<h3>The bias to fight</h3>
<p>People want to specify <em>what they hope to find</em> (a tiny difference)
but accept the n needed to find a <em>practically important</em> difference.
Pick the smallest difference that would change a decision. Anything smaller
isn't worth detecting.</p>

<p style="margin-top:18px">Open the calculator:
<a data-nav-tool="sample_size">Sample size &amp; power</a>.</p>
`},

  { id: 'hypothesis-deep', title: 'Hypothesis tests in practice',
    blurb: 'p-values, effect sizes, multiple comparisons, and the four mistakes that wreck most projects.',
    related: ['pick-test', 'sample-size', 'capability'],
    html: `
<p>A statistically significant result is not the same as a meaningful result.
This guide is the short version of where that distinction matters.</p>

<h3>p-value ≠ effect size</h3>
<p>With enough samples, every trivially small effect becomes statistically
significant. The fix is to <strong>report both</strong> — the test statistic + p
AND the effect size (Cohen's d, η², r). Bench surfaces both on every result.</p>

<h3>The four mistakes</h3>
<ol>
  <li><strong>Reading the p-value before checking assumptions.</strong> The
      pre-flight traffic lights exist for this. A t-test with non-normal data and
      n=15 can produce an utterly wrong p. Bench falls back to the non-parametric
      equivalent automatically when assumptions fail — let it.</li>
  <li><strong>Running many comparisons, reporting one p-value.</strong> If you
      ran an ANOVA across 8 levels and then ran 28 pairwise tests at α=0.05,
      your familywise error rate is ~75%. Use Tukey HSD or Hsu MCB — both
      control familywise α. Bench's post-hoc tests do this for you.</li>
  <li><strong>Confusing "p &gt; 0.05" with "no effect".</strong> Failing to
      reject H₀ is not evidence of equivalence. For that, run a TOST equivalence
      test with a margin you specify.</li>
  <li><strong>Ignoring confidence intervals.</strong> The CI tells you the
      range of effects compatible with your data. A "significant" result with a
      wide CI that crosses zero in practical terms is barely actionable.</li>
</ol>

<h3>When to use which test</h3>
<p>The flowchart (see <a data-nav-guide="pick-test">Choosing the right test</a>):</p>
<ul>
  <li>One group vs target → 1-sample t (parametric) or sign test (non-parametric)</li>
  <li>Two independent groups → Welch's t or Mann-Whitney U</li>
  <li>Two paired measurements → paired t or Wilcoxon signed-rank</li>
  <li>Three or more groups → one-way ANOVA (then Tukey HSD), or Kruskal-Wallis (then Dunn's)</li>
  <li>Categorical → Chi-square (large cells) or Fisher's exact (small)</li>
  <li>Paired binary → McNemar</li>
  <li>Equivalence (not difference) → TOST</li>
</ul>

<h3>Reporting the result</h3>
<p>Standard format: <em>"A Welch's two-sample t-test on n₁=42, n₂=38 found a
significant difference (t = 3.42, df = 73.8, p &lt; 0.001; Cohen's d = 0.78,
95% CI on the mean difference [1.4, 3.9] units)."</em></p>

<p>Bench produces this paragraph automatically in the <strong>Interpretation</strong>
block on every hypothesis-test result.</p>

<p style="margin-top:18px">Quick links:
<a data-nav-kind="hypothesis_test" data-nav-inner="two_sample_t" data-nav-inner-param="test">2-sample t</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="one_way_anova" data-nav-inner-param="test">ANOVA</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="mann_whitney"  data-nav-inner-param="test">Mann-Whitney</a> ·
<a data-nav-kind="hypothesis_test" data-nav-inner="tost_two_sample" data-nav-inner-param="test">TOST</a> ·
<a data-nav-kind="posthoc"         data-nav-inner="tukey_hsd"    data-nav-inner-param="test">Tukey HSD</a>.</p>
`},

  { id: 'reliability-primer', title: 'Reliability primer',
    blurb: 'Weibull intuition, censoring, MTBF vs B10, and which distribution to fit.',
    related: ['capability', 'control-charts'],
    html: `
<p>Reliability analysis answers two questions: <em>how long until failure?</em>
and <em>what fraction will survive past time t?</em> The math handles a
peculiarity of failure data that most analyses don't: <strong>right-censoring</strong>.</p>

<h3>What censoring means</h3>
<p>You ran a 1000-hour test. Three units failed at 220, 540, 880 hours. Two
units were still running when the test stopped. Those two are <em>censored
at 1000</em> — you know they survived past 1000 hours but not how long they
would have ultimately lasted. Discarding them biases the estimate downward.
Bench's Weibull and exponential fitters handle censoring via MLE.</p>

<h3>Pick the distribution</h3>
<ul>
  <li><strong>Weibull (2-parameter)</strong> — the workhorse. The shape parameter
      β tells you the failure mode: β &lt; 1 = infant mortality (decreasing
      hazard); β = 1 = random failures (constant hazard, = exponential);
      β &gt; 1 = wear-out (increasing hazard).</li>
  <li><strong>Exponential</strong> — special case of Weibull with β = 1. Use
      when failure rate is constant (electronic components in their useful-life
      window).</li>
  <li><strong>Lognormal</strong> — common for repair times, metal fatigue.</li>
  <li><strong>Gamma</strong> — flexible alternative to lognormal.</li>
  <li><strong>Log-logistic</strong> — when hazard rises then falls.</li>
  <li><strong>Smallest extreme value</strong> — weakest-link failures (rope
      strands, chain links). Mathematically Gumbel for minima.</li>
  <li><strong>Largest extreme value</strong> / <strong>GEV</strong> — peak
      loads, peak temperatures, return-period analysis.</li>
  <li><strong>Arrhenius accelerated-life</strong> — when you test at high
      temperatures and need to extrapolate to nominal operating temperature.</li>
</ul>

<p>If you're unsure, run the <a data-nav-kind="distribution_id">Distribution
identifier</a> first — it ranks candidates by Anderson-Darling fit.</p>

<h3>MTBF vs B10</h3>
<p><strong>MTBF</strong> (mean time between failures) is the <em>mean</em> of the
distribution. It includes the long right tail. Half your units fail much
sooner than MTBF.</p>
<p><strong>B10</strong> is the time at which 10% have failed (the 10th
percentile). For warranty design, B10 is usually the right number — it
guarantees a specified survival fraction.</p>

<h3>Common mistakes</h3>
<ol>
  <li><strong>Reporting only mean failure time.</strong> Always report a
      percentile (B10, B50) plus the survival curve.</li>
  <li><strong>Dropping censored data.</strong> Bias downward by exactly the
      fraction censored.</li>
  <li><strong>Fitting normal to failure times.</strong> Failure times are
      almost never symmetric. Use Weibull, lognormal, or gamma.</li>
  <li><strong>Extrapolating Arrhenius too far.</strong> The Arrhenius model
      assumes one failure mechanism. At very high stress, new mechanisms
      activate; the extrapolation breaks.</li>
</ol>

<p style="margin-top:18px">Try it:
<a data-nav-kind="reliability" data-nav-inner="weibull"     data-nav-inner-param="distribution">Weibull</a> ·
<a data-nav-kind="reliability" data-nav-inner="exponential" data-nav-inner-param="distribution">Exponential</a> ·
<a data-nav-kind="reliability" data-nav-inner="lognormal"   data-nav-inner-param="distribution">Lognormal</a> ·
<a data-nav-kind="reliability" data-nav-inner="arrhenius"   data-nav-inner-param="distribution">Arrhenius</a>.</p>
`},

  { id: 'multivariate-primer', title: 'Multivariate primer',
    blurb: 'PCA, clustering, LDA, and Hotelling — when correlated variables actually need it.',
    related: ['control-charts', 'doe'],
    html: `
<p>Multivariate methods exist because most processes have <em>many correlated
outputs</em>. Treating each output independently misses the joint structure
and inflates false-alarm rates on control charts.</p>

<h3>PCA — reduce dimensionality</h3>
<p>Project your high-dimensional data onto a few orthogonal axes that capture
most of the variance. Use cases:</p>
<ul>
  <li>Pre-regression: replace 30 correlated predictors with 5 principal
      components.</li>
  <li>Visualisation: plot 12-dimensional process data on PC1 vs PC2 — clusters
      and outliers pop out.</li>
  <li>Compression: keep PCs explaining 95% of variance; drop the rest.</li>
</ul>
<p><strong>Standardise first.</strong> PCA is variance-driven; without
standardisation the largest-scale variable dominates.</p>

<h3>K-means / Hierarchical — find unknown groups</h3>
<p>K-means: tell it k (number of clusters) and it finds the best k-cluster
partition. Hierarchical: builds a dendrogram showing similarity at every cut.
Use hierarchical when you don't know k; pick k by inspecting the dendrogram.</p>

<h3>LDA — classify into known groups</h3>
<p>Linear Discriminant Analysis is supervised: you tell it which observations
belong to which group, and it finds the directions that best separate them.
The output is a classification rule. If you only want dimensionality
reduction, use PCA; if you want classification with known labels, use LDA.</p>

<h3>Hotelling T² — multivariate SPC</h3>
<p>When you have multiple correlated outputs (length, width, weight, density…),
running separate X-charts for each is wrong — joint behaviour matters. Hotelling
T² collapses the multivariate state into a single distance from the in-control
mean. Use it when:</p>
<ul>
  <li>Outputs are correlated (r &gt; 0.3 between most pairs).</li>
  <li>You can afford to investigate joint signals (T² doesn't tell you which
      variable shifted — that's where MEWMA + decomposition helps).</li>
</ul>

<h3>When NOT to go multivariate</h3>
<p>If outputs are independent (correlations all &lt; 0.2), univariate charts
are usually fine and easier to investigate when they alarm. Multivariate
adds power AND interpretation cost.</p>

<p style="margin-top:18px">Try it:
<a data-nav-kind="multivariate"  data-nav-inner="pca"          data-nav-inner-param="method">PCA</a> ·
<a data-nav-kind="multivariate"  data-nav-inner="kmeans"       data-nav-inner-param="method">K-means</a> ·
<a data-nav-kind="multivariate"  data-nav-inner="lda"          data-nav-inner-param="method">LDA</a> ·
<a data-nav-kind="multivariate"  data-nav-inner="hierarchical" data-nav-inner-param="method">Hierarchical</a> ·
<a data-nav-kind="control_chart" data-nav-inner="T2"           data-nav-inner-param="kind">Hotelling T² chart</a> ·
<a data-nav-kind="control_chart" data-nav-inner="MEWMA"        data-nav-inner-param="kind">MEWMA chart</a>.</p>
`},

  { id: 'time-series', title: 'Time series and forecasting',
    blurb: 'ARIMA without tears: stationarity, differencing, seasonal decomposition.',
    related: ['control-charts', 'getting-started'],
    html: `
<p>Time series methods answer two related questions: <em>is there structure
beyond noise?</em> and <em>what's the next value likely to be?</em></p>

<h3>Stationarity — the precondition</h3>
<p>Most parametric methods (ARIMA, exponential smoothing) assume the series is
<strong>stationary</strong>: mean and variance constant over time, no trend, no
seasonal cycle. Non-stationary data must be transformed first:</p>
<ul>
  <li><strong>Differencing</strong> (d ≥ 1 in ARIMA) — removes linear trend.</li>
  <li><strong>Seasonal differencing</strong> — removes seasonal cycles.</li>
  <li><strong>Log transform</strong> — stabilises variance when amplitude grows
      with level.</li>
</ul>
<p>Use Bench's <strong>Decompose</strong> first to visually separate trend +
seasonal + residual components. The residual should look like noise; if it
doesn't, you've missed something.</p>

<h3>Pick the model</h3>
<ul>
  <li><strong>Exponential smoothing (Holt-Winters)</strong> — fast, robust,
      handles trend + seasonality. The default for short business series.</li>
  <li><strong>ARIMA(p, d, q)</strong> — explicit autoregressive (p) and
      moving-average (q) terms, with d levels of differencing. More flexible.</li>
  <li><strong>Auto-ARIMA</strong> — Bench searches (p, d, q) by AIC for you.
      Start here; tune manually only if auto's choice is unreasonable.</li>
</ul>

<h3>ACF / PACF for diagnosis</h3>
<p>The autocorrelation function (ACF) shows how correlated each point is with
its k-step lag. The partial ACF (PACF) does the same after controlling for
intermediate lags.</p>
<ul>
  <li>ACF decays slowly + PACF cuts off at lag p → AR(p)</li>
  <li>ACF cuts off at lag q + PACF decays slowly → MA(q)</li>
  <li>Both decay → ARMA</li>
</ul>

<h3>How far to forecast</h3>
<p>The honest answer: not far. ARIMA confidence intervals widen rapidly with
horizon. A 12-month forecast on a monthly series usually has CI half-widths
larger than the mean. Forecast no further than 25% of your history length
unless you have a specific reason.</p>

<p style="margin-top:18px">Try it:
<a data-nav-kind="time_series" data-nav-inner="exp_smoothing" data-nav-inner-param="method">Exp. smoothing</a> ·
<a data-nav-kind="time_series" data-nav-inner="arima"         data-nav-inner-param="method">ARIMA</a> ·
<a data-nav-kind="time_series" data-nav-inner="auto_arima"    data-nav-inner-param="method">Auto-ARIMA</a> ·
<a data-nav-kind="time_series" data-nav-inner="decompose"     data-nav-inner-param="method">Decompose</a> ·
<a data-nav-kind="time_series" data-nav-inner="acf_pacf"      data-nav-inner-param="method">ACF / PACF</a>.</p>
`},

  // ─── Leap-ahead batch guides ───
  { id: 'survival', title: 'Kaplan-Meier + log-rank: time-to-event in plain English',
    blurb: 'Survival curves without the medical-journal jargon.',
    related: ['reliability-primer', 'hypothesis-deep'],
    html: `
<p>Survival analysis isn't just medicine. It's any "time until an event" question:
time until a machine fails, until a customer churns, until a part wears out, until a
service ticket gets resolved.</p>
<h3>When to use it</h3>
<ul>
  <li>You have a <strong>time-to-event</strong> column.</li>
  <li>Some observations are <strong>censored</strong> — the event hasn't happened yet
      when the study ended (the customer is still around; the machine is still running).</li>
  <li>You want to compare two or more groups.</li>
</ul>
<p>Bench's Kaplan-Meier estimator handles censoring correctly. A simple mean of
event times would discard the censored cases and bias your answer.</p>
<h3>Reading the output</h3>
<p><strong>S(t)</strong> = probability of surviving past time t. Starts at 1.0,
steps down at each event. <strong>Median survival</strong> = the t where S(t) crosses 0.5.
<strong>RMST</strong> (restricted mean survival time) = area under the curve up to the
last observed event — robust when the median is never reached.</p>
<h3>The log-rank test</h3>
<p>k-sample test for "do these survival curves differ?". <strong>p &lt; 0.05</strong>
means at least two curves are significantly different. It does <em>not</em> tell you
which pair — for that, run pairwise log-rank with Bonferroni adjustment.</p>
<p>Try it: <a data-nav-kind="survival">Kaplan-Meier + log-rank</a>.</p>
`},

  { id: 'mixed-effects', title: 'Linear mixed-effects (LMM): when subjects vary',
    blurb: 'Repeated measures, nested data, ICC — the model GR&R secretly wants.',
    related: ['msa-deep'],
    html: `
<p>Whenever the same unit (person, machine, batch) is measured multiple times, the
observations are <strong>not independent</strong>. A plain ANOVA assumes they are. LMM
fixes this by adding a <strong>random intercept</strong> per subject — each subject gets
their own baseline.</p>
<h3>When to use it</h3>
<ul>
  <li>Repeated measures (same subject, multiple time points or conditions).</li>
  <li>Nested data (students within classes within schools).</li>
  <li>Crossed designs (operator × part, with repeats).</li>
  <li>You want the variance share from each level (the <strong>ICC</strong>).</li>
</ul>
<h3>The formula</h3>
<p>Bench uses statsmodels syntax: <code>y ~ x1 + x2</code> for fixed effects, then a
separate <strong>group</strong> column for the random-intercept variable. Add a random
slope on x with <code>random = '1 + x'</code>.</p>
<h3>What to read</h3>
<p><strong>Fixed-effect coefficients</strong>: same interpretation as OLS. <strong>ICC</strong>: ratio of
between-subject variance to total — tells you how much of the variation is "who you
are" vs "what we did to you". An ICC near 0 means subjects barely differ; near 1 means
the within-subject error is tiny.</p>
<p>Try it: <a data-nav-kind="mixed_effects">Mixed-effects (LMM)</a>.</p>
`},

  { id: 'random-forest', title: 'Random Forest + permutation importance: which X matters?',
    blurb: 'Non-linear, no-assumption variable ranking before you commit to a parametric model.',
    related: ['hypothesis-deep'],
    html: `
<p>Random Forest doesn't assume linearity, doesn't need scaling, handles missing data,
and produces a <strong>defensible importance ranking</strong> for every predictor. It's
not the model you'd ship for prediction — it's the model you run first to see which
inputs are doing real work.</p>
<h3>Two importances</h3>
<ul>
  <li><strong>Impurity importance</strong>: how much each predictor reduces tree-impurity
      when it's used as a split. Fast but biased toward high-cardinality features.</li>
  <li><strong>Permutation importance</strong>: shuffle one predictor at a time and measure
      the drop in OOB performance. Slower but honest. <strong>Use this one</strong>.</li>
</ul>
<h3>When to use it</h3>
<ul>
  <li>You have many candidate X's and want to rank them before regression.</li>
  <li>You suspect interactions or non-linear effects.</li>
  <li>You want a defensible feature-importance story.</li>
</ul>
<h3>The OOB metric</h3>
<p><strong>OOB R²</strong> (for regression) or <strong>OOB accuracy</strong> (for classification) is
out-of-bag — each tree is scored on the rows it didn't train on. Equivalent to
cross-validation, but free. Higher = better.</p>
<p>Try it: <a data-nav-kind="regression" data-nav-inner="random_forest" data-nav-inner-param="method">Random Forest</a>.</p>
`},

  { id: 'agreement', title: 'Attribute Agreement Analysis (Kappa)',
    blurb: 'MSA for pass/fail gages. The κ value tells you whether your inspectors can agree.',
    related: ['msa-deep'],
    html: `
<p>GR&R is for continuous measurements. When inspectors classify (Pass/Fail, OK/Marginal/Bad),
you need <strong>Attribute Agreement Analysis</strong>. Three questions:</p>
<ol>
  <li><strong>Within-appraiser repeatability</strong> — does each inspector agree with themselves on a re-look?</li>
  <li><strong>Between-appraiser agreement</strong> — do inspectors agree with each other?</li>
  <li><strong>Vs standard</strong> — do they agree with the known-good answer (when you have one)?</li>
</ol>
<h3>Kappa (κ)</h3>
<p>Cohen's κ for 2 appraisers, Fleiss' κ for ≥ 3. Both correct for agreement-by-chance.
Read with the <strong>Landis-Koch table</strong>:</p>
<ul>
  <li>&lt; 0.2: slight — the gage is essentially random.</li>
  <li>0.2 – 0.4: fair — needs work.</li>
  <li>0.4 – 0.6: moderate — usable for screening.</li>
  <li>0.6 – 0.8: substantial — production-ready for most uses.</li>
  <li>&gt; 0.8: almost perfect — gold standard.</li>
</ul>
<p>Try it: <a data-nav-kind="agreement">Attribute Agreement Analysis</a>.</p>
`},

  { id: 'cost-pareto', title: 'Cost-weighted Pareto: the 80/20 trap',
    blurb: 'Why the most-frequent defect is rarely the most expensive one.',
    related: [],
    html: `
<p>Standard Pareto charts rank defects by count. <strong>Cost-weighted Pareto</strong> ranks them
by total dollars (count × unit cost), then shows both views side by side.</p>
<p>The trap: a "scratch" might be the most common defect but cost $1 to rework. A "leak" might
appear 5 times in a thousand units but cost $250 each. If you chase the frequency leader, you
fix the cheap problem and leave $1,250 on the table.</p>
<p>Bench flags the disagreement at the top of the chart so you don't miss it.</p>
<p>Try it: <a data-nav-kind="cost_pareto">Cost-weighted Pareto</a>.</p>
`},

  { id: 'pre-flight', title: 'Pre-flight: catch the wrong-test mistake before you run it',
    blurb: 'Bench checks Shapiro, Levene, sample size, and Cochran rules — then recommends.',
    related: ['pick-test', 'hypothesis-deep'],
    html: `
<p>Click <strong>✓ Check assumptions</strong> on the analyse form before <strong>Run</strong>.
Pre-flight runs all the checks your test silently assumes and gives you a traffic-light
verdict + a recommended switch when something fails.</p>
<h3>What it checks per test</h3>
<ul>
  <li><strong>One-sample t</strong>: n ≥ 8, normality, outliers.</li>
  <li><strong>Two-sample t</strong>: per-group normality, Levene's equal-variance test. Fails normality → Mann-Whitney; fails Levene → Welch.</li>
  <li><strong>Paired t</strong>: normality of differences.</li>
  <li><strong>One-way ANOVA</strong>: per-group normality, equal variances.</li>
  <li><strong>Chi-square</strong>: Cochran's rule (expected counts ≥ 5). Violation → Fisher's exact.</li>
  <li><strong>Capability</strong>: AIAG sample size ≥ 30, normality. Non-normal → Box-Cox or Johnson.</li>
  <li><strong>MSA</strong>: AIAG ≥ 10 parts × 3 ops × 2 trials.</li>
  <li><strong>Regression</strong>: n ≥ 10·p, pairwise collinearity ≤ 0.7.</li>
</ul>
<p>If the engine recommends a switch, click "Use recommended" and the form flips
in place with the right params pre-filled.</p>
`},

  { id: 'reproducibility-bundle', title: 'Reproducibility bundles: ship the math, not just the screenshot',
    blurb: 'Export an analysis as a single JSON file that any other Bench instance can re-run byte-for-byte.',
    related: ['reproducibility'],
    html: `
<p>Every analysis card has a <strong>📦 Bundle</strong> button. Click it and Bench downloads a JSON
file containing the dataset (up to 50k rows), the analysis params, the full result, and the
provenance hash quartet (data, params, result, computed_at).</p>
<h3>What it solves</h3>
<p>The hardest question in any quality audit is "can you reproduce this exact number?". Minitab
forces you to also ship the .mpj file <em>and</em> hope the receiver has the same Minitab version.
Bench bundles include everything and are versioned JSON — readable in any text editor for the
next twenty years.</p>
<h3>Re-importing</h3>
<p>POST a bundle to <code>/api/analyses/import</code> on another Bench instance. It re-materialises
the dataset, re-runs the analysis on the receiving sidecar, and reports whether the result
hashes match the bundled ones. Hashes match → the math is reproducible; the chain of custody
is unbroken.</p>
`},
];

// ────────────────── FAQ ──────────────────
//
// Practical Q&A organised by category. Rendered as accordion <details>
// blocks so the page stays scannable.

const FAQ_GROUPS = [
  { category: 'Math & methods', items: [
    { q: 'Why does Bench give a slightly different p-value than Minitab?',
      a: `Both tools implement the same published algorithms, but rounding
          accumulates differently across implementations. Bench typically
          agrees with Minitab to 4–6 decimal places on the standard reference
          datasets. Where they disagree, Bench's source is open — read the
          line and compare to the original publication.` },
    { q: 'Where does the within-subgroup sigma in Cpk come from?',
      a: `For individual observations (no subgroup column), Bench uses the
          AIAG-standard moving-range estimator: σ̂_within = MR̄ / 1.128.
          When you supply a subgroup column, it uses R̄ / d₂(n) instead.
          The overall σ for Pp/Ppk is the ordinary sample standard deviation.
          Both are reported on the result.` },
    { q: 'What\'s the difference between Cp and Pp?',
      a: `Both use the same formula: (USL − LSL) / (6·σ). The difference is
          which σ. Cp uses the within-subgroup σ — short-term, ignoring drift.
          Pp uses the overall σ — long-term, including drift between subgroups.
          A big Cp / Pp gap means the process is drifting between sampling
          windows even if each window looks tight.` },
    { q: 'Why does Cpk differ from Ppk on the same data?',
      a: `Same reason as above — Cpk uses within-subgroup σ, Ppk uses overall σ.
          When they agree closely, your process is stable. When Ppk &lt;&lt; Cpk,
          you have between-subgroup drift even if within-subgroup behaviour is
          fine.` },
    { q: 'How does Bench handle non-normal data for capability?',
      a: `Apply the Box-Cox transform (set transform="box-cox" on the form).
          Bench picks λ automatically by maximum likelihood, reports both raw
          and transformed indices, and translates the spec limits into the
          transformed space.` },
    { q: 'What if my data violates equal variance for a t-test?',
      a: `Bench's 2-sample t default is Welch's t-test (unequal variances).
          For ANOVA, switch to Games-Howell post-hoc when Levene's test flags
          unequal variances. The pre-flight traffic lights show the Levene
          result before you click Run.` },
  ]},
  { category: 'Validation & regulated use', items: [
    { q: 'Is Bench validated for FDA submissions?',
      a: `Bench is not pre-validated as a sealed kit. Methods are open-source
          and citable; per-result method dossiers print algorithm + library
          + citation + reproducibility hashes. Many validation frameworks
          accept this when paired with an internal qualification protocol.
          For pre-authored IQ/OQ/PQ paperwork, contact hello@conyso.com about
          a commercial validation engagement.` },
    { q: 'Can I prove that two runs produced the same result?',
      a: `Yes — every result is bound to a SHA-256 hash quartet (software,
          data, params, result). Re-running the same recipe on the same data
          produces identical hashes. The Dossier button prints them on a one-
          page validation document.` },
    { q: 'How do I diff two runs?',
      a: `Pin both, then click Compare. The comparator highlights any field
          that changed. If software_version differs, you've upgraded; if
          data_hash differs, the data changed; if only result_hash differs,
          you've found a bug — report it.` },
    { q: 'Can Bench run air-gapped?',
      a: `Yes. Docker compose into a closed network. There are no outbound
          license check-ins, telemetry, analytics, or LLM calls. Web fonts
          (Inter / Playfair / Montserrat) are loaded from Google Fonts by
          default but can be replaced with self-hosted woff2 files —
          one-line change in styles.css.` },
  ]},
  { category: 'Deployment & ops', items: [
    { q: 'How do I self-host Bench?',
      a: `<code>docker compose up</code> in the repo root. SQLite + filesystem
          — no Postgres, Redis, or S3 needed. The README has the full setup.
          For Railway / Render / Fly, the single-container Dockerfile at the
          repo root is the supported path.` },
    { q: 'Can I run Bench on Windows?',
      a: `Yes — via Docker Desktop or WSL. Native Windows install isn't
          supported (the sidecar's matplotlib + scipy stack assumes a POSIX
          file layout). For Windows-native users, the hosted version at
          bench.conyso.com requires no install.` },
    { q: "What's the resource footprint?",
      a: `A small Hobby instance handles 10–50 concurrent users. The hot path
          is matplotlib chart rendering (~50ms per analysis). SQLite + WAL
          handles writes for thousands of analyses per workspace before any
          tuning is needed.` },
    { q: 'How do I back up my data?',
      a: `Copy <code>server/data/engine.db</code>. The whole workspace is one
          SQLite file. Charts are PNGs in <code>server/data/</code> alongside
          it. For automated daily backups, schedule a script that tars these
          two paths and ships to your storage of choice.` },
    { q: 'Can my team share a Bench instance?',
      a: `Yes — anyone on the same URL is in the same workspace. There's no
          login (a workspace id is stored in the browser). For multi-tenant
          deployments, put Cloudflare Access or basic-auth in front. For
          team workspaces with per-user attribution, talk to us about the
          enterprise tier.` },
  ]},
  { category: 'Integrations & exports', items: [
    { q: 'Can I import a Minitab .mpj or .mtw file?',
      a: `Not directly — those formats are closed. Export to CSV from Minitab
          (File → Save Worksheet As → CSV). Bench reads CSV, Excel, and PDF
          tables natively.` },
    { q: 'How do I export a result to PowerPoint?',
      a: `Two paths: (1) copy the plain-English interpretation paragraph and
          paste into your deck; (2) click any chart to zoom, then right-click
          → save image. The Dossier (print-to-PDF) is the cleanest single-page
          export.` },
    { q: 'Does Bench have a REST API?',
      a: `Yes — every analysis the UI runs is also a POST. <code>POST
          /api/analyses/run</code> with <code>{kind, datasetId, params}</code>.
          The dispatch table is in <code>server/routes/analyses.js</code>.
          Workspace id goes in the <code>X-Workspace-Id</code> header.` },
    { q: 'Can Bench call a Slack / Teams webhook on a violation?',
      a: `Not built in. You can run an analysis from a cron, parse the result,
          and post to a webhook in ~20 lines of any language. The recipe
          system + REST API are designed for exactly this.` },
  ]},
  { category: 'Comparison & migration', items: [
    { q: 'Should I move my whole team off Minitab?',
      a: `Not necessarily. Bench covers what most Black Belts use ~95% of the
          time. Keep Minitab for any analyses that require validated paperwork
          or for the 5% Bench doesn't cover (e.g. some specialty designs).
          The tools coexist fine.` },
    { q: 'What\'s in Minitab that Bench doesn\'t have?',
      a: `Companion / Workspace (project management with charters, SIPOC,
          VSM, fishbone authoring); a 30-year ecosystem of macros (.MTB / Exec);
          official certification paths; pre-authored validation kits for
          regulated industries. See <a data-nav-guide="migrate">Migrating from
          Minitab</a> for the full map.` },
    { q: 'What\'s in Bench that Minitab doesn\'t have?',
      a: `Per-result reproducibility hashes; printable method dossiers; a
          plain-English query bar; rule-based "what this means" interpretations;
          rule-based action plans; a command palette (⌘K); proper dark mode;
          a REST API; open-source auditable math; air-gapped friendly
          deployment.` },
  ]},
];

// ────────────────── External + internal resources ──────────────────

const RESOURCES = [
  { category: 'Conyso', items: [
    { name: 'Conyso Academy', desc: 'Free Lean Six Sigma curriculum from Conyso. Teaches with Bench from day one.', url: 'https://conyso.com/academy.html' },
    { name: 'Conyso Consulting', desc: 'The Boardroom — premium Lean Six Sigma consulting. Validation packaging, custom deployments, on-call hours.', url: 'https://conyso.com/consulting.html' },
    { name: 'Bill — AI Green Belt', desc: 'Conyso\'s AI assistant for LSS practitioners. Calls Bench under the hood for deterministic math.', url: 'https://conyso.com' },
    { name: 'Bench source code', desc: 'AGPL-3.0. Read the algorithms, fork, contribute. Every method in the Methods page links here.', url: 'https://github.com/conyso/bench' },
  ]},
  { category: 'Standards & authoritative references', items: [
    { name: 'NIST/SEMATECH e-Handbook of Statistical Methods', desc: 'The single best free online reference. Comprehensive, authoritative, no nonsense.', url: 'https://www.itl.nist.gov/div898/handbook/' },
    { name: 'AIAG SPC Reference Manual (2nd ed.)', desc: 'The standard for control charts and capability in automotive and adjacent manufacturing.', url: 'https://www.aiag.org/store/publications/details?ProductCode=SPC-3' },
    { name: 'AIAG MSA Reference Manual (4th ed.)', desc: 'Gauge R&R, bias, linearity, stability — the AIAG framework Bench implements.', url: 'https://www.aiag.org/store/publications/details?ProductCode=MSA-4' },
    { name: 'ISO 16269-6', desc: 'International standard for statistical tolerance intervals.', url: 'https://www.iso.org/standard/57191.html' },
    { name: 'AIAG PPAP (4th ed.)', desc: 'Production Part Approval Process. Bench\'s capability outputs map directly to PPAP submissions.', url: 'https://www.aiag.org/store/publications/details?ProductCode=PPAP' },
  ]},
  { category: 'Books that earn their shelf space', items: [
    { name: 'Douglas C. Montgomery — Introduction to Statistical Quality Control (7e)', desc: 'The textbook for SPC and capability. If you read one book, this is it.', url: 'https://www.wiley.com/en-us/Introduction+to+Statistical+Quality+Control%2C+7th+Edition-p-9781118146811' },
    { name: 'Box, Hunter & Hunter — Statistics for Experimenters (2e)', desc: 'The bible of DOE. Still the clearest explanation of factorial design.', url: 'https://www.wiley.com/en-us/Statistics+for+Experimenters%3A+Design%2C+Innovation%2C+and+Discovery%2C+2nd+Edition-p-9780471718130' },
    { name: 'Meeker & Escobar — Statistical Methods for Reliability Data', desc: 'The standard reference for Weibull, censoring, accelerated life testing.', url: 'https://www.wiley.com/en-us/Statistical+Methods+for+Reliability+Data%2C+2nd+Edition-p-9781118115459' },
    { name: 'Hyndman & Athanasopoulos — Forecasting: Principles and Practice', desc: 'Free online. Best modern intro to time-series forecasting.', url: 'https://otexts.com/fpp3/' },
    { name: 'Jacob Cohen — Statistical Power Analysis for the Behavioral Sciences', desc: 'Where the effect-size conventions (small/medium/large) come from.', url: 'https://www.routledge.com/Statistical-Power-Analysis-for-the-Behavioral-Sciences/Cohen/p/book/9780805802832' },
  ]},
  { category: 'Open-source libraries Bench is built on', items: [
    { name: 'SciPy', desc: 'scipy.stats — the hypothesis tests, distributions, and statistical primitives.', url: 'https://docs.scipy.org/doc/scipy/reference/stats.html' },
    { name: 'statsmodels', desc: 'ANOVA, GLM, ARIMA, mixed models — most of Bench\'s heavyweight stats.', url: 'https://www.statsmodels.org/' },
    { name: 'NumPy', desc: 'Array ops + linear algebra. Powers everything underneath.', url: 'https://numpy.org/' },
    { name: 'pandas', desc: 'Dataframe layer. CSV / Excel parsing, group-by, schemas.', url: 'https://pandas.pydata.org/' },
    { name: 'matplotlib', desc: 'Chart rendering on the sidecar (PNG output).', url: 'https://matplotlib.org/' },
  ]},
];

// ────────────────── Articles ──────────────────
//
// Editorial / opinion / case-study content. Distinct from Guides (which are
// task-oriented walkthroughs). Articles have a date + byline and read like
// essays — longer, sharper voice, no toolbar of runnable links at the bottom.

const ARTICLES = [
  {
    id: 'reproducibility-is-the-new-validation',
    title: 'Reproducibility is the new validation',
    blurb: 'Why a hash quartet on every result is more defensible than a sealed IQ/OQ/PQ kit nobody can re-derive.',
    date: '2026-05-22', byline: 'Conyso Labs',
    tags: ['Regulated', 'Methodology'],
    related: ['reproducibility', 'migrate', 'method-dossier-vs-validation-kit'],
    html: `
<p>Statistical software validation in regulated industries has, for thirty
years, meant the same thing: a vendor publishes an IQ/OQ/PQ paperwork kit,
your firm hires QA, runs the kit against installed software, signs the
forms, and files them. The expectation is that the next auditor accepts
this paperwork at face value. The expectation is that nobody re-derives.</p>

<p>This contract is showing its age.</p>

<p>The contract was viable when statistical tools changed every five years.
It is dangerously stale in a world where every patch may quietly reshape a
p-value. The honest question is: <em>can you prove that the result on your
desk was produced by the algorithm in the paperwork?</em></p>

<h3>What we shipped instead</h3>

<p>Bench binds every result to a four-part SHA-256 hash. Software version.
Data hash. Params hash. Result hash. The hashes are written next to the
numerics on the result card and on the printable dossier. Re-run the same
recipe on the same data and they are bit-identical.</p>

<p>This is a different kind of evidence than the IQ/OQ/PQ kit. The kit
asserts "this version of the software has been qualified." The hash
asserts "this <em>specific run</em> produced this <em>specific output</em>,
and we can prove it." The first is paperwork. The second is mathematics.</p>

<h3>Why this matters in 2026</h3>

<p>Regulators are moving. FDA's 2023 guidance on AI/ML-based Software as a
Medical Device introduced the concept of a <em>predetermined change control
plan</em> — a framework where software is allowed to evolve provided the
evolution itself is auditable. The same instinct will reach traditional
statistical software within the decade. When it does, the differentiator
will not be who has the prettiest IQ kit. It will be who can show their
software's source, version, and per-result hash.</p>

<p>For now, the practical posture: pair Bench's per-result dossiers with
your firm's existing qualification protocol. The dossier replaces the
"output capture" step many protocols already do informally. The reproducibility
hash makes that capture machine-verifiable.</p>

<p>A sealed kit can be a useful artefact for your auditor today. It is not
a substitute for proof.</p>
`,
  },
  {
    id: 'why-cpk-was-broken',
    title: 'Why most Cpk numbers you\'ve been reading are wrong',
    blurb: 'A subtle implementation choice in nearly every spreadsheet template equates Cp and Pp. The fix is one line of code.',
    date: '2026-05-21', byline: 'Conyso Labs',
    tags: ['Capability', 'Methodology'],
    related: ['capability', 'msa-deep'],
    html: `
<p>Open ten Cpk spreadsheets from ten different manufacturers. In nine of
them, the formula for σ in Cpk is the same as the formula for σ in Ppk —
the sample standard deviation of all observations. AIAG SPC, Chapter 4,
explicitly disagrees. So does Montgomery. So does the Cpk you would
have gotten if you'd run it in Minitab against subgrouped data.</p>

<p>This is not exotic. It is the most-pasted capability template error in
quality engineering.</p>

<h3>The right number</h3>

<p>Cpk uses <em>within-subgroup</em> σ. The intuition: Cpk is the capability
you have <em>between bouts of drift</em>. It tells you whether the process,
during a single stable run, can hit spec. Ppk uses <em>overall</em> σ — total
variability including drift between subgroups. The gap between Cpk and Ppk
is the cost of your drift.</p>

<p>The AIAG-standard estimators:</p>
<ul>
  <li>With subgroups of size n: σ̂_within = R̄ / d₂(n), where R̄ is the mean
      of subgroup ranges and d₂ is a tabulated constant.</li>
  <li>With individuals (no subgroups): σ̂_within = MR̄ / 1.128, where MR̄
      is the mean moving range and 1.128 is d₂(2).</li>
</ul>

<p>Sample σ is used for Pp, Ppk. Never for Cp, Cpk.</p>

<h3>Why the wrong number ships</h3>

<p>The wrong number ships because it is <em>easier</em>. <code>STDEV()</code>
exists in every spreadsheet. The moving-range estimator does not. Quality
engineers paste a template, validate the totals look reasonable, and the
error propagates for years.</p>

<p>The consequence is that organisations chase variance reduction
projects when their problem is centring, or vice versa. A Cpk that equals
Ppk is a Cpk that has been quietly miscalculated. It tells you nothing
about drift — by construction.</p>

<h3>What Bench does now</h3>

<p>As of this commit Bench separates the two estimators. The capability
analysis surfaces both σ_within and σ_overall on every result. The metric
strip shows Cp, Cpk, Pp, Ppk — and they differ when there is drift, as they
should.</p>

<p>If you are migrating from a spreadsheet that gave you a single number,
expect to see a gap appear. The gap was always there. You can finally
see it.</p>
`,
  },
  {
    id: 'method-dossier-vs-validation-kit',
    title: 'The method dossier vs. the validation kit',
    blurb: 'A printable one-page audit trail per result is more useful than a 200-page sealed binder for one version.',
    date: '2026-05-19', byline: 'Conyso Labs',
    tags: ['Regulated', 'Audit'],
    related: ['reproducibility-is-the-new-validation', 'migrate'],
    html: `
<p>Click <em>Dossier</em> on any Bench result. You get one page. Algorithm
name. Library function (<code>scipy.stats.ttest_ind</code> with arguments).
Reference (Welch, 1947). Software version. Data hash, params hash, result
hash. Every parameter that went in. Every numeric that came out.</p>

<p>Print it. File it next to the run. The next auditor reads one page and
can re-derive the result in any environment that has the same SciPy
version.</p>

<h3>What this replaces</h3>

<p>It replaces the "we keep the Minitab outputs in a SharePoint folder"
practice that most regulated firms quietly run. Not the validation kit
itself — but the per-run record-keeping that the kit assumes you have.</p>

<p>The validation kit still has a role. It certifies that the installed
software matches the qualified version. The dossier certifies that this
specific run was produced by that software with those parameters. Both
matter; one is a binder, the other is a hash.</p>

<h3>What we don't pretend</h3>

<p>The dossier is not a regulatory submission. It is a defensible audit
artifact. For a sealed IQ/OQ/PQ submission, Conyso Labs offers commercial
validation authoring — that is a paid engagement, sized for one company,
scoped to one regulatory framework. Most teams will find the dossier
sufficient. The ones that don't will know quickly.</p>
`,
  },
  {
    id: 'open-source-in-regulated-industries',
    title: 'The case for open-source statistical tooling in regulated industries',
    blurb: 'Closed-source statistical software was a defensible default in 1995. In 2026 it is an audit liability.',
    date: '2026-05-15', byline: 'Conyso Labs',
    tags: ['Regulated', 'Open source'],
    related: ['reproducibility-is-the-new-validation', 'migrate'],
    html: `
<p>The orthodoxy says regulated industries need closed-source software
because closed-source can be validated. The orthodoxy is wrong about which
direction validation flows.</p>

<p>An auditor's job is to confirm that the software did what it claimed.
With closed source, "what it did" is asserted by the vendor and accepted on
trust plus paperwork. With open source, "what it did" is a property
inspectable directly. Both can be validated. Only one can be re-derived.</p>

<h3>Three concrete cases where open beats closed</h3>

<ol>
  <li><strong>A regulator asks how an outlier-flagging algorithm works.</strong>
      With Bench, the algorithm is 50 lines of NumPy and a citation. With a
      closed tool, the answer is "vendor documentation" — which may or may
      not match the binary.</li>
  <li><strong>A customer asks for a custom test variant.</strong> With
      Bench, fork the function. With a closed tool, file a feature request
      with the vendor's product team and wait two years.</li>
  <li><strong>A bug is found.</strong> With Bench, patch it and file a PR.
      With a closed tool, hope the vendor agrees it's a bug and schedules
      a hotfix.</li>
</ol>

<p>None of these are theoretical. All three happen in pharma, automotive,
and aerospace every quarter.</p>

<h3>The remaining argument</h3>

<p>The strongest argument for closed-source in regulated industries is:
"we want one throat to choke if something goes wrong." This is real, and
it is what Conyso Labs sells: commercial support, validation authoring,
on-call hours, SLAs. The throat is available. The code is also available.
You don't have to pick.</p>
`,
  },
  {
    id: 'when-desirability-is-wrong',
    title: 'When multi-response desirability is the wrong tool',
    blurb: 'Derringer-Suich is the default. It is not always the answer.',
    date: '2026-05-11', byline: 'Conyso Labs',
    tags: ['DOE', 'Methodology'],
    related: ['doe', 'capability'],
    html: `
<p>Derringer-Suich desirability is what most DOE tools reach for when you
have multiple responses to optimise. It is convenient, well-published, and
the default in Minitab and Bench. It is also a specific philosophical
choice, and worth knowing the alternatives.</p>

<h3>What desirability assumes</h3>

<p>Desirability collapses every response into a [0, 1] score, then takes
the geometric mean weighted by importance. The geometric mean penalises
zeros heavily — if one response misses its constraint, overall D is zero
regardless of how good the others are. This is desirability's main feature:
all constraints must be (somewhat) met.</p>

<p>Three assumptions hide in this:</p>
<ol>
  <li><strong>The shape of d_i is right.</strong> Linear by default. You can
      crank the weight to make d_i drop faster near a bound — but the choice
      is a knob, not a number that comes from the physics.</li>
  <li><strong>Importance weights are commensurable.</strong> Saying yield is
      "5" and cost is "3" is a judgment call that the optimiser then treats
      as a mathematical fact.</li>
  <li><strong>Zero on one response = zero overall.</strong> Hard constraints
      are encoded by setting that response's low bound. There is no
      "we'd really like this but could live without" register.</li>
</ol>

<h3>When to reach for something else</h3>

<ul>
  <li><strong>Pareto fronts.</strong> If you cannot pre-rank responses,
      enumerate the trade-off curve and let a human pick. Bench doesn't
      ship this yet; the desirability optimum is one point on the front.</li>
  <li><strong>Goal programming.</strong> When you have a hard target and a
      cost function for deviation in either direction. Closer to engineering
      tolerance reasoning than desirability.</li>
  <li><strong>Constrained optimisation.</strong> When some responses are
      hard constraints and only one is to be maximised. Don't pretend the
      hard constraints are soft via desirability — use a real solver.</li>
</ul>

<p>Desirability is a good default. It is not the only path.</p>
`,
  },
  {
    id: 'hsu-mcb-vs-tukey',
    title: 'Hsu MCB vs. Tukey HSD: pick what you actually need',
    blurb: 'Tukey tells you who differs. Hsu MCB tells you who could be best. These are different questions.',
    date: '2026-05-06', byline: 'Conyso Labs',
    tags: ['Methodology', 'Hypothesis testing'],
    related: ['hypothesis-deep', 'pick-test'],
    html: `
<p>You ran a one-way ANOVA across k groups. The p-value is small. Now you
want a follow-up. Tukey HSD is what every textbook reaches for. It tells
you which pairs of groups have statistically distinguishable means.</p>

<p>That is rarely the question you actually need to answer.</p>

<h3>What you usually want</h3>

<p>"Which supplier is the best?" "Which machine produces the highest yield?"
"Which combination is the lowest cost?" These are <em>identify the
extremum</em> questions. Tukey HSD answers them only indirectly: it gives
you a matrix of pairwise differences and you eyeball which group has the
highest mean that isn't statistically beaten.</p>

<p>Hsu's Multiple Comparisons with the Best (MCB, 1984) answers the question
directly. For each group it computes a one-sided simultaneous confidence
interval on the difference from "the best of the others." Groups whose CI
contains zero are still candidates for "the best." Groups whose CI excludes
zero are not.</p>

<p>The output is short: a list of groups that remain candidates for being
the best. That list might have one element (clear winner). It might have
three (a tie). Either way, it is the answer.</p>

<h3>When Tukey still wins</h3>

<ul>
  <li>You care about the full pairwise structure, not just the extremum.</li>
  <li>The grouping variable isn't ordinal and "best" doesn't apply
      (different colours of a paint, different days of the week).</li>
  <li>You're publishing a paper and a reviewer is going to ask for the
      pairwise matrix anyway.</li>
</ul>

<h3>How to think about it</h3>

<p>Ask yourself: <em>am I trying to find the best one</em> (Hsu MCB) <em>or
the full structure of who differs from whom</em> (Tukey)? Most industrial
decisions are the first. Most published papers report the second. Bench
ships both; the decision is yours.</p>
`,
  },
];

function GuidesView() {
  const root = h('div');
  root.append(h('div', { className: 'breadcrumb' }, 'Learn · Guides'));
  if (!state._guideId) {
    root.append(h('h2', {}, 'Guides',
      h('span', { className: 'muted' }, ' · short walkthroughs for the common workflows')));
    const grid = h('div', { className: 'tool-index', style: 'margin-top:18px' });
    for (const g of GUIDES) {
      grid.append(h('a', {
        className: 'tool-card', href: '#',
        onclick: (e) => { e.preventDefault(); state._guideId = g.id; render(); },
      },
        h('div', { className: 'tool-eyebrow' }, 'Guide'),
        h('div', { className: 'tool-title' }, g.title),
        h('div', { className: 'tool-desc' }, g.blurb),
        h('div', { className: 'tool-go' }, 'Read →'),
      ));
    }
    root.append(grid);
    return root;
  }
  const g = GUIDES.find(x => x.id === state._guideId);
  if (!g) {
    state._guideId = null; render(); return root;
  }
  // Build a previous/next pair so reading order is natural.
  const i = GUIDES.findIndex(x => x.id === g.id);
  const prev = i > 0 ? GUIDES[i - 1] : null;
  const next = i < GUIDES.length - 1 ? GUIDES[i + 1] : null;
  // "Related" rail derived from the article's `related` field.
  const relatedGuides = (g.related || [])
    .map(id => GUIDES.find(x => x.id === id))
    .filter(Boolean);
  const relatedSection = relatedGuides.length ? h('div', { className: 'guide-related' },
    h('div', { className: 'section-label' }, 'Related'),
    h('div', { className: 'guide-related-list' },
      ...relatedGuides.map(rg => h('a', { href: '#', 'data-nav-guide': rg.id },
        h('span', { className: 'guide-related-title' }, rg.title),
        h('span', { className: 'guide-related-blurb' }, rg.blurb),
      )),
    ),
  ) : null;

  root.append(
    h('div', { className: 'breadcrumb' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); state._guideId = null; render(); },
        style: 'color:var(--muted);text-decoration:none' }, 'Guides'),
      ' · ', g.title),
    h('h2', {}, g.title),
    h('div', { className: 'guide-deck' }, g.blurb),
    h('article', { className: 'guide-body', innerHTML: g.html }),
    relatedSection,
    h('div', { className: 'guide-nav' },
      prev ? h('a', { href: '#', className: 'guide-nav-prev',
        onclick: (e) => { e.preventDefault(); state._guideId = prev.id; render(); window.scrollTo(0, 0); } },
        h('span', { className: 'guide-nav-label' }, '← Previous'),
        h('span', { className: 'guide-nav-title' }, prev.title),
      ) : h('span'),
      next ? h('a', { href: '#', className: 'guide-nav-next',
        onclick: (e) => { e.preventDefault(); state._guideId = next.id; render(); window.scrollTo(0, 0); } },
        h('span', { className: 'guide-nav-label' }, 'Next →'),
        h('span', { className: 'guide-nav-title' }, next.title),
      ) : h('span'),
    ),
  );
  return root;
}

// ────────────────── DMAIC PROJECTS ──────────────────

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
    h('h2', {}, p.name),
    p.description ? h('p', { style: 'color:var(--muted);max-width:62ch;margin:0 0 22px' }, p.description) : null,
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
        h('button', { className: 'ghost',
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
      root.append(h('div', { className: 'muted', style: 'padding:18px 0;font-style:italic' }, 'Loading…'));
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
    root.append(h('div', { className: 'muted', style: 'padding:18px' }, 'Loading…'));
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
          const x = h('button', { className: 'ghost', style: 'font-size:11px;color:var(--danger);padding:0 6px' }, '×');
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
    root.append(h('div', { className: 'muted', style: 'padding:24px 0;font-style:italic' }, 'Loading rows…'));
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

  // KPI strip
  root.append(h('div', { className: 'metric-strip', style: 'margin-bottom:18px' },
    h('div', { className: 'metric danger' },
      h('div', { className: 'label' }, 'Red'),
      h('div', { className: 'value' }, String(counts.red))),
    h('div', { className: 'metric warn' },
      h('div', { className: 'label' }, 'Amber'),
      h('div', { className: 'value' }, String(counts.amber))),
    h('div', { className: 'metric success' },
      h('div', { className: 'label' }, 'Green'),
      h('div', { className: 'value' }, String(counts.green))),
    h('div', { className: 'metric' },
      h('div', { className: 'label' }, 'Total charts'),
      h('div', { className: 'value' }, String(tiles.length))),
  ));

  // Sort: red first, then amber, then green; within each by most recent.
  tiles.sort((a, b) => {
    const order = { red: 0, amber: 1, green: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (b.a.created_at || 0) - (a.a.created_at || 0);
  });

  const grid = h('div', { className: 'dash-grid',
    style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px' });
  for (const t of tiles) {
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
    );
    grid.append(tile);
  }
  root.append(grid);
  return root;
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
    root.append(h('div', { className: 'muted', style: 'padding:24px 0;font-style:italic' }, 'Loading rows…'));
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
  const grid = h('div', { className: 'insight-grid', style: 'display:grid;grid-template-columns:280px 1fr;gap:18px;align-items:start' });

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
  const preview = h('div', { className: 'mono',
    style: 'background:var(--surface);border:1px solid var(--line);padding:6px 10px;margin-top:8px;font-size:12px' },
    'y ~ ');

  const updatePreview = () => {
    const resp = respSel.value;
    const fixed = fixedChecks.filter(c => c.cb.checked && c.name !== resp)
      .map(c => c.name);
    preview.textContent = `${resp} ~ ${fixed.length ? fixed.join(' + ') : '1'}`;
  };
  respSel.addEventListener('change', updatePreview);
  for (const c of fixedChecks) c.cb.addEventListener('change', updatePreview);
  updatePreview();

  const apply = h('button', { className: 'primary' }, 'Apply');
  const cancel = h('button', { className: 'ghost' }, 'Cancel');
  const modal = h('div', { className: 'modal-backdrop',
    style: 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center',
    onclick: (e) => { if (e.target.classList.contains('modal-backdrop')) modal.remove(); },
  },
    h('div', { className: 'card', style: 'max-width:560px;width:90vw;max-height:80vh;overflow:auto' },
      h('h3', { style: 'margin:0 0 4px' }, 'Mixed-effects formula builder'),
      h('p', { className: 'muted', style: 'font-size:12px;margin:0 0 12px' },
        'Pick the response (the y) and any fixed-effect predictors (x\'s).'),
      h('label', { className: 'field' }, 'Response (numeric)', respSel),
      h('div', { className: 'field' },
        h('div', { style: 'font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px' },
          'Fixed-effect predictors'),
        h('div', {}, ...fixedChecks.map(c => c.node))),
      preview,
      h('p', { className: 'muted', style: 'font-size:11px;margin:6px 0 0;font-style:italic' },
        'Set the grouping column (random intercept) on the form\'s "group" field after applying.'),
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:14px' },
        cancel, apply)));
  document.body.append(modal);

  cancel.onclick = () => modal.remove();
  apply.onclick = () => {
    targetInput.value = preview.textContent;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    modal.remove();
    toast({ kind: 'success', msg: `Formula set: ${preview.textContent}` });
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

// ────────────────── DATA VIEW ──────────────────

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
    sampleList.append(h('div', { className: 'muted', style: 'font-size:12px;font-style:italic' }, 'Loading…'));
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

  ingestGrid.append(uploadCard, pasteCard, sampleCard);
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
      'T2','MEWMA','Z-MR','short_run',
    ] },
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
    { name: 'method', kind: 'enum', options: ['pca','kmeans','lda','hierarchical','hotelling'] },
    { name: 'columns', kind: 'cols' },
    { name: 'k', kind: 'num', optional: true },
    { name: 'class_col', kind: 'col', optional: true },
  ]},
  time_series:          { label: 'Time series',                 params: [
    { name: 'method', kind: 'enum', options: ['exp_smoothing','arima','auto_arima','decompose','acf_pacf','cross_correlation','changepoint'] },
    { name: 'value_col', kind: 'col', numeric: true },
    { name: 'time_col', kind: 'col', optional: true },
    { name: 'horizon', kind: 'num', optional: true, defaultValue: 12 },
  ]},
  posthoc:              { label: 'Post-hoc (Tukey/Dunnett/Hsu)', params: [
    { name: 'test', kind: 'enum', options: ['tukey_hsd','fisher_lsd','games_howell','dunnett','hsu_mcb'] },
    { name: 'value_col', kind: 'col', numeric: true },
    { name: 'group_col', kind: 'col' },
    { name: 'control_group', kind: 'string', optional: true },
    { name: 'direction', kind: 'enum', options: ['best_is_largest','best_is_smallest'], optional: true },
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
  mixed_effects:        { label: 'Linear mixed-effects (LMM)',  params: [
    { name: 'fixed', kind: 'string',
      help: "Statsmodels formula, e.g. 'y ~ x + treatment'" },
    { name: 'group', kind: 'col',
      help: 'Grouping column for random effects (e.g. subject_id).' },
    { name: 'random', kind: 'string', optional: true, defaultValue: '1',
      help: "Random-effects formula. '1' = random intercept; '1 + x' = random slope on x." },
    { name: 'reml', kind: 'bool', optional: true, defaultValue: true },
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
    { name: 'Cp / Cpk / Pp / Ppk', lib: 'custom · per Montgomery',            ref: 'AIAG PPAP; Montgomery (2012)' },
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

  if (!state.formOpen) return card;

  // Query bar
  const queryInput = h('input', {
    placeholder: 'Try: "capability on cycle_time" or "compare yield by line"',
    style: 'flex:1',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const parsed = window.statsUx?.parseQuery(queryInput.value);
      if (!parsed) { toast({ kind: 'warn', msg: "Couldn't parse. Try the form below." }); return; }
      const kindMap = { capability: 'capability', control_chart: 'control_chart',
        hypothesis_test: 'hypothesis_test', pareto: 'pareto', msa: 'msa',
        regression: 'regression', reliability: 'reliability',
        distribution_id: 'distribution_id', kmeans: 'multivariate', pca: 'multivariate' };
      const target = kindMap[parsed.kind] || parsed.kind;
      if (!ANALYSIS_KINDS[target]) { toast({ kind: 'warn', msg: `"${parsed.kind}" not yet wired.` }); return; }
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
        toast({ kind: 'success', msg: 'Form filled. Review and click Run.' });
      }, 60);
    },
  });
  card.append(h('div', { className: 'row', style: 'margin-bottom:12px' },
    h('span', { style: 'font-size:14px' }, '⌕'), queryInput));

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
        const help = window.statsUx?.helpFor(kindSel.value);
        if (help) toast({ kind: 'info', title: ANALYSIS_KINDS[kindSel.value]?.label,
          msg: help, duration: 8000 });
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

  renderParams(kindSel.value);
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
        onclick: () => {
          const sel = state.analyses.filter(a => pinned.has(a.id));
          if (sel.length >= 2) window.statsUx?.openComparator(sel);
        },
      }, `Compare (${pinned.size})`));
    wrap.append(head);

    for (const a of filtered) wrap.append(renderAnalysisCard(a, pinned, refresh));
  }
  refresh();
  return wrap;
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
    isStale ? h('button', { className: 'ghost', style: 'font-size:11px;margin-left:4px',
      title: 'Re-run this analysis against the current dataset',
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
    h('button', { className: 'ghost', style: 'font-size:11px', title: pinned.has(a.id) ? 'Unpin' : 'Pin',
      onclick: () => { pinned.has(a.id) ? pinned.delete(a.id) : pinned.add(a.id); refreshFn(); },
    }, pinned.has(a.id) ? 'Pinned' : 'Pin'),
    h('button', { className: 'ghost', style: 'font-size:11px', title: 'Save as recipe',
      onclick: async () => {
        const name = prompt('Recipe name?');
        if (!name) return;
        await api.patch(`/api/analyses/${a.id}/recipe`, { name }).catch(() => {});
        toast({ kind: 'success', msg: `Saved as "${name}".` });
        await refreshData(); render();
      },
    }, 'Save'),
    h('button', { className: 'ghost', style: 'font-size:11px', title: 'Copy summary to clipboard',
      onclick: () => window.statsUx?.copySummary(summary || {}) }, 'Copy'),
    h('button', { className: 'ghost', style: 'font-size:11px', title: 'Download CSV',
      onclick: () => window.statsUx?.downloadCsv(`${a.kind}.csv`, summary || {}) }, 'CSV'),
    a._demo ? null : h('button', { className: 'ghost', style: 'font-size:11px',
      title: 'Method dossier (print to PDF) — algorithm, citation, inputs, outputs, hashes',
      onclick: () => window.open(`/api/analyses/${a.id}/dossier`, '_blank', 'noopener') }, 'Dossier'),
    a._demo ? null : h('button', { className: 'ghost accent-tint', style: 'font-size:11px',
      title: 'Make an LSS report from this analysis — Capability study, Gauge R&R write-up, Tollgate, A3, FMEA, more',
      onclick: (e) => { e.stopPropagation(); openMakeReportMenu(a, e.currentTarget); } }, '📝 Make Report'),
    a._demo ? null : h('button', { className: 'ghost', style: 'font-size:11px',
      title: 'Download reproducibility bundle — dataset + params + result + hashes in one JSON file',
      onclick: (e) => { e.stopPropagation();
        downloadAuthed(`/api/analyses/${a.id}/bundle`,
          `bench-bundle-${a.kind}-${a.id.slice(0,8)}.json`,
          'Bundle downloaded.');
      }
    }, '📦 Bundle'),
    a._demo ? null : h('button', { className: 'ghost', style: 'font-size:11px',
      title: 'Download as Excel (.xlsx) — summary + tables + provenance',
      onclick: (e) => { e.stopPropagation();
        downloadAuthed(`/api/analyses/${a.id}/xlsx`,
          `bench-${a.kind}-${a.id.slice(0,8)}.xlsx`,
          'Excel exported.');
      },
    }, '📊 Excel'),
    h('button', { className: 'ghost', style: 'font-size:11px', title: 'Delete analysis',
      onclick: async () => {
        if (!confirm('Delete this analysis?')) return;
        await api.delete(`/api/analyses/${a.id}`).catch(() => {});
        await refreshData(); render();
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
  api.post('/api/analyses/narrative', { kind: a.kind, summary }).then(r => {
    if (!r || !r.headline) { headline.remove(); return; }
    headline.querySelector('.headline-text').textContent = r.headline;
    if (r.subhead) headline.querySelector('.headline-sub').textContent = r.subhead;
    if (r.verdict) {
      const colour = r.verdict === 'act' ? 'var(--success, #2f7d3a)'
                   : r.verdict === 'caution' || r.verdict === 'underpowered' ? 'var(--danger, #b03a3a)'
                   : 'var(--accent)';
      headline.style.borderLeftColor = colour;
    }
  }).catch(() => headline.remove());

  // Metric strip — premium hairline row of headline numerics (capability,
  // hypothesis_test, regression, msa). Null for kinds without a canonical set.
  const strip = window.statsUx?.renderMetricStrip(a.kind, summary);
  if (strip) card.append(strip);

  // Plain-English interpretation (rule-based)
  const interp = window.statsUx?.renderInterpretation(a.kind, summary);
  if (interp) card.append(interp);

  // Annotations
  const ann = window.statsUx?.renderAnnotations(a.result_json?.annotations);
  if (ann) card.append(ann);

  // Chart
  if (a.chart_storage_key) {
    const img = h('img', { className: 'chart', src: `/artifact/${a.chart_storage_key}`, style: 'margin-bottom:8px' });
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
  api.post('/api/analyses/followups', {
    kind: a.kind, summary, request: a.params_json || {},
  }).then(r => {
    const items = (r && r.followups) || [];
    if (!items.length) return;
    fuHost.style.display = 'block';
    fuHost.append(h('div', { style: 'font-size:10px;letter-spacing:0.16em;color:var(--muted);text-transform:uppercase;margin-bottom:6px' },
      'Suggested follow-ups'));
    const chipRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' });
    const colorOf = (pri) => pri === 'high' ? 'var(--accent)' : pri === 'medium' ? 'var(--ink-2)' : 'var(--muted)';
    for (const f of items) {
      const chip = h('button', {
        className: 'chip',
        style: `font-size:11px;padding:5px 10px;border:1px solid ${colorOf(f.priority)};
                background:transparent;color:${colorOf(f.priority)};cursor:pointer;
                border-radius:99px;line-height:1.3;text-align:left`,
        title: f.reason || '',
        onclick: () => {
          // Navigate to the follow-up analysis, pre-filling params via the
          // centralised navigate() so target.params is the canonical path.
          navigate({ kind: f.kind, params: f.params || {} });
          toast({ kind: 'info', msg: f.reason || `Opening ${f.label}` });
        },
      }, f.label);
      chipRow.append(chip);
    }
    fuHost.append(chipRow);
  }).catch(() => {});

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

const TOOLS_INDEX = [
  { id: 'dpmo',         label: 'DPMO ↔ Sigma',         blurb: 'Convert defects-per-million-opportunities to sigma level (with or without the 1.5σ shift).',                         render: () => DpmoCalc() },
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
        'Six self-contained calculators. Each one is a single answer to a single question — sample size, DPMO, distributions, DOE designs, acceptance plans, synthetic data.'),
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
  );
  const factorsInput = h('input', { placeholder: 'Comma-separated factor names', value: 'A,B,C' });
  const result = h('div', { style: 'margin-top:8px' });
  const btn = h('button', { className: 'primary', onclick: () => withLoading(btn, async () => {
    const factors = factorsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const r = await api.post('/api/tools/doe-design', { design: designSel.value, factors });
    const runs = r.summary?.runs || [];
    const cols = Object.keys(runs[0] || {});
    result.innerHTML = '';
    if (!runs.length) { result.textContent = 'No runs.'; return; }
    result.append(h('p', { className: 'muted', style: 'font-size:12px' }, `${r.summary.n_runs} runs · ${r.summary.design}`));
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
    ), btn, result,
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
