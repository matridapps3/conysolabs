"""Standalone graphs menu — boxplot, histogram, scatter, matrix, time-
series, individual-value, run chart, multi-vari. Replaces Minitab's
Graph menu. All return PNG bytes; the analyst can pull any of them
without first running an analysis.
"""
from __future__ import annotations

import io
from itertools import combinations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def boxplot(df: pd.DataFrame, column: str, group_col: str | None = None) -> dict:
    fig, ax = plt.subplots(figsize=(7.0, 4.0))
    if group_col:
        groups = list(df.groupby(group_col)[column])
        ax.boxplot([g[1].dropna().astype(float).to_numpy() for g in groups],
                   labels=[str(g[0]) for g in groups])
        ax.set_xlabel(group_col)
    else:
        ax.boxplot(df[column].dropna().astype(float).to_numpy())
    ax.set_ylabel(column)
    ax.set_title(f"Boxplot — {column}" + (f" by {group_col}" if group_col else ""))
    return {"summary": {"chart": "boxplot", "column": column, "group_col": group_col},
            "chart_png": _png(fig)}


def histogram(df: pd.DataFrame, column: str, bins: int | str = "auto") -> dict:
    x = df[column].dropna().astype(float).to_numpy()
    fig, ax = plt.subplots(figsize=(6.5, 3.8))
    ax.hist(x, bins=bins, edgecolor="none")
    ax.set_xlabel(column); ax.set_ylabel("frequency")
    ax.set_title(f"Histogram — {column}")
    return {"summary": {"chart": "histogram", "column": column, "n": int(x.size),
                        "mean": float(x.mean()), "stdev": float(x.std(ddof=1))},
            "chart_png": _png(fig)}


def scatter(df: pd.DataFrame, x_col: str, y_col: str,
            group_col: str | None = None, fit_line: bool = True) -> dict:
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    sub = df[[x_col, y_col] + ([group_col] if group_col else [])].dropna()
    if group_col:
        for k, g in sub.groupby(group_col):
            ax.scatter(g[x_col], g[y_col], label=str(k), alpha=0.7)
        ax.legend()
    else:
        ax.scatter(sub[x_col], sub[y_col], alpha=0.7)
    if fit_line and len(sub) >= 2:
        x = sub[x_col].astype(float).to_numpy()
        y = sub[y_col].astype(float).to_numpy()
        if x.std() > 0:
            slope, intercept = np.polyfit(x, y, 1)
            xs = np.linspace(x.min(), x.max(), 50)
            ax.plot(xs, slope * xs + intercept, linestyle="--")
    ax.set_xlabel(x_col); ax.set_ylabel(y_col)
    ax.set_title(f"Scatter — {y_col} vs {x_col}")
    return {"summary": {"chart": "scatter", "x_col": x_col, "y_col": y_col, "n": int(len(sub))},
            "chart_png": _png(fig)}


def matrix_plot(df: pd.DataFrame, columns: list[str]) -> dict:
    """Pairwise scatter matrix — every column vs every other."""
    sub = df[columns].dropna().astype(float)
    k = len(columns)
    fig, axes = plt.subplots(k, k, figsize=(2.4 * k, 2.4 * k))
    for i in range(k):
        for j in range(k):
            ax = axes[i, j] if k > 1 else axes
            if i == j:
                ax.hist(sub.iloc[:, i].to_numpy(), bins="auto", edgecolor="none")
            else:
                ax.scatter(sub.iloc[:, j], sub.iloc[:, i], s=8, alpha=0.6)
            if i == k - 1:
                ax.set_xlabel(columns[j], fontsize=8)
            if j == 0:
                ax.set_ylabel(columns[i], fontsize=8)
            ax.tick_params(labelsize=7)
    fig.suptitle("Matrix Plot")
    return {"summary": {"chart": "matrix_plot", "columns": columns, "n": int(len(sub))},
            "chart_png": _png(fig)}


