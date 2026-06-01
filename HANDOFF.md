# Conyso Bench — Deployment Handoff

**Status: ready to deploy.** All tests green, full stack verified end-to-end
(see "Verification done" below). One hard prerequisite before/at deploy → the
`/data` volume. Pairs with `DEPLOY.md` (longer reference).

---

## TL;DR
- Single container (Node + Python in one image). Build = Dockerfile. Deploy target = Railway (`railway.toml` present).
- **No secrets, no env vars required.** No LLM / Stripe / S3 / auth / DB server. AGPL-3.0.
- ⚠️ **You MUST attach a Railway volume mounted at exactly `/data`** or all user data is wiped on every redeploy.

---

## 1. The one thing you can't skip — persistent volume
All state (SQLite `engine.db`, uploaded rows, chart artifacts) is written under
`DATA_DIR=/data`. Railway container disks are ephemeral.

**Action:** Railway → Service → Settings → **Volumes** → add a volume with mount
path **exactly `/data`**.

The server logs a loud `⚠️ DATA WILL NOT PERSIST` at startup if the volume is
missing — check the deploy logs to confirm you don't see it.

## 2. How it builds & runs
- **Build:** `Dockerfile` (python:3.12-slim base, adds Node 20). Installs the
  sidecar (`pip install -e ./sidecar`) and server (`npm ci --omit=dev`).
- **Run:** `start.sh` (via `tini`) launches the FastAPI sidecar on
  `127.0.0.1:8000`, waits for its `/healthz`, then starts the Node server on
  `0.0.0.0:$PORT`.
- **Defaults baked into the image:** `DATA_DIR=/data`,
  `SIDECAR_URL=http://127.0.0.1:8000`, `PORT=3000`. Railway sets `$PORT`; the
  server honors it.
- **Health check:** `railway.toml` uses `healthcheckPath=/` (a healthy `/`
  implies the whole stack is up, since sidecar readiness is gated in start.sh).

No environment variables are required. (Optional knobs, if ever needed, are in
`.env.example`.)

## 3. Pre-deploy checks (optional — already green here)
```
cd sidecar && python3 -m pytest -q        # 383 passed
cd server  && npm test                    # 69 passed
cd monitor && node --test                 # 6 passed   (only if deploying the monitor)
```

## 4. Post-deploy smoke test (2 minutes)
1. Open the deployed URL → SPA loads (left nav rail with 8 sections).
2. Deploy logs: confirm `sidecar ready` and **no** `DATA WILL NOT PERSIST` warning.
3. Data → **Load a sample** (e.g. "Cycle time") → Analyze → **Run capability** →
   you get a result card with numbers **and a chart** (chart proves the
   Node→sidecar→`/artifact` path works).
4. Press **⌘K** (search), open the **Tour** (header), click **Catalog** — all should render.
5. Redeploy once and confirm your test dataset is still there (proves the volume).

## 5. What's in the box (architecture)
- `server/` — Node/Express: serves the SPA, owns SQLite + REST API, proxies to the sidecar. (`routes/`=controllers, `lib/`=services, `public/`=view; see `server/ARCHITECTURE.md`.)
- `sidecar/` — Python/FastAPI: all statistics + matplotlib charts. Localhost-only, not publicly exposed.
- `server/public/js/` — the SPA, split into an MVC tree of plain `<script>` files (no build step). See `server/public/js/README.md`.

## 6. Optional separate service — `monitor/`
A standalone continuous-SPC watchdog (polls a CSV URL, alerts a webhook). **Not
required** for the main app. Deploy it separately only if a customer wants live
monitoring. Config via env (`MONITOR_SOURCE_URL`, `MONITOR_COLUMN`,
`MONITOR_ALERT_WEBHOOK`, …) — see `monitor/README.md`.

## 7. Known non-blockers (ship with these)
- 6 dead/unused functions in `server/public/js/view/stats-ux.js` (harmless; cleanup later).
- Two very low-severity UI edge cases (tour spotlight if a user clears the demo + has zero analyses; a transient flash on double-submitting the query bar). Neither is reachable in normal use.
- No multi-user/auth (single anonymous workspace by design).

## 8. Rollback
Stateless app + external `/data` volume → redeploy the previous image/commit in
Railway. Data on the volume is unaffected by rollback.

---

## Verification done before handoff
- Tests: sidecar **383**, server **69**, monitor **6** — all passing.
- NIST StRD numerical validation: **10/10** (regression core certified to 10+ sig digits).
- Browser: all **24 views + 13 analysis families + 15 calculators** render with **zero console errors**; Lens page boots clean; capability analysis runs end-to-end.
- Front-end MVC split verified byte-identical to the prior `app.js` (no behavior change).
