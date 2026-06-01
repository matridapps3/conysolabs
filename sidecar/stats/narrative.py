"""Decision-grade headlines — a 1-2 sentence verdict on every analysis.

The product insight: a BB doesn't want "p = 0.034, d = 0.31, power = 0.62".
They want "Statistically significant but small effect — and the test was
only 62 % powered, so this could be real but worth replicating before
acting." That's the sentence Bench writes.

Rule-based, deterministic, **no LLM**. Combines three axes:
  1. Significance       — p vs α
  2. Practical effect   — effect size band (negligible/small/medium/large)
  3. Reliability        — post-hoc power (when applicable)

Each branch lands on one of nine cells in the 3×3 grid (sig×effect) plus a
power qualifier. The output is a `headline` (single sentence), a `subhead`
(one line of nuance), and a `verdict` tag (`act`, `consider`, `null`,
`underpowered`, `caution`).
"""
from __future__ import annotations


def _effect_band(d: float | None) -> str:
    if d is None:
        return "unknown"
    a = abs(d)
    if a < 0.2: return "negligible"
    if a < 0.5: return "small"
    if a < 0.8: return "medium"
    return "large"


def _power_qual(power: float | None) -> str:
    if power is None:
        return ""
    if power >= 0.8:
        return f" Power was adequate ({power*100:.0f}%)."
    if power >= 0.5:
        return f" Power was marginal ({power*100:.0f}%) — replicate before acting."
    return f" Power was low ({power*100:.0f}%) — a true effect may have been missed."


def _pick_effect_size(s: dict) -> tuple[str | None, float | None]:
    """Return (label, value) for whichever effect size the test reports."""
    for key, label in [
        ("cohens_d", "Cohen's d"),
        ("cohens_dz", "Cohen's dz"),
        ("cohens_h", "Cohen's h"),
        ("eta_squared", "η²"),
        ("omega_squared", "ω²"),
        ("epsilon_squared", "ε²"),
        ("cramers_v", "Cramér's V"),
        ("rank_biserial_r", "rank-biserial r"),
    ]:
        if key in s and s[key] is not None:
            return label, float(s[key])
    return None, None


def hypothesis(s: dict) -> dict:
    """Headline for a hypothesis-test result summary."""
    if not s or not s.get("test"):
        return {"headline": "", "subhead": "", "verdict": None}
    p = s.get("p") or s.get("p_value") or s.get("p_approx")
    alpha = 0.05
    sig = (p is not None and p < alpha)
    es_label, es_value = _pick_effect_size(s)
    band = _effect_band(es_value)
    power = s.get("power")

    es_str = f"{es_label} = {es_value:.2f}" if es_label else ""
    p_str = f"p = {p:.3f}" if p is not None else "p unavailable"

    if sig:
        if band in ("large", "medium"):
            return {
                "headline": f"Significant, {band} effect — act with confidence.",
                "subhead": f"{p_str}; {es_str} ({band}).{_power_qual(power)}",
                "verdict": "act",
            }
        if band == "small":
            return {
                "headline": "Significant but the effect is small.",
                "subhead": (f"{p_str}; {es_str} (small). Statistically real, "
                            f"but the practical magnitude is modest — weigh "
                            f"intervention cost against expected impact."
                            f"{_power_qual(power)}"),
                "verdict": "consider",
            }
        if band == "negligible":
            return {
                "headline": "Statistically significant but the effect is negligible.",
                "subhead": (f"{p_str}; {es_str}. A large sample is likely "
                            f"detecting a tiny, real difference of no practical value."
                            f"{_power_qual(power)}"),
                "verdict": "caution",
            }
        return {
            "headline": f"Statistically significant ({p_str}).",
            "subhead": f"Effect size not available for this test.{_power_qual(power)}",
            "verdict": "consider",
        }

    # Not significant
    if power is not None and power < 0.5:
        return {
            "headline": "Not significant — but the test was underpowered.",
            "subhead": (f"{p_str}; achieved power = {power*100:.0f}%. A real "
                        f"effect could be present and undetected. Re-run with "
                        f"a larger sample before concluding 'no difference'."),
            "verdict": "underpowered",
        }
    if power is not None and power < 0.8:
        return {
            "headline": "Not significant — power was marginal.",
            "subhead": (f"{p_str}; power = {power*100:.0f}%. The test had a "
                        f"moderate chance of detecting a real effect."),
            "verdict": "consider",
        }
    if band in ("medium", "large"):
        return {
            "headline": "Not significant despite a non-trivial estimated effect.",
            "subhead": (f"{p_str}; {es_str}. The point estimate looks meaningful "
                        f"but the data don't rule out chance. More data needed."),
            "verdict": "consider",
        }
    return {
        "headline": "No significant difference detected.",
        "subhead": (f"{p_str}; {es_str if es_label else 'effect estimate negligible'}."
                    f"{_power_qual(power)}"),
        "verdict": "null",
    }


