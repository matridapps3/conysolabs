"""Analysis of Means (ANOM) — graphical alternative to ANOVA. Plots each
group mean against decision limits derived from the grand mean ± a
critical multiplier of the pooled standard error. Easier for shop-floor
users to interpret than an F-table.
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats as sps


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def compute(df: pd.DataFrame, value_col: str, group_col: str,
            alpha: float = 0.05) -> dict:
    sub = df[[value_col, group_col]].dropna()
    groups = list(sub.groupby(group_col)[value_col])
    k = len(groups)
    if k < 2:
        raise ValueError("ANOM: need at least 2 groups")
    arrays = [g.dropna().astype(float).to_numpy() for _, g in groups]
    keys = [str(name) for name, _ in groups]
    means = np.array([a.mean() for a in arrays])
    n_per = np.array([a.size for a in arrays])
    n_total = int(n_per.sum())
    grand = float((means * n_per).sum() / n_total)
    # Pooled MSE
    sse = sum(((a - a.mean()) ** 2).sum() for a in arrays)
    df_pool = n_total - k
    mse = sse / df_pool if df_pool > 0 else float("nan")
    # ANOM critical value h via approximation: t with Bonferroni correction.
    h = float(sps.t.ppf(1 - alpha / (2 * k), df=df_pool))
    se = np.sqrt(mse * (k - 1) / (k * n_per))
    ucl = grand + h * se
    lcl = grand - h * se

    fig, ax = plt.subplots(figsize=(7.5, 4.0))
    xs = np.arange(k)
    ax.plot(xs, means, marker="o", linestyle="None")
    ax.plot(xs, ucl, linestyle="--", marker="_")
    ax.plot(xs, lcl, linestyle="--", marker="_")
    ax.axhline(grand, linestyle="-")
    ax.set_xticks(xs)
    ax.set_xticklabels(keys, rotation=45, ha="right")
    ax.set_ylabel(value_col)
    ax.set_title(f"ANOM — {value_col} by {group_col} (α={alpha})")
    return {
        "summary": {
            "method": "anom", "alpha": alpha, "k_groups": k,
            "n_total": n_total,
            "grand_mean": grand, "mse": float(mse), "h_critical": h,
            "groups": [
                {"name": k_, "n": int(n), "mean": float(m),
                 "lcl": float(l), "ucl": float(u),
                 "out_of_limits": bool(m > u or m < l)}
                for k_, n, m, l, u in zip(keys, n_per, means, lcl, ucl)
            ],
        },
        "chart_png": _png(fig),
    }
