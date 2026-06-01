// SPC math for the monitor — deterministic, dependency-free, no AI.
// Individuals & Moving-Range (I-MR) control limits + Nelson rule detection.
// Kept tiny and pure so it's trivially testable and the whole service stays
// a single self-contained Node process you can hand to anyone.

const D2_N2 = 1.128; // d2 constant for moving range of n=2

export function imrLimits(values) {
  const x = values.filter((v) => Number.isFinite(v));
  if (x.length < 2) throw new Error('need at least 2 values for control limits');
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  let mrSum = 0;
  for (let i = 1; i < x.length; i++) mrSum += Math.abs(x[i] - x[i - 1]);
  const mrBar = mrSum / (x.length - 1);
  const sigma = mrBar / D2_N2;
  return {
    mean, sigma, mrBar,
    ucl: mean + 3 * sigma,
    lcl: mean - 3 * sigma,
    zone: (k) => [mean - k * sigma, mean + k * sigma],
  };
}

// Detect out-of-control signals. Returns one entry per flagged index with the
// rule that fired. Rules: Nelson 1 (beyond 3σ) and Nelson 2 (9 in a row on one
// side) — the two that matter most for live alerting.
export function detectSignals(values) {
  const x = values.map(Number);
  const lim = imrLimits(x);
  const signals = [];
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) continue;
    if (x[i] > lim.ucl || x[i] < lim.lcl) {
      signals.push({ index: i, value: x[i], rule: 'beyond_3sigma',
        detail: `point ${x[i]} is outside the control limits [${lim.lcl.toFixed(3)}, ${lim.ucl.toFixed(3)}]` });
    }
  }
  // Rule 2: a run of 9 consecutive points on the same side of the centerline.
  let run = 0, side = 0;
  for (let i = 0; i < x.length; i++) {
    const s = x[i] > lim.mean ? 1 : x[i] < lim.mean ? -1 : 0;
    if (s !== 0 && s === side) { run++; } else { side = s; run = s === 0 ? 0 : 1; }
    if (run === 9) {
      signals.push({ index: i, value: x[i], rule: 'run_of_9',
        detail: `9 points in a row ${side > 0 ? 'above' : 'below'} the mean (${lim.mean.toFixed(3)}) — the process has shifted` });
    }
  }
  return { limits: { mean: lim.mean, ucl: lim.ucl, lcl: lim.lcl, sigma: lim.sigma }, signals };
}

// Minimal RFC-4180-ish CSV parser → array of row objects. Dependency-free.
export function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const split = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  };
  const header = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i].trim() : ''; });
    return row;
  });
}

// SSRF guard — same policy as the main Bench server.
export function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('invalid source URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http/https sources allowed');
  const host = u.hostname.toLowerCase();
  const blocked = host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local') ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' || host.startsWith('fd') || host.startsWith('fe80');
  if (blocked) throw new Error('private/loopback sources are not allowed');
  return u.toString();
}
