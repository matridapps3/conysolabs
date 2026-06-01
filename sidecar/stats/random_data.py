"""Random data generators for simulation, training, and testing. Replaces
Minitab's Calc → Random Data menu.
"""
from __future__ import annotations

import numpy as np
from scipy import stats as sps


def generate(distribution: str, n: int, params: dict, seed: int | None = None) -> dict:
    """Generate n random observations from the named distribution.
    Supported: normal, uniform, exponential, lognormal, weibull, gamma,
    binomial, poisson, beta, t, chi2.
    """
    rng = np.random.default_rng(seed)
    n = int(n)
    if n <= 0:
        raise ValueError("n must be positive")
    if distribution == "normal":
        x = rng.normal(params.get("mean", 0.0), params.get("stdev", 1.0), n)
    elif distribution == "uniform":
        lo = float(params.get("low", 0.0)); hi = float(params.get("high", 1.0))
        x = rng.uniform(lo, hi, n)
    elif distribution == "exponential":
        x = rng.exponential(params.get("scale", 1.0), n)
    elif distribution == "lognormal":
        x = rng.lognormal(params.get("mean", 0.0), params.get("sigma", 1.0), n)
    elif distribution == "weibull":
        x = params.get("scale", 1.0) * rng.weibull(params["shape"], n)
    elif distribution == "gamma":
        x = rng.gamma(params["shape"], params.get("scale", 1.0), n)
    elif distribution == "binomial":
        x = rng.binomial(params["n_trials"], params["p"], n)
    elif distribution == "poisson":
        x = rng.poisson(params["mu"], n)
    elif distribution == "beta":
        x = rng.beta(params["alpha"], params["beta"], n)
    elif distribution == "t":
        x = rng.standard_t(params["df"], n)
    elif distribution == "chi2":
        x = rng.chisquare(params["df"], n)
    else:
        raise ValueError(f"unknown distribution: {distribution}")
    return {"summary": {
        "distribution": distribution, "n": n, "params": params,
        "values": [float(v) for v in x[:1000]],   # cap response size
        "values_truncated": n > 1000,
        "mean": float(np.mean(x)), "stdev": float(np.std(x, ddof=1)) if n > 1 else None,
    }}