def time_series_plot(df: pd.DataFrame, value_col: str,
                     time_col: str | None = None) -> dict:
    fig, ax = plt.subplots(figsize=(8.0, 3.5))
    if time_col and time_col in df.columns:
        sub = df[[time_col, value_col]].dropna().copy()
        sub[time_col] = pd.to_datetime(sub[time_col], errors="coerce")
        sub = sub.dropna(subset=[time_col]).sort_values(time_col)
        ax.plot(sub[time_col], sub[value_col].astype(float), marker="o", markersize=3)
        ax.set_xlabel(time_col)
    else:
        x = df[value_col].dropna().astype(float).to_numpy()
        ax.plot(np.arange(1, x.size + 1), x, marker="o", markersize=3)
        ax.set_xlabel("Index")
    ax.set_ylabel(value_col)
    ax.set_title(f"Time Series — {value_col}")
    return {"summary": {"chart": "time_series", "value_col": value_col, "time_col": time_col},
            "chart_png": _png(fig)}


def individual_value_plot(df: pd.DataFrame, column: str,
                          group_col: str | None = None) -> dict:
    """Like a boxplot but shows every observation. Better for small n."""
    fig, ax = plt.subplots(figsize=(7.0, 4.0))
    if group_col:
        groups = list(df.groupby(group_col)[column])
        for i, (k, g) in enumerate(groups):
            v = g.dropna().astype(float).to_numpy()
            jitter = (np.random.default_rng(i).normal(0, 0.04, v.size))
            ax.scatter(np.full(v.size, i) + jitter, v, alpha=0.7, label=str(k))
        ax.set_xticks(range(len(groups)))
        ax.set_xticklabels([str(g[0]) for g in groups])
        ax.set_xlabel(group_col)
    else:
        v = df[column].dropna().astype(float).to_numpy()
        jitter = np.random.default_rng(0).normal(0, 0.04, v.size)
        ax.scatter(jitter, v, alpha=0.7)
        ax.set_xticks([0]); ax.set_xticklabels([column])
    ax.set_ylabel(column)
    ax.set_title(f"Individual Value Plot — {column}" + (f" by {group_col}" if group_col else ""))
    return {"summary": {"chart": "individual_value_plot", "column": column, "group_col": group_col},
            "chart_png": _png(fig)}


def run_chart(df: pd.DataFrame, value_col: str,
              time_col: str | None = None) -> dict:
    """Run chart — points connected over time, with the median as a center
    line. Counts runs about the median (Minitab's tests for clustering,
    mixtures, trends, and oscillations)."""
    if time_col and time_col in df.columns:
        sub = df[[time_col, value_col]].dropna().copy()
        sub[time_col] = pd.to_datetime(sub[time_col], errors="coerce")
        sub = sub.dropna(subset=[time_col]).sort_values(time_col)
        x = np.arange(len(sub))
        y = sub[value_col].astype(float).to_numpy()
    else:
        y = df[value_col].dropna().astype(float).to_numpy()
        x = np.arange(y.size)
    median = float(np.median(y))
    above = y > median
    # Count runs about the median.
    runs = 1
    for i in range(1, len(above)):
        if above[i] != above[i - 1]:
            runs += 1
    # Approximate p-value for randomness via the Wald-Wolfowitz runs test.
    n1 = int(above.sum()); n2 = len(above) - n1
    if n1 > 0 and n2 > 0:
        mu_runs = 2 * n1 * n2 / (n1 + n2) + 1
        var_runs = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / ((n1 + n2) ** 2 * (n1 + n2 - 1))
        z = (runs - mu_runs) / np.sqrt(var_runs) if var_runs > 0 else 0.0
        from scipy import stats as sps
        p_clustering_or_mixtures = float(2 * (1 - sps.norm.cdf(abs(z))))
    else:
        p_clustering_or_mixtures = float("nan")
    fig, ax = plt.subplots(figsize=(8.0, 3.5))
    ax.plot(x, y, marker="o", markersize=3)
    ax.axhline(median, linestyle="-")
    ax.set_xlabel(time_col or "Index")
    ax.set_ylabel(value_col)
    ax.set_title(f"Run Chart — {value_col}")
    return {"summary": {
        "chart": "run_chart", "n": int(len(y)), "median": median,
        "n_runs": int(runs), "n_above": n1, "n_below": n2,
        "p_clustering_or_mixtures": p_clustering_or_mixtures,
    }, "chart_png": _png(fig)}


