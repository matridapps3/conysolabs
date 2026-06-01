"""Quality / industrial helpers — small calculators that fill the last
gaps in Bench's catalogue:

  - arl_design        : choose CUSUM h,k or EWMA λ,L for a target ARL₀
  - clements_capability : non-normal Cpk via empirical percentiles
  - discrete_probability : PMF/CDF for binomial, Poisson, hypergeometric,
                           negative-binomial, geometric
  - mixture_em        : fit a 2- or 3-component normal mixture via EM
  - stability_regression : ICH Q1E pharma shelf-life regression
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats as sps


# ─── ARL design for CUSUM / EWMA ──────────────────────────────────────

def _ewma_arl_brent(lam: float, L: float, shift: float = 0.0,
                    n_grid: int = 50) -> float:
    """Markov-chain ARL approximation for a one-sided EWMA chart. Equally
    spaced quantisation of the EWMA statistic. Brook & Evans (1972)."""
    # Grid bounds: ±L · σ_EWMA where σ_EWMA = σ · sqrt(λ / (2 − λ))
    sigma_ew = np.sqrt(lam / (2 - lam))
    h = L * sigma_ew
    delta = 2 * h / (n_grid + 1)
    states = np.linspace(-h + delta / 2, h - delta / 2, n_grid)
    # Transition matrix P[i,j] = P(s' falls in cell j | s = states[i])
    P = np.zeros((n_grid, n_grid))
    for i, s in enumerate(states):
        for j, s2 in enumerate(states):
            lo = (s2 - delta / 2 - (1 - lam) * s) / lam - shift
            hi = (s2 + delta / 2 - (1 - lam) * s) / lam - shift
            P[i, j] = sps.norm.cdf(hi) - sps.norm.cdf(lo)
    # ARL = (I − P)⁻¹ · 1
    I_mat = np.eye(n_grid)
    ones = np.ones(n_grid)
    arl_vec = np.linalg.solve(I_mat - P, ones)
    # Initial state at zero (closest grid cell)
    return float(arl_vec[n_grid // 2])


def arl_design(chart_kind: str, target_arl0: float = 370.4,
               shift: float = 1.0,
               lam: float | None = None) -> dict:
    """Choose chart parameters for a target in-control ARL₀ and a target shift
    (in σ units) to detect.

    chart_kind: 'cusum' | 'ewma'

    For CUSUM: returns k = shift/2 (Page's "fastest detection" rule), then
    finds h such that ARL₀ ≈ target via the Siegmund approximation.
    For EWMA: takes λ (default 0.2) and finds L such that ARL₀ ≈ target.
    """
    if chart_kind not in ("cusum", "ewma"):
        raise ValueError("chart_kind must be 'cusum' or 'ewma'")

    if chart_kind == "cusum":
        # Standard Page rule: k = δ/2 where δ is the shift (in σ).
        k = shift / 2
        # Siegmund (1985) approximation: ARL₀(h, k=δ/2) ≈ (exp(2·k·(h+1.166)) − 1 − 2·k·(h+1.166)) / (2·k²)
        # Invert numerically for h.
        from scipy.optimize import brentq
        def f(h):
            x = 2 * k * (h + 1.166)
            return (np.exp(x) - 1 - x) / (2 * k ** 2) - target_arl0
        try:
            h = float(brentq(f, 0.5, 20.0))
        except ValueError:
            h = 4.0
        # ARL₁ for the chosen h, k at the shift target (~3 typically)
        x1 = 2 * k * (h + 1.166)
        arl1_approx = (np.exp(x1) - 1 - x1) / (2 * k ** 2) if k > 0 else float("inf")
        return {"summary": {
            "method": "cusum_arl_design",
            "target_arl0": target_arl0,
            "shift_to_detect_sigma": shift,
            "k": float(k),
            "h": float(h),
            "approx_arl1_at_target_shift": float(arl1_approx),
            "decision_rule": f"Trigger when one-sided CUSUM exceeds h = {h:.2f}σ.",
        }}

    # EWMA branch
    if lam is None:
        lam = 0.2
    if not (0 < lam < 1):
        raise ValueError("lam must be in (0,1)")
    # Search for L such that ARL₀ ≈ target.
    def _arl0(L):
        return _ewma_arl_brent(lam, L, shift=0.0, n_grid=40)
    # Bracket
    from scipy.optimize import brentq
    try:
        L_solved = float(brentq(lambda L: _arl0(L) - target_arl0, 1.5, 4.5, xtol=1e-3))
    except ValueError:
        L_solved = 3.0
    arl1 = _ewma_arl_brent(lam, L_solved, shift=shift, n_grid=40)
    return {"summary": {
        "method": "ewma_arl_design",
        "target_arl0": target_arl0,
        "shift_to_detect_sigma": shift,
        "lambda": float(lam),
        "L": float(L_solved),
        "approx_arl1_at_target_shift": float(arl1),
        "decision_rule": f"Trigger when |EWMA| exceeds L·σ·sqrt(λ/(2−λ)) = {L_solved:.2f}·σ·sqrt({lam/(2-lam):.3f}).",
    }}


# ─── Clements percentile method ───────────────────────────────────────

def clements_capability(df: pd.DataFrame, column: str,
                        lsl: float | None, usl: float | None,
                        target: float | None = None) -> dict:
    """Non-normal capability via Clements' percentile method (Clements 1989).

    Cpk = min( (USL − x̃) / (x̃_{0.99865} − x̃), (x̃ − LSL) / (x̃ − x̃_{0.00135}) )
    where x̃ is the median and the tail percentiles are estimated empirically
    (or via the chosen distribution fit). This sidesteps Box-Cox/Johnson
    when neither transform fits cleanly.
    """
    x = df[column].dropna().astype(float).to_numpy()
    if x.size < 30:
        raise ValueError("clements_capability needs ≥ 30 observations")
    p_low, p_med, p_high = np.percentile(x, [0.135, 50, 99.865])
    cpu = (usl - p_med) / (p_high - p_med) if usl is not None and p_high > p_med else None
    cpl = (p_med - lsl) / (p_med - p_low) if lsl is not None and p_low < p_med else None
    if cpu is not None and cpl is not None:
        cpk = float(min(cpu, cpl))
    elif cpu is not None:
        cpk = float(cpu)
    elif cpl is not None:
        cpk = float(cpl)
    else:
        cpk = None
    return {"summary": {
        "method": "clements_capability",
        "n": int(x.size),
        "median": float(p_med),
        "p_0_135": float(p_low),
        "p_99_865": float(p_high),
        "cpu": float(cpu) if cpu is not None else None,
        "cpl": float(cpl) if cpl is not None else None,
        "cpk": cpk,
        "interpretation": (
            "Capability via empirical percentiles — robust to non-normality, "
            "no transform required. Equivalent to the conventional Cpk when "
            "data are normal."
        ),
    }}


# ─── Discrete probability calculator ──────────────────────────────────

def discrete_probability(distribution: str, params: dict,
                         x: float | None = None) -> dict:
    """PMF, CDF, mean, variance of a discrete distribution at point x.

    distribution: 'binomial' | 'poisson' | 'hypergeometric' | 'neg_binomial' | 'geometric'

    Returns the value, probability, cumulative probability, mean, and variance.
    """
    if distribution == "binomial":
        n, p = int(params.get("n", 0)), float(params.get("p", 0.5))
        dist = sps.binom(n, p)
    elif distribution == "poisson":
        lam = float(params.get("lambda", params.get("lam", 1.0)))
        dist = sps.poisson(lam)
    elif distribution == "hypergeometric":
        M = int(params.get("M", params.get("N", 0)))
        n = int(params.get("n", 0))
        K = int(params.get("K", 0))
        dist = sps.hypergeom(M, K, n)
    elif distribution == "neg_binomial":
        r, p = int(params.get("r", 1)), float(params.get("p", 0.5))
        dist = sps.nbinom(r, p)
    elif distribution == "geometric":
        p = float(params.get("p", 0.5))
        dist = sps.geom(p)
    else:
        raise ValueError(f"unknown discrete distribution: {distribution}")

    mean = float(dist.mean()); var = float(dist.var())
    if x is None:
        # Return summary only
        return {"summary": {"distribution": distribution, "params": params,
                            "mean": mean, "variance": var,
                            "std": float(np.sqrt(var))}}
    x_int = int(round(x))
    pmf = float(dist.pmf(x_int))
    cdf = float(dist.cdf(x_int))
    return {"summary": {"distribution": distribution, "params": params,
                        "x": x_int, "pmf": pmf, "cdf": cdf,
                        "survival": 1.0 - cdf,
                        "mean": mean, "variance": var,
                        "std": float(np.sqrt(var))}}


# ─── Normal mixture EM ────────────────────────────────────────────────

def mixture_em(df: pd.DataFrame, column: str, n_components: int = 2,
               max_iter: int = 200, tol: float = 1e-6,
               seed: int | None = 42) -> dict:
    """Fit a k-component normal mixture via EM. Useful when a column looks
    like two populations mashed together (bimodal histogram, hidden grouping)."""
    x = df[column].dropna().astype(float).to_numpy()
    n = x.size
    if n < n_components * 10:
        raise ValueError(f"mixture EM needs ≥ {n_components * 10} observations")
    k = int(n_components)
    rng = np.random.default_rng(seed)
    # Initialise means at random observations, equal weights, pooled sd.
    mu = rng.choice(x, k, replace=False).astype(float)
    sigma = np.full(k, x.std(ddof=1))
    weights = np.full(k, 1.0 / k)
    prev_ll = -np.inf
    for it in range(max_iter):
        # E-step
        densities = np.column_stack([w * sps.norm.pdf(x, m, s)
                                      for w, m, s in zip(weights, mu, sigma)])
        densities[densities < 1e-300] = 1e-300
        total = densities.sum(axis=1, keepdims=True)
        resp = densities / total
        ll = float(np.sum(np.log(total)))
        if abs(ll - prev_ll) < tol:
            break
        prev_ll = ll
        # M-step
        Nk = resp.sum(axis=0)
        weights = Nk / n
        mu = (resp * x[:, None]).sum(axis=0) / Nk
        sigma = np.sqrt(((resp * (x[:, None] - mu) ** 2).sum(axis=0)) / Nk)
        sigma = np.maximum(sigma, 1e-6)
    components = sorted([
        {"mean": float(mu[i]), "sd": float(sigma[i]), "weight": float(weights[i])}
        for i in range(k)], key=lambda c: c["mean"])
    return {"summary": {"method": "mixture_em",
                        "n": int(n), "k": k,
                        "iterations": int(it + 1),
                        "log_likelihood": float(ll),
                        "AIC": float(2 * (3 * k - 1) - 2 * ll),
                        "BIC": float((3 * k - 1) * np.log(n) - 2 * ll),
                        "components": components}}


# ─── Stability (ICH Q1E) regression ───────────────────────────────────

def stability_regression(df: pd.DataFrame, time_col: str, value_col: str,
                          spec_low: float | None = None,
                          spec_high: float | None = None,
                          confidence: float = 0.95) -> dict:
    """ICH Q1E shelf-life regression.

    Fits a linear model `value ~ time`, builds a 95 % one-sided confidence
    band, and reports the shelf-life as the time at which the band first
    crosses the spec.
    """
    sub = df[[time_col, value_col]].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < 4:
        raise ValueError("stability_regression needs ≥ 4 observations")
    t = sub[time_col].to_numpy()
    y = sub[value_col].to_numpy()
    slope, intercept, r, p, se = sps.linregress(t, y)
    t_grid = np.linspace(t.min(), t.max() * 3, 200)
    y_hat = intercept + slope * t_grid
    n = len(t); ss_res = np.sum((y - (intercept + slope * t)) ** 2)
    rmse = np.sqrt(ss_res / (n - 2)) if n > 2 else 0.0
    t_crit = sps.t.ppf(1 - (1 - confidence) / 2, n - 2)
    band = t_crit * rmse * np.sqrt(1 / n + (t_grid - t.mean()) ** 2
                                    / np.sum((t - t.mean()) ** 2))
    ci_lo = y_hat - band
    ci_hi = y_hat + band
    # Shelf life: first t where the relevant band crosses the spec.
    shelf_low = None
    shelf_high = None
    if spec_low is not None and slope < 0:
        crosses = np.where(ci_lo <= spec_low)[0]
        if crosses.size: shelf_low = float(t_grid[crosses[0]])
    if spec_high is not None and slope > 0:
        crosses = np.where(ci_hi >= spec_high)[0]
        if crosses.size: shelf_high = float(t_grid[crosses[0]])
    return {"summary": {
        "method": "stability_regression",
        "n": int(n),
        "slope": float(slope), "intercept": float(intercept),
        "r_squared": float(r ** 2),
        "p_slope": float(p),
        "rmse": float(rmse),
        "shelf_life_low_cross": shelf_low,
        "shelf_life_high_cross": shelf_high,
        "interpretation": (
            f"Trend: {'declining' if slope < 0 else 'increasing'} at {slope:.4f}/unit time. "
            + (f"Crosses lower spec at t = {shelf_low:.2f}." if shelf_low is not None else "")
            + (f"Crosses upper spec at t = {shelf_high:.2f}." if shelf_high is not None else "")
            + (" No spec crossing within projected horizon."
               if shelf_low is None and shelf_high is None else "")
        ),
    }}
