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
      // `toasted` tells the global error handler this was already surfaced to
      // the user, so it doesn't fire a duplicate generic "Something broke".
      throw Object.assign(new Error(msg), { status: 0, code: 'network_error', toasted: true });
    }
    clearTimeout(timer);
    let json; try { json = await r.json(); } catch { json = {}; }
    if (!r.ok) {
      const raw = json.error || json.detail || `${r.status} ${r.statusText}`;
      // The Node layer prefixes proxied sidecar errors with "sidecar /path NNN:"
      // — useful in logs, noise in a toast. Strip it so the user sees just the
      // reason ("column 'NOPE' not in dataset").
      const msg = String(raw).replace(/^sidecar\s+\/\S+\s+\d{3}:\s*/, '');
      toast({ kind: 'error', title: 'Request failed', msg });
      // `toasted`: already shown to the user — global handler skips the dup.
      throw Object.assign(new Error(msg), { status: r.status, body: json, toasted: true });
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
// Wire Escape-to-close on a body-appended modal, and auto-clean the listener
// when the modal leaves the DOM by any path. Keeps modal accessibility
// consistent (the cmdk palette and report popovers already do this).
function attachEscClose(modal) {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const prevFocus = document.activeElement;   // restore on close
  const onKey = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      return;
    }
    if (e.key === 'Tab') {
      // Focus trap — keep Tab/Shift-Tab cycling inside the modal.
      const items = Array.from(modal.querySelectorAll(FOCUSABLE))
        .filter(el => el.offsetParent !== null);   // visible only
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(modal)) {
      document.removeEventListener('keydown', onKey);
      obs.disconnect();
      // Return focus to whatever opened the modal (button), per WAI-ARIA.
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch {}
      }
    }
  });
  obs.observe(document.body, { childList: true });
  // Mark as a dialog for assistive tech if not already.
  if (!modal.getAttribute('role')) modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  // Focus the first focusable control so keyboard users land inside the modal.
  requestAnimationFrame(() => {
    const f = modal.querySelector(FOCUSABLE);
    if (f) f.focus();
  });
}

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
    h('button', { className: 'close', 'aria-label': 'Dismiss notification', onclick: () => el.remove() }, '×'),
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
    // Errors already surfaced by api._do carry a `toasted` flag — don't show a
    // duplicate generic toast on top of the specific one the user already saw.
    if (err && (err.toasted || (err.reason && err.reason.toasted))) return;
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

