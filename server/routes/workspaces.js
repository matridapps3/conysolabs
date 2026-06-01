// Anonymous workspaces — keyed by a UUID stored in localStorage on the
// browser side. No auth, no login. Creating a workspace is just a row
// insert; the browser then sends X-Workspace-Id on every request.

import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

router.post('/', (req, res) => {
  const id = crypto.randomUUID();
  req.app.locals.db.prepare(
    `INSERT INTO workspaces (id, name) VALUES (?, ?)`,
  ).run(id, (req.body?.name || 'My workspace').slice(0, 120));
  res.json({ workspace: { id, name: req.body?.name || 'My workspace' } });
});

router.get('/:id', (req, res) => {
  const row = req.app.locals.db.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ workspace: row });
});

router.patch('/:id', (req, res) => {
  const name = (req.body?.name || '').slice(0, 120);
  if (!name) return res.status(400).json({ error: 'name_required' });
  req.app.locals.db.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`)
    .run(name, req.params.id);
  res.json({ ok: true });
});

export default router;
