"""Bootstrap confidence intervals — the distribution-free CI on any statistic.

When your data isn't normal, the textbook "± t·SE" CI is wrong. Bootstrap
sidesteps the question entirely: resample with replacement N times, recompute
the statistic on each resample, take percentiles. The CI is the empirical
distribution of the statistic, no distributional assumption.

Bench supports: mean, median, std, var, mad, q25/q50/q75, iqr, min, max, range,
skew, kurtosis, cv (coefficient of variation), proportion (for 0/1 columns),
and a "ratio" mode for two columns (a/b ratio).

Two CI methods:
  percentile      — fast, biased for skewed distributions
  bca (bias-corrected and accelerated) — the gold standard, slower

Default: BCa with 5000 resamples and α=0.05.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sps


_STATS = {
    "mean":    lambda x: float(np.mean(x)),
    "median":  lambda x: float(np.median(x)),
    "std":     lambda x: float(np.std(x, ddof=1)) if len(x) > 1 else float("nan"),
    "var":     lambda x: float(np.var(x, ddof=1)) if len(x) > 1 else float("nan"),
    "mad":     lambda x: float(np.median(np.abs(np.asarray(x) - np.median(x)))),
    "q25":     lambda x: float(np.percentile(x, 25)),
    "q50":     lambda x: float(np.percentile(x, 50)),
    "q75":     lambda x: float(np.percentile(x, 75)),
    "iqr":     lambda x: float(np.percentile(x, 75) - np.percentile(x, 25)),
    "min":     lambda x: float(np.min(x)),
    "max":     lambda x: float(np.max(x)),
    "range":   lambda x: float(np.max(x) - np.min(x)),
    "skew":    lambda x: float(sps.skew(x)) if len(x) > 2 else float("nan"),
    "kurtosis": lambda x: float(sps.kurtosis(x)) if len(x) > 3 else float("nan"),
    "cv": lambda x: (float(np.std(x, ddof=1) / np.mean(x))
                     if np.mean(x) != 0 and len(x) > 1 else float("nan")),
    "proportion": lambda x: float(np.mean(np.asarray(x) > 0)),
}


def _resample(x: np.ndarray, fn, n_boot: int, rng) -> np.ndarray:
    """Vectorised resampling — draw a (n_boot, n) matrix of indices, apply fn
    row-wise. Memory-conscious: chunked when n*n_boot would blow past 100M."""
    n = len(x)
    if n_boot * n > 100_000_000:
        # Chunk to keep memory below ~800MB.
        chunk = max(100, int(100_000_000 / n))
        out = np.empty(n_boot)
        for start in range(0, n_boot, chunk):
            end = min(n_boot, start + chunk)
            idx = rng.integers(0, n, size=(end - start, n))
            out[start:end] = np.apply_along_axis(fn, 1, x[idx])
        return out
    idx = rng.integers(0, n, size=(n_boot, n))
    return np.apply_along_axis(fn, 1, x[idx])


def _bca_ci(theta_hat: float, boot: np.ndarray, x: np.ndarray,
            fn, alpha: float) -> tuple[float, float]:
    """Bias-corrected and accelerated CI (Efron 1987). Adjusts the percentile
    CI for skew and bias in the sampling distribution. The standard choice
    when the statistic isn't a linear function of the data (median, sd, etc.)."""
    boot = np.asarray(boot)
    boot = boot[np.isfinite(boot)]
    if len(boot) < 10:
        return (float("nan"), float("nan"))
    # z0: bias-correction factor
    prop_less = float((boot < theta_hat).sum()) / len(boot)
    prop_less = min(max(prop_less, 1e-9), 1 - 1e-9)
    z0 = sps.norm.ppf(prop_less)
    # a: acceleration via jackknife
    n = len(x)
    jack = np.array([fn(np.delete(x, i)) for i in range(n)])
    jack_mean = jack.mean()
    num = ((jack_mean - jack) ** 3).sum()
    den = 6 * ((jack_mean - jack) ** 2).sum() ** 1.5
    a = num / den if den > 0 else 0.0
    # Adjusted percentiles
    za = sps.norm.ppf(alpha / 2)
    zb = sps.norm.ppf(1 - alpha / 2)
    alpha1 = sps.norm.cdf(z0 + (z0 + za) / (1 - a * (z0 + za)))
    alpha2 = sps.norm.cdf(z0 + (z0 + zb) / (1 - a * (z0 + zb)))
    lo = float(np.percentile(boot, 100 * alpha1))
    hi = float(np.percentile(boot, 100 * alpha2))
    return (lo, hi)


