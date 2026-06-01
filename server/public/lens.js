// Conyso Lens — visual exploration studio. Sibling product to Bench.
//
// Architecture:
//   - State + API (shares workspace with Bench)
//   - InteractiveFrame: one shared SVG frame that gives EVERY chart
//     hover-crosshair / brush-zoom / click-annotate / SVG+PNG export.
//   - 26 chart builders organised by intent (Distribution, Relationship,
//     Time, Categorical, Multi-variate, LSS). Each builder declares a spec
//     consumed by InteractiveFrame OR (for categorical / 2-D-density
//     charts) implements its own lighter interactive layer.
//   - Plain-English interpreter under every chart, anchored to published
//     LSS thresholds (Cohen d, Pearson r bands, AIAG, skewness windows).
//   - Editorial chrome that matches Bench's brand DNA: Playfair Display
//     titles, bronze accents, hairline rules, generous spacing.

'use strict';

// ─── DOM helpers ───
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'className')         el.className = v;
    else if (k === 'innerHTML')    el.innerHTML = v;
    else if (k.startsWith('on'))   el[k.toLowerCase()] = v;
    else if (k.includes('-') || k === 'role' || k === 'viewBox')
                                    el.setAttribute(k, v);
    else                            el[k] = v;
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid?.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
}
const $ = (s, r = document) => r.querySelector(s);

// ─── Tiny API + state ───
const api = {
  get:  (p)    => fetch(p, { headers: hdr() }).then(parseResp),
  post: (p, b) => fetch(p, { method: 'POST', headers: hdr(true),
                              body: JSON.stringify(b || {}) }).then(parseResp),
};
function hdr(json) {
  const out = { 'X-Workspace-Id': state.wid || '' };
  if (json) out['Content-Type'] = 'application/json';
  return out;
}
async function parseResp(r) {
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { error: t }; }
  if (!r.ok) throw new Error(j.error || 'http ' + r.status);
  return j;
}

const state = {
  wid: null,
  datasets: [],
  current: null,
  rows: null,
  rowsTotal: null,
  selectedChart: 'histogram',
  config: {},
  theme: localStorage.getItem('bench-theme') || 'dark',
};

// ═══════════════════════════════════════════════════════════════════════
//  Interactive frame — every numeric chart gets the same goodies
// ═══════════════════════════════════════════════════════════════════════
//
// spec = {
//   kind, title?,                      // export filename
//   width, height,
//   pad: {l, r, t, b},
//   xRange: [min,max],  yRange: [min,max],
//   xLabel?, yLabel?,
//   xLabels?: string[]                 // categorical x (skips brush)
//   formatX?, formatY?: (v) => string
//   points: [{i, x, y, label?, meta?, color?}]
//   overlays: [{id, label, defaultOn, build(g, {xScale, yScale, plot, view})}]
//   draw(svgEl, {xScale, yScale, plot, view})  // chart body (called each redraw)
//   brushable?: bool (default true)
//   onAnnotate?(annotation)
// }

function fmtNum(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 10000) return v.toExponential(1);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const range = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(range / count)));
  const err = (count / range) * step0;
  let factor = 1;
  if (err <= 0.15) factor = 10;
  else if (err <= 0.35) factor = 5;
  else if (err <= 0.75) factor = 2;
  const tick = step0 * factor;
  const start = Math.ceil(min / tick) * tick;
  const out = [];
  for (let v = start; v <= max + tick * 1e-9; v += tick) out.push(Number(v.toFixed(10)));
  return out;
}

