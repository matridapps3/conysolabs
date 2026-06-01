// Smoke tests — minimal coverage that everything boots, the DB
// schema initializes, and the route modules export valid routers.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { initDb } from '../lib/db.js';

const tmpDb = path.join('/tmp', `fse-test-${Date.now()}.db`);

test('initDb creates the three core tables', () => {
  const db = initDb(tmpDb);
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  ).all().map(r => r.name);
  for (const t of ['analyses', 'datasets', 'workspaces']) {
    assert.ok(tables.includes(t), `${t} table should exist`);
  }
  db.close();
  fs.unlinkSync(tmpDb);
});

test('route modules export Express routers', async () => {
  for (const mod of ['analyses', 'datasets', 'tools', 'workspaces']) {
    const m = await import(`../routes/${mod}.js`);
    assert.equal(typeof m.default, 'function', `${mod} should default-export a router`);
    assert.ok(m.default.stack, `${mod} should be an Express router`);
  }
});

test('sidecar client maps every supported analysis kind', async () => {
  const { sidecar } = await import('../lib/sidecar.js');
  for (const fn of [
    'capability', 'hypothesis', 'controlChart', 'regression', 'msa', 'doe',
    'pareto', 'dpmo', 'sampleSize', 'predictiveCpk', 'distributionId',
    'reliability', 'multivariate', 'timeSeries', 'doeDesign', 'responseSurface',
    'posthoc', 'tolerance', 'probability', 'probabilityPlot', 'graph',
    'attributeCapability', 'anom', 'sixpack', 'acceptanceSampling', 'randomData',
    'parseExcel', 'parseCsv', 'parsePdf', 'materializeRows',
  ]) {
    assert.equal(typeof sidecar[fn], 'function', `sidecar.${fn} should exist`);
  }
});

// Read every front-end script under public/js (the former app.js was split into
// an MVC tree there; stats-ux.js is the UX layer).
function frontendSources() {
  const root = new URL('../public/js/', import.meta.url);
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(ent.name + (ent.isDirectory() ? '/' : ''), dir);
      if (ent.isDirectory()) walk(u);
      else if (ent.name.endsWith('.js')) out.push({ path: ent.name, src: fs.readFileSync(u, 'utf8') });
    }
  };
  walk(root);
  return out;
}

test('frontend UX layer (stats-ux.js) has no LLM calls', () => {
  const { src } = frontendSources().find(f => f.path === 'stats-ux.js');
  // Free-tier contract — no LLM calls anywhere in the UX layer.
  for (const banned of ['/chat', '/coach', 'completeJson', 'anthropic', 'openai', 'gemini']) {
    assert.ok(!src.toLowerCase().includes(banned.toLowerCase()),
      `stats-ux.js must not contain "${banned}"`);
  }
});

test('front-end boots without auth/Stripe/LLM dependencies', () => {
  // Scan the whole js/ tree except the UX layer (covered above) — equivalent to
  // the old single-file app.js scan, now robust to the MVC split.
  for (const { path: p, src } of frontendSources()) {
    if (p === 'stats-ux.js') continue;
    for (const banned of ['stripe', '/api/auth', '/api/billing', 'session', 'anthropic']) {
      assert.ok(!src.toLowerCase().includes(banned.toLowerCase()),
        `${p} must not contain "${banned}" — standalone build`);
    }
  }
});

test('package.json has no LLM / Stripe / S3 dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const banned of ['@anthropic-ai/sdk', 'openai', '@google/genai', 'stripe',
                        '@aws-sdk/client-s3', '@sentry/node', 'bullmq', 'ioredis', 'pg']) {
    assert.ok(!allDeps[banned], `${banned} should not be a dependency in the standalone build`);
  }
});
