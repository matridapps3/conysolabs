"""Distribution Identifier — fit a candidate set of continuous distributions
and rank by Anderson-Darling goodness-of-fit. Equivalent to Minitab's
"Stat → Quality Tools → Individual Distribution Identification" but
ranks all candidates in one call rather than asking the user to pick.

Why we have it: when capability analysis runs against a non-normal
process, the BB needs to know WHICH distribution to use. Bill ranks the
candidates and recommends the best fit; the capability route can then
re-run in the recommended distribution's parameter space.

Candidates: normal, lognormal, exponential, weibull (2-parameter),
gamma, logistic, beta (when bounded), and the negative-of-exponential
(reflected) for left-skewed data.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps


CANDIDATES = (
    ("normal",       sps.norm),
    ("lognormal",    sps.lognorm),
    ("exponential",  sps.expon),
    ("weibull_min",  sps.weibull_min),
    ("gamma",        sps.gamma),
    ("logistic",     sps.logistic),
    ("log_logistic", sps.fisk),           # log-logistic
    ("gumbel_l",     sps.gumbel_l),       # smallest extreme value (Type I)
    ("gumbel_r",     sps.gumbel_r),       # largest extreme value (Type I)
    ("genextreme",   sps.genextreme),     # generalized extreme value
)


def _ad_stat(x: np.ndarray, dist, params: tuple) -> float:
    """Anderson-Darling statistic A² for a fitted distribution. Lower is
    better. Computed from the standardized CDF values of the sample."""
    n = x.size
    cdf = np.sort(np.clip(dist.cdf(np.sort(x), *params), 1e-12, 1 - 1e-12))
    i = np.arange(1, n + 1)
    s = np.sum((2 * i - 1) / n * (np.log(cdf) + np.log(1 - cdf[::-1])))
    return float(-n - s)


def compute(df: pd.DataFrame, column: str, candidates: list[str] | None = None) -> dict:
    """Fit each candidate distribution to the column and return rankings.
    Returns:
      {
        "summary": {
          "n": int,
          "results": [
            {"distribution": "...", "params": [...], "AD": float, "AIC": float, "rank": int},
            ...
          ],
          "best_fit": "...",
          "recommendation": "..."
        }
      }
    """
    x = df[column].dropna().astype(float).to_numpy()
    if x.size < 8:
        raise ValueError("distribution_id requires at least 8 observations")

    pool = [c for c in CANDIDATES if (candidates is None or c[0] in candidates)]
    # Beta only makes sense for bounded data — auto-add if data fall in (0, 1)
    # after a small expansion.
    if x.min() > 0 and x.max() < 1 and (candidates is None or "beta" in (candidates or [])):
        pool.append(("beta", sps.beta))

    results = []
    for name, dist in pool:
        try:
            if name == "exponential" and x.min() < 0:
                continue
            if name == "lognormal" and x.min() <= 0:
                continue
            if name == "weibull_min" and x.min() <= 0:
                continue
            if name == "gamma" and x.min() <= 0:
                continue
            if name == "log_logistic" and x.min() <= 0:
                continue
            params = dist.fit(x)
            ll = float(np.sum(dist.logpdf(x, *params)))
            k = len(params)
            aic = 2 * k - 2 * ll
            ad = _ad_stat(x, dist, params)
            results.append({
                "distribution": name,
                "params": [float(p) for p in params],
                "log_likelihood": ll,
                "AIC": float(aic),
                "AD": ad,
            })
        except Exception as e:
            results.append({"distribution": name, "error": str(e)})

    # Rank by AD (lower = better fit), tie-break on AIC.
    fitted = [r for r in results if "AD" in r]
    fitted.sort(key=lambda r: (r["AD"], r["AIC"]))
    for i, r in enumerate(fitted):
        r["rank"] = i + 1

    best = fitted[0]["distribution"] if fitted else None
    recommendation = (
        f"Best fit: {best}. Use this distribution for capability and tolerance analysis."
        if best else "No candidate distribution converged. Inspect the data for outliers or zeros."
    )
    return {
        "summary": {
            "n": int(x.size),
            "results": fitted + [r for r in results if "error" in r],
            "best_fit": best,
            "recommendation": recommendation,
        }
    }