function exportSvgEl(rootEl, filename, format) {
  const clone = rootEl.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  // Inline computed colors so the export is self-contained.
  (function walk(c, o) {
    if (!c || c.nodeType !== 1 || !o) return;
    const cs = getComputedStyle(o);
    for (const p of ['fill', 'stroke', 'opacity', 'stroke-width',
                      'stroke-dasharray', 'font-size', 'font-family']) {
      const v = cs.getPropertyValue(p);
      if (v && v.trim() && v !== 'none' && !c.getAttribute(p)) c.setAttribute(p, v.trim());
    }
    const cc = c.childNodes, oc = o.childNodes;
    for (let i = 0; i < cc.length && i < oc.length; i++) walk(cc[i], oc[i]);
  })(clone, rootEl);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const vb = (rootEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  const w = vb[2] || 720, hgt = vb[3] || 240;
  if (format === 'png') {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * 2; canvas.height = hgt * 2;
      const ctx = canvas.getContext('2d');
      const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#fff';
      ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `${filename}.png`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); URL.revokeObjectURL(url); }, 100);
      }, 'image/png');
    };
    img.src = url;
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${filename}.svg`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function renderInteractiveChart(spec) {
  const W = spec.width, H = spec.height;
  const wrap = h('div', { className: 'lens-chart', 'data-kind': spec.kind || '' });
  if (spec.title) wrap.append(h('div', { className: 'lens-chart-title' }, spec.title));
  const ctrl = h('div', { className: 'lens-chart-toolbar' });
  const toggleState = {};
  for (const ov of (spec.overlays || [])) {
    toggleState[ov.id] = ov.defaultOn !== false;
    const chip = h('button', {
      type: 'button',
      className: 'lens-chip' + (toggleState[ov.id] ? ' on' : ''),
    }, ov.label);
    chip.addEventListener('click', () => {
      toggleState[ov.id] = !toggleState[ov.id];
      chip.classList.toggle('on', toggleState[ov.id]);
      redraw();
    });
    ctrl.append(chip);
  }
  ctrl.append(h('span', { className: 'lens-spacer' }));
  if (spec.brushable !== false) {
    ctrl.append(h('span', { className: 'lens-hint' }, 'drag to zoom · dbl-click resets · click point to annotate'));
  } else if (spec.points?.length) {
    ctrl.append(h('span', { className: 'lens-hint' }, 'hover for details · click to annotate'));
  }
  const fname = (spec.kind || 'chart');
  const btnSvg = h('button', { type: 'button', className: 'lens-chip', title: 'Download SVG' }, '↓ SVG');
  const btnPng = h('button', { type: 'button', className: 'lens-chip', title: 'Download PNG' }, '↓ PNG');
  btnSvg.addEventListener('click', () => exportSvgEl(svgRoot, fname, 'svg'));
  btnPng.addEventListener('click', () => exportSvgEl(svgRoot, fname, 'png'));
  ctrl.append(btnSvg, btnPng);
  wrap.append(ctrl);

  const host = h('div', { className: 'lens-chart-host' });
  const svgRoot = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const tooltip = h('div', { className: 'lens-tooltip' });
  tooltip.style.display = 'none';
  host.append(svgRoot, tooltip);
  wrap.append(host);
  const annoList = h('div', { className: 'lens-annos' });
  wrap.append(annoList);

  const annotations = [];
  let view = { xMin: spec.xRange[0], xMax: spec.xRange[1], yMin: spec.yRange[0], yMax: spec.yRange[1] };
  let cache = null;
  const cross = {};

  function makeScales() {
    const pad = spec.pad;
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const xS = (x) => pad.l + (x - view.xMin) / (view.xMax - view.xMin || 1) * plotW;
    const yS = (y) => pad.t + (1 - (y - view.yMin) / (view.yMax - view.yMin || 1)) * plotH;
    const xI = (px) => view.xMin + (px - pad.l) / plotW * (view.xMax - view.xMin);
    const yI = (py) => view.yMin + (1 - (py - pad.t) / plotH) * (view.yMax - view.yMin);
    return { xS, yS, xI, yI, plot: { x: pad.l, y: pad.t, w: plotW, h: plotH } };
  }

  function redraw() {
    while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);
    const s = makeScales();
    cache = s;
    // Plot frame.
    svgRoot.append(svg('rect', { x: s.plot.x, y: s.plot.y, width: s.plot.w, height: s.plot.h,
      fill: 'none', stroke: 'var(--lens-line)', 'stroke-width': 0.5 }));
    if (spec.showAxes !== false) {
      for (const t of niceTicks(view.yMin, view.yMax, 5)) {
        const y = s.yS(t);
        svgRoot.append(svg('line', { x1: s.plot.x - 3, x2: s.plot.x, y1: y, y2: y,
          stroke: 'var(--muted)', 'stroke-width': 0.5 }));
        svgRoot.append(svg('text', { x: s.plot.x - 6, y: y + 3, 'font-size': 10,
          'text-anchor': 'end', fill: 'var(--muted)' }, (spec.formatY || fmtNum)(t)));
      }
      if (spec.xLabels) {
        spec.xLabels.forEach((lbl, i) => {
          if (!lbl) return;
          const x = s.xS(i + 1);
          const cx = x;
          svgRoot.append(svg('text', { x: cx, y: s.plot.y + s.plot.h + 14, 'font-size': 10,
            'text-anchor': 'middle', fill: 'var(--muted)',
            transform: lbl.length > 8 ? `rotate(-32 ${cx} ${s.plot.y + s.plot.h + 14})` : null,
          }, lbl.length > 14 ? lbl.slice(0, 14) + '…' : lbl));
        });
      } else {
        for (const t of niceTicks(view.xMin, view.xMax, 6)) {
          const x = s.xS(t);
          svgRoot.append(svg('line', { x1: x, x2: x, y1: s.plot.y + s.plot.h, y2: s.plot.y + s.plot.h + 3,
            stroke: 'var(--muted)', 'stroke-width': 0.5 }));
          svgRoot.append(svg('text', { x, y: s.plot.y + s.plot.h + 14, 'font-size': 10,
            'text-anchor': 'middle', fill: 'var(--muted)' }, (spec.formatX || fmtNum)(t)));
        }
      }
    }
    // Axis labels.
    if (spec.xLabel) {
      svgRoot.append(svg('text', { x: s.plot.x + s.plot.w / 2, y: H - 4,
        'font-size': 11, 'text-anchor': 'middle', fill: 'var(--ink-2)',
        'font-family': 'var(--font-display)', 'font-style': 'italic' }, spec.xLabel));
    }
    if (spec.yLabel) {
      svgRoot.append(svg('text', { x: 12, y: s.plot.y + s.plot.h / 2,
        'font-size': 11, 'text-anchor': 'middle', fill: 'var(--ink-2)',
        'font-family': 'var(--font-display)', 'font-style': 'italic',
        transform: `rotate(-90 12 ${s.plot.y + s.plot.h / 2})` }, spec.yLabel));
    }
    // Overlays (under data).
    for (const ov of (spec.overlays || [])) {
      if (!toggleState[ov.id]) continue;
      const g = svg('g', { 'data-overlay': ov.id });
      ov.build(g, { xScale: s.xS, yScale: s.yS, plot: s.plot, view });
      svgRoot.append(g);
    }
    // Chart body.
    if (spec.draw) spec.draw(svgRoot, { xScale: s.xS, yScale: s.yS, plot: s.plot, view });
    // Annotations.
    for (const a of annotations) {
      if (a.x < view.xMin || a.x > view.xMax) continue;
      const ax = s.xS(a.x), ay = a.y != null ? s.yS(a.y) : (s.plot.y + 12);
      svgRoot.append(svg('circle', { cx: ax, cy: ay, r: 5, fill: 'none',
        stroke: 'var(--accent)', 'stroke-width': 1.5 }));
      svgRoot.append(svg('text', { x: ax + 8, y: ay - 6, 'font-size': 10,
        fill: 'var(--accent)', 'font-style': 'italic' }, a.note));
    }
    // Interactive overlay (always last).
    cross.h = svg('line', { x1: 0, y1: s.plot.y, x2: 0, y2: s.plot.y + s.plot.h,
      stroke: 'var(--accent)', 'stroke-width': 0.5, 'stroke-dasharray': '2 2',
      visibility: 'hidden', 'pointer-events': 'none' });
    cross.v = svg('line', { x1: s.plot.x, y1: 0, x2: s.plot.x + s.plot.w, y2: 0,
      stroke: 'var(--accent)', 'stroke-width': 0.5, 'stroke-dasharray': '2 2',
      visibility: 'hidden', 'pointer-events': 'none' });
    cross.dot = svg('circle', { r: 4, fill: 'var(--accent)',
      visibility: 'hidden', 'pointer-events': 'none' });
    cross.brush = svg('rect', { fill: 'var(--accent)', opacity: 0.12,
      stroke: 'var(--accent)', 'stroke-dasharray': '2 2', 'stroke-width': 0.5,
      visibility: 'hidden', 'pointer-events': 'none' });
    svgRoot.append(cross.h, cross.v, cross.dot, cross.brush);
  }

  function evtToData(evt) {
    const rect = svgRoot.getBoundingClientRect();
    const sx = (evt.clientX - rect.left) / rect.width * W;
    const sy = (evt.clientY - rect.top) / rect.height * H;
    const inPlot = sx >= cache.plot.x && sx <= cache.plot.x + cache.plot.w
                && sy >= cache.plot.y && sy <= cache.plot.y + cache.plot.h;
    return { sx, sy, inPlot, dx: cache.xI(sx), dy: cache.yI(sy) };
  }

  function nearestPoint(sx, sy) {
    if (!spec.points?.length) return null;
    let best = null, bestD = Infinity;
    for (const p of spec.points) {
      if (p.x < view.xMin || p.x > view.xMax) continue;
      const px = cache.xS(p.x), py = cache.yS(p.y);
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return bestD < 900 ? best : null;
  }

  let drag = null, lastDragged = false;

  svgRoot.addEventListener('mousemove', (e) => {
    if (!cache) return;
    const m = evtToData(e);
    if (drag) {
      const x = Math.min(drag.sx, m.sx), x2 = Math.max(drag.sx, m.sx);
      cross.brush.setAttribute('x', Math.max(cache.plot.x, x));
      cross.brush.setAttribute('y', cache.plot.y);
      cross.brush.setAttribute('width',
        Math.min(cache.plot.x + cache.plot.w, x2) - Math.max(cache.plot.x, x));
      cross.brush.setAttribute('height', cache.plot.h);
      cross.brush.setAttribute('visibility', 'visible');
      if (Math.abs(m.sx - drag.sx) > 4) drag.dragged = true;
      return;
    }
    if (!m.inPlot) { hideHover(); return; }
    const near = nearestPoint(m.sx, m.sy);
    if (near) showHover(near);
    else hideHover();
  });
  svgRoot.addEventListener('mouseleave', () => { if (!drag) hideHover(); });

  function showHover(p) {
    const px = cache.xS(p.x), py = cache.yS(p.y);
    cross.h.setAttribute('x1', px); cross.h.setAttribute('x2', px);
    cross.v.setAttribute('y1', py); cross.v.setAttribute('y2', py);
    cross.dot.setAttribute('cx', px); cross.dot.setAttribute('cy', py);
    cross.h.setAttribute('visibility', 'visible');
    cross.v.setAttribute('visibility', 'visible');
    cross.dot.setAttribute('visibility', 'visible');
    const lines = [];
    if (p.label) lines.push(p.label);
    lines.push(`${spec.xLabel || 'x'}: ${spec.xLabels ? (spec.xLabels[p.i] || '—') : (spec.formatX || fmtNum)(p.x)}`);
    lines.push(`${spec.yLabel || 'y'}: ${(spec.formatY || fmtNum)(p.y)}`);
    if (p.meta) for (const [k, v] of Object.entries(p.meta)) lines.push(`${k}: ${v}`);
    tooltip.innerHTML = lines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    tooltip.style.display = 'block';
    const rect = svgRoot.getBoundingClientRect();
    const pxScreen = (px / W) * rect.width;
    const pyScreen = (py / H) * rect.height;
    let tipLeft = pxScreen + 12;
    let tipTop  = pyScreen - tooltip.offsetHeight - 8;
    if (tipTop < 4) tipTop = pyScreen + 16;
    if (tipTop + tooltip.offsetHeight > rect.height - 4)
      tipTop = rect.height - tooltip.offsetHeight - 4;
    if (tipLeft + tooltip.offsetWidth > rect.width - 4)
      tipLeft = pxScreen - tooltip.offsetWidth - 12;
    if (tipLeft < 4) tipLeft = 4;
    if (tipTop < 4) tipTop = 4;
    tooltip.style.left = `${tipLeft}px`;
    tooltip.style.top  = `${tipTop}px`;
  }
  function hideHover() {
    cross.h?.setAttribute('visibility', 'hidden');
    cross.v?.setAttribute('visibility', 'hidden');
    cross.dot?.setAttribute('visibility', 'hidden');
    tooltip.style.display = 'none';
  }

  svgRoot.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || spec.brushable === false) return;
    const m = evtToData(e);
    if (!m.inPlot) return;
    drag = { ...m, dragged: false };
    e.preventDefault();
  });
  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const m = evtToData(e);
    if (drag.dragged && Math.abs(m.sx - drag.sx) > 4) {
      const a = Math.min(drag.dx, m.dx), b = Math.max(drag.dx, m.dx);
      view = { ...view, xMin: a, xMax: b };
      redraw(); lastDragged = true;
    }
    cross.brush?.setAttribute('visibility', 'hidden');
    drag = null;
  }, true);
  svgRoot.addEventListener('click', (e) => {
    if (lastDragged) { lastDragged = false; return; }
    if (!cache) return;
    const m = evtToData(e);
    if (!m.inPlot) return;
    const near = nearestPoint(m.sx, m.sy);
    if (near) promptAnnotation(near);
  });
  svgRoot.addEventListener('dblclick', () => {
    view = { xMin: spec.xRange[0], xMax: spec.xRange[1], yMin: spec.yRange[0], yMax: spec.yRange[1] };
    redraw();
  });

  function promptAnnotation(point) {
    host.querySelectorAll('.lens-anno-pop').forEach(p => p.remove());
    const pop = h('div', { className: 'lens-anno-pop' });
    const input = h('input', { type: 'text',
      placeholder: 'Note (Enter saves, Esc cancels)' });
    pop.append(
      h('div', { className: 'lens-anno-pop-head' },
        point.label || `${spec.xLabel || 'x'}=${(spec.formatX || fmtNum)(point.x)}`),
      input,
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        annotations.push({ id: Math.random().toString(36).slice(2),
          x: point.x, y: point.y, note: input.value.trim() });
        pop.remove(); redraw(); renderAnnoList();
      } else if (e.key === 'Escape') pop.remove();
    });
    const rect = svgRoot.getBoundingClientRect();
    const px = cache.xS(point.x), py = cache.yS(point.y);
    pop.style.left = `${(px / W) * rect.width + 12}px`;
    pop.style.top = `${(py / H) * rect.height + 12}px`;
    host.append(pop);
    setTimeout(() => input.focus(), 0);
  }

  function renderAnnoList() {
    annoList.innerHTML = '';
    if (!annotations.length) return;
    annoList.append(h('div', { className: 'lens-anno-head' },
      `Annotations (${annotations.length})`));
    for (const a of annotations) {
      const row = h('div', { className: 'lens-anno-row' });
      const del = h('button', { type: 'button', className: 'lens-anno-x' }, '×');
      del.addEventListener('click', () => {
        const i = annotations.indexOf(a);
        if (i >= 0) annotations.splice(i, 1);
        redraw(); renderAnnoList();
      });
      row.append(
        h('span', { className: 'lens-anno-tag' }, `${spec.xLabel || 'x'}=${(spec.formatX || fmtNum)(a.x)}`),
        h('span', { className: 'lens-anno-note' }, a.note),
        del,
      );
      annoList.append(row);
    }
  }

  redraw();
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════
//  Chart registry — 26 chart types
// ═══════════════════════════════════════════════════════════════════════

const CHARTS = [
  // ───── Distribution ─────
  { id: 'histogram',  label: 'Histogram',  category: 'Distribution',
    desc: 'Counts per bin. Shape of one numeric variable at a glance.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgHistogram, interpret: interpHistogram },
  { id: 'density',    label: 'Density (KDE)', category: 'Distribution',
    desc: 'Smoothed probability density. Reveals bimodality and tail shape.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgDensity, interpret: interpDensity },
  { id: 'boxplot',    label: 'Box plot', category: 'Distribution',
    desc: 'Median, quartiles, outliers — the five-number summary in one frame.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'group', label: 'Group by', kind: 'categorical' }],
    build: cfgBoxplot, interpret: interpBoxplot },
  { id: 'violin',     label: 'Violin plot', category: 'Distribution',
    desc: 'Box plot + density. Box for summary, fat halves for shape.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'group', label: 'Group by', kind: 'categorical' }],
    build: cfgViolin, interpret: interpViolin },
  { id: 'strip',      label: 'Strip / dot plot', category: 'Distribution',
    desc: 'Every observation as one dot, optionally split by group.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'group', label: 'Group by', kind: 'categorical' }],
    build: cfgStrip, interpret: interpStrip },
  { id: 'ridge',      label: 'Ridge plot', category: 'Distribution',
    desc: 'Stacked KDEs across groups. Pure shape comparison.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'group', label: 'Group', kind: 'categorical', required: true }],
    build: cfgRidge, interpret: interpRidge },
  { id: 'qq',         label: 'Normal Q–Q', category: 'Distribution',
    desc: 'Tests normality visually. On the line → normal. Curve → tails.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgQQ, interpret: interpQQ },
  { id: 'ecdf',       label: 'ECDF', category: 'Distribution',
    desc: 'Empirical cumulative distribution F(x). Step jumps = repeats.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgECDF, interpret: interpECDF },

  // ───── Relationship ─────
  { id: 'scatter',    label: 'Scatter + fit', category: 'Relationship',
    desc: 'Two numerics with a linear fit + R². Look for clusters and outliers.',
    inputs: [{ key: 'x', label: 'X', kind: 'numeric', required: true },
              { key: 'y', label: 'Y', kind: 'numeric', required: true },
              { key: 'color', label: 'Color by', kind: 'categorical' }],
    build: cfgScatter, interpret: interpScatter },
  { id: 'bubble',     label: 'Bubble', category: 'Relationship',
    desc: 'Scatter where a third numeric encodes point size.',
    inputs: [{ key: 'x', label: 'X', kind: 'numeric', required: true },
              { key: 'y', label: 'Y', kind: 'numeric', required: true },
              { key: 'size', label: 'Size', kind: 'numeric', required: true }],
    build: cfgBubble, interpret: interpBubble },
  { id: 'hexbin',     label: 'Hexbin density', category: 'Relationship',
    desc: 'Scatter for thousands of points. Hex tiles colored by density.',
    inputs: [{ key: 'x', label: 'X', kind: 'numeric', required: true },
              { key: 'y', label: 'Y', kind: 'numeric', required: true }],
    build: cfgHexbin, interpret: interpHexbin },
  { id: 'contour',    label: '2-D density contour', category: 'Relationship',
    desc: 'Smooth contour lines of the joint density of two numerics.',
    inputs: [{ key: 'x', label: 'X', kind: 'numeric', required: true },
              { key: 'y', label: 'Y', kind: 'numeric', required: true }],
    build: cfgContour, interpret: interpContour },
  { id: 'lag',        label: 'Lag plot', category: 'Relationship',
    desc: 'X(t) vs X(t-k). A diagonal cloud → strong autocorrelation at lag k.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'lag', label: 'Lag', kind: 'integer', default: 1 }],
    build: cfgLag, interpret: interpLag },

  // ───── Time / sequence ─────
  { id: 'run',        label: 'Run chart', category: 'Time',
    desc: 'Values in order with median line. Standard SPC overview.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgRun, interpret: interpRun },
  { id: 'control',    label: 'I-chart (control)', category: 'Time',
    desc: 'X̄ ± 3σ control limits via MR̄/d₂. Flags out-of-control points.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgControl, interpret: interpControl },
  { id: 'multiline',  label: 'Multi-series line', category: 'Time',
    desc: 'One line per group, all sharing the same row order.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'group', label: 'Series', kind: 'categorical', required: true }],
    build: cfgMultiline, interpret: interpMultiline },
  { id: 'acf',        label: 'Autocorrelation (ACF)', category: 'Time',
    desc: 'Autocorrelation at lags 1..30. Bars beyond ±2/√n → significant.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgACF, interpret: interpACF },
  { id: 'cumsum',     label: 'Cumulative sum', category: 'Time',
    desc: 'Running sum of values. Flat segments → in-control; slopes → drift.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgCumsum, interpret: interpCumsum },

  // ───── Categorical ─────
  { id: 'bar',        label: 'Bar chart', category: 'Categorical',
    desc: 'Counts per category in original order.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgBar, interpret: interpBar },
  { id: 'pareto',     label: 'Pareto', category: 'Categorical',
    desc: 'Sorted bars + cumulative line. The "vital few" appear first.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgPareto, interpret: interpPareto },
  { id: 'stacked',    label: 'Stacked bar', category: 'Categorical',
    desc: 'Two-categorical breakdown. Bars stacked by sub-category.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true },
              { key: 'group', label: 'Sub-category', kind: 'categorical', required: true }],
    build: cfgStacked, interpret: interpStacked },
  { id: 'heatmap',    label: 'Heatmap (count)', category: 'Categorical',
    desc: 'Cross-tab of two categoricals coloured by count.',
    inputs: [{ key: 'x', label: 'Row', kind: 'categorical', required: true },
              { key: 'y', label: 'Column', kind: 'categorical', required: true }],
    build: cfgHeatmap, interpret: interpHeatmap },
  { id: 'mosaic',     label: 'Mosaic plot', category: 'Categorical',
    desc: 'Area-proportional cross-tab — surface widths show marginal frequencies.',
    inputs: [{ key: 'x', label: 'Row', kind: 'categorical', required: true },
              { key: 'y', label: 'Column', kind: 'categorical', required: true }],
    build: cfgMosaic, interpret: interpMosaic },

  // ───── Multi-variate ─────
  { id: 'splom',      label: 'Scatter matrix', category: 'Multi-variate',
    desc: 'Every pair of numeric variables on a grid.',
    inputs: [],
    build: cfgSPLOM, interpret: interpSPLOM },
  { id: 'sparkmatrix', label: 'Sparkline matrix', category: 'Multi-variate',
    desc: 'Mini run-charts for every numeric column.',
    inputs: [],
    build: cfgSparkMatrix, interpret: interpSparkMatrix },

  // ───── Flourish-class storytelling charts ─────
  { id: 'sankey',     label: 'Sankey flow', category: 'Flow & hierarchy',
    desc: 'Flow widths between two categorical stages. The flagship Flourish-class chart for showing where things go.',
    inputs: [{ key: 'from', label: 'From', kind: 'categorical', required: true },
              { key: 'to', label: 'To', kind: 'categorical', required: true }],
    build: cfgSankey, interpret: interpSankey },
  { id: 'treemap',    label: 'Treemap', category: 'Flow & hierarchy',
    desc: 'Area-proportional rectangles. Cells sized by value, colored by category.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true },
              { key: 'value', label: 'Size (optional)', kind: 'numeric' }],
    build: cfgTreemap, interpret: interpTreemap },
  { id: 'sunburst',   label: 'Sunburst', category: 'Flow & hierarchy',
    desc: 'Concentric rings. Inner ring = primary category, outer ring = sub-category.',
    inputs: [{ key: 'primary', label: 'Inner ring', kind: 'categorical', required: true },
              { key: 'secondary', label: 'Outer ring', kind: 'categorical' }],
    build: cfgSunburst, interpret: interpSunburst },
  { id: 'slope',      label: 'Slope chart', category: 'Flow & hierarchy',
    desc: 'Two columns of values for the same entities, lines between. Shows movement.',
    inputs: [{ key: 'entity', label: 'Entity', kind: 'categorical', required: true },
              { key: 'before', label: 'Before', kind: 'numeric', required: true },
              { key: 'after', label: 'After', kind: 'numeric', required: true }],
    build: cfgSlope, interpret: interpSlope },
  { id: 'marimekko',  label: 'Marimekko', category: 'Flow & hierarchy',
    desc: 'Variable-width stacked bars. Widths = marginal frequencies, stacks = sub-category shares.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true },
              { key: 'group', label: 'Sub-category', kind: 'categorical', required: true }],
    build: cfgMarimekko, interpret: interpMarimekko },
  { id: 'race',       label: 'Bar chart race', category: 'Flow & hierarchy',
    desc: 'Animated ranking over time. The iconic Flourish chart.',
    inputs: [{ key: 'entity', label: 'Entity', kind: 'categorical', required: true },
              { key: 'time', label: 'Time / step', kind: 'any', required: true },
              { key: 'value', label: 'Value', kind: 'numeric', required: true }],
    build: cfgBarRace, interpret: interpBarRace },

  // ───── LSS ─────
  { id: 'capability', label: 'Capability histogram', category: 'LSS',
    desc: 'Histogram + LSL/USL/target spec lines + Cpk readout.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'lsl', label: 'LSL', kind: 'number' },
              { key: 'usl', label: 'USL', kind: 'number' },
              { key: 'target', label: 'Target', kind: 'number' }],
    build: cfgCapability, interpret: interpCapability },

  // ───── Composition ─────
  { id: 'pie',        label: 'Pie chart', category: 'Composition',
    desc: 'Classic pie. Slices proportional to category counts.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgPie, interpret: interpPie },
  { id: 'doughnut',   label: 'Doughnut', category: 'Composition',
    desc: 'Pie with a hole. Total appears in the centre.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgDoughnut, interpret: interpDoughnut },
  { id: 'funnel',     label: 'Funnel chart', category: 'Composition',
    desc: 'Pipeline / conversion funnel. Stages stack vertically, widths drop.',
    inputs: [{ key: 'x', label: 'Stage', kind: 'categorical', required: true }],
    build: cfgFunnel, interpret: interpFunnel },
  { id: 'pyramid',    label: 'Pyramid chart', category: 'Composition',
    desc: 'Pyramid with smallest tier at top. Use for ordered hierarchies.',
    inputs: [{ key: 'x', label: 'Tier', kind: 'categorical', required: true }],
    build: cfgPyramid, interpret: interpPyramid },
  { id: 'waterfall',  label: 'Waterfall', category: 'Composition',
    desc: 'Running cumulative breakdown of positive / negative deltas.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgWaterfall, interpret: interpWaterfall },
  { id: 'bullet',     label: 'Bullet chart', category: 'Composition',
    desc: 'KPI tile: actual bar + target marker + qualitative bands.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'target', label: 'Target', kind: 'number' }],
    build: cfgBullet, interpret: interpBullet },

  // ───── Distribution (extra) ─────
  { id: 'stepline',   label: 'Step line', category: 'Distribution',
    desc: 'Each value held flat until the next observation. No interpolation.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgStepLine, interpret: interpStepLine },
  { id: 'steparea',   label: 'Step area', category: 'Distribution',
    desc: 'Step line filled below — emphasises cumulative magnitude.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgStepArea, interpret: interpStepArea },

  // ───── Time (extra) ─────
  { id: 'spline',     label: 'Spline line', category: 'Time',
    desc: 'Smooth curve through observations. Less jagged than a raw line.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgSpline, interpret: interpSpline },
  { id: 'splinearea', label: 'Spline area', category: 'Time',
    desc: 'Spline + fill to baseline. Editorial / dashboard staple.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgSplineArea, interpret: interpSplineArea },
  { id: 'stick',      label: 'Stick chart', category: 'Time',
    desc: 'Vertical sticks from a baseline (zero or median). Period-by-period delta.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgStick, interpret: interpStick },
  { id: 'calendar',   label: 'Calendar heatmap', category: 'Time',
    desc: 'GitHub-style daily heatmap. Reveals weekly and monthly seasonality.',
    inputs: [{ key: 'date', label: 'Date column', kind: 'any', required: true },
              { key: 'value', label: 'Value', kind: 'numeric', required: true }],
    build: cfgCalendar, interpret: interpCalendar },

  // ───── Multi-variate (extra) ─────
  { id: 'quadrant',   label: 'Quadrant chart', category: 'Multi-variate',
    desc: 'Scatter + median reference lines splitting the plot into four quadrants.',
    inputs: [{ key: 'x', label: 'X', kind: 'numeric', required: true },
              { key: 'y', label: 'Y', kind: 'numeric', required: true }],
    build: cfgQuadrant, interpret: interpQuadrant },

  // ───── Polar ─────
  { id: 'radar',      label: 'Radar / Spider', category: 'Polar',
    desc: 'Multi-axis polygon with one axis per numeric column.',
    inputs: [],
    build: cfgRadar, interpret: interpRadar },
  { id: 'polarcol',   label: 'Polar column', category: 'Polar',
    desc: 'Bars radiating from a center — categorical counts on a circular axis.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgPolarColumn, interpret: interpPolarColumn },

  // ───── Network & relations ─────
  { id: 'network',    label: 'Network graph', category: 'Network',
    desc: 'Force-directed nodes and edges. Node degree → radius, edge frequency → width.',
    inputs: [{ key: 'from', label: 'From node', kind: 'categorical', required: true },
              { key: 'to',   label: 'To node',   kind: 'categorical', required: true }],
    build: cfgNetwork, interpret: interpNetwork },
  { id: 'venn',       label: 'Venn diagram', category: 'Network',
    desc: 'Up to 3 overlapping sets. Each numeric column treated as binary membership.',
    inputs: [{ key: 'a', label: 'Set A', kind: 'any', required: true },
              { key: 'b', label: 'Set B', kind: 'any', required: true },
              { key: 'c', label: 'Set C (optional)', kind: 'any' }],
    build: cfgVenn, interpret: interpVenn },
  { id: 'tagcloud',   label: 'Tag cloud', category: 'Network',
    desc: 'Words sized by frequency. Quick eyeball of dominant categories.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgTagCloud, interpret: interpTagCloud },
  { id: 'circlepack', label: 'Circle packing', category: 'Network',
    desc: 'Categories as packed circles, sized by count.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgCirclePack, interpret: interpCirclePack },

  // ───── Range / band ─────
  { id: 'rangearea',  label: 'Range area', category: 'Ranges',
    desc: 'Band between a low and high series — uncertainty / interval ribbons.',
    inputs: [{ key: 'low', label: 'Low', kind: 'numeric', required: true },
              { key: 'high', label: 'High', kind: 'numeric', required: true },
              { key: 'mid', label: 'Centre (optional)', kind: 'numeric' }],
    build: cfgRangeArea, interpret: interpRangeArea },
  { id: 'rangespline', label: 'Range spline area', category: 'Ranges',
    desc: 'Smoothed range band — same as range area but with bezier curves.',
    inputs: [{ key: 'low', label: 'Low', kind: 'numeric', required: true },
              { key: 'high', label: 'High', kind: 'numeric', required: true }],
    build: cfgRangeSpline, interpret: interpRangeSpline },
  { id: 'rangestep',  label: 'Range step area', category: 'Ranges',
    desc: 'Range area as steps — discrete intervals.',
    inputs: [{ key: 'low', label: 'Low', kind: 'numeric', required: true },
              { key: 'high', label: 'High', kind: 'numeric', required: true }],
    build: cfgRangeStep, interpret: interpRangeStep },
  { id: 'rangebar',   label: 'Range bar', category: 'Ranges',
    desc: 'Horizontal floating bars from low to high per category.',
    inputs: [{ key: 'cat', label: 'Category', kind: 'categorical', required: true },
              { key: 'low', label: 'Low', kind: 'numeric', required: true },
              { key: 'high', label: 'High', kind: 'numeric', required: true }],
    build: cfgRangeBar, interpret: interpRangeBar },
  { id: 'rangecol',   label: 'Range column', category: 'Ranges',
    desc: 'Vertical floating bars from low to high per category.',
    inputs: [{ key: 'cat', label: 'Category', kind: 'categorical', required: true },
              { key: 'low', label: 'Low', kind: 'numeric', required: true },
              { key: 'high', label: 'High', kind: 'numeric', required: true }],
    build: cfgRangeCol, interpret: interpRangeCol },

  // ───── Financial ─────
  { id: 'ohlc',       label: 'OHLC', category: 'Financial',
    desc: 'Open / High / Low / Close ticks per period.',
    inputs: [{ key: 'open', label: 'Open', kind: 'numeric', required: true },
              { key: 'high', label: 'High', kind: 'numeric', required: true },
              { key: 'low', label: 'Low', kind: 'numeric', required: true },
              { key: 'close', label: 'Close', kind: 'numeric', required: true }],
    build: cfgOHLC, interpret: interpOHLC },
  { id: 'candle',     label: 'Japanese candlestick', category: 'Financial',
    desc: 'Filled bodies between open and close; wicks to high and low. Green = up, red = down.',
    inputs: [{ key: 'open', label: 'Open', kind: 'numeric', required: true },
              { key: 'high', label: 'High', kind: 'numeric', required: true },
              { key: 'low', label: 'Low', kind: 'numeric', required: true },
              { key: 'close', label: 'Close', kind: 'numeric', required: true }],
    build: cfgCandle, interpret: interpCandle },
  { id: 'hilo',       label: 'HiLo', category: 'Financial',
    desc: 'High-low only, no body. Minimal range-of-trading view.',
    inputs: [{ key: 'high', label: 'High', kind: 'numeric', required: true },
              { key: 'low', label: 'Low', kind: 'numeric', required: true }],
    build: cfgHiLo, interpret: interpHiLo },

  // ───── Time (extras) ─────
  { id: 'jumpline',   label: 'Jump line', category: 'Time',
    desc: 'Line that respects gaps in the data — missing observations break the line.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgJumpLine, interpret: interpJumpLine },
  { id: 'timeline',   label: 'Timeline / Gantt', category: 'Time',
    desc: 'Horizontal bars from start to end. One row per entity. Project schedules.',
    inputs: [{ key: 'label', label: 'Entity', kind: 'categorical', required: true },
              { key: 'start', label: 'Start', kind: 'any', required: true },
              { key: 'end', label: 'End', kind: 'any', required: true }],
    build: cfgTimeline, interpret: interpTimeline },

  // ───── Categorical (extra) ─────
  { id: 'heatmean',   label: 'Heatmap (mean)', category: 'Categorical',
    desc: 'Cross-tab coloured by the MEAN of a numeric variable per cell.',
    inputs: [{ key: 'x', label: 'Row', kind: 'categorical', required: true },
              { key: 'y', label: 'Column', kind: 'categorical', required: true },
              { key: 'value', label: 'Numeric value', kind: 'numeric', required: true }],
    build: cfgHeatMean, interpret: interpHeatMean },

  // ───── 3D illusion ─────
  { id: '3dbar',      label: '3D Bar', category: '3D',
    desc: 'Horizontal bars with extruded depth. Editorial flourish — same data as a Bar chart.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfg3DBar, interpret: interp3DBar },
  { id: '3dcol',      label: '3D Column', category: '3D',
    desc: 'Vertical bars with extruded depth.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfg3DColumn, interpret: interp3DColumn },
  { id: '3dpie',      label: '3D Pie', category: '3D',
    desc: 'Pie with elliptical depth ring.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfg3DPie, interpret: interp3DPie },
  { id: '3ddoughnut', label: '3D Doughnut', category: '3D',
    desc: 'Doughnut with depth.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfg3DDoughnut, interpret: interp3DDoughnut },

  // ───── Polar family (extra) ─────
  { id: 'polararea',  label: 'Polar area', category: 'Polar',
    desc: 'Categorical means rendered as filled polar slices.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgPolarArea, interpret: interpPolarArea },
  { id: 'polarline',  label: 'Polar line', category: 'Polar',
    desc: 'Line connecting points around a circular axis.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgPolarLine, interpret: interpPolarLine },
  { id: 'polarmarker', label: 'Polar marker', category: 'Polar',
    desc: 'Just the markers at each polar position.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgPolarMarker, interpret: interpPolarMarker },
  { id: 'polarpoly',  label: 'Polar polygon', category: 'Polar',
    desc: 'Single closed polygon over the polar axes.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true }],
    build: cfgPolarPolygon, interpret: interpPolarPolygon },

  // ───── Radar family (extra) ─────
  { id: 'radarline',  label: 'Radar (line)', category: 'Polar',
    desc: 'Radar with the outline only — no fill. Cleaner for overlays.',
    inputs: [],
    build: cfgRadarLine, interpret: interpRadarLine },
  { id: 'radarmark',  label: 'Radar (marker)', category: 'Polar',
    desc: 'Just the points on each radar axis — no connecting line.',
    inputs: [],
    build: cfgRadarMarker, interpret: interpRadarMarker },

  // ───── Polygon / Polyline ─────
  { id: 'polygon',    label: 'Polygon', category: 'Relationship',
    desc: 'X / Y points connected in row order and closed at the end.',
    inputs: [{ key: 'x', label: 'X', kind: 'numeric', required: true },
              { key: 'y', label: 'Y', kind: 'numeric', required: true }],
    build: cfgPolygon, interpret: interpPolygon },
  { id: 'polyline',   label: 'Polyline', category: 'Relationship',
    desc: 'X / Y points connected in row order, NOT closed. Path-like data.',
    inputs: [{ key: 'x', label: 'X', kind: 'numeric', required: true },
              { key: 'y', label: 'Y', kind: 'numeric', required: true }],
    build: cfgPolyline, interpret: interpPolyline },

  // ───── Stacked ─────
  { id: 'stackedarea', label: 'Stacked area', category: 'Time',
    desc: 'Multiple series stacked. Bottom = first series, top = sum.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'group', label: 'Series', kind: 'categorical', required: true }],
    build: cfgStackedArea, interpret: interpStackedArea },
  { id: 'stackedspline', label: 'Stacked spline area', category: 'Time',
    desc: 'Same as Stacked area but with smoothed (spline) boundaries.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true },
              { key: 'group', label: 'Series', kind: 'categorical', required: true }],
    build: cfgStackedSpline, interpret: interpStackedSpline },

  // ───── Flow & hierarchy (extra) ─────
  { id: 'barmekko',   label: 'Bar Mekko (horizontal)', category: 'Flow & hierarchy',
    desc: 'Marimekko rotated 90° — variable-height stacked horizontal bars.',
    inputs: [{ key: 'x', label: 'Category', kind: 'categorical', required: true },
              { key: 'group', label: 'Sub-category', kind: 'categorical', required: true }],
    build: cfgBarMekko, interpret: interpBarMekko },

  // ───── Distribution (extra extras) ─────
  { id: 'stemleaf',   label: 'Stem-and-leaf', category: 'Distribution',
    desc: 'Tukey\'s text-mode distribution display. Each number preserved in the plot.',
    inputs: [{ key: 'x', label: 'Variable', kind: 'numeric', required: true }],
    build: cfgStemLeaf, interpret: interpStemLeaf },

  // ───── Polar (extra) — Wind rose ─────
  { id: 'windrose',   label: 'Wind rose / Polar histogram', category: 'Polar',
    desc: 'Polar histogram. Bars stack by group around a circular axis.',
    inputs: [{ key: 'x', label: 'Direction / category', kind: 'categorical', required: true },
              { key: 'group', label: 'Magnitude bins', kind: 'categorical' }],
    build: cfgWindRose, interpret: interpWindRose },

  // ─────────────────────────────────────────────────────────────────────
  //  Conyso Originals — charts built because nobody else draws them well.
  //  LSS-specific originals (Variance Budget, Capability Trajectory,
  //  RPN Heat Bubbles, Sigma Slippage, Cost-Weighted Pareto) live in Bench
  //  where the SPC / MSA / FMEA audience is. Lens keeps the generic ones.
  // ─────────────────────────────────────────────────────────────────────
  { id: 'showdown',   label: 'Distribution Showdown', category: 'Conyso Originals',
    desc: 'Two-sample density overlay + mean ticks + 95% CIs + Cohen\'s d effect-size label. The chart for "is this change real AND meaningful?"',
    inputs: [{ key: 'x', label: 'Numeric value', kind: 'numeric', required: true },
              { key: 'group', label: 'Group (must be 2 levels)', kind: 'categorical', required: true }],
    build: cfgShowdown, interpret: interpShowdown },
  { id: 'cohorttri',  label: 'Cohort Triangle', category: 'Conyso Originals',
    desc: 'Retention/repeat matrix: rows = cohorts (by start period), columns = age (periods since start), cells = % of cohort still active. The classic SaaS retention heatmap, generalised to any cohort × age problem.',
    inputs: [{ key: 'cohort', label: 'Cohort period (categorical or date-string)', kind: 'categorical', required: true },
              { key: 'age',    label: 'Age (integer periods since cohort start)',    kind: 'numeric', required: true },
              { key: 'id',     label: 'Member / row id (optional — counts unique)',  kind: 'categorical' }],
    build: cfgCohortTri, interpret: interpCohortTri },
  { id: 'annoseries', label: 'Annotated Time Series', category: 'Conyso Originals',
    desc: 'Line over time with sparse event markers (deploys, launches, anomalies). Auto-detects outlier residuals after a rolling median and labels them.',
    inputs: [{ key: 'y', label: 'Value', kind: 'numeric', required: true },
              { key: 't', label: 'Time index (optional — defaults to row order)', kind: 'numeric' },
              { key: 'event', label: 'Event label column (optional)', kind: 'categorical' }],
    build: cfgAnnoSeries, interpret: interpAnnoSeries },
  { id: 'outlierspot',label: 'Outlier Spotlight', category: 'Conyso Originals',
    desc: 'Histogram + IQR-fenced outlier strip beneath, with the offenders enumerated. "Show me the weird points and tell me why they\'re weird."',
    inputs: [{ key: 'x', label: 'Numeric variable', kind: 'numeric', required: true },
              { key: 'label', label: 'Row label (optional)', kind: 'categorical' }],
    build: cfgOutlierSpot, interpret: interpOutlierSpot },
  { id: 'quartet',    label: 'Comparison Quartet', category: 'Conyso Originals',
    desc: 'A 2×2 grid of four lenses on the same two-group comparison: density overlay, ECDF, boxplots, Q-Q. Pick the lens that tells the cleanest story.',
    inputs: [{ key: 'x',     label: 'Numeric value', kind: 'numeric', required: true },
              { key: 'group', label: 'Group (must be 2 levels)', kind: 'categorical', required: true }],
    build: cfgQuartet, interpret: interpQuartet },
  { id: 'drift',      label: 'Distribution Drift', category: 'Conyso Originals',
    desc: 'Ridge plot showing the distribution of one variable across ordered time periods. Reveals when the population shape (not just the mean) shifted.',
    inputs: [{ key: 'x',      label: 'Numeric value', kind: 'numeric', required: true },
              { key: 'period', label: 'Time period (ordered categorical)', kind: 'categorical', required: true }],
    build: cfgDrift, interpret: interpDrift },
];
const CHARTS_BY_ID = Object.fromEntries(CHARTS.map(c => [c.id, c]));

// ═══════════════════════════════════════════════════════════════════════
//  Helpers — data access + math
// ═══════════════════════════════════════════════════════════════════════

function getNumeric(col) {
  return state.rows.map(r => Number(r[col])).filter(v => Number.isFinite(v));
}
function getCategorical(col) {
  return state.rows.map(r => r[col] == null ? '(missing)' : String(r[col]));
}
function emptyCard(msg) {
  return h('div', { className: 'lens-chart' },
    h('div', { className: 'muted', style: 'padding:40px 18px;text-align:center;font-style:italic' }, msg));
}
function stddev(vals) {
  const n = vals.length; if (n < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
}
function quantile(vals, p) {
  const s = vals.slice().sort((a, b) => a - b);
  const i = Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)));
  return s[i];
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / (Math.sqrt(dx * dy) || 1);
}
function skewKurt(vals) {
  const n = vals.length;
  if (n < 3) return { skew: 0, kurt: 0 };
  const m = vals.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / n) || 1e-9;
  const skew = vals.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / n;
  const kurt = vals.reduce((a, b) => a + ((b - m) / s) ** 4, 0) / n - 3;
  return { skew, kurt };
}
function qNorm(p) {
  if (p <= 0 || p >= 1) return p < 0.5 ? -10 : 10;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
              -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
              3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r, val;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    val = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    val = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
          (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    val = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return val;
}
function kde1d(vals, atX, bw) {
  let s = 0;
  for (const v of vals) {
    const u = (atX - v) / bw;
    s += Math.exp(-0.5 * u * u);
  }
  return s / (vals.length * bw * Math.sqrt(2 * Math.PI));
}

// Categorical-series palette built around bronze + warm grey accents.
function paletteFor(n) {
  const base = [
    '#c5a572', '#6b5524', '#8a7045', '#a48b5e', '#d9c599',
    '#3a3a3a', '#5a5a5a', '#8a8a8a', '#b03a3a', '#2f7d3a',
  ];
  const out = [];
  for (let i = 0; i < n; i++) out.push(base[i % base.length]);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
//  Chart builders — each returns a DOM element (chart card)
// ═══════════════════════════════════════════════════════════════════════

function cfgHistogram({ x }) {
  const vals = getNumeric(x);
  if (vals.length === 0) return emptyCard('No numeric values.');
  const mn = Math.min(...vals), mx = Math.max(...vals);
  if (mn === mx) return emptyCard('Constant column.');
  const nBins = Math.min(40, Math.max(5, Math.round(Math.sqrt(vals.length))));
  const binW = (mx - mn) / nBins;
  const counts = new Array(nBins).fill(0);
  for (const v of vals) {
    const i = Math.min(nBins - 1, Math.max(0, Math.floor((v - mn) / binW)));
    counts[i]++;
  }
  const maxC = Math.max(...counts);
  const points = counts.map((c, i) => ({
    i, x: mn + (i + 0.5) * binW, y: c, label: `bin ${i + 1}`,
    meta: { range: `[${(mn + i * binW).toFixed(2)}, ${(mn + (i + 1) * binW).toFixed(2)}]`, count: c },
  }));
  return renderInteractiveChart({
    kind: 'histogram',
    width: 760, height: 360, pad: { l: 56, r: 18, t: 14, b: 44 },
    xRange: [mn, mx], yRange: [0, maxC * 1.12],
    xLabel: x, yLabel: 'count',
    points,
    draw: (root, { xScale, yScale, plot }) => {
      counts.forEach((c, i) => {
        const x0 = xScale(mn + i * binW), x1 = xScale(mn + (i + 1) * binW);
        const y0 = yScale(c);
        root.append(svg('rect', { x: x0 + 0.5, y: y0, width: Math.max(0, x1 - x0 - 1),
          height: plot.y + plot.h - y0, fill: 'var(--lens-bar)', opacity: 0.85 }));
      });
    },
  });
}

function cfgDensity({ x }) {
  const vals = getNumeric(x);
  if (vals.length < 2) return emptyCard('Need ≥ 2 values.');
  const sd = stddev(vals) || 1e-9;
  const bw = 1.06 * sd * Math.pow(vals.length, -1 / 5);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pad = (mx - mn) * 0.12 || 1;
  const xs = [], ys = [];
  for (let i = 0; i <= 240; i++) {
    const xv = mn - pad + (mx - mn + 2 * pad) * (i / 240);
    xs.push(xv);
    ys.push(kde1d(vals, xv, bw));
  }
  const maxY = Math.max(...ys);
  const points = xs.map((xv, i) => ({ i, x: xv, y: ys[i] }));
  return renderInteractiveChart({
    kind: 'density',
    width: 760, height: 360, pad: { l: 56, r: 18, t: 14, b: 44 },
    xRange: [mn - pad, mx + pad], yRange: [0, maxY * 1.1],
    xLabel: x, yLabel: 'density',
    points,
    draw: (root, { xScale, yScale, plot }) => {
      const path = xs.map((xv, i) => `${i ? 'L' : 'M'} ${xScale(xv)} ${yScale(ys[i])}`).join(' ');
      const fillPath = path + ` L ${xScale(xs[xs.length - 1])} ${plot.y + plot.h} L ${xScale(xs[0])} ${plot.y + plot.h} Z`;
      root.append(svg('path', { d: fillPath, fill: 'var(--accent)', opacity: 0.16 }));
      root.append(svg('path', { d: path, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.6 }));
    },
  });
}

function cfgBoxplot({ x, group }) {
  if (!group) return boxplotSingle(getNumeric(x), x);
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]), g = r[group] == null ? '(missing)' : String(r[group]);
    if (Number.isFinite(v)) (groups[g] = groups[g] || []).push(v);
  }
  return boxplotGrouped(groups, x, group);
}

function boxplotSingle(vals, label) {
  if (!vals.length) return emptyCard('No data.');
  const sorted = vals.slice().sort((a, b) => a - b);
  const q1 = sorted[Math.floor(vals.length * 0.25)];
  const med = sorted[Math.floor(vals.length * 0.50)];
  const q3 = sorted[Math.floor(vals.length * 0.75)];
  const iqr = q3 - q1;
  const minV = Math.max(sorted[0], q1 - 1.5 * iqr);
  const maxV = Math.min(sorted[vals.length - 1], q3 + 1.5 * iqr);
  const yMin = Math.min(...vals) - iqr * 0.2;
  const yMax = Math.max(...vals) + iqr * 0.2;
  const outliers = vals.map((v, i) => ({ i, v })).filter(p => p.v < minV || p.v > maxV);
  return renderInteractiveChart({
    kind: 'boxplot',
    width: 380, height: 380, pad: { l: 56, r: 80, t: 18, b: 36 },
    xRange: [0, 2], yRange: [yMin, yMax], xLabels: ['', ''],
    xLabel: '', yLabel: label,
    points: outliers.map(o => ({ i: o.i, x: 1, y: o.v, label: `outlier obs ${o.i + 1}` })),
    brushable: false,
    overlays: [{ id: 'stats', label: 'Q-labels', defaultOn: true,
      build: (g, { xScale, yScale }) => {
        const cx = xScale(1);
        for (const [val, lbl] of [[q3, 'Q3'], [med, 'Md'], [q1, 'Q1']]) {
          g.append(svg('text', { x: cx + 40, y: yScale(val) + 3, 'font-size': 10,
            fill: 'var(--muted)' }, `${lbl} ${fmtNum(val)}`));
        }
      },
    }],
    draw: (root, { xScale, yScale }) => {
      const cx = xScale(1);
      const w = 60;
      root.append(svg('line', { x1: cx, x2: cx, y1: yScale(minV), y2: yScale(maxV), stroke: 'var(--ink-2)' }));
      root.append(svg('line', { x1: cx - 12, x2: cx + 12, y1: yScale(minV), y2: yScale(minV), stroke: 'var(--ink-2)' }));
      root.append(svg('line', { x1: cx - 12, x2: cx + 12, y1: yScale(maxV), y2: yScale(maxV), stroke: 'var(--ink-2)' }));
      root.append(svg('rect', { x: cx - w / 2, y: yScale(q3), width: w, height: yScale(q1) - yScale(q3),
        fill: 'var(--accent)', opacity: 0.18, stroke: 'var(--ink-2)' }));
      root.append(svg('line', { x1: cx - w / 2, x2: cx + w / 2, y1: yScale(med), y2: yScale(med),
        stroke: 'var(--accent)', 'stroke-width': 2 }));
      for (const o of outliers) root.append(svg('circle', { cx, cy: yScale(o.v), r: 3, fill: 'var(--danger)' }));
    },
  });
}

function boxplotGrouped(groups, valueLabel, groupLabel) {
  const keys = Object.keys(groups);
  const yAll = keys.flatMap(k => groups[k]);
  if (!yAll.length) return emptyCard('No data.');
  const yMin = Math.min(...yAll), yMax = Math.max(...yAll);
  const pad = (yMax - yMin) * 0.1 || 1;
  const boxW = 0.4;
  return renderInteractiveChart({
    kind: 'boxplot-grouped',
    width: Math.max(720, keys.length * 80 + 200), height: 400,
    pad: { l: 56, r: 18, t: 16, b: 80 },
    xRange: [0.5, keys.length + 0.5], yRange: [yMin - pad, yMax + pad],
    xLabels: keys, xLabel: groupLabel, yLabel: valueLabel,
    points: [],
    brushable: false,
    draw: (root, { xScale, yScale }) => {
      keys.forEach((k, i) => {
        const vals = groups[k].slice().sort((a, b) => a - b);
        const q1 = vals[Math.floor(vals.length * 0.25)];
        const med = vals[Math.floor(vals.length * 0.50)];
        const q3 = vals[Math.floor(vals.length * 0.75)];
        const iqr = q3 - q1;
        const minV = Math.max(vals[0], q1 - 1.5 * iqr);
        const maxV = Math.min(vals[vals.length - 1], q3 + 1.5 * iqr);
        const cx = xScale(i + 1);
        const w = (xScale(i + 1 + boxW) - xScale(i + 1 - boxW));
        root.append(svg('line', { x1: cx, x2: cx, y1: yScale(minV), y2: yScale(maxV), stroke: 'var(--ink-2)' }));
        root.append(svg('line', { x1: cx - 8, x2: cx + 8, y1: yScale(minV), y2: yScale(minV), stroke: 'var(--ink-2)' }));
        root.append(svg('line', { x1: cx - 8, x2: cx + 8, y1: yScale(maxV), y2: yScale(maxV), stroke: 'var(--ink-2)' }));
        root.append(svg('rect', { x: cx - w / 2, y: yScale(q3), width: w, height: yScale(q1) - yScale(q3),
          fill: 'var(--accent)', opacity: 0.20, stroke: 'var(--ink-2)' }));
        root.append(svg('line', { x1: cx - w / 2, x2: cx + w / 2, y1: yScale(med), y2: yScale(med),
          stroke: 'var(--accent)', 'stroke-width': 2 }));
        for (const v of vals) {
          if (v < minV || v > maxV) {
            root.append(svg('circle', { cx, cy: yScale(v), r: 2.5, fill: 'var(--danger)' }));
          }
        }
      });
    },
  });
}

function cfgViolin({ x, group }) {
  if (!group) return violinPlot({ [x]: getNumeric(x) }, x);
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]), g = r[group] == null ? '(missing)' : String(r[group]);
    if (Number.isFinite(v)) (groups[g] = groups[g] || []).push(v);
  }
  return violinPlot(groups, x);
}

function violinPlot(groups, valueLabel) {
  const keys = Object.keys(groups);
  const yAll = keys.flatMap(k => groups[k]);
  if (!yAll.length) return emptyCard('No data.');
  const yMin = Math.min(...yAll), yMax = Math.max(...yAll);
  const pad = (yMax - yMin) * 0.08 || 1;
  return renderInteractiveChart({
    kind: 'violin',
    width: Math.max(560, keys.length * 130 + 120), height: 440,
    pad: { l: 56, r: 18, t: 18, b: 80 },
    xRange: [0.5, keys.length + 0.5], yRange: [yMin - pad, yMax + pad],
    xLabels: keys, yLabel: valueLabel,
    points: [], brushable: false,
    draw: (root, { xScale, yScale }) => {
      keys.forEach((k, i) => {
        const vals = groups[k];
        const sd = stddev(vals) || 1e-9;
        const bw = 1.06 * sd * Math.pow(vals.length, -1 / 5);
        const N = 50;
        const yPts = [], dens = [];
        for (let j = 0; j <= N; j++) yPts.push(yMin + (yMax - yMin) * j / N);
        for (const yp of yPts) dens.push(kde1d(vals, yp, bw));
        const maxD = Math.max(...dens) || 1;
        const cx = xScale(i + 1);
        const halfW = Math.min(40, (xScale(i + 1.5) - xScale(i + 1)) * 0.85);
        const right = yPts.map((yp, j) => `${j ? 'L' : 'M'} ${cx + (dens[j] / maxD) * halfW} ${yScale(yp)}`).join(' ');
        const left = yPts.slice().reverse().map((yp, j) => {
          const idx = yPts.length - 1 - j;
          return `L ${cx - (dens[idx] / maxD) * halfW} ${yScale(yp)}`;
        }).join(' ');
        root.append(svg('path', { d: right + ' ' + left + ' Z',
          fill: 'var(--accent)', opacity: 0.22, stroke: 'var(--ink-2)', 'stroke-width': 1 }));
        // Box on top
        const sorted = vals.slice().sort((a, b) => a - b);
        const q1 = sorted[Math.floor(vals.length * 0.25)];
        const med = sorted[Math.floor(vals.length * 0.50)];
        const q3 = sorted[Math.floor(vals.length * 0.75)];
        root.append(svg('rect', { x: cx - 6, y: yScale(q3), width: 12,
          height: yScale(q1) - yScale(q3),
          fill: 'var(--bg)', stroke: 'var(--ink-2)', 'stroke-width': 1 }));
        root.append(svg('line', { x1: cx - 6, x2: cx + 6, y1: yScale(med), y2: yScale(med),
          stroke: 'var(--accent)', 'stroke-width': 2 }));
      });
    },
  });
}

function cfgStrip({ x, group }) {
  if (!group) {
    const vals = getNumeric(x);
    if (!vals.length) return emptyCard('No data.');
    const yMin = Math.min(...vals), yMax = Math.max(...vals);
    const pad = (yMax - yMin) * 0.08 || 1;
    const points = vals.map((v, i) => ({ i, x: 1 + (Math.random() - 0.5) * 0.6, y: v, label: 'obs ' + (i + 1) }));
    return renderInteractiveChart({
      kind: 'strip',
      width: 480, height: 400, pad: { l: 56, r: 18, t: 18, b: 36 },
      xRange: [0.2, 1.8], yRange: [yMin - pad, yMax + pad],
      xLabels: [''], yLabel: x,
      points, brushable: false,
      draw: (root, { xScale, yScale }) => {
        for (const p of points)
          root.append(svg('circle', { cx: xScale(p.x), cy: yScale(p.y), r: 3,
            fill: 'var(--accent)', opacity: 0.55 }));
      },
    });
  }
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]), g = r[group] == null ? '(missing)' : String(r[group]);
    if (Number.isFinite(v)) (groups[g] = groups[g] || []).push(v);
  }
  const keys = Object.keys(groups);
  const yAll = keys.flatMap(k => groups[k]);
  const yMin = Math.min(...yAll), yMax = Math.max(...yAll);
  const pad = (yMax - yMin) * 0.08 || 1;
  const points = [];
  keys.forEach((k, gi) => {
    for (const v of groups[k]) {
      points.push({ i: points.length, x: (gi + 1) + (Math.random() - 0.5) * 0.5, y: v,
        label: `${k}: ${fmtNum(v)}` });
    }
  });
  return renderInteractiveChart({
    kind: 'strip',
    width: Math.max(560, keys.length * 110 + 80), height: 400,
    pad: { l: 56, r: 18, t: 18, b: 80 },
    xRange: [0.5, keys.length + 0.5], yRange: [yMin - pad, yMax + pad],
    xLabels: keys, yLabel: x,
    points, brushable: false,
    draw: (root, { xScale, yScale }) => {
      for (const p of points)
        root.append(svg('circle', { cx: xScale(p.x), cy: yScale(p.y), r: 2.5,
          fill: 'var(--accent)', opacity: 0.55 }));
    },
  });
}

function cfgRidge({ x, group }) {
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]), g = r[group] == null ? '(missing)' : String(r[group]);
    if (Number.isFinite(v)) (groups[g] = groups[g] || []).push(v);
  }
  const keys = Object.keys(groups);
  if (keys.length === 0) return emptyCard('No data.');
  const yAll = keys.flatMap(k => groups[k]);
  const mn = Math.min(...yAll), mx = Math.max(...yAll);
  const pad = (mx - mn) * 0.12 || 1;
  return renderInteractiveChart({
    kind: 'ridge',
    width: 760, height: Math.max(280, keys.length * 60 + 80),
    pad: { l: 130, r: 24, t: 16, b: 36 },
    xRange: [mn - pad, mx + pad], yRange: [0, keys.length + 0.6],
    xLabel: x, yLabel: '',
    points: [], brushable: false,
    showAxes: false,
    draw: (root, { xScale, yScale, plot }) => {
      // X axis ticks at bottom
      for (const t of niceTicks(mn - pad, mx + pad, 6)) {
        const x_ = xScale(t);
        root.append(svg('text', { x: x_, y: plot.y + plot.h + 16,
          'font-size': 10, 'text-anchor': 'middle', fill: 'var(--muted)' }, fmtNum(t)));
      }
      keys.forEach((k, idx) => {
        const baselineY = yScale(idx + 0.5);
        const ridgeHeight = (plot.h / keys.length) * 0.9;
        const vals = groups[k];
        const sd = stddev(vals) || 1e-9;
        const bw = 1.06 * sd * Math.pow(vals.length, -1 / 5);
        const N = 80;
        const xs = [], dens = [];
        for (let j = 0; j <= N; j++) {
          const xv = mn - pad + (mx - mn + 2 * pad) * (j / N);
          xs.push(xv);
          dens.push(kde1d(vals, xv, bw));
        }
        const maxD = Math.max(...dens) || 1;
        const path = xs.map((xv, j) => `${j ? 'L' : 'M'} ${xScale(xv)} ${baselineY - (dens[j] / maxD) * ridgeHeight}`).join(' ');
        const fillPath = path + ` L ${xScale(xs[xs.length - 1])} ${baselineY} L ${xScale(xs[0])} ${baselineY} Z`;
        root.append(svg('path', { d: fillPath, fill: 'var(--accent)', opacity: 0.30 - idx * 0.02 < 0.1 ? 0.1 : 0.30 - idx * 0.02 }));
        root.append(svg('path', { d: path, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1 }));
        // Group label on left
        root.append(svg('text', { x: plot.x - 8, y: baselineY - ridgeHeight * 0.15,
          'font-size': 11, 'text-anchor': 'end', fill: 'var(--ink-2)' },
          k.length > 18 ? k.slice(0, 18) + '…' : k));
      });
    },
  });
}

function cfgQQ({ x }) {
  const vals = getNumeric(x);
  if (vals.length < 3) return emptyCard('Need ≥ 3 points.');
  const sorted = vals.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const points = [];
  for (let i = 0; i < n; i++) {
    const p = (i + 0.5) / n;
    points.push({ i, x: qNorm(p), y: sorted[i] });
  }
  const x1 = qNorm(0.25), x3 = qNorm(0.75);
  const y1 = sorted[Math.floor(n * 0.25)], y3 = sorted[Math.floor(n * 0.75)];
  const slope = (y3 - y1) / (x3 - x1 || 1);
  const intercept = y1 - slope * x1;
  return renderInteractiveChart({
    kind: 'qq',
    width: 720, height: 460, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [points[0].x - 0.5, points[n - 1].x + 0.5],
    yRange: [Math.min(...sorted) - (Math.max(...sorted) - Math.min(...sorted)) * 0.05,
              Math.max(...sorted) + (Math.max(...sorted) - Math.min(...sorted)) * 0.05],
    xLabel: 'Theoretical normal quantile', yLabel: x,
    points,
    overlays: [{ id: 'ref', label: 'Normal reference', defaultOn: true,
      build: (g, { xScale, yScale, view }) => {
        g.append(svg('line', {
          x1: xScale(view.xMin), y1: yScale(intercept + slope * view.xMin),
          x2: xScale(view.xMax), y2: yScale(intercept + slope * view.xMax),
          stroke: 'var(--accent)', 'stroke-dasharray': '4 3', 'stroke-width': 1.5,
        }));
      },
    }],
    draw: (root, { xScale, yScale }) => {
      for (const p of points) {
        root.append(svg('circle', { cx: xScale(p.x), cy: yScale(p.y), r: 3,
          fill: 'var(--ink-2)', opacity: 0.75 }));
      }
    },
  });
}

function cfgECDF({ x }) {
  const vals = getNumeric(x).slice().sort((a, b) => a - b);
  if (vals.length < 2) return emptyCard('Need ≥ 2 values.');
  const points = vals.map((v, i) => ({ i, x: v, y: (i + 1) / vals.length }));
  const mn = vals[0], mx = vals[vals.length - 1];
  return renderInteractiveChart({
    kind: 'ecdf',
    width: 720, height: 400, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [mn, mx], yRange: [0, 1],
    xLabel: x, yLabel: 'F(x)',
    points,
    draw: (root, { xScale, yScale, plot }) => {
      const ptList = points.slice();
      let d = `M ${xScale(mn)} ${yScale(0)}`;
      for (let i = 0; i < ptList.length; i++) {
        d += ` L ${xScale(ptList[i].x)} ${yScale(i ? ptList[i - 1].y : 0)}`;
        d += ` L ${xScale(ptList[i].x)} ${yScale(ptList[i].y)}`;
      }
      d += ` L ${xScale(mx)} ${yScale(1)}`;
      root.append(svg('path', { d, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
    },
  });
}

function cfgScatter({ x, y, color }) {
  const recs = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const c = color ? (r[color] == null ? '(missing)' : String(r[color])) : null;
      recs.push({ x: a, y: b, c });
    }
  }
  if (!recs.length) return emptyCard('No paired numeric data.');
  const xs = recs.map(r => r.x), ys = recs.map(r => r.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  // Color groups
  let groups = null, palette = null;
  if (color) {
    const cs = [...new Set(recs.map(r => r.c))];
    palette = paletteFor(cs.length);
    groups = Object.fromEntries(cs.map((c, i) => [c, palette[i]]));
  }
  // Fit
  const n = recs.length;
  const sx = recs.reduce((a, r) => a + r.x, 0);
  const sy = recs.reduce((a, r) => a + r.y, 0);
  const sxy = recs.reduce((a, r) => a + r.x * r.y, 0);
  const sxx = recs.reduce((a, r) => a + r.x * r.x, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const intercept = (sy - slope * sx) / n;
  const r = pearson(xs, ys);
  const points = recs.map((r_, i) => ({ i, x: r_.x, y: r_.y,
    label: groups ? r_.c : null, color: groups ? groups[r_.c] : null }));
  return renderInteractiveChart({
    kind: 'scatter',
    width: 760, height: 480, pad: { l: 60, r: 18, t: 16, b: 48 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: x, yLabel: y,
    points,
    overlays: [{
      id: 'fit',
      label: `Fit y=${slope.toFixed(2)}x+${intercept.toFixed(2)} · r=${r.toFixed(2)}`,
      defaultOn: true,
      build: (g, { xScale, yScale, view }) => {
        g.append(svg('line', {
          x1: xScale(view.xMin), y1: yScale(intercept + slope * view.xMin),
          x2: xScale(view.xMax), y2: yScale(intercept + slope * view.xMax),
          stroke: 'var(--accent)', 'stroke-dasharray': '4 3', 'stroke-width': 1.5,
        }));
      },
    }],
    draw: (root, { xScale, yScale }) => {
      for (const p of points) {
        root.append(svg('circle', { cx: xScale(p.x), cy: yScale(p.y), r: 3,
          fill: p.color || 'var(--ink-2)', opacity: 0.7 }));
      }
    },
  });
}

function cfgBubble({ x, y, size }) {
  const recs = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]), s = Number(r[size]);
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(s) && s > 0) {
      recs.push({ x: a, y: b, s });
    }
  }
  if (!recs.length) return emptyCard('Need positive size values.');
  const xs = recs.map(r => r.x), ys = recs.map(r => r.y), ss = recs.map(r => r.s);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const sMin = Math.min(...ss), sMax = Math.max(...ss);
  const xPad = (xMax - xMin) * 0.06 || 1, yPad = (yMax - yMin) * 0.06 || 1;
  const points = recs.map((r_, i) => ({ i, x: r_.x, y: r_.y,
    meta: { [size]: fmtNum(r_.s) },
    r: 4 + 20 * Math.sqrt((r_.s - sMin) / (sMax - sMin || 1)) }));
  return renderInteractiveChart({
    kind: 'bubble',
    width: 760, height: 480, pad: { l: 60, r: 18, t: 16, b: 48 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: x, yLabel: y,
    points,
    draw: (root, { xScale, yScale }) => {
      for (const p of points) {
        root.append(svg('circle', { cx: xScale(p.x), cy: yScale(p.y), r: p.r,
          fill: 'var(--accent)', opacity: 0.30, stroke: 'var(--accent)', 'stroke-width': 0.8 }));
      }
    },
  });
}

function cfgHexbin({ x, y }) {
  const xs = [], ys = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]);
    if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
  }
  if (xs.length < 5) return emptyCard('Need ≥ 5 points.');
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'hexbin',
    width: 760, height: 480, pad: { l: 60, r: 18, t: 16, b: 48 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: x, yLabel: y,
    points: [],
    draw: (root, { xScale, yScale, plot }) => {
      const cols = 30;
      const cellW = plot.w / cols;
      const cellH = cellW * Math.sqrt(3) / 2;
      const counts = new Map();
      for (let i = 0; i < xs.length; i++) {
        const px = xScale(xs[i]), py = yScale(ys[i]);
        const col = Math.round((px - plot.x) / cellW);
        const row = Math.round((py - plot.y) / cellH);
        const k = col + ',' + row;
        if (!counts.has(k)) counts.set(k, { n: 0, col, row });
        counts.get(k).n++;
      }
      const maxN = Math.max(...[...counts.values()].map(v => v.n));
      for (const { n, col, row } of counts.values()) {
        const xOff = (row % 2) * cellW / 2;
        const cx = plot.x + col * cellW + xOff;
        const cy = plot.y + row * cellH;
        const t = n / maxN;
        const r = cellW / Math.sqrt(3);
        const pts = [];
        for (let j = 0; j < 6; j++) {
          const ang = Math.PI / 3 * j + Math.PI / 6;
          pts.push((cx + r * Math.cos(ang)).toFixed(2) + ',' + (cy + r * Math.sin(ang)).toFixed(2));
        }
        root.append(svg('polygon', { points: pts.join(' '),
          fill: `rgba(107, 85, 36, ${0.12 + 0.78 * t})`, stroke: 'none' }));
      }
    },
  });
}

function cfgContour({ x, y }) {
  const xs = [], ys = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]);
    if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
  }
  if (xs.length < 10) return emptyCard('Need ≥ 10 points for a smooth contour.');
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  // Grid-based 2D KDE
  const N = 48;
  const sdX = stddev(xs) || 1e-9, sdY = stddev(ys) || 1e-9;
  const bwX = 1.06 * sdX * Math.pow(xs.length, -1 / 6);
  const bwY = 1.06 * sdY * Math.pow(xs.length, -1 / 6);
  const grid = [];
  let maxD = 0;
  for (let i = 0; i < N; i++) {
    const row = [];
    const xv = (xMin - xPad) + (xMax - xMin + 2 * xPad) * (i / (N - 1));
    for (let j = 0; j < N; j++) {
      const yv = (yMin - yPad) + (yMax - yMin + 2 * yPad) * (j / (N - 1));
      let s = 0;
      for (let k = 0; k < xs.length; k++) {
        const ux = (xv - xs[k]) / bwX, uy = (yv - ys[k]) / bwY;
        s += Math.exp(-0.5 * (ux * ux + uy * uy));
      }
      row.push(s);
      if (s > maxD) maxD = s;
    }
    grid.push(row);
  }
  // Render filled level rects (cheap heatmap approximation of contour fill).
  return renderInteractiveChart({
    kind: 'contour',
    width: 760, height: 480, pad: { l: 60, r: 18, t: 16, b: 48 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: x, yLabel: y,
    points: xs.map((x_, i) => ({ i, x: x_, y: ys[i] })),
    draw: (root, { xScale, yScale, plot }) => {
      const cellW = plot.w / (N - 1);
      const cellH = plot.h / (N - 1);
      for (let i = 0; i < N - 1; i++) {
        for (let j = 0; j < N - 1; j++) {
          const t = grid[i][j] / maxD;
          if (t < 0.05) continue;
          root.append(svg('rect', {
            x: plot.x + i * cellW, y: plot.y + plot.h - (j + 1) * cellH,
            width: cellW + 0.5, height: cellH + 0.5,
            fill: `rgba(107, 85, 36, ${t * 0.78})`,
          }));
        }
      }
      // Points overlay (low opacity)
      for (let k = 0; k < xs.length; k++) {
        root.append(svg('circle', { cx: xScale(xs[k]), cy: yScale(ys[k]), r: 1.5,
          fill: 'var(--ink)', opacity: 0.35 }));
      }
    },
  });
}

function cfgLag({ x, lag }) {
  const k = Math.max(1, parseInt(lag) || 1);
  const v = getNumeric(x);
  if (v.length <= k) return emptyCard(`Need more than ${k} values.`);
  const xs = v.slice(0, -k), ys = v.slice(k);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  const points = xs.map((x_, i) => ({ i, x: x_, y: ys[i] }));
  return renderInteractiveChart({
    kind: 'lag',
    width: 720, height: 460, pad: { l: 56, r: 18, t: 16, b: 44 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: `${x}(t)`, yLabel: `${x}(t+${k})`,
    points,
    overlays: [{ id: 'diag', label: 'y = x', defaultOn: true,
      build: (g, { xScale, yScale, view }) => {
        const lo = Math.max(view.xMin, view.yMin), hi = Math.min(view.xMax, view.yMax);
        g.append(svg('line', { x1: xScale(lo), y1: yScale(lo),
          x2: xScale(hi), y2: yScale(hi),
          stroke: 'var(--accent)', 'stroke-dasharray': '4 3', 'stroke-width': 1 }));
      },
    }],
    draw: (root, { xScale, yScale }) => {
      for (const p of points) {
        root.append(svg('circle', { cx: xScale(p.x), cy: yScale(p.y), r: 3,
          fill: 'var(--ink-2)', opacity: 0.7 }));
      }
    },
  });
}

function cfgRun({ x }) {
  const v = getNumeric(x);
  if (!v.length) return emptyCard('No data.');
  const med = quantile(v, 0.5);
  const mn = Math.min(...v), mx = Math.max(...v);
  const range = (mx - mn) || 1;
  const points = v.map((y, i) => ({ i, x: i + 1, y, label: `obs ${i + 1}` }));
  return renderInteractiveChart({
    kind: 'run',
    width: 760, height: 360, pad: { l: 56, r: 18, t: 16, b: 44 },
    xRange: [1, Math.max(2, v.length)], yRange: [mn - range * 0.08, mx + range * 0.08],
    xLabel: 'observation', yLabel: x,
    points,
    overlays: [{ id: 'median', label: `Median ${fmtNum(med)}`, defaultOn: true,
      build: (g, { xScale, yScale, plot }) => {
        const py = yScale(med);
        g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: py, y2: py,
          stroke: 'var(--muted)', 'stroke-dasharray': '4 4' }));
      },
    }],
    draw: (root, { xScale, yScale, view }) => {
      const vis = [];
      for (let i = 0; i < v.length; i++) {
        if (i + 1 >= view.xMin && i + 1 <= view.xMax) vis.push(i);
      }
      if (vis.length > 1) {
        const d = vis.map((i, k) => `${k ? 'L' : 'M'} ${xScale(i + 1)} ${yScale(v[i])}`).join(' ');
        root.append(svg('path', { d, stroke: 'var(--ink-2)', 'stroke-width': 1.5, fill: 'none' }));
      }
      for (const i of vis)
        root.append(svg('circle', { cx: xScale(i + 1), cy: yScale(v[i]), r: 3, fill: 'var(--ink-2)' }));
    },
  });
}

function cfgControl({ x }) {
  const v = getNumeric(x);
  if (v.length < 4) return emptyCard('Need ≥ 4 values.');
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const mr = [];
  for (let i = 1; i < v.length; i++) mr.push(Math.abs(v[i] - v[i - 1]));
  const mrBar = mr.reduce((a, b) => a + b, 0) / mr.length;
  const sigma = mrBar / 1.128;
  const ucl = mean + 3 * sigma, lcl = mean - 3 * sigma;
  const span = (ucl - lcl) || 1;
  const yMin = Math.min(lcl, ...v) - span * 0.06;
  const yMax = Math.max(ucl, ...v) + span * 0.06;
  const points = v.map((y, i) => {
    const viol = y > ucl || y < lcl;
    return { i, x: i + 1, y, label: `obs ${i + 1}`,
      meta: { status: viol ? 'OUT OF CONTROL' : 'in control' } };
  });
  return renderInteractiveChart({
    kind: 'control',
    width: 760, height: 380, pad: { l: 60, r: 18, t: 16, b: 44 },
    xRange: [1, Math.max(2, v.length)], yRange: [yMin, yMax],
    xLabel: 'observation', yLabel: x,
    points,
    overlays: [
      { id: 'limits', label: 'Control limits', defaultOn: true,
        build: (g, { yScale, plot }) => {
          for (const [val, lbl, dash, color] of [
            [mean, 'CL', null, 'var(--muted)'],
            [ucl, 'UCL', '4 4', 'var(--danger)'],
            [lcl, 'LCL', '4 4', 'var(--danger)'],
          ]) {
            g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yScale(val), y2: yScale(val),
              stroke: color, 'stroke-dasharray': dash, 'stroke-width': 1 }));
            g.append(svg('text', { x: plot.x + plot.w - 4, y: yScale(val) - 3,
              'font-size': 10, 'text-anchor': 'end', fill: color }, `${lbl} ${fmtNum(val)}`));
          }
        },
      },
      { id: 'zones', label: 'σ zones', defaultOn: false,
        build: (g, { yScale, plot }) => {
          for (let k = 1; k <= 2; k++) {
            const yU = yScale(mean + k * sigma), yL = yScale(mean - k * sigma);
            g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yU, y2: yU,
              stroke: 'var(--muted)', 'stroke-dasharray': '1 4', 'stroke-width': 0.5, opacity: 0.6 }));
            g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yL, y2: yL,
              stroke: 'var(--muted)', 'stroke-dasharray': '1 4', 'stroke-width': 0.5, opacity: 0.6 }));
          }
        },
      },
    ],
    draw: (root, { xScale, yScale, view }) => {
      const vis = [];
      for (let i = 0; i < v.length; i++) {
        if (i + 1 >= view.xMin && i + 1 <= view.xMax) vis.push(i);
      }
      if (vis.length > 1) {
        const d = vis.map((i, k) => `${k ? 'L' : 'M'} ${xScale(i + 1)} ${yScale(v[i])}`).join(' ');
        root.append(svg('path', { d, stroke: 'var(--ink-2)', 'stroke-width': 1.5, fill: 'none' }));
      }
      for (const i of vis) {
        const y = v[i];
        const viol = y > ucl || y < lcl;
        root.append(svg('circle', { cx: xScale(i + 1), cy: yScale(y),
          r: viol ? 5 : 3,
          fill: viol ? 'var(--danger)' : 'var(--ink-2)',
          stroke: viol ? 'var(--bg)' : 'none', 'stroke-width': viol ? 1 : 0 }));
      }
    },
  });
}

function cfgMultiline({ x, group }) {
  const series = {};
  state.rows.forEach((r, i) => {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) return;
    const g = r[group] == null ? '(missing)' : String(r[group]);
    if (!series[g]) series[g] = [];
    series[g].push({ i: series[g].length + 1, y: v });
  });
  const keys = Object.keys(series);
  if (!keys.length) return emptyCard('No data.');
  const palette = paletteFor(keys.length);
  const allY = keys.flatMap(k => series[k].map(p => p.y));
  const maxLen = Math.max(...keys.map(k => series[k].length));
  const mn = Math.min(...allY), mx = Math.max(...allY);
  const range = (mx - mn) || 1;
  return renderInteractiveChart({
    kind: 'multiline',
    width: 760, height: 420, pad: { l: 60, r: 130, t: 18, b: 44 },
    xRange: [1, maxLen], yRange: [mn - range * 0.05, mx + range * 0.05],
    xLabel: 'observation', yLabel: x,
    points: [], brushable: true,
    draw: (root, { xScale, yScale, plot }) => {
      keys.forEach((k, idx) => {
        const pts = series[k];
        const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${xScale(p.i)} ${yScale(p.y)}`).join(' ');
        root.append(svg('path', { d, fill: 'none', stroke: palette[idx], 'stroke-width': 1.5, opacity: 0.85 }));
      });
      // Legend
      keys.forEach((k, idx) => {
        const y = plot.y + 4 + idx * 18;
        root.append(svg('rect', { x: plot.x + plot.w + 8, y: y - 4, width: 10, height: 10, fill: palette[idx] }));
        root.append(svg('text', { x: plot.x + plot.w + 24, y: y + 4, 'font-size': 11, fill: 'var(--ink-2)' },
          k.length > 12 ? k.slice(0, 12) + '…' : k));
      });
    },
  });
}

