"""Gage Linearity & Bias study — the second pillar of MSA, distinct from GR&R.

GR&R tells you how much variation comes from the *measurement system* relative
to total. Linearity & Bias asks a different question:

  - Bias:        does the gage read systematically high or low?
  - Linearity:   does the bias change across the operating range?

You take parts of known reference value spanning the gage's range. Each part
is measured multiple times. Per-part bias = measured_mean − reference. The
linearity slope is the regression of bias vs reference. A flat zero line is
the ideal: zero bias, zero linearity.

This is `Stat → Quality Tools → Gage Study → Gage Linearity and Bias Study`
in Minitab.

Input columns:
    part_col       — which physical part (id)
    reference_col  — known true value for that part
    measurement_col — measured value (multiple rows per part)
    process_variation — optional; the 6σ from the GR&R study, used to
                        express bias and linearity as % of process variation.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps


def compute(df: pd.DataFrame, *, part_col: str, reference_col: str,
            measurement_col: str,
            process_variation: float | None = None) -> dict:
    """One full Linearity & Bias study.

    Returns per-part bias + overall regression of bias on reference. The
    linearity index is |slope| × process_variation when process_variation
    is supplied (Minitab's reporting style); otherwise just the slope.
    """
    sub = df[[part_col, reference_col, measurement_col]].dropna()
    if len(sub) < 6:
        raise ValueError("gage linearity needs ≥ 6 measurements across ≥ 2 reference values")

    parts = (sub.groupby(part_col)
                .agg(reference=(reference_col, "mean"),
                     measurement_mean=(measurement_col, "mean"),
                     measurement_std=(measurement_col, "std"),
                     n=(measurement_col, "count"))
                .reset_index())
    parts["bias"] = parts["measurement_mean"] - parts["reference"]
    parts["bias_pct_of_ref"] = (parts["bias"] / parts["reference"] * 100).where(
        parts["reference"] != 0, None)

    if parts["reference"].nunique() < 2:
        raise ValueError("gage linearity needs ≥ 2 distinct reference values")

    # Per-part one-sample t on bias = 0 (Minitab style)
    rows = []
    for _, p in parts.iterrows():
        # Pull this part's raw measurements for the t-test
        meas = sub.loc[sub[part_col] == p[part_col], measurement_col].astype(float).to_numpy()
        ref = float(p["reference"])
        if len(meas) >= 2 and meas.std(ddof=1) > 0:
            t, pv = sps.ttest_1samp(meas - ref, popmean=0.0)
            t, pv = float(t), float(pv)
        else:
            t, pv = (float("nan"), float("nan"))
        rows.append({"part": str(p[part_col]), "reference": ref,
                     "measurement_mean": float(p["measurement_mean"]),
                     "bias": float(p["bias"]),
                     "n": int(p["n"]),
                     "t": t, "p": pv})

    # Overall linear fit: bias = a + b·reference. Slope = linearity.
    refs = parts["reference"].to_numpy()
    biases = parts["bias"].to_numpy()
    slope, intercept, r, p_slope, se_slope = sps.linregress(refs, biases)

    # Overall constant-bias test (intercept-only at the centred reference):
    # use mean of per-part bias.
    all_meas = sub[measurement_col].astype(float).to_numpy()
    all_refs = sub.merge(parts[[part_col, "reference"]], on=part_col)["reference"].to_numpy()
    bias_all = all_meas - all_refs
    if len(bias_all) >= 2 and bias_all.std(ddof=1) > 0:
        t_overall, p_overall = sps.ttest_1samp(bias_all, popmean=0.0)
        overall_bias = float(bias_all.mean())
        ci_se = bias_all.std(ddof=1) / np.sqrt(len(bias_all))
        t_crit = sps.t.ppf(0.975, df=len(bias_all) - 1)
        ci = [float(overall_bias - t_crit * ci_se), float(overall_bias + t_crit * ci_se)]
    else:
        t_overall, p_overall, overall_bias, ci = (
            float("nan"), float("nan"), float(bias_all.mean()) if len(bias_all) else float("nan"),
            [float("nan"), float("nan")])

    summary = {
        "n_parts": int(parts[part_col].nunique()),
        "n_measurements": int(len(sub)),
        "reference_range": [float(parts["reference"].min()), float(parts["reference"].max())],
        "per_part": rows,
        "linearity": {
            "slope": float(slope),
            "intercept": float(intercept),
            "r_squared": float(r ** 2),
            "p_slope": float(p_slope),
            "se_slope": float(se_slope),
            "verdict": ("acceptable" if p_slope > 0.05 else "significant linearity"),
        },
        "bias_overall": {
            "mean_bias": float(overall_bias),
            "ci_95": ci,
            "t": float(t_overall),
            "p": float(p_overall),
            "verdict": ("acceptable" if p_overall > 0.05 else "significant bias"),
        },
    }

    if process_variation:
        pv = float(process_variation)
        summary["linearity"]["pct_process_variation"] = float(abs(slope) * pv * 100)
        summary["bias_overall"]["pct_process_variation"] = float(abs(overall_bias) / pv * 100) if pv else None

    return {"summary": summary}
