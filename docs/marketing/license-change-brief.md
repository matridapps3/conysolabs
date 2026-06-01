# Website & Marketing Brief — License + Pricing Launch

**For:** website/marketing owner · **Product:** Conyso Bench · **Date:** 2026-06-01
**Covers:** the licensing change (AGPL → BSL→AGPL), the pricing/packaging, and exactly
what to change on the site — with copy you can paste.

> Plain-English brief. Where it says "[lawyer-confirm]", don't publish exact legal
> wording — link to the `LICENSE` file instead (see §9).

---

## 0. TL;DR
- Bench moves from **AGPL-3.0** to **Business Source License 1.1 (BSL)**, which **auto-converts to AGPL-3.0 after 4 years**. Source stays public the whole time.
- **Free to use in the browser** (hosted at conyso.com) — for everyone. This is the only free way to *use* it.
- **Self-host = paid:** **$49 one-time** for an individual, **$499 one-time** for a company. Both perpetual.
- The company tier adds optional 20%/yr updates **and 3 months of Bill free**.
- The pitch: **"Free in your browser. Self-host to keep your data in-house — from $49, vs Minitab at ~$1,700 per seat every year."**
- Bench is **top-of-funnel**; the business is **Bill** (the AI Green Belt). Everything points there.

---

## 1. The model in one picture
```
FREE  ──────────────►   PAID self-host   ──────────────────────►   BILL (the business)
Use Bench in the        $49 individual / $499 company                Subscription.
browser (hosted).       one-time · perpetual · keep data in-house    3 months free with every
The funnel.             Company: +20%/yr updates, qualifies lead     company self-host license.
```
**Free browser = adoption. Paid self-host = data control (and lead qualification). Bill = revenue.**

---

## 2. The license change (what to tell people)
- **Now:** Business Source License 1.1 (BSL). The full source is **public** on day one — read it, learn from it, evaluate it.
- **Free to use:** in the **hosted browser app** at conyso.com.
- **Self-hosting requires a license:** running Bench on your own machine/infra needs a commercial license — **$49 individual / $499 company.**
- **Auto-opens:** each released version **converts to the GNU AGPL-3.0** (full open source) **4 years after release** (current version converts 2030-06-01).
- **One-liner:** *"Source-available today, open-source (AGPL) tomorrow — free in the browser, low-cost to self-host."*

**Same model as HashiCorp, MariaDB, Sentry.** It is **not** "going closed source" — don't say that.

---

## 3. Pricing & packaging
| Plan | Who it's for | Price |
|---|---|---|
| **Browser** | Anyone — use Bench in the browser at conyso.com | **Free** |
| **Self-host — Individual** | One person, on your own machine | **$49 one-time** · perpetual · updates included |
| **Self-host — Company** | For-profit production, your own infrastructure | **$499 one-time** per deployment · perpetual · +20%/yr updates (optional) · **3 months of Bill free** |
| **Bill** (separate product) | AI Green Belt that turns results into actions | Subscription (3 months free with any Company self-host license) |

Notes for the page:
- Both self-host tiers are **self-serve** (Stripe checkout → instant license). No sales calls, no quotes.
- Support = **docs + community** (not a human SLA). Don't advertise hands-on support.
- Always show the Minitab contrast: **"from $49 once vs ~$1,700 per seat, every year."**

---

## 4. Positioning & key messages (per audience)
- **Individuals / learners:** "Use it free in your browser. Want it on your own machine, offline, your data private? Self-host for **$49** — once, forever." (Lead with the free browser.)
- **Companies:** "Try it free in the browser. Run it in production with your data staying in-house: self-host for **$499 once** — less than a single Minitab seat for one year."
- **Regulated / privacy-driven (pharma, med-device, defense):** "Self-host so **your data never leaves your building** — air-gapped, auditable, NIST-validated."
- **Open-source community:** "Source-available now, AGPL in 4 years. Read every algorithm; contribute."

---

## 5. Messaging guardrails (read before writing copy)
**On "open source":**
- ✅ Say: **"source-available"**, "free in the browser", "becomes AGPL open-source after 4 years", "the source is always public".
- ❌ Don't say: **"open source"** unqualified, "closed source", "proprietary", or imply self-hosting is free.

**On "your data never leaves your box":**
- This is a property of **self-host (paid)**, NOT the free browser version. Free browser users' data goes to **our** cloud.
- ✅ Use privacy/on-prem/air-gapped language as the **reason to self-host**: *"Try it free in your browser → self-host to keep your data in-house."*
- ❌ Don't put "your data never leaves your box" on the free browser tier — it isn't true there.

**On pricing:** always one-time + "cheaper than Minitab". Never imply recurring per-seat fees.

---

