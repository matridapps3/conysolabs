# Bench vs. Minitab — comparison page (rev 2026-05-22)

This is the canonical source for the `conyso.com/bench/vs-minitab` page. Edit
here, then sync to the marketing site. Any change that contradicts the
software (e.g. "now supports X") must land in code first.

---

## Conyso Bench

**Bench vs. Minitab.**
A line-by-line comparison. Where Bench matches, where it differs, where Minitab still leads.

## The honest version

**Two workbenches, two trade-offs.**

Minitab has been the default Lean Six Sigma toolkit for over fifty years. It is trusted, well-validated, and well-documented. It is also closed-source, license-locked, Windows-first, and costs roughly $1,700 per user per year.

Conyso Bench was built to do most of what a Black Belt actually uses Minitab for — free, self-hosted, web-based, and released under AGPL-3.0. The trade-offs are real in both directions. This page is the honest map.

---

## Pricing & access

**What it costs to get started.**

### Conyso Bench — Free
Forever. AGPL-3.0.

- Self-hosted via Docker
- Hosted free at `bench.conyso.com`
- No login, no account, no tracking
- Web-based — runs in any browser
- Source available; fork it
- **Dual-licensing on request** (closed-source embed)

### Minitab — ~$1,700 per user, per year. Subscription.
- Desktop install (Windows; macOS via Parallels)
- License-locked to machine or user
- Account required for activation
- Closed-source
- Volume pricing for enterprise

> **Enterprise support, optionally.** The engine is AGPL-3.0 and free forever. For teams that need an institutional safety net, **Conyso Labs offers** commercial dual-licensing (closed-source embedding), priority bug-fix SLAs, custom deployments behind enterprise firewalls, validation-package authoring for regulated industries, and on-call hours for production incidents. Pricing is per-engagement, not per-seat — a flat retainer that costs less than five Minitab seats and covers your whole org. Contact `hello@conyso.com`.

---

## Methodological provenance

**Bench is not new math.**

Every hypothesis test, control chart, and capability calculation in Bench is implemented on top of the standard scientific Python stack: **SciPy** (`scipy.stats`), **statsmodels**, **NumPy**, and **pandas**. These are the same libraries that power Jupyter, JMP's Python integration, pharma's submission pipelines, and the methods sections of thousands of peer-reviewed papers.

**Verification.** Bench's test suite ships **210 cross-validation cases** — 141 Python tests on the math sidecar (54 functional + 20 Minitab-parity + 67 extended coverage) and 69 Node tests on the interpretation + protocol layer. The latter pin every plain-English interpretation Bench shows you (Cpk band labels, AIAG %R&R bands, Cohen d effect-size cutoffs, Western Electric rule names, Weibull β windows, R² fit-quality bands) to its published source, and verify every recommended next-step (low Cpk → MSA first, ANOVA sig → Tukey, MSA > 30% → fix gauge first, β > 1.5 → preventive replacement before B10) against established LSS practice. Real bugs caught and fixed *during* this audit: sign-test silently ignoring `mu0`, McNemar `NameError` on its own kwarg, McNemar p-value under a non-standard key, MSA-nested ANOVA crashing on a formula/lookup order mismatch, multi-response desirability throwing a cryptic `TypeError` instead of a clear `ValueError` on missing bounds. Highlights:

