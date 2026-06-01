# Engineering TODO — License change + pricing/packaging model

**Date:** 2026-06-01
**Goal:** Implement the move to BSL 1.1 → AGPL and the "free in browser / paid self-host
($49 indiv, $499 company) / Bill trial" model.

Priority: **P0** = needed to launch the new model · **P1** = soon after · **P2** = later.
"Blocked on" = waiting on something external.

---

## A. License & legal text in code  (P0 — mechanical; engineering owns)
*Most can be staged now; the exact LICENSE wording is **blocked on counsel** (see `docs/legal/counsel-brief.md`).*
- [ ] Write new `LICENSE` = **BSL 1.1** with finalized parameters (Licensor entity, Additional Use Grant, Change Date 2030-06-01, Change License = AGPL-3.0).
- [ ] Move current AGPL text → `LICENSE-AGPLv3.txt` (the Change License reference).
- [ ] Flip license metadata to **`BUSL-1.1`**: `server/package.json`, `monitor/package.json`, `sidecar/pyproject.toml`.
- [ ] Update in-product AGPL strings to the BSL line — files that mention it today:
  - `README.md` (License section)
  - `server/lib/dossier.js` (PDF dossier footer)
  - `server/lib/reports/render.js` (report footer)
  - `server/public/js/view/views-home.js` ("Bench source code" link copy)
  - `monitor/README.md`, `LAUNCH.md`, `HANDOFF.md`, `docs/marketing/comparison.md`
- [ ] Keep `server/test/smoke.test.js` "no-LLM/no-auth" scans green (they read the JS tree, not the license — unaffected, but re-run).

## B. Build modes: hosted vs self-host  (P0 — architectural, important)
The self-host artifact must stay **zero-telemetry** (it's a core selling point and a privacy promise). The hosted app may have analytics/limits/upsell. So split behavior by a runtime flag.
- [ ] Add `BENCH_MODE = selfhost | hosted` (env, default `selfhost`).
- [ ] **Self-host build:** no outbound calls, no telemetry, no rate limits, no upsell nags, full features. (Audit: confirm zero network egress except the local sidecar.)
- [ ] **Hosted build:** product analytics (disclosed in Privacy Policy), rate limits + dataset caps (§C), and the upsell CTAs (§F).
- [ ] **No license-key / phone-home enforcement anywhere** — honor system + legal, by design. (Optional: allow a customer to drop in a non-enforcing license file for their own records.)

## C. Hosted free-tier guardrails (COGS control)  (P0/P1)
Every analysis runs the Python sidecar (stats + matplotlib) on our infra → real compute cost.
- [ ] Rate limit on the hosted instance (per workspace/IP).
- [ ] Dataset row/size caps on the free hosted tier (self-host = unlimited).
- [ ] Basic abuse protection (upload size, request flood).

## D. Distribution of the self-host artifact  (P0)
- [ ] Publish the Docker image to a registry (GHCR or Docker Hub), versioned/tagged, **publicly pullable** (free to pull; the license governs use — standard source-available).
- [ ] Self-host quickstart in `DEPLOY.md` / `HANDOFF.md`: `docker run -p 3000:3000 -v bench-data:/data <image>` + the `/data` volume note + the "$49/$499 license for company production" qualifier.
- [ ] Confirm the image carries the new `LICENSE`.

## E. Commerce / billing  (P0 for revenue; can lag the free-browser launch)
Likely lives on the **marketing site** (website owner), but engineering wires the plumbing.
- [ ] Stripe products/prices: **$49 individual (one-time)**, **$499 company (one-time)**, **20%/yr maintenance (optional recurring)**.
- [ ] Self-serve checkout → fulfillment: email receipt + license doc + image-pull / download instructions. No human in the loop.
- [ ] Decide license-record format (PDF/key) — informational only, not enforced.

## F. Funnel hooks in the hosted app  (P1)
- [ ] "Self-host to keep your data private" CTA in the hosted app (data-control upsell).
- [ ] Bill upsell CTA ("Bench shows what the data says — Bill tells you what to do next").
- [ ] On company self-host purchase → provision the **3-month Bill trial** (card on file, fair-use cap, auto-convert) — hand-off to Bill (§G).

## G. Bill handoff (separate product)  (P2)
- [ ] Bill trial provisioning + usage metering/cap + auto-conversion + dunning.
- [ ] Cross-product account/license linking (self-host license → Bill trial entitlement).

## H. Trademark / brand  (P1 — after filing)
- [ ] Add ™/® to the brand mark in the UI once registered.
- [ ] Add `TRADEMARK.md` / brand-usage `NOTICE` to the repo (forks must rebrand).

## I. Privacy / telemetry audit  (P0 — cross-cutting)
- [ ] Verify the **self-host build makes no outbound requests** (preserve the "no telemetry, your data never leaves your box" claim).
- [ ] Ensure any hosted-only analytics are gated behind `BENCH_MODE=hosted` and disclosed in the Privacy Policy.

---

## Sequencing
1. **Now (no blockers):** §B build-mode flag, §C hosted guardrails, §D publish image + self-host quickstart, §I telemetry audit. The free browser app already works — these make it safe to open up.
2. **On counsel sign-off:** §A license files + in-product strings.
3. **For monetization:** §E Stripe + fulfillment, then §F funnel hooks.
4. **Parallel track:** §G Bill, §H trademark (after filing).

## Dependencies
- §A blocked on counsel's final Additional Use Grant + entity name (`docs/legal/counsel-brief.md`).
- §E blocked on the legal entity + bank/Stripe account.
- §G is the Bill product's own roadmap.
- §H blocked on trademark filing.