def multi_vari(df: pd.DataFrame, value_col: str, factor_cols: list[str]) -> dict:
    """Multi-vari chart — visualizes how variation breaks down across
    factors. Uses up to three factors; first is the x axis, second
    groups within, third produces a panel grid (we render the first
    two only — a single panel covers most cases)."""
    if len(factor_cols) < 1:
        raise ValueError("multi_vari needs at least one factor")
    sub = df[[value_col] + factor_cols].dropna()
    fig, ax = plt.subplots(figsize=(8.0, 4.0))
    f1 = factor_cols[0]
    if len(factor_cols) >= 2:
        f2 = factor_cols[1]
        f1_levels = sorted(sub[f1].unique().tolist(), key=str)
        f2_levels = sorted(sub[f2].unique().tolist(), key=str)
        for j, l2 in enumerate(f2_levels):
            xs = []
            ys = []
            for l1 in f1_levels:
                v = sub[(sub[f1] == l1) & (sub[f2] == l2)][value_col].astype(float)
                xs.append(l1)
                ys.append(float(v.mean()) if len(v) else float("nan"))
            ax.plot(range(len(f1_levels)), ys, marker="o", label=f"{f2}={l2}")
        ax.set_xticks(range(len(f1_levels)))
        ax.set_xticklabels([str(x) for x in f1_levels])
        ax.legend(loc="best")
    else:
        levels = sorted(sub[f1].unique().tolist(), key=str)
        means = [float(sub[sub[f1] == l][value_col].astype(float).mean()) for l in levels]
        ax.plot(range(len(levels)), means, marker="o")
        ax.set_xticks(range(len(levels)))
        ax.set_xticklabels([str(x) for x in levels])
    ax.set_xlabel(f1)
    ax.set_ylabel(f"Mean of {value_col}")
    ax.set_title("Multi-Vari Chart")
    return {"summary": {"chart": "multi_vari", "value_col": value_col,
                        "factor_cols": factor_cols, "n": int(len(sub))},
            "chart_png": _png(fig)}


def interaction_plot(df: pd.DataFrame, response: str,
                     factor_a: str, factor_b: str) -> dict:
    """Two-factor interaction plot — line plot of cell means with factor_a
    on the x-axis and one line per level of factor_b.

    Parallel lines → no interaction (effects are additive).
    Crossing or diverging lines → interaction is present; the effect of A
    depends on the level of B.

    This is the diagnostic that goes hand-in-hand with two-way ANOVA. Minitab
    autorenders it on every two-way; Bench now does too.
    """
    sub = df[[response, factor_a, factor_b]].dropna()
    if sub.empty:
        raise ValueError("interaction_plot: no complete cases")
    cells = (sub.groupby([factor_a, factor_b])[response]
                .agg(["mean", "std", "count"])
                .reset_index())
    fig, ax = plt.subplots(figsize=(7, 4.2))
    levels_b = cells[factor_b].unique()
    for lvl in levels_b:
        d = cells[cells[factor_b] == lvl].sort_values(factor_a)
        ax.plot(d[factor_a].astype(str), d["mean"], marker="o", label=f"{factor_b}={lvl}")
        # Error bars at ±1 SE (std / sqrt(count)) — only when n > 1.
        se = d["std"] / d["count"].clip(lower=1).pow(0.5)
        ax.fill_between(d[factor_a].astype(str), d["mean"] - se, d["mean"] + se, alpha=0.10)
    ax.set_xlabel(factor_a)
    ax.set_ylabel(f"Mean of {response}")
    ax.set_title(f"Interaction plot — {factor_a} × {factor_b}")
    ax.legend(loc="best", frameon=False)

    # Crude interaction-strength heuristic: max range / mean range of profile
    # differences. If lines were parallel this would be ~1; >2 is a strong
    # interaction signal.
    pivot = cells.pivot(index=factor_a, columns=factor_b, values="mean")
    if pivot.shape[1] >= 2:
        # For each pair of levels of b, compute the across-a-range of their
        # mean-difference. Higher variability across a → more interaction.
        diffs = (pivot.iloc[:, 1:].subtract(pivot.iloc[:, 0], axis=0))
        rng = float(diffs.max().max() - diffs.min().min())
        avg = float(np.abs(diffs.values).mean())
        interaction_index = (rng / avg) if avg > 0 else None
    else:
        interaction_index = None

    return {"summary": {
        "method": "interaction_plot",
        "factor_a": factor_a,
        "factor_b": factor_b,
        "response": response,
        "n": int(len(sub)),
        "levels_a": cells[factor_a].astype(str).unique().tolist(),
        "levels_b": cells[factor_b].astype(str).unique().tolist(),
        "cell_means": [{factor_a: str(r[factor_a]), factor_b: str(r[factor_b]),
                        "mean": float(r["mean"]), "n": int(r["count"])}
                       for _, r in cells.iterrows()],
        "interaction_index": (float(interaction_index)
                              if interaction_index is not None else None),
    }, "chart_png": _png(fig)}


