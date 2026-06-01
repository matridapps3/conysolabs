// Tiny HTTP client for the Python sidecar. The sidecar holds all the
// stats math + chart generation; this Node side is just glue.

const base = process.env.SIDECAR_URL || 'http://localhost:8000';

// Default 60s timeout — long enough for the slowest sidecar analysis (DOE
// fits, large reliability runs) but short enough that a hung sidecar surfaces
// as a clean 504 instead of a hung Node request that Railway will eventually
// kill anyway. Override via SIDECAR_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.SIDECAR_TIMEOUT_MS) || 60_000;

export async function call(path, body) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw Object.assign(new Error(`sidecar ${path} timed out after ${TIMEOUT_MS}ms`),
        { status: 504, code: 'sidecar_timeout' });
    }
    // Network / DNS / ECONNREFUSED — sidecar is down or unreachable.
    throw Object.assign(new Error(`sidecar ${path} unreachable: ${e.message}`),
      { status: 502, code: 'sidecar_unreachable' });
  }
  clearTimeout(timer);
  if (!r.ok) {
    // Try JSON first (FastAPI default), then raw text (HTML stack traces from
    // an unexpected 500). Log the raw text on parse failure so we don't lose
    // debugging context — the previous `catch {}` swallowed it silently.
    let detail = '';
    const cloneForFallback = r.clone();
    try {
      const j = await r.json();
      let d = j.detail ?? j.error ?? j;
      // FastAPI 422 validation errors arrive as an array of objects; a plain
      // String() would render "[object Object]". Flatten to a readable message
      // (e.g. "body.column: field required") so the user sees something useful.
      if (Array.isArray(d)) {
        d = d.map(e => {
          const loc = Array.isArray(e.loc) ? e.loc.filter(x => x !== 'body').join('.') : '';
          return loc ? `${loc}: ${e.msg}` : (e.msg || JSON.stringify(e));
        }).join('; ');
      } else if (d && typeof d === 'object') {
        d = JSON.stringify(d).slice(0, 200);
      }
      detail = d || `${r.status} ${r.statusText}`;
    } catch {
      try {
        const txt = await cloneForFallback.text();
        detail = txt.slice(0, 400);
        console.error(`[sidecar ${path} non-JSON ${r.status}]`, detail);
      } catch {}
    }
    throw Object.assign(new Error(`sidecar ${path} ${r.status}: ${detail}`),
      { status: r.status, sidecarStatus: r.status });
  }
  try {
    return await r.json();
  } catch (e) {
    throw Object.assign(new Error(`sidecar ${path} returned malformed JSON: ${e.message}`),
      { status: 502, code: 'sidecar_bad_response' });
  }
}

