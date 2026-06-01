"""Standalone correlation matrix with p-values.

`Stat → Basic Statistics → Correlation` is one of the most-used Minitab
menus — Black Belts run it before every multi-X regression to spot collinear
predictors. PCA buries this; pure pandas .corr() omits p-values. Bench
ships a first-class endpoint so it's one click away.

Methods:
    pearson  — linear association, normality-flavoured
    spearman — rank, robust to outliers + monotone non-linearity
    kendall  — concordance, robust to ties

Returns:
    columns      — column names in order
    r            — N×N correlation matrix
    p            — N×N p-value matrix (two-sided)
    n            — N×N count of complete-pair observations
    significant  — pairs with |r| > threshold AND p < alpha, sorted by |r|
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps


def _pairwise_corr(a: np.ndarray, b: np.ndarray, method: str) -> tuple[float, float, int]:
    """One pair, one corr, one p. Handles NaN pairwise so columns with
    different missing patterns still contribute fully where they overlap."""
    m = np.isfinite(a) & np.isfinite(b)
    a, b = a[m], b[m]
    n = len(a)
    if n < 3:
        return (float("nan"), float("nan"), n)
    if a.std() == 0 or b.std() == 0:
        return (float("nan"), float("nan"), n)
    if method == "pearson":
        r, p = sps.pearsonr(a, b)
    elif method == "spearman":
        r, p = sps.spearmanr(a, b)
    elif method == "kendall":
        r, p = sps.kendalltau(a, b)
    else:
        raise ValueError(f"unknown method: {method}")
    return (float(r), float(p), n)


def compute(df: pd.DataFrame, *, columns: list[str] | None = None,
            method: str = "pearson",
            alpha: float = 0.05,
            min_r: float = 0.3) -> dict:
    """Compute the correlation matrix + significance table.

    columns: subset of df to correlate. Defaults to all numeric columns.
    min_r:   pairs with |r| ≥ min_r AND p < alpha go into `significant`.
    """
    if columns:
        cols = [c for c in columns if c in df.columns]
    else:
        cols = df.select_dtypes(include="number").columns.tolist()
    if len(cols) < 2:
        raise ValueError("correlation needs ≥ 2 numeric columns")

    sub = df[cols].apply(pd.to_numeric, errors="coerce")
    k = len(cols)
    r = np.eye(k)
    p = np.zeros((k, k))
    n = np.zeros((k, k), dtype=int)

    for i in range(k):
        for j in range(i, k):
            if i == j:
                # Self-correlation: 1.0, p = 0, n = available.
                arr = sub.iloc[:, i].to_numpy(dtype=float)
                n[i, j] = int(np.isfinite(arr).sum())
                continue
            r_ij, p_ij, n_ij = _pairwise_corr(
                sub.iloc[:, i].to_numpy(dtype=float),
                sub.iloc[:, j].to_numpy(dtype=float),
                method)
            r[i, j] = r[j, i] = r_ij
            p[i, j] = p[j, i] = p_ij
            n[i, j] = n[j, i] = n_ij

    # Significant pairs — the table a BB actually reads.
    sig = []
    for i in range(k):
        for j in range(i + 1, k):
            r_ij, p_ij = r[i, j], p[i, j]
            if np.isfinite(r_ij) and np.isfinite(p_ij) \
               and abs(r_ij) >= min_r and p_ij < alpha:
                sig.append({"x": cols[i], "y": cols[j],
                            "r": float(r_ij), "p": float(p_ij),
                            "n": int(n[i, j]),
                            "abs_r": float(abs(r_ij))})
    sig.sort(key=lambda d: -d["abs_r"])

    # Multicollinearity flags (|r| > 0.8 — Belsley rule of thumb).
    multicol = [s for s in sig if s["abs_r"] > 0.8]

    return {"summary": {
        "method": method,
        "columns": cols,
        "alpha": alpha,
        "min_r": min_r,
        "n_pairs": len(sig),
        "r": [[None if not np.isfinite(v) else float(v) for v in row] for row in r],
        "p": [[None if not np.isfinite(v) else float(v) for v in row] for row in p],
        "n": [[int(v) for v in row] for row in n],
        "significant": sig,
        "multicollinearity": multicol,
    }}
