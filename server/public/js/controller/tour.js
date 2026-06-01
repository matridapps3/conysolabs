const TOUR_ALL = [
  {
    essential: true,
    selector: '.nav-rail',
    placement: 'right',
    title: 'Two-rail navigation',
    body: `Icons on the far left switch <strong>section</strong> — Catalog,
           Data, Analyze, Tools, Projects, Reports, Learn, More. The panel beside
           them shows just that section's items, so the breadth never becomes a
           wall. Everything Bench can do is one rail-click away.`,
  },
  {
    selector: '[data-rail="catalog"]',
    placement: 'right',
    setup: () => { state.view = 'catalog'; },
    title: 'Catalog — the map of everything',
    body: `Every analysis, calculator, and tool in one searchable place, grouped
           by DMAIC phase. Start here when you know <em>what</em> you want but not
           <em>where</em> it lives.`,
  },
  {
    selector: '[data-rail="data"]',
    placement: 'right',
    setup: () => { state.view = 'worksheet'; },
    title: 'Data, worksheet & connectors',
    body: `Upload CSV/Excel, or pull from a live URL that refreshes on demand.
           The <strong>Worksheet</strong> edits like a spreadsheet — rename, drop,
           edit cells, add columns. Build repeatable transform <strong>recipes</strong>
           and the <strong>Graph Builder</strong> for quick visuals.`,
  },
  {
    essential: true,
    selector: '[title*="Command palette"]',
    placement: 'bottom',
    title: 'Smart search (⌘K)',
    body: `<kbd>⌘K</kbd> opens a search over <em>everything</em> — analyses,
           calculators, data, every view. It's fuzzy and understands plain
           language: try <em>“compare two groups”</em>, <em>“is it normal?”</em>,
           or <em>“when will it be done”</em>.`,
  },
  {
    essential: true,
    selector: '.query-bar',
    placement: 'bottom',
    setup: () => { state.view = 'analyze'; state.formOpen = true; },
    title: 'Plain-English query bar',
    body: `Don't know the test name? Just describe it. <em>capability on
           cycle_time</em> or <em>compare yield by line</em> picks the analysis
           and fills the form for you — review, then Run.`,
  },
  {
    selector: '.analyze-form button.secondary',
    placement: 'bottom',
    setup: () => { state.view = 'analyze'; state.formOpen = true; },
    title: 'Pick the right test',
    body: `Prefer to be guided? Answer three or four questions and Bench chooses
           the correct test — including the nonparametric fallback when your data
           fails normality or equal-variance checks.`,
  },
  {
    selector: '.analyze-form',
    placement: 'right',
    setup: () => { state.view = 'analyze'; state.formOpen = true; },
    title: 'Assumption checks — before you run',
    body: `<strong>✓ Check assumptions</strong> runs a pre-flight on your data and
           warns you <em>before</em> the analysis if an assumption is violated —
           the opposite of finding out afterward.`,
  },
  {
    essential: true,
    selector: '.metric-strip',
    placement: 'bottom',
    setup: () => { state.view = 'analyze'; },
    title: 'Anatomy of a result',
    body: `Every result opens with a <strong>metric strip</strong> of headline
           numbers, colour-coded by threshold (gold = warning, red = act). Below:
           a plain-English interpretation, the chart, and suggested follow-ups —
           no stats degree required.`,
  },
  {
    selector: 'details.provenance',
    placement: 'top',
    setup: () => { state.view = 'analyze'; },
    title: 'Reproducible & shareable',
    body: `Each result carries a four-part hash —
           <code>software · data · params · result</code> — so a re-run proves
           identical. Lock it, export a bundle, or <strong>share a read-only
           link</strong>. Closed tools can't prove reproducibility; Bench can.`,
  },
  {
    selector: '[data-rail="projects"]',
    placement: 'right',
    setup: () => { state.view = 'projects'; },
    title: 'Projects & the DMAIC Copilot',
    body: `Organise work as a Define→Measure→Analyze→Improve→Control project. The
           <strong>Copilot</strong> recommends the next right analysis for your
           phase and flags tollgate readiness — all rule-based, no AI — then
           generates an A3 summary.`,
  },
  {
    selector: '[data-rail="tools"]',
    placement: 'right',
    setup: () => { state.view = 'tools'; state._toolKind = null; },
    title: 'Tools — standalone calculators',
    body: `Quick calculators that don't need a dataset: power & sample size,
           Monte-Carlo, tolerance stack-up, Little's Law, NIST validation, and
           more. Grab a number without a full analysis run.`,
  },
  {
    selector: '[data-rail="more"]',
    placement: 'right',
    setup: () => { state.view = 'validation'; },
    title: 'Validation & governance',
    body: `Under <strong>More</strong>: the method index, an append-only audit
           log, analysis locking, and <strong>NIST StRD validation</strong> —
           Bench agrees with certified reference values to 10+ significant digits.
           Proof you can take to an auditor.`,
  },
  {
    selector: '[data-rail="learn"]',
    placement: 'right',
    setup: () => { state.view = 'learn_paths'; },
    title: 'Learn by doing',
    body: `The <strong>Learn</strong> section has guided Learning Paths, how-to
           Guides, deep-dive Articles, and an FAQ — enough to take someone from
           zero to running real Lean Six Sigma analyses.`,
  },
  {
    essential: true,
    selector: 'header .header-meta',
    placement: 'bottom',
    title: 'You\'re set',
    body: `<kbd>⌘K</kbd> searches everything · the <strong>Tour</strong> button
           reopens this walkthrough · the toggle flips dark / light. When in
           doubt, head to <strong>Learn</strong>. Welcome aboard.`,
  },
];

