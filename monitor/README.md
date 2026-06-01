# Conyso Bench Monitor

A tiny, self-contained **continuous-SPC watchdog**. Point it at a CSV data
source (a published Google Sheet, an export endpoint, any public CSV URL); it
polls on an interval, computes **I-MR control limits**, and fires a webhook
when a **new out-of-control signal** appears.

- **No database, no AI, no dependency on a running Bench** — one Node process.
- Deterministic SPC math (I-MR + Nelson rules 1 & 2).
- Deploy it as its own service (Railway, a cron box, a Docker host) — or `npx` it.

## Run

```bash
MONITOR_SOURCE_URL="https://docs.google.com/.../pub?output=csv" \
MONITOR_COLUMN="cycle_time" \
MONITOR_INTERVAL_SEC=300 \
MONITOR_ALERT_WEBHOOK="https://hooks.slack.com/services/…" \
node index.js
```

Or with a JSON config file:

```bash
node index.js ./monitor.config.json
```

```json
{
  "sourceUrl": "https://…/data.csv",
  "column": "cycle_time",
  "intervalSec": 300,
  "webhook": "https://hooks.slack.com/services/…",
  "label": "Line 3 cycle time"
}
```

## What it does each poll

1. Fetches the CSV (SSRF-guarded: only public http/https hosts).
2. Computes the centerline, σ (from the average moving range), and 3σ limits
   for the chosen column.
3. Detects signals — Nelson rule 1 (point beyond 3σ) and rule 2 (9 in a row on
   one side = a process shift).
4. If there are **more** signals than the previous poll, POSTs an alert to the
   webhook (Slack/Teams-compatible `text` field plus the full signal payload),
   and always logs the current limits to stdout.

## Config

| Env | JSON key | Default | Meaning |
|-----|----------|---------|---------|
| `MONITOR_SOURCE_URL` | `sourceUrl` | — (required) | Public CSV URL |
| `MONITOR_COLUMN` | `column` | — (required) | Numeric column to chart |
| `MONITOR_INTERVAL_SEC` | `intervalSec` | `300` | Poll interval (seconds) |
| `MONITOR_ALERT_WEBHOOK` | `webhook` | none | Alert POST target (else stderr) |
| `MONITOR_LABEL` | `label` | the column name | Friendly monitor name |

## Test

```bash
npm test
```

AGPL-3.0-or-later · part of [Conyso Bench](https://bench.conyso.com).
