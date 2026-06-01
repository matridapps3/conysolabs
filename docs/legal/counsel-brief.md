# Instruction Brief for Counsel — Conyso Bench: Licensing & IP

**Date:** 2026-06-01 · **For:** IP / open-source-savvy attorney
**Prepared by:** Conyso (engineering/founder)

**Objective:** Move Conyso Bench from AGPL-3.0 to a source-available license that is
free to use in our hosted browser app, charges a small one-time fee to self-host,
and converts to open source after 4 years — plus the commercial agreements, IP
filings, and disclaimers around it.

> Engineering will implement the `LICENSE` file and in-product license strings to
> match whatever you finalize. The items below are the legal deliverables and the
> business intent behind each.

---

## 1. Public license change — adopt Business Source License 1.1
Replace the current AGPL-3.0 `LICENSE` with **BSL 1.1**, filling these parameters:
- **Licensor:** [our exact registered legal entity — please confirm name].
- **Licensed Work:** "Conyso Bench," © 2026 Conyso, the version as released.
- **Change License:** **GNU AGPL v3.0-or-later** (each version becomes AGPL).
- **Change Date:** **4 years after each version's release** (current version: 2030-06-01) — please advise on per-release handling.
- **Additional Use Grant — the key clause to draft to this intent:** *Use of the hosted service at conyso.com is free. Self-hosting/deploying the software, and any production or commercial use, requires a commercial license from Licensor* (brief evaluation/testing of the self-hosted build may be permitted — your call on scope). This clause is the heart of the model; please word it so a company's legal team has zero ambiguity that **company production self-hosting requires a paid license**.

## 2. Commercial license agreement (what customers buy)
A short, self-serve commercial license (the $49 / $499 purchases) covering:
- **Two tiers:** (a) **Individual — $49 one-time, perpetual,** single person, own machine; (b) **Company — $499 one-time, perpetual, per deployment,** for-profit production use.
- **Perpetual grant; non-transferable; internal use; no right to redistribute or offer as a competing service.**
- **Updates/maintenance:** individual = updates included; company = optional **20%/yr** maintenance for updates + (limited) support. **No support SLA** by default (docs/community).
- **Bundle:** company tier includes **3 months of Bill** (see §4).
- Warranty disclaimer + limitation of liability (see §6), termination on breach, audit right, governing law/venue [please advise].

## 3. Hosted browser app — Terms of Service + Privacy Policy
Because the **free browser version sends user data to our cloud**, we need:
- **ToS** for the hosted app (acceptable use, IP, disclaimers, termination).
- **Privacy Policy** + a **Data Processing Addendum** for business users (what we collect, retention, no sale of data, security; GDPR/CCPA as applicable). Our positioning is privacy-forward, so this should be clean.

## 4. Bill (AI product) — subscription terms
Separate product; needs subscription terms covering: **3-month free trial that auto-converts to paid** (card on file, advance notice), fair-use/usage caps, and an **AI-output disclaimer** (recommendations are decision-support, not professional/engineering advice; human review required).

## 5. Trademark
Register **"Conyso"**, **"Conyso Bench"**, and the logo (software + SaaS classes — e.g., Nice 9 & 42), in our priority jurisdictions. This is our main fork deterrent (forks must rebrand). We'll add a brand-usage policy to the repo once filed.

## 6. Liability & regulated-use disclaimers (cross-cutting — important)
Our outputs feed **quality decisions in regulated industries** (pharma, medical-device, defense). Across the LICENSE, commercial license, and ToS we want strong:
- **"AS IS," no warranty of merchantability or fitness for a particular purpose.**
- **No validation/qualification representation:** the user is responsible for validating/qualifying the software for their own regulated use (e.g., GxP / computer-system validation); statistical results are tools, not certified regulatory compliance.
- **Limitation of liability** (cap to fees paid; exclude consequential damages).

## 7. IP ownership / contributions
- Confirm **Conyso owns 100% of the copyright** (currently sole-authored) — this is what lets us dual-license.
- Put a **Contributor License Agreement (or DCO)** in place before accepting outside contributions, so contributions are licensed/assigned to us and we retain relicensing/dual-license rights.

## 8. Decisions we need counsel to confirm
1. Exact **legal entity** name as Licensor.
2. Final **Additional Use Grant** wording (§1).
3. **Change Date** mechanics (per-release vs fixed).
4. **Governing law / venue** for the commercial license and ToS.
5. Whether to keep the prior AGPL text available as `LICENSE-AGPLv3` (the Change License reference) — we'd like to.

---

## Reference — current state (for context)
- Repo currently ships AGPL-3.0 (`LICENSE` = full AGPL text); `package.json` / `pyproject.toml` declare `AGPL-3.0-or-later`. These will be updated to `BUSL-1.1` once the license is finalized.
- Product is deterministic (no LLM in Bench), self-hostable via Docker, validated against NIST StRD. Bill (the AI product) is separate.
- Related internal docs: `docs/marketing/license-change-brief.md` (website/pricing rollout).
