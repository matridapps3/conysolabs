// Recipe pipelines — chain transforms and analyses as one replayable unit.
//
// A pipeline is an ordered list of steps:
//   { kind: 'transform', op: 'compute' | 'recode' | …, params: {…} }
//   { kind: 'analyze',   analysis_kind: 'capability' | …, params: {…} }
//
// The runner starts from `dataset_id`, applies each transform in order
// (producing a new rows_storage_key chain), and runs analyses against
// whichever dataset is current. Results from each step are returned in
// order so the UI can render the full audit trail.

import { Router } from 'express';
import crypto from 'crypto';
import { sidecar } from '../lib/sidecar.js';
import { rowToJsonObj } from '../lib/db.js';

const router = Router();

function workspaceId(req) {
  return req.header('X-Workspace-Id') || req.query.workspace_id;
}

router.get('/', (req, res) => {
  const w = workspaceId(req);
  if (!w) return res.status(400).json({ error: 'workspace_required' });
  const rows = req.app.locals.db.prepare(
    `SELECT * FROM pipelines WHERE workspace_id = ? ORDER BY created_at DESC`,
  ).all(w);
  res.json({ pipelines: rows.map(r => rowToJsonObj(r, ['steps_json', 'last_result_json'])) });
});

router.post('/', (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const { name, dataset_id, steps } = req.body || {};
    if (!name || !Array.isArray(steps) || !steps.length) {
      return res.status(400).json({ error: 'name_and_steps_required' });
    }
    const id = crypto.randomUUID();
    req.app.locals.db.prepare(
      `INSERT INTO pipelines (id, workspace_id, name, dataset_id, steps_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, w, name, dataset_id || null, JSON.stringify(steps));
    res.json({ pipeline: { id, name, dataset_id, steps } });
  } catch (e) { next(e); }
});

router.get('/:id', (req, res) => {
  const w = workspaceId(req);
  const row = req.app.locals.db.prepare(
    `SELECT * FROM pipelines WHERE id = ? AND workspace_id = ?`,
  ).get(req.params.id, w);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ pipeline: rowToJsonObj(row, ['steps_json', 'last_result_json']) });
});

router.delete('/:id', (req, res) => {
  const w = workspaceId(req);
  const r = req.app.locals.db.prepare(
    `DELETE FROM pipelines WHERE id = ? AND workspace_id = ?`,
  ).run(req.params.id, w);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Run a pipeline end-to-end. Each step's output becomes the next step's input.
router.post('/:id/run', async (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(
      `SELECT * FROM pipelines WHERE id = ? AND workspace_id = ?`,
    ).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const steps = JSON.parse(row.steps_json);

    // Locate starting dataset.
    const startId = (req.body && req.body.dataset_id) || row.dataset_id;
    if (!startId) return res.status(400).json({ error: 'dataset_id_required' });
    const startDs = req.app.locals.db.prepare(
      `SELECT rows_storage_key, schema_json FROM datasets WHERE id = ? AND workspace_id = ?`,
    ).get(startId, w);
    if (!startDs) return res.status(404).json({ error: 'dataset_not_found' });

    let currentKey = startDs.rows_storage_key;
    let currentSchema = JSON.parse(startDs.schema_json || '[]');
    const stepResults = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const t0 = Date.now();
      try {
        if (step.kind === 'transform') {
          const r = await sidecar.wrangleTransform(currentKey, step.op, step.params || {});
          if (!r.materialized) throw new Error(`step ${i + 1} (transform/${step.op}) failed`);
          currentKey = r.materialized.rows_storage_key;
          currentSchema = r.materialized.schema || currentSchema;
          stepResults.push({
            step: i + 1, kind: 'transform', op: step.op,
            ok: true, n_rows: r.materialized.n_rows,
            summary: r.summary, ms: Date.now() - t0,
          });
        } else if (step.kind === 'analyze') {
          // Reuse the analyses dispatch table by routing through sidecar
          // helpers directly (avoid circular import on `analyses.js`).
          const k = step.analysis_kind;
          const p = step.params || {};
          const dispatch = {
            capability:           () => sidecar.capability(currentKey, p),
            hypothesis_test:      () => sidecar.hypothesis(currentKey, p),
            control_chart:        () => sidecar.controlChart(currentKey, p),
            regression:           () => sidecar.regression(currentKey, p),
            msa:                  () => sidecar.msa(currentKey, p),
            doe:                  () => sidecar.doe(currentKey, p),
            pareto:               () => sidecar.pareto(currentKey, p),
            distribution_id:      () => sidecar.distributionId(currentKey, p),
            reliability:          () => sidecar.reliability(currentKey, p),
            multivariate:         () => sidecar.multivariate(currentKey, p),
            time_series:          () => sidecar.timeSeries(currentKey, p),
            posthoc:              () => sidecar.posthoc(currentKey, p),
            tolerance:            () => sidecar.tolerance(currentKey, p),
            graph:                () => sidecar.graph(currentKey, p),
            anom:                 () => sidecar.anom(currentKey, p),
            sixpack:              () => sidecar.sixpack(currentKey, p),
            agreement:            () => sidecar.agreement(currentKey, p),
            bootstrap:            () => sidecar.bootstrap(currentKey, p),
            correlation:          () => sidecar.correlation(currentKey, p),
            survival:             () => sidecar.survival(currentKey, p),
            mixed_effects:        () => sidecar.mixedEffects(currentKey, p),
          };
          if (!dispatch[k]) throw new Error(`unknown analysis kind: ${k}`);
          const r = await dispatch[k]();
          stepResults.push({
            step: i + 1, kind: 'analyze', analysis_kind: k,
            ok: true, summary: r.summary,
            chart_storage_key: r.chart_storage_key || null,
            ms: Date.now() - t0,
          });
        } else {
          throw new Error(`unknown step kind: ${step.kind}`);
        }
      } catch (err) {
        stepResults.push({
          step: i + 1, kind: step.kind, ok: false,
          error: err.message || String(err),
        });
        break;     // halt on first failure — pipelines fail fast
      }
    }

    const summary = {
      ok: stepResults.every(s => s.ok),
      n_steps: steps.length,
      n_completed: stepResults.filter(s => s.ok).length,
      total_ms: stepResults.reduce((s, r) => s + (r.ms || 0), 0),
      steps: stepResults,
      final_rows_storage_key: currentKey,
      final_schema: currentSchema,
    };
    req.app.locals.db.prepare(
      `UPDATE pipelines SET last_run_at = unixepoch(), last_result_json = ? WHERE id = ?`,
    ).run(JSON.stringify(summary), row.id);
    res.json(summary);
  } catch (e) { next(e); }
});

export default router;