def variability_gauge(df: pd.DataFrame, measurement_col: str,
                      part_col: str, operator_col: str | None = None) -> dict:
    """Variability gauge chart — the BB's MSA visual.

    Plots each individual measurement grouped by Part on the x-axis, with
    Operators as connecting lines / colors. Tight clusters within Part →
    repeatable measurements. Big spread between Operators on the same Part
    → reproducibility issue. The picture that tells the GR&R story before
    the GR&R numbers do.
    """
    sub = df[[measurement_col, part_col] + ([operator_col] if operator_col else [])].dropna()
    if sub.empty:
        raise ValueError("variability_gauge: no complete cases")
    parts = sorted(sub[part_col].astype(str).unique())
    part_idx = {p: i for i, p in enumerate(parts)}

    fig, ax = plt.subplots(figsize=(9, 4.6))

    if operator_col:
        operators = sorted(sub[operator_col].astype(str).unique())
        cmap = plt.get_cmap("tab10")
        for j, op in enumerate(operators):
            ops_sub = sub[sub[operator_col].astype(str) == op]
            means_per_part = []
            for p in parts:
                vals = ops_sub.loc[ops_sub[part_col].astype(str) == p, measurement_col].astype(float)
                if vals.empty:
                    means_per_part.append(None); continue
                # Scatter individual measurements with small horizontal jitter.
                x_jitter = part_idx[p] + (j - len(operators) / 2) * 0.06
                ax.scatter([x_jitter] * len(vals), vals.values,
                           color=cmap(j % 10), alpha=0.7, s=22,
                           label=f"{op}" if p == parts[0] else None)
                means_per_part.append((x_jitter, float(vals.mean())))
            # Connect operator means across parts to show reproducibility drift.
            pts = [m for m in means_per_part if m is not None]
            if len(pts) >= 2:
                xs, ys = zip(*pts)
                ax.plot(xs, ys, color=cmap(j % 10), linewidth=1, alpha=0.55)
        ax.legend(title=operator_col, loc="best", frameon=False, fontsize=8)
    else:
        for p in parts:
            vals = sub.loc[sub[part_col].astype(str) == p, measurement_col].astype(float)
            ax.scatter([part_idx[p]] * len(vals), vals.values, alpha=0.7, s=22)

    # Overall part means as a heavy line — the "true value" benchmark.
    part_means = [float(sub.loc[sub[part_col].astype(str) == p, measurement_col].astype(float).mean())
                  for p in parts]
    ax.plot(range(len(parts)), part_means, color="black", linewidth=1.5,
            marker="s", markersize=4, label="Part mean")
    ax.set_xticks(range(len(parts)))
    ax.set_xticklabels(parts, rotation=30, ha="right")
    ax.set_xlabel(part_col)
    ax.set_ylabel(measurement_col)
    ax.set_title(f"Variability gauge chart — {measurement_col} by {part_col}"
                 + (f" × {operator_col}" if operator_col else ""))
    fig.tight_layout()

    # Summary: within-part range and between-part range for a one-glance read.
    part_ranges = []
    for p in parts:
        vals = sub.loc[sub[part_col].astype(str) == p, measurement_col].astype(float).values
        part_ranges.append({
            "part": p, "n": int(len(vals)),
            "mean": float(np.mean(vals)) if len(vals) else None,
            "range": float(np.ptp(vals)) if len(vals) > 1 else 0.0,
        })

    return {"summary": {
        "method": "variability_gauge",
        "n_parts": len(parts),
        "n_operators": int(sub[operator_col].nunique()) if operator_col else None,
        "n_measurements": int(len(sub)),
        "part_summary": part_ranges,
        "mean_within_part_range": float(np.mean([r["range"] for r in part_ranges]))
                                   if part_ranges else None,
        "between_part_range": (float(max(part_means) - min(part_means))
                               if part_means else None),
    }, "chart_png": _png(fig)}
