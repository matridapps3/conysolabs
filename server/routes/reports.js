// Conyso Bench — reports route. CRUD + multi-format download for the
// LSS standard deliverable templates.

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { rowToJsonObj } from '../lib/db.js';
import { TEMPLATES, TEMPLATES_BY_ID, suggestTemplateForAnalysis } from '../lib/reports/templates.js';
import { renderReportHtml, renderReportMarkdown, renderReportWordDoc } from '../lib/reports/render.js';

const router = Router();

function workspaceId(req) {
  return req.header('X-Workspace-Id') || req.body?.workspace_id || req.query.workspace_id;
}

// Public template registry (no auth needed).
router.get('/templates', (_req, res) => {
  res.json({
    templates: TEMPLATES.map(t => ({
      id: t.id, name: t.name, blurb: t.blurb, phase: t.phase, icon: t.icon,
      requires_analysis: t.requires_analysis || null,
      sections: t.sections.map(s => ({
        id: s.id, kind: s.kind, label: s.label, hint: s.hint,
        fields: s.fields, columns: s.columns, rows: s.rows,
        defaultRows: s.defaultRows, roles: s.roles, options: s.options,
        rpnCols: s.rpnCols,
      })),
    })),
  });
});

router.get('/templates/:id', (req, res) => {
  const t = TEMPLATES_BY_ID[req.params.id];
  if (!t) return res.status(404).json({ error: 'unknown_template' });
  res.json({ template: t });
});

router.get('/suggest', (req, res) => {
  const kind = req.query.kind;
  const id = suggestTemplateForAnalysis(kind);
  res.json({ suggested_template_id: id });
});

// List reports in the workspace.
router.get('/', (req, res) => {
  const w = workspaceId(req);
  if (!w) return res.status(400).json({ error: 'workspace_required' });
  const rows = req.app.locals.db.prepare(
    `SELECT * FROM reports WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
  ).all(w);
  res.json({ reports: rows.map(r => rowToJsonObj(r, ['data_json', 'analyses_json'])) });
});

router.get('/:id', (req, res) => {
  const w = workspaceId(req);
  const row = req.app.locals.db.prepare(`SELECT * FROM reports WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ report: rowToJsonObj(row, ['data_json', 'analyses_json']) });
});