function skeleton({ lines = 3, withTitle = true, block = 0 } = {}) {
  const wrap = h('div', { 'aria-busy': 'true', 'aria-label': 'Loading…' });
  if (withTitle) wrap.append(h('div', { className: 'skel title' }));
  for (let i = 0; i < lines; i++) {
    // Deterministic widths (no Math.random — avoids width flicker on re-render).
    const w = [88, 72, 95, 64, 80][i % 5];
    wrap.append(h('div', { className: 'skel line', style: `width:${w}%` }));
  }
  for (let i = 0; i < block; i++) {
    wrap.append(h('div', { className: 'skel block', style: 'margin:10px 0' }));
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
    const overlay = h('div', { className: 'chart-zoom-overlay', tabindex: '-1',
      role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Enlarged chart — click or press Escape to close',
      onclick: () => overlay.remove() },
      h('img', { src: e.target.src, alt: e.target.alt || 'Enlarged analysis chart' }));
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.focus?.());
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

// Natural-language synonyms so a query like "when will it be done" or "is it
// normal" lands on the right tool. Deterministic — no AI. Keyed by kind/inner.
const CMDK_SYNONYMS = {
  capability: 'cpk ppk capable process capability spec limits', hypothesis_test: 'compare test significance p-value',
  one_sample_t: 't-test mean vs target', two_sample_t: 'compare two means groups difference',
  one_way_anova: 'compare several groups means anova', two_way_anova: 'two factor anova interaction',
  mann_whitney: 'nonparametric compare medians rank', kruskal: 'nonparametric anova',
  wilcoxon_signed_rank: 'paired nonparametric', chi_square: 'contingency association counts',
  control_chart: 'spc stability monitor in control', msa: 'gauge r&r measurement system repeatability reproducibility ndc',
  regression: 'model predict relationship fit y x', ridge: 'regularized multicollinearity', lasso: 'regularized variable selection',
  doe: 'design of experiments factorial optimize factors', desirability: 'multi response optimize',
  reliability: 'weibull life failure mtbf', survival: 'kaplan meier time to event hazard',
  multivariate: 'pca cluster lda factor analysis manova', correlation: 'relationship pearson',
  survey: 'likert cronbach alpha questionnaire scale voice of customer voc reliability of scale',
  text_pareto: 'comments complaints free text voc themes keywords', variance_budget: 'sources of variation decompose contribution',
  cycle_time: 'lead time flow days throughput', delivery_forecast: 'when will it be done monte carlo throughput agile sprint forecast eta',
  pareto: 'vital few 80/20 defects prioritize', distribution_id: 'which distribution fit normal nonnormal',
  bayesian: 'posterior credible bayes', tolerance: 'tolerance interval', sixpack: 'capability six pack',
  monte_carlo: 'simulation tolerance dfss predict', littles_law: 'wip throughput flow',
};

function buildCmdkIndex() {
  const idx = [];
  const go = (view, extra) => () => { state.view = view; if (extra) extra(); render(); };
  // Views / platform
  const V = [
    ['Catalog', 'Go to', 'everything browse all home toolkit', go('catalog')],
    ['Data', 'Go to', 'upload import datasets connect url', go('data')],
    ['Worksheet', 'Go to', 'grid spreadsheet edit cells rename column', go('worksheet')],
    ['Graph Builder', 'Go to', 'chart scatter box histogram bar plot visualize', go('graph_builder')],
    ['Pipelines', 'Go to', 'recipe chain transform replay', go('pipelines')],
    ['Projects · DMAIC Copilot', 'Go to', 'dmaic project copilot define measure analyze improve control tollgate a3', go('projects')],
    ['Reports', 'Go to', 'report deliverable', go('reports', () => { state._reportId = null; })],
    ['Process Behavior', 'Go to', 'control chart board spc dashboard', go('dashboard')],
    ['Validation & Governance', 'Go to', 'nist strd audit lock certification reproducible', go('validation')],
    ['Learning Paths', 'Learn', 'learn tutorial teach guided green belt black belt', go('learn_paths')],
    ['Guides', 'Learn', 'help docs how-to', go('guides', () => { state._guideId = null; })],
    ['Methods', 'Learn', 'provenance algorithm citation reference', go('methods')],
    ['Insights · originals', 'Go to', 'conyso originals variance budget capability trajectory', go('insights')],
  ];
  for (const [label, sub, kw, action] of V) idx.push({ label, sub, kw, action });
  // Every analysis + sub-kind, from the families.
  for (const f of (typeof ANALYSIS_FAMILIES !== 'undefined' ? ANALYSIS_FAMILIES : [])) {
    if (f.id === 'all' || !f.subs) continue;
    for (const s of f.subs) {
      idx.push({ label: s.label, sub: f.label,
        kw: `${CMDK_SYNONYMS[s.kind] || ''} ${CMDK_SYNONYMS[s.inner] || ''} ${f.label} analysis`,
        action: () => navigate({ kind: s.kind, inner: s.inner, innerParam: s.innerParam }) });
    }
  }
  // Calculators.
  for (const t of (typeof TOOLS_INDEX !== 'undefined' ? TOOLS_INDEX : []))
    idx.push({ label: t.label, sub: 'Calculator', kw: `${t.blurb} ${CMDK_SYNONYMS[t.id] || ''} calculator`,
      action: () => { state.view = 'tools'; state._toolKind = t.id; render(); } });
  // Datasets.
  for (const d of state.datasets)
    idx.push({ label: d.name, sub: 'Dataset', kw: 'use data analyze',
      action: () => { state.current_dataset = d; state.view = 'worksheet'; render(); } });
  // Recent analyses.
  for (const a of (state.analyses || []).slice(0, 15))
    idx.push({ label: (ANALYSIS_KINDS[a.kind]?.label || a.kind) + ' result', sub: 'Saved analysis', kw: 'open result',
      action: () => { state.view = 'analyze'; state._analysisFamily = 'all'; state._scrollToAnalysis = a.id; render(); } });
  // Quick actions.
  idx.push({ label: 'Upload dataset', sub: 'Action', kw: 'import csv excel file', action: () => triggerUpload() });
  idx.push({ label: 'Pick the right test', sub: 'Action', kw: 'chooser which test recommend help decide', action: () => window.statsUx?.openTestChooser(applyChosenTest) });
  idx.push({ label: 'Toggle theme', sub: 'Action', kw: 'dark light mode', action: () => { closeCmdK(); toggleDarkMode(); } });
  return idx;
}

// Deterministic relevance score. 0 = no match.
function cmdkScore(q, it) {
  if (!q) return 1;
  const label = it.label.toLowerCase(), hay = `${it.label} ${it.sub} ${it.kw}`.toLowerCase();
  if (label === q) return 1000;
  if (label.startsWith(q)) return 880;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.every(t => hay.includes(t))) {
    let s = 500;
    if (label.includes(q)) s += 220;                                   // contiguous in label
    if (tokens.every(t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(hay))) s += 80;  // word-boundary
    return s;
  }
  // Fuzzy: query chars appear in order within the label.
  const lab = label.replace(/\s+/g, ''), qq = q.replace(/\s+/g, '');
  let j = 0; for (let i = 0; i < lab.length && j < qq.length; i++) if (lab[i] === qq[j]) j++;
  if (j === qq.length) return 200;
  return 0;
}

