// Analyses — every run is a row. Synchronous (no queue). The Python
// sidecar handles all stats; this Node side dispatches by kind and
// persists the result.

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { sidecar } from '../lib/sidecar.js';
import { rowToJsonObj, audit } from '../lib/db.js';
import { computeProvenance } from '../lib/provenance.js';
import { renderDossier } from '../lib/dossier.js';

const router = Router();

function workspaceId(req) {
  return req.header('X-Workspace-Id') || req.body?.workspace_id || req.query.workspace_id;
}

router.get('/', (req, res) => {
  const w = workspaceId(req);
  if (!w) return res.status(400).json({ error: 'workspace_required' });
  const rows = req.app.locals.db.prepare(
    `SELECT * FROM analyses WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200`,
  ).all(w);
  res.json({ analyses: rows.map(r => rowToJsonObj(r, ['params_json', 'result_json'])) });
});

router.get('/:id', (req, res) => {
  const row = req.app.locals.db.prepare(`SELECT * FROM analyses WHERE id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ analysis: rowToJsonObj(row, ['params_json', 'result_json']) });
});

// Method dossier — HTML page suitable for print-to-PDF.
router.get('/:id/dossier', (req, res) => {
  const row = req.app.locals.db.prepare(`SELECT * FROM analyses WHERE id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const a = rowToJsonObj(row, ['params_json', 'result_json']);
  // Look up the dataset name for the dossier header.
  let datasetName = '';
  if (a.dataset_id) {
    const ds = req.app.locals.db.prepare(`SELECT name FROM datasets WHERE id = ?`).get(a.dataset_id);
    if (ds) datasetName = ds.name;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDossier(a, { datasetName }));
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare(`SELECT workspace_id, kind, locked FROM analyses WHERE id = ?`).get(req.params.id);
  if (row && row.locked) return res.status(409).json({ error: 'analysis_locked', detail: 'This analysis is locked. Unlock it before deleting.' });
  db.prepare(`DELETE FROM analyses WHERE id = ?`).run(req.params.id);
  if (row) try { audit(db, { workspace_id: row.workspace_id, entity_type: 'analysis', entity_id: req.params.id, action: 'deleted', detail: row.kind }); } catch {}
  res.json({ ok: true });
});

// Governance: lock / unlock an analysis. A locked analysis can't be re-run
// (refresh) or deleted — the verified record is frozen. Every toggle is audited.
router.post('/:id/lock', (req, res) => {
  const db = req.app.locals.db;
  const lock = req.body?.lock !== false;   // default true
  const row = db.prepare(`SELECT workspace_id, kind FROM analyses WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare(`UPDATE analyses SET locked = ?, locked_at = ${lock ? 'unixepoch()' : 'NULL'} WHERE id = ?`)
    .run(lock ? 1 : 0, req.params.id);
  try { audit(db, { workspace_id: row.workspace_id, entity_type: 'analysis', entity_id: req.params.id, action: lock ? 'locked' : 'unlocked', detail: row.kind }); } catch {}
  res.json({ ok: true, locked: lock });
});

// Shareable link: mint (or return existing) a public read-only token for an
// analysis. The token exposes ONLY this analysis's result — no workspace, no
// other data. Minting is workspace-scoped (privileged); viewing is public.
router.post('/:id/share', (req, res) => {
  const db = req.app.locals.db;
  const w = workspaceId(req);
  const row = db.prepare(`SELECT id, workspace_id, kind, share_token FROM analyses WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
  if (!row) return res.status(404).json({ error: 'not_found' });
  let token = row.share_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('base64url');
    db.prepare(`UPDATE analyses SET share_token = ? WHERE id = ?`).run(token, req.params.id);
    try { audit(db, { workspace_id: w, entity_type: 'analysis', entity_id: req.params.id, action: 'shared', detail: row.kind }); } catch {}
  }
  res.json({ token, url: `/share/${token}`, embed: `<iframe src="/share/${token}?embed=1" style="width:100%;height:560px;border:0"></iframe>` });
});

router.delete('/:id/share', (req, res) => {
  const db = req.app.locals.db;
  const w = workspaceId(req);
  const row = db.prepare(`SELECT id FROM analyses WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare(`UPDATE analyses SET share_token = NULL WHERE id = ?`).run(req.params.id);
  try { audit(db, { workspace_id: w, entity_type: 'analysis', entity_id: req.params.id, action: 'unshared' }); } catch {}
  res.json({ ok: true });
});

// Governance: the append-only audit trail for this workspace.
router.get('/audit/log', (req, res) => {
  const w = workspaceId(req);
  if (!w) return res.status(400).json({ error: 'workspace_required' });
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = req.app.locals.db.prepare(
    `SELECT id, entity_type, entity_id, action, detail, at FROM audit_log
       WHERE workspace_id = ? ORDER BY at DESC LIMIT ?`,
  ).all(w, limit);
  res.json({ entries: rows });
});

// Annotation — append to result_json.annotations (atomic via SQLite).
router.patch('/:id/annotation', (req, res) => {
  const note = (req.body?.note || '').toString();
  if (!note) return res.status(400).json({ error: 'note_required' });
  const row = req.app.locals.db.prepare(`SELECT result_json FROM analyses WHERE id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const result = JSON.parse(row.result_json || '{}');
  result.annotations = result.annotations || [];
  result.annotations.push({ note, at: Date.now(), point: req.body?.point ?? null });
  req.app.locals.db.prepare(`UPDATE analyses SET result_json = ? WHERE id = ?`)
    .run(JSON.stringify(result), req.params.id);
  res.json({ ok: true, annotations: result.annotations });
});

// Save as recipe — name + tags into result_json.recipe.
router.patch('/:id/recipe', (req, res) => {
  const name = (req.body?.name || '').toString().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'name_required' });
  const row = req.app.locals.db.prepare(`SELECT result_json FROM analyses WHERE id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const result = JSON.parse(row.result_json || '{}');
  result.recipe = { name, tags: req.body?.tags || [], saved_at: Date.now() };
  req.app.locals.db.prepare(`UPDATE analyses SET result_json = ? WHERE id = ?`)
    .run(JSON.stringify(result), req.params.id);
  res.json({ ok: true });
});

// List saved recipes — analyses that have a result_json.recipe object.
router.get('/recipes/list', (req, res) => {
  const w = workspaceId(req);
  if (!w) return res.status(400).json({ error: 'workspace_required' });
  const rows = req.app.locals.db.prepare(
    `SELECT id, kind, params_json, dataset_id, result_json, created_at
       FROM analyses WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).all(w);
  const recipes = [];
  for (const r of rows) {
    const result = JSON.parse(r.result_json || '{}');
    if (result.recipe) {
      recipes.push({
        analysis_id: r.id,
        kind: r.kind,
        params: JSON.parse(r.params_json || '{}'),
        dataset_id: r.dataset_id,
        created_at: r.created_at,
        ...result.recipe,
      });
    }
  }
  res.json({ recipes });
});

