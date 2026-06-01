"""Capability Sixpack — single-page report combining histogram with
spec lines, X-bar/R or I-MR control chart, capability indices, and a
normal probability plot. Minitab's named "Capability Sixpack" output.

Bill produces all the parts as separate analyses already; this module
returns them bundled with one PNG containing all six panels.
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


def compute(df: pd.DataFrame, column: str, lsl: float | None, usl: float | None,
            subgroup_col: str | None = None, target: float | None = None) -> dict:
    """Six panels:
      1. X-bar (or I) chart
      2. R (or MR) chart
      3. Last 25 subgroups
      4. Capability histogram with spec lines
      5. Normal probability plot
      6. Capability summary table (numeric)
    """
    x = df[column].dropna().astype(float).to_numpy()
    if x.size < 5:
        raise ValueError("sixpack: need at least 5 observations")
    mean = float(x.mean()); sd = float(x.std(ddof=1))

    fig = plt.figure(figsize=(11, 8.5))
    gs = fig.add_gridspec(3, 2)

    # 1. Top-left: I or X-bar chart
    ax1 = fig.add_subplot(gs[0, 0])
    ucl = mean + 3 * sd; lcl = mean - 3 * sd
    ax1.plot(np.arange(1, x.size + 1), x, marker="o", markersize=3)
    ax1.axhline(mean); ax1.axhline(ucl, linestyle="--"); ax1.axhline(lcl, linestyle="--")
    ax1.set_title("I chart"); ax1.set_xlabel("obs")

    # 2. Top-right: MR chart
    ax2 = fig.add_subplot(gs[0, 1])
    mr = np.abs(np.diff(x))
    mrbar = float(mr.mean())
    ucl_mr = 3.267 * mrbar
    ax2.plot(np.arange(2, x.size + 1), mr, marker="o", markersize=3)
    ax2.axhline(mrbar); ax2.axhline(ucl_mr, linestyle="--")
    ax2.set_title("MR chart")

    # 3. Middle-left: last 25 subgroups
    ax3 = fig.add_subplot(gs[1, 0])
    last = x[-25:]
    ax3.plot(np.arange(1, last.size + 1), last, marker="o", markersize=3)
    ax3.set_title("Last 25 obs")

    # 4. Middle-right: histogram with spec
    ax4 = fig.add_subplot(gs[1, 1])
    from stats._theme import DANGER
    ax4.hist(x, bins="auto")
    if lsl is not None: ax4.axvline(lsl, linestyle="--", color=DANGER)
    if usl is not None: ax4.axvline(usl, linestyle="--", color=DANGER)
    if target is not None: ax4.axvline(target, linestyle=":")
    ax4.set_title("Histogram + spec")

    # 5. Bottom-left: normal probability plot
    ax5 = fig.add_subplot(gs[2, 0])
    sps.probplot(x, dist="norm", plot=ax5)
    ax5.set_title("Normal probability")

    # 6. Bottom-right: capability summary text
    ax6 = fig.add_subplot(gs[2, 1])
    ax6.axis("off")
    cp = cpk = pp = ppk = None
    if lsl is not None and usl is not None and sd > 0:
        cp = (usl - lsl) / (6 * sd)
        cpk = min((usl - mean) / (3 * sd), (mean - lsl) / (3 * sd))
        pp = cp; ppk = cpk
    text = (
        f"n        = {x.size}\n"
        f"mean     = {mean:.4g}\n"
        f"stdev    = {sd:.4g}\n"
        f"LSL      = {lsl}\n"
        f"USL      = {usl}\n"
        f"Cp       = {cp if cp is None else f'{cp:.3f}'}\n"
        f"Cpk      = {cpk if cpk is None else f'{cpk:.3f}'}\n"
        f"Pp       = {pp if pp is None else f'{pp:.3f}'}\n"
        f"Ppk      = {ppk if ppk is None else f'{ppk:.3f}'}\n"
    )
    ax6.text(0.05, 0.95, text, family="monospace", va="top", fontsize=11)
    ax6.set_title("Capability indices", loc="left")

    fig.suptitle(f"Capability Sixpack — {column}")

    return {
        "summary": {
            "method": "capability_sixpack",
            "column": column, "n": int(x.size),
            "mean": mean, "stdev": sd,
            "lsl": lsl, "usl": usl, "target": target,
            "cp": cp, "cpk": cpk, "pp": pp, "ppk": ppk,
        },
        "chart_png": _png(fig),
    }
