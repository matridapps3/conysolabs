# Conyso Bench

**Black Belt precision, self-hosted. The free statistical workbench for Lean Six Sigma.**

A standalone, self-hosted, **free-forever** Lean Six Sigma statistical engine — the open alternative to Minitab.

**No LLM. No cloud. No login. No tracking.** Your data stays on your machine.

> Conyso Bench is a [Conyso Labs](https://conyso.com) project — the deterministic math layer beneath [Bill](https://conyso.com), Conyso's AI Green Belt.

## What's in the box

**27 hypothesis tests** · **9 control charts** (incl. CUSUM, EWMA, with Western Electric + Nelson rules) · **Capability** (Cp/Cpk/Pp/Ppk/Cpm/Z-bench + Box-Cox) · **Attribute capability** (binomial + Poisson) · **Gauge R&R** · **Regression** (OLS, GLM, stepwise, best-subsets, logistic, Poisson, nonlinear) · **DOE** (full, fractional, Plackett-Burman, CCD, Box-Behnken, mixture, definitive screening, RSM fit) · **Reliability** (Weibull, exponential, Arrhenius accelerated-life, with right-censoring) · **Multivariate** (PCA, k-means, LDA, hierarchical, Hotelling's T²) · **Time series** (Holt-Winters, ARIMA, auto-ARIMA, decomposition, ACF/PACF, cross-correlation) · **Post-hoc** (Tukey HSD, Fisher LSD, Games-Howell, Dunnett) · **Tolerance intervals** (normal + non-parametric) · **Pareto** · **DPMO/Sigma** · **Sample size & power** (5 cases) · **Distribution identifier** · **Capability Sixpack** · **Acceptance sampling** · **Random data generators**

Plus the UX layer that competing tools don't have:

- **Test Chooser** wizard — 3-4 questions, picks the right test, names the fallback if assumptions fail
- **Plain-English query bar** — *"capability on cycle_time"* or *"compare yield by line"* → fills the form
- **Pre-flight traffic lights** — Anderson-Darling / Levene / sample-size checks before the test runs
- **"What this means" interpreter** — every result gets a templated plain-English paragraph
- **Rule-based action plans** — "Cpk = 0.6 → run Gauge R&R first; takes a day, saves you a week"
- **"What's next?"** suggestions per analysis result
- **Pin & compare** — side-by-side analysis viewer
- **Annotations** — shift-click any chart point to add a note
- **Recipes** — save any analysis to re-run later
- **Inline param help** — `?` icon on every input
- **Click-to-zoom charts**, **Cmd-K palette**, **keyboard shortcuts**, **dark mode**, **mobile responsive**

## Quick start (Docker)

```bash
docker compose up
# Open http://localhost:3000
```

That's it. SQLite + filesystem storage — no Postgres, no Redis, no S3.

## Deploying to Railway (the hosted `bench.conyso.com`)

The hosted Conyso Bench at [bench.conyso.com](https://bench.conyso.com) runs as a **single Railway service** built from the root [`Dockerfile`](Dockerfile) — Node server + Python sidecar in one container, sharing a Railway volume.

1. **Create a new Railway project** from this repo. Railway auto-detects `railway.toml` + `Dockerfile`.
2. **Attach a volume** to the service, mount point `/data`. (Defaults to ~1GB; raise if you expect large uploads.)
3. **Add a custom domain** `bench.conyso.com` in Railway → Settings → Networking. Copy the CNAME target it gives you (e.g. `your-service.up.railway.app`).
4. **At Cloudflare**, add a CNAME record: `bench` → that Railway target. Set the proxy to **DNS only** (grey cloud) — Railway issues its own Let's Encrypt cert; Cloudflare's orange-cloud proxy interferes with first-issue and isn't needed for a stateless static workload at this scale.
5. Railway redeploys, the cert provisions in ~1 minute, and `https://bench.conyso.com` is live.

For self-hosters running anywhere else, the two-service `docker-compose.yml` is still the supported path — see *Quick start (Docker)* above.

## Quick start (local)

```bash
# Python sidecar
cd sidecar
pip install -e .
uvicorn app:app --host 0.0.0.0 --port 8000

# In another terminal — Node server
cd server
npm install
npm start
# Open http://localhost:3000
```

## Configuration

All optional — sensible defaults out of the box.

| Env var | Default | Purpose |
|---|---|---|
| `PORT`         | 3000                  | Node HTTP port |
| `SIDECAR_URL`  | http://localhost:8000 | Where the Python sidecar listens |
| `DATA_DIR`     | ./data                | Filesystem dir for uploaded files + charts |

## File layout

```
server/         Node Express — UI + SQLite metadata + sidecar proxy
  public/      Frontend SPA (vanilla JS, no framework)
  routes/      analyses · datasets · tools · workspaces
  lib/         db.js (SQLite) · sidecar.js (HTTP client)
  data/        SQLite file + uploaded artifacts (auto-created)

sidecar/        Python FastAPI — all the math
  app.py       Endpoint dispatcher
  stats/       25 statistical modules
  parsers/     CSV / Excel / PDF parsers
  wrangle/     Outlier detection
  tests/       Pytest suite (108 tests)
```

## Costs

The whole engine costs **$0 per call** to run.

- No LLM API charges (everything is deterministic / rule-based)
- No external services
- One small server + one small Python process

You could run it on a $5/mo VPS for a thousand users without thinking about it.

## License

**GNU AGPL-3.0-or-later.** Copyright © 2026 Conyso. See [LICENSE](LICENSE) for the full text.

What this means in plain English:
- **Free to use, modify, and self-host.** Forever.
- **If you run a modified version as a network service**, you must publish your modifications under the same license. (This is the "Affero" clause — it stops a cloud vendor from forking Bench, closing it, and reselling it.)
- **Commercial use is fine** as long as you comply with the license.

Need a different license (e.g. to embed Bench in a closed-source product)? Contact `hello@conyso.com` about a commercial license.

## Marketing page

The hosted version lives at `bench.conyso.com`. Marketing copy ships with [Conyso](https://conyso.com), not this repo.

## What this *doesn't* have

- LLM-drafted documents (charters, FMEAs, control plans)
- AI chat
- Multi-tenant SaaS (auth, billing, plans)
- Real-time collaboration
- Mobile native apps

Those live in the full product. This is the engine in its rawest form, ready to ship.

## Testing

```bash
# Python sidecar — 108 tests
cd sidecar
pytest

# Node server — none yet for this slim version; add as you go.
cd server
npm test
```