// ─── Run — single synchronous endpoint that dispatches by kind ─────────

const RunBody = z.object({
  kind: z.string().min(1),
  datasetId: z.string().optional(),
  params: z.record(z.any()).default({}),
});

router.post('/run', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const body = RunBody.parse(req.body);

    // Resolve the rows_storage_key for kinds that need one.
    let rowsKey = null;
    let datasetVersion = null;
    if (body.datasetId) {
      const ds = req.app.locals.db.prepare(
        `SELECT rows_storage_key, version FROM datasets WHERE id = ? AND workspace_id = ?`,
      ).get(body.datasetId, w);
      if (!ds) return res.status(404).json({ error: 'dataset_not_found' });
      rowsKey = ds.rows_storage_key;
      datasetVersion = ds.version;
    }

    // Dispatch.
    const result = await dispatch(body.kind, rowsKey, body.params);

    // Reproducibility quartet — stamped on every result for audit / diffing.
    result.provenance = computeProvenance({
      kind: body.kind, params: body.params, result, dataKey: rowsKey,
    });

    // Persist. dataset_version pins the analysis to the snapshot it was run
    // against; if the dataset is later appended-to, this row is "stale" and
    // the UI can offer a one-click refresh.
    const id = crypto.randomUUID();
    req.app.locals.db.prepare(
      `INSERT INTO analyses (id, workspace_id, dataset_id, kind, params_json,
                             result_json, chart_storage_key, dataset_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, w, body.datasetId || null, body.kind,
      JSON.stringify(body.params),
      JSON.stringify(result),
      result.chart_storage_key || null,
      datasetVersion,
    );
    try { audit(req.app.locals.db, { workspace_id: w, entity_type: 'analysis', entity_id: id, action: 'created', detail: body.kind }); } catch {}

    res.json({
      analysis: {
        id, workspace_id: w, dataset_id: body.datasetId || null,
        kind: body.kind, params_json: body.params,
        result_json: result,
        chart_storage_key: result.chart_storage_key || null,
        dataset_version: datasetVersion,
      },
    });
  } catch (e) { next(e); }
});

// Refresh a stale analysis — re-run with the same params against the latest
// dataset version. Result overwrites the existing row so the audit chain
// points at the freshest data.
router.post('/:id/refresh', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const a = req.app.locals.db.prepare(
      `SELECT * FROM analyses WHERE id = ? AND workspace_id = ?`,
    ).get(req.params.id, w);
    if (!a) return res.status(404).json({ error: 'not_found' });
    if (a.locked) return res.status(409).json({ error: 'analysis_locked', detail: 'This analysis is locked to preserve its verified result. Unlock it to re-run.' });
    if (!a.dataset_id) return res.status(400).json({ error: 'analysis_has_no_dataset' });
    const ds = req.app.locals.db.prepare(
      `SELECT rows_storage_key, version FROM datasets WHERE id = ? AND workspace_id = ?`,
    ).get(a.dataset_id, w);
    if (!ds) return res.status(404).json({ error: 'dataset_not_found' });
    const params = JSON.parse(a.params_json || '{}');
    const result = await dispatch(a.kind, ds.rows_storage_key, params);
    result.provenance = computeProvenance({
      kind: a.kind, params, result, dataKey: ds.rows_storage_key,
    });
    req.app.locals.db.prepare(
      `UPDATE analyses
         SET result_json = ?, chart_storage_key = ?, dataset_version = ?
       WHERE id = ?`,
    ).run(JSON.stringify(result), result.chart_storage_key || null,
          ds.version, a.id);
    res.json({ ok: true, dataset_version: ds.version, result });
  } catch (e) { next(e); }
});

// ─── Helper endpoints: pre-flight, narrative, follow-ups ───
//
// These are stateless wrappers around the corresponding sidecar routes.
// The UI calls /preflight before submit (so the user sees a traffic light
// + recommended-test chip), and /narrative + /followups after each run
// so the result card surfaces decision-grade prose + next-step chips.

router.post('/preflight', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const { datasetId, kind, params } = req.body || {};
    if (!datasetId || !kind) return res.status(400).json({ error: 'datasetId_and_kind_required' });
    const ds = req.app.locals.db.prepare(
      `SELECT rows_storage_key FROM datasets WHERE id = ? AND workspace_id = ?`,
    ).get(datasetId, w);
    if (!ds) return res.status(404).json({ error: 'dataset_not_found' });
    res.json(await sidecar.preflight(ds.rows_storage_key, kind, params || {}));
  } catch (e) { next(e); }
});

router.post('/narrative', async (req, res, next) => {
  try {
    const { kind, summary } = req.body || {};
    if (!kind) return res.status(400).json({ error: 'kind_required' });
    res.json(await sidecar.narrative(kind, summary || {}));
  } catch (e) { next(e); }
});

router.post('/followups', async (req, res, next) => {
  try {
    const { kind, summary, request } = req.body || {};
    if (!kind) return res.status(400).json({ error: 'kind_required' });
    res.json(await sidecar.followups(kind, summary || {}, request || {}));
  } catch (e) { next(e); }
});

// Excel (.xlsx) export — proxies the sidecar's /export/xlsx and streams
// the bytes back as a download.
router.get('/:id/xlsx', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const a = req.app.locals.db.prepare(
      `SELECT * FROM analyses WHERE id = ? AND workspace_id = ?`,
    ).get(req.params.id, w);
    if (!a) return res.status(404).json({ error: 'not_found' });
    const result = JSON.parse(a.result_json || '{}');
    const params = JSON.parse(a.params_json || '{}');
    const sidecarBase = process.env.SIDECAR_URL || 'http://localhost:8000';
    const exp = await fetch(`${sidecarBase}/export/xlsx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: a.kind, params, summary: result.summary || {},
        provenance: result.provenance || null,
      }),
    });
    if (!exp.ok) return res.status(502).json({ error: 'xlsx_export_failed' });
    const meta = await exp.json();
    // Fetch the file bytes from sidecar /file.
    const fr = await fetch(`${sidecarBase}/file/${meta.storage_key}`);
    if (!fr.ok) return res.status(502).json({ error: 'xlsx_file_missing' });
    const buf = Buffer.from(await fr.arrayBuffer());
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="bench-${a.kind}-${a.id.slice(0, 8)}.xlsx"`);
    res.end(buf);
  } catch (e) { next(e); }
});

// Bundle re-import: receives a JSON bundle (produced by GET /:id/bundle on
// another Bench instance) and recreates dataset + analysis in the current
// workspace. The result is byte-identical to what the source instance saw
// (hashes preserved) so the audit-trail chain stays unbroken.
router.post('/import', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const bundle = req.body;
    if (!bundle || bundle.bundle_kind !== 'conyso-bench-analysis') {
      return res.status(400).json({ error: 'not_a_bench_bundle' });
    }
    if (bundle.bundle_version !== 1) {
      return res.status(400).json({ error: 'unsupported_bundle_version',
        detail: `expected 1, got ${bundle.bundle_version}` });
    }
    const a = bundle.analysis;
    if (!a || !a.kind || typeof a.kind !== 'string') {
      return res.status(400).json({ error: 'bundle_missing_analysis' });
    }
    if (a.params && typeof a.params !== 'object') {
      return res.status(400).json({ error: 'bundle_invalid_params' });
    }
    // Cap row count to match export ceiling — guards against an
    // intentionally-huge bundle being used to OOM the importer.
    const IMPORT_MAX_ROWS = 50_000;
    if (bundle.dataset && Array.isArray(bundle.dataset.rows)
        && bundle.dataset.rows.length > IMPORT_MAX_ROWS) {
      return res.status(413).json({ error: 'bundle_too_large',
        detail: `dataset has ${bundle.dataset.rows.length} rows; max ${IMPORT_MAX_ROWS}` });
    }
    let datasetId = null;
    // Re-materialise the dataset rows if the bundle included them.
    if (bundle.dataset && bundle.dataset.rows && bundle.dataset.rows.length) {
      const mat = await sidecar.materializeRows(bundle.dataset.rows);
      datasetId = (await import('crypto')).default.randomUUID();
      const baseName = (bundle.dataset.name || 'imported dataset').slice(0, 100);
      req.app.locals.db.prepare(
        `INSERT INTO datasets (id, workspace_id, name, rows_storage_key, schema_json, row_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(datasetId, w, `${baseName} (imported)`, mat.rows_storage_key,
            JSON.stringify(mat.schema || bundle.dataset.schema || []),
            mat.n_rows || bundle.dataset.row_count || bundle.dataset.rows.length);
    }
    // Recreate the analysis. We rerun rather than just trust the stored
    // result_json because the receiver may want fresh hashes scoped to
    // its own provenance trail. If the rerun fails (e.g. sidecar version
    // skew on this kind), fall back to the bundled result.
    const id = (await import('crypto')).default.randomUUID();
    let result = a.result || {};
    let rerunHashesMatch = null;
    let rerunError = null;
    if (datasetId) {
      try {
        const ds = req.app.locals.db.prepare(
          `SELECT rows_storage_key FROM datasets WHERE id = ?`,
        ).get(datasetId);
        const fresh = await dispatch(a.kind, ds.rows_storage_key, a.params || {});
        // Compare just the summary block — chart_storage_key naturally differs.
        rerunHashesMatch = JSON.stringify(fresh.summary || fresh) === JSON.stringify(result.summary || result);
        result = fresh;
      } catch (e) {
        // Don't fail the import — but surface the issue so the caller
        // knows the audit chain isn't verified.
        rerunError = e.message || String(e);
      }
    }
    req.app.locals.db.prepare(
      `INSERT INTO analyses (id, workspace_id, dataset_id, kind, params_json, result_json,
                              chart_storage_key, data_hash, params_hash, result_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, w, datasetId, a.kind,
          JSON.stringify(a.params || {}),
          JSON.stringify(result),
          result.chart_storage_key || null,
          a.provenance?.data_hash || null,
          a.provenance?.params_hash || null,
          a.provenance?.result_hash || null);
    try { audit(req.app.locals.db, { workspace_id: w, entity_type: 'analysis', entity_id: id, action: 'created', detail: a.kind }); } catch {}
    res.json({ analysis_id: id, dataset_id: datasetId,
               rerun_hashes_match: rerunHashesMatch,
               rerun_error: rerunError });
  } catch (e) { next(e); }
});

// Reproducibility bundle: pack everything needed to re-run an analysis in
// any other Bench instance into one downloadable JSON blob. Includes the
// rows themselves (capped at 50k) so the receiver doesn't need access to
// the original sidecar storage.
router.get('/:id/bundle', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const a = req.app.locals.db.prepare(
      `SELECT * FROM analyses WHERE id = ? AND workspace_id = ?`,
    ).get(req.params.id, w);
    if (!a) return res.status(404).json({ error: 'not_found' });
    let ds = null;
    let rows = null;
    if (a.dataset_id) {
      ds = req.app.locals.db.prepare(
        `SELECT * FROM datasets WHERE id = ? AND workspace_id = ?`,
      ).get(a.dataset_id, w);
      if (ds) {
        try {
          const r = await sidecar.datasetRows(ds.rows_storage_key, { limit: 50000 });
          rows = r.rows || [];
        } catch { rows = null; }
      }
    }
    const bundle = {
      bundle_version: 1,
      bundle_kind: 'conyso-bench-analysis',
      exported_at: new Date().toISOString(),
      analysis: {
        id: a.id,
        kind: a.kind,
        params: JSON.parse(a.params_json || '{}'),
        result: JSON.parse(a.result_json || '{}'),
        provenance: {
          data_hash:   a.data_hash || null,
          params_hash: a.params_hash || null,
          result_hash: a.result_hash || null,
          computed_at: a.created_at || null,
        },
      },
      dataset: ds ? {
        id: ds.id,
        name: ds.name,
        schema: JSON.parse(ds.schema_json || '[]'),
        row_count: ds.row_count,
        rows: rows,
        rows_truncated_to: rows ? Math.min(rows.length, 50000) : null,
      } : null,
    };
    const filename = `bench-bundle-${a.kind}-${a.id.slice(0, 8)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(bundle, null, 2));
  } catch (e) { next(e); }
});

