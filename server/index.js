// Conyso Bench — minimal Node entrypoint.
//
// One Express app:
//   - Serves /public/ as the SPA
//   - Proxies /api/sidecar/* to the Python sidecar (so the browser doesn't
//     need to know the sidecar URL or hit it directly)
//   - Persists analyses + datasets metadata in SQLite (file-based, zero setup)
//   - No auth, no Stripe, no LLM, no queues.
//
// Runs as: `node index.js`. The Python sidecar must be running separately
// on SIDECAR_URL (default http://localhost:8000).

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './lib/db.js';
import analyses from './routes/analyses.js';
import datasets from './routes/datasets.js';
import workspaces from './routes/workspaces.js';
import tools from './routes/tools.js';
import projects from './routes/projects.js';
import reports from './routes/reports.js';
import feedback from './routes/feedback.js';
import pipelines from './routes/pipelines.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Body limit: 5MB is plenty for the largest analysis params + report data
// blobs Bench stores; was 10MB which is wasteful and a small DoS surface.
app.use(express.json({ limit: '5mb' }));

// Security headers — keep dependencies thin (no helmet) by setting the
// four headers that actually matter for a self-hosted single-tenant SPA.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Lenient CSP — the SPA serves its own JS/CSS + matplotlib PNGs via
  // /artifact, and the report preview iframes are same-origin.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com; " +
    "font-src 'self' fonts.gstatic.com data:; " +
    "script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; " +
    "frame-src 'self'; " +
    "frame-ancestors 'self'");
  next();
});

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

// Persistence guard. Railway container disk is ephemeral — without a volume
// mounted at DATA_DIR, every redeploy silently wipes all user data. Railway
// sets RAILWAY_VOLUME_MOUNT_PATH when a volume is attached; if we're on
// Railway and DATA_DIR isn't covered by it, scream in the logs.
if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!vol || !DATA_DIR.startsWith(path.resolve(vol))) {
    console.warn('\n' + '='.repeat(72));
    console.warn(`⚠️  DATA WILL NOT PERSIST: DATA_DIR (${DATA_DIR}) is not on a Railway volume.`);
    console.warn('   Every redeploy/restart will DESTROY all datasets and analyses.');
    console.warn(`   Fix: attach a Railway volume mounted at ${DATA_DIR} (Service → Settings → Volumes).`);
    console.warn('='.repeat(72) + '\n');
  }
}

const db = initDb(path.join(DATA_DIR, 'engine.db'));
app.locals.db = db;

// Lightweight health endpoint for Railway / k8s probes. Must be ABOVE the
// /api routes since they don't define one, and ABOVE the SPA fallback so
// it doesn't get swallowed.
app.get('/healthz', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, ts: Date.now() });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'db_unreachable' });
  }
});

// Routes
app.use('/api/workspaces', workspaces);
app.use('/api/datasets',  datasets);
app.use('/api/analyses',  analyses);
app.use('/api/tools',     tools);
app.use('/api/projects',  projects);
app.use('/api/reports',   reports);
app.use('/api/feedback',  feedback);
app.use('/api/pipelines', pipelines);

// Any /api/* that didn't match a route → JSON 404, NOT the SPA. Previously
// the wildcard fallback at the bottom would happily return index.html with
// a 200 for /api/nonexistent, which silently broke fetch() callers.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Conyso Lens — sibling SPA served at /lens (today) and at lens.conyso.com
// (when DNS is pointed at the Railway service; the Host-header branch below
// rewrites the root path to /lens so users land on Lens directly).
//
// TEMPORARILY GATED: Lens access is closed for now and replaced with a
// "coming soon" placeholder. The real Lens (lens.html + lens.js + lens.css)
// is left untouched. To re-enable, set LENS_PAGE back to 'lens.html' and
// remove the /lens.html guard below — nothing else changes.
const LENS_PAGE = 'lens-soon.html';   // was 'lens.html'
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.startsWith('lens.') && req.path === '/') {
    return res.sendFile(path.join(__dirname, 'public', LENS_PAGE));
  }
  next();
});
app.get('/lens', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', LENS_PAGE));
});
// Gate direct access to the raw Lens HTML too, so the static middleware
// below cannot serve the real Lens page while access is closed.
app.get('/lens.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', LENS_PAGE));
});

// Static SPA
app.use(express.static(path.join(__dirname, 'public')));

// Proxy chart / artifact requests to the sidecar's /file route.
// 30s timeout so a hung sidecar doesn't block the browser indefinitely.
app.get('/artifact/:key(*)', async (req, res, next) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const url = `${process.env.SIDECAR_URL || 'http://localhost:8000'}/file/${req.params.key}`;
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) {
      // Always JSON on error — never leak the sidecar's HTML 500 page.
      return res.status(r.status === 404 ? 404 : 502)
        .json({ error: r.status === 404 ? 'artifact_not_found' : 'sidecar_error',
                sidecar_status: r.status });
    }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    // Stream the response instead of buffering — avoids loading large PNGs
    // (or future bundles) into Node memory in one shot.
    if (r.body && r.body.pipe) {
      r.body.pipe(res);
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      res.end(buf);
    }
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'artifact_timeout' });
    }
    next(e);
  }
});

// ─── Public, read-only shared analysis view ───
// A share_token grants no-auth access to exactly ONE analysis's result —
// nothing else. Renders a self-contained branded page that embeds anywhere
// (frame-ancestors *). Pass ?embed=1 for chrome-less iframe mode. A .json
// suffix returns the raw result for API consumers.
import { renderSharePage } from './lib/share.js';
app.get('/share/:token', (req, res, next) => {
  try {
    let token = req.params.token;
    const wantJson = token.endsWith('.json');
    if (wantJson) token = token.slice(0, -5);
    const row = req.app.locals.db.prepare(
      `SELECT kind, params_json, result_json, chart_storage_key, created_at FROM analyses WHERE share_token = ?`,
    ).get(token);
    if (!row) return res.status(404).type(wantJson ? 'application/json' : 'html')
      .send(wantJson ? '{"error":"not_found"}' : '<!doctype html><title>Not found</title><body style="font-family:sans-serif;padding:40px">This shared analysis link is invalid or has been revoked.</body>');
    const analysis = {
      kind: row.kind,
      params: safeJson(row.params_json), result: safeJson(row.result_json),
      chart_storage_key: row.chart_storage_key, created_at: row.created_at,
    };
    if (wantJson) return res.json({ analysis });
    // Embeddable: allow framing from anywhere, drop the same-origin frame lock.
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors *");
    res.type('html').send(renderSharePage(analysis, { embed: req.query.embed === '1' }));
  } catch (e) { next(e); }
});
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// SPA fallback — any unmatched GET returns index.html so the hash-router
// works. /api/* and /healthz are short-circuited above, so this only catches
// real client-side routes like /reports, /feedback, etc.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler — every API failure surfaces as JSON.
// If headers are already sent (mid-stream xlsx download, etc.), forward
// to Express's default handler instead of attempting another response.
app.use((err, _req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'internal_error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Conyso Bench listening on http://localhost:${PORT}`);
  console.log(`Sidecar expected at ${process.env.SIDECAR_URL || 'http://localhost:8000'}`);
});