function cfgACF({ x }) {
  const v = getNumeric(x);
  const n = v.length;
  if (n < 10) return emptyCard('Need ≥ 10 values.');
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const c0 = v.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const maxLag = Math.min(30, Math.floor(n / 2));
  const acf = [];
  for (let k = 1; k <= maxLag; k++) {
    let s = 0;
    for (let i = 0; i < n - k; i++) s += (v[i] - mean) * (v[i + k] - mean);
    acf.push(s / n / c0);
  }
  const sigBound = 1.96 / Math.sqrt(n);
  const points = acf.map((a, i) => ({ i, x: i + 1, y: a, label: `lag ${i + 1}`, meta: { acf: fmtNum(a) } }));
  return renderInteractiveChart({
    kind: 'acf',
    width: 720, height: 360, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [0.5, maxLag + 0.5], yRange: [-1.05, 1.05],
    xLabel: 'lag', yLabel: 'autocorrelation',
    points,
    overlays: [{ id: 'sig', label: `±${sigBound.toFixed(3)} (95% bounds)`, defaultOn: true,
      build: (g, { xScale, yScale, plot }) => {
        for (const v_ of [sigBound, -sigBound]) {
          g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yScale(v_), y2: yScale(v_),
            stroke: 'var(--accent)', 'stroke-dasharray': '4 4', 'stroke-width': 1 }));
        }
        g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yScale(0), y2: yScale(0),
          stroke: 'var(--muted)' }));
      },
    }],
    draw: (root, { xScale, yScale }) => {
      acf.forEach((a, i) => {
        const px = xScale(i + 1);
        root.append(svg('line', { x1: px, y1: yScale(0), x2: px, y2: yScale(a),
          stroke: Math.abs(a) > sigBound ? 'var(--danger)' : 'var(--ink-2)', 'stroke-width': 2 }));
        root.append(svg('circle', { cx: px, cy: yScale(a), r: 3,
          fill: Math.abs(a) > sigBound ? 'var(--danger)' : 'var(--ink-2)' }));
      });
    },
  });
}

function cfgCumsum({ x }) {
  const v = getNumeric(x);
  if (!v.length) return emptyCard('No data.');
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  let s = 0;
  const cs = v.map(y => (s += y - mean));
  const mn = Math.min(...cs), mx = Math.max(...cs);
  const range = (mx - mn) || 1;
  const points = cs.map((y, i) => ({ i, x: i + 1, y, label: `obs ${i + 1}` }));
  return renderInteractiveChart({
    kind: 'cumsum',
    width: 760, height: 360, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [1, v.length], yRange: [mn - range * 0.05, mx + range * 0.05],
    xLabel: 'observation', yLabel: 'cumsum(obs − mean)',
    points,
    overlays: [{ id: 'zero', label: 'Zero', defaultOn: true,
      build: (g, { xScale, yScale, plot }) => {
        g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yScale(0), y2: yScale(0),
          stroke: 'var(--muted)', 'stroke-dasharray': '4 4' }));
      },
    }],
    draw: (root, { xScale, yScale }) => {
      const d = cs.map((y, i) => `${i ? 'L' : 'M'} ${xScale(i + 1)} ${yScale(y)}`).join(' ');
      root.append(svg('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5 }));
    },
  });
}

function cfgBar({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).slice(0, 50);
  return categoricalBars(entries.map(e => e[0]), entries.map(e => e[1]), x, false);
}

function cfgPareto({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 50);
  return categoricalBars(sorted.map(e => e[0]), sorted.map(e => e[1]), x, true);
}

function categoricalBars(labels, values, xLabel, withCumLine) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cumPct = values.reduce((acc, c, i) => { acc.push((i ? acc[i - 1] : 0) + c / total); return acc; }, []);
  const points = values.map((c, i) => ({
    i, x: i + 1, y: c, label: labels[i],
    meta: { share: `${(c / total * 100).toFixed(1)}%`, cumulative: `${(cumPct[i] * 100).toFixed(1)}%` },
  }));
  return renderInteractiveChart({
    kind: withCumLine ? 'pareto' : 'bar',
    width: Math.max(720, labels.length * 32 + 200), height: 380,
    pad: { l: 56, r: withCumLine ? 56 : 18, t: 18, b: 86 },
    xRange: [0.5, labels.length + 0.5], yRange: [0, Math.max(...values) * 1.08],
    xLabels: labels, xLabel, yLabel: 'count',
    points, brushable: false,
    overlays: withCumLine ? [
      { id: 'cum', label: 'Cumulative %', defaultOn: true,
        build: (g, { xScale, plot }) => {
          const d = cumPct.map((p, i) => {
            const x_ = xScale(i + 1);
            const y_ = plot.y + (1 - p) * plot.h;
            return `${i ? 'L' : 'M'} ${x_} ${y_}`;
          }).join(' ');
          g.append(svg('path', { d, fill: 'none', stroke: 'var(--danger)', 'stroke-width': 1.5 }));
          for (const p of [0, 0.25, 0.5, 0.75, 1.0]) {
            const y_ = plot.y + (1 - p) * plot.h;
            g.append(svg('text', { x: plot.x + plot.w + 6, y: y_ + 3,
              'font-size': 10, fill: 'var(--muted)' }, `${(p * 100).toFixed(0)}%`));
          }
        },
      },
      { id: 'eighty', label: '80% line', defaultOn: true,
        build: (g, { plot }) => {
          const y = plot.y + 0.2 * plot.h;
          g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: y, y2: y,
            stroke: 'var(--danger)', 'stroke-dasharray': '3 3', opacity: 0.5 }));
        },
      },
    ] : [],
    draw: (root, { xScale, yScale, plot }) => {
      const barSlot = plot.w / labels.length;
      values.forEach((c, i) => {
        const cx = xScale(i + 1);
        const x_ = cx - barSlot / 2 + 4;
        const y_ = yScale(c);
        root.append(svg('rect', { x: x_, y: y_, width: barSlot - 8,
          height: plot.y + plot.h - y_,
          fill: 'var(--lens-bar)', opacity: 0.85 }));
      });
    },
  });
}

function cfgStacked({ x, group }) {
  const rowKeys = [...new Set(getCategorical(x))].slice(0, 30);
  const subKeys = [...new Set(getCategorical(group))];
  const palette = paletteFor(subKeys.length);
  const grid = rowKeys.map(rk => {
    const counts = subKeys.map(sk => 0);
    for (const r of state.rows) {
      const rv = r[x] == null ? '(missing)' : String(r[x]);
      const sv = r[group] == null ? '(missing)' : String(r[group]);
      if (rv === rk) {
        const idx = subKeys.indexOf(sv);
        if (idx >= 0) counts[idx]++;
      }
    }
    return counts;
  });
  const totals = grid.map(c => c.reduce((a, b) => a + b, 0));
  const maxTotal = Math.max(...totals);
  return renderInteractiveChart({
    kind: 'stacked',
    width: Math.max(760, rowKeys.length * 40 + 200), height: 420,
    pad: { l: 56, r: 130, t: 18, b: 86 },
    xRange: [0.5, rowKeys.length + 0.5], yRange: [0, maxTotal * 1.08],
    xLabels: rowKeys, xLabel: x, yLabel: 'count',
    points: [], brushable: false,
    draw: (root, { xScale, yScale, plot }) => {
      const slot = plot.w / rowKeys.length;
      rowKeys.forEach((_, i) => {
        const cx = xScale(i + 1);
        const x_ = cx - slot / 2 + 4;
        const widthBar = slot - 8;
        let bottom = plot.y + plot.h;
        grid[i].forEach((c, sIdx) => {
          if (c <= 0) return;
          const hgt = plot.h * (c / maxTotal);
          root.append(svg('rect', { x: x_, y: bottom - hgt, width: widthBar, height: hgt,
            fill: palette[sIdx], opacity: 0.9 }));
          bottom -= hgt;
        });
      });
      // Legend
      subKeys.forEach((k, idx) => {
        const y = plot.y + 6 + idx * 18;
        root.append(svg('rect', { x: plot.x + plot.w + 8, y: y - 6, width: 12, height: 12, fill: palette[idx] }));
        root.append(svg('text', { x: plot.x + plot.w + 26, y: y + 4, 'font-size': 11, fill: 'var(--ink-2)' },
          k.length > 12 ? k.slice(0, 12) + '…' : k));
      });
    },
  });
}

function cfgHeatmap({ x, y }) {
  const counts = {};
  const xSet = new Set(), ySet = new Set();
  for (const r of state.rows) {
    const a = r[x] == null ? '(missing)' : String(r[x]);
    const b = r[y] == null ? '(missing)' : String(r[y]);
    xSet.add(a); ySet.add(b);
    const k = a + '\x00' + b;
    counts[k] = (counts[k] || 0) + 1;
  }
  const xs = [...xSet].slice(0, 20), ys = [...ySet].slice(0, 20);
  const max = Math.max(...xs.flatMap(a => ys.map(b => counts[a + '\x00' + b] || 0))) || 1;
  // Custom render — categorical x and y, no brush.
  return renderInteractiveChart({
    kind: 'heatmap',
    width: Math.max(720, xs.length * 50 + 200),
    height: Math.max(360, ys.length * 32 + 120),
    pad: { l: 130, r: 24, t: 16, b: 88 },
    xRange: [0.5, xs.length + 0.5], yRange: [ys.length + 0.5, 0.5],
    xLabels: xs, yLabel: y,
    formatY: (v) => ys[Math.round(v - 0.5)] || '',
    points: [], brushable: false,
    draw: (root, { xScale, yScale, plot }) => {
      const cw = (xScale(2) - xScale(1));
      const ch = (yScale(1) - yScale(2));
      for (let i = 0; i < xs.length; i++) {
        for (let j = 0; j < ys.length; j++) {
          const v = counts[xs[i] + '\x00' + ys[j]] || 0;
          if (v === 0) continue;
          const t = v / max;
          root.append(svg('rect', {
            x: xScale(i + 1) - cw / 2, y: yScale(j + 1) - ch / 2,
            width: cw - 1, height: ch - 1,
            fill: `rgba(107, 85, 36, ${0.10 + 0.82 * t})`,
          }));
          if (t > 0.3) {
            root.append(svg('text', { x: xScale(i + 1), y: yScale(j + 1) + 4,
              'font-size': 11, 'text-anchor': 'middle',
              fill: t > 0.6 ? 'var(--bg)' : 'var(--ink)' }, String(v)));
          }
        }
      }
      // y-axis labels (categorical override)
      ys.forEach((lbl, j) => {
        root.append(svg('text', { x: plot.x - 8, y: yScale(j + 1) + 4,
          'font-size': 10, 'text-anchor': 'end', fill: 'var(--ink-2)' },
          lbl.length > 18 ? lbl.slice(0, 18) + '…' : lbl));
      });
    },
  });
}

function cfgMosaic({ x, y }) {
  const xs = getCategorical(x), ys = getCategorical(y);
  const xCounts = {}, yByX = {};
  for (let i = 0; i < xs.length; i++) {
    xCounts[xs[i]] = (xCounts[xs[i]] || 0) + 1;
    yByX[xs[i]] = yByX[xs[i]] || {};
    yByX[xs[i]][ys[i]] = (yByX[xs[i]][ys[i]] || 0) + 1;
  }
  const xKeys = Object.keys(xCounts).slice(0, 12);
  const yKeys = [...new Set(ys)].slice(0, 12);
  const palette = paletteFor(yKeys.length);
  const total = xs.length;
  const W = 760, H = 460, pad = { l: 56, r: 24, t: 18, b: 80 };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  let xCursor = pad.l;
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  xKeys.forEach((xk, xi) => {
    const xWidth = (xCounts[xk] / total) * plotW;
    let yCursor = pad.t;
    yKeys.forEach((yk, yi) => {
      const c = (yByX[xk] && yByX[xk][yk]) || 0;
      const h_ = (c / xCounts[xk]) * plotH;
      if (h_ > 0) {
        root.append(svg('rect', { x: xCursor, y: yCursor, width: xWidth - 2, height: h_ - 1,
          fill: palette[yi], opacity: 0.78 }));
        if (h_ > 18 && xWidth > 40) {
          root.append(svg('text', { x: xCursor + xWidth / 2, y: yCursor + h_ / 2 + 4,
            'font-size': 10, 'text-anchor': 'middle', fill: 'var(--bg)' }, String(c)));
        }
      }
      yCursor += h_;
    });
    root.append(svg('text', { x: xCursor + xWidth / 2, y: H - pad.b + 16,
      'font-size': 10, 'text-anchor': 'middle', fill: 'var(--ink-2)',
      transform: `rotate(-32 ${xCursor + xWidth / 2} ${H - pad.b + 16})` },
      xk.length > 12 ? xk.slice(0, 12) + '…' : xk));
    xCursor += xWidth;
  });
  // Legend
  yKeys.forEach((yk, yi) => {
    root.append(svg('rect', { x: W - pad.r - 130, y: pad.t + yi * 18, width: 12, height: 12, fill: palette[yi] }));
    root.append(svg('text', { x: W - pad.r - 114, y: pad.t + yi * 18 + 10,
      'font-size': 10, fill: 'var(--ink-2)' }, yk.length > 14 ? yk.slice(0, 14) + '…' : yk));
  });
  return wrapStaticChart(root, 'mosaic', x, y);
}

function wrapStaticChart(svgRoot, kind, xLabel, yLabel) {
  const wrap = h('div', { className: 'lens-chart', 'data-kind': kind });
  const ctrl = h('div', { className: 'lens-chart-toolbar' },
    xLabel ? h('span', { className: 'lens-hint' }, `x: ${xLabel}`) : null,
    yLabel ? h('span', { className: 'lens-hint' }, ` · y: ${yLabel}`) : null,
    h('span', { className: 'lens-spacer' }),
    h('button', { type: 'button', className: 'lens-chip',
      onclick: () => exportSvgEl(svgRoot, kind, 'png') }, '↓ PNG'),
    h('button', { type: 'button', className: 'lens-chip',
      onclick: () => exportSvgEl(svgRoot, kind, 'svg') }, '↓ SVG'),
  );
  wrap.append(ctrl, h('div', { className: 'lens-chart-host' }, svgRoot));
  return wrap;
}

function cfgSPLOM() {
  const schema = state.current?.schema_json || [];
  const cols = schema.filter(c => c.type === 'number').slice(0, 5).map(c => c.name);
  if (cols.length < 2) return emptyCard('Need at least 2 numeric columns.');
  const n = cols.length;
  const W = 720, cell = (W - 80) / n, H = cell * n + 80, pad = { l: 60, t: 30 };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const xs = state.rows.map(r => Number(r[cols[j]])).filter(Number.isFinite);
      const ys = state.rows.map(r => Number(r[cols[i]])).filter(Number.isFinite);
      const cellX = pad.l + j * cell, cellY = pad.t + i * cell;
      root.append(svg('rect', { x: cellX, y: cellY, width: cell - 2, height: cell - 2,
        fill: 'none', stroke: 'var(--lens-line)', 'stroke-width': 0.5 }));
      if (i === j) {
        root.append(svg('text', { x: cellX + cell / 2, y: cellY + cell / 2 + 5,
          'font-size': 12, 'font-family': 'var(--font-display)', 'font-style': 'italic',
          'text-anchor': 'middle', fill: 'var(--ink-2)' }, cols[i]));
      } else {
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        const yMin = Math.min(...ys), yMax = Math.max(...ys);
        const pairs = [];
        for (let k = 0; k < Math.min(xs.length, ys.length); k++) pairs.push([xs[k], ys[k]]);
        for (const [xv, yv] of pairs) {
          const px = cellX + ((xv - xMin) / (xMax - xMin || 1)) * (cell - 2);
          const py = cellY + (1 - (yv - yMin) / (yMax - yMin || 1)) * (cell - 2);
          root.append(svg('circle', { cx: px, cy: py, r: 1.2, fill: 'var(--ink-2)', opacity: 0.5 }));
        }
      }
    }
  }
  return wrapStaticChart(root, 'splom');
}

