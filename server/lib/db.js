// SQLite database — file-backed, zero setup. Replaces Postgres for the
// standalone free engine. Schema is intentionally tiny:
//
//   workspaces — one per browser (anonymous, generated on first visit)
//   datasets   — uploaded data with its rows_storage_key (lives in
//                sidecar's local filesystem under data/rows/)
//   analyses   — every run, with params + result_json + chart key

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function initDb(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT 'My workspace',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS datasets (
      id                 TEXT PRIMARY KEY,
      workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name               TEXT NOT NULL,
      rows_storage_key   TEXT NOT NULL,
      schema_json        TEXT NOT NULL DEFAULT '[]',
      row_count          INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS datasets_workspace_idx ON datasets(workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS analyses (
      id                  TEXT PRIMARY KEY,
      workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      dataset_id          TEXT REFERENCES datasets(id) ON DELETE SET NULL,
      kind                TEXT NOT NULL,
      params_json         TEXT NOT NULL DEFAULT '{}',
      result_json         TEXT NOT NULL DEFAULT '{}',
      chart_storage_key   TEXT,
      narrative_md        TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS analyses_workspace_idx ON analyses(workspace_id, created_at DESC);

    -- DMAIC projects. Lightweight: one row per project; per-phase state
    -- (checklist + pinned analyses + completion timestamp) lives in the
    -- phase_data JSON column so we don't need a phases table.
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      current_phase TEXT NOT NULL DEFAULT 'define',  -- define|measure|analyze|improve|control
      phase_data    TEXT NOT NULL DEFAULT '{}',      -- JSON: per-phase state
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id, created_at DESC);

    -- Reports: standard LSS deliverable templates rendered to printable
    -- HTML / Markdown / Word-flavored .doc. One row per saved report.
    -- All editable content lives in data_json; template_id selects the
    -- section layout. analyses_json holds linked analysis IDs (auto-pulled
    -- into charts/metrics on render).
    CREATE TABLE IF NOT EXISTS reports (
      id             TEXT PRIMARY KEY,
      workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
      template_id    TEXT NOT NULL,
      title          TEXT NOT NULL,
      subtitle       TEXT NOT NULL DEFAULT '',
      data_json      TEXT NOT NULL DEFAULT '{}',
      analyses_json  TEXT NOT NULL DEFAULT '[]',
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS reports_workspace_idx ON reports(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS reports_project_idx ON reports(project_id, updated_at DESC);

    -- Community feedback. Anyone with a workspace_id (every visitor gets
    -- one in localStorage on first load) can file a feature request / bug
    -- and upvote others'. workspace_id doubles as the (anonymous) author.
    -- vote_score is denormalized for fast list ordering; recomputed when
    -- votes change.
    CREATE TABLE IF NOT EXISTS feedback (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL DEFAULT 'feature',   -- feature|bug|idea
      title         TEXT NOT NULL,
      body          TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'open',      -- open|planned|in_progress|shipped|wontfix
      pinned        INTEGER NOT NULL DEFAULT 0,
      vote_score    INTEGER NOT NULL DEFAULT 0,
      vote_up       INTEGER NOT NULL DEFAULT 0,
      vote_down     INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      author_name   TEXT NOT NULL DEFAULT '',          -- optional display name
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback(status, vote_score DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS feedback_kind_idx   ON feedback(kind, vote_score DESC);
    CREATE INDEX IF NOT EXISTS feedback_author_idx ON feedback(workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS feedback_votes (
      feedback_id   TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      value         INTEGER NOT NULL,                  -- +1 or -1
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (feedback_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS feedback_comments (
      id            TEXT PRIMARY KEY,
      feedback_id   TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      body          TEXT NOT NULL,
      author_name   TEXT NOT NULL DEFAULT '',
      is_team       INTEGER NOT NULL DEFAULT 0,        -- set when admin posts
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS feedback_comments_idx ON feedback_comments(feedback_id, created_at);
    CREATE TABLE IF NOT EXISTS pipelines (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      dataset_id    TEXT REFERENCES datasets(id) ON DELETE SET NULL,
      steps_json    TEXT NOT NULL,         -- ordered list of {kind, op?, params}
      last_run_at   INTEGER,
      last_result_json TEXT,                -- summary of the most recent run
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS pipelines_idx ON pipelines(workspace_id, created_at);

    -- Governance: append-only audit trail. One row per significant action
    -- (analysis run, locked, deleted; dataset uploaded; phase advanced). Never
    -- updated or deleted in normal operation — the tamper-evident record.
    CREATE TABLE IF NOT EXISTS audit_log (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL,
      entity_type   TEXT NOT NULL,            -- analysis | dataset | project
      entity_id     TEXT,
      action        TEXT NOT NULL,            -- created | locked | unlocked | deleted | advanced
      detail        TEXT NOT NULL DEFAULT '',
      at            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS audit_ws_idx ON audit_log(workspace_id, at DESC);
  `);
  // Backfill column for live-update tracking. Safe to retry — ALTER skipped
  // when the column already exists.
  try { db.exec(`ALTER TABLE datasets  ADD COLUMN version INTEGER NOT NULL DEFAULT 1`); } catch {}
  try { db.exec(`ALTER TABLE analyses  ADD COLUMN dataset_version INTEGER`); } catch {}
  // Governance: lock flag so a verified analysis can't silently drift on re-run.
  try { db.exec(`ALTER TABLE analyses ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE analyses ADD COLUMN locked_at INTEGER`); } catch {}
  // Shareable read-only links: a random token grants public, no-auth view of
  // one analysis (and nothing else). Null = not shared.
  try { db.exec(`ALTER TABLE analyses ADD COLUMN share_token TEXT`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS analyses_share_idx ON analyses(share_token)`); } catch {}
  // Live data connector: the URL a dataset was pulled from, for one-click refresh.
  try { db.exec(`ALTER TABLE datasets ADD COLUMN source_url TEXT`); } catch {}
  return db;
}

// Append an audit-trail entry. Best-effort: governance logging must never
// break the primary operation, so callers can wrap in try/catch.
export function audit(db, { workspace_id, entity_type, entity_id = null, action, detail = '' }) {
  db.prepare(
    `INSERT INTO audit_log (id, workspace_id, entity_type, entity_id, action, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(cryptoRandomId(), workspace_id, entity_type, entity_id, action,
        typeof detail === 'string' ? detail : JSON.stringify(detail));
}

function cryptoRandomId() {
  // Lazy import keeps db.js dependency-light at module load.
  return globalThis.crypto?.randomUUID?.()
    || (Date.now().toString(36) + Math.random().toString(36).slice(2));
}

// Tiny helpers — JSON columns are stored as TEXT and parsed on read.
export function rowToJsonObj(row, keys) {
  if (!row) return null;
  const out = { ...row };
  for (const k of keys) {
    if (typeof out[k] === 'string') {
      try { out[k] = JSON.parse(out[k]); } catch {/* keep raw */}
    }
  }
  return out;
}