def capability(s: dict) -> dict:
    if not s:
        return {"headline": "", "subhead": "", "verdict": None}
    cpk = s.get("cpk")
    if cpk is None:
        return {"headline": "Capability indices unavailable.",
                "subhead": "Supply both LSL and USL.", "verdict": None}
    if cpk >= 1.67:
        return {"headline": f"Process is highly capable (Cpk = {cpk:.2f}).",
                "subhead": "Maintain — focus monitoring effort elsewhere.",
                "verdict": "act"}
    if cpk >= 1.33:
        return {"headline": f"Process is capable (Cpk = {cpk:.2f}).",
                "subhead": "Meeting the conventional ≥ 1.33 threshold.",
                "verdict": "act"}
    if cpk >= 1.0:
        return {"headline": f"Process is marginally capable (Cpk = {cpk:.2f}).",
                "subhead": "Below the 1.33 threshold — drive variance reduction or recentering.",
                "verdict": "consider"}
    return {"headline": f"Process is not capable (Cpk = {cpk:.2f}).",
            "subhead": "Defects are likely. Take corrective action before relying on the process.",
            "verdict": "caution"}


def regression(s: dict) -> dict:
    if not s:
        return {"headline": "", "subhead": "", "verdict": None}
    r2 = s.get("r2") or s.get("r_squared")
    if r2 is None:
        return {"headline": "Regression fit unavailable.", "subhead": "",
                "verdict": None}
    # Regularized regression (ridge / lasso / elastic-net) — talk about
    # shrinkage & selection, not just fit, since that's why you'd reach for it.
    method = (s.get("method") or "").replace("_regression", "")
    if method in ("ridge", "lasso", "elastic_net"):
        kept, total = s.get("n_nonzero"), s.get("n_predictors")
        alpha = s.get("alpha")
        cv = s.get("alpha_selected_by_cv") is not None
        a_txt = (f"α = {alpha:.4g}" + (" (cross-validated)" if cv else "")) if alpha is not None else ""
        if method == "lasso" and kept is not None and total:
            return {"headline": f"Lasso kept {kept} of {total} predictors (R² = {r2:.2f}).",
                    "subhead": f"L1 penalty drove {total - kept} weak/collinear term(s) to exactly zero — the surviving predictors are your parsimonious model. {a_txt}.",
                    "verdict": "act" if kept else "caution"}
        if method == "ridge":
            return {"headline": f"Ridge fit (R² = {r2:.2f}).",
                    "subhead": f"L2 penalty shrinks all coefficients toward zero to tame collinearity; nothing is dropped. {a_txt}.",
                    "verdict": "act" if r2 >= 0.5 else "consider"}
        return {"headline": f"Elastic-net kept {kept} of {total} predictors (R² = {r2:.2f})."
                            if (kept is not None and total) else f"Elastic-net fit (R² = {r2:.2f}).",
                "subhead": f"Blends lasso selection with ridge stability across correlated predictors. {a_txt}.",
                "verdict": "act" if r2 >= 0.5 else "consider"}
    vif_warn = None
    if s.get("vif"):
        worst = max((v["vif"] for v in s["vif"]
                     if v.get("vif") is not None and v["vif"] != float("inf")),
                    default=0)
        if worst > 10:
            vif_warn = f" VIF up to {worst:.1f} flags severe multicollinearity."
        elif worst > 5:
            vif_warn = f" VIF up to {worst:.1f} flags moderate multicollinearity."
    if r2 >= 0.8:
        return {"headline": f"Strong fit (R² = {r2:.2f}).",
                "subhead": f"Model explains most of the response variance.{vif_warn or ''}",
                "verdict": "act"}
    if r2 >= 0.5:
        return {"headline": f"Moderate fit (R² = {r2:.2f}).",
                "subhead": f"Useful but room to improve — consider adding terms.{vif_warn or ''}",
                "verdict": "consider"}
    return {"headline": f"Weak fit (R² = {r2:.2f}).",
            "subhead": f"Predictors explain little of the response variance.{vif_warn or ''}",
            "verdict": "null"}


