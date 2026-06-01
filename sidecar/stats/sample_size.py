"""Sample size + power calculator. Covers the four cases that come up
constantly in DMAIC measure / improve phases:

  * one_sample_t / two_sample_t — minimum n to detect a mean shift of `delta`
    given std `sigma`, at α and target power.
  * one_proportion / two_proportion — minimum n for proportion comparisons.
  * cpk_validation — minimum n for a Cpk lower confidence bound to be > target.

Formulas use the standard z-approximation (large-n; we round up). For the
Cpk case we use Bissell's 1990 large-sample CI: SE(Cpk) ≈ sqrt(1/(9n) + Cpk²/(2n−2)).
"""

from __future__ import annotations

import math
from typing import Optional
from scipy.stats import norm


def _round_up(x):
    return int(math.ceil(x))


def t_test(
    *,
    delta: float,                 # minimum mean shift to detect
    sigma: float,                 # population std (estimate)
    alpha: float = 0.05,
    power: float = 0.80,
    two_sample: bool = False,
    two_sided: bool = True,
):
    if delta <= 0 or sigma <= 0:
        raise ValueError("delta and sigma must be positive")
    z_alpha = norm.ppf(1 - alpha / (2 if two_sided else 1))
    z_beta  = norm.ppf(power)
    n_each = ((z_alpha + z_beta) ** 2) * (sigma ** 2) / (delta ** 2)
    if two_sample:
        n_each *= 2
    return {
        "summary": {
            "n_per_group": _round_up(n_each),
            "n_total": _round_up(n_each) * (2 if two_sample else 1),
            "delta": delta, "sigma": sigma,
            "alpha": alpha, "power": power, "two_sample": two_sample,
        }
    }


