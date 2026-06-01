"""Tolerance intervals — intervals that contain at least P% of the
population with C% confidence. Distinct from a confidence interval on
the mean: a tolerance interval bounds individual observations, which is
what you actually care about for spec setting.

Two implementations:
  - Normal (parametric, k-factor method)
  - Nonparametric (order statistics, distribution-free)
"""
from __future__ import annotations

import math
from typing import Optional
import numpy as np
import pandas as pd
from scipy import stats as sps


def _normal_k_factor(n: int, p: float, conf: float, two_sided: bool = True) -> float:
    """Howe (1969) approximation for the two-sided normal tolerance factor.
    For one-sided we use the noncentral-t inverse."""
    if two_sided:
        # Howe's approximation
        z_p = sps.norm.ppf((1 + p) / 2)
        chi2 = sps.chi2.ppf(1 - conf, n - 1)
        return float(z_p * np.sqrt((n - 1) * (1 + 1 / n) / chi2))
    else:
        z_p = sps.norm.ppf(p)
        # Owen's k1 via noncentral t
        nct = sps.nct.ppf(conf, df=n - 1, nc=z_p * np.sqrt(n))
        return float(nct / np.sqrt(n))


def normal(df: pd.DataFrame, column: str, p: float = 0.95, conf: float = 0.95,
           two_sided: bool = True) -> dict:
    """Normal-distribution tolerance interval for `column`.
    p:    proportion of population to cover
    conf: confidence level on that coverage
    """
    x = df[column].dropna().astype(float).to_numpy()
    n = x.size
    if n < 3:
        raise ValueError("normal tolerance: need at least 3 observations")
    mean = float(x.mean())
    sd = float(x.std(ddof=1))
    k = _normal_k_factor(n, p, conf, two_sided)
    if two_sided:
        return {"summary": {
            "method": "normal_two_sided", "n": n, "p": p, "confidence": conf,
            "mean": mean, "stdev": sd, "k_factor": k,
            "lower": mean - k * sd, "upper": mean + k * sd,
        }}
    else:
        return {"summary": {
            "method": "normal_one_sided", "n": n, "p": p, "confidence": conf,
            "mean": mean, "stdev": sd, "k_factor": k,
            "lower_bound": mean - k * sd, "upper_bound": mean + k * sd,
        }}


def nonparametric(df: pd.DataFrame, column: str, p: float = 0.95, conf: float = 0.95) -> dict:
    """Distribution-free tolerance interval. Uses order statistics — the
    interval [x_(j), x_(n-r+1)] contains at least p of the population with
    confidence c when (j, r) satisfy a binomial cumulative inequality.

    With j = r = 1 (min, max), we cover ≥ p with confidence c if and only
    if p^(n) ≤ 1 - c. That gives the minimum n required.
    """
    x = df[column].dropna().astype(float).to_numpy()
    n = x.size
    if n < 10:
        raise ValueError("nonparametric tolerance: need at least 10 observations")
    # Find the (j, r) ranks that achieve the requested coverage / confidence.
    # Standard formula: P(coverage ≥ p) = 1 - I_p(n - j - r + 1, j + r) where
    # I is the regularized incomplete beta function.
    # We'll search outward from the extremes for the tightest interval.
    best = None
    for total in range(2, n + 1):
        for j in range(1, total):
            r = total - j
            cov_prob = 1 - sps.beta.cdf(p, n - j - r + 1, j + r)
            if cov_prob >= conf:
                xs = np.sort(x)
                lo = float(xs[j - 1])
                up = float(xs[n - r])
                width = up - lo
                if best is None or width < best["width"]:
                    best = {"j": j, "r": r, "lower": lo, "upper": up,
                            "width": width, "achieved_confidence": float(cov_prob)}
    if best is None:
        raise RuntimeError(
            f"nonparametric tolerance: n={n} too small to achieve p={p} at conf={conf}. "
            f"Need n ≥ ~{math.ceil(np.log(1 - conf) / np.log(p))}."
        )
    return {"summary": {
        "method": "nonparametric_two_sided", "n": n, "p": p, "confidence": conf,
        **{k: best[k] for k in ("lower", "upper", "j", "r", "achieved_confidence")},
        "interpretation": f"At least {p*100:.0f}% of the population is between {best['lower']:.4g} and {best['upper']:.4g}, with {conf*100:.0f}% confidence.",
    }}