def msa(s: dict) -> dict:
    if not s:
        return {"headline": "", "subhead": "", "verdict": None}
    grr = s.get("total_grr_pct")
    ndc = s.get("ndc")
    if grr is None:
        return {"headline": "GR&R summary unavailable.", "subhead": "", "verdict": None}
    if grr < 10:
        return {"headline": f"Gauge is acceptable (%GR&R = {grr:.1f} %).",
                "subhead": f"Below 10 % AIAG cutoff. ndc = {ndc:.1f}." if ndc else "",
                "verdict": "act"}
    if grr < 30:
        return {"headline": f"Gauge is marginal (%GR&R = {grr:.1f} %).",
                "subhead": (f"Between 10 % and 30 % — acceptable depending on the "
                            f"application's cost of error. ndc = {ndc:.1f}." if ndc else ""),
                "verdict": "consider"}
    return {"headline": f"Gauge is not acceptable (%GR&R = {grr:.1f} %).",
            "subhead": f"Above 30 % AIAG cutoff — the measurement system needs work first.",
            "verdict": "caution"}


def mixed_effects(s: dict) -> dict:
    """LMM / GEE / GLMM. Lead with the headline fixed effect (the first
    non-intercept term) and the model's defining trade-off."""
    if not s:
        return {"headline": "", "subhead": "", "verdict": None}
    method = s.get("method", "")
    coefs = s.get("fixed_effects") or s.get("coefficients") or []
    main = next((c for c in coefs if str(c.get("name", "")).lower()
                 not in ("intercept", "(intercept)")), None)
    if method == "linear_mixed_effects":
        icc = s.get("ICC")
        icc_txt = (f" ICC = {icc:.2f} — {icc*100:.0f}% of variance is between groups."
                   if icc is not None else "")
        if main:
            sig = main.get("p") is not None and main["p"] < 0.05
            return {"headline": f"{main['name']}: {main['coef']:+.3g}"
                                + (" (significant)" if sig else " (n.s.)") + ".",
                    "subhead": f"Linear mixed model with random intercepts.{icc_txt}",
                    "verdict": "act" if sig else "consider"}
        return {"headline": "Mixed model fitted.", "subhead": icc_txt.strip(), "verdict": "consider"}
    if method in ("gee", "glmm"):
        eff = s.get("link_effect", "")
        if main:
            ratio = main.get("effect_ratio")
            sig = (main.get("p") is not None and main["p"] < 0.05) or \
                  (main.get("ci_lo") is not None and main.get("ci_hi") is not None
                   and (main["ci_lo"] > 0) == (main["ci_hi"] > 0))
            unit = ("odds ratio" if eff == "odds_ratio"
                    else "rate ratio" if eff == "rate_ratio" else "effect")
            rtxt = f" {unit} {ratio:.2f}." if ratio is not None else ""
            scope = ("Population-averaged (marginal) effect with cluster-robust SEs."
                     if method == "gee"
                     else "Subject-specific (conditional) effect with a random intercept per group.")
            return {"headline": f"{main['name']}: {main['coef']:+.3g}"
                                + (" (significant)" if sig else " (n.s.)") + f".{rtxt}",
                    "subhead": scope, "verdict": "act" if sig else "consider"}
        return {"headline": f"{method.upper()} model fitted.", "subhead": "", "verdict": "consider"}
    return {"headline": "Model fitted.", "subhead": "", "verdict": "consider"}


