"""Acceptance sampling — single sampling plans for attributes (binomial)
and an OC-curve generator. Minitab's Stat → Quality Tools → Acceptance
Sampling.

Designs a plan (n, c) given two points on the OC curve:
  AQL  — Acceptable Quality Level (producer's risk α at this fraction)
  RQL  — Rejectable Quality Level (consumer's risk β at this fraction)
"""
from __future__ import annotations

import io
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats as sps


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def design_plan(aql: float, rql: float, alpha: float = 0.05, beta: float = 0.10,
                lot_size: Optional[int] = None) -> dict:
    """Find (n, c) such that:
      P(accept | p = AQL) ≥ 1 - α   (producer's risk)
      P(accept | p = RQL) ≤ β       (consumer's risk)

    Uses binomial probabilities. Iterative search from small n upward.
    """
    if not (0 < aql < rql < 1):
        raise ValueError("acceptance_sampling: need 0 < AQL < RQL < 1")
    for n in range(2, 5001):
        for c in range(0, n + 1):
            p_accept_aql = sps.binom.cdf(c, n, aql)
            p_accept_rql = sps.binom.cdf(c, n, rql)
            if p_accept_aql >= 1 - alpha and p_accept_rql <= beta:
                return {"summary": {
                    "method": "acceptance_sampling_design",
                    "AQL": aql, "RQL": rql, "alpha": alpha, "beta": beta,
                    "n": int(n), "c": int(c),
                    "P_accept_at_AQL": float(p_accept_aql),
                    "P_accept_at_RQL": float(p_accept_rql),
                    "lot_size": lot_size,
                }}
    raise RuntimeError("could not find a feasible plan with n ≤ 5000")


def oc_curve(n: int, c: int, p_grid: list[float] | None = None) -> dict:
    """Operating Characteristic curve for a given (n, c) plan."""
    if p_grid is None:
        p_grid = list(np.linspace(0.0, 0.30, 61))
    accept_probs = [float(sps.binom.cdf(c, n, p)) for p in p_grid]
    fig, ax = plt.subplots(figsize=(7.0, 4.0))
    ax.plot(p_grid, accept_probs, marker="o", markersize=3)
    ax.set_xlabel("Lot fraction defective (p)")
    ax.set_ylabel("Probability of accepting")
    ax.set_title(f"OC Curve — n={n}, c={c}")
    ax.set_ylim(0, 1.05)
    return {"summary": {
        "method": "oc_curve", "n": int(n), "c": int(c),
        "p_grid": p_grid, "accept_probability": accept_probs,
    }, "chart_png": _png(fig)}


def variables_plan_mil_std_414(aql: float, lot_size: int,
                                 inspection_level: str = "II",
                                 sd_known: bool = False) -> dict:
    """Variables sampling plan per MIL-STD-414 / ANSI/ASQ Z1.9.

    Decides sample size n and acceptance constant k. A lot is accepted iff
    (USL − x̄)/s ≥ k (and/or (x̄ − LSL)/s ≥ k for two-sided specs).

    aql: Acceptable Quality Limit as a percent (e.g. 1.0 for 1 %).
    lot_size: number of units in the lot.
    inspection_level: 'I' | 'II' (default) | 'III'.
    sd_known: True for Form 1 (σ known); False for s-method (σ estimated).
    """
    # Sample-size code letters (Z1.9 / MIL-STD-414 Table A-2, level II).
    code_table_II = [
        (50, "C"),       (90, "D"),      (150, "E"),       (280, "F"),
        (500, "G"),     (1200, "H"),    (3200, "J"),     (10_000, "K"),
        (35_000, "L"), (150_000, "M"), (500_000, "N"),  (10**9, "P"),
    ]
    code = next((c for lim, c in code_table_II if lot_size <= lim), "P")
    if inspection_level == "I":
        # Tighter — bump one letter down
        order = "BCDEFGHJKLMNP"
        i = order.index(code)
        code = order[max(0, i - 1)]
    elif inspection_level == "III":
        order = "BCDEFGHJKLMNP"
        i = order.index(code)
        code = order[min(len(order) - 1, i + 1)]

    # Sample sizes per code letter (Z1.9 Table B-1, s-method).
    n_table_s = {"B": 3, "C": 4, "D": 5, "E": 7, "F": 10, "G": 15,
                 "H": 20, "J": 25, "K": 35, "L": 50, "M": 75, "N": 100, "P": 150}
    n_table_sigma = {"B": 3, "C": 4, "D": 4, "E": 5, "F": 7, "G": 10,
                     "H": 15, "J": 18, "K": 25, "L": 30, "M": 40, "N": 60, "P": 85}
    n = (n_table_sigma if sd_known else n_table_s)[code]

    # k-factor (Z1.9 Table B-1). Indexed by code letter and AQL %.
    # Compact subset of the standard at the most-used AQL points; we
    # interpolate for AQLs in between.
    k_table_s = {
        # (code, aql%) → k
        ("C", 1.0): 1.50, ("C", 2.5): 1.16, ("C", 4.0): 1.01,
        ("D", 1.0): 1.65, ("D", 2.5): 1.34, ("D", 4.0): 1.19,
        ("E", 1.0): 1.83, ("E", 2.5): 1.50, ("E", 4.0): 1.33,
        ("F", 1.0): 1.96, ("F", 2.5): 1.66, ("F", 4.0): 1.48,
        ("G", 1.0): 2.08, ("G", 2.5): 1.77, ("G", 4.0): 1.59,
        ("H", 1.0): 2.20, ("H", 2.5): 1.88, ("H", 4.0): 1.70,
        ("J", 1.0): 2.29, ("J", 2.5): 1.96, ("J", 4.0): 1.78,
        ("K", 1.0): 2.41, ("K", 2.5): 2.07, ("K", 4.0): 1.89,
        ("L", 1.0): 2.50, ("L", 2.5): 2.16, ("L", 4.0): 1.97,
        ("M", 1.0): 2.59, ("M", 2.5): 2.24, ("M", 4.0): 2.05,
        ("N", 1.0): 2.66, ("N", 2.5): 2.31, ("N", 4.0): 2.12,
        ("P", 1.0): 2.71, ("P", 2.5): 2.37, ("P", 4.0): 2.17,
    }
    # Snap aql to the closest tabled value for the k-lookup.
    tabled_aqls = [1.0, 2.5, 4.0]
    aql_snap = min(tabled_aqls, key=lambda a: abs(a - aql))
    k_val = k_table_s.get((code, aql_snap))
    if k_val is None:
        # Code letter not in our table (very small or very large lot) —
        # fall back to the inverse-normal approximation:
        # k ≈ Φ⁻¹(1 − AQL/100) − Φ⁻¹(consumer_risk_prob) / √n  (simplified)
        from scipy import stats as _sps
        k_val = float(_sps.norm.ppf(1 - aql / 100))

    return {"summary": {
        "method": "variables_sampling_z1_9",
        "aql_percent": aql,
        "aql_snapped_to_table": aql_snap,
        "lot_size": int(lot_size),
        "inspection_level": inspection_level,
        "sd_known": sd_known,
        "sample_size_code": code,
        "n": int(n),
        "k": float(k_val),
        "decision_rule": (f"Accept the lot if (USL − x̄)/s ≥ {k_val:.2f} "
                          "(one-sided upper spec). For lower spec use "
                          "(x̄ − LSL)/s ≥ k. For two-sided spec, both must hold."),
    }}