def proportion_test(
    *,
    p1: float,
    p2: Optional[float] = None,   # if provided → two-proportion test
    alpha: float = 0.05,
    power: float = 0.80,
    two_sided: bool = True,
):
    if not (0 < p1 < 1):
        raise ValueError("p1 must be in (0, 1)")
    z_alpha = norm.ppf(1 - alpha / (2 if two_sided else 1))
    z_beta  = norm.ppf(power)

    if p2 is None:
        # one-proportion vs target ≠ p1: assume H1: p = p1 + 0.05 unless caller specifies via p2
        raise ValueError("provide p2 (alternative proportion to detect)")
    if not (0 < p2 < 1):
        raise ValueError("p2 must be in (0, 1)")

    p_bar = (p1 + p2) / 2
    n_each = (z_alpha * math.sqrt(2 * p_bar * (1 - p_bar))
              + z_beta * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / ((p1 - p2) ** 2)
    return {
        "summary": {
            "n_per_group": _round_up(n_each),
            "n_total": _round_up(n_each) * 2,
            "p1": p1, "p2": p2, "alpha": alpha, "power": power,
        }
    }


def anova(
    *,
    k_groups: int,                # number of groups
    effect_size_f: float,         # Cohen's f (small=0.10, medium=0.25, large=0.40)
    alpha: float = 0.05,
    power: float = 0.80,
):
    """Sample size per group for one-way ANOVA. Cohen's f effect size.
    Solves the non-central F via search — closed form doesn't exist.
    Conservative lower bound; for small k the noncentrality is well-
    approximated by f² · n_total.
    """
    if k_groups < 2:
        raise ValueError("k_groups must be ≥ 2")
    if effect_size_f <= 0:
        raise ValueError("effect_size_f must be > 0")
    from scipy.stats import f as f_dist, ncf
    df1 = k_groups - 1
    for n in range(2, 10_001):
        df2 = (n - 1) * k_groups
        # critical F at α
        crit = f_dist.ppf(1 - alpha, df1, df2)
        # noncentrality: λ = f² · N
        lam = (effect_size_f ** 2) * (n * k_groups)
        achieved = 1 - ncf.cdf(crit, df1, df2, lam)
        if achieved >= power:
            return {
                "summary": {
                    "n_per_group": n, "n_total": n * k_groups,
                    "k_groups": k_groups, "effect_size_f": effect_size_f,
                    "alpha": alpha, "power_achieved": float(achieved),
                    "power_target": power,
                }
            }
    raise RuntimeError("required n_per_group exceeds 10,000 — effect too small")


def regression(
    *,
    n_predictors: int,
    effect_size_f2: float,        # Cohen's f² (small=0.02, medium=0.15, large=0.35)
    alpha: float = 0.05,
    power: float = 0.80,
):
    """Sample size for multiple regression (overall F-test of R²).
    Cohen's f² = R² / (1 − R²).
    """
    if n_predictors < 1:
        raise ValueError("n_predictors must be ≥ 1")
    if effect_size_f2 <= 0:
        raise ValueError("effect_size_f2 must be > 0")
    from scipy.stats import f as f_dist, ncf
    df1 = n_predictors
    for n in range(n_predictors + 2, 100_001):
        df2 = n - n_predictors - 1
        crit = f_dist.ppf(1 - alpha, df1, df2)
        lam = effect_size_f2 * n
        achieved = 1 - ncf.cdf(crit, df1, df2, lam)
        if achieved >= power:
            return {
                "summary": {
                    "n": n, "n_predictors": n_predictors,
                    "effect_size_f2": effect_size_f2,
                    "alpha": alpha, "power_target": power,
                    "power_achieved": float(achieved),
                }
            }
    raise RuntimeError("required n exceeds 100,000")


def cpk_validation(
    *,
    cpk_target: float,            # we want CI lower bound to exceed this
    cpk_estimate: float,          # current point estimate
    confidence: float = 0.95,
):
    """Minimum n so that a one-sided lower CI bound on Cpk exceeds cpk_target."""
    if cpk_estimate <= cpk_target:
        raise ValueError("cpk_estimate must exceed cpk_target")
    z = norm.ppf(confidence)
    # Solve for n: cpk_estimate − z * sqrt(1/(9n) + cpk²/(2n)) ≥ target
    diff = cpk_estimate - cpk_target
    # Approximate iteratively (small monotonic search)
    for n in range(5, 100_001):
        se = math.sqrt(1 / (9 * n) + (cpk_estimate ** 2) / (2 * n - 2))
        if z * se <= diff:
            return {
                "summary": {
                    "n": n, "cpk_target": cpk_target,
                    "cpk_estimate": cpk_estimate, "confidence": confidence,
                    "se_at_n": se,
                }
            }
    raise RuntimeError("required n exceeds 100,000 — estimate too close to target")


# ─── Additional cases (parity push vs Minitab Power & Sample Size menu) ────

def chi_square(
    *,
    df_chi: int,
    effect_size_w: float,           # Cohen's w (small=0.10, medium=0.30, large=0.50)
    alpha: float = 0.05,
    power: float = 0.80,
):
    """Sample size for a chi-square goodness-of-fit or independence test.
    Cohen's w is the effect-size index. n is found by solving the
    non-central chi-square for the target power."""
    if df_chi < 1 or effect_size_w <= 0:
        raise ValueError("df_chi ≥ 1 and effect_size_w > 0 required")
    from scipy.stats import chi2, ncx2
    crit = chi2.ppf(1 - alpha, df_chi)
    for n in range(5, 100_001):
        lam = (effect_size_w ** 2) * n
        achieved = 1 - ncx2.cdf(crit, df_chi, lam)
        if achieved >= power:
            return {"summary": {"n": n, "df": df_chi, "effect_size_w": effect_size_w,
                                "alpha": alpha, "power_target": power,
                                "power_achieved": float(achieved)}}
    raise RuntimeError("required n exceeds 100,000")


def equivalence_tost(
    *,
    delta: float,                   # equivalence half-margin
    sigma: float,
    true_mean_diff: float = 0.0,
    alpha: float = 0.05,
    power: float = 0.80,
    two_sample: bool = False,
):
    """TOST (Two One-Sided Tests) sample-size for equivalence testing.
    Approximation: each one-sided test at level α; required n bigger than
    a single t-test by the usual TOST overhead. Conservative formula
    using z-approximation."""
    if delta <= 0 or sigma <= 0:
        raise ValueError("delta and sigma must be positive")
    if abs(true_mean_diff) >= delta:
        raise ValueError("true_mean_diff must lie within ±delta")
    z_alpha = norm.ppf(1 - alpha)             # one-sided
    z_beta  = norm.ppf(power)
    effective = delta - abs(true_mean_diff)
    n_each = ((z_alpha + z_beta) ** 2) * (sigma ** 2) / (effective ** 2)
    if two_sample:
        n_each *= 2
    return {"summary": {"n_per_group": _round_up(n_each),
                        "n_total": _round_up(n_each) * (2 if two_sample else 1),
                        "delta": delta, "sigma": sigma,
                        "true_mean_diff": true_mean_diff,
                        "alpha": alpha, "power": power, "two_sample": two_sample}}


def logrank(
    *,
    hazard_ratio: float,
    p_event: float = 0.5,           # overall probability of event during the study
    alpha: float = 0.05,
    power: float = 0.80,
    two_sided: bool = True,
    allocation_ratio: float = 1.0,  # n_treatment / n_control
):
    """Sample size for a two-group log-rank test (time-to-event /
    survival). Uses Schoenfeld's formula: total events required, then
    backs out total n given probability of event."""
    if hazard_ratio <= 0 or hazard_ratio == 1.0:
        raise ValueError("hazard_ratio must be positive and ≠ 1")
    if not (0 < p_event <= 1):
        raise ValueError("p_event must be in (0, 1]")
    z_alpha = norm.ppf(1 - alpha / (2 if two_sided else 1))
    z_beta  = norm.ppf(power)
    k = allocation_ratio
    pi1 = 1 / (1 + k)
    pi2 = k / (1 + k)
    events = ((z_alpha + z_beta) ** 2) / (pi1 * pi2 * (math.log(hazard_ratio) ** 2))
    n_total = events / p_event
    return {"summary": {"events_required": _round_up(events),
                        "n_total": _round_up(n_total),
                        "n_control": _round_up(n_total * pi1),
                        "n_treatment": _round_up(n_total * pi2),
                        "hazard_ratio": hazard_ratio, "p_event": p_event,
                        "alpha": alpha, "power": power,
                        "allocation_ratio": allocation_ratio}}


def cluster_randomized(
    *,
    delta: float,
    sigma: float,
    icc: float,                     # intra-cluster correlation (0..1)
    cluster_size: int,
    alpha: float = 0.05,
    power: float = 0.80,
    two_sided: bool = True,
):
    """Cluster-randomized two-arm trial. Applies the design effect (DEFF
    = 1 + (m-1)·ρ) to the standard two-sample t formula. Returns clusters
    per arm + total n."""
    if delta <= 0 or sigma <= 0:
        raise ValueError("delta and sigma must be positive")
    if not (0 <= icc <= 1):
        raise ValueError("icc must be in [0, 1]")
    if cluster_size < 1:
        raise ValueError("cluster_size must be ≥ 1")
    deff = 1 + (cluster_size - 1) * icc
    z_alpha = norm.ppf(1 - alpha / (2 if two_sided else 1))
    z_beta  = norm.ppf(power)
    n_individual_each = 2 * ((z_alpha + z_beta) ** 2) * (sigma ** 2) / (delta ** 2)
    n_inflated_each = n_individual_each * deff
    clusters_each = math.ceil(n_inflated_each / cluster_size)
    return {"summary": {"clusters_per_arm": int(clusters_each),
                        "n_per_arm": int(clusters_each * cluster_size),
                        "n_total": int(2 * clusters_each * cluster_size),
                        "design_effect": float(deff),
                        "icc": icc, "cluster_size": cluster_size,
                        "delta": delta, "sigma": sigma,
                        "alpha": alpha, "power": power}}


def finite_population_correction(
    *,
    n_required_infinite: int,
    population_size: int,
):
    """Apply Cochran's finite-population correction (FPC):
        n_adj = n / (1 + (n−1)/N)
    Used when sampling more than ~5% of a known population.
    """
    if n_required_infinite < 1 or population_size < 1:
        raise ValueError("both arguments must be ≥ 1")
    n_adj = n_required_infinite / (1 + (n_required_infinite - 1) / population_size)
    return {"summary": {
        "n_required_infinite": int(n_required_infinite),
        "population_size": int(population_size),
        "n_adjusted": _round_up(n_adj),
        "sampling_fraction": _round_up(n_adj) / population_size,
    }}


def variance_test(
    *,
    sigma2_ratio: float,            # ratio of σ²₁ to σ²₂ to detect
    alpha: float = 0.05,
    power: float = 0.80,
):
    """Two-sample F-test for variance equality — minimum n per group.
    Uses the non-central F approximation."""
    if sigma2_ratio <= 0 or sigma2_ratio == 1:
        raise ValueError("sigma2_ratio must be > 0 and ≠ 1")
    from scipy.stats import f as f_dist
    z_alpha = norm.ppf(1 - alpha / 2)
    z_beta = norm.ppf(power)
    # Large-sample approx: n ≈ ((z_a + z_b) / ln(ratio))² + 1
    n = ((z_alpha + z_beta) / math.log(sigma2_ratio)) ** 2 + 1
    return {"summary": {"n_per_group": _round_up(n),
                        "n_total": _round_up(n) * 2,
                        "sigma2_ratio": sigma2_ratio,
                        "alpha": alpha, "power": power}}


def correlation(
    *,
    r: float,                       # correlation to detect
    alpha: float = 0.05,
    power: float = 0.80,
    two_sided: bool = True,
):
    """Sample size for testing Pearson's r ≠ 0 via Fisher z-transform."""
    if not (-1 < r < 1) or r == 0:
        raise ValueError("r must be in (-1, 1) and ≠ 0")
    z_alpha = norm.ppf(1 - alpha / (2 if two_sided else 1))
    z_beta  = norm.ppf(power)
    z_r = 0.5 * math.log((1 + r) / (1 - r))
    n = ((z_alpha + z_beta) / z_r) ** 2 + 3
    return {"summary": {"n": _round_up(n), "r": r,
                        "alpha": alpha, "power": power}}


# ─── Graphical power explorer ──────────────────────────────────────────────
# Point sample-size calcs answer "how many?"; a power curve answers "what if?".
# Minitab's Power & Sample Size dialog plots power vs. n for several effect
# sizes so a BB can see the diminishing-returns knee and defend their n.

def power_curve(
    *,
    kind: str = "two_sample_t",     # one_sample_t | two_sample_t | two_proportions | anova
    effect_size: float | None = None,
    delta: float | None = None,     # raw mean shift (with sigma) → standardized d
    sigma: float | None = None,
    p1: float | None = None,        # proportions: baseline & comparison
    p2: float | None = None,
    k_groups: int = 3,              # anova
    alpha: float = 0.05,
    power: float = 0.80,            # target line + solved n
    two_sided: bool = True,
):
    """Sweep n and return power-vs-n curves (one per effect-size multiplier)
    plus the n that achieves the target power, and a matplotlib chart.
    Uses statsmodels' noncentral-distribution solvers — exact, not the
    z-approximation used by the point calculators above."""
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from statsmodels.stats.power import (
        TTestPower, TTestIndPower, NormalIndPower, FTestAnovaPower,
    )
    from statsmodels.stats.proportion import proportion_effectsize

    alt = "two-sided" if two_sided else "larger"

    # Resolve the standardized effect size + pick the right solver.
    if kind in ("one_sample_t", "two_sample_t"):
        if effect_size is None:
            if delta is None or not sigma:
                raise ValueError("provide effect_size, or delta + sigma")
            effect_size = abs(delta) / sigma
        solver = TTestIndPower() if kind == "two_sample_t" else TTestPower()
        es_label = "Cohen's d"
        _nkey = "nobs1" if kind == "two_sample_t" else "nobs"
        def pw(es, n):
            return float(solver.power(effect_size=es, alpha=alpha, alternative=alt, **{_nkey: n}))
    elif kind == "two_proportions":
        if effect_size is None:
            if p1 is None or p2 is None:
                raise ValueError("provide effect_size, or p1 + p2")
            effect_size = abs(proportion_effectsize(p1, p2))
        solver = NormalIndPower()
        es_label = "Cohen's h"
        def pw(es, n): return float(solver.power(effect_size=es, nobs1=n, alpha=alpha, alternative=alt))
    elif kind == "anova":
        if effect_size is None:
            raise ValueError("anova power needs effect_size (Cohen's f)")
        solver = FTestAnovaPower()
        es_label = "Cohen's f"
        def pw(es, n): return float(solver.power(effect_size=es, nobs=n * k_groups,
                                                 alpha=alpha, k_groups=k_groups))
    else:
        raise ValueError(f"unknown power-curve kind: {kind}")

    # Solve n for the target power at the nominal effect size.
    if kind == "anova":
        n_total = solver.solve_power(effect_size=effect_size, alpha=alpha,
                                     power=power, k_groups=k_groups)
        n_required = _round_up(n_total / k_groups)
    elif kind == "one_sample_t":
        n_required = _round_up(solver.solve_power(effect_size=effect_size, alpha=alpha,
                                                  power=power, alternative=alt))
    else:
        n_required = _round_up(solver.solve_power(effect_size=effect_size, alpha=alpha,
                                                  power=power, alternative=alt))

    n_max = max(int(n_required * 2.2), 20)
    n_grid = list(range(2, n_max + 1))
    multipliers = [0.5, 0.75, 1.0, 1.5]
    curves = []
    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    for m in multipliers:
        es = effect_size * m
        ys = [pw(es, n) for n in n_grid]
        curves.append({"effect_size": round(es, 4), "multiplier": m, "power": ys})
        ax.plot(n_grid, ys, marker="" , linewidth=2,
                label=f"{es_label}={es:.3f}" + (" (target)" if m == 1.0 else ""))
    ax.axhline(power, linestyle="--", color="#888", linewidth=1)
    ax.axvline(n_required, linestyle=":", color="#888", linewidth=1)
    ax.annotate(f"n={n_required}", xy=(n_required, power),
                xytext=(6, -14), textcoords="offset points", fontsize=9)
    ax.set_xlabel("Sample size per group" if kind in ("two_sample_t", "two_proportions", "anova") else "Sample size")
    ax.set_ylabel("Power (1 − β)")
    ax.set_ylim(0, 1.02)
    ax.set_title(f"Power curve — {kind.replace('_', ' ')}")
    ax.legend(fontsize=8, loc="lower right")
    ax.grid(True, alpha=0.25)

    import io
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)

    return {
        "summary": {
            "kind": kind, "effect_size": float(effect_size), "effect_label": es_label,
            "n_required": n_required, "alpha": alpha, "power_target": power,
            "two_sided": two_sided, **({"k_groups": k_groups} if kind == "anova" else {}),
        },
        "curve": {"n": n_grid, "series": curves},
        "chart_png": buf.getvalue(),
    }
