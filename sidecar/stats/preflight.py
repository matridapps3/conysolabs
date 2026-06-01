"""Auto-assumption pre-flight — Bench's killer differentiator.

Minitab makes you remember which assumptions each test relies on and run
the Shapiro / Levene / outlier checks yourself before deciding "use t-test
vs Welch vs Mann-Whitney". Pre-flight does that automatically.

Given (kind, params, df), returns a traffic-light report:
  - status: 'ok' | 'warn' | 'fail'
  - checks: [{name, status, detail}]
  - recommendation: best test variant for this data
  - explanation: one-line BB-readable rationale

The engine is rule-based + deterministic — no LLM. Each branch matches
what Minitab's Assistant prints, just inline at the form instead of after
the analysis runs.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps


def _shapiro_ok(x: np.ndarray) -> tuple[str, float | None, str]:
    """Returns (status, p, detail). 'ok' if p > 0.05; 'warn' if 0.01-0.05;
    'fail' if < 0.01. Shapiro is well-defined for 3-5000 obs."""
    if not (3 <= x.size <= 5000):
        return ("ok", None, f"n={x.size} outside Shapiro's range — assuming normal")
    p = float(sps.shapiro(x).pvalue)
    if p > 0.05:
        return ("ok", p, f"Shapiro p = {p:.3f} — normality plausible")
    if p > 0.01:
        return ("warn", p, f"Shapiro p = {p:.3f} — borderline non-normal")
    return ("fail", p, f"Shapiro p = {p:.3f} — distinctly non-normal")


def _levene_ok(arrays: list[np.ndarray]) -> tuple[str, float | None, str]:
    arrays = [a for a in arrays if a.size >= 2]
    if len(arrays) < 2:
        return ("ok", None, "not enough groups for variance test")
    p = float(sps.levene(*arrays, center="median").pvalue)
    if p > 0.05:
        return ("ok", p, f"Levene p = {p:.3f} — variances similar")
    if p > 0.01:
        return ("warn", p, f"Levene p = {p:.3f} — borderline unequal variances")
    return ("fail", p, f"Levene p = {p:.3f} — variances are unequal")


def _outliers(x: np.ndarray) -> tuple[str, list[int], str]:
    """IQR outliers — quick visual scan."""
    if x.size < 8:
        return ("ok", [], "n too small to flag outliers")
    q1, q3 = np.percentile(x, [25, 75])
    iqr = q3 - q1
    if iqr == 0:
        return ("ok", [], "no spread")
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    out_idx = [int(i) for i, v in enumerate(x) if v < lo or v > hi]
    if not out_idx:
        return ("ok", [], "no IQR-fenced outliers")
    pct = 100 * len(out_idx) / x.size
    if pct < 5:
        return ("warn", out_idx, f"{len(out_idx)} outlier(s) ({pct:.0f}%) flagged by IQR")
    return ("fail", out_idx, f"{len(out_idx)} outliers ({pct:.0f}%) — investigate first")


def _sample_size_ok(n: int, min_n: int, label: str) -> tuple[str, str]:
    if n >= min_n:
        return ("ok", f"n = {n} ≥ {min_n} ({label})")
    if n >= max(3, int(min_n * 0.6)):
        return ("warn", f"n = {n} below recommended {min_n} for {label}")
    return ("fail", f"n = {n} too small — need ≥ {min_n} for {label}")


def _worst(*statuses: str) -> str:
    order = ["fail", "warn", "ok"]
    for level in order:
        if level in statuses:
            return level
    return "ok"


def check(df: pd.DataFrame, *, kind: str, params: dict) -> dict:
    """Main entry point. kind matches the analysis dispatch keys."""
    if kind == "hypothesis_test":
        return _check_hypothesis(df, params)
    if kind == "regression":
        return _check_regression(df, params)
    if kind == "capability":
        return _check_capability(df, params)
    if kind == "msa":
        return _check_msa(df, params)
    if kind == "mixed_effects":
        return _check_mixed_effects(df, params)
    if kind == "multivariate":
        return _check_multivariate(df, params)
    return {"status": "ok", "checks": [],
            "recommendation": None,
            "explanation": f"No pre-flight rules for kind={kind}"}


def _check_mixed_effects(df: pd.DataFrame, params: dict) -> dict:
    """LMM / GEE / GLMM all lean on the *number of groups* (clusters): with too
    few, the random-effect variance (LMM/GLMM) or the robust SEs (GEE) are
    unstable. Rule of thumb: ≥ 5 groups is shaky, ≥ 10–30 is comfortable."""
    group = params.get("group")
    checks, expl = [], []
    if not group or group not in df.columns:
        return {"status": "warn",
                "checks": [{"name": "group column", "status": "warn",
                            "detail": f"grouping column {group!r} not found"}],
                "recommendation": None,
                "explanation": "Pick the grouping (cluster) column first."}
    n_groups = int(df[group].dropna().nunique())
    if n_groups >= 10:
        s = "ok"; d = f"{n_groups} groups — adequate for stable random-effect estimates."
    elif n_groups >= 5:
        s = "warn"; d = f"only {n_groups} groups — random-effect variance / robust SEs may be unstable."
        expl.append("With < ~10 clusters, treat the between-group variance and its SE with caution.")
    else:
        s = "fail"; d = f"only {n_groups} groups — too few for a mixed/clustered model."
        expl.append("Consider pooling (ignore the grouping) or a fixed-effects model instead.")
    checks.append({"name": "number of groups", "status": s, "detail": d})
    # Average cluster size (singletons contribute nothing to within-group info).
    sizes = df.groupby(group).size()
    if (sizes < 2).any():
        checks.append({"name": "cluster sizes", "status": "warn",
                       "detail": f"{int((sizes < 2).sum())} group(s) have a single observation."})
    return {"status": _worst(*[c["status"] for c in checks]),
            "checks": checks, "recommendation": None,
            "explanation": " ".join(expl) or "Mixed/clustered model assumptions look reasonable."}


def _check_multivariate(df: pd.DataFrame, params: dict) -> dict:
    """MANOVA / factor analysis. Both need n comfortably larger than the number
    of variables; MANOVA additionally needs each group bigger than the response
    vector."""
    method = params.get("method")
    cols = params.get("columns") or []
    checks, expl = [], []
    present = [c for c in cols if c in df.columns]
    if len(present) < 2:
        return {"status": "warn",
                "checks": [{"name": "variables", "status": "warn",
                            "detail": "need at least 2 numeric columns"}],
                "recommendation": None, "explanation": "Select at least two variables."}
    n = len(df[present].dropna())
    p = len(present)
    # n vs p rule of thumb: ≥ 5 rows per variable for FA; ≥ p+2 minimum.
    if n >= 5 * p:
        checks.append({"name": "sample size", "status": "ok",
                       "detail": f"n={n} for {p} variables (≥ 5×p)."})
    elif n >= p + 2:
        checks.append({"name": "sample size", "status": "warn",
                       "detail": f"n={n} for {p} variables — thin; aim for ≥ {5*p}."})
        expl.append("Loadings / multivariate tests are unstable when n is close to the number of variables.")
    else:
        checks.append({"name": "sample size", "status": "fail",
                       "detail": f"n={n} < {p+2} required for {p} variables."})
    if method == "manova":
        grp = params.get("class_col")
        if grp and grp in df.columns:
            sizes = df.dropna(subset=present + [grp]).groupby(grp).size()
            k = len(sizes)
            if (sizes <= p).any():
                checks.append({"name": "group sizes", "status": "fail",
                               "detail": f"every group must exceed {p} (responses); smallest is {int(sizes.min())}."})
                expl.append("MANOVA needs each group larger than the response vector for a non-singular within-group covariance.")
            else:
                checks.append({"name": "group sizes", "status": "ok",
                               "detail": f"{k} groups, smallest n={int(sizes.min())} > {p}."})
        else:
            checks.append({"name": "grouping factor", "status": "warn",
                           "detail": "MANOVA needs class_col (the grouping factor)."})
    return {"status": _worst(*[c["status"] for c in checks]),
            "checks": checks, "recommendation": None,
            "explanation": " ".join(expl) or "Multivariate assumptions look reasonable."}


def _check_hypothesis(df: pd.DataFrame, params: dict) -> dict:
    test = params.get("test")
    column = params.get("column")
    group_col = params.get("group_col")
    col_b = params.get("column_b")
    checks = []
    rec = None
    expl = []

    if not test or not column or column not in df.columns:
        return {"status": "warn",
                "checks": [{"name": "params", "status": "warn",
                            "detail": "missing test or column"}],
                "recommendation": None,
                "explanation": "Fill in the parameters first."}

    x = pd.to_numeric(df[column], errors="coerce").dropna().to_numpy()

    # ── 1-sample t / paired t / sign / wilcoxon — normality of x (or of diffs)
    if test in ("one_sample_t",):
        s_size, d_size = _sample_size_ok(x.size, 8, "1-sample t")
        checks.append({"name": "sample size", "status": s_size, "detail": d_size})
        s_n, p_n, d_n = _shapiro_ok(x)
        checks.append({"name": "normality (Shapiro)", "status": s_n, "detail": d_n})
        s_o, _, d_o = _outliers(x)
        checks.append({"name": "outliers (IQR)", "status": s_o, "detail": d_o})
        if s_n == "fail":
            rec = {"test": "sign_test", "label": "Sign test (non-parametric)"}
            expl.append("Distinctly non-normal — use the **sign test** or **Wilcoxon** instead.")
        elif s_n == "warn":
            expl.append("Borderline normality — t-test is robust at n ≥ 30; otherwise consider Wilcoxon.")

    elif test in ("paired_t",):
        if not col_b or col_b not in df.columns:
            return {"status": "fail",
                    "checks": [{"name": "params", "status": "fail",
                                "detail": "paired_t needs column_b"}],
                    "recommendation": None,
                    "explanation": "Provide the second column."}
        d = (pd.to_numeric(df[column], errors="coerce")
             - pd.to_numeric(df[col_b], errors="coerce")).dropna().to_numpy()
        s_size, d_size = _sample_size_ok(d.size, 8, "paired t")
        checks.append({"name": "sample size", "status": s_size, "detail": d_size})
        s_n, p_n, d_n = _shapiro_ok(d)
        checks.append({"name": "normality of differences", "status": s_n, "detail": d_n})
        s_o, _, d_o = _outliers(d)
        checks.append({"name": "outliers in differences", "status": s_o, "detail": d_o})
        if s_n == "fail":
            rec = {"test": "wilcoxon_signed_rank", "label": "Wilcoxon signed-rank"}
            expl.append("Differences are non-normal — use **Wilcoxon signed-rank** instead.")

    elif test in ("two_sample_t",):
        if not group_col or group_col not in df.columns:
            return {"status": "fail",
                    "checks": [{"name": "params", "status": "fail",
                                "detail": "two_sample_t needs group_col"}],
                    "recommendation": None,
                    "explanation": "Specify the grouping column."}
        groups = [pd.to_numeric(g, errors="coerce").dropna().to_numpy()
                  for _, g in df.groupby(group_col)[column]]
        if len(groups) != 2:
            return {"status": "fail",
                    "checks": [{"name": "groups", "status": "fail",
                                "detail": f"need exactly 2 groups, got {len(groups)}"}],
                    "recommendation": None,
                    "explanation": "Filter to 2 groups."}
        s1, d1 = _sample_size_ok(groups[0].size, 8, "group A")
        s2, d2 = _sample_size_ok(groups[1].size, 8, "group B")
        checks.append({"name": "sample size A", "status": s1, "detail": d1})
        checks.append({"name": "sample size B", "status": s2, "detail": d2})
        s_n1, _, d_n1 = _shapiro_ok(groups[0])
        s_n2, _, d_n2 = _shapiro_ok(groups[1])
        checks.append({"name": "normality A", "status": s_n1, "detail": d_n1})
        checks.append({"name": "normality B", "status": s_n2, "detail": d_n2})
        s_v, _, d_v = _levene_ok(groups)
        checks.append({"name": "equal variances (Levene)", "status": s_v, "detail": d_v})

        if "fail" in (s_n1, s_n2):
            rec = {"test": "mann_whitney", "label": "Mann-Whitney U"}
            expl.append("At least one group is non-normal — use **Mann-Whitney U**.")
        elif s_v == "fail":
            rec = {"test": "two_sample_t", "label": "Welch's t-test (equal_var=false)",
                   "params": {"equal_var": False}}
            expl.append("Unequal variances — run Welch's t-test (uncheck 'equal variances').")
        else:
            expl.append("Assumptions look fine — proceed with two-sample t-test.")

    elif test in ("anova", "one_way_anova"):
        groups = [pd.to_numeric(g, errors="coerce").dropna().to_numpy()
                  for _, g in df.groupby(group_col)[column]]
        if len(groups) < 2:
            return {"status": "fail",
                    "checks": [{"name": "groups", "status": "fail",
                                "detail": "need ≥ 2 groups"}],
                    "recommendation": None, "explanation": ""}
        s_n_worst = "ok"
        for i, g in enumerate(groups):
            s_n, _, d_n = _shapiro_ok(g)
            checks.append({"name": f"normality grp {i+1}", "status": s_n, "detail": d_n})
            s_n_worst = _worst(s_n, s_n_worst)
        s_v, _, d_v = _levene_ok(groups)
        checks.append({"name": "equal variances", "status": s_v, "detail": d_v})
        if s_n_worst == "fail":
            rec = {"test": "kruskal", "label": "Kruskal-Wallis"}
            expl.append("Non-normal groups — use **Kruskal-Wallis** instead.")
        elif s_v == "fail":
            rec = {"test": "kruskal", "label": "Welch’s ANOVA (normal) · Kruskal-Wallis (non-normal)"}
            expl.append("Unequal variances but groups look normal — use **Welch’s ANOVA**; "
                        "if the groups are also non-normal, use **Kruskal-Wallis**.")
        else:
            expl.append("Assumptions look fine — one-way ANOVA is appropriate.")

    elif test == "chi_square":
        # Expected counts ≥ 5 in each cell (Cochran's rule).
        if not group_col:
            return {"status": "fail", "checks": [], "recommendation": None,
                    "explanation": "Provide group_col for chi-square."}
        ct = df.pivot_table(index=group_col, columns=column, aggfunc="size", fill_value=0).values
        if ct.size == 0:
            return {"status": "fail", "checks": [], "recommendation": None,
                    "explanation": "Contingency table empty."}
        chi2, p, dof, expected = sps.chi2_contingency(ct)
        n_small = int((expected < 5).sum())
        if n_small == 0:
            checks.append({"name": "expected cell counts", "status": "ok",
                           "detail": "all expected ≥ 5 (Cochran's rule met)"})
        elif n_small < 0.2 * expected.size:
            checks.append({"name": "expected cell counts", "status": "warn",
                           "detail": f"{n_small} cell(s) with expected < 5 — borderline"})
        else:
            checks.append({"name": "expected cell counts", "status": "fail",
                           "detail": f"{n_small}/{expected.size} cells expected < 5"})
            if ct.shape == (2, 2):
                rec = {"test": "fisher_exact", "label": "Fisher's exact test"}
                expl.append("Cochran's rule violated on a 2×2 — switch to **Fisher's exact**.")
            else:
                expl.append("Small expected counts — consider merging categories.")

    elif test == "mann_whitney":
        groups = [pd.to_numeric(g, errors="coerce").dropna().to_numpy()
                  for _, g in df.groupby(group_col)[column]]
        if len(groups) != 2:
            return {"status": "fail", "checks": [], "recommendation": None,
                    "explanation": "Need exactly 2 groups."}
        s1, d1 = _sample_size_ok(groups[0].size, 5, "group A")
        s2, d2 = _sample_size_ok(groups[1].size, 5, "group B")
        checks.append({"name": "sample size A", "status": s1, "detail": d1})
        checks.append({"name": "sample size B", "status": s2, "detail": d2})
        expl.append("Mann-Whitney is non-parametric — no distributional assumption.")

    # Bundle up
    overall = _worst(*[c["status"] for c in checks])
    return {"status": overall, "checks": checks,
            "recommendation": rec,
            "explanation": " ".join(expl) if expl else None}


def _check_regression(df: pd.DataFrame, params: dict) -> dict:
    response = params.get("response")
    predictors = params.get("predictors") or []
    method = params.get("method", "ols")
    checks = []
    expl = []

    if not response or not predictors:
        return {"status": "warn", "checks": [],
                "recommendation": None,
                "explanation": "Provide response + at least one predictor."}

    sub = df[[response] + predictors].apply(pd.to_numeric, errors="coerce").dropna()
    n = len(sub)
    p = len(predictors)
    # Rule of thumb: ≥ 10·p observations for stable estimates.
    s_n, d_n = _sample_size_ok(n, 10 * p, "regression rule of thumb")
    checks.append({"name": "sample size vs predictors", "status": s_n, "detail": d_n})

    # Approximate VIF via pairwise correlation — flag high collinearity early.
    if p >= 2:
        corr = sub[predictors].corr().abs()
        np.fill_diagonal(corr.values, 0)
        max_r = float(corr.values.max()) if corr.size else 0.0
        if max_r > 0.9:
            checks.append({"name": "predictor collinearity", "status": "fail",
                           "detail": f"max |r| = {max_r:.2f} — collinear predictors"})
            expl.append("Predictors are collinear (|r|>0.9) — drop one or use stepwise.")
        elif max_r > 0.7:
            checks.append({"name": "predictor collinearity", "status": "warn",
                           "detail": f"max |r| = {max_r:.2f} — moderate collinearity"})
        else:
            checks.append({"name": "predictor collinearity", "status": "ok",
                           "detail": f"max |r| = {max_r:.2f}"})

    # Outliers in response
    y = sub[response].to_numpy()
    s_o, _, d_o = _outliers(y)
    checks.append({"name": "response outliers", "status": s_o, "detail": d_o})
    if s_o == "fail" and method == "ols":
        expl.append("Many outliers — switch to **Robust regression** or remove first.")

    overall = _worst(*[c["status"] for c in checks])
    return {"status": overall, "checks": checks, "recommendation": None,
            "explanation": " ".join(expl) if expl else None}


def _check_capability(df: pd.DataFrame, params: dict) -> dict:
    column = params.get("column")
    lsl, usl = params.get("lsl"), params.get("usl")
    checks = []
    expl = []
    if not column:
        return {"status": "warn", "checks": [], "recommendation": None,
                "explanation": "Pick a column."}
    x = pd.to_numeric(df[column], errors="coerce").dropna().to_numpy()
    s_size, d_size = _sample_size_ok(x.size, 30, "capability (AIAG)")
    checks.append({"name": "sample size", "status": s_size, "detail": d_size})

    s_n, _, d_n = _shapiro_ok(x)
    checks.append({"name": "normality", "status": s_n, "detail": d_n})

    if lsl is None and usl is None:
        checks.append({"name": "spec limits", "status": "fail",
                       "detail": "no LSL or USL provided"})
    if s_n == "fail":
        expl.append("Distinctly non-normal — re-run with **Box-Cox** or **Johnson** transform.")
        rec = {"transform": "box-cox", "label": "Capability with Box-Cox transform"}
    else:
        rec = None

    overall = _worst(*[c["status"] for c in checks])
    return {"status": overall, "checks": checks, "recommendation": rec,
            "explanation": " ".join(expl) if expl else None}


def _check_msa(df: pd.DataFrame, params: dict) -> dict:
    # AIAG recommendations: ≥ 10 parts, ≥ 3 operators, ≥ 2-3 trials.
    measurement = params.get("measurement_col")
    part = params.get("part_col")
    op = params.get("operator_col")
    checks = []
    if not (measurement and part and op):
        return {"status": "warn", "checks": [], "recommendation": None,
                "explanation": "Provide measurement, part, and operator columns."}
    sub = df[[measurement, part, op]].dropna()
    n_parts = sub[part].nunique()
    n_ops = sub[op].nunique()
    # Trials per (part, op)
    trials = sub.groupby([part, op]).size()
    min_trials = int(trials.min()) if len(trials) else 0
    for label, n, min_n in [("parts", n_parts, 10),
                            ("operators", n_ops, 3),
                            ("trials per cell", min_trials, 2)]:
        if n >= min_n:
            checks.append({"name": label, "status": "ok",
                           "detail": f"{n} ≥ AIAG {min_n}"})
        elif n >= max(2, int(min_n * 0.7)):
            checks.append({"name": label, "status": "warn",
                           "detail": f"{n} below AIAG {min_n}"})
        else:
            checks.append({"name": label, "status": "fail",
                           "detail": f"{n} far below AIAG {min_n}"})

    overall = _worst(*[c["status"] for c in checks])
    return {"status": overall, "checks": checks,
            "recommendation": None,
            "explanation": ("AIAG calls for 10 parts × 3 ops × 2 trials minimum."
                            if overall != "ok" else None)}
