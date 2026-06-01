"""Conyso Original — the Variance Budget.

One picture that answers the only question that matters in Measure/Analyze:
"where does my variation actually come from?" Decomposes the total observed
variation in a response into named, additive sources (operator, machine, shift,
material, …) plus unexplained residual, as a single stacked contribution bar.

It's GR&R thinking generalised to any set of factors: instead of just
measurement-vs-part, budget the variance across whatever sources you measured —
so you attack the biggest bar first. Built on a Type-II ANOVA SS decomposition.
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf


def _png(fig):
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)
    return buf.getvalue()


def analyze(df: pd.DataFrame, response: str, factors: list) -> dict:
    """response: numeric. factors: categorical source columns to budget across."""
    if response not in df.columns:
        raise ValueError(f"response '{response}' not in dataset")
    factors = [f for f in (factors or []) if f in df.columns]
    if not factors:
        raise ValueError("provide at least one factor (source of variation)")
    cols = [response] + factors
    sub = df[cols].dropna().copy()
    sub[response] = pd.to_numeric(sub[response], errors="coerce")
    sub = sub.dropna(subset=[response])
    if len(sub) < len(factors) + 3:
        raise ValueError("not enough complete rows to decompose variance")

    # Safe placeholder names for the formula.
    fmap = {f: f"f{i}" for i, f in enumerate(factors)}
    data = sub.rename(columns={**fmap, response: "y"}).copy()
    for f, fn in fmap.items():
        data[fn] = data[fn].astype("category")
    rhs = " + ".join(f"C({fn})" for fn in fmap.values())
    model = smf.ols(f"y ~ {rhs}", data=data).fit()
    aov = sm.stats.anova_lm(model, typ=2)

    ss_total = float(aov["sum_sq"].sum())
    budget = []
    for f, fn in fmap.items():
        key = f"C({fn})"
        if key in aov.index:
            ss = float(aov.loc[key, "sum_sq"])
            p = float(aov.loc[key, "PR(>F)"]) if "PR(>F)" in aov.columns else None
            budget.append({"source": f, "ss": ss,
                           "pct": 100.0 * ss / ss_total if ss_total else 0.0,
                           "p_value": p,
                           "significant": (p is not None and p < 0.05)})
    resid_ss = float(aov.loc["Residual", "sum_sq"]) if "Residual" in aov.index else 0.0
    budget.append({"source": "Unexplained (residual)", "ss": resid_ss,
                   "pct": 100.0 * resid_ss / ss_total if ss_total else 0.0,
                   "p_value": None, "significant": False})
    budget.sort(key=lambda d: -d["pct"])

    # Stacked single-bar "budget".
    fig, ax = plt.subplots(figsize=(8, 2.6))
    palette = plt.cm.viridis(np.linspace(0.1, 0.9, len(budget)))
    left = 0.0
    for i, b in enumerate(budget):
        ax.barh([0], [b["pct"]], left=left, color=palette[i],
                label=f"{b['source']} ({b['pct']:.0f}%)")
        if b["pct"] > 6:
            ax.text(left + b["pct"] / 2, 0, f"{b['pct']:.0f}%", ha="center", va="center",
                    color="white", fontsize=9, fontweight="bold")
        left += b["pct"]
    ax.set_xlim(0, 100); ax.set_yticks([]); ax.set_xlabel("% of total variance")
    ax.set_title(f"Variance Budget — {response}")
    ax.legend(fontsize=8, ncol=2, loc="upper center", bbox_to_anchor=(0.5, -0.35))

    top = budget[0]
    return {"summary": {
        "method": "variance_budget",
        "response": response, "factors": factors,
        "n": int(len(sub)),
        "r_squared": float(model.rsquared),
        "budget": budget,
        "largest_source": top["source"], "largest_pct": top["pct"],
        "headline": f"{top['source']} accounts for {top['pct']:.0f}% of the variation in {response} — attack it first.",
        "note": "Variance budgeted across your named sources via a Type-II ANOVA decomposition. The residual is variation none of the listed factors explain — large residual = a driver you haven't measured yet.",
    }, "chart_png": _png(fig)}
