"""Auto-follow-up suggestions — what the user should run NEXT given a result.

Rules engine, no LLM. Each rule reads the summary dict and returns a list of
follow-up actions. Each action carries:
  - label    : a short button-like phrase ("Run Tukey HSD")
  - reason   : one-line justification ("ANOVA was significant — find which pairs differ")
  - kind     : the analysis dispatch kind the UI should pre-fill
  - params   : the params to pre-fill on the form
  - priority : 'high' | 'medium' | 'low' so the UI can rank chips

The frontend renders these as click-to-prefill chips in the result-card
footer. One click → new analysis tab with the right params already set.
"""
from __future__ import annotations


def for_kind(kind: str, summary: dict, request: dict | None = None) -> list[dict]:
    """request carries the original analysis params (column, group_col, etc.)
    so we can carry them forward into follow-ups."""
    request = request or {}
    if kind == "hypothesis_test": return _hypothesis(summary, request)
    if kind == "regression":      return _regression(summary, request)
    if kind in ("capability", "sixpack"):
        return _capability(summary, request)
    if kind == "msa":             return _msa(summary, request)
    if kind == "control_chart":   return _control_chart(summary, request)
    if kind == "pareto":          return _pareto(summary, request)
    if kind == "correlation":     return _correlation(summary, request)
    if kind == "mixed_effects":   return _mixed_effects(summary, request)
    if kind == "multivariate":    return _multivariate(summary, request)
    return []


def _mixed_effects(s: dict, req: dict) -> list[dict]:
    out = []
    method = s.get("method", "")
    fixed = req.get("fixed"); group = req.get("group")
    # GEE ↔ GLMM: the two answer different questions on the same data; nudge the
    # user toward the complementary one.
    if method == "gee":
        out.append({"label": "Fit a GLMM instead",
                    "reason": "GEE gives the population-averaged effect; a GLMM gives the subject-specific effect with a random intercept.",
                    "kind": "mixed_effects",
                    "params": {"fixed": fixed, "group": group, "method": "glmm", "family": req.get("family") or "binomial"},
                    "priority": "medium"})
    elif method == "glmm":
        out.append({"label": "Fit a GEE instead",
                    "reason": "Compare the subject-specific (GLMM) effect with the population-averaged (GEE) one.",
                    "kind": "mixed_effects",
                    "params": {"fixed": fixed, "group": group, "method": "gee", "family": req.get("family") or "binomial"},
                    "priority": "medium"})
    elif method == "linear_mixed_effects":
        icc = s.get("ICC")
        if icc is not None and icc > 0.1:
            out.append({"label": "Gauge R&R on this grouping",
                        "reason": f"ICC = {icc:.2f} — a large share of variation is between groups; a measurement-systems lens may apply.",
                        "kind": "msa", "params": {}, "priority": "low"})
    return out


def _multivariate(s: dict, req: dict) -> list[dict]:
    out = []
    method = s.get("method", "")
    cols = req.get("columns") or []
    if method == "manova" and s.get("significant"):
        # Localise the joint effect with per-response one-way ANOVAs.
        for r in (s.get("responses") or [])[:3]:
            out.append({"label": f"One-way ANOVA on {r}",
                        "reason": "MANOVA is significant — find which individual responses drive the difference.",
                        "kind": "hypothesis_test",
                        "params": {"test": "one_way_anova", "column": r, "group_col": req.get("class_col")},
                        "priority": "high"})
    if method == "factor_analysis":
        out.append({"label": "PCA on the same variables",
                    "reason": "Compare the factor structure with principal components (PCA maximises variance, FA models shared latent factors).",
                    "kind": "multivariate",
                    "params": {"method": "pca", "columns": cols},
                    "priority": "low"})
    if method == "pca":
        out.append({"label": "K-means on the components",
                    "reason": "Cluster observations in the reduced PCA space to find natural groupings.",
                    "kind": "multivariate",
                    "params": {"method": "kmeans", "columns": cols},
                    "priority": "low"})
    return out