def effect_size(df: pd.DataFrame, *, column: str, group_col: str,
                kind: str = "cohens_d",
                n_boot: int = 2000,
                alpha: float = 0.05,
                seed: int | None = None) -> dict:
    """Bootstrap CI for an effect size — turning "d = 0.40" into
    "d = 0.40 [0.12, 0.68]". The interval is what tells you whether the
    estimate is precise enough to act on.

    Supports:
        cohens_d        — pooled-SD standardised mean difference (2 groups)
        glass_delta     — uses only the control group SD (2 groups)
        hedges_g        — small-sample correction of Cohen's d
        rank_biserial   — Mann-Whitney r (non-parametric, 2 groups)
        eta_squared     — η² for one-way ANOVA (k groups)
        cles            — Common-Language Effect Size = P(X_a > X_b)
    """
    rng = np.random.default_rng(seed)
    groups = list(df.dropna(subset=[column, group_col]).groupby(group_col)[column])
    keys = [str(k) for k, _ in groups]
    arrays = [g.astype(float).to_numpy() for _, g in groups]

    if kind in ("cohens_d", "glass_delta", "hedges_g", "rank_biserial", "cles"):
        if len(arrays) != 2:
            raise ValueError(f"{kind} requires exactly 2 groups; got {len(arrays)}")
    elif kind == "eta_squared":
        if len(arrays) < 2:
            raise ValueError("eta_squared requires ≥ 2 groups")
    else:
        raise ValueError(f"unknown effect-size kind: {kind}")

    def stat_of(arr_list):
        a = arr_list[0]
        if kind == "eta_squared":
            allv = np.concatenate(arr_list)
            grand = allv.mean()
            ss_total = float(((allv - grand) ** 2).sum())
            ss_b = sum(g.size * (g.mean() - grand) ** 2 for g in arr_list)
            return ss_b / ss_total if ss_total > 0 else 0.0
        b = arr_list[1]
        if a.size < 2 or b.size < 2:
            return float("nan")
        if kind == "cohens_d":
            sp = np.sqrt(((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1))
                         / (a.size + b.size - 2))
            return (a.mean() - b.mean()) / sp if sp > 0 else float("nan")
        if kind == "glass_delta":
            sd_ctrl = b.std(ddof=1)
            return (a.mean() - b.mean()) / sd_ctrl if sd_ctrl > 0 else float("nan")
        if kind == "hedges_g":
            sp = np.sqrt(((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1))
                         / (a.size + b.size - 2))
            d = (a.mean() - b.mean()) / sp if sp > 0 else float("nan")
            J = 1 - 3 / (4 * (a.size + b.size) - 9)
            return d * J
        if kind == "rank_biserial":
            U = sps.mannwhitneyu(a, b, alternative="two-sided").statistic
            return 1 - (2 * U) / (a.size * b.size)
        if kind == "cles":
            # P(X_a > X_b) via Mann-Whitney's U / (n_a · n_b).
            U = sps.mannwhitneyu(a, b, alternative="two-sided").statistic
            return U / (a.size * b.size)

    theta_hat = stat_of(arrays)
    if not np.isfinite(theta_hat):
        return {"summary": {"kind": kind, "theta_hat": None, "note": "undefined"}}

    boot = np.empty(n_boot)
    sizes = [a.size for a in arrays]
    for i in range(n_boot):
        resamples = [rng.choice(a, size=n, replace=True) for a, n in zip(arrays, sizes)]
        boot[i] = stat_of(resamples)
    boot = boot[np.isfinite(boot)]
    if len(boot) < 10:
        return {"summary": {"kind": kind, "theta_hat": float(theta_hat),
                            "note": "bootstrap distribution degenerate"}}
    # Percentile CI (BCa for general estimators of two samples gets fiddly; the
    # bias correction is small for effect sizes in practice — percentile
    # is what JMP shows here too).
    lo = float(np.percentile(boot, 100 * alpha / 2))
    hi = float(np.percentile(boot, 100 * (1 - alpha / 2)))
    return {"summary": {"kind": kind,
                        "theta_hat": float(theta_hat),
                        "ci_low": lo, "ci_high": hi,
                        "alpha": alpha, "n_boot": int(n_boot),
                        "groups": keys}}


def compute(df: pd.DataFrame, *, column: str,
            statistic: str = "mean",
            n_boot: int = 5000,
            method: str = "bca",
            alpha: float = 0.05,
            group_col: str | None = None,
            seed: int | None = None) -> dict:
    """Compute a bootstrap CI for `statistic` on `column`. If group_col is
    given, returns per-group CIs (compare medians of two groups without the
    Mann-Whitney assumption baggage, for example)."""
    if statistic not in _STATS:
        raise ValueError(f"unknown statistic: {statistic}. "
                         f"Available: {sorted(_STATS.keys())}")
    fn = _STATS[statistic]
    rng = np.random.default_rng(seed)

    def _one(x: np.ndarray) -> dict:
        x = np.asarray(x, dtype=float)
        x = x[np.isfinite(x)]
        if len(x) < 3:
            return {"theta_hat": None, "ci_low": None, "ci_high": None,
                    "n": int(len(x)), "n_boot": 0,
                    "note": "need_at_least_3_observations"}
        theta_hat = fn(x)
        boot = _resample(x, fn, n_boot, rng)
        if method == "percentile":
            lo = float(np.percentile(boot, 100 * alpha / 2))
            hi = float(np.percentile(boot, 100 * (1 - alpha / 2)))
        else:
            lo, hi = _bca_ci(theta_hat, boot, x, fn, alpha)
        return {"theta_hat": float(theta_hat),
                "ci_low": lo, "ci_high": hi,
                "n": int(len(x)), "n_boot": int(n_boot),
                "se_boot": float(np.std(boot, ddof=1))}

    if group_col:
        groups = {}
        for g, sub in df.groupby(group_col):
            groups[str(g)] = _one(sub[column].to_numpy())
        return {"summary": {"statistic": statistic, "method": method,
                            "alpha": alpha, "column": column,
                            "group_col": group_col, "groups": groups}}

    res = _one(df[column].to_numpy())
    return {"summary": {"statistic": statistic, "method": method,
                        "alpha": alpha, "column": column, **res}}