// Steps for the active mode: Quick overview = essentials only; Deep dive = all.
function tourSteps() {
  return state.tour && state.tour.mode === 'deep'
    ? TOUR_ALL
    : TOUR_ALL.filter(s => s.essential);
}

// Track the highlighted element so we can clean its class on step change.
let _tourHighlighted = null;

function startTour() {
  // mode left undefined → syncTour shows the Quick / Deep chooser first.
  state.tour = { step: 0 };
  render();
}
// Jump to a step, applying its view setup BEFORE render so the spotlight target
// is present in the DOM when positionTour runs.
function gotoTourStep(i) {
  if (!state.tour) return;
  const steps = tourSteps();
  i = Math.max(0, Math.min(i, steps.length - 1));
  state.tour.step = i;
  state.tour._retries = 0;
  const step = steps[i];
  if (step && step.setup) step.setup();
  render();
}
function nextTourStep() {
  if (!state.tour || !state.tour.mode) return;
  if (state.tour.step >= tourSteps().length - 1) return endTour(true);
  gotoTourStep(state.tour.step + 1);
}
function prevTourStep() {
  if (!state.tour || !state.tour.mode) return;
  gotoTourStep(state.tour.step - 1);
}
// Called from the chooser — lock in a mode and enter at step 0.
function pickTourMode(mode) {
  if (!state.tour) return;
  state.tour.mode = mode;
  gotoTourStep(0);
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
  // No mode yet → show the Quick / Deep chooser.
  if (!state.tour.mode) {
    if (!_tourRoot || _tourRoot.dataset.mode !== 'choose') {
      if (_tourRoot && _tourRoot.parentNode) _tourRoot.parentNode.removeChild(_tourRoot);
      _tourRoot = buildChooserShell();
      document.body.appendChild(_tourRoot);
    }
    return;
  }

  const step = tourSteps()[state.tour.step];
  // setup() already ran in gotoTourStep before this render.
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

// The first screen: choose Quick overview vs Deep dive. A centered card with
// two big choices; no spotlight (no step selected yet).
function buildChooserShell() {
  const overlay = h('div', { className: 'tour-overlay',
    onclick: (e) => { if (e.target === overlay) endTour(true); } });
  overlay.dataset.mode = 'choose';
  const choice = (mode, tag, time, desc) =>
    h('button', { className: 'tour-choice', onclick: () => pickTourMode(mode) },
      h('span', { className: 'tour-choice-head' },
        h('span', { className: 'tour-choice-tag' }, tag),
        h('span', { className: 'tour-choice-time' }, time)),
      h('span', { className: 'tour-choice-desc' }, desc));
  overlay.append(h('div', { className: 'tour-card centered tour-chooser' },
    h('div', { className: 'tour-card-meta' }, 'Welcome to Conyso Bench'),
    h('h3', {}, 'How much do you want to see?'),
    h('div', { className: 'tour-body' },
      'The free Lean Six Sigma statistical workbench. Pick a tour — you can reopen it anytime from the header.'),
    h('div', { className: 'tour-choices' },
      choice('quick', 'Quick overview', '~60 sec',
        'Just the essentials: navigation, smart search, running an analysis, and reading a result.'),
      choice('deep', 'Deep dive', 'Every feature',
        'The full tour — Catalog, worksheet & connectors, all analysis families, projects & DMAIC Copilot, validation & governance, and learning.')),
    h('div', { className: 'tour-actions' },
      h('button', { className: 'ghost', onclick: () => endTour(true) }, 'Skip for now')),
  ));
  return overlay;
}

function fillTourCard(card) {
  if (!card) return;
  const steps = tourSteps();
  const i = state.tour.step;
  const total = steps.length;
  const step = steps[i];
  const modeLabel = state.tour.mode === 'deep' ? 'Deep dive' : 'Quick overview';
  card.innerHTML = '';
  card.append(
    h('div', { className: 'tour-card-meta' }, `Step ${i + 1} of ${total} · ${modeLabel}`),
    h('h3', {}, step.title),
    h('div', { className: 'tour-body', innerHTML: step.body }),
    h('div', { className: 'tour-progress' },
      ...Array.from({ length: total }, (_, j) =>
        h('span', {
          className: 'tour-pip' + (j === i ? ' on' : j < i ? ' done' : ''),
          onclick: () => gotoTourStep(j),
          title: steps[j].title,
        })),
    ),
    h('div', { className: 'tour-actions' },
      h('button', { className: 'ghost', onclick: () => endTour(true) }, 'Skip tour'),
      // On the Quick overview, offer the full tour without forcing a restart.
      state.tour.mode === 'quick'
        ? h('button', { className: 'ghost', style: 'margin-left:4px',
            onclick: () => pickTourMode('deep'), title: 'Show every feature' }, 'See everything →')
        : null,
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
  if (!state.tour || !state.tour.mode) return;
  const step = tourSteps()[state.tour.step];
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