def multivariate(s: dict) -> dict:
    """PCA / MANOVA / factor analysis."""
    if not s:
        return {"headline": "", "subhead": "", "verdict": None}
    method = s.get("method", "")
    if method == "manova":
        sig = s.get("significant")
        p = s.get("tests", {}).get("Pillai's trace", {}).get("p_value")
        ptxt = f" (Pillai p = {p:.3g})" if p is not None else ""
        return {"headline": (f"Groups differ on the response vector{ptxt}."
                             if sig else f"No multivariate group difference{ptxt}."),
                "subhead": ("Run per-response ANOVAs to localise which outcomes drive it."
                            if sig else "The grouping factor doesn't move the responses jointly."),
                "verdict": "act" if sig else "null"}
    if method == "factor_analysis":
        k = s.get("n_factors"); tot = s.get("total_variance_explained")
        return {"headline": f"{k} latent factor(s) extracted"
                            + (f", explaining {tot*100:.0f}% of variance." if tot is not None else "."),
                "subhead": "Inspect the loadings to name each factor by its high-loading variables.",
                "verdict": "consider"}
    if method == "pca":
        # PCA summary varies; surface variance explained if present.
        ve = s.get("explained_variance_ratio") or s.get("proportion_variance")
        if isinstance(ve, list) and ve:
            cum = sum(ve[:2]) * 100
            return {"headline": f"First 2 components capture {cum:.0f}% of variance.",
                    "subhead": "Use the scree plot to choose how many components to keep.",
                    "verdict": "consider"}
        return {"headline": "Principal components extracted.", "subhead": "", "verdict": "consider"}
    return {"headline": "", "subhead": "", "verdict": None}


def control_chart(s: dict) -> dict:
    """Any control chart — verdict driven by out-of-control points."""
    if not s:
        return {"headline": "", "subhead": "", "verdict": None}
    viol = s.get("violations") or []
    kind = s.get("kind", "chart")
    nv = len(viol) if isinstance(viol, list) else int(viol or 0)
    if kind in ("G", "T"):
        if nv:
            return {"headline": f"{nv} rare-event signal(s) on the {kind} chart.",
                    "subhead": s.get("note", "Investigate the flagged event(s)."),
                    "verdict": "caution"}
        return {"headline": f"{kind} chart in control — no unusual event spacing.",
                "subhead": s.get("note", ""), "verdict": "act"}
    if nv:
        return {"headline": f"Process out of control — {nv} point(s) beyond the limits.",
                "subhead": "Special-cause variation present; investigate before judging capability.",
                "verdict": "caution"}
    return {"headline": "Process in statistical control.",
            "subhead": "No rule violations — variation looks common-cause.",
            "verdict": "act"}


def for_kind(kind: str, summary: dict) -> dict:
    """Main entry point — kind matches the analysis dispatch keys."""
    if kind == "hypothesis_test": return hypothesis(summary)
    if kind in ("capability", "sixpack"): return capability(summary)
    if kind == "regression":      return regression(summary)
    if kind == "msa":             return msa(summary)
    if kind == "mixed_effects":   return mixed_effects(summary)
    if kind == "multivariate":    return multivariate(summary)
    if kind == "control_chart":   return control_chart(summary)
    return {"headline": "", "subhead": "", "verdict": None}
