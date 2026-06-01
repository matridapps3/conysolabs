# Architecture (MVC mapping)

Conyso Bench = Node/Express app server + Python/FastAPI stats sidecar + vanilla-JS SPA.

## Server (`server/`) — MVC
- **Controllers** → `routes/*.js` (analyses, datasets, tools, projects, reports,
  pipelines, feedback, workspaces). HTTP in, validation, delegate to services.
- **Models / services** → `lib/*.js`: `db.js` (SQLite + migrations + audit),
  `sidecar.js` (stats client), `samples.js`, `share.js`, `provenance.js`,
  `dossier.js`, `reports/`. Data access + domain logic.
- **View** → `public/` (the SPA + shared/embedded result HTML in `lib/share.js`).
- Composition root: `index.js` (mounts routes, static, /artifact proxy, /share).

Directories are kept as-is (not renamed to controllers/ services/) to avoid
churning imports across 8 routes + 69 passing tests for a cosmetic change.

## Sidecar (`sidecar/`) — MVC
- **Controller** → `app.py`: FastAPI routes, request models, the JSON/artifact
  serialization boundary (the "view" of the API).
- **Models / services** → `stats/*.py`: one module per analysis family
  (capability, control_chart, hypothesis, regression, posthoc, …). Pure
  compute; return summaries + chart bytes.

## Front-end (`server/public/js/`)
See `server/public/js/README.md`. Model / view / controller split of the
former `app.js`, loaded as ordered non-module scripts (no build step).
