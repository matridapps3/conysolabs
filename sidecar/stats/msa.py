"""Gauge R&R via crossed ANOVA (AIAG MSA, 4th ed.).

Inputs:
  measurement_col: numeric measurement
  part_col:        identifier for parts
  operator_col:    identifier for operators
  n_replicates:    inferred from data; must be balanced

Outputs variance components for Repeatability (EV), Reproducibility (AV),
Part-to-Part (PV), Total (TV), and %Study Variation + %Tolerance (if tol given).
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from statsmodels.stats.anova import anova_lm


def compute(df: pd.DataFrame, measurement_col: str, part_col: str, operator_col: str,
            tolerance: float | None = None) -> dict:
    sub = df[[measurement_col, part_col, operator_col]].dropna().copy()
    sub.columns = ["y", "part", "op"]
    sub["part"] = sub["part"].astype(str)
    sub["op"] = sub["op"].astype(str)

    n_parts = sub["part"].nunique()
    n_ops = sub["op"].nunique()
    counts = sub.groupby(["part", "op"]).size()
    if counts.nunique() != 1:
        raise ValueError(f"unbalanced design: replicates per part×operator vary {set(counts)}")
    n_rep = int(counts.iloc[0])
    if n_parts < 2 or n_ops < 2 or n_rep < 2:
        raise ValueError("need ≥2 parts, ≥2 operators, ≥2 replicates")

    model = smf.ols("y ~ C(part) + C(op) + C(part):C(op)", data=sub).fit()
    aov = anova_lm(model, typ=2)

    ms_part = aov.loc["C(part)", "sum_sq"] / aov.loc["C(part)", "df"]
    ms_op   = aov.loc["C(op)", "sum_sq"]   / aov.loc["C(op)", "df"]
    ms_int  = aov.loc["C(part):C(op)", "sum_sq"] / aov.loc["C(part):C(op)", "df"]
    ms_err  = aov.loc["Residual", "sum_sq"] / aov.loc["Residual", "df"]

    var_repeat = ms_err
    var_inter = max(0.0, (ms_int - ms_err) / n_rep)
    var_op    = max(0.0, (ms_op - ms_int) / (n_parts * n_rep))
    var_part  = max(0.0, (ms_part - ms_int) / (n_ops * n_rep))

    var_repro = var_op + var_inter
    var_grr   = var_repeat + var_repro
    var_total = var_grr + var_part

    sd = {k: float(np.sqrt(v)) for k, v in {
        "EV (repeat)": var_repeat, "AV (reprod)": var_repro,
        "GRR": var_grr, "PV (part)": var_part, "TV (total)": var_total,
    }.items()}

    pct_study = {k: 100.0 * sd[k] / sd["TV (total)"] if sd["TV (total)"] else None for k in sd}
    pct_tol = None
    if tolerance:
        pct_tol = {k: 100.0 * (6 * sd[k]) / float(tolerance) for k in sd}

    ndc = float(np.sqrt(2.0) * sd["PV (part)"] / sd["GRR"]) if sd["GRR"] else None

    # Component bar chart
    fig, ax = plt.subplots(figsize=(7, 3.4))
    keys = ["EV (repeat)", "AV (reprod)", "GRR", "PV (part)"]
    vals = [pct_study[k] for k in keys]
    ax.bar(keys, vals)
    ax.set_ylabel("% Study Variation"); ax.set_title("Gauge R&R")
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    return {
        "summary": {
            "design": "crossed",
            "n_parts": int(n_parts), "n_operators": int(n_ops), "n_replicates": int(n_rep),
            "variance": {"repeat": float(var_repeat), "operator": float(var_op),
                         "interaction": float(var_inter), "part": float(var_part),
                         "grr": float(var_grr), "total": float(var_total)},
            "stdev": sd,
            "pct_study": pct_study,
            "pct_tolerance": pct_tol,
            "ndc": ndc,
            "total_grr_pct": float(pct_study.get("GRR", 0.0)),
            "repeatability_pct":   float(pct_study.get("EV (repeat)", 0.0)),
            "reproducibility_pct": float(pct_study.get("AV (reprod)", 0.0)),
            "anova": aov.reset_index().rename(columns={"index": "source"}).to_dict(orient="records"),
        },
        "chart_png": buf.getvalue(),
    }


def compute_nested(df: pd.DataFrame, measurement_col: str, part_col: str,
                   operator_col: str, tolerance: float | None = None) -> dict:
    """Nested GR&R — each operator measures DIFFERENT parts (parts are nested
    within operators). Common in destructive testing where the same part can't
    be measured twice. Variance components come from a two-level ANOVA with
    parts nested in operators (AIAG MSA, 4th ed., Section IV.C).
    """
    sub = df[[measurement_col, part_col, operator_col]].dropna().copy()
    sub.columns = ["y", "part", "op"]
    sub["part"] = sub["part"].astype(str)
    sub["op"]   = sub["op"].astype(str)
    counts = sub.groupby(["op", "part"]).size()
    if counts.nunique() != 1:
        raise ValueError(f"unbalanced nested design: replicates vary {set(counts)}")
    n_rep   = int(counts.iloc[0])
    n_ops   = sub["op"].nunique()
    n_parts_per_op = int(sub.groupby("op")["part"].nunique().iloc[0])
    if n_ops < 2 or n_parts_per_op < 2 or n_rep < 2:
        raise ValueError("need ≥2 operators, ≥2 parts/operator, ≥2 replicates")

    # ANOVA: y ~ op / part  (part nested in op).
    # Order matters: the interaction-term key in the ANOVA table mirrors
    # the formula order. Previously the formula said `C(part):C(op)` but
    # the lookup said `C(op):C(part)`, which always raised KeyError —
    # making compute_nested unusable. Match them both as `C(op):C(part)`.
    model = smf.ols("y ~ C(op) + C(op):C(part)", data=sub).fit()
    aov = anova_lm(model, typ=2)
    ms_op   = aov.loc["C(op)", "sum_sq"] / aov.loc["C(op)", "df"]
    ms_part = aov.loc["C(op):C(part)", "sum_sq"] / aov.loc["C(op):C(part)", "df"]
    ms_err  = aov.loc["Residual", "sum_sq"] / aov.loc["Residual", "df"]

    var_repeat = ms_err
    var_part   = max(0.0, (ms_part - ms_err) / n_rep)
    var_op     = max(0.0, (ms_op - ms_part) / (n_parts_per_op * n_rep))
    var_grr    = var_repeat + var_op    # no operator×part interaction in nested
    var_total  = var_grr + var_part

    sd = {k: float(np.sqrt(v)) for k, v in {
        "EV (repeat)": var_repeat, "AV (reprod)": var_op,
        "GRR": var_grr, "PV (part)": var_part, "TV (total)": var_total,
    }.items()}
    pct_study = {k: 100.0 * sd[k] / sd["TV (total)"] if sd["TV (total)"] else None for k in sd}
    pct_tol = None
    if tolerance:
        pct_tol = {k: 100.0 * (6 * sd[k]) / float(tolerance) for k in sd}
    ndc = float(np.sqrt(2.0) * sd["PV (part)"] / sd["GRR"]) if sd["GRR"] else None

    fig, ax = plt.subplots(figsize=(7, 3.4))
    keys = ["EV (repeat)", "AV (reprod)", "GRR", "PV (part)"]
    vals = [pct_study[k] for k in keys]
    ax.bar(keys, vals)
    ax.set_ylabel("% Study Variation"); ax.set_title("Gauge R&R (nested)")
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    return {
        "summary": {
            "design": "nested",
            "n_operators": int(n_ops),
            "n_parts_per_operator": int(n_parts_per_op),
            "n_replicates": int(n_rep),
            "variance": {"repeat": float(var_repeat), "operator": float(var_op),
                         "part": float(var_part), "grr": float(var_grr), "total": float(var_total)},
            "stdev": sd,
            "pct_study": pct_study,
            "pct_tolerance": pct_tol,
            "ndc": ndc,
            "total_grr_pct": float(pct_study.get("GRR", 0.0)),
            "repeatability_pct":   float(pct_study.get("EV (repeat)", 0.0)),
            "reproducibility_pct": float(pct_study.get("AV (reprod)", 0.0)),
            "anova": aov.reset_index().rename(columns={"index": "source"}).to_dict(orient="records"),
        },
        "chart_png": buf.getvalue(),
    }


def compute_expanded(df: pd.DataFrame, measurement_col: str, part_col: str,
                     operator_col: str, factor_cols: list[str] | None = None,
                     tolerance: float | None = None) -> dict:
    """Expanded GR&R — beyond operator × part, include additional sources of
    variation supplied via factor_cols (e.g. environment, day, gauge). Each
    extra factor's variance component is added to reproducibility. AIAG MSA
    Section IV.D (expanded variance components).
    """
    factor_cols = factor_cols or []
    needed = [measurement_col, part_col, operator_col] + list(factor_cols)
    sub = df[needed].dropna().copy()
    sub.columns = ["y", "part", "op"] + factor_cols
    for c in ["part", "op"] + factor_cols:
        sub[c] = sub[c].astype(str)
    counts = sub.groupby(["part", "op"] + factor_cols).size()
    if counts.nunique() != 1:
        raise ValueError("unbalanced expanded design")
    n_rep = int(counts.iloc[0])

    # Build the ANOVA formula.
    terms = ["C(part)", "C(op)"] + [f"C({c})" for c in factor_cols] + ["C(part):C(op)"]
    formula = "y ~ " + " + ".join(terms)
    model = smf.ols(formula, data=sub).fit()
    aov = anova_lm(model, typ=2)
    ms_err = aov.loc["Residual", "sum_sq"] / aov.loc["Residual", "df"]

    # Variance estimate for each factor source — simple method-of-moments
    # MS−MSE / divisor, where divisor is the design replication count for
    # that term. We use the broad divisor `n_total / df_factor` as a
    # conservative estimate (statsmodels doesn't give us EMS coefficients
    # directly for arbitrary designs).
    var_components = {"repeat": float(ms_err)}
    n_total = len(sub)
    for term in [t for t in aov.index if t != "Residual"]:
        ms = aov.loc[term, "sum_sq"] / aov.loc[term, "df"]
        divisor = max(1, n_total / aov.loc[term, "df"])
        var_components[term] = float(max(0.0, (ms - ms_err) / divisor))

    var_part   = var_components.get("C(part)", 0.0)
    var_op     = var_components.get("C(op)", 0.0)
    var_inter  = var_components.get("C(part):C(op)", 0.0)
    extra_repro = sum(var_components[f"C({c})"] for c in factor_cols if f"C({c})" in var_components)
    var_repro  = var_op + var_inter + extra_repro
    var_grr    = var_components["repeat"] + var_repro
    var_total  = var_grr + var_part

    sd = {k: float(np.sqrt(v)) for k, v in {
        "EV (repeat)": var_components["repeat"], "AV (reprod)": var_repro,
        "GRR": var_grr, "PV (part)": var_part, "TV (total)": var_total,
    }.items()}
    pct_study = {k: 100.0 * sd[k] / sd["TV (total)"] if sd["TV (total)"] else None for k in sd}
    pct_tol = None
    if tolerance:
        pct_tol = {k: 100.0 * (6 * sd[k]) / float(tolerance) for k in sd}
    ndc = float(np.sqrt(2.0) * sd["PV (part)"] / sd["GRR"]) if sd["GRR"] else None

    fig, ax = plt.subplots(figsize=(7, 3.4))
    keys = ["EV (repeat)", "AV (reprod)", "GRR", "PV (part)"]
    vals = [pct_study[k] for k in keys]
    ax.bar(keys, vals)
    ax.set_ylabel("% Study Variation"); ax.set_title(f"Gauge R&R (expanded · +{', '.join(factor_cols) or 'none'})")
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    return {
        "summary": {
            "design": "expanded",
            "extra_factors": list(factor_cols),
            "n_replicates": int(n_rep),
            "variance": var_components,
            "stdev": sd,
            "pct_study": pct_study,
            "pct_tolerance": pct_tol,
            "ndc": ndc,
            "total_grr_pct": float(pct_study.get("GRR", 0.0)),
            "repeatability_pct":   float(pct_study.get("EV (repeat)", 0.0)),
            "reproducibility_pct": float(pct_study.get("AV (reprod)", 0.0)),
            "anova": aov.reset_index().rename(columns={"index": "source"}).to_dict(orient="records"),
        },
        "chart_png": buf.getvalue(),
    }