// GET variant for parameter-free endpoints (e.g. validation suites).
export async function callGet(path) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${base}${path}`, { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) throw Object.assign(new Error(`sidecar ${path} ${r.status}`), { status: r.status });
    return await r.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.status) throw e;
    throw Object.assign(new Error(`sidecar ${path} unreachable: ${e.message}`),
      { status: 502, code: 'sidecar_unreachable' });
  }
}

export const sidecar = {
  validationNist:       ()              => callGet('/validation/nist'),
  // Parsing
  parseExcel:           (k)             => call('/parse/excel',     { storage_key: k }),
  parseCsv:             (k)             => call('/parse/csv',       { storage_key: k }),
  parsePdf:             (k)             => call('/parse/pdf',       { storage_key: k }),
  parseText:            (text, name)    => call('/parse/text',      { text, name }),
  parseJsonData:        (data, name)    => call('/parse/json',      { data, name }),
  datasetRows:          (k, p={})       => call('/dataset/rows',    { rows_storage_key: k, ...p }),
  datasetPreview:       (k, n=20)       => call('/dataset/preview', { rows_storage_key: k, n }),
  materializeRows:      (rows)          => call('/materialize-rows', { rows }),
  // Wrangle
  outliers:             (k, p)          => call('/wrangle/outliers', { rows_storage_key: k, ...p }),
  // Stats
  capability:           (k, p)          => call('/stats/capability', { rows_storage_key: k, ...p }),
  hypothesis:           (k, p)          => call('/stats/hypothesis', { rows_storage_key: k, ...p }),
  controlChart:         (k, p)          => call('/stats/control_chart', { rows_storage_key: k, ...p }),
  regression:           (k, p)          => call('/stats/regression', { rows_storage_key: k, ...p }),
  msa:                  (k, p)          => call('/stats/msa', { rows_storage_key: k, ...p }),
  doe:                  (k, p)          => call('/stats/doe', { rows_storage_key: k, ...p }),
  pareto:               (k, p)          => call('/stats/pareto', { rows_storage_key: k, ...p }),
  dpmo:                 (p)             => call('/stats/dpmo', p),
  sampleSize:           (p)             => call('/stats/sample_size', p),
  predictiveCpk:        (k, p)          => call('/stats/predictive-cpk', { rows_storage_key: k, ...p }),
  distributionId:       (k, p)          => call('/stats/distribution-id', { rows_storage_key: k, ...p }),
  reliability:          (k, p)          => call('/stats/reliability', { rows_storage_key: k, ...p }),
  multivariate:         (k, p)          => call('/stats/multivariate', { rows_storage_key: k, ...p }),
  timeSeries:           (k, p)          => call('/stats/time_series', { rows_storage_key: k, ...p }),
  doeDesign:            (p)             => call('/stats/doe-design', p),
  responseSurface:      (k, p)          => call('/stats/response-surface', { rows_storage_key: k, ...p }),
  desirability:         (k, p)          => call('/stats/desirability', { rows_storage_key: k, ...p }),
  posthoc:              (k, p)          => call('/stats/posthoc', { rows_storage_key: k, ...p }),
  tolerance:            (k, p)          => call('/stats/tolerance', { rows_storage_key: k, ...p }),
  probability:          (p)             => call('/stats/probability', p),
  probabilityPlot:      (k, p)          => call('/stats/probability-plot', { rows_storage_key: k, ...p }),
  graph:                (k, p)          => call('/stats/graph', { rows_storage_key: k, ...p }),
  attributeCapability:  (k, p)          => call('/stats/attribute-capability', { rows_storage_key: k, ...p }),
  anom:                 (k, p)          => call('/stats/anom', { rows_storage_key: k, ...p }),
  sixpack:              (k, p)          => call('/stats/sixpack', { rows_storage_key: k, ...p }),
  acceptanceSampling:   (p)             => call('/stats/acceptance-sampling', p),
  randomData:           (p)             => call('/stats/random-data', p),
  // ─── New Bench-only analyses (no Minitab one-click equivalent) ───
  agreement:            (k, p)          => call('/stats/agreement',     { rows_storage_key: k, ...p }),
  bootstrap:            (k, p)          => call('/stats/bootstrap',     { rows_storage_key: k, ...p }),
  correlation:          (k, p)          => call('/stats/correlation',   { rows_storage_key: k, ...p }),
  gageLinearity:        (k, p)          => call('/stats/gage-linearity',{ rows_storage_key: k, ...p }),
  // In-app data wrangling (closes the "you can't edit data in Minitab" gap).
  wrangleTransform:     (k, op, params) => call('/wrangle/transform',   { rows_storage_key: k, op, params }),
  // ─── Leap-ahead batch ───
  survival:             (k, p)          => call('/stats/survival',                { rows_storage_key: k, ...p }),
  mixedEffects:         (k, p)          => call('/stats/mixed-effects',           { rows_storage_key: k, ...p }),
  costPareto:           (k, p)          => call('/stats/cost-weighted-pareto',    { rows_storage_key: k, ...p }),
  ternary:              (k, p)          => call('/stats/ternary-contour',         { rows_storage_key: k, ...p }),
  bootstrapEffect:      (k, p)          => call('/stats/bootstrap-effect-size',   { rows_storage_key: k, ...p }),
  variabilityGauge:     (k, p)          => call('/stats/variability-gauge',       { rows_storage_key: k, ...p }),
  // Cross-cutting helpers (no charts, pure logic — used by the result-card UI)
  preflight:            (k, kind, params) => call('/preflight',                   { rows_storage_key: k, kind, params }),
  narrative:            (kind, summary)   => call('/narrative',                   { kind, summary }),
  followups:            (kind, summary, request) => call('/followups',            { kind, summary, request: request || {} }),
  bayesian:             (k, p)            => call('/stats/bayesian',              { rows_storage_key: k, ...p }),
  doeAugment:           (p)               => call('/stats/doe-augment',           p),
  arlDesign:            (p)               => call('/stats/arl-design',            p),
  stressStrength:       (p)               => call('/stats/stress-strength',       p),
  discreteProbability:  (p)               => call('/stats/discrete-probability',  p),
  // ─── Parity-push batch ───
  powerCurve:           (p)               => call('/stats/power-curve',           p),
  doePower:             (p)               => call('/stats/doe-power',             p),
  // ─── DMAIC copilot ───
  recommend:            (p)               => call('/recommend',                   p),
  // ─── Simulation / DFSS ───
  monteCarlo:           (p)               => call('/stats/monte-carlo',           p),
  toleranceStack:       (p)               => call('/stats/tolerance-stack',       p),
  // ─── VOC / survey / originals ───
  survey:               (k, p)            => call('/stats/survey',                { rows_storage_key: k, ...p }),
  textPareto:           (k, p)            => call('/stats/text-pareto',           { rows_storage_key: k, ...p }),
  varianceBudget:       (k, p)            => call('/stats/variance-budget',       { rows_storage_key: k, ...p }),
  // ─── Transactional / Agile flow ───
  cycleTime:            (k, p)            => call('/stats/cycle-time',            { rows_storage_key: k, ...p }),
  deliveryForecast:     (k, p)            => call('/stats/delivery-forecast',     { rows_storage_key: k, ...p }),
  littlesLaw:           (p)               => call('/stats/littles-law',           p),
};