def _hypothesis(s: dict, req: dict) -> list[dict]:
    out = []
    test = s.get("test")
    p = s.get("p") or s.get("p_value") or s.get("p_approx")
    sig = p is not None and p < 0.05
    power = s.get("power")
    column = req.get("column")
    group_col = req.get("group_col")

    # ANOVA significant → Tukey HSD or post-hoc letter display.
    if test == "one_way_anova" and sig:
        out.append({"label": "Run Tukey HSD post-hoc",
                    "reason": "ANOVA is significant — identify which pairs differ.",
                    "kind": "posthoc",
                    "params": {"test": "tukey_hsd", "value_col": column,
                               "group_col": group_col},
                    "priority": "high"})
        out.append({"label": "Interaction plot",
                    "reason": "If you have a second factor, check whether it interacts.",
                    "kind": "graph",
                    "params": {"chart": "interaction", "response": column},
                    "priority": "low"})

    # Kruskal-Wallis significant → Dunn's test (the NON-parametric post-hoc;
    # Tukey assumes normality, so it's the wrong follow-up here).
    if test == "kruskal" and sig:
        out.append({"label": "Run Dunn's test (non-parametric post-hoc)",
                    "reason": "Kruskal-Wallis is significant — Dunn's test identifies which "
                              "pairs differ on ranks, with a multiplicity correction.",
                    "kind": "posthoc",
                    "params": {"test": "dunn", "value_col": column,
                               "group_col": group_col},
                    "priority": "high"})

    # Chi-square significant → 2-proportion pairwise comparisons
    if test == "chi_square" and sig:
        rows = s.get("rows", 2)
        if rows > 2:
            out.append({"label": "Pairwise 2-proportion follow-ups",
                        "reason": "Chi-square is significant — drill into which row pair differs.",
                        "kind": "hypothesis_test",
                        "params": {"test": "two_proportions", "column": column,
                                   "group_col": group_col},
                        "priority": "high"})

    # Significant t-test → bootstrap CI for the effect size
    if test in ("two_sample_t", "paired_t") and sig:
        out.append({"label": "Bootstrap effect-size CI",
                    "reason": "Get a distribution-free CI on Cohen's d for the effect estimate.",
                    "kind": "bootstrap",
                    "params": {"column": column, "statistic": "mean",
                               "group_col": group_col},
                    "priority": "medium"})

    # Significant difference → check capability of each group
    if test in ("two_sample_t", "one_way_anova") and sig:
        out.append({"label": "Capability per group",
                    "reason": "Quantify how each group performs against spec.",
                    "kind": "capability",
                    "params": {"column": column, "subgroup_col": group_col},
                    "priority": "medium"})

    # Underpowered non-significant → sample-size recommendation
    if not sig and power is not None and power < 0.5:
        out.append({"label": "Sample-size for adequate power",
                    "reason": "Test was underpowered — calculate what n you'd need to detect the effect.",
                    "kind": "sample_size",
                    "params": {"test_kind": "two_sample_t", "alpha": 0.05, "power": 0.8},
                    "priority": "high"})

    # Failed normality (Anderson-Darling) → distribution ID + non-parametric alternative
    if test == "anderson_darling_normality" and p is not None and p < 0.05:
        out.append({"label": "Identify the right distribution",
                    "reason": "Data are non-normal — find the best-fit distribution.",
                    "kind": "distribution_id",
                    "params": {"column": column},
                    "priority": "high"})

    # Levene/Bartlett detected unequal variances → switch to Welch
    if test in ("levene", "bartlett") and sig:
        out.append({"label": "Re-run as Welch's t-test",
                    "reason": "Variances are unequal — Welch is the correct test.",
                    "kind": "hypothesis_test",
                    "params": {"test": "two_sample_t", "column": column,
                               "group_col": group_col, "equal_var": False},
                    "priority": "high"})

    return out


def _regression(s: dict, req: dict) -> list[dict]:
    out = []
    response = req.get("response")
    predictors = req.get("predictors") or []
    method = (s.get("method") or "").replace("_regression", "")
    # Regularized fit → compare to plain OLS so the user sees the bias-variance
    # trade-off they bought, and (for lasso) re-fit OLS on just the kept terms.
    if method in ("ridge", "lasso", "elastic_net"):
        out.append({"label": "Compare to ordinary least squares",
                    "reason": "See how much the penalty shrank coefficients vs. the unregularized fit.",
                    "kind": "regression",
                    "params": {"response": response, "predictors": predictors, "method": "ols"},
                    "priority": "medium"})
        kept = [c["term"] for c in (s.get("coefficients") or []) if not c.get("shrunk_to_zero")]
        if method == "lasso" and kept and len(kept) < len(predictors):
            out.append({"label": "OLS on the selected predictors",
                        "reason": "Lasso shrinks coefficients; re-fit OLS on just the surviving terms for unbiased estimates.",
                        "kind": "regression",
                        "params": {"response": response, "predictors": kept, "method": "ols"},
                        "priority": "high"})
        return out
    vif = s.get("vif") or []
    bad_vif = [v for v in vif if v.get("vif") and v["vif"] > 10]
    if bad_vif:
        worst = max(bad_vif, key=lambda v: v["vif"])
        out.append({"label": f"Drop {worst['name']} (high VIF)",
                    "reason": f"VIF = {worst['vif']:.1f} indicates severe multicollinearity.",
                    "kind": "regression",
                    "params": {"response": response,
                               "predictors": [p for p in predictors if p != worst["name"]],
                               "method": req.get("method", "ols")},
                    "priority": "high"})
        out.append({"label": "Try stepwise selection",
                    "reason": "Let stepwise prune correlated predictors automatically.",
                    "kind": "regression",
                    "params": {"response": response, "predictors": predictors,
                               "method": "stepwise"},
                    "priority": "medium"})
    influence = s.get("influence", {})
    if influence.get("available") and influence.get("high_cooks_d"):
        out.append({"label": "Robust regression (Huber)",
                    "reason": f"{len(influence['high_cooks_d'])} high-influence point(s) — robust fit reduces their pull.",
                    "kind": "regression",
                    "params": {"response": response, "predictors": predictors,
                               "method": "robust"},
                    "priority": "high"})
    # Significant overall F → ANOVA-style decomposition of which predictor matters most
    if s.get("roc") and s["roc"].get("auc"):
        if s["roc"]["auc"] < 0.7:
            out.append({"label": "Try Random Forest for non-linearity",
                        "reason": f"Logistic AUC is {s['roc']['auc']:.2f} — non-linear interactions may help.",
                        "kind": "regression",
                        "params": {"response": response, "predictors": predictors,
                                   "method": "random_forest"},
                        "priority": "medium"})
    return out


