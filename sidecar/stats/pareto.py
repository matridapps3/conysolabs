"""Pareto analysis — vital few vs trivial many.

Given a categorical column (defect cause, downtime category, complaint type),
returns sorted counts/sums, cumulative percentage, and the breakpoint where
cumulative reaches the threshold (80% by default — the classic Pareto cut).

Renders a Pareto chart: bars for each category plus a cumulative-percentage
line on a secondary axis.

Also exposes `cost_weighted` — two Paretos side-by-side (by frequency and by
total cost) to surface the "fix the wrong problem" trap where the most
frequent defect is NOT the most expensive.
"""

import io
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def compute(
    df: pd.DataFrame,
    *,
    category_col: str,
    value_col: Optional[str] = None,
    threshold_pct: float = 80.0,
):
    if category_col not in df.columns:
        raise ValueError(f"category_col '{category_col}' not in dataframe")
    if value_col and value_col not in df.columns:
        raise ValueError(f"value_col '{value_col}' not in dataframe")

    if value_col:
        agg = df.groupby(category_col, dropna=True)[value_col].sum()
    else:
        agg = df[category_col].value_counts(dropna=True)
    agg = agg.sort_values(ascending=False)

    total = float(agg.sum())
    if total <= 0:
        raise ValueError("no data to summarize (all zeros or empty)")

    cum_pct = (agg.cumsum() / total) * 100.0
    # Vital few = smallest prefix of categories whose cumulative share first
    # reaches threshold_pct. Include the category that pushes us over the line.
    vital_few = []
    for k in cum_pct.index:
        vital_few.append(k)
        if cum_pct[k] >= threshold_pct:
            break

    from stats._theme import CHART_FILL, DANGER, MUTED
    fig, ax1 = plt.subplots(figsize=(10, 5))
    ax1.bar(range(len(agg)), agg.values, color=CHART_FILL)
    ax1.set_xticks(range(len(agg)))
    ax1.set_xticklabels([str(x) for x in agg.index], rotation=35, ha="right")
    ax1.set_ylabel(value_col or "count")
    ax1.set_xlabel(category_col)

    ax2 = ax1.twinx()
    ax2.plot(range(len(agg)), cum_pct.values, color=DANGER, marker="o")
    ax2.axhline(threshold_pct, linestyle="--", color=MUTED)
    ax2.set_ylabel(f"cumulative %")
    ax2.set_ylim(0, 105)

    ax1.set_title(f"Pareto — {category_col}" + (f" by Σ{value_col}" if value_col else ""))
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)

    return {
        "summary": {
            "total": total,
            "n_categories": int(len(agg)),
            "vital_few": vital_few,
            "vital_few_share_pct": float(cum_pct[vital_few].iloc[-1]) if vital_few else 0.0,
            "threshold_pct": threshold_pct,
        },
        "rows": [
            {"category": str(k), "value": float(v),
             "share_pct": float(v / total * 100), "cum_pct": float(cum_pct[k])}
            for k, v in agg.items()
        ],
        "chart_png": buf.getvalue(),
    }


def cost_weighted(df: pd.DataFrame, *,
                  category_col: str,
                  cost_col: str,
                  count_col: Optional[str] = None) -> dict:
    """Two Paretos: by FREQUENCY (count of rows per category, or sum of
    count_col if supplied) and by COST (sum of cost_col per category).

    The product insight: the category at the top by frequency is rarely the
    same one at the top by total cost. Chasing the frequency leader leaves
    the cost driver untouched — a Pareto trap that real BBs walk into
    constantly when the cost column isn't on the chart.
    """
    if category_col not in df.columns:
        raise ValueError(f"category_col '{category_col}' not in dataframe")
    if cost_col not in df.columns:
        raise ValueError(f"cost_col '{cost_col}' not in dataframe")
    sub = df[[category_col, cost_col] + ([count_col] if count_col else [])].dropna()
    if count_col:
        freq = sub.groupby(category_col)[count_col].sum()
    else:
        freq = sub.groupby(category_col).size()
    cost = sub.groupby(category_col)[cost_col].sum()

    by_freq = freq.sort_values(ascending=False)
    by_cost = cost.sort_values(ascending=False)

    def _table(s: pd.Series) -> tuple[list, list]:
        total = float(s.sum()) or 1.0
        cum = (s.cumsum() / total) * 100
        rows = [{"category": str(k), "value": float(v),
                 "share_pct": float(v / total * 100), "cum_pct": float(cum[k])}
                for k, v in s.items()]
        return rows, total

    rows_freq, total_freq = _table(by_freq)
    rows_cost, total_cost = _table(by_cost)

    # Chart: two side-by-side Paretos.
    from stats._theme import CHART_FILL, DANGER, MUTED
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6))
    for ax, s, label, color in [(axes[0], by_freq, "by FREQUENCY", CHART_FILL),
                                (axes[1], by_cost, "by COST",      DANGER)]:
        total = float(s.sum()) or 1.0
        cum = (s.cumsum() / total) * 100
        ax.bar(range(len(s)), s.values, color=color)
        ax.set_xticks(range(len(s)))
        ax.set_xticklabels([str(x) for x in s.index], rotation=35, ha="right")
        ax2 = ax.twinx()
        ax2.plot(range(len(s)), cum.values, color=DANGER, marker="o")
        ax2.axhline(80, linestyle="--", color=MUTED, alpha=0.5)
        ax2.set_ylim(0, 105)
        ax.set_title(label)
    fig.suptitle(f"Cost-weighted Pareto on {category_col} (cost = Σ{cost_col})")
    fig.tight_layout()
    buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=120); plt.close(fig)

    top_freq = rows_freq[0]["category"] if rows_freq else None
    top_cost = rows_cost[0]["category"] if rows_cost else None

    return {"summary": {
        "method": "cost_weighted_pareto",
        "category_col": category_col,
        "cost_col": cost_col,
        "top_by_frequency": top_freq,
        "top_by_cost": top_cost,
        "ranking_disagrees": (top_freq != top_cost) if (top_freq and top_cost) else False,
        "total_count": float(total_freq),
        "total_cost": float(total_cost),
        "by_frequency": rows_freq,
        "by_cost": rows_cost,
    }, "chart_png": buf.getvalue()}