// Synchronous shortcut for pre-flight assumption checks. Same dispatch
// table; result not persisted.
router.post('/run-sync', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const body = RunBody.parse(req.body);
    let rowsKey = null;
    if (body.datasetId) {
      const ds = req.app.locals.db.prepare(
        `SELECT rows_storage_key FROM datasets WHERE id = ? AND workspace_id = ?`,
      ).get(body.datasetId, w);
      if (!ds) return res.status(404).json({ error: 'dataset_not_found' });
      rowsKey = ds.rows_storage_key;
    }
    res.json(await dispatch(body.kind, rowsKey, body.params));
  } catch (e) { next(e); }
});

// Dispatch table maps kind → sidecar call. Adding a new analysis is one
// line here once the sidecar route exists.
async function dispatch(kind, rowsKey, params) {
  const fns = {
    capability:           () => sidecar.capability(rowsKey, params),
    hypothesis_test:      () => sidecar.hypothesis(rowsKey, params),
    control_chart:        () => sidecar.controlChart(rowsKey, params),
    regression:           () => sidecar.regression(rowsKey, params),
    msa:                  () => sidecar.msa(rowsKey, params),
    doe:                  () => sidecar.doe(rowsKey, params),
    pareto:               () => sidecar.pareto(rowsKey, params),
    predictive_cpk:       () => sidecar.predictiveCpk(rowsKey, params),
    distribution_id:      () => sidecar.distributionId(rowsKey, params),
    reliability:          () => sidecar.reliability(rowsKey, params),
    multivariate:         () => sidecar.multivariate(rowsKey, params),
    time_series:          () => sidecar.timeSeries(rowsKey, params),
    response_surface:     () => sidecar.responseSurface(rowsKey, params),
    desirability:         () => sidecar.desirability(rowsKey, params),
    posthoc:              () => sidecar.posthoc(rowsKey, params),
    tolerance:            () => sidecar.tolerance(rowsKey, params),
    probability_plot:     () => sidecar.probabilityPlot(rowsKey, params),
    graph:                () => sidecar.graph(rowsKey, params),
    attribute_capability: () => sidecar.attributeCapability(rowsKey, params),
    anom:                 () => sidecar.anom(rowsKey, params),
    sixpack:              () => sidecar.sixpack(rowsKey, params),
    // New Bench-only analyses
    agreement:            () => sidecar.agreement(rowsKey, params),
    bootstrap:            () => sidecar.bootstrap(rowsKey, params),
    correlation:          () => sidecar.correlation(rowsKey, params),
    gage_linearity:       () => sidecar.gageLinearity(rowsKey, params),
    // ─── Leap-ahead batch ───
    survival:             () => sidecar.survival(rowsKey, params),
    mixed_effects:        () => sidecar.mixedEffects(rowsKey, params),
    cost_pareto:          () => sidecar.costPareto(rowsKey, params),
    ternary:              () => sidecar.ternary(rowsKey, params),
    bootstrap_effect:     () => sidecar.bootstrapEffect(rowsKey, params),
    variability_gauge:    () => sidecar.variabilityGauge(rowsKey, params),
    bayesian:             () => sidecar.bayesian(rowsKey, params),
    doe_augment:          () => sidecar.doeAugment(params),
    // Standalone — no dataset required
    dpmo:                 () => sidecar.dpmo(params),
    sample_size:          () => sidecar.sampleSize(params),
    probability:          () => sidecar.probability(params),
    doe_design:           () => sidecar.doeDesign(params),
    acceptance_sampling:  () => sidecar.acceptanceSampling(params),
    random_data:          () => sidecar.randomData(params),
    power_curve:          () => sidecar.powerCurve(params),
    doe_power:            () => sidecar.doePower(params),
    survey:               () => sidecar.survey(rowsKey, params),
    text_pareto:          () => sidecar.textPareto(rowsKey, params),
    variance_budget:      () => sidecar.varianceBudget(rowsKey, params),
    cycle_time:           () => sidecar.cycleTime(rowsKey, params),
    delivery_forecast:    () => sidecar.deliveryForecast(rowsKey, params),
  };
  if (!fns[kind]) throw Object.assign(new Error(`unknown kind: ${kind}`), { status: 400 });
  return fns[kind]();
}

export default router;
