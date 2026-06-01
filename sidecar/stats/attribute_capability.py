"""Attribute capability analysis — for binomial (defective rate) and
Poisson (defects-per-unit) data. Replaces Minitab's Stat → Quality Tools
→ Capability Analysis → Binomial / Poisson.

Produces overall defective / defects rate, control limits as a sanity
check, sigma level, and a per-subgroup p-chart or u-chart for visual
stability assessment.
"""
from __future__ import annotations

import io
import math

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


def binomial(df: pd.DataFrame, defectives_col: str, n_col: str,
             target_p: float | None = None) -> dict:
    """Capability for go/no-go data. Each row = one subgroup with
    `defectives` defective items out of `n` inspected.

    Returns:
      overall defective rate, DPMO, sigma level (z-bench),
      control limits for the p-chart (sanity stability check).
    """
    sub = df[[defectives_col, n_col]].dropna()
    d = sub[defectives_col].astype(float).to_numpy()
    n = sub[n_col].astype(float).to_numpy()
    if (n <= 0).any():
        raise ValueError("binomial capability: n must be > 0 in every row")
    p_hat = float(d.sum() / n.sum())
    dpmo = p_hat * 1_000_000
    z_bench = float(sps.norm.isf(p_hat)) if 0 < p_hat < 1 else None
    # 95% CI on the overall p (Wilson)
    n_total = float(n.sum())
    z = 1.96
    denom = 1 + z * z / n_total
    centre = p_hat + z * z / (2 * n_total)
    half = z * np.sqrt(p_hat * (1 - p_hat) / n_total + z * z / (4 * n_total * n_total))
    ci = ((centre - half) / denom, (centre + half) / denom)

    # p-chart for visual stability
    p_per = d / n
    se = np.sqrt(p_hat * (1 - p_hat) / n)
    ucl = np.minimum(1.0, p_hat + 3 * se)
    lcl = np.maximum(0.0, p_hat - 3 * se)
    fig, ax = plt.subplots(figsize=(8.0, 3.5))
    xs = np.arange(1, len(p_per) + 1)
    ax.plot(xs, p_per, marker="o")
    ax.plot(xs, ucl, linestyle="--"); ax.plot(xs, lcl, linestyle="--")
    ax.axhline(p_hat, linestyle="-")
    if target_p is not None:
        ax.axhline(target_p, linestyle=":", label=f"target={target_p}")
        ax.legend()
    ax.set_title("Binomial capability — p-chart")
    ax.set_ylabel("p")
    return {
        "summary": {
            "method": "binomial_capability",
            "n_subgroups": int(len(sub)),
            "n_total": int(n_total),
            "defectives_total": int(d.sum()),
            "p_hat": p_hat, "DPMO": float(dpmo), "z_bench": z_bench,
            "p_ci_95": [float(ci[0]), float(ci[1])],
            "target_p": target_p,
            "stable": bool(((p_per <= ucl) & (p_per >= lcl)).all()),
        },
        "chart_png": _png(fig),
    }


def poisson(df: pd.DataFrame, defects_col: str, n_col: str,
            target_dpu: float | None = None) -> dict:
    """Capability for defect-count data. Each row = one subgroup with
    `defects` defects observed in `n` opportunities (or units).

    Returns:
      overall DPU (defects per unit), DPMO assuming opportunities = n,
      sigma level, u-chart for stability.
    """
    sub = df[[defects_col, n_col]].dropna()
    d = sub[defects_col].astype(float).to_numpy()
    n = sub[n_col].astype(float).to_numpy()
    if (n <= 0).any():
        raise ValueError("poisson capability: n must be > 0 in every row")
    dpu = float(d.sum() / n.sum())
    # 95% CI for the overall mean rate via chi-squared exact bounds.
    total_d = float(d.sum())
    total_n = float(n.sum())
    if total_d > 0:
        ci_lo = sps.chi2.ppf(0.025, 2 * total_d) / 2 / total_n
        ci_hi = sps.chi2.ppf(0.975, 2 * (total_d + 1)) / 2 / total_n
    else:
        ci_lo, ci_hi = 0.0, sps.chi2.ppf(0.975, 2) / 2 / total_n
    # Sigma level — assuming defects ≪ opportunities, the Poisson DPMO
    # corresponds to a one-sided z.
    dpmo = dpu * 1_000_000
    z_bench = float(sps.norm.isf(dpu)) if 0 < dpu < 1 else None

    # u-chart
    u = d / n
    se = np.sqrt(dpu / n)
    ucl = dpu + 3 * se
    lcl = np.maximum(0.0, dpu - 3 * se)
    fig, ax = plt.subplots(figsize=(8.0, 3.5))
    xs = np.arange(1, len(u) + 1)
    ax.plot(xs, u, marker="o")
    ax.plot(xs, ucl, linestyle="--"); ax.plot(xs, lcl, linestyle="--")
    ax.axhline(dpu, linestyle="-")
    if target_dpu is not None:
        ax.axhline(target_dpu, linestyle=":", label=f"target DPU={target_dpu}")
        ax.legend()
    ax.set_title("Poisson capability — u-chart")
    ax.set_ylabel("defects/unit")
    return {
        "summary": {
            "method": "poisson_capability",
            "n_subgroups": int(len(sub)),
            "n_total": float(total_n),
            "defects_total": int(total_d),
            "DPU": dpu, "DPMO": float(dpmo), "z_bench": z_bench,
            "DPU_ci_95": [float(ci_lo), float(ci_hi)],
            "target_DPU": target_dpu,
            "stable": bool(((u <= ucl) & (u >= lcl)).all()),
        },
        "chart_png": _png(fig),
    }