function openCmdK() {
  if (state.cmdkOpen) return;
  state.cmdkOpen = true;
  const items = buildCmdkIndex();
  let active = 0, filtered = items.slice(0, 40);

  const input = h('input', {
    placeholder: 'Search everything — analyses, calculators, data, "compare two groups"…', autofocus: true,
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
    filtered = items.map(it => ({ it, s: cmdkScore(q, it) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.it.label.length - b.it.label.length)
      .slice(0, q ? 30 : 40)
      .map(x => x.it);
    if (active >= filtered.length) active = 0;
    list.innerHTML = '';
    if (!filtered.length) { list.append(h('div', { className: 'empty' }, `No matches for “${q}”`)); return; }
    filtered.forEach((it, i) => {
      list.append(h('div', {
        className: `item ${i === active ? 'active' : ''}`,
        onclick: () => { closeCmdK(); it.action(); },
        onmouseover: () => { active = i; refresh(); },
      },
        h('span', {}, it.label),
        h('span', { className: 'item-kind' }, it.sub),
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
  const [ds, an, pj, rp, rt, pl] = await Promise.all([
    api.get('/api/datasets').catch(() => ({ datasets: [] })),
    api.get('/api/analyses').catch(() => ({ analyses: [] })),
    api.get('/api/projects').catch(() => ({ projects: [] })),
    api.get('/api/reports').catch(() => ({ reports: [] })),
    state.reportTemplates?.length
      ? Promise.resolve({ templates: state.reportTemplates })
      : api.get('/api/reports/templates').catch(() => ({ templates: [] })),
    api.get('/api/pipelines').catch(() => ({ pipelines: [] })),
  ]);
  state.datasets = ds.datasets || [];
  state.analyses = an.analyses || [];
  state.projects = pj.projects || [];
  state.reports = rp.reports || [];
  state.reportTemplates = rt.templates || [];
  state.pipelines = pl.pipelines || [];
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
        cpk_ci: { lo: 0.783, hi: 0.957, se: 0.0445, conf: 0.95 },
        ppk_ci: { lo: 0.727, hi: 0.893, se: 0.0421, conf: 0.95 },
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
// Every tour step. `essential: true` marks the spine shown in the Quick
// overview; the Deep dive shows all of them. Steps with a `setup` mutate view
// state — that runs BEFORE render (in gotoTourStep) so the target exists when
// we position the spotlight. Selectors are kept in sync with the live two-rail
// UI (data-rail hooks on the primary rail, .query-bar, .metric-strip, …).