## 6. Concrete site changes (page by page)
1. **Footer / license badge:** `AGPL-3.0` → **"Source-available · BSL 1.1 → AGPL-3.0"**. Footer line: *"Conyso Bench — source-available (BSL 1.1, converts to AGPL-3.0). Free in browser; self-host from $49."*
2. **New Pricing page** with the §3 table + the §7 license FAQ.
3. **Homepage hero:** keep "free Lean Six Sigma stats engine", change any "open-source/AGPL" line to source-available framing, add dual CTA: **[Use free in browser]** / **[Self-host →]**.
4. **"Bench source code" link** (currently "AGPL-3.0. Read the algorithms, fork, contribute") → *"Source-available (BSL 1.1 → AGPL-3.0). Read every algorithm. Free in browser; self-host from $49."*
5. **Self-host / Docker section:** keep the `docker run` quickstart, add the qualifier line (§7).
6. **"Validated/NIST" trust section:** add *"Need it on-prem with your data in-house? Self-host →"* to convert privacy-driven buyers.
7. **In-product strings** (we update in code): report/PDF footers and the SPA "source code" line move from "AGPL-3.0" to the BSL line — keep site copy consistent.

---

## 7. Ready-to-paste copy

**Hero sub-line**
> The free Lean Six Sigma statistical workbench. Minitab-grade analysis — deterministic, validated against NIST, no AI black box. Use it free in your browser, or self-host to keep your data in-house.

**Pricing cards**
> **Browser — Free.** Full Bench in your browser. No signup to try. Your fastest start.
> **Self-host — Individual — $49 once.** Run it on your own machine, offline, your data private. Perpetual license, updates included.
> **Self-host — Company — $499 once.** Production use on your own infrastructure. Perpetual license, optional 20%/yr updates, your data never leaves your building — and **3 months of Bill included**. Less than one Minitab seat for a single year.

**Docker quickstart qualifier (paste under the existing `docker run` block)**
> Free to try in the browser. Self-hosting requires a one-time commercial license — **$49 for an individual, $499 for a company** — perpetual, and your data never leaves your box.

**Footer**
> Conyso Bench — source-available under BSL 1.1, converts to AGPL-3.0 after 4 years. Free in browser; self-host from $49. © 2026 Conyso.

**License FAQ (drop-in)**
> **Is Bench free?** It's free to use in your browser. Self-hosting it (running it yourself) is a one-time $49 for an individual or $499 for a company.
> **Is it open source?** It's *source-available*: the full source is public, and each release becomes AGPL-3.0 open source 4 years after release.
> **Why pay to self-host if the browser is free?** To keep your data in-house — self-hosting means your data never touches our cloud. That's the point of self-host: data control, offline, on-prem, air-gapped.
> **What's the difference between $49 and $499?** $49 is for one individual on their own machine. $499 is a company deployment (production use), with optional yearly updates and 3 months of Bill included.
> **What does it cost vs Minitab?** From $49 once (individual) / $499 once (company) — vs Minitab at ~$1,700 per seat, every year.
> **What's Bill?** Our AI Green Belt — turns your analysis results into recommended next steps. Three months free with any company self-host license, then a subscription.
> **What happens in 4 years?** Each version automatically becomes GNU AGPL-3.0 — fully open source.

---

## 8. The Bill funnel mechanic (set expectations on the page)
- Every **Company self-host** license includes **3 months of Bill free** (fair-use capped).
- Card on file at checkout; Bill converts to a paid subscription after 3 months with advance notice.
- Frame Bill as the upgrade: *"Bench shows you what the data says. Bill tells you what to do next."*
- Don't over-promise: privacy-driven self-host buyers may not adopt a cloud AI — that's fine; the 3 months is the offer, not a guarantee.

---

## 9. Three fields the lawyer must finalize (do NOT publish verbatim)
Site links to `LICENSE`; never quote these:
1. **Licensor legal entity** (e.g., "Conyso, Inc.") — exact registered name.
2. **Additional Use Grant** wording — the precise "browser/evaluation free; self-hosting requires a commercial license" clause.
3. **Change Date** — set to 4 years (current version: 2030-06-01); confirm per-release handling.

Also pending: **trademark** "Conyso" / "Conyso Bench" — once filed, add ™/® and a brand-usage note (forks must rebrand).

---

## 10. Launch checklist
- [ ] Footer/badge updated to BSL→AGPL source-available line
- [ ] Pricing page live (table + FAQ)
- [ ] Hero dual CTA: Use free in browser / Self-host
- [ ] "Source code" + Docker sections carry the self-host-license qualifier
- [ ] Privacy/"data never leaves your box" tied to self-host only
- [ ] No unqualified "open source" anywhere
- [ ] Stripe self-serve checkout: $49 individual + $499 company (+ 3-mo Bill on company)
- [ ] `LICENSE` link points to the new BSL file
- [ ] Copy matches in-product footers (we update those in code)