// Create — pulls defaults from template, project, and seed analyses if any.
const CreateBody = z.object({
  template_id: z.string().min(1),
  project_id: z.string().optional().nullable(),
  analysis_ids: z.array(z.string()).optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
});
router.post('/', (req, res, next) => {
  try {
    const w = workspaceId(req);
    if (!w) return res.status(400).json({ error: 'workspace_required' });
    const body = CreateBody.parse(req.body);
    const tpl = TEMPLATES_BY_ID[body.template_id];
    if (!tpl) return res.status(400).json({ error: 'unknown_template' });

    const db = req.app.locals.db;
    let project = null;
    if (body.project_id) {
      const p = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(body.project_id, w);
      if (p) project = rowToJsonObj(p, ['phase_data']);
    }
    const seedAnalyses = (body.analysis_ids || []).map(id =>
      rowToJsonObj(db.prepare(`SELECT * FROM analyses WHERE id = ? AND workspace_id = ?`).get(id, w), ['params_json', 'result_json']),
    ).filter(Boolean);

    const skeleton = tpl.defaults ? tpl.defaults({ project, analyses: seedAnalyses }) : {};
    const id = crypto.randomUUID();
    const title = body.title || skeleton.title || tpl.name;
    const subtitle = body.subtitle || skeleton.subtitle || '';
    const data = skeleton.data || {};
    const analyses = body.analysis_ids?.length ? body.analysis_ids : (skeleton.analyses || []);

    db.prepare(
      `INSERT INTO reports (id, workspace_id, project_id, template_id, title, subtitle, data_json, analyses_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, w, body.project_id || null, body.template_id, title, subtitle,
          JSON.stringify(data), JSON.stringify(analyses));

    const row = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id);
    res.json({ report: rowToJsonObj(row, ['data_json', 'analyses_json']) });
  } catch (e) { next(e); }
});

const PatchBody = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  data_json: z.record(z.any()).optional(),
  analyses_json: z.array(z.string()).optional(),
  project_id: z.string().optional().nullable(),
});
router.patch('/:id', (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(`SELECT * FROM reports WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = PatchBody.parse(req.body);
    const data = body.data_json !== undefined
      ? JSON.stringify(body.data_json)
      : row.data_json;
    const analyses = body.analyses_json !== undefined
      ? JSON.stringify(body.analyses_json)
      : row.analyses_json;
    req.app.locals.db.prepare(
      `UPDATE reports
          SET title       = COALESCE(?, title),
              subtitle    = COALESCE(?, subtitle),
              data_json   = ?,
              analyses_json = ?,
              project_id  = COALESCE(?, project_id),
              updated_at  = unixepoch()
        WHERE id = ?`,
    ).run(
      body.title ?? null,
      body.subtitle ?? null,
      data,
      analyses,
      body.project_id ?? null,
      req.params.id,
    );
    const updated = req.app.locals.db.prepare(`SELECT * FROM reports WHERE id = ?`).get(req.params.id);
    res.json({ report: rowToJsonObj(updated, ['data_json', 'analyses_json']) });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res) => {
  const w = workspaceId(req);
  req.app.locals.db.prepare(`DELETE FROM reports WHERE id = ? AND workspace_id = ?`).run(req.params.id, w);
  res.json({ ok: true });
});

// Attach / detach analyses (one-click from the analysis result card).
const LinkBody = z.object({ analysis_id: z.string().min(1) });
router.post('/:id/link-analysis', (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(`SELECT * FROM reports WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = LinkBody.parse(req.body);
    const arr = JSON.parse(row.analyses_json || '[]');
    if (!arr.includes(body.analysis_id)) arr.push(body.analysis_id);
    req.app.locals.db.prepare(
      `UPDATE reports SET analyses_json = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?`,
    ).run(JSON.stringify(arr), req.params.id, w);
    res.json({ ok: true, analyses: arr });
  } catch (e) { next(e); }
});
router.post('/:id/unlink-analysis', (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(`SELECT * FROM reports WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = LinkBody.parse(req.body);
    const arr = JSON.parse(row.analyses_json || '[]').filter(x => x !== body.analysis_id);
    req.app.locals.db.prepare(
      `UPDATE reports SET analyses_json = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?`,
    ).run(JSON.stringify(arr), req.params.id, w);
    res.json({ ok: true, analyses: arr });
  } catch (e) { next(e); }
});

// Duplicate (e.g. quarterly capability report).
router.post('/:id/duplicate', (req, res, next) => {
  try {
    const w = workspaceId(req);
    const row = req.app.locals.db.prepare(`SELECT * FROM reports WHERE id = ? AND workspace_id = ?`).get(req.params.id, w);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const newId = crypto.randomUUID();
    req.app.locals.db.prepare(
      `INSERT INTO reports (id, workspace_id, project_id, template_id, title, subtitle, data_json, analyses_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId, row.workspace_id, row.project_id, row.template_id,
          `${row.title} (copy)`, row.subtitle, row.data_json, row.analyses_json);
    const created = req.app.locals.db.prepare(`SELECT * FROM reports WHERE id = ?`).get(newId);
    res.json({ report: rowToJsonObj(created, ['data_json', 'analyses_json']) });
  } catch (e) { next(e); }
});

// ───────── Downloads ─────────

function loadReportCtx(db, reportId, req) {
  const row = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);
  if (!row) return null;
  // Linked project/analyses are scoped to the report's own workspace, so a
  // foreign id linked into a report can't render another workspace's data.
  const wsId = row.workspace_id;
  const report = rowToJsonObj(row, ['data_json', 'analyses_json']);
  let project = null;
  if (report.project_id) {
    const p = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(report.project_id, wsId);
    if (p) project = rowToJsonObj(p, ['phase_data']);
  }
  const ids = report.analyses_json || [];
  const analyses = ids.map(id =>
    rowToJsonObj(db.prepare(`SELECT * FROM analyses WHERE id = ? AND workspace_id = ?`).get(id, wsId), ['params_json', 'result_json']),
  ).filter(Boolean);
  const publicBase = `${req.protocol}://${req.get('host')}`;
  return { report, project, analyses, publicBase };
}

router.get('/:id/download.html', (req, res) => {
  const ctx = loadReportCtx(req.app.locals.db, req.params.id, req);
  if (!ctx) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderReportHtml(ctx.report, ctx));
});

router.get('/:id/download.md', (req, res) => {
  const ctx = loadReportCtx(req.app.locals.db, req.params.id, req);
  if (!ctx) return res.status(404).json({ error: 'not_found' });
  const filename = (ctx.report.title || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.md"`);
  res.send(renderReportMarkdown(ctx.report, ctx));
});

router.get('/:id/download.doc', (req, res) => {
  const ctx = loadReportCtx(req.app.locals.db, req.params.id, req);
  if (!ctx) return res.status(404).json({ error: 'not_found' });
  const filename = (ctx.report.title || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'application/msword');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.doc"`);
  // Word reads HTML directly when served with the msword MIME type — no
  // multipart wrapper needed (and the multipart envelope confuses some
  // versions of Pages). Send raw HTML.
  res.send(renderReportHtml(ctx.report, ctx));
});

// PowerPoint export — single-deck HTML wrapped with the application/vnd.ms-
// powerpoint MIME. Opens in PowerPoint, Keynote, and Google Slides directly.
// Each section becomes a slide via the print page-break-after CSS hook.
router.get('/:id/download.ppt', (req, res) => {
  const ctx = loadReportCtx(req.app.locals.db, req.params.id, req);
  if (!ctx) return res.status(404).json({ error: 'not_found' });
  const filename = (ctx.report.title || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'application/vnd.ms-powerpoint');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.ppt"`);
  // Inject slide-break CSS into the standard report HTML so each <section>
  // lands on its own slide / page when PowerPoint opens the file.
  const html = renderReportHtml(ctx.report, ctx)
    .replace(
      '</style>',
      `
      section { page-break-after: always; min-height: 540pt; padding: 24pt 12pt; }
      section:last-of-type { page-break-after: auto; }
      .doc-header { page-break-after: always; min-height: 100pt; }
      h2 { font-size: 13pt; margin-top: 0; }
      h1 { font-size: 32pt; }
      </style>`,
    );
  res.send(html);
});

// Inline preview for the in-app iframe (no Content-Disposition).
router.get('/:id/preview', (req, res) => {
  const ctx = loadReportCtx(req.app.locals.db, req.params.id, req);
  if (!ctx) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderReportHtml(ctx.report, ctx));
});

export default router;
