"""Survey / Likert analysis — the Voice-of-the-Customer toolkit Minitab barely
covers. Treats a set of Likert-scale item columns as a measurement scale and
reports its reliability (Cronbach's alpha), which items pull their weight
(item-total correlation, alpha-if-item-deleted), the response distribution,
and top-/bottom-box summaries.

Pure numpy/scipy. A scale's alpha is the survey analogue of Gauge R&R — it
tells you whether your questionnaire measures one coherent construct reliably.
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def _png(fig):
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)
    return buf.getvalue()


def _cronbach(X: np.ndarray) -> float:
    """Cronbach's alpha = (k/(k-1)) · (1 − Σσ²_item / σ²_total)."""
    k = X.shape[1]
    if k < 2:
        raise ValueError("Cronbach's alpha needs at least 2 items")
    item_var = X.var(axis=0, ddof=1)
    total_var = X.sum(axis=1).var(ddof=1)
    if total_var == 0:
        return float("nan")
    return float((k / (k - 1)) * (1 - item_var.sum() / total_var))


def _alpha_label(a: float) -> str:
    if a != a:  # nan
        return "undefined"
    if a >= 0.9:  return "excellent"
    if a >= 0.8:  return "good"
    if a >= 0.7:  return "acceptable"
    if a >= 0.6:  return "questionable"
    if a >= 0.5:  return "poor"
    return "unacceptable"


def analyze(df: pd.DataFrame, items: list, scale_min: int | None = None,
            scale_max: int | None = None) -> dict:
    """items: the Likert-item columns (each an ordinal response, e.g. 1–5)."""
    if not items or len(items) < 2:
        raise ValueError("provide at least 2 Likert item columns")
    sub = df[items].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < 3:
        raise ValueError("need at least 3 complete responses")
    X = sub.to_numpy(dtype=float)
    n, k = X.shape
    lo = scale_min if scale_min is not None else int(np.floor(X.min()))
    hi = scale_max if scale_max is not None else int(np.ceil(X.max()))

    alpha = _cronbach(X)
    total = X.sum(axis=1)

    # Per-item diagnostics: corrected item-total correlation + alpha-if-deleted.
    item_stats = []
    for j, name in enumerate(items):
        rest = np.delete(X, j, axis=1)
        rest_total = rest.sum(axis=1)
        if np.std(X[:, j]) > 0 and np.std(rest_total) > 0:
            itc = float(np.corrcoef(X[:, j], rest_total)[0, 1])
        else:
            itc = None
        alpha_del = _cronbach(rest) if k - 1 >= 2 else None
        item_stats.append({
            "item": name,
            "mean": float(X[:, j].mean()),
            "sd": float(X[:, j].std(ddof=1)),
            "item_total_corr": itc,
            "alpha_if_deleted": alpha_del,
            "flag": ("low discrimination" if (itc is not None and itc < 0.3) else
                     "improves alpha if dropped" if (alpha_del is not None and alpha is not None and alpha_del > alpha + 0.02)
                     else None),
        })

    # Response distribution per level + top/bottom-box (treating the scale ends).
    levels = list(range(lo, hi + 1))
    all_resp = X.flatten()
    dist = {str(lv): int(np.sum(np.round(all_resp) == lv)) for lv in levels}
    n_resp = all_resp.size
    top_box = float(np.mean(all_resp >= hi)) * 100
    top2 = float(np.mean(all_resp >= hi - 1)) * 100
    bottom2 = float(np.mean(all_resp <= lo + 1)) * 100

    # Chart: stacked Likert distribution per item.
    fig, ax = plt.subplots(figsize=(8, max(2.4, 0.5 * k + 1)))
    palette = plt.cm.RdYlGn(np.linspace(0.15, 0.85, len(levels)))
    left = np.zeros(k)
    for li, lv in enumerate(levels):
        widths = np.array([np.mean(np.round(X[:, j]) == lv) * 100 for j in range(k)])
        ax.barh(range(k), widths, left=left, color=palette[li], label=str(lv))
        left += widths
    ax.set_yticks(range(k)); ax.set_yticklabels(items, fontsize=9); ax.invert_yaxis()
    ax.set_xlabel("% of responses"); ax.set_xlim(0, 100)
    ax.set_title(f"Likert response distribution (α = {alpha:.2f})")
    ax.legend(title="level", fontsize=8, ncol=len(levels), loc="lower center", bbox_to_anchor=(0.5, -0.25))

    return {"summary": {
        "method": "survey_likert",
        "n_respondents": int(n), "n_items": int(k),
        "scale": [lo, hi],
        "cronbach_alpha": alpha,
        "alpha_interpretation": _alpha_label(alpha),
        "scale_mean": float(total.mean()), "scale_sd": float(total.std(ddof=1)),
        "items": item_stats,
        "response_distribution": dist,
        "top_box_pct": top_box, "top_2_box_pct": top2, "bottom_2_box_pct": bottom2,
        "n_responses": int(n_resp),
        "note": "Cronbach's alpha is the survey analogue of Gauge R&R: it tells you whether the items reliably measure one construct. ≥0.7 is the usual acceptability floor.",
    }, "chart_png": _png(fig)}
