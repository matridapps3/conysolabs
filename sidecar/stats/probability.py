"""Probability distribution calculators — PDF, CDF, inverse-CDF, plus
probability-plot (Q-Q) generators. Replaces Minitab's Calc → Probability
Distributions and Graph → Probability Plot menus.
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats as sps


_DISTS = {
    "normal":      sps.norm,
    "t":           sps.t,
    "f":           sps.f,
    "chi2":        sps.chi2,
    "binomial":    sps.binom,
    "poisson":     sps.poisson,
    "weibull":     sps.weibull_min,
    "exponential": sps.expon,
    "lognormal":   sps.lognorm,
    "gamma":       sps.gamma,
    "beta":        sps.beta,
    "uniform":     sps.uniform,
}


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def calculator(distribution: str, mode: str, x: float | list, params: dict) -> dict:
    """mode = 'pdf' | 'cdf' | 'ppf' (inverse-CDF). params holds distribution
    parameters by name; we pass them to scipy positionally where the mapping
    is unambiguous.
    """
    if distribution not in _DISTS:
        raise ValueError(f"unknown distribution: {distribution}")
    dist = _DISTS[distribution]

    # Coerce param dict → positional args for scipy. For each distribution
    # we accept the natural names BBs expect.
    arg_map = {
        "normal":      ["mean", "stdev"],
        "t":           ["df"],
        "f":           ["dfn", "dfd"],
        "chi2":        ["df"],
        "binomial":    ["n", "p"],
        "poisson":     ["mu"],
        "weibull":     ["shape", "scale"],
        "exponential": ["scale"],
        "lognormal":   ["s", "scale"],
        "gamma":       ["shape", "scale"],
        "beta":        ["alpha", "beta"],
        "uniform":     ["loc", "scale"],
    }
    expected = arg_map[distribution]
    args = []
    for name in expected:
        if name in params:
            args.append(params[name])
    # Many scipy continuous distributions take (shape, loc=0, scale=1) — we
    # pass the user's natural names through and let scipy do the rest.
    # For normal: dist.pdf(x, loc=mean, scale=stdev)
    if distribution == "normal":
        kwargs = {"loc": params["mean"], "scale": params["stdev"]}
        args = []
    elif distribution == "exponential":
        kwargs = {"scale": params.get("scale", 1.0)}
        args = []
    elif distribution == "weibull":
        kwargs = {"scale": params.get("scale", 1.0)}
        args = [params["shape"]]
    elif distribution == "uniform":
        kwargs = {"loc": params.get("loc", 0.0), "scale": params.get("scale", 1.0)}
        args = []
    elif distribution == "lognormal":
        kwargs = {"scale": params.get("scale", 1.0)}
        args = [params["s"]]
    elif distribution == "gamma":
        kwargs = {"scale": params.get("scale", 1.0)}
        args = [params["shape"]]
    elif distribution == "beta":
        kwargs = {}
        args = [params["alpha"], params["beta"]]
    else:
        kwargs = {}

    # Discrete distributions expose .pmf, not .pdf — accessing dist.pdf on them
    # raises AttributeError, so pick the density handle by type BEFORE building
    # the dispatch map. (The old eager `{"pdf": dist.pdf, ...}` crashed
    # binomial/poisson on EVERY mode, since the dict literal evaluated dist.pdf.)
    is_discrete = distribution in ("binomial", "poisson")
    density = dist.pmf if is_discrete else dist.pdf
    fn = {"pdf": density, "cdf": dist.cdf, "ppf": dist.ppf}.get(mode)
    if fn is None:
        raise ValueError(f"unknown mode: {mode}")
    if isinstance(x, list):
        out = [float(fn(xi, *args, **kwargs)) for xi in x]
    else:
        out = float(fn(x, *args, **kwargs))
    return {"summary": {"distribution": distribution, "mode": mode,
                        "params": params, "x": x, "result": out}}


def probability_plot(df: pd.DataFrame, column: str,
                     distribution: str = "normal") -> dict:
    """Q-Q probability plot — visual normality (or other distribution)
    check. Plots theoretical quantiles vs sample quantiles; a straight
    line indicates the distribution fits."""
    x = df[column].dropna().astype(float).to_numpy()
    if x.size < 5:
        raise ValueError("probability plot: need at least 5 observations")
    fig, ax = plt.subplots(figsize=(6.0, 4.5))
    if distribution == "normal":
        sps.probplot(x, dist="norm", plot=ax)
    elif distribution == "lognormal":
        sps.probplot(np.log(x[x > 0]), dist="norm", plot=ax)
        ax.set_title(ax.get_title() + " (log scale)")
    elif distribution == "weibull":
        # Weibull plot — ln(t) vs ln(-ln(1-F)).
        t = np.sort(x)
        n = t.size
        F = (np.arange(1, n + 1) - 0.3) / (n + 0.4)
        ax.scatter(np.log(t[F < 1]), np.log(-np.log(1 - F[F < 1])), s=20)
        ax.set_xlabel("ln(t)")
        ax.set_ylabel("ln(-ln(1-F))")
        ax.set_title(f"Weibull probability plot — {column}")
    else:
        try:
            sps.probplot(x, dist=distribution, plot=ax)
        except Exception:
            raise ValueError(f"distribution {distribution!r} not supported for probability plot")
    return {"summary": {"distribution": distribution, "n": int(x.size)},
            "chart_png": _png(fig)}
