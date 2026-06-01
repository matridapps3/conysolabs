# Launch checklist

## Pre-launch

- [x] Pick a name — **Conyso Bench**
- [x] Add a `LICENSE` file — AGPL-3.0-or-later
- [x] Search the codebase for the old name and rebrand
- [x] Update `package.json` `name` field
- [x] Update `pyproject.toml` `name` field
- [x] Add a one-line `<meta name="description">` to `index.html`
- [ ] Replace the favicon SVG in `server/public/index.html` with the Conyso mark
- [ ] Write the marketing page on `conyso.com` (separate repo)
- [ ] Point `bench.conyso.com` DNS at the hosted instance

## Deployment options

### 0. Railway (how `bench.conyso.com` is hosted)

Conyso ships Bench as a single Railway service using the root `Dockerfile` (combined Node + Python container) and a `/data` volume. Pairs with Cloudflare DNS:

1. **Railway** → New Project → Deploy from this repo. It picks up `railway.toml` + `Dockerfile` automatically.
2. **Volume** → attach at mount path `/data` (1GB is plenty to start).
3. **Custom domain** → Settings → Networking → add `bench.conyso.com`. Copy the CNAME target Railway provides.
4. **Cloudflare DNS** → CNAME `bench` → the Railway target. **Proxy: DNS only (grey cloud).** Railway issues Let's Encrypt itself; CF proxy interferes with cert issuance and isn't needed.
5. Wait ~60 seconds for the cert. Verify `curl -I https://bench.conyso.com` returns `200`.

Cost: one Railway service on the Hobby plan + the volume ~ **$5–10/mo**.

To flip Cloudflare's proxy on *later* (for caching / DDoS): set SSL mode to **Full (strict)** in the CF dashboard first, *then* toggle the orange cloud. Don't do this before the cert is stable.

### 1. Docker Compose (recommended for self-hosters)

Any VPS with Docker. **$5/mo Hetzner / DigitalOcean droplet is enough for thousands of users** — most cost is matplotlib at chart-render time, which is ~50ms.

```
git clone YOUR_REPO
cd YOUR_REPO
docker compose up -d
```

Add nginx in front for HTTPS:

```nginx
server {
  listen 443 ssl;
  server_name stats.example.com;
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    client_max_body_size 30M;     # uploads
  }
}
```

### 2. Fly.io / Railway / Render

Both services support multi-service apps (the Node + Python). Use the supplied Dockerfiles. The Python sidecar needs ~500MB RAM minimum because of pandas/numpy.

### 3. Bare metal

```
# In /etc/systemd/system/fse-sidecar.service
[Service]
ExecStart=/path/to/venv/bin/uvicorn app:app --port 8000
WorkingDirectory=/srv/conyso-bench/sidecar
Environment=DATA_DIR=/srv/data

# In /etc/systemd/system/fse-server.service
[Service]
ExecStart=/usr/bin/node index.js
WorkingDirectory=/srv/conyso-bench/server
Environment=PORT=3000
Environment=SIDECAR_URL=http://127.0.0.1:8000
```

## Scaling

- **SQLite handles 10–50 concurrent users without breaking sweat.** If you ever exceed that, swap `lib/db.js` for Postgres — same table shape, ~30 lines to migrate.
- **Sidecar is CPU-bound** at chart render time. Scale horizontally with a load balancer in front; each sidecar instance is stateless.
- **Storage is local filesystem** by default. For multi-instance, point `DATA_DIR` to a shared volume (NFS, EFS, etc.) or swap the sidecar's `_get_bytes` / `_put_bytes` for S3.

## Monitoring

- `GET /api/workspaces/test` — should return 404 quickly. Use as a basic health probe.
- `GET /artifact/<key>` — serves chart PNGs through the proxy.
- Sidecar exposes `GET /healthz` directly on port 8000.

## Privacy posture

What you can advertise honestly:
- **No data leaves the server.** No analytics, no tracking, no LLM API calls.
- **No login.** Workspace ID lives in the browser's localStorage. Whoever has the URL + ID has access — keep the URL private or add auth in front (Caddy basic-auth, Cloudflare Access, etc.) if needed.
- **One file is the entire database** (`server/data/engine.db`). Backup = copy that file.

## Things to add later

- **Basic auth or magic-link login** — if you want multi-user without each browser being its own silo.
- **Postgres + S3** — if you want to scale horizontally.
- **Schedule recurring analyses** — control-chart-as-a-monitor, alerts on rule violations.
- **Public read-only share links** — let users share an analysis result by URL.
- **Theme white-labeling** — `styles.css` uses CSS custom properties; one variable change re-themes the whole app.

## Don't forget

- Add a `LICENSE` file before you publish.
- Tag a v1.0.0 release.
- Write the marketing page somewhere else — keep this repo just the product.