def _capability(s: dict, req: dict) -> list[dict]:
    out = []
    column = req.get("column")
    lsl = req.get("lsl"); usl = req.get("usl")
    cpk = s.get("cpk")
    shapiro = s.get("shapiro")
    if shapiro and shapiro.get("p") is not None and shapiro["p"] < 0.05:
        out.append({"label": "Re-run with Box-Cox transform",
                    "reason": "Data are non-normal — capability indices may misrepresent the defect rate.",
                    "kind": "capability",
                    "params": {"column": column, "lsl": lsl, "usl": usl,
                               "transform": "box-cox"},
                    "priority": "high"})
        out.append({"label": "Re-run with Johnson transform",
                    "reason": "Johnson handles negative values + skew that Box-Cox can't.",
                    "kind": "capability",
                    "params": {"column": column, "lsl": lsl, "usl": usl,
                               "transform": "johnson"},
                    "priority": "medium"})
    if cpk is not None and cpk < 1.33:
        out.append({"label": "Predictive Cpk — what would help?",
                    "reason": "Capability is below 1.33 — simulate variance reduction and centering scenarios.",
                    "kind": "predictive_cpk",
                    "params": {"column": column, "lsl": lsl, "usl": usl},
                    "priority": "high"})
        out.append({"label": "I-MR control chart",
                    "reason": "Confirm the process is stable before relying on the capability number.",
                    "kind": "control_chart",
                    "params": {"kind": "I-MR", "column": column},
                    "priority": "medium"})
    return out


def _msa(s: dict, req: dict) -> list[dict]:
    out = []
    grr = s.get("total_grr_pct")
    if grr is not None and grr >= 10:
        out.append({"label": "Gage Linearity & Bias",
                    "reason": f"%GR&R is {grr:.1f}% — investigate whether bias varies across the operating range.",
                    "kind": "gage_linearity",
                    "params": {"part_col": req.get("part_col"),
                               "measurement_col": req.get("measurement_col")},
                    "priority": "high"})
    out.append({"label": "Attribute Agreement (if pass/fail)",
                "reason": "If your gage is attribute (not continuous), Kappa is the right metric.",
                "kind": "agreement",
                "params": {"part_col": req.get("part_col"),
                           "appraiser_col": req.get("operator_col")},
                "priority": "low"})
    return out


def _control_chart(s: dict, req: dict) -> list[dict]:
    out = []
    violations = s.get("rule_violations") or []
    if violations:
        out.append({"label": "Drill into rule violations",
                    "reason": f"{len(violations)} run-rule violation(s) flagged — investigate the timeline.",
                    "kind": "graph",
                    "params": {"chart": "time_series", "column": req.get("column")},
                    "priority": "high"})
        out.append({"label": "Changepoint detection",
                    "reason": "Find exactly when the shift occurred.",
                    "kind": "time_series",
                    "params": {"method": "changepoint", "value_col": req.get("column")},
                    "priority": "medium"})
    out.append({"label": "Capability now that it's stable",
                "reason": "Once the chart is in control, capability indices are meaningful.",
                "kind": "capability",
                "params": {"column": req.get("column")},
                "priority": "low"})
    return out


def _pareto(s: dict, req: dict) -> list[dict]:
    out = []
    out.append({"label": "Cost-weighted Pareto",
                "reason": "Frequency leader is rarely the cost leader — check both side-by-side.",
                "kind": "pareto",
                "params": {"category_col": req.get("category_col"),
                           "mode": "cost_weighted"},
                "priority": "medium"})
    return out


def _correlation(s: dict, req: dict) -> list[dict]:
    out = []
    multicol = s.get("multicollinearity") or []
    sig = s.get("significant") or []
    if multicol:
        names = sorted({p["x"] for p in multicol} | {p["y"] for p in multicol})
        out.append({"label": "Drop a collinear predictor",
                    "reason": f"{len(multicol)} pair(s) with |r|>0.8 — keep one of each pair before regression.",
                    "kind": "regression",
                    "params": {"predictors": names},
                    "priority": "high"})
    if sig:
        top = sig[0]
        out.append({"label": f"Fit a regression: {top['y']} ~ {top['x']}",
                    "reason": f"Strongest pair (r = {top['r']:.2f}) — fit the line.",
                    "kind": "regression",
                    "params": {"response": top["y"], "predictors": [top["x"]],
                               "method": "ols"},
                    "priority": "high"})
    return out
