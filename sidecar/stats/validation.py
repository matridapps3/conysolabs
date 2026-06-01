"""NIST StRD numerical-accuracy validation.

Runs Conyso Bench's actual analysis functions against the National Institute
of Standards & Technology *Statistical Reference Datasets* (StRD) — benchmark
problems with values certified to 15 significant digits, several deliberately
constructed to break numerically naive implementations (e.g. Longley's
near-collinear regression, Wampler's high-order polynomials, NumAcc's
catastrophic-cancellation means).

This is the numerical pedigree Minitab / SAS / JMP publish and most tools
don't. We report, for each statistic, the number of correct significant
digits = −log₁₀(|computed − certified| / |certified|).

Source: https://www.itl.nist.gov/div898/strd/  (public-domain U.S. Government work)
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import regression as regression_stat
from . import capability as capability_stat


def _sig_digits(computed: float, certified: float) -> float:
    """Correct significant digits of agreement. 15 ⇒ machine-exact."""
    if certified == 0:
        diff = abs(computed)
        return 15.0 if diff == 0 else max(0.0, -math.log10(diff))
    if computed == certified:
        return 15.0
    rel = abs(computed - certified) / abs(certified)
    if rel <= 0:
        return 15.0
    return max(0.0, min(15.0, -math.log10(rel)))


# ───────── Embedded certified datasets ─────────
# Only datasets whose values we can reproduce authoritatively are included:
# Longley ships with statsmodels (no transcription risk) and NumAcc1 is the
# canonical 3-value catastrophic-cancellation test. We deliberately omit any
# dataset we'd have to hand-key, since a typo would make the engine look wrong.
#
# Longley — multiple regression, "higher" difficulty (near-collinear); the
# benchmark NIST and the literature cite for regression numerical accuracy.
# TOTEMP ~ GNPDEFL + GNP + UNEMP + ARMED + POP + YEAR
_LONGLEY_CERT = {
    "(Intercept)": -3482258.63459582,
    "GNPDEFL": 15.0618722713733,
    "GNP": -0.358191792925910e-01,
    "UNEMP": -2.02022980381683,
    "ARMED": -1.03322686717359,
    "POP": -0.511041056535807e-01,
    "YEAR": 1829.15146461355,
    "R2": 0.995479004577296,
}

# NumAcc1 — univariate summary, exact mean/sd despite a large constant offset
# (tests for catastrophic cancellation in the variance computation).
_NUMACC1 = [10000001.0, 10000003.0, 10000002.0]
_NUMACC1_CERT = {"mean": 10000002.0, "sd": 1.0}


def _check(name, dataset, difficulty, computed, certified, min_digits=6):
    d = _sig_digits(computed, certified)
    return {
        "test": name, "dataset": dataset, "difficulty": difficulty,
        "certified": certified, "computed": computed,
        "sig_digits": round(d, 2), "pass": d >= min_digits,
    }


def nist_strd() -> dict:
    """Run the embedded NIST StRD problems through Bench and report agreement."""
    checks = []

    # ── Longley: multiple regression (near-collinear, classic StRD killer) ──
    from statsmodels.datasets import longley
    ldf = longley.load_pandas().data
    preds = ["GNPDEFL", "GNP", "UNEMP", "ARMED", "POP", "YEAR"]
    lr = regression_stat.compute(ldf, response="TOTEMP", predictors=preds)["summary"]
    lc = {c["name"]: c["coef"] for c in lr["coefficients"]}
    for term in ["(Intercept)", "GNPDEFL", "GNP", "UNEMP", "ARMED", "POP", "YEAR"]:
        checks.append(_check(f"β {term}", "Longley", "higher",
                             lc[term], _LONGLEY_CERT[term]))
    checks.append(_check("R²", "Longley", "higher", lr["r2"], _LONGLEY_CERT["R2"]))

    # ── NumAcc1: univariate mean & sd (catastrophic cancellation) ──
    cs = capability_stat.compute(pd.DataFrame({"x": _NUMACC1}), column="x",
                                 lsl=None, usl=None, target=None)["summary"]
    checks.append(_check("Mean", "NumAcc1", "lower", cs["mean"], _NUMACC1_CERT["mean"]))
    checks.append(_check("Std dev", "NumAcc1", "higher", cs["stdev"], _NUMACC1_CERT["sd"]))

    passed = sum(1 for c in checks if c.get("pass"))
    digits = [c["sig_digits"] for c in checks if "sig_digits" in c]
    return {"summary": {
        "framework": "NIST StRD",
        "source": "https://www.itl.nist.gov/div898/strd/",
        "n_checks": len(checks),
        "n_passed": passed,
        "all_passed": passed == len(checks),
        "min_sig_digits": round(min(digits), 2) if digits else None,
        "median_sig_digits": round(float(np.median(digits)), 2) if digits else None,
        "checks": checks,
        "note": "Each statistic is computed by Bench's own analysis functions and compared to NIST's 15-digit certified values. Closed-source tools rarely publish their StRD agreement.",
    }}