function cfgSparkMatrix() {
  const schema = state.current?.schema_json || [];
  const cols = schema.filter(c => c.type === 'number').map(c => c.name);
  if (!cols.length) return emptyCard('No numeric columns.');
  const wrap = h('div', { className: 'lens-spark-grid' });
  for (const c of cols) {
    const vals = getNumeric(c);
    if (!vals.length) continue;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const range = (mx - mn) || 1;
    const W = 260, H = 56, pad = 4;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
    const d = vals.map((y, i) => {
      const px = pad + (i / (vals.length - 1 || 1)) * (W - 2 * pad);
      const py = pad + (1 - (y - mn) / range) * (H - 2 * pad);
      return `${i ? 'L' : 'M'} ${px.toFixed(2)} ${py.toFixed(2)}`;
    }).join(' ');
    root.append(svg('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.4 }));
    const cell = h('div', { className: 'lens-spark-cell' },
      h('div', { className: 'lens-spark-name' }, c,
        h('span', { className: 'muted', style: 'font-size:10px;margin-left:6px' },
          `${fmtNum(mn)} – ${fmtNum(mx)}`)),
      root);
    wrap.append(cell);
  }
  return wrap;
}

function cfgCapability({ x, lsl, usl, target }) {
  const vals = getNumeric(x);
  if (!vals.length) return emptyCard('No data.');
  const lsl_ = lsl !== '' && lsl != null ? Number(lsl) : null;
  const usl_ = usl !== '' && usl != null ? Number(usl) : null;
  const tgt = target !== '' && target != null ? Number(target) : null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = stddev(vals);
  let cp = null, cpk = null;
  if (lsl_ != null && usl_ != null && sd > 0) {
    cp = (usl_ - lsl_) / (6 * sd);
    cpk = Math.min((usl_ - mean) / (3 * sd), (mean - lsl_) / (3 * sd));
  }
  // Build histogram via histogram fn but inject spec overlays
  const mn = Math.min(...vals, lsl_ ?? Infinity), mx = Math.max(...vals, usl_ ?? -Infinity);
  const nBins = Math.min(30, Math.max(5, Math.round(Math.sqrt(vals.length))));
  const binW = (mx - mn) / nBins || 1;
  const counts = new Array(nBins).fill(0);
  for (const v of vals) {
    const i = Math.min(nBins - 1, Math.max(0, Math.floor((v - mn) / binW)));
    counts[i]++;
  }
  const maxC = Math.max(...counts);
  return renderInteractiveChart({
    kind: 'capability',
    width: 760, height: 420, pad: { l: 60, r: 18, t: 36, b: 48 },
    xRange: [mn - binW * 0.2, mx + binW * 0.2], yRange: [0, maxC * 1.18],
    xLabel: x, yLabel: 'count',
    points: counts.map((c, i) => ({ i, x: mn + (i + 0.5) * binW, y: c, label: 'bin ' + (i + 1) })),
    overlays: [
      lsl_ != null ? { id: 'lsl', label: `LSL ${fmtNum(lsl_)}`, defaultOn: true,
        build: (g, { xScale, plot }) => {
          const x_ = xScale(lsl_);
          g.append(svg('line', { x1: x_, x2: x_, y1: plot.y, y2: plot.y + plot.h,
            stroke: 'var(--danger)', 'stroke-dasharray': '3 3', 'stroke-width': 1.5 }));
        }} : null,
      usl_ != null ? { id: 'usl', label: `USL ${fmtNum(usl_)}`, defaultOn: true,
        build: (g, { xScale, plot }) => {
          const x_ = xScale(usl_);
          g.append(svg('line', { x1: x_, x2: x_, y1: plot.y, y2: plot.y + plot.h,
            stroke: 'var(--danger)', 'stroke-dasharray': '3 3', 'stroke-width': 1.5 }));
        }} : null,
      tgt != null ? { id: 'target', label: `Target ${fmtNum(tgt)}`, defaultOn: true,
        build: (g, { xScale, plot }) => {
          const x_ = xScale(tgt);
          g.append(svg('line', { x1: x_, x2: x_, y1: plot.y, y2: plot.y + plot.h,
            stroke: 'var(--accent)', 'stroke-dasharray': '4 2', 'stroke-width': 1.5 }));
        }} : null,
      cpk != null ? { id: 'cpk', label: `Cpk = ${cpk.toFixed(2)}`, defaultOn: true,
        build: (g, { plot }) => {
          g.append(svg('text', { x: plot.x + plot.w - 4, y: plot.y - 8,
            'font-size': 13, 'text-anchor': 'end', fill: 'var(--accent)',
            'font-family': 'var(--font-display)' },
            `Cpk = ${cpk.toFixed(2)}  ·  Cp = ${cp.toFixed(2)}`));
        }} : null,
    ].filter(Boolean),
    draw: (root, { xScale, yScale, plot }) => {
      counts.forEach((c, i) => {
        const x0 = xScale(mn + i * binW), x1 = xScale(mn + (i + 1) * binW);
        const y0 = yScale(c);
        root.append(svg('rect', { x: x0 + 0.5, y: y0, width: Math.max(0, x1 - x0 - 1),
          height: plot.y + plot.h - y0, fill: 'var(--lens-bar)', opacity: 0.85 }));
      });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Interpreters
// ═══════════════════════════════════════════════════════════════════════

function interpHistogram({ x }) {
  const v = getNumeric(x);
  const n = v.length;
  if (!n) return 'No numeric values to interpret.';
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = stddev(v);
  const { skew, kurt } = skewKurt(v);
  const shape = Math.abs(skew) < 0.5 ? 'roughly symmetric'
              : skew > 0 ? 'right-skewed (tail to the high end)'
              : 'left-skewed (tail to the low end)';
  const tails = kurt > 1 ? 'heavier tails than normal'
              : kurt < -1 ? 'lighter tails than normal'
              : 'tail weight similar to a normal distribution';
  return `${n} observations of **${x}**, mean ${fmtNum(mean)} ± ${fmtNum(sd)}. The distribution is **${shape}** (skewness ${skew.toFixed(2)}) with **${tails}** (excess kurtosis ${kurt.toFixed(2)}).`;
}
function interpDensity({ x }) {
  return interpHistogram({ x }) + ' Density estimate uses Silverman\'s rule of thumb for bandwidth.';
}
function interpBoxplot({ x, group }) {
  if (!group) {
    const v = getNumeric(x);
    if (!v.length) return 'No data.';
    const q1 = quantile(v, 0.25), med = quantile(v, 0.5), q3 = quantile(v, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const out = v.filter(x => x < lo || x > hi).length;
    return `Median **${fmtNum(med)}**, IQR [${fmtNum(q1)}, ${fmtNum(q3)}] (width ${fmtNum(iqr)}). ${out} outlier${out === 1 ? '' : 's'} beyond 1.5×IQR.`;
  }
  return `Box plot of ${x} split by ${group}. Compare medians and IQRs; overlapping boxes suggest similar groups. For a formal test, run **2-sample t / Mann-Whitney** (2 groups) or **ANOVA / Kruskal-Wallis** (3+ groups) in Bench.`;
}
function interpViolin({ x, group }) {
  return interpBoxplot({ x, group }) + ' Violin halves show the density on each side — bulges far from the centre line reveal multimodality the box plot hides.';
}
function interpStrip({ x, group }) {
  const n = getNumeric(x).length;
  return `${n} observations of ${x}${group ? ' across ' + group + ' groups' : ''}. Every point is shown with a small horizontal jitter so overlapping values are visible. Watch for clusters, gaps, and outliers.`;
}
function interpRidge({ x, group }) {
  return `Density of **${x}** stacked per **${group}**. Lined-up peaks → same centre; offset peaks → location shift; different widths → variance differences. The shape comparison the box plot can't make.`;
}
function interpQQ({ x }) {
  const v = getNumeric(x);
  const { skew, kurt } = skewKurt(v);
  if (Math.abs(skew) < 0.4 && Math.abs(kurt) < 1) return `Points hug the reference line → the data are plausibly normal. Parametric tests (t-test, ANOVA, Cpk) are valid.`;
  if (Math.abs(skew) >= 0.4) return `S-shape / curve in the plot → the data are **skewed** (skewness ${skew.toFixed(2)}). Consider a Box-Cox transform or non-parametric methods (Mann-Whitney / Kruskal-Wallis).`;
  return `Tails fan out from the reference line → **${kurt > 0 ? 'heavy' : 'light'}** tails (excess kurtosis ${kurt.toFixed(2)}). Normality is borderline; consider robust methods.`;
}
function interpECDF({ x }) {
  const v = getNumeric(x);
  return `Empirical CDF of **${x}**. Read horizontally to answer "what fraction is below value v?". Median lands at ${fmtNum(quantile(v, 0.5))}. Step jumps signal repeated values.`;
}
function interpScatter({ x, y, color }) {
  const xs = [], ys = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]);
    if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const r = pearson(xs, ys);
  const r2 = r * r;
  const dir = r > 0 ? 'positive' : 'negative';
  const strength = Math.abs(r) < 0.3 ? 'very weak'
                : Math.abs(r) < 0.5 ? 'weak'
                : Math.abs(r) < 0.7 ? 'moderate'
                : Math.abs(r) < 0.9 ? 'strong'
                : 'very strong';
  return `${xs.length} paired observations. Pearson **r = ${r.toFixed(3)}** → ${strength} ${dir} linear relationship (R² = ${r2.toFixed(3)}). ${y} ${r2 > 0.1 ? 'explains ' + (r2 * 100).toFixed(0) + '% of the variance in ' + x + ' under a linear fit' : 'and ' + x + ' have essentially no linear relationship'}.${color ? ' Color encodes ' + color + ' — look for cluster-by-color patterns.' : ''} Look for curvature, clusters, or outliers the correlation coefficient hides.`;
}
function interpBubble({ x, y, size }) {
  return interpScatter({ x, y }) + ` Point area encodes ${size} — bigger dots = larger ${size} values.`;
}
function interpHexbin({ x, y }) {
  return interpScatter({ x, y }) + ' Hex tiles show local point density — darker tiles mean more points there.';
}
function interpContour({ x, y }) {
  return interpScatter({ x, y }) + ' Contours are constant-density surfaces of the smoothed 2-D distribution.';
}
function interpLag({ x, lag }) {
  const k = parseInt(lag) || 1;
  const v = getNumeric(x);
  const xs = v.slice(0, -k), ys = v.slice(k);
  const r = pearson(xs, ys);
  if (Math.abs(r) > 0.5) return `**Strong autocorrelation at lag ${k}** (r = ${r.toFixed(2)}) — the value at time t predicts t+${k}. Independence is violated for tests that assume it. Consider a control chart or time-series model.`;
  if (Math.abs(r) > 0.3) return `Moderate autocorrelation at lag ${k} (r = ${r.toFixed(2)}). Worth checking with a formal ACF.`;
  return `Cloud is roughly circular (lag-${k} autocorrelation r = ${r.toFixed(2)}) → observations are plausibly independent.`;
}
function interpRun({ x }) {
  const v = getNumeric(x);
  const med = quantile(v, 0.5);
  return `${v.length} observations of **${x}** in order. Median ${fmtNum(med)} drawn as the reference line. Long stretches on one side suggest a process shift; very short alternations suggest mixtures or oscillation. For statistical thresholds, switch to **Control chart**.`;
}
function interpControl({ x }) {
  const v = getNumeric(x);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const mr = [];
  for (let i = 1; i < v.length; i++) mr.push(Math.abs(v[i] - v[i - 1]));
  const mrBar = mr.reduce((a, b) => a + b, 0) / mr.length;
  const sigma = mrBar / 1.128;
  const ucl = mean + 3 * sigma, lcl = mean - 3 * sigma;
  const viol = v.filter(y => y > ucl || y < lcl).length;
  if (!viol) return `${v.length} points, centre ${fmtNum(mean)}, UCL ${fmtNum(ucl)}, LCL ${fmtNum(lcl)} (I-chart; σ̂ = MR̄/1.128 = ${fmtNum(sigma)}). No points beyond 3σ — the process is **in statistical control**. Capability indices are interpretable.`;
  return `**${viol} point${viol === 1 ? '' : 's'} beyond 3σ** (UCL ${fmtNum(ucl)}, LCL ${fmtNum(lcl)}). Process is not in control — investigate special causes before drawing capability conclusions.`;
}
function interpMultiline({ x, group }) {
  return `One line per ${group}. Lines diverging over the sequence → groups behave differently over time. Lines moving together → group effects are small. To test formally, run an **ANOVA** on ${x} by ${group}.`;
}
function interpACF({ x }) {
  const v = getNumeric(x);
  const n = v.length;
  const sigBound = 1.96 / Math.sqrt(n);
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const c0 = v.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  let acf1 = 0;
  for (let i = 0; i < n - 1; i++) acf1 += (v[i] - mean) * (v[i + 1] - mean);
  acf1 = acf1 / n / c0;
  const sig = Math.abs(acf1) > sigBound;
  return `Autocorrelation at lag 1 = ${acf1.toFixed(3)}. ${sig ? '**Significantly different from zero** (|r| > ' + sigBound.toFixed(3) + ') — the series has memory; an I-chart on individuals will misbehave because residuals aren\'t independent.' : 'Not significantly different from zero — series is plausibly independent.'} Bars in red exceed the ±2/√n significance bounds.`;
}
function interpCumsum({ x }) {
  return `Running sum of (observation − mean) for **${x}**. Flat = in-control mean. A sustained slope reveals a shift: upward slope → mean above target, downward → below. Slope-change points pinpoint **when** the shift began.`;
}
function interpBar({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const k = Object.keys(counts).length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return `${k} distinct categories across ${total} observations. Most common: **${top[0]}** (${top[1]}, ${(top[1] / total * 100).toFixed(0)}%). Bars are in original order — switch to **Pareto** for sorted-by-frequency.`;
}
function interpPareto({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((a, [, n]) => a + n, 0);
  let cum = 0, vital = [];
  for (const [k, n] of sorted) {
    cum += n; vital.push(k);
    if (cum / total >= 0.80) break;
  }
  return `${sorted.length} distinct categories, ${total} total. The **vital few** (cumulative ≥ 80%): ${vital.map(v => '**' + v + '**').join(', ')}. Concentrating root-cause work here accounts for the bulk of the problem.`;
}
function interpStacked({ x, group }) {
  return `Counts of ${x} broken down by ${group}. Bar heights = total per ${x}; coloured segments = sub-category share. Switch to a Mosaic plot if you want widths proportional to ${x} frequency too.`;
}
function interpHeatmap({ x, y }) {
  return `Cross-tab of **${x} × ${y}**. Concentrations along the diagonal indicate the two variables move together. For a formal association test, run a **chi-square** in Bench.`;
}
function interpMosaic({ x, y }) {
  return `Width of each column = marginal frequency of ${x}. Height of each colored block within = conditional frequency of ${y} given ${x}. Equal column proportions of colors → ${x} and ${y} are independent.`;
}
function interpSPLOM() {
  return `Every pair of numeric columns plotted against every other. Cells on the diagonal show variable labels. Linear-looking cells = candidates for linear regression; banana/cone shapes = nonlinear.`;
}
function interpSparkMatrix() {
  const cols = (state.current?.schema_json || []).filter(c => c.type === 'number');
  return `Mini run-charts for all ${cols.length} numeric columns. Quick scan for trends, shifts, and outliers without leaving the page.`;
}
function interpCapability({ x, lsl, usl, target }) {
  const vals = getNumeric(x);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = stddev(vals);
  if (lsl == null || usl == null || lsl === '' || usl === '') return `Histogram of ${x}. Add LSL and USL to get Cp / Cpk.`;
  const cp = (Number(usl) - Number(lsl)) / (6 * sd);
  const cpk = Math.min((Number(usl) - mean) / (3 * sd), (mean - Number(lsl)) / (3 * sd));
  const band = cpk >= 1.67 ? 'highly capable' : cpk >= 1.33 ? 'capable' : cpk >= 1.00 ? 'marginally capable' : 'not capable';
  return `Mean ${fmtNum(mean)}, σ̂ ${fmtNum(sd)}. **Cp = ${cp.toFixed(2)}**, **Cpk = ${cpk.toFixed(2)}** → process is **${band}** (1.33 conventional threshold). For the full method dossier (with reproducibility hashes), run the Capability analysis in Bench.`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Flourish-class chart builders
// ═══════════════════════════════════════════════════════════════════════

// Tiny animation engine — used by bar chart race and chart transitions.
function tween({ duration = 800, from = 0, to = 1, ease = 'cubic', step, done }) {
  const t0 = performance.now();
  const easeFns = {
    linear: t => t,
    cubic: t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2,
    out: t => 1 - Math.pow(1 - t, 3),
  };
  const e = easeFns[ease] || easeFns.cubic;
  let raf = null, stopped = false;
  function frame() {
    if (stopped) return;
    const t = Math.min(1, (performance.now() - t0) / duration);
    const v = from + (to - from) * e(t);
    step?.(v, t);
    if (t < 1) raf = requestAnimationFrame(frame);
    else done?.();
  }
  raf = requestAnimationFrame(frame);
  return { stop: () => { stopped = true; if (raf) cancelAnimationFrame(raf); } };
}

function cfgSankey({ from, to }) {
  const counts = new Map();
  const fromKeys = new Set(), toKeys = new Set();
  for (const r of state.rows) {
    const a = r[from] == null ? '(missing)' : String(r[from]);
    const b = r[to] == null ? '(missing)' : String(r[to]);
    fromKeys.add(a); toKeys.add(b);
    const k = a + '\x00' + b;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const fk = [...fromKeys].slice(0, 20), tk = [...toKeys].slice(0, 20);
  // Totals per node
  const fromTot = {}, toTot = {};
  for (const a of fk) fromTot[a] = 0;
  for (const b of tk) toTot[b] = 0;
  for (const [k, v] of counts) {
    const [a, b] = k.split('\x00');
    if (a in fromTot) fromTot[a] += v;
    if (b in toTot) toTot[b] += v;
  }
  // Sort by total descending for nicer layout
  fk.sort((a, b) => fromTot[b] - fromTot[a]);
  tk.sort((a, b) => toTot[b] - toTot[a]);
  const total = Object.values(fromTot).reduce((a, b) => a + b, 0) || 1;

  const W = 900, H = Math.max(440, Math.max(fk.length, tk.length) * 36 + 60);
  const pad = { l: 16, r: 16, t: 24, b: 24 };
  const colW = 160;
  const plotW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const gap = 4;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });

  // Position nodes
  const fromY = {}, toY = {};
  let cursor = pad.t;
  for (const a of fk) {
    const hgt = (fromTot[a] / total) * (innerH - (fk.length - 1) * gap);
    fromY[a] = { y: cursor, h: hgt };
    cursor += hgt + gap;
  }
  cursor = pad.t;
  for (const b of tk) {
    const hgt = (toTot[b] / total) * (innerH - (tk.length - 1) * gap);
    toY[b] = { y: cursor, h: hgt };
    cursor += hgt + gap;
  }
  const leftX = pad.l + colW;
  const rightX = W - pad.r - colW;
  const palette = paletteFor(fk.length);

  // Draw flows (under nodes)
  // Track running consumed height for each from / to node
  const fromConsumed = {}, toConsumed = {};
  for (const a of fk) fromConsumed[a] = 0;
  for (const b of tk) toConsumed[b] = 0;
  // Order links by from then to for stable layout
  const links = [...counts.entries()].map(([k, v]) => {
    const [a, b] = k.split('\x00');
    return { a, b, v };
  }).filter(l => fromY[l.a] && toY[l.b])
    .sort((x, y) => fk.indexOf(x.a) - fk.indexOf(y.a) || tk.indexOf(x.b) - tk.indexOf(y.b));

  for (const link of links) {
    const fNode = fromY[link.a], tNode = toY[link.b];
    const linkH_f = (link.v / fromTot[link.a]) * fNode.h;
    const linkH_t = (link.v / toTot[link.b]) * tNode.h;
    const y0 = fNode.y + fromConsumed[link.a];
    const y1 = tNode.y + toConsumed[link.b];
    fromConsumed[link.a] += linkH_f;
    toConsumed[link.b] += linkH_t;
    const cx = (leftX + rightX) / 2;
    const colorIdx = fk.indexOf(link.a) % palette.length;
    const fill = palette[colorIdx];
    // Bezier flow path
    const d = `M ${leftX} ${y0} C ${cx} ${y0}, ${cx} ${y1}, ${rightX} ${y1} ` +
              `L ${rightX} ${y1 + linkH_t} C ${cx} ${y1 + linkH_t}, ${cx} ${y0 + linkH_f}, ${leftX} ${y0 + linkH_f} Z`;
    const path = svg('path', { d, fill, opacity: 0.35,
      stroke: 'none' });
    path.classList?.add('lens-sankey-link');
    // Hover tooltip
    path.append(svg('title', {}, `${link.a} → ${link.b}: ${link.v}`));
    root.append(path);
  }

  // Nodes
  for (const a of fk) {
    const n = fromY[a];
    const idx = fk.indexOf(a) % palette.length;
    root.append(svg('rect', { x: leftX - 10, y: n.y, width: 10, height: n.h,
      fill: palette[idx], opacity: 0.95 }));
    root.append(svg('text', { x: leftX - 16, y: n.y + n.h / 2 + 4,
      'font-size': 11, 'text-anchor': 'end', fill: 'var(--ink)' },
      a.length > 20 ? a.slice(0, 20) + '…' : a));
    root.append(svg('text', { x: leftX - 16, y: n.y + n.h / 2 + 18,
      'font-size': 10, 'text-anchor': 'end', fill: 'var(--muted)' },
      String(fromTot[a])));
  }
  for (const b of tk) {
    const n = toY[b];
    root.append(svg('rect', { x: rightX, y: n.y, width: 10, height: n.h,
      fill: 'var(--accent)', opacity: 0.9 }));
    root.append(svg('text', { x: rightX + 16, y: n.y + n.h / 2 + 4,
      'font-size': 11, 'text-anchor': 'start', fill: 'var(--ink)' },
      b.length > 20 ? b.slice(0, 20) + '…' : b));
    root.append(svg('text', { x: rightX + 16, y: n.y + n.h / 2 + 18,
      'font-size': 10, 'text-anchor': 'start', fill: 'var(--muted)' },
      String(toTot[b])));
  }
  return wrapStaticChart(root, 'sankey', from, to);
}

function cfgTreemap({ x, value }) {
  // Aggregate counts (or sum of value) per category
  const counts = {};
  for (const r of state.rows) {
    const k = r[x] == null ? '(missing)' : String(r[x]);
    const v = value ? (Number(r[value]) || 0) : 1;
    counts[k] = (counts[k] || 0) + v;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 50);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const W = 760, H = 480;
  // Simple squarified treemap (binary slicing).
  function layout(items, x0, y0, w, h) {
    if (!items.length) return [];
    if (items.length === 1) {
      return [{ ...items[0], x: x0, y: y0, w, h }];
    }
    const tot = items.reduce((a, it) => a + it.v, 0);
    let acc = 0, cut = 0;
    for (let i = 0; i < items.length; i++) {
      acc += items[i].v;
      cut = i + 1;
      if (acc >= tot / 2) break;
    }
    const a = items.slice(0, cut), b = items.slice(cut);
    const aSum = a.reduce((s, it) => s + it.v, 0);
    if (w > h) {
      const aw = w * (aSum / tot);
      return [...layout(a, x0, y0, aw, h), ...layout(b, x0 + aw, y0, w - aw, h)];
    }
    const ah = h * (aSum / tot);
    return [...layout(a, x0, y0, w, ah), ...layout(b, x0, y0 + ah, w, h - ah)];
  }
  const items = entries.map(([k, v]) => ({ key: k, v }));
  const cells = layout(items, 0, 0, W, H);
  const palette = paletteFor(entries.length);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  cells.forEach((c, i) => {
    root.append(svg('rect', { x: c.x + 1, y: c.y + 1, width: Math.max(0, c.w - 2), height: Math.max(0, c.h - 2),
      fill: palette[i % palette.length], opacity: 0.85, stroke: 'var(--bg)', 'stroke-width': 1 }));
    if (c.w > 50 && c.h > 22) {
      root.append(svg('text', { x: c.x + 8, y: c.y + 18,
        'font-size': 12, fill: 'var(--bg)', 'font-weight': 600 },
        c.key.length > 22 ? c.key.slice(0, 22) + '…' : c.key));
      root.append(svg('text', { x: c.x + 8, y: c.y + 34,
        'font-size': 11, fill: 'var(--bg)', opacity: 0.8 },
        `${fmtNum(c.v)} · ${(c.v / total * 100).toFixed(1)}%`));
    }
  });
  return wrapStaticChart(root, 'treemap', x, value || 'count');
}

function cfgSunburst({ primary, secondary }) {
  const counts = {};
  for (const r of state.rows) {
    const a = r[primary] == null ? '(missing)' : String(r[primary]);
    if (!counts[a]) counts[a] = { total: 0, sub: {} };
    counts[a].total++;
    if (secondary) {
      const b = r[secondary] == null ? '(missing)' : String(r[secondary]);
      counts[a].sub[b] = (counts[a].sub[b] || 0) + 1;
    }
  }
  const inner = Object.entries(counts).sort((a, b) => b[1].total - a[1].total).slice(0, 20);
  const total = inner.reduce((a, [, v]) => a + v.total, 0) || 1;
  const W = 560, H = 560, cx = W / 2, cy = H / 2;
  const r0 = 80, r1 = 160, r2 = 240;
  const palette = paletteFor(inner.length);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  function arc(cx, cy, r1, r2, a1, a2) {
    const large = (a2 - a1) > Math.PI ? 1 : 0;
    const x1 = cx + r1 * Math.cos(a1), y1 = cy + r1 * Math.sin(a1);
    const x2 = cx + r1 * Math.cos(a2), y2 = cy + r1 * Math.sin(a2);
    const x3 = cx + r2 * Math.cos(a2), y3 = cy + r2 * Math.sin(a2);
    const x4 = cx + r2 * Math.cos(a1), y4 = cy + r2 * Math.sin(a1);
    return `M ${x1} ${y1} A ${r1} ${r1} 0 ${large} 1 ${x2} ${y2} ` +
           `L ${x3} ${y3} A ${r2} ${r2} 0 ${large} 0 ${x4} ${y4} Z`;
  }
  let cur = -Math.PI / 2;
  inner.forEach(([k, v], i) => {
    const span = (v.total / total) * Math.PI * 2;
    const a1 = cur, a2 = cur + span;
    // Inner ring
    root.append(svg('path', { d: arc(cx, cy, r0, r1, a1, a2),
      fill: palette[i % palette.length], opacity: 0.9, stroke: 'var(--bg)', 'stroke-width': 1.5 }));
    // Center label
    const mid = (a1 + a2) / 2;
    if (span > 0.18) {
      const lx = cx + (r0 + r1) / 2 * Math.cos(mid);
      const ly = cy + (r0 + r1) / 2 * Math.sin(mid);
      root.append(svg('text', { x: lx, y: ly + 4, 'font-size': 11,
        'text-anchor': 'middle', fill: 'var(--bg)', 'font-weight': 600 },
        k.length > 12 ? k.slice(0, 12) + '…' : k));
    }
    // Outer ring sub-segments
    if (secondary) {
      const subs = Object.entries(v.sub).sort((a, b) => b[1] - a[1]);
      let subCur = a1;
      const subPal = paletteFor(subs.length);
      subs.forEach(([sk, sv], j) => {
        const subSpan = (sv / v.total) * span;
        root.append(svg('path', { d: arc(cx, cy, r1, r2, subCur, subCur + subSpan),
          fill: subPal[j % subPal.length], opacity: 0.65,
          stroke: 'var(--bg)', 'stroke-width': 1 }));
        if (subSpan > 0.12) {
          const sm = subCur + subSpan / 2;
          const lx = cx + ((r1 + r2) / 2) * Math.cos(sm);
          const ly = cy + ((r1 + r2) / 2) * Math.sin(sm);
          root.append(svg('text', { x: lx, y: ly + 3, 'font-size': 9,
            'text-anchor': 'middle', fill: 'var(--ink)' },
            sk.length > 10 ? sk.slice(0, 10) + '…' : sk));
        }
        subCur += subSpan;
      });
    }
    cur = a2;
  });
  // Inner circle
  root.append(svg('circle', { cx, cy, r: r0 - 4, fill: 'var(--bg)' }));
  root.append(svg('text', { x: cx, y: cy + 4, 'font-size': 14,
    'text-anchor': 'middle', fill: 'var(--accent)',
    'font-family': 'var(--font-display)', 'font-style': 'italic' }, primary));
  return wrapStaticChart(root, 'sunburst', primary, secondary);
}

function cfgSlope({ entity, before, after }) {
  const recs = [];
  for (const r of state.rows) {
    const e = r[entity] == null ? '(missing)' : String(r[entity]);
    const b = Number(r[before]), a = Number(r[after]);
    if (Number.isFinite(b) && Number.isFinite(a)) recs.push({ e, b, a, delta: a - b });
  }
  if (!recs.length) return emptyCard('No valid (before, after) pairs.');
  // Collapse duplicates by averaging.
  const grouped = {};
  for (const r of recs) {
    if (!grouped[r.e]) grouped[r.e] = { b: [], a: [] };
    grouped[r.e].b.push(r.b); grouped[r.e].a.push(r.a);
  }
  const items = Object.entries(grouped).map(([e, vs]) => {
    const b = vs.b.reduce((s, x) => s + x, 0) / vs.b.length;
    const a = vs.a.reduce((s, x) => s + x, 0) / vs.a.length;
    return { e, b, a, delta: a - b };
  }).sort((x, y) => y.delta - x.delta).slice(0, 50);
  const W = 760, H = Math.max(420, items.length * 12 + 80), pad = { l: 120, r: 120, t: 30, b: 50 };
  const allY = items.flatMap(it => [it.b, it.a]);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const yRange = yMax - yMin || 1;
  const yScale = (v) => pad.t + (1 - (v - yMin) / yRange) * (H - pad.t - pad.b);
  const xLeft = pad.l, xRight = W - pad.r;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  root.append(svg('text', { x: xLeft, y: pad.t - 10, 'font-size': 12,
    fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' }, before));
  root.append(svg('text', { x: xRight, y: pad.t - 10, 'font-size': 12,
    'text-anchor': 'end', fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' }, after));
  // Vertical reference lines
  root.append(svg('line', { x1: xLeft, x2: xLeft, y1: pad.t, y2: H - pad.b,
    stroke: 'var(--line)', 'stroke-width': 0.5 }));
  root.append(svg('line', { x1: xRight, x2: xRight, y1: pad.t, y2: H - pad.b,
    stroke: 'var(--line)', 'stroke-width': 0.5 }));
  for (const it of items) {
    const y0 = yScale(it.b), y1 = yScale(it.a);
    const color = it.delta > 0 ? 'var(--success)'
                : it.delta < 0 ? 'var(--danger)'
                : 'var(--muted)';
    root.append(svg('line', { x1: xLeft, y1: y0, x2: xRight, y2: y1,
      stroke: color, 'stroke-width': 1.2, opacity: 0.7 }));
    root.append(svg('circle', { cx: xLeft, cy: y0, r: 3, fill: color }));
    root.append(svg('circle', { cx: xRight, cy: y1, r: 3, fill: color }));
    root.append(svg('text', { x: xLeft - 8, y: y0 + 4, 'font-size': 10,
      'text-anchor': 'end', fill: 'var(--ink-2)' },
      it.e.length > 16 ? it.e.slice(0, 16) + '…' : it.e));
    root.append(svg('text', { x: xRight + 8, y: y1 + 4, 'font-size': 10,
      'text-anchor': 'start', fill: 'var(--ink-2)' }, fmtNum(it.a)));
  }
  return wrapStaticChart(root, 'slope', before, after);
}

function cfgMarimekko({ x, group }) {
  const rowCounts = {};
  for (const r of state.rows) {
    const xv = r[x] == null ? '(missing)' : String(r[x]);
    const gv = r[group] == null ? '(missing)' : String(r[group]);
    if (!rowCounts[xv]) rowCounts[xv] = { total: 0, sub: {} };
    rowCounts[xv].total++;
    rowCounts[xv].sub[gv] = (rowCounts[xv].sub[gv] || 0) + 1;
  }
  const rowKeys = Object.entries(rowCounts).sort((a, b) => b[1].total - a[1].total)
    .map(([k]) => k).slice(0, 20);
  const allSubs = new Set();
  for (const k of rowKeys) for (const sk of Object.keys(rowCounts[k].sub)) allSubs.add(sk);
  const subKeys = [...allSubs].slice(0, 12);
  const total = rowKeys.reduce((a, k) => a + rowCounts[k].total, 0) || 1;
  const palette = paletteFor(subKeys.length);
  const W = 800, H = 460, pad = { l: 24, r: 130, t: 24, b: 80 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  let xCursor = pad.l;
  rowKeys.forEach(k => {
    const xw = (rowCounts[k].total / total) * plotW;
    let yCursor = pad.t;
    subKeys.forEach((sk, si) => {
      const c = rowCounts[k].sub[sk] || 0;
      const hgt = (c / rowCounts[k].total) * plotH;
      if (c > 0) {
        root.append(svg('rect', { x: xCursor, y: yCursor, width: xw - 1, height: hgt - 0.5,
          fill: palette[si], opacity: 0.85 }));
        if (xw > 40 && hgt > 18) {
          root.append(svg('text', { x: xCursor + xw / 2, y: yCursor + hgt / 2 + 4,
            'font-size': 10, 'text-anchor': 'middle', fill: 'var(--bg)' }, String(c)));
        }
      }
      yCursor += hgt;
    });
    // Bottom label
    root.append(svg('text', { x: xCursor + xw / 2, y: H - pad.b + 16,
      'font-size': 10, 'text-anchor': 'middle', fill: 'var(--ink-2)',
      transform: `rotate(-32 ${xCursor + xw / 2} ${H - pad.b + 16})` },
      k.length > 14 ? k.slice(0, 14) + '…' : k));
    xCursor += xw;
  });
  // Legend
  subKeys.forEach((sk, si) => {
    root.append(svg('rect', { x: W - pad.r + 10, y: pad.t + si * 20,
      width: 14, height: 14, fill: palette[si] }));
    root.append(svg('text', { x: W - pad.r + 30, y: pad.t + si * 20 + 11,
      'font-size': 11, fill: 'var(--ink-2)' },
      sk.length > 14 ? sk.slice(0, 14) + '…' : sk));
  });
  return wrapStaticChart(root, 'marimekko', x, group);
}

function cfgBarRace({ entity, time, value }) {
  // Build time-indexed snapshots: { entityName: value } per time step
  const stepsMap = new Map();
  for (const r of state.rows) {
    const t = r[time] == null ? '(missing)' : String(r[time]);
    const e = r[entity] == null ? '(missing)' : String(r[entity]);
    const v = Number(r[value]);
    if (!Number.isFinite(v)) continue;
    if (!stepsMap.has(t)) stepsMap.set(t, {});
    stepsMap.get(t)[e] = v;
  }
  const steps = [...stepsMap.keys()].sort();
  if (steps.length < 2) return emptyCard('Need at least 2 distinct time steps.');
  // Compute global maximum for x-scale stability across frames.
  let globalMax = 0;
  for (const s of stepsMap.values()) for (const v of Object.values(s)) if (v > globalMax) globalMax = v;
  const topN = 12;

  // Build the chart wrapper with playback controls.
  const wrap = h('div', { className: 'lens-chart', 'data-kind': 'race' });
  const ctrl = h('div', { className: 'lens-chart-toolbar' });
  const playBtn = h('button', { type: 'button', className: 'lens-chip on' }, '▶ Play');
  let stepIdx = 0;
  let playing = false;
  let animHandle = null;
  const speedSel = h('select', { className: 'lens-chip', style: 'padding:4px 8px' });
  for (const [v, label] of [[2000, 'slow'], [1200, 'normal'], [600, 'fast'], [300, 'turbo']]) {
    speedSel.append(h('option', { value: v }, label));
  }
  speedSel.value = '1200';
  ctrl.append(playBtn, speedSel,
    h('span', { className: 'lens-spacer' }),
    h('span', { className: 'lens-hint' }, 'animated rank tracking'),
    h('button', { type: 'button', className: 'lens-chip',
      onclick: () => exportSvgEl(svgRoot, 'race', 'png') }, '↓ PNG'),
  );
  wrap.append(ctrl);

  const host = h('div', { className: 'lens-chart-host' });
  const W = 760, H = 460, pad = { l: 130, r: 60, t: 20, b: 30 };
  const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  host.append(svgRoot);
  // Year/label big in corner
  const yearText = h('div', { className: 'lens-race-year' }, steps[0]);
  host.append(yearText);
  wrap.append(host);

  function frame(at) {
    // at = float index 0..steps.length-1
    const i = Math.floor(at), frac = at - i;
    const fromSnap = stepsMap.get(steps[Math.min(i, steps.length - 1)]) || {};
    const toSnap = stepsMap.get(steps[Math.min(i + 1, steps.length - 1)]) || fromSnap;
    // Union of entities, current value = lerp(from, to, frac)
    const ents = new Set([...Object.keys(fromSnap), ...Object.keys(toSnap)]);
    const list = [];
    for (const e of ents) {
      const f = fromSnap[e] || 0, t = toSnap[e] || 0;
      list.push({ e, v: f + (t - f) * frac });
    }
    list.sort((a, b) => b.v - a.v);
    const top = list.slice(0, topN);
    const barH = (H - pad.t - pad.b) / topN - 6;
    // Redraw
    while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);
    const palette = paletteFor(topN);
    top.forEach((row, rank) => {
      const y = pad.t + rank * (barH + 6);
      const barW = (row.v / globalMax) * (W - pad.l - pad.r);
      svgRoot.append(svg('rect', { x: pad.l, y, width: Math.max(0, barW), height: barH,
        fill: palette[rank], opacity: 0.92, rx: 3 }));
      svgRoot.append(svg('text', { x: pad.l - 8, y: y + barH / 2 + 4,
        'font-size': 12, 'text-anchor': 'end',
        fill: 'var(--ink)' },
        row.e.length > 20 ? row.e.slice(0, 20) + '…' : row.e));
      svgRoot.append(svg('text', { x: pad.l + barW + 8, y: y + barH / 2 + 4,
        'font-size': 11, fill: 'var(--ink-2)' }, fmtNum(row.v)));
    });
    // Current time label
    const curStep = steps[Math.min(i + (frac > 0.5 ? 1 : 0), steps.length - 1)];
    yearText.textContent = curStep;
  }

  function play() {
    playing = true;
    playBtn.textContent = '❚❚ Pause';
    const duration = Number(speedSel.value);
    const stepCount = steps.length - 1;
    const totalDur = duration * stepCount;
    animHandle = tween({
      duration: totalDur,
      from: stepIdx, to: stepCount,
      ease: 'linear',
      step: (v) => {
        stepIdx = v;
        frame(v);
      },
      done: () => {
        playing = false;
        playBtn.textContent = '↻ Replay';
        stepIdx = 0;
      },
    });
  }
  function stop() {
    if (animHandle) animHandle.stop();
    playing = false;
    playBtn.textContent = '▶ Play';
  }
  playBtn.addEventListener('click', () => {
    if (playing) stop();
    else { if (stepIdx >= steps.length - 1) stepIdx = 0; play(); }
  });

  frame(0);
  return wrap;
}

// ─── Flourish-class interpreters ───

function interpSankey({ from, to }) {
  const counts = {};
  for (const r of state.rows) {
    const a = r[from] == null ? '(missing)' : String(r[from]);
    const b = r[to] == null ? '(missing)' : String(r[to]);
    counts[a + '\x00' + b] = (counts[a + '\x00' + b] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((a, [, v]) => a + v, 0);
  const top = sorted.slice(0, 3).map(([k, v]) => {
    const [a, b] = k.split('\x00');
    return `**${a} → ${b}** (${v}, ${(v / total * 100).toFixed(0)}%)`;
  });
  return `Flow from **${from}** into **${to}** across ${total} observations. Largest flows: ${top.join(', ')}. Hover any ribbon for an exact count. Thick ribbons that fan out into many destinations indicate a high-variance source; concentrated flows indicate sources that route to a single destination.`;
}
function interpTreemap({ x, value }) {
  const counts = {};
  for (const r of state.rows) {
    const k = r[x] == null ? '(missing)' : String(r[x]);
    const v = value ? (Number(r[value]) || 0) : 1;
    counts[k] = (counts[k] || 0) + v;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const top = entries[0];
  return `${entries.length} categories of **${x}**${value ? ' weighted by ' + value : ''}, total ${fmtNum(total)}. Largest tile: **${top[0]}** (${fmtNum(top[1])}, ${(top[1] / total * 100).toFixed(0)}%). Areas are proportional to value — eyeball the dominant tile vs the long tail.`;
}
function interpSunburst({ primary, secondary }) {
  return `Concentric rings on **${primary}**${secondary ? ' × ' + secondary : ''}. Inner ring = primary category share of the whole. Outer ring = sub-category share within each primary slice. Slices balanced equally → independent; lopsided outer wedges → an association between the two variables.`;
}
function interpSlope({ entity, before, after }) {
  const recs = [];
  for (const r of state.rows) {
    const b = Number(r[before]), a = Number(r[after]);
    if (Number.isFinite(a) && Number.isFinite(b)) recs.push(a - b);
  }
  if (!recs.length) return 'No pairs.';
  const mean = recs.reduce((a, b) => a + b, 0) / recs.length;
  const up = recs.filter(d => d > 0).length;
  const down = recs.filter(d => d < 0).length;
  return `${recs.length} entities went from **${before}** to **${after}**. ${up} rose, ${down} fell. Mean change: **${mean > 0 ? '+' : ''}${fmtNum(mean)}**. Green lines = rises, red = falls. The slope of each line shows the magnitude of change; crossing lines mean the rank order changed.`;
}
function interpMarimekko({ x, group }) {
  return `Bar widths show the marginal frequency of **${x}**; stack proportions within each bar show the share of **${group}**. Compare stacks across bars — same colour bands at the same heights → groups have identical sub-category mix; wildly different → an interaction.`;
}
function interpBarRace({ entity, time, value }) {
  const ts = new Set();
  for (const r of state.rows) ts.add(String(r[time]));
  return `Top-12 **${entity}** ranked by **${value}** across ${ts.size} time steps. Press play to animate; rank changes are the story — bars that overtake each other reveal momentum, persistent leaders reveal stability.`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Batch 1 — Composition / Polar / extra Distribution + Time charts
// ═══════════════════════════════════════════════════════════════════════

// ─── helpers ───

function _arcPath(cx, cy, r0, r1, a1, a2) {
  const large = (a2 - a1) > Math.PI ? 1 : 0;
  const x1 = cx + r1 * Math.cos(a1), y1 = cy + r1 * Math.sin(a1);
  const x2 = cx + r1 * Math.cos(a2), y2 = cy + r1 * Math.sin(a2);
  if (r0 === 0) {
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r1} ${r1} 0 ${large} 1 ${x2} ${y2} Z`;
  }
  const x3 = cx + r0 * Math.cos(a2), y3 = cy + r0 * Math.sin(a2);
  const x4 = cx + r0 * Math.cos(a1), y4 = cy + r0 * Math.sin(a1);
  return `M ${x1} ${y1} A ${r1} ${r1} 0 ${large} 1 ${x2} ${y2} ` +
         `L ${x3} ${y3} A ${r0} ${r0} 0 ${large} 0 ${x4} ${y4} Z`;
}

// Catmull-Rom → bezier; smooth path through points.
function _splinePath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

// ─── Pie / Doughnut ───

function _pieRoot({ x }, innerR) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const palette = paletteFor(entries.length);
  const W = 520, H = 480, cx = 240, cy = 240, r = 200;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  let cur = -Math.PI / 2;
  entries.forEach(([k, v], i) => {
    const span = (v / total) * Math.PI * 2;
    const a1 = cur, a2 = cur + span;
    root.append(svg('path', { d: _arcPath(cx, cy, innerR, r, a1, a2),
      fill: palette[i % palette.length], opacity: 0.92,
      stroke: 'var(--bg)', 'stroke-width': 1.5 }));
    if (span > 0.18) {
      const mid = (a1 + a2) / 2;
      const lx = cx + (innerR + r) / 2 * Math.cos(mid);
      const ly = cy + (innerR + r) / 2 * Math.sin(mid);
      root.append(svg('text', { x: lx, y: ly + 4,
        'font-size': 12, 'text-anchor': 'middle',
        fill: 'var(--bg)', 'font-weight': 600 },
        k.length > 12 ? k.slice(0, 12) + '…' : k));
      root.append(svg('text', { x: lx, y: ly + 18,
        'font-size': 10, 'text-anchor': 'middle',
        fill: 'var(--bg)', opacity: 0.85 },
        `${(v / total * 100).toFixed(0)}%`));
    }
    cur = a2;
  });
  // Legend
  entries.forEach(([k, v], i) => {
    const ly = 12 + i * 18;
    root.append(svg('rect', { x: 470, y: ly, width: 12, height: 12, fill: palette[i % palette.length] }));
    root.append(svg('text', { x: 488, y: ly + 10, 'font-size': 11, fill: 'var(--ink-2)' },
      `${k.length > 14 ? k.slice(0, 14) + '…' : k} · ${v}`));
  });
  return { root, entries, total };
}
function cfgPie({ x }) {
  const { root } = _pieRoot({ x }, 0);
  return wrapStaticChart(root, 'pie', x);
}
function cfgDoughnut({ x }) {
  const { root, total } = _pieRoot({ x }, 110);
  root.append(svg('text', { x: 240, y: 234,
    'font-size': 28, 'text-anchor': 'middle',
    fill: 'var(--accent)', 'font-family': 'var(--font-display)' },
    String(total)));
  root.append(svg('text', { x: 240, y: 256,
    'font-size': 10, 'text-anchor': 'middle',
    fill: 'var(--muted)', 'letter-spacing': '0.16em' }, 'TOTAL'));
  return wrapStaticChart(root, 'doughnut', '', '');
}

// ─── Funnel / Pyramid ───

function _stackChart(entries, total, kind, label) {
  const W = 640, H = 460, padX = 80, padY = 30;
  const innerH = H - 2 * padY;
  const palette = paletteFor(entries.length);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  const cx = W / 2;
  const maxHalf = (W - 2 * padX) / 2;
  const cellH = innerH / entries.length;
  entries.forEach(([k, v], i) => {
    let topHalf, botHalf;
    if (kind === 'funnel') {
      topHalf = maxHalf * (v / entries[0][1]);
      const next = entries[i + 1] ? entries[i + 1][1] : v * 0.4;
      botHalf = maxHalf * (next / entries[0][1]);
    } else { // pyramid: smallest at top
      // arrange descending top-to-bottom (largest at bottom)
      topHalf = maxHalf * (v / entries[entries.length - 1][1]) * 0.5;
      const next = entries[i + 1] ? entries[i + 1][1] : v;
      botHalf = maxHalf * (next / entries[entries.length - 1][1]) * 0.5;
    }
    const y = padY + i * cellH;
    root.append(svg('path', {
      d: `M ${cx - topHalf} ${y} L ${cx + topHalf} ${y} L ${cx + botHalf} ${y + cellH} L ${cx - botHalf} ${y + cellH} Z`,
      fill: palette[i % palette.length], opacity: 0.9,
      stroke: 'var(--bg)', 'stroke-width': 1,
    }));
    root.append(svg('text', { x: cx, y: y + cellH / 2 + 5,
      'font-size': 13, 'text-anchor': 'middle',
      fill: 'var(--bg)', 'font-weight': 600 },
      `${k.length > 18 ? k.slice(0, 18) + '…' : k}  ·  ${v} (${(v / total * 100).toFixed(0)}%)`));
  });
  return wrapStaticChart(root, kind, label);
}
function cfgFunnel({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return emptyCard('No data.');
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return _stackChart(entries, total, 'funnel', x);
}
function cfgPyramid({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => a[1] - b[1]);  // ascending so largest at bottom
  if (!entries.length) return emptyCard('No data.');
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return _stackChart(entries, total, 'pyramid', x);
}

// ─── Waterfall ───

function cfgWaterfall({ x }) {
  const vals = getNumeric(x);
  if (vals.length < 2) return emptyCard('Need ≥ 2 values.');
  // Treat values as period-to-period deltas. Show cumulative running.
  let acc = 0;
  const bars = vals.map((v, i) => {
    const start = acc; acc += v;
    return { i, start, end: acc, delta: v };
  });
  const allY = bars.flatMap(b => [b.start, b.end]);
  const yMin = Math.min(...allY, 0), yMax = Math.max(...allY, 0);
  const yPad = (yMax - yMin) * 0.06 || 1;
  const points = bars.map(b => ({ i: b.i, x: b.i + 1, y: (b.start + b.end) / 2,
    label: `step ${b.i + 1}`, meta: { delta: fmtNum(b.delta), cumulative: fmtNum(b.end) } }));
  return renderInteractiveChart({
    kind: 'waterfall',
    width: Math.max(720, vals.length * 60 + 80), height: 380,
    pad: { l: 60, r: 18, t: 20, b: 44 },
    xRange: [0.5, vals.length + 0.5], yRange: [yMin - yPad, yMax + yPad],
    xLabel: 'step', yLabel: 'cumulative',
    points, brushable: false,
    overlays: [{ id: 'zero', label: 'Zero', defaultOn: true,
      build: (g, { xScale, yScale, plot }) => {
        g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: yScale(0), y2: yScale(0),
          stroke: 'var(--muted)', 'stroke-dasharray': '4 4' }));
      } }],
    draw: (root, { xScale, yScale }) => {
      const slot = (xScale(2) - xScale(1));
      bars.forEach((b) => {
        const x_ = xScale(b.i + 1) - slot * 0.30;
        const yTop = yScale(Math.max(b.start, b.end));
        const yBot = yScale(Math.min(b.start, b.end));
        const color = b.delta > 0 ? 'var(--success)' : b.delta < 0 ? 'var(--danger)' : 'var(--muted)';
        root.append(svg('rect', { x: x_, y: yTop, width: slot * 0.60, height: yBot - yTop,
          fill: color, opacity: 0.85 }));
        // Connector to next bar's start
        if (b.i < bars.length - 1) {
          const next = bars[b.i + 1];
          const y_ = yScale(b.end);
          const x1 = xScale(b.i + 1) + slot * 0.30;
          const x2 = xScale(next.i + 1) - slot * 0.30;
          root.append(svg('line', { x1, x2, y1: y_, y2: y_,
            stroke: 'var(--muted)', 'stroke-dasharray': '2 3', 'stroke-width': 1 }));
        }
      });
    },
  });
}

// ─── Bullet ───

function cfgBullet({ x, target }) {
  const vals = getNumeric(x);
  if (!vals.length) return emptyCard('No data.');
  const actual = vals.reduce((a, b) => a + b, 0) / vals.length;
  const t = target !== '' && target != null ? Number(target) : null;
  const mn = Math.min(...vals, 0), mx = Math.max(...vals);
  const range = mx - mn || 1;
  // Qualitative bands: poor 0..33%, ok 33..67%, good 67..100% of range.
  const W = 720, H = 120, padX = 70, padY = 30;
  const innerW = W - padX - 50;
  const xScale = (v) => padX + ((v - mn) / range) * innerW;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  const bands = [
    { from: mn,            to: mn + range / 3,     color: 'rgba(176, 58, 58, 0.18)' },
    { from: mn + range / 3, to: mn + 2 * range / 3, color: 'rgba(176, 132, 0, 0.18)' },
    { from: mn + 2 * range / 3, to: mx,            color: 'rgba(47, 125, 58, 0.18)' },
  ];
  for (const b of bands) {
    root.append(svg('rect', { x: xScale(b.from), y: 30,
      width: xScale(b.to) - xScale(b.from), height: 50, fill: b.color }));
  }
  // Actual bar
  root.append(svg('rect', { x: xScale(mn), y: 44, width: xScale(actual) - xScale(mn),
    height: 22, fill: 'var(--accent)', opacity: 0.95 }));
  // Target line
  if (t != null && Number.isFinite(t)) {
    const tx = xScale(t);
    root.append(svg('line', { x1: tx, x2: tx, y1: 28, y2: 82,
      stroke: 'var(--ink)', 'stroke-width': 3 }));
    root.append(svg('text', { x: tx, y: 24, 'font-size': 11,
      'text-anchor': 'middle', fill: 'var(--ink)' }, `target ${fmtNum(t)}`));
  }
  // Axis ticks
  for (const tick of niceTicks(mn, mx, 6)) {
    const px = xScale(tick);
    root.append(svg('line', { x1: px, y1: 80, x2: px, y2: 84, stroke: 'var(--muted)' }));
    root.append(svg('text', { x: px, y: 98, 'font-size': 10,
      'text-anchor': 'middle', fill: 'var(--muted)' }, fmtNum(tick)));
  }
  // Label
  root.append(svg('text', { x: 8, y: 60, 'font-size': 12,
    fill: 'var(--ink)', 'font-family': 'var(--font-display)', 'font-style': 'italic' }, x));
  root.append(svg('text', { x: W - 6, y: 60, 'font-size': 13,
    'text-anchor': 'end', fill: 'var(--accent)', 'font-weight': 600 }, fmtNum(actual)));
  return wrapStaticChart(root, 'bullet', x);
}

// ─── Step line / Step area / Spline / Spline area / Stick ───

function _sequencePoints(values) {
  const mn = Math.min(...values), mx = Math.max(...values);
  const range = (mx - mn) || 1;
  return { mn, mx, pad: range * 0.08, points: values.map((y, i) => ({ i, x: i + 1, y, label: `obs ${i + 1}` })) };
}

function _stepDraw(root, scales, vals, filled) {
  const { xScale, yScale, plot } = scales;
  let d = '';
  for (let i = 0; i < vals.length; i++) {
    if (i === 0) d += `M ${xScale(1)} ${yScale(vals[0])}`;
    else {
      d += ` L ${xScale(i + 1)} ${yScale(vals[i - 1])}`;
      d += ` L ${xScale(i + 1)} ${yScale(vals[i])}`;
    }
  }
  if (filled) {
    const fillD = d + ` L ${xScale(vals.length)} ${plot.y + plot.h} L ${xScale(1)} ${plot.y + plot.h} Z`;
    root.append(svg('path', { d: fillD, fill: 'var(--accent)', opacity: 0.18 }));
  }
  root.append(svg('path', { d, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.6 }));
}

function _seqSpec({ kind, x }, drawFn) {
  const vals = getNumeric(x);
  if (!vals.length) return emptyCard('No data.');
  const { mn, mx, pad, points } = _sequencePoints(vals);
  return renderInteractiveChart({
    kind, width: 760, height: 360, pad: { l: 56, r: 18, t: 16, b: 44 },
    xRange: [1, vals.length], yRange: [mn - pad, mx + pad],
    xLabel: 'observation', yLabel: x,
    points,
    draw: (root, scales) => drawFn(root, scales, vals),
  });
}

function cfgStepLine({ x }) { return _seqSpec({ kind: 'stepline', x }, (root, scales, vals) => _stepDraw(root, scales, vals, false)); }
function cfgStepArea({ x }) { return _seqSpec({ kind: 'steparea', x }, (root, scales, vals) => _stepDraw(root, scales, vals, true)); }

function _splineDraw(root, scales, vals, filled) {
  const { xScale, yScale, plot } = scales;
  const pts = vals.map((y, i) => [xScale(i + 1), yScale(y)]);
  const d = _splinePath(pts);
  if (filled) {
    const fillD = d + ` L ${pts[pts.length - 1][0]} ${plot.y + plot.h} L ${pts[0][0]} ${plot.y + plot.h} Z`;
    root.append(svg('path', { d: fillD, fill: 'var(--accent)', opacity: 0.20 }));
  }
  root.append(svg('path', { d, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.7 }));
  for (const p of pts) root.append(svg('circle', { cx: p[0], cy: p[1], r: 2.2, fill: 'var(--ink-2)' }));
}
function cfgSpline({ x }) { return _seqSpec({ kind: 'spline', x }, (r, s, v) => _splineDraw(r, s, v, false)); }
function cfgSplineArea({ x }) { return _seqSpec({ kind: 'splinearea', x }, (r, s, v) => _splineDraw(r, s, v, true)); }

function cfgStick({ x }) {
  const vals = getNumeric(x);
  if (!vals.length) return emptyCard('No data.');
  const median = quantile(vals, 0.5);
  const { mn, mx, pad, points } = _sequencePoints(vals);
  return renderInteractiveChart({
    kind: 'stick', width: 760, height: 360, pad: { l: 56, r: 18, t: 16, b: 44 },
    xRange: [1, vals.length], yRange: [Math.min(mn, median) - pad, Math.max(mx, median) + pad],
    xLabel: 'observation', yLabel: x,
    points,
    overlays: [{ id: 'median', label: `Median ${fmtNum(median)}`, defaultOn: true,
      build: (g, { xScale, yScale, plot }) => {
        const py = yScale(median);
        g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: py, y2: py,
          stroke: 'var(--muted)', 'stroke-dasharray': '4 4' }));
      }}],
    draw: (root, { xScale, yScale }) => {
      const baseline = yScale(median);
      vals.forEach((y, i) => {
        const px = xScale(i + 1), py = yScale(y);
        const color = y >= median ? 'var(--success)' : 'var(--danger)';
        root.append(svg('line', { x1: px, x2: px, y1: baseline, y2: py,
          stroke: color, 'stroke-width': 1.8 }));
        root.append(svg('circle', { cx: px, cy: py, r: 3, fill: color }));
      });
    },
  });
}

// ─── Calendar heatmap ───

function _parseDate(s) {
  if (s == null) return null;
  const str = String(s).trim();
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function cfgCalendar({ date, value }) {
  const records = [];
  for (const r of state.rows) {
    const d = _parseDate(r[date]);
    const v = Number(r[value]);
    if (d && Number.isFinite(v)) records.push({ d, v });
  }
  if (!records.length) return emptyCard('Need a date column + numeric value. Check date format (YYYY-MM-DD or similar).');
  records.sort((a, b) => a.d - b.d);
  const min = records[0].d, max = records[records.length - 1].d;
  // Build a map keyed by YYYY-MM-DD
  const map = {};
  for (const r of records) {
    const k = r.d.toISOString().slice(0, 10);
    map[k] = (map[k] || 0) + r.v;
  }
  const vmax = Math.max(...Object.values(map));
  // Span: from Sunday before start to Saturday after end
  const start = new Date(min); start.setDate(start.getDate() - start.getDay());
  const end = new Date(max); end.setDate(end.getDate() + (6 - end.getDay()));
  const totalDays = Math.round((end - start) / 86400000) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);
  const cell = 14, gap = 2, pad = { l: 40, r: 18, t: 30, b: 30 };
  const W = pad.l + totalWeeks * (cell + gap) + pad.r;
  const H = pad.t + 7 * (cell + gap) + pad.b;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  // Weekday labels
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d, i) => {
    if (i % 2 === 0) root.append(svg('text', {
      x: pad.l - 6, y: pad.t + i * (cell + gap) + cell - 3,
      'font-size': 10, 'text-anchor': 'end', fill: 'var(--muted)' }, d));
  });
  // Month labels on first week of each month
  let lastMonth = -1;
  for (let w = 0; w < totalWeeks; w++) {
    const dayDate = new Date(start);
    dayDate.setDate(dayDate.getDate() + w * 7);
    const m = dayDate.getMonth();
    if (m !== lastMonth) {
      root.append(svg('text', { x: pad.l + w * (cell + gap), y: pad.t - 8,
        'font-size': 10, fill: 'var(--muted)' },
        dayDate.toLocaleString('default', { month: 'short' })));
      lastMonth = m;
    }
  }
  for (let i = 0; i < totalDays; i++) {
    const dayDate = new Date(start);
    dayDate.setDate(dayDate.getDate() + i);
    if (dayDate < min || dayDate > max) continue;
    const key = dayDate.toISOString().slice(0, 10);
    const val = map[key];
    const w = Math.floor(i / 7), dow = i % 7;
    const x_ = pad.l + w * (cell + gap), y_ = pad.t + dow * (cell + gap);
    const t = val != null ? val / vmax : 0;
    const fill = val == null ? 'var(--surface)' : `rgba(107, 85, 36, ${0.15 + 0.80 * t})`;
    const rect = svg('rect', { x: x_, y: y_, width: cell, height: cell, fill, rx: 2 });
    rect.append(svg('title', {}, val != null ? `${key} · ${fmtNum(val)}` : `${key} · no data`));
    root.append(rect);
  }
  return wrapStaticChart(root, 'calendar', date, value);
}

// ─── Quadrant ───

function cfgQuadrant({ x, y }) {
  const xs = [], ys = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]);
    if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
  }
  if (xs.length < 2) return emptyCard('Need ≥ 2 paired points.');
  const xMed = quantile(xs, 0.5), yMed = quantile(ys, 0.5);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'quadrant',
    width: 720, height: 500, pad: { l: 60, r: 24, t: 24, b: 48 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: x, yLabel: y,
    points: xs.map((x_, i) => ({ i, x: x_, y: ys[i] })),
    overlays: [{ id: 'ref', label: `medians: x=${fmtNum(xMed)}, y=${fmtNum(yMed)}`, defaultOn: true,
      build: (g, { xScale, yScale, plot }) => {
        const cx = xScale(xMed), cy = yScale(yMed);
        g.append(svg('line', { x1: cx, x2: cx, y1: plot.y, y2: plot.y + plot.h,
          stroke: 'var(--accent)', 'stroke-dasharray': '4 4', 'stroke-width': 1 }));
        g.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: cy, y2: cy,
          stroke: 'var(--accent)', 'stroke-dasharray': '4 4', 'stroke-width': 1 }));
        // Quadrant labels
        g.append(svg('text', { x: plot.x + 10, y: plot.y + 16,
          'font-size': 11, fill: 'var(--muted)', 'font-style': 'italic' }, 'Q2 — low x, high y'));
        g.append(svg('text', { x: plot.x + plot.w - 10, y: plot.y + 16,
          'font-size': 11, 'text-anchor': 'end', fill: 'var(--muted)', 'font-style': 'italic' }, 'Q1 — high x, high y'));
        g.append(svg('text', { x: plot.x + 10, y: plot.y + plot.h - 6,
          'font-size': 11, fill: 'var(--muted)', 'font-style': 'italic' }, 'Q3 — low x, low y'));
        g.append(svg('text', { x: plot.x + plot.w - 10, y: plot.y + plot.h - 6,
          'font-size': 11, 'text-anchor': 'end', fill: 'var(--muted)', 'font-style': 'italic' }, 'Q4 — high x, low y'));
      } }],
    draw: (root, { xScale, yScale }) => {
      for (let i = 0; i < xs.length; i++) {
        root.append(svg('circle', { cx: xScale(xs[i]), cy: yScale(ys[i]), r: 3,
          fill: 'var(--ink-2)', opacity: 0.7 }));
      }
    },
  });
}

// ─── Radar / Spider ───

function cfgRadar() {
  const cols = (state.current?.schema_json || []).filter(c => c.type === 'number').map(c => c.name);
  if (cols.length < 3) return emptyCard('Need ≥ 3 numeric columns.');
  const useCols = cols.slice(0, 8);
  // Normalize each column to its 0..max range so axes share a scale.
  const norms = useCols.map(c => {
    const v = getNumeric(c);
    return { col: c, max: Math.max(...v) || 1 };
  });
  const W = 560, H = 560, cx = 280, cy = 280, R = 200;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  // Reference rings
  for (const t of [0.25, 0.5, 0.75, 1.0]) {
    root.append(svg('circle', { cx, cy, r: R * t, fill: 'none',
      stroke: 'var(--line)', 'stroke-width': 0.5 }));
  }
  // Axes
  useCols.forEach((c, i) => {
    const ang = -Math.PI / 2 + (Math.PI * 2 * i / useCols.length);
    root.append(svg('line', { x1: cx, y1: cy, x2: cx + R * Math.cos(ang), y2: cy + R * Math.sin(ang),
      stroke: 'var(--line)', 'stroke-width': 0.5 }));
    const lx = cx + (R + 24) * Math.cos(ang), ly = cy + (R + 24) * Math.sin(ang);
    root.append(svg('text', { x: lx, y: ly + 3, 'font-size': 11,
      'text-anchor': 'middle', fill: 'var(--ink-2)' }, c));
  });
  // Compute means per axis, plot as polygon
  const means = norms.map(n => {
    const v = getNumeric(n.col);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return { ang: 0, r: (m / n.max) * R };
  });
  const pts = means.map((m, i) => {
    const ang = -Math.PI / 2 + (Math.PI * 2 * i / useCols.length);
    return [cx + m.r * Math.cos(ang), cy + m.r * Math.sin(ang)];
  });
  const poly = pts.map(p => p.join(',')).join(' ');
  root.append(svg('polygon', { points: poly, fill: 'var(--accent)', opacity: 0.30,
    stroke: 'var(--accent)', 'stroke-width': 2 }));
  for (const p of pts) root.append(svg('circle', { cx: p[0], cy: p[1], r: 3.5, fill: 'var(--accent)' }));
  return wrapStaticChart(root, 'radar');
}

// ─── Polar column ───

function cfgPolarColumn({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 24);
  if (!entries.length) return emptyCard('No data.');
  const max = Math.max(...entries.map(e => e[1]));
  const W = 560, H = 560, cx = 280, cy = 280, R = 220;
  const palette = paletteFor(entries.length);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  // Reference rings
  for (const t of [0.25, 0.5, 0.75, 1.0]) {
    root.append(svg('circle', { cx, cy, r: R * t, fill: 'none',
      stroke: 'var(--line)', 'stroke-width': 0.5 }));
  }
  const angStep = (Math.PI * 2) / entries.length;
  entries.forEach(([k, v], i) => {
    const a1 = -Math.PI / 2 + i * angStep + 0.02;
    const a2 = a1 + angStep - 0.04;
    const r = (v / max) * R;
    root.append(svg('path', { d: _arcPath(cx, cy, 30, r, a1, a2),
      fill: palette[i % palette.length], opacity: 0.85 }));
    // Outer label
    const mid = (a1 + a2) / 2;
    const lx = cx + (R + 22) * Math.cos(mid), ly = cy + (R + 22) * Math.sin(mid);
    root.append(svg('text', { x: lx, y: ly + 3, 'font-size': 10,
      'text-anchor': 'middle', fill: 'var(--ink-2)' },
      `${k.length > 10 ? k.slice(0, 10) + '…' : k} (${v})`));
  });
  return wrapStaticChart(root, 'polarcol', x);
}

// ═══════════════════════════════════════════════════════════════════════
//  Interpreters for batch 1
// ═══════════════════════════════════════════════════════════════════════

function interpPie({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return `${Object.keys(counts).length} categories across ${total} observations. Largest slice: **${top[0]}** (${top[1]}, ${(top[1] / total * 100).toFixed(0)}%). Pie charts are best for ≤ 6 categories — switch to **Bar** or **Pareto** if you have more.`;
}
function interpDoughnut({ x }) { return interpPie({ x }) + ' Total appears in the centre.'; }
function interpFunnel({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2) return interpPie({ x });
  const top = sorted[0][1], bot = sorted[sorted.length - 1][1];
  const conv = bot / top;
  return `${sorted.length} stages, top stage **${sorted[0][0]}** (${top}), bottom stage **${sorted[sorted.length - 1][0]}** (${bot}). Overall conversion ${(conv * 100).toFixed(1)}%. Look for the biggest drop-off between adjacent stages — that's the bottleneck.`;
}
function interpPyramid({ x }) {
  return interpFunnel({ x }).replace('conversion', 'tier ratio') + ' Pyramid is read top-to-bottom as smallest to largest tier.';
}
function interpWaterfall({ x }) {
  const v = getNumeric(x);
  let acc = 0; const ups = v.filter(d => d > 0).length;
  for (const d of v) acc += d;
  return `${v.length} period-to-period deltas of **${x}** sum to a net **${acc > 0 ? '+' : ''}${fmtNum(acc)}** (${ups} up, ${v.length - ups} down). Green bars = positive contributions, red = negative. Dashed connectors trace the cumulative running total.`;
}
function interpBullet({ x, target }) {
  const v = getNumeric(x);
  const actual = v.reduce((a, b) => a + b, 0) / v.length;
  if (target == null || target === '') return `Mean of **${x}** is ${fmtNum(actual)}. Add a target value to see how far the actual lies inside the qualitative bands (red / amber / green = poor / ok / good).`;
  const t = Number(target);
  const off = ((actual - t) / t) * 100;
  return `Actual mean **${fmtNum(actual)}** vs target **${fmtNum(t)}** (${off >= 0 ? '+' : ''}${off.toFixed(1)}%). Coloured bands give a qualitative scale around the data range — if the actual bar lands in the green band you're on target.`;
}
function interpStepLine({ x }) {
  return `${getNumeric(x).length} observations of **${x}** drawn as a step function. Each value holds until the next observation — no interpolation. Use this when "between" values don't exist (e.g. inventory counts, version numbers, threshold levels).`;
}
function interpStepArea({ x }) { return interpStepLine({ x }) + ' Filled below to emphasise cumulative magnitude.'; }
function interpSpline({ x }) {
  return `Smooth Catmull-Rom curve through ${getNumeric(x).length} observations of **${x}**. The smoothing hides single-point noise — fine for editorial visuals, but DON'T use it for process-control work (it can mask spikes a control chart would catch).`;
}
function interpSplineArea({ x }) { return interpSpline({ x }) + ' Filled to the baseline.'; }
function interpStick({ x }) {
  const v = getNumeric(x);
  const med = quantile(v, 0.5);
  const above = v.filter(y => y > med).length;
  return `${v.length} observations as vertical sticks from the median (${fmtNum(med)}). Green = above, red = below. ${above} of ${v.length} sit above the median. Easier than a bar chart when you want to emphasise the ± distance from a reference.`;
}
function interpCalendar({ date, value }) {
  const recs = state.rows.filter(r => _parseDate(r[date]) && Number.isFinite(Number(r[value])));
  if (!recs.length) return 'No valid (date, value) pairs.';
  return `${recs.length} daily observations of **${value}** indexed by **${date}**. Darker cells = higher values. Vertical stripes reveal weekday patterns; horizontal seasons reveal monthly cycles. Hover any cell for the date + value.`;
}
function interpQuadrant({ x, y }) {
  const xs = [], ys = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]);
    if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const xMed = quantile(xs, 0.5), yMed = quantile(ys, 0.5);
  const q1 = xs.filter((x_, i) => x_ > xMed && ys[i] > yMed).length;
  return `Reference lines at the medians (${fmtNum(xMed)}, ${fmtNum(yMed)}). Top-right quadrant (Q1: high x, high y) holds ${q1} of ${xs.length} points. Classic 2×2 framework — pair this with a strategy label per quadrant in your deck.`;
}
function interpRadar() {
  const cols = (state.current?.schema_json || []).filter(c => c.type === 'number').slice(0, 8).map(c => c.name);
  return `Mean value per numeric column, plotted on a shared 0..max scale. ${cols.length} axes: **${cols.join(', ')}**. A round polygon = balanced profile; spikes = standout strengths or weaknesses. Use sparingly — radar charts read badly past 8 axes.`;
}
function interpPolarColumn({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  return `Categorical counts of **${x}** laid out around a circle. Long bars = dominant categories. Same data as a Bar chart, just radial — useful when the variable is cyclical (hour-of-day, month, compass direction).`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Batch 2 — Network / Venn / Tag / Range / Financial / Timeline
// ═══════════════════════════════════════════════════════════════════════

// ─── Network graph (force-directed) ───
function cfgNetwork({ from, to }) {
  const edgeCounts = new Map();
  const nodeDeg = {};
  for (const r of state.rows) {
    const a = r[from] == null ? '(missing)' : String(r[from]);
    const b = r[to] == null ? '(missing)' : String(r[to]);
    if (a === b) continue;
    const k = a + '\x00' + b;
    edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
    nodeDeg[a] = (nodeDeg[a] || 0) + 1;
    nodeDeg[b] = (nodeDeg[b] || 0) + 1;
  }
  // Limit to top-50 nodes by degree for readability.
  const nodes = Object.entries(nodeDeg).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([id, deg]) => ({ id, deg }));
  const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = [];
  for (const [k, v] of edgeCounts) {
    const [a, b] = k.split('\x00');
    if (nodeIdx.has(a) && nodeIdx.has(b)) edges.push({ a: nodeIdx.get(a), b: nodeIdx.get(b), v });
  }
  if (!nodes.length) return emptyCard('No edges to render.');
  const W = 780, H = 520;
  const cx = W / 2, cy = H / 2;
  // Initial layout: ring
  nodes.forEach((n, i) => {
    const ang = (Math.PI * 2 * i) / nodes.length;
    n.x = cx + 180 * Math.cos(ang);
    n.y = cy + 180 * Math.sin(ang);
    n.vx = 0; n.vy = 0;
  });
  // Force simulation: 250 iterations
  const linkStrength = 0.02, repulsion = 1400, centerPull = 0.005, damp = 0.85;
  for (let iter = 0; iter < 250; iter++) {
    // Center gravity
    for (const n of nodes) {
      n.vx += (cx - n.x) * centerPull;
      n.vy += (cy - n.y) * centerPull;
    }
    // Repulsion (n² but n ≤ 50)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 1;
        const f = repulsion / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    // Link attraction
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      const dx = b.x - a.x, dy = b.y - a.y;
      a.vx += dx * linkStrength; a.vy += dy * linkStrength;
      b.vx -= dx * linkStrength; b.vy -= dy * linkStrength;
    }
    // Apply + damp
    for (const n of nodes) {
      n.vx *= damp; n.vy *= damp;
      n.x += n.vx * 0.5; n.y += n.vy * 0.5;
      // Box constraint
      n.x = Math.max(40, Math.min(W - 40, n.x));
      n.y = Math.max(40, Math.min(H - 40, n.y));
    }
  }
  const maxDeg = Math.max(...nodes.map(n => n.deg));
  const maxEdge = Math.max(...edges.map(e => e.v));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  // Edges first
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const w_ = 0.6 + (e.v / maxEdge) * 3;
    root.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: 'var(--muted)', 'stroke-width': w_, opacity: 0.45 }));
  }
  // Nodes
  for (const n of nodes) {
    const r_ = 5 + (n.deg / maxDeg) * 14;
    root.append(svg('circle', { cx: n.x, cy: n.y, r: r_,
      fill: 'var(--accent)', opacity: 0.85,
      stroke: 'var(--bg)', 'stroke-width': 1.5 }));
    if (r_ > 8) {
      root.append(svg('text', { x: n.x, y: n.y + r_ + 12, 'font-size': 10,
        'text-anchor': 'middle', fill: 'var(--ink-2)' },
        n.id.length > 14 ? n.id.slice(0, 14) + '…' : n.id));
    }
  }
  return wrapStaticChart(root, 'network', from, to);
}

// ─── Venn diagram (2 or 3 sets) ───
function cfgVenn({ a, b, c }) {
  // Treat each row as a member if the column is truthy (non-zero, non-empty,
  // non-false). Compute set sizes and intersections.
  const truthy = (v) => v != null && v !== '' && v !== 0 && v !== false && String(v).toLowerCase() !== 'false' && String(v).toLowerCase() !== 'no' && String(v) !== '0';
  let A = 0, B = 0, C = 0, AB = 0, AC = 0, BC = 0, ABC = 0;
  const has3 = !!c;
  for (const r of state.rows) {
    const inA = truthy(r[a]), inB = truthy(r[b]), inC = has3 && truthy(r[c]);
    if (inA) A++;
    if (inB) B++;
    if (has3 && inC) C++;
    if (inA && inB) AB++;
    if (has3 && inA && inC) AC++;
    if (has3 && inB && inC) BC++;
    if (has3 && inA && inB && inC) ABC++;
  }
  const W = 600, H = 520;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  if (!has3) {
    const r1 = 130, r2 = 130;
    const c1x = 240, c2x = 360, cy = 250;
    root.append(svg('circle', { cx: c1x, cy, r: r1, fill: 'var(--accent)', opacity: 0.32, stroke: 'var(--accent)' }));
    root.append(svg('circle', { cx: c2x, cy, r: r2, fill: '#6b5524', opacity: 0.32, stroke: '#6b5524' }));
    root.append(svg('text', { x: 160, y: cy + 5, 'font-size': 14, 'text-anchor': 'middle', fill: 'var(--ink)' }, String(A - AB)));
    root.append(svg('text', { x: 440, y: cy + 5, 'font-size': 14, 'text-anchor': 'middle', fill: 'var(--ink)' }, String(B - AB)));
    root.append(svg('text', { x: 300, y: cy + 5, 'font-size': 16, 'text-anchor': 'middle', fill: 'var(--bg)', 'font-weight': 600 }, String(AB)));
    root.append(svg('text', { x: 160, y: cy - r1 - 18, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-style': 'italic' }, a));
    root.append(svg('text', { x: 440, y: cy - r2 - 18, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-style': 'italic' }, b));
  } else {
    // Three circles in equilateral triangle
    const r = 130;
    const c1 = [240, 200], c2 = [360, 200], c3 = [300, 320];
    root.append(svg('circle', { cx: c1[0], cy: c1[1], r, fill: 'var(--accent)', opacity: 0.30, stroke: 'var(--accent)' }));
    root.append(svg('circle', { cx: c2[0], cy: c2[1], r, fill: '#6b5524', opacity: 0.30, stroke: '#6b5524' }));
    root.append(svg('circle', { cx: c3[0], cy: c3[1], r, fill: '#3a3530', opacity: 0.30, stroke: '#3a3530' }));
    // Numbers in each region — approximate centroid positions
    const onlyA = A - AB - AC + ABC, onlyB = B - AB - BC + ABC, onlyC = C - AC - BC + ABC;
    const labels = [
      [160, 190, onlyA], [440, 190, onlyB], [300, 380, onlyC],
      [300, 165, AB - ABC], [220, 290, AC - ABC], [380, 290, BC - ABC],
      [300, 250, ABC],
    ];
    for (const [x, y, n] of labels) {
      root.append(svg('text', { x, y: y + 5, 'font-size': 13, 'text-anchor': 'middle',
        fill: 'var(--ink)', 'font-weight': 600 }, String(n)));
    }
    root.append(svg('text', { x: 160, y: 70, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-style': 'italic' }, a));
    root.append(svg('text', { x: 440, y: 70, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-style': 'italic' }, b));
    root.append(svg('text', { x: 300, y: 480, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-style': 'italic' }, c));
  }
  return wrapStaticChart(root, 'venn', a, b);
}

// ─── Tag cloud ───
function cfgTagCloud({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 60);
  if (!entries.length) return emptyCard('No categories.');
  const max = entries[0][1], min = entries[entries.length - 1][1];
  const W = 760, H = 440;
  const palette = paletteFor(entries.length);
  // Simple row-pack: walk left-to-right, wrap when row full
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  let rowX = 16, rowY = 40, rowH = 0;
  entries.forEach(([k, v], i) => {
    const t = (v - min) / (max - min || 1);
    const fs = 12 + 36 * t;
    const text = svg('text', { x: rowX, y: rowY, 'font-size': fs, 'font-weight': t > 0.5 ? 600 : 500,
      fill: palette[i % palette.length], opacity: 0.75 + 0.25 * t,
      'font-family': 'var(--font-display, Inter)' }, k);
    root.append(text);
    // Approximate text width
    const approx = k.length * fs * 0.55;
    rowX += approx + 12;
    rowH = Math.max(rowH, fs);
    if (rowX > W - 80) {
      rowX = 16;
      rowY += rowH + 18;
      rowH = 0;
    }
  });
  return wrapStaticChart(root, 'tagcloud', x);
}

// ─── Circle packing ───
function cfgCirclePack({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 80);
  if (!entries.length) return emptyCard('No data.');
  const W = 760, H = 540;
  const palette = paletteFor(entries.length);
  // Greedy packing: place each circle, scan a candidate grid for first non-overlap.
  const circles = [];
  // Pre-compute radii (sqrt scale)
  const maxC = entries[0][1];
  for (const [k, v] of entries) {
    const r = 8 + 52 * Math.sqrt(v / maxC);
    circles.push({ k, v, r });
  }
  // Front: start with the biggest in the middle, then attach each next to the
  // closest pair of existing circles (Wang–Tropp-ish heuristic; suitable for ≤ 80).
  function placed(i, cx, cy) { return { i, x: cx, y: cy, r: circles[i].r }; }
  const place = [];
  if (circles.length > 0) {
    place.push(placed(0, W / 2, H / 2));
  }
  if (circles.length > 1) {
    place.push(placed(1, W / 2 + place[0].r + circles[1].r, H / 2));
  }
  for (let i = 2; i < circles.length; i++) {
    const ri = circles[i].r;
    // Try positions tangent to two existing circles
    let best = null;
    for (let a = 0; a < place.length; a++) {
      for (let b = a + 1; b < place.length; b++) {
        const A = place[a], B = place[b];
        const dab = Math.hypot(A.x - B.x, A.y - B.y);
        const sumA = A.r + ri, sumB = B.r + ri;
        if (dab > sumA + sumB) continue;
        // Two candidate positions
        const t = (sumA * sumA - sumB * sumB + dab * dab) / (2 * dab);
        const h_ = sumA * sumA - t * t;
        if (h_ < 0) continue;
        const hs = Math.sqrt(h_);
        const ux = (B.x - A.x) / dab, uy = (B.y - A.y) / dab;
        const px = A.x + ux * t, py = A.y + uy * t;
        for (const sign of [1, -1]) {
          const cx_ = px + sign * hs * (-uy);
          const cy_ = py + sign * hs * ux;
          // Check overlap with all placed
          let ok = true;
          for (const C of place) {
            if (Math.hypot(cx_ - C.x, cy_ - C.y) < C.r + ri - 0.5) { ok = false; break; }
          }
          if (!ok) continue;
          // Score: closer to center is better
          const score = Math.hypot(cx_ - W / 2, cy_ - H / 2);
          if (!best || score < best.score) best = { x: cx_, y: cy_, score };
        }
      }
    }
    if (best) place.push({ i, x: best.x, y: best.y, r: ri });
  }
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  place.forEach((p, _) => {
    root.append(svg('circle', { cx: p.x, cy: p.y, r: p.r,
      fill: palette[p.i % palette.length], opacity: 0.78,
      stroke: 'var(--bg)', 'stroke-width': 1.5 }));
    if (p.r > 18) {
      root.append(svg('text', { x: p.x, y: p.y + 3, 'font-size': Math.min(14, p.r / 2.5),
        'text-anchor': 'middle', fill: 'var(--bg)', 'font-weight': 600 },
        circles[p.i].k.length > 12 ? circles[p.i].k.slice(0, 12) + '…' : circles[p.i].k));
      if (p.r > 30) {
        root.append(svg('text', { x: p.x, y: p.y + 18, 'font-size': 10,
          'text-anchor': 'middle', fill: 'var(--bg)', opacity: 0.8 },
          String(circles[p.i].v)));
      }
    }
  });
  return wrapStaticChart(root, 'circlepack', x);
}

// ─── Range area / spline / step ───
function _rangeSpec({ kind, low, high, mid }, drawFn) {
  const recs = [];
  for (let i = 0; i < state.rows.length; i++) {
    const r = state.rows[i];
    const l = Number(r[low]), h_ = Number(r[high]);
    const m = mid ? Number(r[mid]) : null;
    if (Number.isFinite(l) && Number.isFinite(h_)) recs.push({ i, l, h: h_, m });
  }
  if (!recs.length) return emptyCard('Need at least one (low, high) pair.');
  const allY = recs.flatMap(r => [r.l, r.h]);
  const mn = Math.min(...allY), mx = Math.max(...allY);
  const pad = (mx - mn) * 0.06 || 1;
  return renderInteractiveChart({
    kind, width: 760, height: 380, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [1, recs.length], yRange: [mn - pad, mx + pad],
    xLabel: 'observation', yLabel: `${low} / ${high}`,
    points: recs.map(r => ({ i: r.i, x: r.i + 1, y: (r.l + r.h) / 2,
      label: `obs ${r.i + 1}`, meta: { low: fmtNum(r.l), high: fmtNum(r.h) } })),
    draw: (root, scales) => drawFn(root, scales, recs),
  });
}

function cfgRangeArea({ low, high, mid }) {
  return _rangeSpec({ kind: 'rangearea', low, high, mid }, (root, { xScale, yScale }, recs) => {
    const top = recs.map(r => `${xScale(r.i + 1)} ${yScale(r.h)}`).join(' L ');
    const bot = recs.slice().reverse().map(r => `${xScale(r.i + 1)} ${yScale(r.l)}`).join(' L ');
    root.append(svg('path', { d: `M ${top} L ${bot} Z`, fill: 'var(--accent)', opacity: 0.20 }));
    root.append(svg('path', { d: 'M ' + recs.map(r => `${xScale(r.i + 1)} ${yScale(r.h)}`).join(' L '),
      fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.2 }));
    root.append(svg('path', { d: 'M ' + recs.map(r => `${xScale(r.i + 1)} ${yScale(r.l)}`).join(' L '),
      fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.2 }));
    if (mid && recs[0].m != null) {
      root.append(svg('path', { d: 'M ' + recs.map(r => `${xScale(r.i + 1)} ${yScale(r.m)}`).join(' L '),
        fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8 }));
    }
  });
}
function cfgRangeSpline({ low, high }) {
  return _rangeSpec({ kind: 'rangespline', low, high }, (root, { xScale, yScale }, recs) => {
    const topPts = recs.map(r => [xScale(r.i + 1), yScale(r.h)]);
    const botPts = recs.slice().reverse().map(r => [xScale(r.i + 1), yScale(r.l)]);
    const dTop = _splinePath(topPts);
    const dBot = _splinePath(botPts);
    root.append(svg('path', { d: dTop + ' L ' + botPts.map(p => p.join(' ')).join(' L ') + ' Z',
      fill: 'var(--accent)', opacity: 0.22 }));
    root.append(svg('path', { d: dTop, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.4 }));
    root.append(svg('path', { d: _splinePath(recs.map(r => [xScale(r.i + 1), yScale(r.l)])),
      fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.4 }));
  });
}
function cfgRangeStep({ low, high }) {
  return _rangeSpec({ kind: 'rangestep', low, high }, (root, { xScale, yScale, plot }, recs) => {
    let topD = '', botD = '';
    for (let i = 0; i < recs.length; i++) {
      if (i === 0) {
        topD += `M ${xScale(1)} ${yScale(recs[0].h)}`;
        botD += `M ${xScale(1)} ${yScale(recs[0].l)}`;
      } else {
        topD += ` L ${xScale(i + 1)} ${yScale(recs[i - 1].h)} L ${xScale(i + 1)} ${yScale(recs[i].h)}`;
        botD += ` L ${xScale(i + 1)} ${yScale(recs[i - 1].l)} L ${xScale(i + 1)} ${yScale(recs[i].l)}`;
      }
    }
    // Build fill polygon
    const topSeg = [];
    const botSeg = [];
    for (let i = 0; i < recs.length; i++) {
      const xp = xScale(i + 1);
      const xn = xScale(i + 2 > recs.length ? recs.length : i + 1);
      topSeg.push([xp, yScale(recs[i].h)]);
      botSeg.unshift([xp, yScale(recs[i].l)]);
    }
    const allPts = topSeg.concat(botSeg);
    root.append(svg('polygon', { points: allPts.map(p => p.join(',')).join(' '),
      fill: 'var(--accent)', opacity: 0.20 }));
    root.append(svg('path', { d: topD, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.4 }));
    root.append(svg('path', { d: botD, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.4 }));
  });
}

// ─── Range bar / Range column ───
function cfgRangeBar({ cat, low, high }) {
  const recs = [];
  for (const r of state.rows) {
    const c = r[cat] == null ? '(missing)' : String(r[cat]);
    const l = Number(r[low]), h_ = Number(r[high]);
    if (Number.isFinite(l) && Number.isFinite(h_)) recs.push({ c, l, h: h_ });
  }
  if (!recs.length) return emptyCard('No data.');
  // Average per category
  const grouped = {};
  for (const r of recs) {
    if (!grouped[r.c]) grouped[r.c] = { ls: [], hs: [] };
    grouped[r.c].ls.push(r.l); grouped[r.c].hs.push(r.h);
  }
  const cats = Object.keys(grouped).slice(0, 30);
  const data = cats.map(c => ({
    c,
    l: grouped[c].ls.reduce((a, b) => a + b, 0) / grouped[c].ls.length,
    h: grouped[c].hs.reduce((a, b) => a + b, 0) / grouped[c].hs.length,
  }));
  const allY = data.flatMap(d => [d.l, d.h]);
  const mn = Math.min(...allY), mx = Math.max(...allY);
  const pad = (mx - mn) * 0.06 || 1;
  return renderInteractiveChart({
    kind: 'rangebar',
    width: Math.max(720, data.length * 50 + 200), height: 380,
    pad: { l: 56, r: 18, t: 18, b: 86 },
    xRange: [0.5, data.length + 0.5], yRange: [mn - pad, mx + pad],
    xLabels: cats, xLabel: cat, yLabel: `${low} → ${high}`,
    points: data.map((d, i) => ({ i, x: i + 1, y: (d.l + d.h) / 2,
      label: d.c, meta: { low: fmtNum(d.l), high: fmtNum(d.h) } })),
    brushable: false,
    draw: (root, { xScale, yScale, plot }) => {
      const slot = plot.w / data.length;
      data.forEach((d, i) => {
        const cx_ = xScale(i + 1);
        const x_ = cx_ - slot / 2 + 8;
        const yT = yScale(d.h), yB = yScale(d.l);
        root.append(svg('rect', { x: x_, y: yT, width: slot - 16, height: yB - yT,
          fill: 'var(--accent)', opacity: 0.65, stroke: 'var(--accent)' }));
      });
    },
  });
}
function cfgRangeCol(p) { return cfgRangeBar(p); }  // we already render vertical; same chart

// ─── OHLC / Candlestick / HiLo ───
function _ohlcRecords({ open, high, low, close }) {
  const recs = [];
  for (let i = 0; i < state.rows.length; i++) {
    const r = state.rows[i];
    const o = open ? Number(r[open]) : null;
    const h_ = Number(r[high]);
    const l = Number(r[low]);
    const c = close ? Number(r[close]) : null;
    if (Number.isFinite(h_) && Number.isFinite(l)) recs.push({ i, o, h: h_, l, c });
  }
  return recs;
}
function cfgOHLC({ open, high, low, close }) {
  const recs = _ohlcRecords({ open, high, low, close });
  if (!recs.length) return emptyCard('No data.');
  const allY = recs.flatMap(r => [r.l, r.h]);
  const mn = Math.min(...allY), mx = Math.max(...allY);
  const pad = (mx - mn) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'ohlc',
    width: 760, height: 420, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [1, recs.length], yRange: [mn - pad, mx + pad],
    xLabel: 'period', yLabel: 'price',
    points: recs.map(r => ({ i: r.i, x: r.i + 1, y: r.c ?? r.h,
      label: `period ${r.i + 1}`,
      meta: { open: fmtNum(r.o), high: fmtNum(r.h), low: fmtNum(r.l), close: fmtNum(r.c) } })),
    draw: (root, { xScale, yScale }) => {
      const slot = (xScale(2) - xScale(1));
      const tickW = Math.min(8, slot * 0.3);
      recs.forEach(r => {
        const px = xScale(r.i + 1);
        const color = r.c != null && r.c >= r.o ? 'var(--success)' : 'var(--danger)';
        root.append(svg('line', { x1: px, x2: px, y1: yScale(r.h), y2: yScale(r.l),
          stroke: color, 'stroke-width': 1.5 }));
        if (r.o != null) {
          root.append(svg('line', { x1: px - tickW, x2: px, y1: yScale(r.o), y2: yScale(r.o),
            stroke: color, 'stroke-width': 1.8 }));
        }
        if (r.c != null) {
          root.append(svg('line', { x1: px, x2: px + tickW, y1: yScale(r.c), y2: yScale(r.c),
            stroke: color, 'stroke-width': 1.8 }));
        }
      });
    },
  });
}
function cfgCandle({ open, high, low, close }) {
  const recs = _ohlcRecords({ open, high, low, close });
  if (!recs.length) return emptyCard('No data.');
  const allY = recs.flatMap(r => [r.l, r.h]);
  const mn = Math.min(...allY), mx = Math.max(...allY);
  const pad = (mx - mn) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'candle',
    width: 760, height: 420, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [1, recs.length], yRange: [mn - pad, mx + pad],
    xLabel: 'period', yLabel: 'price',
    points: recs.map(r => ({ i: r.i, x: r.i + 1, y: (r.o + r.c) / 2,
      label: `period ${r.i + 1}`,
      meta: { open: fmtNum(r.o), high: fmtNum(r.h), low: fmtNum(r.l), close: fmtNum(r.c) } })),
    draw: (root, { xScale, yScale }) => {
      const slot = (xScale(2) - xScale(1));
      const w = Math.max(3, Math.min(slot * 0.55, 14));
      recs.forEach(r => {
        const px = xScale(r.i + 1);
        const up = r.c >= r.o;
        const color = up ? 'var(--success)' : 'var(--danger)';
        // Wick
        root.append(svg('line', { x1: px, x2: px, y1: yScale(r.h), y2: yScale(r.l),
          stroke: color, 'stroke-width': 1.2 }));
        // Body
        const yT = yScale(Math.max(r.o, r.c)), yB = yScale(Math.min(r.o, r.c));
        root.append(svg('rect', { x: px - w / 2, y: yT, width: w, height: Math.max(1, yB - yT),
          fill: up ? color : color, opacity: up ? 0.4 : 0.85,
          stroke: color, 'stroke-width': 1 }));
      });
    },
  });
}
function cfgHiLo({ high, low }) {
  const recs = _ohlcRecords({ high, low });
  if (!recs.length) return emptyCard('No data.');
  const allY = recs.flatMap(r => [r.l, r.h]);
  const mn = Math.min(...allY), mx = Math.max(...allY);
  const pad = (mx - mn) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'hilo',
    width: 760, height: 380, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [1, recs.length], yRange: [mn - pad, mx + pad],
    xLabel: 'period', yLabel: `${low} – ${high}`,
    points: recs.map(r => ({ i: r.i, x: r.i + 1, y: (r.l + r.h) / 2, label: `period ${r.i + 1}` })),
    draw: (root, { xScale, yScale }) => {
      recs.forEach(r => {
        const px = xScale(r.i + 1);
        root.append(svg('line', { x1: px, x2: px, y1: yScale(r.h), y2: yScale(r.l),
          stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
        root.append(svg('circle', { cx: px, cy: yScale(r.h), r: 2, fill: 'var(--ink-2)' }));
        root.append(svg('circle', { cx: px, cy: yScale(r.l), r: 2, fill: 'var(--ink-2)' }));
      });
    },
  });
}

// ─── Jump line ───
function cfgJumpLine({ x }) {
  // Treat all rows; missing values break the line into segments.
  const segments = [];
  let cur = [];
  for (let i = 0; i < state.rows.length; i++) {
    const v = Number(state.rows[i][x]);
    if (Number.isFinite(v)) cur.push({ i, v });
    else {
      if (cur.length) segments.push(cur);
      cur = [];
    }
  }
  if (cur.length) segments.push(cur);
  if (!segments.length) return emptyCard('No data.');
  const vals = segments.flat();
  const allY = vals.map(p => p.v);
  const mn = Math.min(...allY), mx = Math.max(...allY);
  const pad = (mx - mn) * 0.06 || 1;
  return renderInteractiveChart({
    kind: 'jumpline',
    width: 760, height: 360, pad: { l: 56, r: 18, t: 16, b: 44 },
    xRange: [1, state.rows.length], yRange: [mn - pad, mx + pad],
    xLabel: 'observation', yLabel: x,
    points: vals.map(p => ({ i: p.i, x: p.i + 1, y: p.v, label: `obs ${p.i + 1}` })),
    draw: (root, { xScale, yScale }) => {
      for (const seg of segments) {
        if (seg.length < 2) {
          const p = seg[0];
          root.append(svg('circle', { cx: xScale(p.i + 1), cy: yScale(p.v), r: 3, fill: 'var(--ink-2)' }));
          continue;
        }
        const d = seg.map((p, i) => `${i ? 'L' : 'M'} ${xScale(p.i + 1)} ${yScale(p.v)}`).join(' ');
        root.append(svg('path', { d, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
      }
      for (const p of vals) {
        root.append(svg('circle', { cx: xScale(p.i + 1), cy: yScale(p.v), r: 2.5, fill: 'var(--ink-2)' }));
      }
    },
  });
}

// ─── Timeline / Gantt ───
function cfgTimeline({ label, start, end }) {
  const recs = [];
  for (const r of state.rows) {
    const s = _parseDate(r[start]) || Number(r[start]);
    const e = _parseDate(r[end]) || Number(r[end]);
    const lbl = r[label] == null ? '(missing)' : String(r[label]);
    if (s == null || e == null) continue;
    if ((s instanceof Date && !isNaN(s)) || Number.isFinite(s)) {
      const sNum = s instanceof Date ? s.getTime() : s;
      const eNum = e instanceof Date ? e.getTime() : e;
      if (Number.isFinite(sNum) && Number.isFinite(eNum)) recs.push({ lbl, s: sNum, e: eNum, isDate: s instanceof Date });
    }
  }
  if (!recs.length) return emptyCard('No valid timeline rows. Need start + end as dates or numbers.');
  // Sort by start
  recs.sort((a, b) => a.s - b.s);
  const xMin = Math.min(...recs.map(r => r.s));
  const xMax = Math.max(...recs.map(r => r.e));
  const isDate = recs[0].isDate;
  const W = 800, H = Math.max(360, recs.length * 28 + 80), pad = { l: 140, r: 24, t: 28, b: 40 };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  const xScale = (v) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r);
  const barH = ((H - pad.t - pad.b) / recs.length) * 0.7;
  const palette = paletteFor(recs.length);
  recs.forEach((r, i) => {
    const y = pad.t + i * ((H - pad.t - pad.b) / recs.length);
    root.append(svg('rect', { x: xScale(r.s), y, width: Math.max(2, xScale(r.e) - xScale(r.s)),
      height: barH, fill: palette[i % palette.length], opacity: 0.85, rx: 3 }));
    root.append(svg('text', { x: pad.l - 8, y: y + barH / 2 + 4,
      'font-size': 11, 'text-anchor': 'end', fill: 'var(--ink-2)' },
      r.lbl.length > 18 ? r.lbl.slice(0, 18) + '…' : r.lbl));
  });
  // X axis
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const v = xMin + (xMax - xMin) * i / ticks;
    const px = xScale(v);
    root.append(svg('line', { x1: px, x2: px, y1: pad.t, y2: H - pad.b,
      stroke: 'var(--line)', 'stroke-width': 0.4 }));
    const label_ = isDate
      ? new Date(v).toISOString().slice(0, 10)
      : fmtNum(v);
    root.append(svg('text', { x: px, y: H - pad.b + 16, 'font-size': 10,
      'text-anchor': 'middle', fill: 'var(--muted)' }, label_));
  }
  return wrapStaticChart(root, 'timeline', label);
}

// ─── Heatmap (mean) ───
function cfgHeatMean({ x, y, value }) {
  const sums = {}, counts = {};
  const xSet = new Set(), ySet = new Set();
  for (const r of state.rows) {
    const a = r[x] == null ? '(missing)' : String(r[x]);
    const b = r[y] == null ? '(missing)' : String(r[y]);
    const v = Number(r[value]);
    if (!Number.isFinite(v)) continue;
    xSet.add(a); ySet.add(b);
    const k = a + '\x00' + b;
    sums[k] = (sums[k] || 0) + v;
    counts[k] = (counts[k] || 0) + 1;
  }
  const xs = [...xSet].slice(0, 20), ys = [...ySet].slice(0, 20);
  const means = {};
  let mnV = Infinity, mxV = -Infinity;
  for (const a of xs) for (const b of ys) {
    const k = a + '\x00' + b;
    if (counts[k]) {
      means[k] = sums[k] / counts[k];
      mnV = Math.min(mnV, means[k]);
      mxV = Math.max(mxV, means[k]);
    }
  }
  if (!isFinite(mnV)) return emptyCard('No valid (cat, cat, numeric) rows.');
  return renderInteractiveChart({
    kind: 'heatmean',
    width: Math.max(720, xs.length * 50 + 200),
    height: Math.max(360, ys.length * 32 + 120),
    pad: { l: 130, r: 24, t: 16, b: 88 },
    xRange: [0.5, xs.length + 0.5], yRange: [ys.length + 0.5, 0.5],
    xLabels: xs, yLabel: y,
    points: [], brushable: false,
    draw: (root, { xScale, yScale, plot }) => {
      const cw = (xScale(2) - xScale(1));
      const ch = (yScale(1) - yScale(2));
      for (let i = 0; i < xs.length; i++) {
        for (let j = 0; j < ys.length; j++) {
          const k = xs[i] + '\x00' + ys[j];
          if (!(k in means)) continue;
          const t = (means[k] - mnV) / (mxV - mnV || 1);
          root.append(svg('rect', {
            x: xScale(i + 1) - cw / 2, y: yScale(j + 1) - ch / 2,
            width: cw - 1, height: ch - 1,
            fill: `rgba(107, 85, 36, ${0.10 + 0.82 * t})`,
          }));
          root.append(svg('text', { x: xScale(i + 1), y: yScale(j + 1) + 4,
            'font-size': 11, 'text-anchor': 'middle',
            fill: t > 0.5 ? 'var(--bg)' : 'var(--ink)' }, fmtNum(means[k])));
        }
      }
      ys.forEach((lbl, j) => {
        root.append(svg('text', { x: plot.x - 8, y: yScale(j + 1) + 4,
          'font-size': 10, 'text-anchor': 'end', fill: 'var(--ink-2)' },
          lbl.length > 18 ? lbl.slice(0, 18) + '…' : lbl));
      });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Interpreters for batch 2
// ═══════════════════════════════════════════════════════════════════════

function interpNetwork({ from, to }) {
  const deg = {};
  for (const r of state.rows) {
    const a = r[from] == null ? '(missing)' : String(r[from]);
    const b = r[to] == null ? '(missing)' : String(r[to]);
    if (a === b) continue;
    deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1;
  }
  const sorted = Object.entries(deg).sort((a, b) => b[1] - a[1]);
  return `${sorted.length} unique nodes. Highest-degree node: **${sorted[0][0]}** (${sorted[0][1]} edges). Force-directed layout — central, well-connected nodes drift to the middle; isolated nodes float to the periphery. Edge thickness scales with frequency.`;
}
function interpVenn({ a, b, c }) {
  return `Set membership across ${c ? '3' : '2'} columns. Each column treated as binary (truthy = member, falsy = not). Overlap regions show row counts in **multiple** sets — the more centred a count, the more "shared" those rows are. Use this for tag co-occurrence, multi-cause defect analysis, customer-segment overlap.`;
}
function interpTagCloud({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return `${sorted.length} distinct values of **${x}**. Largest: **${sorted[0][0]}** (${sorted[0][1]}). Font size scales with frequency; quick eyeball of which categories dominate. For precise counts use **Bar** or **Pareto**.`;
}
function interpCirclePack({ x }) {
  return interpTagCloud({ x }) + ' Each circle\'s area is proportional to its count — packed for compactness.';
}
function interpRangeArea({ low, high, mid }) {
  return `Band between **${low}** and **${high}** over ${state.rows.length} observations. The shaded band shows uncertainty / interval width. Bench's capability + control charts produce this shape naturally for confidence bands.${mid ? ' Centre line = ' + mid + '.' : ''}`;
}
function interpRangeSpline({ low, high }) {
  return `Same as **Range area** but smoothed via Catmull-Rom splines. Use only when "between" values are meaningful — for stepped or discrete intervals use **Range step area** instead.`;
}
function interpRangeStep({ low, high }) {
  return `Range band as a step function. Each interval holds its (low, high) until the next observation. Use for discrete time periods (months, sprints, batches).`;
}
function interpRangeBar({ cat, low, high }) {
  return `One bar per ${cat} showing the mean low → mean high range. Categories with wide bars have higher variability; thin bars are precise / consistent.`;
}
function interpRangeCol(p) { return interpRangeBar(p) + ' Same data as a Range bar, just oriented as columns.'; }
function interpOHLC() {
  return `Open / High / Low / Close per period. Vertical line spans the full trading range; left tick = open, right tick = close. Green = up day (close > open), red = down.`;
}
function interpCandle() {
  return `Hollow body = up day (close ≥ open), filled body = down. Wick lines extend to the period high and low. Long bodies = strong directional moves; long wicks with small bodies = indecision.`;
}
function interpHiLo() {
  return `Only the high and low per period — no open/close. Compact range-of-trading view; the spread between dots reveals volatility.`;
}
function interpJumpLine({ x }) {
  const missing = state.rows.filter(r => !Number.isFinite(Number(r[x]))).length;
  return `Line plot of **${x}** with **${missing} gap${missing === 1 ? '' : 's'}** preserved (no interpolation across missing values). Use this when missing data should be visible rather than papered over by a smooth fit.`;
}
function interpTimeline({ label, start, end }) {
  const recs = state.rows.filter(r => _parseDate(r[start]) && _parseDate(r[end]));
  return `${recs.length} entities on a time axis from **${start}** to **${end}**. Use for project schedules, machine downtime intervals, batch runs. Rows sorted by start time.`;
}
function interpHeatMean({ x, y, value }) {
  return `Cross-tab of **${x} × ${y}** coloured by the **mean of ${value}** in each cell. Cells with no observations are blank. Dark cells = high mean; useful for spotting where ${value} is concentrated across two categorical dimensions.`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Batch 3 — 3D / Polar family / Radar family / Stacked / Polygon /
//             Bar Mekko / Stem-Leaf / Wind rose
// ═══════════════════════════════════════════════════════════════════════

// ─── 3D Bar (horizontal) ───
function cfg3DBar({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).slice(0, 20);
  if (!entries.length) return emptyCard('No data.');
  const max = Math.max(...entries.map(e => e[1]));
  const palette = paletteFor(entries.length);
  const W = 760, H = Math.max(360, entries.length * 32 + 80);
  const pad = { l: 140, r: 24, t: 24, b: 48 };
  const plotW = W - pad.l - pad.r;
  const depth = 16;
  const barH = ((H - pad.t - pad.b) / entries.length) * 0.7;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  entries.forEach(([k, v], i) => {
    const y = pad.t + i * ((H - pad.t - pad.b) / entries.length);
    const w = (v / max) * (plotW - depth);
    const color = palette[i % palette.length];
    // Top face
    root.append(svg('polygon', { points: `${pad.l},${y} ${pad.l + w},${y} ${pad.l + w + depth},${y - depth} ${pad.l + depth},${y - depth}`,
      fill: color, opacity: 0.7 }));
    // Side face
    root.append(svg('polygon', { points: `${pad.l + w},${y} ${pad.l + w + depth},${y - depth} ${pad.l + w + depth},${y + barH - depth} ${pad.l + w},${y + barH}`,
      fill: color, opacity: 0.45 }));
    // Front face
    root.append(svg('rect', { x: pad.l, y, width: w, height: barH,
      fill: color, opacity: 0.92, stroke: 'var(--bg)', 'stroke-width': 0.5 }));
    root.append(svg('text', { x: pad.l - 8, y: y + barH / 2 + 4,
      'font-size': 11, 'text-anchor': 'end', fill: 'var(--ink-2)' },
      k.length > 18 ? k.slice(0, 18) + '…' : k));
    root.append(svg('text', { x: pad.l + w + depth + 8, y: y + barH / 2 + 4,
      'font-size': 11, fill: 'var(--ink-2)' }, String(v)));
  });
  return wrapStaticChart(root, '3dbar', x);
}

// ─── 3D Column (vertical) ───
function cfg3DColumn({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).slice(0, 16);
  if (!entries.length) return emptyCard('No data.');
  const max = Math.max(...entries.map(e => e[1]));
  const palette = paletteFor(entries.length);
  const W = Math.max(760, entries.length * 70 + 120), H = 460;
  const pad = { l: 60, r: 60, t: 30, b: 100 };
  const plotH = H - pad.t - pad.b;
  const depth = 18;
  const slot = (W - pad.l - pad.r) / entries.length;
  const barW = slot * 0.6;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  entries.forEach(([k, v], i) => {
    const cx = pad.l + i * slot + slot / 2;
    const x_ = cx - barW / 2;
    const h_ = (v / max) * (plotH - depth);
    const y = pad.t + plotH - h_;
    const color = palette[i % palette.length];
    // Top
    root.append(svg('polygon', { points: `${x_},${y} ${x_ + barW},${y} ${x_ + barW + depth},${y - depth} ${x_ + depth},${y - depth}`,
      fill: color, opacity: 0.7 }));
    // Side
    root.append(svg('polygon', { points: `${x_ + barW},${y} ${x_ + barW + depth},${y - depth} ${x_ + barW + depth},${pad.t + plotH - depth} ${x_ + barW},${pad.t + plotH}`,
      fill: color, opacity: 0.45 }));
    // Front
    root.append(svg('rect', { x: x_, y, width: barW, height: h_,
      fill: color, opacity: 0.92 }));
    root.append(svg('text', { x: cx, y: pad.t + plotH + 18, 'font-size': 11,
      'text-anchor': 'middle', fill: 'var(--ink-2)',
      transform: k.length > 6 ? `rotate(-30 ${cx} ${pad.t + plotH + 18})` : null },
      k.length > 14 ? k.slice(0, 14) + '…' : k));
    root.append(svg('text', { x: cx + depth / 2, y: y - depth - 4,
      'font-size': 10, 'text-anchor': 'middle', fill: 'var(--muted)' }, String(v)));
  });
  return wrapStaticChart(root, '3dcol', x);
}

// ─── 3D Pie / 3D Doughnut ───
function _3dPie({ x }, innerR) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const palette = paletteFor(entries.length);
  const W = 560, H = 480, cx = 280, cy = 220;
  const rx = 200, ry = 90, depth = 28;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  // Draw sides first (back to front) — slices below the y axis only.
  let cur = 0;
  // For 3D illusion, we draw two ellipse halves with depth offset
  // Side rim
  root.append(svg('ellipse', { cx, cy: cy + depth, rx, ry,
    fill: '#000', opacity: 0.15 }));
  // Top arcs
  for (let i = 0; i < entries.length; i++) {
    const [k, v] = entries[i];
    const span = (v / total) * Math.PI * 2;
    const a1 = cur, a2 = cur + span;
    // Build elliptical wedge path
    const large = span > Math.PI ? 1 : 0;
    const x1 = cx + rx * Math.cos(a1), y1 = cy + ry * Math.sin(a1);
    const x2 = cx + rx * Math.cos(a2), y2 = cy + ry * Math.sin(a2);
    let d;
    if (innerR > 0) {
      const ix1 = cx + (innerR * 0.5) * rx / 200 * Math.cos(a1);
      const iy1 = cy + (innerR * 0.5) * ry / 90 * Math.sin(a1);
      const ix2 = cx + (innerR * 0.5) * rx / 200 * Math.cos(a2);
      const iy2 = cy + (innerR * 0.5) * ry / 90 * Math.sin(a2);
      const irx = (innerR * 0.5) * rx / 200, iry = (innerR * 0.5) * ry / 90;
      d = `M ${x1} ${y1} A ${rx} ${ry} 0 ${large} 1 ${x2} ${y2} ` +
          `L ${ix2} ${iy2} A ${irx} ${iry} 0 ${large} 0 ${ix1} ${iy1} Z`;
    } else {
      d = `M ${cx} ${cy} L ${x1} ${y1} A ${rx} ${ry} 0 ${large} 1 ${x2} ${y2} Z`;
    }
    root.append(svg('path', { d, fill: palette[i % palette.length],
      opacity: 0.92, stroke: 'var(--bg)', 'stroke-width': 1.5 }));
    // Label
    if (span > 0.18) {
      const mid = (a1 + a2) / 2;
      const lx = cx + (rx * 0.7) * Math.cos(mid), ly = cy + (ry * 0.7) * Math.sin(mid);
      root.append(svg('text', { x: lx, y: ly + 4,
        'font-size': 11, 'text-anchor': 'middle',
        fill: 'var(--bg)', 'font-weight': 600 },
        `${(v / total * 100).toFixed(0)}%`));
    }
    cur = a2;
  }
  // Side strip below pie (gives 3D illusion)
  for (let a = 0; a <= Math.PI; a += 0.05) {
    const sx = cx + rx * Math.cos(a), sy = cy + ry * Math.sin(a);
    root.append(svg('line', { x1: sx, y1: sy, x2: sx, y2: sy + depth,
      stroke: 'var(--ink)', opacity: 0.10 }));
  }
  // Legend
  entries.forEach(([k, v], i) => {
    const ly = 360 + i * 18;
    root.append(svg('rect', { x: 40, y: ly, width: 12, height: 12, fill: palette[i % palette.length] }));
    root.append(svg('text', { x: 58, y: ly + 10, 'font-size': 11, fill: 'var(--ink-2)' },
      `${k.length > 16 ? k.slice(0, 16) + '…' : k} · ${v}`));
  });
  return root;
}
function cfg3DPie({ x }) { return wrapStaticChart(_3dPie({ x }, 0), '3dpie', x); }
function cfg3DDoughnut({ x }) { return wrapStaticChart(_3dPie({ x }, 220), '3ddoughnut', x); }

// ─── Polar family (Area / Line / Marker / Polygon) ───
function _polarPoints({ x }) {
  const counts = {};
  for (const v of getCategorical(x)) counts[v] = (counts[v] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 24);
  return entries;
}
function _polarChart({ x }, draw, kind) {
  const entries = _polarPoints({ x });
  if (!entries.length) return emptyCard('No data.');
  const max = Math.max(...entries.map(e => e[1]));
  const W = 540, H = 540, cx = 270, cy = 270, R = 200;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  // Rings
  for (const t of [0.25, 0.5, 0.75, 1.0]) {
    root.append(svg('circle', { cx, cy, r: R * t, fill: 'none',
      stroke: 'var(--line)', 'stroke-width': 0.5 }));
  }
  const angles = entries.map((_, i) => -Math.PI / 2 + (Math.PI * 2 * i) / entries.length);
  const pts = entries.map(([k, v], i) => {
    const r = (v / max) * R;
    return { k, v, ang: angles[i], x: cx + r * Math.cos(angles[i]), y: cy + r * Math.sin(angles[i]) };
  });
  // Axis labels
  entries.forEach(([k], i) => {
    const ang = angles[i];
    const lx = cx + (R + 22) * Math.cos(ang), ly = cy + (R + 22) * Math.sin(ang);
    root.append(svg('text', { x: lx, y: ly + 3, 'font-size': 10,
      'text-anchor': 'middle', fill: 'var(--ink-2)' },
      k.length > 12 ? k.slice(0, 12) + '…' : k));
  });
  draw(root, cx, cy, pts);
  return wrapStaticChart(root, kind, x);
}
function cfgPolarArea({ x }) {
  return _polarChart({ x }, (root, cx, cy, pts) => {
    const path = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z';
    root.append(svg('path', { d: path, fill: 'var(--accent)', opacity: 0.35,
      stroke: 'var(--accent)', 'stroke-width': 1.5 }));
    for (const p of pts) {
      root.append(svg('circle', { cx: p.x, cy: p.y, r: 3.5, fill: 'var(--accent)' }));
    }
  }, 'polararea');
}
function cfgPolarLine({ x }) {
  return _polarChart({ x }, (root, cx, cy, pts) => {
    const path = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
    root.append(svg('path', { d: path, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8 }));
    for (const p of pts) {
      root.append(svg('circle', { cx: p.x, cy: p.y, r: 3, fill: 'var(--accent)' }));
    }
  }, 'polarline');
}
function cfgPolarMarker({ x }) {
  return _polarChart({ x }, (root, cx, cy, pts) => {
    for (const p of pts) {
      root.append(svg('circle', { cx: p.x, cy: p.y, r: 5, fill: 'var(--accent)', opacity: 0.85 }));
    }
  }, 'polarmarker');
}
function cfgPolarPolygon({ x }) {
  return _polarChart({ x }, (root, cx, cy, pts) => {
    const polygon = pts.map(p => p.x + ',' + p.y).join(' ');
    root.append(svg('polygon', { points: polygon, fill: 'none',
      stroke: 'var(--accent)', 'stroke-width': 2 }));
    for (const p of pts) {
      root.append(svg('circle', { cx: p.x, cy: p.y, r: 3.5, fill: 'var(--accent)' }));
    }
  }, 'polarpoly');
}

// ─── Radar (line / marker) variants ───
function _radarBase(drawFn, kind) {
  const cols = (state.current?.schema_json || []).filter(c => c.type === 'number').map(c => c.name);
  if (cols.length < 3) return emptyCard('Need ≥ 3 numeric columns.');
  const useCols = cols.slice(0, 8);
  const norms = useCols.map(c => {
    const v = getNumeric(c);
    return { col: c, max: Math.max(...v) || 1, mean: v.reduce((a, b) => a + b, 0) / v.length };
  });
  const W = 560, H = 560, cx = 280, cy = 280, R = 200;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  for (const t of [0.25, 0.5, 0.75, 1.0]) {
    root.append(svg('circle', { cx, cy, r: R * t, fill: 'none',
      stroke: 'var(--line)', 'stroke-width': 0.5 }));
  }
  const pts = useCols.map((c, i) => {
    const ang = -Math.PI / 2 + (Math.PI * 2 * i) / useCols.length;
    const r = (norms[i].mean / norms[i].max) * R;
    root.append(svg('line', { x1: cx, y1: cy, x2: cx + R * Math.cos(ang), y2: cy + R * Math.sin(ang),
      stroke: 'var(--line)', 'stroke-width': 0.5 }));
    const lx = cx + (R + 24) * Math.cos(ang), ly = cy + (R + 24) * Math.sin(ang);
    root.append(svg('text', { x: lx, y: ly + 3, 'font-size': 11,
      'text-anchor': 'middle', fill: 'var(--ink-2)' }, c));
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  });
  drawFn(root, pts);
  return wrapStaticChart(root, kind);
}
function cfgRadarLine() {
  return _radarBase((root, pts) => {
    const path = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
    root.append(svg('path', { d: path, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
  }, 'radarline');
}
function cfgRadarMarker() {
  return _radarBase((root, pts) => {
    for (const p of pts) root.append(svg('circle', { cx: p[0], cy: p[1], r: 4, fill: 'var(--accent)' }));
  }, 'radarmark');
}

// ─── Polygon / Polyline (Cartesian) ───
function _xyPath({ x, y }, closed) {
  const xs = [], ys = [];
  for (const r of state.rows) {
    const a = Number(r[x]), b = Number(r[y]);
    if (Number.isFinite(a) && Number.isFinite(b)) { xs.push(a); ys.push(b); }
  }
  if (xs.length < 3) return null;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  return { xs, ys, xMin, xMax, yMin, yMax, closed };
}
function cfgPolygon({ x, y }) {
  const data = _xyPath({ x, y }, true);
  if (!data) return emptyCard('Need ≥ 3 paired numeric values.');
  const { xs, ys, xMin, xMax, yMin, yMax } = data;
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'polygon',
    width: 720, height: 480, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: x, yLabel: y,
    points: xs.map((x_, i) => ({ i, x: x_, y: ys[i] })),
    brushable: false,
    draw: (root, { xScale, yScale }) => {
      const pts = xs.map((x_, i) => `${xScale(x_)},${yScale(ys[i])}`);
      root.append(svg('polygon', { points: pts.join(' '),
        fill: 'var(--accent)', opacity: 0.18, stroke: 'var(--accent)', 'stroke-width': 1.6 }));
      for (let i = 0; i < xs.length; i++) {
        root.append(svg('circle', { cx: xScale(xs[i]), cy: yScale(ys[i]), r: 3, fill: 'var(--ink-2)' }));
      }
    },
  });
}
function cfgPolyline({ x, y }) {
  const data = _xyPath({ x, y }, false);
  if (!data) return emptyCard('Need ≥ 3 paired numeric values.');
  const { xs, ys, xMin, xMax, yMin, yMax } = data;
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'polyline',
    width: 720, height: 480, pad: { l: 56, r: 18, t: 18, b: 44 },
    xRange: [xMin - xPad, xMax + xPad], yRange: [yMin - yPad, yMax + yPad],
    xLabel: x, yLabel: y,
    points: xs.map((x_, i) => ({ i, x: x_, y: ys[i] })),
    brushable: false,
    draw: (root, { xScale, yScale }) => {
      const d = xs.map((x_, i) => `${i ? 'L' : 'M'} ${xScale(x_)} ${yScale(ys[i])}`).join(' ');
      root.append(svg('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8 }));
      for (let i = 0; i < xs.length; i++) {
        root.append(svg('circle', { cx: xScale(xs[i]), cy: yScale(ys[i]), r: 3, fill: 'var(--ink-2)' }));
      }
    },
  });
}

// ─── Stacked area / spline ───
function _stackedSeries({ x, group }) {
  const series = {};
  let cursor = {};
  state.rows.forEach((r) => {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) return;
    const g = r[group] == null ? '(missing)' : String(r[group]);
    if (!series[g]) series[g] = [];
    cursor[g] = (cursor[g] || 0) + 1;
    series[g].push({ i: cursor[g], y: v });
  });
  return series;
}
function _stackedDraw(kind, spline, x, group) {
  const series = _stackedSeries({ x, group });
  const keys = Object.keys(series);
  if (!keys.length) return emptyCard('No data.');
  const maxLen = Math.max(...keys.map(k => series[k].length));
  // Build stack: for each i (1..maxLen), bottom = sum of previous series at i.
  const palette = paletteFor(keys.length);
  // Cumulative top per i
  const cum = new Array(maxLen + 1).fill(0);
  // Build top arrays per series
  const seriesTop = keys.map((_, idx) => {
    const top = new Array(maxLen + 1).fill(0);
    for (let i = 1; i <= maxLen; i++) {
      const v = (series[keys[idx]][i - 1]?.y) || 0;
      cum[i] += v;
      top[i] = cum[i];
    }
    return top;
  });
  const maxY = Math.max(...cum.slice(1));
  return renderInteractiveChart({
    kind, width: 760, height: 400, pad: { l: 60, r: 130, t: 18, b: 44 },
    xRange: [1, maxLen], yRange: [0, maxY * 1.08],
    xLabel: 'observation', yLabel: x,
    points: [], brushable: true,
    draw: (root, { xScale, yScale, plot }) => {
      // Bottom for each layer = previous layer top (or 0)
      for (let idx = 0; idx < keys.length; idx++) {
        const top = seriesTop[idx];
        const bot = idx === 0 ? new Array(maxLen + 1).fill(0) : seriesTop[idx - 1];
        const topPts = [];
        const botPts = [];
        for (let i = 1; i <= maxLen; i++) {
          topPts.push([xScale(i), yScale(top[i])]);
          botPts.push([xScale(i), yScale(bot[i])]);
        }
        let polyPts;
        if (spline) {
          const dt = _splinePath(topPts), db = _splinePath(botPts.slice().reverse());
          root.append(svg('path', { d: dt + ' L ' + botPts.slice().reverse().map(p => p.join(' ')).join(' L ') + ' Z',
            fill: palette[idx], opacity: 0.78 }));
        } else {
          polyPts = topPts.concat(botPts.slice().reverse());
          root.append(svg('polygon', { points: polyPts.map(p => p.join(',')).join(' '),
            fill: palette[idx], opacity: 0.78 }));
        }
      }
      // Legend
      keys.forEach((k, idx) => {
        const y = plot.y + 4 + idx * 18;
        root.append(svg('rect', { x: plot.x + plot.w + 8, y: y - 4, width: 10, height: 10, fill: palette[idx] }));
        root.append(svg('text', { x: plot.x + plot.w + 24, y: y + 4, 'font-size': 11, fill: 'var(--ink-2)' },
          k.length > 12 ? k.slice(0, 12) + '…' : k));
      });
    },
  });
}
function cfgStackedArea({ x, group }) { return _stackedDraw('stackedarea', false, x, group); }
function cfgStackedSpline({ x, group }) { return _stackedDraw('stackedspline', true, x, group); }

// ─── Bar Mekko (horizontal Marimekko) ───
function cfgBarMekko({ x, group }) {
  const rowCounts = {};
  for (const r of state.rows) {
    const xv = r[x] == null ? '(missing)' : String(r[x]);
    const gv = r[group] == null ? '(missing)' : String(r[group]);
    if (!rowCounts[xv]) rowCounts[xv] = { total: 0, sub: {} };
    rowCounts[xv].total++;
    rowCounts[xv].sub[gv] = (rowCounts[xv].sub[gv] || 0) + 1;
  }
  const rowKeys = Object.entries(rowCounts).sort((a, b) => b[1].total - a[1].total)
    .map(([k]) => k).slice(0, 16);
  const subSet = new Set();
  for (const k of rowKeys) for (const sk of Object.keys(rowCounts[k].sub)) subSet.add(sk);
  const subKeys = [...subSet].slice(0, 12);
  const total = rowKeys.reduce((a, k) => a + rowCounts[k].total, 0) || 1;
  const palette = paletteFor(subKeys.length);
  const W = 820, H = 540, pad = { l: 130, r: 130, t: 30, b: 30 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  let yCursor = pad.t;
  rowKeys.forEach((rk, ri) => {
    const yh = (rowCounts[rk].total / total) * plotH;
    let xCursor = pad.l;
    subKeys.forEach((sk, si) => {
      const c = rowCounts[rk].sub[sk] || 0;
      const xw = (c / rowCounts[rk].total) * plotW;
      if (c > 0) {
        root.append(svg('rect', { x: xCursor, y: yCursor, width: xw - 1, height: yh - 1,
          fill: palette[si], opacity: 0.85 }));
        if (xw > 28 && yh > 18) {
          root.append(svg('text', { x: xCursor + xw / 2, y: yCursor + yh / 2 + 4,
            'font-size': 10, 'text-anchor': 'middle', fill: 'var(--bg)' }, String(c)));
        }
      }
      xCursor += xw;
    });
    root.append(svg('text', { x: pad.l - 8, y: yCursor + yh / 2 + 4,
      'font-size': 11, 'text-anchor': 'end', fill: 'var(--ink-2)' },
      rk.length > 16 ? rk.slice(0, 16) + '…' : rk));
    yCursor += yh;
  });
  subKeys.forEach((sk, si) => {
    root.append(svg('rect', { x: W - pad.r + 10, y: pad.t + si * 18,
      width: 12, height: 12, fill: palette[si] }));
    root.append(svg('text', { x: W - pad.r + 28, y: pad.t + si * 18 + 10,
      'font-size': 10, fill: 'var(--ink-2)' },
      sk.length > 14 ? sk.slice(0, 14) + '…' : sk));
  });
  return wrapStaticChart(root, 'barmekko', x, group);
}

// ─── Stem-and-leaf ───
function cfgStemLeaf({ x }) {
  const vals = getNumeric(x).slice().sort((a, b) => a - b);
  if (vals.length < 2) return emptyCard('Need ≥ 2 values.');
  // Determine stem multiplier — pick so that we get ~10-25 stems
  const range = vals[vals.length - 1] - vals[0];
  const stemUnit = Math.pow(10, Math.floor(Math.log10(range / 12)));
  const stems = {};
  for (const v of vals) {
    const stem = Math.floor(v / stemUnit);
    if (!stems[stem]) stems[stem] = [];
    const leaf = Math.floor((v - stem * stemUnit) / (stemUnit / 10));
    stems[stem].push(leaf);
  }
  const keys = Object.keys(stems).map(Number).sort((a, b) => a - b);
  // Build text
  const lines = [`Stem-and-leaf of ${x} (n = ${vals.length}, stem unit = ${stemUnit})`,
                 ''];
  for (const s of keys) {
    const leaves = stems[s].map(l => l.toString()).join(' ');
    lines.push(`${String(s).padStart(6)} | ${leaves}`);
  }
  const W = 720, H = Math.max(360, keys.length * 18 + 80);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  lines.forEach((line, i) => {
    root.append(svg('text', { x: 30, y: 28 + i * 18,
      'font-family': 'var(--font-mono, monospace)', 'font-size': 12,
      'white-space': 'pre', fill: i === 0 ? 'var(--accent)' : 'var(--ink-2)',
      'font-weight': i === 0 ? '600' : '400' }, line));
  });
  return wrapStaticChart(root, 'stemleaf', x);
}

// ─── Wind rose / Polar histogram ───
function cfgWindRose({ x, group }) {
  const countsByDir = {};
  const subSet = new Set();
  for (const r of state.rows) {
    const dir = r[x] == null ? '(missing)' : String(r[x]);
    const g = group ? (r[group] == null ? '(missing)' : String(r[group])) : '_';
    if (!countsByDir[dir]) countsByDir[dir] = {};
    countsByDir[dir][g] = (countsByDir[dir][g] || 0) + 1;
    subSet.add(g);
  }
  const dirs = Object.keys(countsByDir).slice(0, 24);
  const subs = [...subSet].slice(0, 8);
  if (!dirs.length) return emptyCard('No data.');
  // For each direction, max stack height = sum of all subs
  let maxTotal = 0;
  for (const d of dirs) {
    const t = subs.reduce((s, g) => s + (countsByDir[d][g] || 0), 0);
    if (t > maxTotal) maxTotal = t;
  }
  const palette = paletteFor(subs.length);
  const W = 560, H = 560, cx = 280, cy = 280, R = 220;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  for (const t of [0.25, 0.5, 0.75, 1.0]) {
    root.append(svg('circle', { cx, cy, r: R * t, fill: 'none',
      stroke: 'var(--line)', 'stroke-width': 0.5 }));
  }
  const angStep = (Math.PI * 2) / dirs.length;
  dirs.forEach((d, di) => {
    const a1 = -Math.PI / 2 + di * angStep + 0.02;
    const a2 = a1 + angStep - 0.04;
    let cumR = 25;
    subs.forEach((g, gi) => {
      const c = countsByDir[d][g] || 0;
      if (c === 0) return;
      const newR = cumR + (c / maxTotal) * (R - 25);
      root.append(svg('path', { d: _arcPath(cx, cy, cumR, newR, a1, a2),
        fill: palette[gi], opacity: 0.85 }));
      cumR = newR;
    });
    const mid = (a1 + a2) / 2;
    const lx = cx + (R + 22) * Math.cos(mid), ly = cy + (R + 22) * Math.sin(mid);
    root.append(svg('text', { x: lx, y: ly + 3, 'font-size': 10,
      'text-anchor': 'middle', fill: 'var(--ink-2)' },
      d.length > 10 ? d.slice(0, 10) + '…' : d));
  });
  // Legend
  if (group) {
    subs.forEach((g, gi) => {
      root.append(svg('rect', { x: 10, y: 16 + gi * 18, width: 12, height: 12, fill: palette[gi] }));
      root.append(svg('text', { x: 28, y: 26 + gi * 18, 'font-size': 10, fill: 'var(--ink-2)' },
        g.length > 14 ? g.slice(0, 14) + '…' : g));
    });
  }
  return wrapStaticChart(root, 'windrose', x);
}

// ═══════════════════════════════════════════════════════════════════════
//  Interpreters for batch 3
// ═══════════════════════════════════════════════════════════════════════

function interp3DBar({ x }) {
  return interpBar({ x }).replace('Bars are in original order', '3D depth ribbon adds editorial flourish — same data as a Bar chart');
}
function interp3DColumn({ x }) {
  return interpBar({ x }).replace('Bars are in original order', 'Vertical 3D columns — same data as a Bar chart with depth flourish');
}
function interp3DPie({ x }) { return interpPie({ x }) + ' Elliptical depth ring gives the 3D illusion.'; }
function interp3DDoughnut({ x }) { return interpDoughnut({ x }) + ' Elliptical depth ring + centre hole.'; }
function interpPolarArea({ x }) {
  return `Polar area chart of **${x}**. Each axis = one category, radius = count. Filled polygon makes the overall shape immediately readable. Best for cyclical / radial data.`;
}
function interpPolarLine({ x }) {
  return `Polar line chart of **${x}**. Line traces the value at each angular position. Equivalent of a line chart in polar coordinates.`;
}
function interpPolarMarker({ x }) {
  return `Markers only — no connecting line. Use when adjacency between categories isn't meaningful but the radial distance still is.`;
}
function interpPolarPolygon({ x }) {
  return `Closed polygon connecting one count per category. Stronger overall-shape read than a line; weaker than Polar area when comparing absolute magnitudes.`;
}
function interpRadarLine() {
  const cols = (state.current?.schema_json || []).filter(c => c.type === 'number').slice(0, 8).map(c => c.name);
  return `Radar with only the outline — no fill. Cleaner when overlaying multiple profiles. Axes: **${cols.join(', ')}**.`;
}
function interpRadarMarker() {
  const cols = (state.current?.schema_json || []).filter(c => c.type === 'number').slice(0, 8).map(c => c.name);
  return `Just the mean-position markers on each radar axis. ${cols.length} axes, each scaled to its own 0..max range.`;
}
function interpPolygon({ x, y }) {
  return `Closed polygon through all (${x}, ${y}) points in row order. Good for shape-defining data like outlines or contours; meaningless when row order is arbitrary — use a regular scatter instead.`;
}
function interpPolyline({ x, y }) {
  return `Connected line through (${x}, ${y}) in row order — like a polygon but **not** closed. Use for paths, trajectories, or any ordered (x, y) sequence.`;
}
function interpStackedArea({ x, group }) {
  return `Multiple **${group}** series stacked. Bottom band = first series; total at top = sum across all series. Bands widening with position → that series is growing in absolute terms.`;
}
function interpStackedSpline({ x, group }) {
  return interpStackedArea({ x, group }) + ' Boundaries smoothed via Catmull-Rom splines — softer look for editorial presentations.';
}
function interpBarMekko({ x, group }) {
  return `Marimekko rotated 90°: row heights = marginal frequency of **${x}**, stack widths within each row = share of **${group}**. Reveals interactions a regular stacked bar hides because both dimensions are area-proportional.`;
}
function interpStemLeaf({ x }) {
  const v = getNumeric(x);
  return `Tukey-style stem-and-leaf for **${x}** (n = ${v.length}). Each row = one stem; leaves are the next significant digit of each observation. Preserves every value while showing the distribution shape — a workhorse of pre-1990s statistics that still beats a histogram for small (n ≲ 100) datasets.`;
}
function interpWindRose({ x, group }) {
  return `Polar histogram of **${x}** ${group ? 'stacked by **' + group + '**' : ''}. Each radial sector = one category of ${x}; stack height = total count. Originally used for meteorological wind data; now broadly applied to any directional / cyclical variable (hour-of-day defects, compass bearings, periodic process signals).`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Conyso Originals — built because no existing chart kind does it well
// ═══════════════════════════════════════════════════════════════════════

// ─── Distribution Showdown ───
function cfgShowdown({ x, group }) {
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) continue;
    const g = r[group] == null ? '(missing)' : String(r[group]);
    if (!groups[g]) groups[g] = [];
    groups[g].push(v);
  }
  const keys = Object.keys(groups);
  if (keys.length !== 2) return emptyCard(`Showdown needs exactly 2 groups; found ${keys.length}.`);
  const [k1, k2] = keys;
  const v1 = groups[k1], v2 = groups[k2];
  // Stats
  const m1 = v1.reduce((a, b) => a + b, 0) / v1.length;
  const m2 = v2.reduce((a, b) => a + b, 0) / v2.length;
  const sd1 = stddev(v1), sd2 = stddev(v2);
  // 95% CI for mean
  const se1 = sd1 / Math.sqrt(v1.length), se2 = sd2 / Math.sqrt(v2.length);
  const ci1 = [m1 - 1.96 * se1, m1 + 1.96 * se1];
  const ci2 = [m2 - 1.96 * se2, m2 + 1.96 * se2];
  // Pooled sd → Cohen's d
  const pooled = Math.sqrt(((v1.length - 1) * sd1 * sd1 + (v2.length - 1) * sd2 * sd2) / (v1.length + v2.length - 2));
  const d = pooled > 0 ? (m2 - m1) / pooled : 0;
  const effect = Math.abs(d) < 0.2 ? 'negligible'
              : Math.abs(d) < 0.5 ? 'small'
              : Math.abs(d) < 0.8 ? 'medium' : 'large';
  // Welch t-statistic and approximate p-value
  const t = (m2 - m1) / Math.sqrt(se1 * se1 + se2 * se2);
  // Approx p via normal cdf (close enough for showdown context)
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(t) / Math.sqrt(2))));
  // KDE band
  const all = v1.concat(v2);
  const mn = Math.min(...all), mx = Math.max(...all);
  const padRange = (mx - mn) * 0.12 || 1;
  const sd_all = stddev(all) || 1e-9;
  const bw = 1.06 * sd_all * Math.pow(all.length, -1 / 5);
  return renderInteractiveChart({
    kind: 'showdown',
    width: 800, height: 460, pad: { l: 60, r: 18, t: 80, b: 56 },
    xRange: [mn - padRange, mx + padRange], yRange: [0, 1.05],
    xLabel: x, yLabel: 'density (scaled)',
    points: [], brushable: true,
    showAxes: true,
    overlays: [{ id: 'verdict', label: `d=${d.toFixed(2)} · ${effect} · p≈${p.toFixed(4)}`, defaultOn: true,
      build: (g, { plot }) => {
        g.append(svg('text', { x: plot.x, y: plot.y - 56, 'font-size': 12,
          fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' },
          `Cohen's d = ${d.toFixed(2)} → ${effect.toUpperCase()} effect`));
        g.append(svg('text', { x: plot.x, y: plot.y - 38, 'font-size': 11,
          fill: 'var(--ink-2)' },
          `${k1}: μ ${fmtNum(m1)} [${fmtNum(ci1[0])}, ${fmtNum(ci1[1])}]   →   ${k2}: μ ${fmtNum(m2)} [${fmtNum(ci2[0])}, ${fmtNum(ci2[1])}]   ·   Welch t = ${t.toFixed(2)}, p ≈ ${p.toFixed(4)}`));
      },
    }],
    draw: (root, { xScale, yScale, plot }) => {
      // KDE for both groups; normalise each to max=1
      const N = 200;
      const xsK = [];
      for (let i = 0; i <= N; i++) xsK.push(mn - padRange + (mx - mn + 2 * padRange) * (i / N));
      const d1 = xsK.map(xv => kde1d(v1, xv, bw));
      const d2 = xsK.map(xv => kde1d(v2, xv, bw));
      const max1 = Math.max(...d1), max2 = Math.max(...d2);
      const colors = ['var(--accent)', '#6b5524'];
      // Group 1 fill + line
      const path1 = xsK.map((xv, i) => `${i ? 'L' : 'M'} ${xScale(xv)} ${yScale(d1[i] / max1)}`).join(' ');
      const path2 = xsK.map((xv, i) => `${i ? 'L' : 'M'} ${xScale(xv)} ${yScale(d2[i] / max2)}`).join(' ');
      const fill1 = path1 + ` L ${xScale(xsK[xsK.length - 1])} ${plot.y + plot.h} L ${xScale(xsK[0])} ${plot.y + plot.h} Z`;
      const fill2 = path2 + ` L ${xScale(xsK[xsK.length - 1])} ${plot.y + plot.h} L ${xScale(xsK[0])} ${plot.y + plot.h} Z`;
      root.append(svg('path', { d: fill1, fill: colors[0], opacity: 0.20 }));
      root.append(svg('path', { d: fill2, fill: colors[1], opacity: 0.20 }));
      root.append(svg('path', { d: path1, fill: 'none', stroke: colors[0], 'stroke-width': 1.8 }));
      root.append(svg('path', { d: path2, fill: 'none', stroke: colors[1], 'stroke-width': 1.8 }));
      // Mean lines + CI bars
      for (const [m, ci, color] of [[m1, ci1, colors[0]], [m2, ci2, colors[1]]]) {
        const x_ = xScale(m);
        root.append(svg('line', { x1: x_, x2: x_, y1: plot.y, y2: plot.y + plot.h,
          stroke: color, 'stroke-dasharray': '4 3', 'stroke-width': 1.2 }));
        const ciY = plot.y + plot.h - 6;
        root.append(svg('line', { x1: xScale(ci[0]), x2: xScale(ci[1]), y1: ciY, y2: ciY,
          stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
      }
      // Legend
      const legY = plot.y + 12;
      root.append(svg('rect', { x: plot.x + plot.w - 200, y: legY - 8,
        width: 12, height: 12, fill: colors[0] }));
      root.append(svg('text', { x: plot.x + plot.w - 184, y: legY + 2,
        'font-size': 11, fill: 'var(--ink-2)' }, `${k1}  (n=${v1.length})`));
      root.append(svg('rect', { x: plot.x + plot.w - 200, y: legY + 12,
        width: 12, height: 12, fill: colors[1] }));
      root.append(svg('text', { x: plot.x + plot.w - 184, y: legY + 22,
        'font-size': 11, fill: 'var(--ink-2)' }, `${k2}  (n=${v2.length})`));
    },
  });
}
// Error function approximation (Abramowitz & Stegun)
function erf(x) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// ═══════════════════════════════════════════════════════════════════════
//  Interpreters for Conyso Originals
// ═══════════════════════════════════════════════════════════════════════

function interpShowdown({ x, group }) {
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) continue;
    const g = r[group] == null ? '(missing)' : String(r[group]);
    (groups[g] = groups[g] || []).push(v);
  }
  const keys = Object.keys(groups);
  if (keys.length !== 2) return `Distribution Showdown needs exactly 2 groups (got ${keys.length}). Filter to two levels of ${group} first.`;
  const [k1, k2] = keys;
  const v1 = groups[k1], v2 = groups[k2];
  const m1 = v1.reduce((a, b) => a + b, 0) / v1.length;
  const m2 = v2.reduce((a, b) => a + b, 0) / v2.length;
  const sd1 = stddev(v1), sd2 = stddev(v2);
  const pooled = Math.sqrt(((v1.length - 1) * sd1 * sd1 + (v2.length - 1) * sd2 * sd2) / (v1.length + v2.length - 2));
  const d = pooled > 0 ? (m2 - m1) / pooled : 0;
  const effect = Math.abs(d) < 0.2 ? 'negligible — no operational difference' :
                 Math.abs(d) < 0.5 ? 'small — only worth shipping if the change is cheap' :
                 Math.abs(d) < 0.8 ? 'medium — likely meaningful' :
                                      'large — clear practical difference';
  return `**${k1}** (μ=${fmtNum(m1)}, σ=${fmtNum(sd1)}, n=${v1.length})  vs  **${k2}** (μ=${fmtNum(m2)}, σ=${fmtNum(sd2)}, n=${v2.length}). **Cohen's d = ${d.toFixed(2)}** → ${effect}. The overlay reveals whether the difference comes from a location shift (centres apart), a spread change (one wider than the other), or both. The horizontal CI bars at the bottom show the 95% confidence intervals for each mean — non-overlapping → significant.`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Generic Conyso Originals — built for any dataset, not just LSS.
//  LSS-specific originals (Variance Budget, Capability Trajectory, RPN
//  Heat Bubbles, Sigma Slippage, Cost-Weighted Pareto) live in Bench.
// ═══════════════════════════════════════════════════════════════════════

// ─── Cohort Triangle ───
// Cohort retention heatmap: rows = cohort period, cols = age. Cell value =
// active count / cohort size. Works whether `id` is supplied (unique members)
// or not (raw row counts).
function cfgCohortTri({ cohort, age, id }) {
  const recs = [];
  for (const r of state.rows) {
    const c = r[cohort] == null ? null : String(r[cohort]);
    const a = Math.round(Number(r[age]));
    if (c == null || !Number.isFinite(a) || a < 0) continue;
    recs.push({ c, a, id: id ? (r[id] == null ? '' : String(r[id])) : '' });
  }
  if (!recs.length) return emptyCard('No valid cohort × age rows.');
  const cohorts = {};
  for (const r of recs) {
    cohorts[r.c] = cohorts[r.c] || { ageSets: {}, size: id ? new Set() : 0 };
    cohorts[r.c].ageSets[r.a] = cohorts[r.c].ageSets[r.a] || (id ? new Set() : { n: 0 });
    if (id) {
      cohorts[r.c].ageSets[r.a].add(r.id);
      if (r.a === 0) cohorts[r.c].size.add(r.id);
    } else {
      cohorts[r.c].ageSets[r.a].n += 1;
    }
  }
  const cohortKeys = Object.keys(cohorts).sort();
  const ages = Array.from(new Set(recs.map(r => r.a))).sort((a, b) => a - b);
  for (const k of cohortKeys) {
    if (!id) {
      const a0 = cohorts[k].ageSets[0];
      cohorts[k]._size = (a0 ? a0.n : Math.max(...Object.values(cohorts[k].ageSets).map(s => s.n))) || 1;
    } else {
      cohorts[k]._size = cohorts[k].size.size || 1;
    }
  }
  const W = 880, H = 60 + cohortKeys.length * 28, pad = { l: 130, r: 30, t: 50, b: 40 };
  const cellW = (W - pad.l - pad.r) / Math.max(1, ages.length);
  const cellH = 26;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  root.append(svg('text', { x: pad.l, y: 22, 'font-size': 12,
    fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' },
    `Cohort retention: ${cohortKeys.length} cohorts × ${ages.length} age periods`));
  ages.forEach((a, i) => {
    const x = pad.l + i * cellW + cellW / 2;
    root.append(svg('text', { x, y: pad.t - 6, 'font-size': 10,
      'text-anchor': 'middle', fill: 'var(--muted)' }, `t+${a}`));
  });
  cohortKeys.forEach((k, j) => {
    const y = pad.t + j * cellH;
    root.append(svg('text', { x: pad.l - 10, y: y + cellH / 2 + 4, 'font-size': 11,
      'text-anchor': 'end', fill: 'var(--ink-2)' }, k));
    const size = cohorts[k]._size;
    ages.forEach((a, i) => {
      const cell = cohorts[k].ageSets[a];
      if (!cell) return;
      const n = id ? cell.size : cell.n;
      const pct = n / size;
      const x = pad.l + i * cellW;
      const intensity = Math.min(1, pct);
      const fill = `rgba(197, 165, 114, ${0.10 + 0.85 * intensity})`;
      const rect = svg('rect', { x, y, width: cellW - 1, height: cellH - 1, fill });
      rect.append(svg('title', {}, `${k} · t+${a} · ${(pct * 100).toFixed(1)}%  (n=${n}/${size})`));
      root.append(rect);
      if (cellW > 28) {
        root.append(svg('text', { x: x + cellW / 2, y: y + cellH / 2 + 4, 'font-size': 9,
          'text-anchor': 'middle', fill: pct > 0.5 ? 'var(--bg)' : 'var(--ink-2)' },
          `${(pct * 100).toFixed(0)}%`));
      }
    });
  });
  return wrapStaticChart(root, 'cohorttri', cohort, age);
}

// ─── Annotated Time Series ───
// Line chart with sparse event markers + auto-detected outlier callouts
// (residual after rolling median > 3·MAD).
function cfgAnnoSeries({ y, t, event }) {
  const points = [];
  for (let i = 0; i < state.rows.length; i++) {
    const r = state.rows[i];
    const v = Number(r[y]);
    if (!Number.isFinite(v)) continue;
    const tx = t ? Number(r[t]) : i;
    points.push({ x: Number.isFinite(tx) ? tx : i, y: v,
      ev: event ? (r[event] == null ? '' : String(r[event])) : '', i });
  }
  if (points.length < 6) return emptyCard('Need ≥ 6 numeric points.');
  points.sort((a, b) => a.x - b.x);
  const wsize = Math.min(11, Math.max(5, Math.floor(points.length / 6) | 1));
  const half = Math.floor(wsize / 2);
  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]); };
  const resid = points.map((p, i) => {
    const win = points.slice(Math.max(0, i - half), Math.min(points.length, i + half + 1)).map(q => q.y);
    return p.y - median(win);
  });
  const mad = median(resid.map(Math.abs)) || 1e-9;
  const outliers = points.map((p, i) => ({ p, r: resid[i] / (1.4826 * mad) }))
    .filter(o => Math.abs(o.r) > 3);
  const events = points.filter(p => p.ev);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const padY = (yMax - yMin) * 0.1 || 1;
  return renderInteractiveChart({
    kind: 'annoseries',
    width: 880, height: 420, pad: { l: 60, r: 18, t: 40, b: 48 },
    xRange: [xMin, xMax], yRange: [yMin - padY, yMax + padY],
    xLabel: t || 'row order', yLabel: y,
    points: points.map(p => ({ x: p.x, y: p.y, label: `${y}=${fmtNum(p.y)}`, meta: { event: p.ev || '—' } })),
    brushable: true,
    overlays: [
      { id: 'events', label: `Events (${events.length})`, defaultOn: true,
        build: (g, { xScale, plot }) => {
          for (const e of events) {
            const x = xScale(e.x);
            g.append(svg('line', { x1: x, x2: x, y1: plot.y, y2: plot.y + plot.h,
              stroke: '#6b5524', 'stroke-dasharray': '4 3', 'stroke-width': 1 }));
            g.append(svg('text', { x: x + 3, y: plot.y + 12, 'font-size': 10,
              fill: '#6b5524', 'font-style': 'italic' },
              e.ev.length > 16 ? e.ev.slice(0, 16) + '…' : e.ev));
          }
        },
      },
      { id: 'outliers', label: `Outliers (${outliers.length})`, defaultOn: true,
        build: (g, { xScale, yScale }) => {
          for (const o of outliers) {
            g.append(svg('circle', { cx: xScale(o.p.x), cy: yScale(o.p.y), r: 6,
              fill: 'none', stroke: 'var(--danger)', 'stroke-width': 1.5 }));
          }
        },
      },
    ],
    draw: (root, { xScale, yScale }) => {
      const d = points.map((p, i) => `${i ? 'L' : 'M'} ${xScale(p.x)} ${yScale(p.y)}`).join(' ');
      root.append(svg('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8 }));
      for (const p of points) {
        root.append(svg('circle', { cx: xScale(p.x), cy: yScale(p.y), r: 2.2, fill: 'var(--accent)' }));
      }
    },
  });
}

// ─── Outlier Spotlight ───
// Histogram + a 1-D dotstrip beneath highlighting IQR-fenced outliers, plus
// labels on the most extreme.
function cfgOutlierSpot({ x, label }) {
  const recs = [];
  for (const r of state.rows) {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) continue;
    recs.push({ v, l: label ? (r[label] == null ? '' : String(r[label])) : '' });
  }
  if (recs.length < 8) return emptyCard('Need ≥ 8 numeric observations.');
  const vals = recs.map(r => r.v).sort((a, b) => a - b);
  const q = (p) => {
    const i = (vals.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return vals[lo] + (vals[hi] - vals[lo]) * (i - lo);
  };
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  const lof = q1 - 1.5 * iqr, hif = q3 + 1.5 * iqr;
  const outliers = recs.filter(r => r.v < lof || r.v > hif);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const padR = (mx - mn) * 0.05 || 1;
  return renderInteractiveChart({
    kind: 'outlierspot',
    width: 800, height: 460, pad: { l: 60, r: 18, t: 60, b: 80 },
    xRange: [mn - padR, mx + padR], yRange: [0, 1.05],
    xLabel: x, yLabel: 'count (normalised)',
    points: [], brushable: true,
    overlays: [
      { id: 'fences', label: `IQR fences · ${outliers.length} outlier(s)`, defaultOn: true,
        build: (g, { xScale, plot }) => {
          for (const [v, lbl] of [[lof, '−1.5·IQR'], [hif, '+1.5·IQR']]) {
            g.append(svg('line', { x1: xScale(v), x2: xScale(v), y1: plot.y, y2: plot.y + plot.h,
              stroke: 'var(--danger)', 'stroke-dasharray': '3 3', 'stroke-width': 1 }));
            g.append(svg('text', { x: xScale(v) + 4, y: plot.y + 10, 'font-size': 10,
              fill: 'var(--danger)', 'font-style': 'italic' }, lbl));
          }
        },
      },
    ],
    draw: (root, { xScale, yScale, plot }) => {
      const bins = Math.min(40, Math.max(8, Math.ceil(Math.sqrt(vals.length))));
      const w = (mx - mn) / bins || 1;
      const counts = new Array(bins).fill(0);
      for (const v of vals) {
        const i = Math.min(bins - 1, Math.max(0, Math.floor((v - mn) / w)));
        counts[i]++;
      }
      const maxC = Math.max(...counts);
      const bandH = plot.h * 0.7;
      const bandY = plot.y;
      for (let i = 0; i < bins; i++) {
        const x0 = xScale(mn + i * w), x1 = xScale(mn + (i + 1) * w);
        const hh = (counts[i] / maxC) * bandH;
        root.append(svg('rect', { x: x0, y: bandY + bandH - hh, width: Math.max(1, x1 - x0 - 0.5),
          height: hh, fill: 'var(--accent)', opacity: 0.5 }));
      }
      const stripY = plot.y + plot.h - 28;
      root.append(svg('line', { x1: plot.x, x2: plot.x + plot.w, y1: stripY, y2: stripY,
        stroke: 'var(--line)' }));
      for (const r of recs) {
        const isOut = r.v < lof || r.v > hif;
        const c = svg('circle', { cx: xScale(r.v), cy: stripY,
          r: isOut ? 4.5 : 2.5, fill: isOut ? 'var(--danger)' : 'var(--ink-2)', opacity: 0.75 });
        c.append(svg('title', {}, r.l ? `${r.l}: ${fmtNum(r.v)}${isOut ? ' (outlier)' : ''}` : fmtNum(r.v)));
        root.append(c);
      }
      const top = outliers.map(o => ({ ...o, d: Math.max(lof - o.v, o.v - hif) }))
        .sort((a, b) => b.d - a.d).slice(0, 5);
      top.forEach((o, i) => {
        const x = xScale(o.v);
        root.append(svg('text', { x, y: stripY + 18 + i * 12, 'font-size': 10,
          'text-anchor': 'middle', fill: 'var(--danger)' },
          o.l ? `${o.l} (${fmtNum(o.v)})` : fmtNum(o.v)));
      });
    },
  });
}

// ─── Comparison Quartet ───
// 2×2 small-multiples: KDE overlay, ECDF, boxplots, Q-Q.
function cfgQuartet({ x, group }) {
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) continue;
    const g = r[group] == null ? '(missing)' : String(r[group]);
    (groups[g] = groups[g] || []).push(v);
  }
  const keys = Object.keys(groups);
  if (keys.length !== 2) return emptyCard(`Quartet needs exactly 2 groups; found ${keys.length}.`);
  const [k1, k2] = keys;
  const v1 = groups[k1].slice().sort((a, b) => a - b);
  const v2 = groups[k2].slice().sort((a, b) => a - b);
  const all = v1.concat(v2);
  const mn = Math.min(...all), mx = Math.max(...all);
  const padR = (mx - mn) * 0.1 || 1;
  const sdAll = stddev(all) || 1e-9;
  const bw = 1.06 * sdAll * Math.pow(all.length, -1 / 5);
  const W = 900, H = 600;
  const cols = ['var(--accent)', '#6b5524'];
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  const pane = (gx, gy, gw, gh, title, draw) => {
    root.append(svg('text', { x: gx + 8, y: gy + 14, 'font-size': 11,
      fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' }, title));
    root.append(svg('rect', { x: gx + 6, y: gy + 22, width: gw - 12, height: gh - 28,
      fill: 'none', stroke: 'var(--line)' }));
    draw({ x: gx + 16, y: gy + 28, w: gw - 32, h: gh - 44 });
  };
  pane(0, 0, W / 2, H / 2, `Density overlay — ${k1} vs ${k2}`, ({ x, y, w, h }) => {
    const N = 100;
    const xs = []; for (let i = 0; i <= N; i++) xs.push(mn - padR + (mx - mn + 2 * padR) * (i / N));
    const d1 = xs.map(v => kde1d(v1, v, bw));
    const d2 = xs.map(v => kde1d(v2, v, bw));
    const m1 = Math.max(...d1), m2 = Math.max(...d2);
    const xS = (v) => x + ((v - (mn - padR)) / ((mx + padR) - (mn - padR))) * w;
    const yS = (v) => y + h - v * h;
    root.append(svg('path', { d: xs.map((v, i) => `${i ? 'L' : 'M'} ${xS(v)} ${yS(d1[i] / m1)}`).join(' '),
      fill: cols[0], opacity: 0.18, stroke: cols[0], 'stroke-width': 1.5 }));
    root.append(svg('path', { d: xs.map((v, i) => `${i ? 'L' : 'M'} ${xS(v)} ${yS(d2[i] / m2)}`).join(' '),
      fill: cols[1], opacity: 0.18, stroke: cols[1], 'stroke-width': 1.5 }));
  });
  pane(W / 2, 0, W / 2, H / 2, 'Empirical CDF', ({ x, y, w, h }) => {
    const xS = (v) => x + ((v - mn) / ((mx - mn) || 1)) * w;
    const yS = (p) => y + h - p * h;
    for (const [arr, color] of [[v1, cols[0]], [v2, cols[1]]]) {
      const pts = arr.map((v, i) => `${i ? 'L' : 'M'} ${xS(v)} ${yS((i + 1) / arr.length)}`).join(' ');
      root.append(svg('path', { d: pts, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
    }
    root.append(svg('line', { x1: x, x2: x + w, y1: y + h / 2, y2: y + h / 2,
      stroke: 'var(--muted)', 'stroke-dasharray': '3 3', 'stroke-width': 0.5 }));
  });
  pane(0, H / 2, W / 2, H / 2, 'Boxplots', ({ x, y, w, h }) => {
    const q = (arr, p) => { const i = (arr.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i);
      return arr[lo] + (arr[hi] - arr[lo]) * (i - lo); };
    const yS = (v) => y + h - ((v - mn) / ((mx - mn) || 1)) * h;
    [v1, v2].forEach((arr, idx) => {
      const cx = x + (idx + 0.5) * (w / 2);
      const q1 = q(arr, 0.25), q2 = q(arr, 0.5), q3 = q(arr, 0.75);
      root.append(svg('rect', { x: cx - 24, y: yS(q3), width: 48, height: yS(q1) - yS(q3),
        fill: cols[idx], opacity: 0.25, stroke: cols[idx] }));
      root.append(svg('line', { x1: cx - 24, x2: cx + 24, y1: yS(q2), y2: yS(q2),
        stroke: cols[idx], 'stroke-width': 2 }));
      root.append(svg('line', { x1: cx, x2: cx, y1: yS(arr[0]), y2: yS(arr[arr.length - 1]),
        stroke: cols[idx], 'stroke-width': 1 }));
      root.append(svg('text', { x: cx, y: y + h + 14, 'font-size': 11,
        'text-anchor': 'middle', fill: 'var(--ink-2)' }, idx === 0 ? k1 : k2));
    });
  });
  pane(W / 2, H / 2, W / 2, H / 2, 'Q-Q plot', ({ x, y, w, h }) => {
    const n = Math.min(v1.length, v2.length);
    const q1q = []; const q2q = [];
    for (let i = 0; i < n; i++) {
      const p = (i + 0.5) / n;
      const i1 = Math.min(v1.length - 1, Math.floor(p * v1.length));
      const i2 = Math.min(v2.length - 1, Math.floor(p * v2.length));
      q1q.push(v1[i1]); q2q.push(v2[i2]);
    }
    const xS = (v) => x + ((v - mn) / ((mx - mn) || 1)) * w;
    const yS = (v) => y + h - ((v - mn) / ((mx - mn) || 1)) * h;
    root.append(svg('line', { x1: xS(mn), x2: xS(mx), y1: yS(mn), y2: yS(mx),
      stroke: 'var(--muted)', 'stroke-dasharray': '3 3' }));
    for (let i = 0; i < n; i++) {
      root.append(svg('circle', { cx: xS(q1q[i]), cy: yS(q2q[i]), r: 2.5,
        fill: 'var(--accent)', opacity: 0.7 }));
    }
    root.append(svg('text', { x: x + w - 4, y: y + h - 4, 'font-size': 10,
      'text-anchor': 'end', fill: 'var(--muted)' }, `x = ${k1} quantile, y = ${k2}`));
  });
  return wrapStaticChart(root, 'quartet', x, group);
}

// ─── Distribution Drift (Ridge plot) ───
function cfgDrift({ x, period }) {
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) continue;
    const p = r[period] == null ? '(missing)' : String(r[period]);
    (groups[p] = groups[p] || []).push(v);
  }
  const keys = Object.keys(groups).sort();
  if (keys.length < 2) return emptyCard('Need ≥ 2 periods.');
  const all = [].concat(...Object.values(groups));
  const mn = Math.min(...all), mx = Math.max(...all);
  const padR = (mx - mn) * 0.05 || 1;
  const sdAll = stddev(all) || 1e-9;
  const bw = 1.06 * sdAll * Math.pow(all.length, -1 / 5);
  const W = 820, H = 80 + keys.length * 70, pad = { l: 120, r: 30, t: 30, b: 50 };
  const plotW = W - pad.l - pad.r, rowH = (H - pad.t - pad.b) / keys.length;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, class: 'lens-svg' });
  root.append(svg('text', { x: pad.l, y: 20, 'font-size': 12,
    fill: 'var(--accent)', 'font-family': 'var(--font-display)', 'font-style': 'italic' },
    `Distribution drift of ${x} across ${keys.length} periods of ${period}`));
  const N = 120;
  const xs = []; for (let i = 0; i <= N; i++) xs.push(mn - padR + (mx - mn + 2 * padR) * (i / N));
  const xS = (v) => pad.l + ((v - (mn - padR)) / ((mx + padR) - (mn - padR))) * plotW;
  keys.forEach((k, j) => {
    const arr = groups[k];
    const dens = xs.map(v => kde1d(arr, v, bw));
    const mxD = Math.max(...dens) || 1;
    const y0 = pad.t + (j + 1) * rowH;
    const ridgeH = rowH * 0.85;
    root.append(svg('text', { x: pad.l - 10, y: y0 - ridgeH / 2 + 4, 'font-size': 11,
      'text-anchor': 'end', fill: 'var(--ink-2)' }, k));
    root.append(svg('text', { x: pad.l - 10, y: y0 - ridgeH / 2 + 18, 'font-size': 9,
      'text-anchor': 'end', fill: 'var(--muted)' }, `n=${arr.length}`));
    const d = xs.map((v, i) => {
      const yy = y0 - (dens[i] / mxD) * ridgeH;
      return `${i ? 'L' : 'M'} ${xS(v)} ${yy}`;
    }).join(' ') + ` L ${xS(xs[xs.length - 1])} ${y0} L ${xS(xs[0])} ${y0} Z`;
    root.append(svg('path', { d, fill: 'var(--accent)', opacity: 0.35,
      stroke: 'var(--accent)', 'stroke-width': 1.2 }));
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    root.append(svg('line', { x1: xS(m), x2: xS(m), y1: y0, y2: y0 - ridgeH,
      stroke: '#6b5524', 'stroke-dasharray': '2 2', 'stroke-width': 1 }));
  });
  for (const t of niceTicks(mn, mx, 6)) {
    root.append(svg('text', { x: xS(t), y: H - pad.b + 14, 'font-size': 10,
      'text-anchor': 'middle', fill: 'var(--muted)' }, fmtNum(t)));
  }
  return wrapStaticChart(root, 'drift', x, period);
}

// ───── Interpreters for generic Originals ─────

function interpCohortTri({ cohort, age, id }) {
  return `Cohort retention heatmap. Rows = each starting **${cohort}** cohort, columns = **${age}** periods since start. Cell colour = % of the original cohort still observed at that age${id ? ` (unique by **${id}**)` : ' (raw row count)'}. Read down a column to see whether retention is improving cohort-over-cohort. Read across a row to see how that cohort decays.`;
}
function interpAnnoSeries({ y, t, event }) {
  return `Time series of **${y}**${t ? ` over **${t}**` : ' in row order'}. Auto-detection runs a rolling-median residual + MAD on the series; points where |residual| > 3·MAD are circled. ${event ? `Vertical guides mark rows with a non-empty **${event}** label — useful for "did this deploy / launch / incident change the level?".` : 'Add an event column to overlay deploy / launch markers.'}`;
}
function interpOutlierSpot({ x }) {
  return `Histogram of **${x}** plus a dot-strip beneath. The IQR fences (1.5·IQR outside Q1/Q3 — the same rule a boxplot uses) are shown as red dashed lines; outliers are the larger red dots. Labels show the top-5 most extreme. **Action**: investigate each outlier individually — is it a data-entry error, a real edge case, or a sign the process changed?`;
}
function interpQuartet({ x, group }) {
  return `Four lenses on **${x}** by **${group}**. **Density overlay** highlights whether shapes differ. **ECDF** is the cleanest test for any distributional shift (rank-based, robust). **Boxplots** make medians and IQR comparable at a glance. **Q-Q** reveals where in the tail the two groups diverge — a straight line means same shape, just shifted. Pick the lens that tells the cleanest story for your audience.`;
}
function interpDrift({ x, period }) {
  const groups = {};
  for (const r of state.rows) {
    const v = Number(r[x]);
    if (!Number.isFinite(v)) continue;
    const p = r[period] == null ? '(missing)' : String(r[period]);
    (groups[p] = groups[p] || []).push(v);
  }
  const keys = Object.keys(groups).sort();
  if (keys.length < 2) return '';
  const means = keys.map(k => groups[k].reduce((a, b) => a + b, 0) / groups[k].length);
  const trend = means[means.length - 1] - means[0];
  const dir = Math.abs(trend) < 0.05 * (Math.max(...means) - Math.min(...means)) ? 'flat'
            : trend > 0 ? 'rising' : 'falling';
  return `Ridge plot — each period's distribution of **${x}**, stacked top-to-bottom by **${period}**. Mean drift across the ${keys.length} periods is **${dir}** (Δ = ${fmtNum(trend)}). Ridges that change *shape* (not just location) are the interesting ones: those signal a new regime, not just a level shift.`;
}

// ═══════════════════════════════════════════════════════════════════════
//  UI
// ═══════════════════════════════════════════════════════════════════════

function render() {
  const app = $('#app'); app.innerHTML = '';
  app.append(renderHeader(), h('main', { className: 'lens-main' }, renderSidebar(), renderStudio()));
}

function renderHeader() {
  const themeBtn = h('button', { className: 'lens-theme-btn', title: 'Toggle theme' },
    state.theme === 'dark' ? '◐' : '◑');
  themeBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('bench-theme', state.theme);
  });
  return h('header', { className: 'lens-header' },
    h('a', { className: 'lens-brand', href: '/lens' },
      h('span', { className: 'lens-mark' },
        // Mini chart-mark: ascending hairline strokes — matches Bench's brand mark style.
        h('svg', { viewBox: '0 0 28 28', width: 24, height: 24 },
          svg('line', { x1: 4, y1: 22, x2: 4, y2: 17, stroke: 'var(--accent)', 'stroke-width': 2 }),
          svg('line', { x1: 10, y1: 22, x2: 10, y2: 11, stroke: 'var(--accent)', 'stroke-width': 2 }),
          svg('line', { x1: 16, y1: 22, x2: 16, y2: 7, stroke: 'var(--accent)', 'stroke-width': 2 }),
          svg('line', { x1: 22, y1: 22, x2: 22, y2: 13, stroke: 'var(--accent)', 'stroke-width': 2 }),
          svg('line', { x1: 2, y1: 24, x2: 26, y2: 24, stroke: 'var(--ink)', 'stroke-width': 1 }),
        )),
      h('div', {},
        h('div', { className: 'lens-brand-name' },
          'Conyso ', h('em', {}, 'Lens')),
        h('div', { className: 'lens-brand-sub' }, '85 chart kinds · interpretation · export'),
      ),
    ),
    h('span', { style: 'flex:1' }),
    h('a', { className: 'lens-header-link', href: '/' }, '← Bench'),
    h('a', { className: 'lens-header-link', href: 'https://conyso.com' }, 'conyso.com'),
    themeBtn,
  );
}

function renderSidebar() {
  const nav = h('aside', { className: 'lens-sidebar', 'data-keep-scroll': 'lens-sidebar' });
  // Dataset selector
  nav.append(h('div', { className: 'lens-section' }));
  nav.append(h('div', { className: 'lens-group-label' }, 'Dataset'));
  if (!state.datasets.length) {
    nav.append(h('div', { className: 'muted', style: 'padding:10px 12px;font-size:12px;line-height:1.5' },
      'No datasets yet. Upload one in ',
      h('a', { href: '/', style: 'color:var(--accent)' }, 'Bench'),
      ' — it appears here automatically.'));
  } else {
    const sel = h('select', { className: 'lens-ds-select' });
    for (const d of state.datasets) sel.append(h('option', { value: d.id }, `${d.name} · ${d.row_count} rows`));
    if (state.current) sel.value = state.current.id;
    sel.addEventListener('change', () => {
      const d = state.datasets.find(x => x.id === sel.value);
      selectDataset(d);
    });
    nav.append(sel);
    if (state.current) {
      const schema = state.current.schema_json || [];
      const nums = schema.filter(c => c.type === 'number').length;
      const cats = schema.filter(c => c.type !== 'number').length;
      nav.append(h('div', { className: 'lens-ds-stats' },
        h('div', {}, h('strong', {}, schema.length), ' columns'),
        h('div', { className: 'muted', style: 'font-size:11px' },
          `${nums} numeric · ${cats} categorical`),
      ));
    }
  }

  nav.append(h('div', { className: 'lens-group-label', style: 'margin-top:24px' }, 'Charts'));
  const grouped = {};
  for (const c of CHARTS) (grouped[c.category] = grouped[c.category] || []).push(c);
  for (const [cat, list] of Object.entries(grouped)) {
    nav.append(h('div', { className: 'lens-cat-label' }, cat));
    const ul = h('ul', { className: 'lens-chart-list' });
    for (const c of list) {
      const li = h('li', {
        className: state.selectedChart === c.id ? 'active' : '',
        onclick: () => { state.selectedChart = c.id; state.config = {}; render(); },
      },
        h('span', { className: 'lens-chart-name' }, c.label),
      );
      ul.append(li);
    }
    nav.append(ul);
  }
  return nav;
}

function renderStudio() {
  const main = h('section', { className: 'lens-studio' });
  if (!state.current) {
    main.append(h('div', { className: 'lens-empty' },
      h('h1', {}, 'Visual exploration, ',
        h('em', {}, 'made for engineers')),
      h('p', { className: 'muted' },
        '26 chart types across distribution, relationship, time, categorical, multi-variate, and LSS. ' +
        'Every chart has hover crosshairs, brush-to-zoom, click-to-annotate, and SVG/PNG export. ' +
        'Plain-English interpretation under every chart, anchored to published thresholds.'),
      h('p', { className: 'muted', style: 'margin-top:20px' },
        'Pick a dataset on the left to start.'),
    ));
    return main;
  }
  const c = CHARTS_BY_ID[state.selectedChart];
  main.append(h('div', { className: 'lens-title' },
    h('div', { className: 'lens-title-eyebrow' }, c.category),
    h('h1', {}, c.label),
    h('p', {}, c.desc),
  ));

  // Config strip
  if (c.inputs.length) {
    const cfg = h('div', { className: 'lens-config' });
    for (const input of c.inputs) cfg.append(renderInputControl(input));
    main.append(cfg);
  }

  if (!state.rows) {
    main.append(h('div', { className: 'muted', style: 'padding:30px;text-align:center;font-style:italic' }, 'Loading…'));
    return main;
  }
  const ready = c.inputs.filter(i => i.required).every(i => state.config[i.key]);
  if (!ready && c.inputs.length) {
    main.append(h('div', { className: 'muted', style: 'padding:24px 0;font-style:italic' },
      'Pick the inputs above to render.'));
    return main;
  }
  try {
    const el = c.build(state.config);
    main.append(el);
    const interp = c.interpret(state.config);
    main.append(h('div', { className: 'lens-interp' },
      h('div', { className: 'lens-interp-label' }, 'What this shows'),
      h('div', { className: 'lens-interp-body',
        innerHTML: escapeHtml(interp).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }),
    ));
  } catch (e) {
    main.append(h('div', { className: 'muted', style: 'padding:18px' }, 'Could not render: ' + e.message));
  }
  return main;
}

function renderInputControl(input) {
  const row = h('div', { className: 'lens-input-row' });
  row.append(h('label', { className: 'lens-input-label' }, input.label,
    input.required ? h('span', { className: 'lens-req' }, ' *') : null));
  const schema = state.current?.schema_json || [];
  if (input.kind === 'integer' || input.kind === 'number') {
    const inp = h('input', { type: 'number',
      value: state.config[input.key] ?? (input.default ?? ''),
      placeholder: input.kind === 'integer' ? '1' : '' });
    inp.addEventListener('input', () => {
      state.config[input.key] = inp.value;
      // Re-render only the studio so config keeps focus.
      const oldStudio = document.querySelector('.lens-studio');
      const newStudio = renderStudio();
      if (oldStudio && oldStudio.parentNode) oldStudio.parentNode.replaceChild(newStudio, oldStudio);
    });
    row.append(inp);
  } else {
    const sel = h('select');
    if (!input.required) sel.append(h('option', { value: '' }, '— none —'));
    const cols = schema.filter(c =>
      input.kind === 'numeric' ? c.type === 'number'
      : input.kind === 'categorical' ? c.type !== 'number'
      : true,
    );
    for (const c of cols) sel.append(h('option', { value: c.name }, c.name));
    if (state.config[input.key]) sel.value = state.config[input.key];
    sel.addEventListener('change', () => {
      state.config[input.key] = sel.value;
      render();
    });
    row.append(sel);
  }
  return row;
}

// ─── Data loading ───
async function refresh() {
  try {
    const r = await api.get('/api/datasets');
    state.datasets = r.datasets || [];
    if (state.current) {
      const updated = state.datasets.find(d => d.id === state.current.id);
      if (updated) state.current = updated;
    }
    render();
  } catch {}
}

async function selectDataset(d) {
  state.current = d;
  state.rows = null; state.config = {};
  render();
  try {
    const r = await api.get(`/api/datasets/${d.id}/rows?limit=5000`);
    state.rows = r.rows; state.rowsTotal = r.n_total;
    render();
  } catch {
    state.rows = []; render();
  }
}

// ─── Boot ───
async function boot() {
  state.wid = localStorage.getItem('workspace_id');
  if (!state.wid) {
    const r = await fetch('/api/workspaces', { method: 'POST' }).then(x => x.json());
    state.wid = r.workspace.id;
    localStorage.setItem('workspace_id', state.wid);
  }
  document.documentElement.setAttribute('data-theme', state.theme);
  await refresh();
  if (state.datasets.length && !state.current) await selectDataset(state.datasets[0]);
}
boot();
