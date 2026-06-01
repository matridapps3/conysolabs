"""Transactional / Agile flow analytics — the services-and-software side of
Lean Six Sigma that classical (manufacturing-centric) tools barely touch.

All deterministic, no AI:
  * cycle_time    — lead/cycle-time distribution + percentile Service Level
                    Expectations (the 85th-percentile "we finish within N days").
  * delivery_forecast — Monte-Carlo "when will it be done?": resample historical
                    throughput to forecast periods-to-finish a backlog, and how
                    many items land within a horizon. (Vacanti / Magennis method.)
  * littles_law   — WIP = throughput × cycle time, with the missing term solved.
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


def cycle_time(df: pd.DataFrame, time_col: str | None = None,
               start_col: str | None = None, end_col: str | None = None) -> dict:
    """Cycle/lead-time distribution. Either a numeric duration column
    (`time_col`) or `start_col`+`end_col` timestamps (cycle in days)."""
    if start_col and end_col:
        s = pd.to_datetime(df[start_col], errors="coerce")
        e = pd.to_datetime(df[end_col], errors="coerce")
        ct = (e - s).dt.total_seconds() / 86400.0
        unit = "days"
    elif time_col:
        ct = pd.to_numeric(df[time_col], errors="coerce")
        unit = "units"
    else:
        raise ValueError("provide time_col, or start_col + end_col")
    ct = ct.dropna()
    ct = ct[ct >= 0]
    if len(ct) < 3:
        raise ValueError("need at least 3 completed items")
    arr = ct.to_numpy(dtype=float)
    pcts = {p: float(np.percentile(arr, p)) for p in (50, 70, 85, 95)}

    fig, ax = plt.subplots(figsize=(7.5, 4))
    ax.hist(arr, bins=min(40, max(8, len(arr) // 5)), color="#3a7ca5", alpha=0.85)
    for p, c in [(50, "#5a8f69"), (85, "#c9a24b"), (95, "#c0504d")]:
        ax.axvline(pcts[p], ls="--", color=c, label=f"{p}th = {pcts[p]:.1f}")
    ax.set_xlabel(f"cycle time ({unit})"); ax.set_ylabel("items"); ax.legend(fontsize=8)
    ax.set_title("Cycle-time distribution")

    return {"summary": {
        "method": "cycle_time", "unit": unit, "n": int(len(arr)),
        "mean": float(arr.mean()), "median": pcts[50],
        "percentiles": pcts,
        "sle_85": pcts[85],
        "headline": f"85% of items finish within {pcts[85]:.1f} {unit} (median {pcts[50]:.1f}).",
        "note": "Forecast with percentiles, not averages: the 85th-percentile Service Level Expectation is the number to promise a customer.",
    }, "chart_png": _png(fig)}


def delivery_forecast(throughput: list, backlog: int, horizon: int | None = None,
                      n_sims: int = 10000, seed: int = 20260531) -> dict:
    """Monte-Carlo forecast from historical throughput (items completed per
    period). Resamples observed periods to answer:
      * periods-to-complete `backlog` items (percentile dates), and
      * items completed within `horizon` periods (if given).
    Distribution-driven — no average-velocity fiction."""
    tp = np.asarray([float(x) for x in throughput if x is not None], dtype=float)
    tp = tp[tp >= 0]
    if len(tp) < 3:
        raise ValueError("need at least 3 periods of throughput history")
    if backlog is not None and backlog <= 0:
        raise ValueError("backlog must be positive")
    rng = np.random.RandomState(seed)
    n_sims = int(max(1000, min(n_sims, 200000)))

    periods_needed = None
    if backlog:
        periods = np.empty(n_sims)
        for i in range(n_sims):
            done = 0.0; k = 0
            # Cap iterations so a near-zero-throughput history can't loop forever.
            while done < backlog and k < 100000:
                done += tp[rng.randint(len(tp))]; k += 1
            periods[i] = k
        periods_needed = {p: float(np.percentile(periods, p)) for p in (50, 70, 85, 95)}

    items_in_horizon = None
    if horizon:
        sims = np.array([tp[rng.randint(len(tp), size=int(horizon))].sum() for _ in range(n_sims)])
        items_in_horizon = {p: float(np.percentile(sims, p)) for p in (5, 15, 50, 85, 95)}

    # Chart: histogram of periods-to-complete (if backlog) else items-in-horizon.
    fig, ax = plt.subplots(figsize=(7.5, 4))
    if periods_needed is not None:
        ax.hist(periods, bins=min(40, int(periods.max() - periods.min()) + 1 or 8), color="#c9a24b", alpha=0.85)
        for p, c in [(50, "#5a8f69"), (85, "#c9a24b"), (95, "#c0504d")]:
            ax.axvline(periods_needed[p], ls="--", color=c, label=f"{p}th = {periods_needed[p]:.0f}")
        ax.set_xlabel("periods to complete backlog"); ax.set_title(f"When will {backlog} items be done?")
    else:
        ax.hist(sims, bins=30, color="#3a7ca5", alpha=0.85)
        ax.set_xlabel(f"items completed in {horizon} periods"); ax.set_title("How much will we finish?")
    ax.set_ylabel("simulations"); ax.legend(fontsize=8)

    return {"summary": {
        "method": "delivery_forecast", "n_periods_history": int(len(tp)),
        "mean_throughput": float(tp.mean()),
        "backlog": backlog,
        "periods_to_complete": periods_needed,
        "horizon": horizon, "items_in_horizon": items_in_horizon,
        "headline": (f"85% confident the {backlog} items finish within {periods_needed[85]:.0f} periods "
                     f"(50/50 at {periods_needed[50]:.0f})." if periods_needed else
                     f"85% confident of completing at least {items_in_horizon[15]:.0f} items in {horizon} periods."),
        "note": "Monte-Carlo forecast by resampling your real throughput history — captures variability a single 'velocity' average hides. Commit to the 85th percentile, not the mean.",
    }, "chart_png": _png(fig)}


def littles_law(wip: float | None = None, throughput: float | None = None,
                cycle_time: float | None = None) -> dict:
    """Little's Law: WIP = throughput × cycle time. Provide any two; solves the
    third. The fundamental flow equation."""
    known = [x is not None for x in (wip, throughput, cycle_time)]
    if sum(known) != 2:
        raise ValueError("provide exactly two of: wip, throughput, cycle_time")
    solved_for = None
    if wip is None:
        wip = throughput * cycle_time; solved_for = "wip"
    elif throughput is None:
        if cycle_time == 0:
            raise ValueError("cycle_time must be > 0")
        throughput = wip / cycle_time; solved_for = "throughput"
    else:
        if throughput == 0:
            raise ValueError("throughput must be > 0")
        cycle_time = wip / throughput; solved_for = "cycle_time"
    return {"summary": {
        "method": "littles_law",
        "wip": float(wip), "throughput": float(throughput), "cycle_time": float(cycle_time),
        "solved_for": solved_for,
        "headline": f"WIP {wip:.2f} = throughput {throughput:.2f} × cycle time {cycle_time:.2f}.",
        "note": "Cut WIP or raise throughput to shorten cycle time — the lever Agile teams forget.",
    }}