- **Capability** pinned to Montgomery's *Introduction to Statistical Quality Control* 7e, Example 8.1 (μ=20, σ=1, LSL=16, USL=24 → Cp = Cpk = 1.333).
- **DPMO ↔ sigma level** verified at the Motorola/AIAG textbook crossover (3 DPMO → 6.03σ; 35,931 DPMO → 3.3σ).
- **Welch t**, **one-way ANOVA**, and **chi-square contingency** locked to `scipy.stats` to nine decimal places (they're the same standard implementation).
- **X̄-R and X̄-S limits** verified against AIAG SPC constants A2=0.577, D4=2.115, A3=1.427, B4=2.089 (subgroup size 5).
- **Weibull MLE** recovers β=2.5, η=100 within 8% on n=2000 synthetic samples.
- **Sample size** matches Cohen 1988 tables for d=0.5 power=0.80 within tolerance; two-proportion (p1=0.5, p2=0.6) reproduces G*Power's 388-per-group.
- **Tukey HSD** correctly rejects A↔C and B↔C while preserving A↔B as not significant.
- **Reproducibility hash** asserted deterministic across re-runs.

Tests pass on every commit. Where Bench differs from Minitab the documentation notes which side follows the original publication.

**Read the code.** Every method links to its source file. The Anderson-Darling implementation is roughly 70 lines. Tukey HSD is roughly 40 lines. You can audit Bench's math line-by-line. **You cannot do that with Minitab.**

Browse the full library + citation list at `bench.conyso.com/#methods`.

---

## Feature comparison

**Statistical capability, side by side.**

| Capability | Conyso Bench | Minitab |
|---|---|---|
| **Hypothesis testing** | | |
| Parametric tests | **27 tests** — one-sample, two-sample, paired, k-sample, ANOVA, equivalence | Comprehensive; all standard tests; long-validated implementations |
| Non-parametric tests | Mann-Whitney, Wilcoxon, Kruskal-Wallis, Friedman, Mood's median, Sign | Included |
| Post-hoc comparisons | **Tukey HSD, Fisher LSD, Games-Howell, Dunnett, Hsu MCB** | Tukey, Fisher, Dunnett, Hsu MCB |
| Pre-flight assumption checks | **Automatic** — Anderson-Darling, Levene, sample-size traffic lights before the test runs | Manual — tests exist; user checks assumptions separately |
| **Control charts** | | |
| Univariate chart types | I-MR, X-bar/R, X-bar/S, p, np, c, u, CUSUM, EWMA, MA | Full library |
| Multivariate SPC | **Hotelling T², MEWMA** | Hotelling T², MEWMA |
| Short-run SPC | **Z-MR, DNOM** | Yes |
| Overdispersion-adjusted SPC | **Laney p′** — auto-detects over/underdispersion and inflates limits by σ_z so large-subgroup p charts stop over-flagging | Laney p′ / u′ |
| Out-of-control rules | Western Electric + Nelson, applied automatically | Configurable rule sets |
| Chart annotations | Shift-click any point | Yes |
| **Capability & measurement** | | |
| Capability metrics | Cp · Cpk · Pp · Ppk · Cpm · Z-bench | All metrics |
| Box-Cox transform | Yes | Yes |
| Attribute capability | Binomial & Poisson | Binomial & Poisson |
| Capability Sixpack | Yes | Yes |
| Gauge R&R | Crossed, nested, expanded | Crossed, nested, expanded |
| **Regression** | | |
| Linear regression | OLS, GLM, stepwise, best-subsets | OLS, GLM, stepwise, best-subsets |
| Generalized models | Logistic, Poisson, nonlinear | Logistic, Poisson, nonlinear |
| **Design of experiments** | | |
| Factorial designs | Full, fractional, Plackett-Burman | Full, fractional, Plackett-Burman |
| Response surface | CCD, Box-Behnken, RSM fit | CCD, Box-Behnken, RSM fit |
| Mixture & screening designs | Mixture (simplex lattice & centroid), definitive screening | Mixture, definitive screening |
| Optimization & desirability | **Derringer-Suich desirability** — single + multi-response with weighting and importance. For bespoke objectives, every optimisation is also a REST call (pipe through SciPy or R). | Full optimizer; multi-response desirability with weighting |
| **Reliability & time series** | | |
| Distribution fits | **Weibull, exponential, lognormal, gamma, log-logistic, smallest/largest extreme value, GEV, Arrhenius accelerated** — right-censoring supported on Weibull & exponential | Weibull, exponential, lognormal, more |
| Time series | Holt-Winters, ARIMA, auto-ARIMA, decomposition, ACF/PACF, cross-correlation | ARIMA, decomposition, smoothing |
| **Multivariate** | | |
| Multivariate methods | PCA, k-means, LDA, hierarchical, Hotelling's T² | PCA, factor, cluster, discriminant |
| **Specialty tools** | | |
| Pareto, DPMO, Sigma calc | Yes | Yes |
| Sample size & power | **11 cases** — t, proportion, ANOVA, regression, χ², TOST equivalence, log-rank, cluster-randomized, FPC, variance, correlation, Cpk validation | Comprehensive |
| Tolerance intervals | Normal & non-parametric | Yes |
| Acceptance sampling | Yes | Yes |
| Distribution identifier | **10 candidates ranked by AD** | Yes |
| **UX & workflow** | | |
| Test Chooser wizard | Three or four questions, picks the right test | Assistant menu — similar guidance for some workflows |
| Plain-English query bar | **Yes** — "capability on cycle_time" or "compare yield by line" fills the form | No |
| Plain-English interpretation | **Every result** — automatically translates ANOVA tables, Cpk reports, and DOE outputs into a "what this means" paragraph you can paste straight into an executive deck | In Assistant |
| Rule-based action plans | Yes — "Cpk = 0.6 → run Gauge R&R first; takes a day, saves you a week" | No |
| Pin & compare | Side-by-side analysis viewer | Multiple windows |
| Recipes (saved analyses) | One-click re-run on new data | Worksheets & macros |
| Command palette (⌘K) | Yes | No |
| Dark mode | Yes (with editorial light mode toggle) | No |
| Mobile responsive | Yes | Desktop only |
| **Reproducibility & audit** | | |
| Per-result hash quartet | **Yes** — `(software_version, data_hash, params_hash, result_hash)` stamped on every result. Re-run the same recipe → bit-identical hashes. | Not exposed |
| Method dossier (print-to-PDF) | **Yes** — algorithm name, citation, software version, all four hashes, inputs, outputs. One click per result. | Validation kit (separate SKU) |
| **DMAIC project tracking** | | |
| Project portfolio | **Yes** — five-phase Define → Control with per-phase checklist, notes, pinned analyses, completion timestamps | Companion / Workspace |
| Pin analyses to a phase | **Yes** — one click on any result; tollgate deck assembles itself from the pinned set | Companion |
| **LSS deliverable templates** | | |
| Built-in templates | **17 templates** — Charter · SIPOC · A3 · FMEA (auto-RPN) · Control Plan · 8D · Capability Study · Gauge R&R · Tollgate Review · Project Closure · VOC/CTQ Tree · Pugh Matrix · 5S Audit · Kaizen Event · RACI · Stakeholder Analysis · IQ/OQ/PQ Validation Kit stub | Companion |
| Editor | **Fully editable in the browser** — section-by-section form, custom sections, live preview iframe, linked-analyses panel (charts + metrics + reproducibility hashes auto-pulled) | Companion-only |
| Export formats | **HTML · Markdown · Word (.doc) · PowerPoint (.ppt)** — every template emits all four with Conyso editorial branding | PDF · Word · PowerPoint |
| **Deployment & integration** | | |
| Platform | Web (any modern browser) | Windows desktop — Minitab Web Lite available; full parity on desktop |
| Self-hosting | `docker compose up` | Not available |
| Air-gapped / SCIF | **Supported** — Docker into a closed network, no outbound license check-ins | Some versions require license-server connectivity |
| Data residency | Your machine — SQLite + filesystem; nothing leaves the host | Local files; cloud worksheet sync optional |
| REST API | **Yes** — every analysis is callable from the same API the UI uses | No public API |
| Scripting / macros | REST + recipes; no dedicated macro language — recipes serve the common cases | Minitab macros (MTB / Exec) |
| License server | None | Required in many enterprises |

---

## Where Minitab still wins

**The honest column.**

**Regulated industries with sealed validation kits.** Minitab's pre-authored IQ/OQ/PQ package, sold as a separate SKU, is the path of least resistance if you're filing with the FDA or EMA today. Bench ships *per-result method dossiers* (algorithm, citation, software hash, reproducibility quartet, inputs, outputs — all printable) **and** a built-in **IQ/OQ/PQ Validation Kit stub template** that auto-pulls your analyses, their reproducibility hashes, and the method dossiers into a pre-structured validation document for your QA team to sign off on. That closes most of the gap to a sealed kit; for teams that need a third-party-audited package, Conyso Labs offers commercial validation-package authoring as a paid engagement.

**Macros and bespoke scripting.** Minitab's macro language has 30 years of community-written scripts. Bench exposes a REST API and a recipe system instead. Different tools for the same problem; if you live in Minitab macros today, that ecosystem doesn't come over.

**Training and certification.** Minitab has decades of official courses, a certification track, and a partner ecosystem. Conyso Academy teaches with Bench from day one; the ecosystem is younger and community-supported.

---

## Where Bench wins

**The other honest column.**

**Cost.** Free vs. ~$1,700 per user per year. For a 50-person team, that's **$85,000 stripped from operational budget annually** — money that previously left the building just to keep seat licenses active.

**Reproducibility you can prove.** Every Bench result is bound to a `(software_version, data_hash, params_hash, result_hash)` quartet. Re-run the same recipe → bit-identical hashes. Minitab can't show this; closed source, no public hash. For audit committees this is the single most important difference between the two tools.

**Auditability.** The Anderson-Darling implementation is roughly 70 lines of NumPy. Read it. Trace it back to Stephens (1974). Fork it if you must. *You cannot do this with Minitab.* In an era of increasing regulator skepticism toward black-box statistical software, the open-source argument is no longer a hippie talking point — it's an audit advantage.

**Method dossier per result.** One click on any analysis prints a one-page validation document: algorithm name, library function, peer-reviewed citation, software version, all four hashes, every input parameter, every output value. The validation paperwork writes itself.

**Deployment.** Web-based, runs on any platform, deployable behind your own firewall with one Docker command. No Windows requirement, no Parallels, no license server, no outbound check-ins, SCIF-friendly.

**The UX layer.** Test Chooser wizard, plain-English query bar, automatic assumption checks, plain-English interpretation, rule-based next-steps. The pieces a Black Belt has been writing as personal cheat-sheets for years are built in.

**The whole DMAIC deliverable suite, in the workbench.** 17 templates — Charter, SIPOC, A3, FMEA (auto-RPN), Control Plan, 8D, VoC/CTQ, Pugh, Capability Study, Gauge R&R, Tollgate Review, Project Closure, Kaizen Event, 5S Audit, RACI, Stakeholder Analysis, IQ/OQ/PQ Validation Kit — pinned to DMAIC phases, sourced from your actual analyses, rendered to HTML / Markdown / Word / PowerPoint with Conyso editorial branding. The Companion layer comes free.

**API-first.** Every analysis the UI runs is also a REST call. That is what makes Bench callable by Bill, by your data pipeline, by anything else that needs deterministic LSS math.

**Free for students and educators.** Minitab charges students unless their school has a site license. Bench is free for everyone. Conyso Academy ships free curriculum on top.

---

## The decision

**When to use which.**

Use **Minitab** if you are in a regulated industry that already files with a Minitab-validated kit, if your team lives in Minitab macros, or if you need a specialty SPC chart Bench does not cover.

Use **Conyso Bench** if you want a free, web-based, API-first statistical workbench that covers what most Black Belts use 95% of the time — with a UX layer that closes the gap from "I have data" to "I know what to do about it," and a DMAIC deliverable suite (charter through closure, plus an IQ/OQ/PQ stub) in the same window as the stats. Reach for Conyso Labs if you need a third-party-audited validation package or institutional support.

Use **both** if your team has heterogeneous needs. Bench is free to run alongside whatever you already have.

---

## Try Bench

- About Bench →
- Open the workbench ↗ (`bench.conyso.com`)
- Self-host (Docker) ↗ (GitHub link)

---

*Comparison written by Conyso Labs, 2026. Minitab is a registered trademark of Minitab, LLC. This page is not affiliated with or endorsed by Minitab.*
