// Lightweight DMAIC project layer. Five phases (Define → Control); each
// phase has a checklist + pinned analyses. Not a competitor to Minitab
// Companion / Workspace — covers the 80% case for free.

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { rowToJsonObj } from '../lib/db.js';
import { sidecar } from '../lib/sidecar.js';

const router = Router();

const PHASES = ['define', 'measure', 'analyze', 'improve', 'control'];

const DEFAULT_CHECKLISTS = {
  define: [
    'Draft project charter',
    'SIPOC',
    'Voice of the Customer',
    'Scope + boundaries agreed',
  ],
  measure: [
    'Data-collection plan',
    'MSA / Gauge R&R passed',
    'Baseline capability (Cpk)',
    'Process map (current state)',
  ],
  analyze: [
    'Root-cause analysis (fishbone or 5-why)',
    'Pareto of defects',
    'Hypothesis tests on suspected causes',
    'Identify vital few X\'s',
  ],
  improve: [
    'Solution design',
    'Pilot or DOE planned',
    'Optimisation / RSM',
    'Pilot results review',
  ],
  control: [
    'Control plan documented',
    'Sustained capability (Cpk ≥ target)',
    'Handover to process owner',
    'Lessons learned + closure',
  ],
};

function defaultPhaseData() {
  const out = {};
  for (const p of PHASES) {
    out[p] = {
      checklist: DEFAULT_CHECKLISTS[p].map(item => ({ item, done: false })),
      analysis_ids: [],
      completed_at: null,
      notes: '',
    };
  }
  return out;
}

function workspaceId(req) {
  return req.header('X-Workspace-Id') || req.body?.workspace_id || req.query.workspace_id;
}

// List projects in the workspace.
router.get('/', (req, res) => {
  const w = workspaceId(req);
  if (!w) return res.status(400).json({ error: 'workspace_required' });
  const rows = req.app.locals.db.prepare(
    `SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
  ).all(w);
  res.json({ projects: rows.map(r => rowToJsonObj(r, ['phase_data'])) });
});

// Get one.
router.get('/:id', (req, res) => {
  const w = workspaceId(req);
  const row = req.app.locals.db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ project: rowToJsonObj(row, ['phase_data']) });
});

// Create.
const CreateBody = z.object({
  name: z.string().min(1).max(140),
  description: z.string().max(2000).optional(),
});
router.post('/', (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const body = CreateBody.parse(req.body);
    const id = crypto.randomUUID();
    req.app.locals.db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, current_phase, phase_data)
       VALUES (?, ?, ?, ?, 'define', ?)`,
    ).run(id, w, body.name, body.description || '', JSON.stringify(defaultPhaseData()));
    const row = req.app.locals.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    res.json({ project: rowToJsonObj(row, ['phase_data']) });
  } catch (e) { next(e); }
});

// Patch — accepts any of: name, description, current_phase, phase_data (full or partial).
const PatchBody = z.object({
  name: z.string().min(1).max(140).optional(),
  description: z.string().max(2000).optional(),
  current_phase: z.enum(['define', 'measure', 'analyze', 'improve', 'control']).optional(),
  phase_data: z.record(z.any()).optional(),
});
router.patch('/:id', (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = PatchBody.parse(req.body);
    const current = JSON.parse(row.phase_data || '{}');
    const merged = body.phase_data
      ? { ...current, ...body.phase_data }
      : current;
    req.app.locals.db.prepare(
      `UPDATE projects
          SET name = COALESCE(?, name),
              description = COALESCE(?, description),
              current_phase = COALESCE(?, current_phase),
              phase_data = ?,
              updated_at = unixepoch()
        WHERE id = ? AND workspace_id = ?`,
    ).run(
      body.name ?? null,
      body.description ?? null,
      body.current_phase ?? null,
      JSON.stringify(merged),
      req.params.id,
      w,
    );
    const updated = req.app.locals.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params.id);
    res.json({ project: rowToJsonObj(updated, ['phase_data']) });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res) => {
  const w = workspaceId(req);
  req.app.locals.db.prepare(`DELETE FROM projects WHERE id = ? AND workspace_id = ?`).run(req.params.id, w);
  res.json({ ok: true });
});

// Attach an analysis to a phase.
const AttachBody = z.object({
  analysis_id: z.string().min(1),
  phase: z.enum(['define', 'measure', 'analyze', 'improve', 'control']),
});
router.post('/:id/attach', (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = AttachBody.parse(req.body);
    const data = JSON.parse(row.phase_data || '{}');
    if (!data[body.phase]) data[body.phase] = { checklist: [], analysis_ids: [], notes: '' };
    if (!data[body.phase].analysis_ids.includes(body.analysis_id)) {
      data[body.phase].analysis_ids.push(body.analysis_id);
    }
    req.app.locals.db.prepare(
      `UPDATE projects SET phase_data = ?, updated_at = unixepoch() WHERE id = ?`,
    ).run(JSON.stringify(data), req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Detach.
router.post('/:id/detach', (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = AttachBody.parse(req.body);
    const data = JSON.parse(row.phase_data || '{}');
    if (data[body.phase]?.analysis_ids) {
      data[body.phase].analysis_ids = data[body.phase].analysis_ids.filter(x => x !== body.analysis_id);
    }
    req.app.locals.db.prepare(
      `UPDATE projects SET phase_data = ?, updated_at = unixepoch() WHERE id = ?`,
    ).run(JSON.stringify(data), req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─── DMAIC copilot: assemble project context and ask the recommendation engine
// what to do next. Pure orchestration — the brain lives in the sidecar.
router.post('/:id/recommend', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const w = workspaceId(req);
    const proj = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!proj) return res.status(404).json({ error: 'not_found' });
    const phase = (req.body && req.body.phase) || proj.current_phase || 'define';
    const phaseData = JSON.parse(proj.phase_data || '{}');

    // Gather every analysis attached to any phase of this project.
    const ids = [...new Set(Object.values(phaseData)
      .flatMap(p => (p && p.analysis_ids) || []))];
    let history = [];
    let datasetId = null;
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id, kind, params_json, result_json, dataset_id, created_at
           FROM analyses WHERE id IN (${placeholders}) AND workspace_id = ? ORDER BY created_at DESC`,
      ).all(...ids, w);
      history = rows.map(r => {
        let result = {};
        try { result = JSON.parse(r.result_json || '{}'); } catch {}
        if (!datasetId && r.dataset_id) datasetId = r.dataset_id;
        return {
          id: r.id, kind: r.kind,
          params: safeParse(r.params_json),
          summary: result.summary || {},
        };
      });
    }

    // Best-effort dataset summary (schema + row count) for data-shape rules.
    let dataset = null;
    if (datasetId) {
      const ds = db.prepare(`SELECT schema_json, row_count FROM datasets WHERE id = ? AND workspace_id = ?`).get(datasetId, w);
      if (ds) {
        dataset = {
          n_rows: ds.row_count,
          columns: safeParse(ds.schema_json) || [],
        };
      }
    }

    const result = await sidecar.recommend({ phase, dataset, history });
    res.json(result);
  } catch (e) { next(e); }
});

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export default router;
