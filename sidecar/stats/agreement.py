"""Attribute Agreement Analysis — the attribute-data side of MSA.

When inspectors classify parts as Pass/Fail (or A/B/C, or Good/Bad/Marginal),
GR&R doesn't apply — there's no continuous measurement. Instead you ask:

  - How often does each appraiser agree with themselves on repeats?
  - How often do appraisers agree with each other?
  - How often does anyone agree with the known standard?

Bench computes Cohen's kappa (two appraisers), Fleiss' kappa (≥3 appraisers),
weighted kappa for ordinal categories, and percent-agreement breakdowns. This
is "Stat → Quality Tools → Attribute Agreement Analysis" in Minitab.

Input shape (long format, one row per trial):
    appraiser_col   : who classified (string)
    part_col        : what was classified (id)
    rating_col      : their classification (string)
    standard_col    : the "true" answer (optional — enables agreement-vs-standard)
    trial_col       : trial number 1, 2, … (optional — enables within-appraiser)
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps


def _cohen_kappa(a: list, b: list, weights: str | None = None) -> dict:
    """Cohen's kappa between two raters' classifications on the same items.

    weights:
        None        — unweighted (every disagreement counts equally)
        'linear'    — disagreement penalty proportional to category distance
        'quadratic' — squared distance (the SPSS default; harsher on big gaps)
    """
    a = np.asarray(a)
    b = np.asarray(b)
    cats = sorted(set(a.tolist()) | set(b.tolist()))
    k = len(cats)
    idx = {c: i for i, c in enumerate(cats)}
    M = np.zeros((k, k))
    for x, y in zip(a, b):
        M[idx[x], idx[y]] += 1
    n = M.sum()
    if n == 0:
        return {"kappa": None, "p_observed": None, "p_expected": None, "n": 0}
    po = np.trace(M) / n
    row_sums = M.sum(axis=1)
    col_sums = M.sum(axis=0)
    if weights is None:
        pe = float((row_sums * col_sums).sum() / (n * n))
        kappa = (po - pe) / (1 - pe) if pe < 1 else 1.0
    else:
        # Weighted version — Fleiss-Cohen formula.
        W = np.zeros((k, k))
        for i in range(k):
            for j in range(k):
                d = abs(i - j) if weights == "linear" else (i - j) ** 2
                W[i, j] = 1 - d / ((k - 1) if weights == "linear" else (k - 1) ** 2)
        po = float((W * M).sum() / n)
        outer = np.outer(row_sums, col_sums) / n
        pe = float((W * outer).sum() / n)
        kappa = (po - pe) / (1 - pe) if pe < 1 else 1.0
    return {"kappa": float(kappa), "p_observed": float(po), "p_expected": float(pe),
            "n": int(n), "categories": [str(c) for c in cats]}


def _fleiss_kappa(table: np.ndarray) -> dict:
    """Fleiss' kappa for ≥ 3 raters. `table[i, j]` = number of raters who
    classified item i into category j. Each row should sum to the same n
    (raters per item)."""
    table = np.asarray(table, dtype=float)
    if table.size == 0:
        return {"kappa": None, "n_items": 0, "n_raters": 0}
    N, k = table.shape
    n = table[0].sum()
    if not np.allclose(table.sum(axis=1), n):
        # Unbalanced raters per item — drop to the minimum.
        return {"kappa": None, "n_items": N, "error": "unbalanced_raters"}
    P_i = ((table ** 2).sum(axis=1) - n) / (n * (n - 1)) if n > 1 else np.zeros(N)
    P_bar = float(P_i.mean())
    p_j = table.sum(axis=0) / (N * n)
    P_e = float((p_j ** 2).sum())
    kappa = (P_bar - P_e) / (1 - P_e) if P_e < 1 else 1.0
    return {"kappa": float(kappa), "P_observed": P_bar, "P_expected": P_e,
            "n_items": int(N), "n_raters": int(n), "categories": int(k)}


def _interpret_kappa(k: float) -> str:
    """Landis & Koch (1977) — the field standard for kappa."""
    if k is None:
        return "no estimate"
    if k < 0:        return "worse than chance"
    if k < 0.2:      return "slight"
    if k < 0.4:      return "fair"
    if k < 0.6:      return "moderate"
    if k < 0.8:      return "substantial"
    return "almost perfect"


def compute(df: pd.DataFrame, *, appraiser_col: str, part_col: str,
            rating_col: str, standard_col: str | None = None,
            trial_col: str | None = None,
            ordinal: bool = False) -> dict:
    """Run the full Attribute Agreement Analysis.

    Returns four sections, each gated on whether the input supports it:
      - within_appraiser  (needs trial_col with repeats)
      - between_appraisers (needs ≥ 2 appraisers)
      - vs_standard        (needs standard_col)
      - kappa              (between-appraiser kappa: Cohen if 2, Fleiss if ≥ 3)
    """
    df = df[[appraiser_col, part_col, rating_col]
            + ([standard_col] if standard_col else [])
            + ([trial_col] if trial_col else [])].dropna(subset=[appraiser_col, part_col, rating_col])
    weights = "quadratic" if ordinal else None
    summary: dict = {"n_total": int(len(df)),
                     "appraisers": sorted(df[appraiser_col].astype(str).unique().tolist()),
                     "parts": int(df[part_col].nunique()),
                     "ordinal": ordinal}

    # ── Within-appraiser repeatability ──
    if trial_col and df[trial_col].notna().any():
        within = {}
        for app, g in df.groupby(appraiser_col):
            # For each part, do all this appraiser's trials agree?
            ok = 0; tot = 0
            for _, parts in g.groupby(part_col):
                ratings = parts[rating_col].tolist()
                if len(ratings) >= 2:
                    tot += 1
                    if len(set(ratings)) == 1:
                        ok += 1
            within[str(app)] = {"matched": ok, "total": tot,
                                "pct": (ok / tot * 100) if tot else None}
        summary["within_appraiser"] = within

    # ── Between-appraiser agreement (pairwise + kappa) ──
    appraisers = sorted(df[appraiser_col].astype(str).unique())
    if len(appraisers) >= 2:
        # Each part: did every appraiser give the same rating across all trials?
        # We use the modal rating per (appraiser, part) when there are trials.
        modes = (df.assign(_r=df[rating_col].astype(str))
                   .groupby([appraiser_col, part_col])["_r"]
                   .agg(lambda s: s.mode().iat[0])
                   .unstack(appraiser_col))
        complete = modes.dropna()
        matched = int((complete.nunique(axis=1) == 1).sum())
        summary["between_appraisers"] = {
            "matched": matched, "total": int(len(complete)),
            "pct": (matched / len(complete) * 100) if len(complete) else None,
        }

        # Kappa: Cohen if 2 raters, Fleiss if 3+.
        if len(appraisers) == 2 and len(complete):
            k = _cohen_kappa(complete.iloc[:, 0].tolist(),
                             complete.iloc[:, 1].tolist(), weights=weights)
            summary["kappa"] = {"kind": "cohen", **k, "interpretation": _interpret_kappa(k["kappa"])}
        elif len(appraisers) >= 3 and len(complete):
            cats = sorted(set(complete.values.ravel().tolist()))
            cat_idx = {c: i for i, c in enumerate(cats)}
            table = np.zeros((len(complete), len(cats)))
            for i, (_, row) in enumerate(complete.iterrows()):
                for v in row:
                    table[i, cat_idx[v]] += 1
            k = _fleiss_kappa(table)
            summary["kappa"] = {"kind": "fleiss", **k,
                                "interpretation": _interpret_kappa(k["kappa"])}

    # ── Vs standard (accuracy) ──
    if standard_col and df[standard_col].notna().any():
        vs = {}
        std_modes = df.groupby(part_col)[standard_col].first()
        for app, g in df.groupby(appraiser_col):
            ok = 0; tot = 0
            for part, sub in g.groupby(part_col):
                truth = std_modes.get(part)
                if pd.isna(truth):
                    continue
                ratings = sub[rating_col].tolist()
                # An appraiser passes vs standard if EVERY trial matched truth.
                tot += 1
                if all(str(r) == str(truth) for r in ratings):
                    ok += 1
            vs[str(app)] = {"matched": ok, "total": tot,
                            "pct": (ok / tot * 100) if tot else None}
        summary["vs_standard"] = vs

        # Overall: all appraisers, all trials, agree with standard.
        all_ok = 0; all_tot = 0
        for part, sub in df.groupby(part_col):
            truth = std_modes.get(part)
            if pd.isna(truth):
                continue
            all_tot += 1
            if all(str(r) == str(truth) for r in sub[rating_col].tolist()):
                all_ok += 1
        summary["all_vs_standard"] = {
            "matched": all_ok, "total": all_tot,
            "pct": (all_ok / all_tot * 100) if all_tot else None,
        }

    return {"summary": summary}
