"""Predictive Cpk — "what would Cpk look like if we reduced variation
and/or shifted the mean?"

Inputs: current samples + LSL/USL + a list of scenarios (each scenario is
either a sigma multiplier and/or a mean shift). Returns the projected
Cp/Cpk for each scenario, plus a sensitivity sweep over a sigma reduction
grid for plotting.

This is deterministic — no LLM. The narrative interpretation lives in the
agent layer (analyst.js).
"""

from __future__ import annotations

import io
from typing import Optional, List, Dict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def _cp_cpk(mean: float, sigma: float, lsl: Optional[float], usl: Optional[float]):
    if sigma <= 0:
        return None, None
    cp = None
    if lsl is not None and usl is not None:
        cp = (usl - lsl) / (6 * sigma)
    cpu = (usl - mean) / (3 * sigma) if usl is not None else float("inf")
    cpl = (mean - lsl) / (3 * sigma) if lsl is not None else float("inf")
    cpk = min(cpu, cpl)
    return cp, cpk


def compute(
    df: pd.DataFrame,
    *,
    column: str,
    lsl: Optional[float] = None,
    usl: Optional[float] = None,
    scenarios: Optional[List[Dict]] = None,
):
    if column not in df.columns:
        raise ValueError(f"column '{column}' not in dataframe")
    s = df[column].dropna().astype(float)
    if len(s) < 5:
        raise ValueError("not enough data (need ≥ 5 samples)")
    cur_mean = float(s.mean())
    cur_sigma = float(s.std(ddof=1))
    cur_cp, cur_cpk = _cp_cpk(cur_mean, cur_sigma, lsl, usl)

    # Default scenarios: 10/20/30/50% sigma reduction, plus mean-centered.
    if scenarios is None:
        scenarios = [
            {"label": "Reduce σ by 10%", "sigma_mult": 0.9},
            {"label": "Reduce σ by 20%", "sigma_mult": 0.8},
            {"label": "Reduce σ by 30%", "sigma_mult": 0.7},
            {"label": "Reduce σ by 50%", "sigma_mult": 0.5},
        ]
        if lsl is not None and usl is not None:
            target = (lsl + usl) / 2
            if abs(cur_mean - target) > 0.05 * cur_sigma:
                scenarios.append({
                    "label": "Center the process at target",
                    "mean_shift": target - cur_mean,
                })

    results = []
    for sc in scenarios:
        m = cur_mean + float(sc.get("mean_shift", 0))
        sg = cur_sigma * float(sc.get("sigma_mult", 1.0))
        cp, cpk = _cp_cpk(m, sg, lsl, usl)
        results.append({
            "label": sc.get("label") or "scenario",
            "projected_mean": m,
            "projected_sigma": sg,
            "projected_cp": cp,
            "projected_cpk": cpk,
            "improvement_in_cpk": (cpk - cur_cpk) if (cpk is not None and cur_cpk is not None) else None,
            "scenario": sc,
        })

    # Sigma-reduction sensitivity sweep for plotting.
    sweep_grid = np.linspace(0.3, 1.0, 30)
    sweep_cpk = []
    for k in sweep_grid:
        _, cpk = _cp_cpk(cur_mean, cur_sigma * k, lsl, usl)
        sweep_cpk.append(cpk)

    chart = _plot(sweep_grid, sweep_cpk, cur_cpk, results)

    return {
        "summary": {
            "current_mean": cur_mean,
            "current_sigma": cur_sigma,
            "current_cp": cur_cp,
            "current_cpk": cur_cpk,
            "lsl": lsl, "usl": usl,
            "n": int(len(s)),
            "scenarios": results,
        },
        "chart_png": chart,
    }


def _plot(grid, cpk_curve, cur_cpk, scenarios):
    from stats._theme import INK_2, SUCCESS, WARN, MUTED, DANGER
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(grid, cpk_curve, lw=2, color=INK_2)
    ax.axhline(1.33, color=SUCCESS, linestyle="--", label="Cpk = 1.33 (capable)")
    ax.axhline(1.0, color=WARN, linestyle="--", label="Cpk = 1.0 (marginal)")
    ax.axvline(1.0, color=MUTED, linestyle=":")
    if cur_cpk is not None:
        ax.scatter([1.0], [cur_cpk], color=DANGER, s=80, zorder=5, label=f"Current Cpk = {cur_cpk:.2f}")
    for sc in scenarios:
        m = sc["scenario"].get("sigma_mult", 1.0)
        if sc["projected_cpk"] is not None:
            ax.scatter([m], [sc["projected_cpk"]], s=50, color=INK_2, zorder=4)
            ax.annotate(sc["label"], xy=(m, sc["projected_cpk"]),
                        xytext=(5, 5), textcoords="offset points", fontsize=8)
    ax.set_xlabel("σ multiplier (1.0 = current)")
    ax.set_ylabel("Projected Cpk")
    ax.set_title("Predictive Cpk vs σ reduction")
    ax.legend(loc="lower left", fontsize=9)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130)
    plt.close(fig)
    return buf.getvalue()
