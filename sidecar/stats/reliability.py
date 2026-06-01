"""Reliability / survival analysis. Fits Weibull, lognormal, and
exponential distributions to time-to-failure data with optional right-
censoring. Computes characteristic life, B10, MTBF, hazard, and
reliability at user-supplied mission times.

This closes one of the largest free-tier gaps with Minitab — pharma,
automotive and aerospace lean on this constantly. Bill's implementation
is parametric and supports right-censored data (the most common case in
real warranty / field-failure work).
"""
from __future__ import annotations

import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import optimize, stats as sps


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def _weibull_mle(times: np.ndarray, censored: np.ndarray) -> tuple[float, float, float]:
    """Maximum-likelihood fit of a 2-parameter Weibull with right-censoring.
    Returns (shape β, scale η, log-likelihood).

    f(t)  = (β/η)(t/η)^(β-1) exp(-(t/η)^β)
    S(t)  = exp(-(t/η)^β)

    For right-censored observations only S(t) contributes to the likelihood.
    """
    if (times <= 0).any():
        raise ValueError("weibull: all failure times must be > 0")
    obs_idx = censored == 0
    cens_idx = censored == 1
    n_failures = int(obs_idx.sum())
    if n_failures < 2:
        raise ValueError("weibull: need at least 2 observed failures")

    def neg_ll(theta):
        beta, eta = theta
        if beta <= 0 or eta <= 0:
            return 1e18
        # log-likelihood
        ll = 0.0
        if obs_idx.any():
            t = times[obs_idx]
            ll += np.sum(np.log(beta / eta) + (beta - 1) * np.log(t / eta) - (t / eta) ** beta)
        if cens_idx.any():
            t = times[cens_idx]
            ll += np.sum(-((t / eta) ** beta))
        return -ll

    # Initial estimate via method of moments.
    mean_t = float(np.mean(times[obs_idx])) if obs_idx.any() else float(np.mean(times))
    init = [1.5, mean_t]
    res = optimize.minimize(neg_ll, init, method="Nelder-Mead",
                            options={"xatol": 1e-6, "fatol": 1e-8, "maxiter": 5000})
    if not res.success:
        raise RuntimeError(f"weibull MLE failed: {res.message}")
    beta, eta = float(res.x[0]), float(res.x[1])
    return beta, eta, float(-res.fun)


def weibull(df: pd.DataFrame, time_col: str, censor_col: str | None = None,
            mission_times: list[float] | None = None) -> dict:
    """Fit a 2-parameter Weibull. censor_col is 0 = failed, 1 = right-censored.
    mission_times is an optional list of t-values at which to report
    reliability R(t) = P(survive past t).

    Outputs:
      shape β, scale η, MTBF (E[T] = η · Γ(1 + 1/β)),
      B10 life (10% failure quantile), characteristic life (η = 63.2% failure),
      reliability at each mission time, and a probability plot PNG.
    """
    sub = df[[time_col] + ([censor_col] if censor_col else [])].dropna()
    times = sub[time_col].astype(float).to_numpy()
    censored = (sub[censor_col].astype(int).to_numpy() if censor_col
                else np.zeros(len(sub), dtype=int))
    beta, eta, ll = _weibull_mle(times, censored)

    # MTBF = E[T] = η · Γ(1 + 1/β) for a 2-parameter Weibull.
    from math import gamma as _gamma
    mtbf = eta * _gamma(1 + 1 / beta)

    # B10 — time at which 10% have failed: F(t) = 0.10 → t = η · (-ln(0.9))^(1/β)
    b10 = eta * (-np.log(0.9)) ** (1 / beta)
    # Char life η is by definition the 63.2% quantile.
    char_life = eta

    rels = {}
    if mission_times:
        for t in mission_times:
            rels[float(t)] = float(np.exp(-((t / eta) ** beta)))

    # Probability plot — Weibull plot uses ln(t) vs ln(-ln(1-F̂))
    n = times.size
    order = np.argsort(times)
    t_sorted = times[order]
    cens_sorted = censored[order]
    # Median ranks adjusted for censoring (Bernard's approximation).
    F = np.zeros(n)
    rank = 0.0
    for i in range(n):
        if cens_sorted[i] == 0:
            rank += (n + 1 - rank) / (1 + (n - i))
        F[i] = (rank - 0.3) / (n + 0.4)
    # Only plot the failure points
    fail_mask = (cens_sorted == 0) & (F > 0) & (F < 1)
    fig, ax = plt.subplots(figsize=(7.0, 4.5))
    if fail_mask.any():
        x_plot = np.log(t_sorted[fail_mask])
        y_plot = np.log(-np.log(1 - F[fail_mask]))
        ax.scatter(x_plot, y_plot, marker="o", label="failures")
        # Fitted line
        xs = np.linspace(x_plot.min(), x_plot.max(), 50)
        ys = beta * xs - beta * np.log(eta)
        ax.plot(xs, ys, linestyle="--", label=f"β={beta:.2f}, η={eta:.2f}")
        ax.set_xlabel("ln(time)")
        ax.set_ylabel("ln(-ln(1-F))")
        ax.set_title("Weibull Probability Plot")
        ax.legend(loc="best")
    return {
        "summary": {
            "distribution": "weibull",
            "shape_beta": float(beta),
            "scale_eta": float(eta),
            "log_likelihood": float(ll),
            "n": int(n),
            "n_failures": int((censored == 0).sum()),
            "n_censored": int((censored == 1).sum()),
            "MTBF": float(mtbf),
            "B10_life": float(b10),
            "characteristic_life": float(char_life),
            "reliability_at_mission_times": rels,
            "shape_interpretation": (
                "β < 1: infant mortality (decreasing hazard)" if beta < 1 else
                "β ≈ 1: random failures (constant hazard, exponential-like)" if abs(beta - 1) < 0.1 else
                "β > 1: wear-out (increasing hazard)"
            ),
        },
        "chart_png": _png(fig),
    }


def arrhenius_acceleration(df: pd.DataFrame, time_col: str, temp_col_kelvin: str,
                           censor_col: str | None = None,
                           use_kelvin: float | None = None) -> dict:
    """Accelerated Life Testing under the Arrhenius temperature model.
    Fits a Weibull at each temperature stress level, then a log-linear
    Arrhenius regression: ln(η) = a + Ea/(k_B · T). Returns the
    activation energy (Ea), the acceleration factor between stress
    levels, and an extrapolation to use temperature.

    The simplified implementation here:
      - groups by temp_col_kelvin (must already be in Kelvin)
      - fits Weibull at each level (with optional censoring)
      - regresses ln(η) on 1/T
      - reports use-condition life when use_kelvin is supplied
    """
    BOLTZMANN_EV_PER_K = 8.617e-5
    cols = [time_col, temp_col_kelvin] + ([censor_col] if censor_col else [])
    sub = df[cols].dropna()
    fits = []
    for T, g in sub.groupby(temp_col_kelvin):
        times = g[time_col].astype(float).to_numpy()
        cens = g[censor_col].astype(int).to_numpy() if censor_col else np.zeros(len(g), dtype=int)
        try:
            beta, eta, ll = _weibull_mle(times, cens)
            fits.append({"temperature_K": float(T), "n": int(len(g)),
                         "shape_beta": beta, "scale_eta": eta})
        except Exception as e:
            fits.append({"temperature_K": float(T), "error": str(e)})
    valid = [f for f in fits if "scale_eta" in f]
    if len(valid) < 2:
        raise RuntimeError("Arrhenius needs at least 2 stress levels with successful Weibull fits")
    inv_T = np.array([1.0 / f["temperature_K"] for f in valid])
    ln_eta = np.array([np.log(f["scale_eta"]) for f in valid])
    slope, intercept = np.polyfit(inv_T, ln_eta, 1)
    Ea = slope * BOLTZMANN_EV_PER_K
    use_life = None
    af = None
    if use_kelvin is not None:
        ln_eta_use = intercept + slope / float(use_kelvin)
        use_life = float(np.exp(ln_eta_use))
        # Acceleration factor relative to highest stress level
        max_stress = max(valid, key=lambda f: f["temperature_K"])
        af = use_life / max_stress["scale_eta"] if max_stress["scale_eta"] > 0 else None
    return {"summary": {
        "method": "arrhenius_accelerated_life",
        "n_stress_levels": len(valid),
        "fits": fits,
        "Arrhenius_intercept": float(intercept),
        "Arrhenius_slope": float(slope),
        "activation_energy_eV": float(Ea),
        "use_temperature_K": use_kelvin,
        "predicted_use_life": use_life,
        "acceleration_factor_use_vs_max_stress": af,
    }}


def exponential(df: pd.DataFrame, time_col: str,
                censor_col: str | None = None,
                mission_times: list[float] | None = None) -> dict:
    """Exponential reliability — special case of Weibull with β = 1.
    MLE λ̂ = total observed failures / total time on test."""
    sub = df[[time_col] + ([censor_col] if censor_col else [])].dropna()
    times = sub[time_col].astype(float).to_numpy()
    censored = (sub[censor_col].astype(int).to_numpy() if censor_col
                else np.zeros(len(sub), dtype=int))
    failures = int((censored == 0).sum())
    if failures == 0:
        raise ValueError("exponential: need at least one observed failure")
    total_time = float(times.sum())
    rate = failures / total_time
    mtbf = 1.0 / rate
    rels = {}
    if mission_times:
        for t in mission_times:
            rels[float(t)] = float(np.exp(-rate * t))
    return {
        "summary": {
            "distribution": "exponential",
            "rate_lambda": float(rate),
            "MTBF": float(mtbf),
            "n": int(len(sub)),
            "n_failures": failures,
            "n_censored": int((censored == 1).sum()),
            "reliability_at_mission_times": rels,
        }
    }


def _parametric_fit(name: str, dist, x: np.ndarray,
                    mission_times: list[float] | None = None) -> dict:
    """Generic MLE fit for a scipy continuous distribution. Used for the
    'extra' reliability distributions (lognormal, gamma, log-logistic,
    extreme-value, GEV) that don't have a custom fitter above. Right-
    censoring is NOT modelled here — these are full-failure fits only.
    For censored data prefer Weibull (custom MLE) or exponential.
    """
    failures = x[~np.isnan(x)]
    if failures.size < 3:
        raise ValueError(f"{name}: need at least 3 observed failures")
    params = dist.fit(failures)
    ll = float(np.sum(dist.logpdf(failures, *params)))
    k = len(params)
    aic = 2 * k - 2 * ll
    rels = {}
    if mission_times:
        for t in mission_times:
            try:
                rels[float(t)] = float(1.0 - dist.cdf(t, *params))
            except Exception:
                rels[float(t)] = None
    # B10 = time at which 10% have failed = inverse CDF at 0.10.
    try:
        b10 = float(dist.ppf(0.10, *params))
    except Exception:
        b10 = None
    return {
        "summary": {
            "distribution": name,
            "params": [float(p) for p in params],
            "log_likelihood": ll,
            "AIC": float(aic),
            "B10": b10,
            "n": int(failures.size),
            "reliability_at_mission_times": rels,
        }
    }


def lognormal(df: pd.DataFrame, time_col: str,
              censor_col: str | None = None,
              mission_times: list[float] | None = None) -> dict:
    """Lognormal — common for repair times and metal-fatigue lifetimes."""
    sub = df[[time_col]].dropna()
    x = sub[time_col].astype(float).to_numpy()
    if (x <= 0).any():
        raise ValueError("lognormal: all times must be > 0")
    return _parametric_fit("lognormal", sps.lognorm, x, mission_times)


def gamma(df: pd.DataFrame, time_col: str,
          censor_col: str | None = None,
          mission_times: list[float] | None = None) -> dict:
    """Gamma — flexible 2-parameter alternative to lognormal for non-
    negative continuous lifetimes."""
    sub = df[[time_col]].dropna()
    x = sub[time_col].astype(float).to_numpy()
    if (x <= 0).any():
        raise ValueError("gamma: all times must be > 0")
    return _parametric_fit("gamma", sps.gamma, x, mission_times)


def log_logistic(df: pd.DataFrame, time_col: str,
                 censor_col: str | None = None,
                 mission_times: list[float] | None = None) -> dict:
    """Log-logistic (Fisk) — log-transformed times follow a logistic.
    Used where the hazard is non-monotonic (rises then falls)."""
    sub = df[[time_col]].dropna()
    x = sub[time_col].astype(float).to_numpy()
    if (x <= 0).any():
        raise ValueError("log_logistic: all times must be > 0")
    return _parametric_fit("log_logistic", sps.fisk, x, mission_times)


def smallest_extreme_value(df: pd.DataFrame, time_col: str,
                           censor_col: str | None = None,
                           mission_times: list[float] | None = None) -> dict:
    """Smallest Extreme Value (Gumbel for minima) — Type I EV for the
    distribution of the minimum of many independent variables. Common in
    weakest-link failures (rope strands, chain links)."""
    sub = df[[time_col]].dropna()
    x = sub[time_col].astype(float).to_numpy()
    return _parametric_fit("smallest_extreme_value", sps.gumbel_l, x, mission_times)


def largest_extreme_value(df: pd.DataFrame, time_col: str,
                          censor_col: str | None = None,
                          mission_times: list[float] | None = None) -> dict:
    """Largest Extreme Value (Gumbel for maxima) — Type I EV for the
    distribution of the maximum of many independent variables. Used for
    peak loads, peak temperatures, return-period analysis."""
    sub = df[[time_col]].dropna()
    x = sub[time_col].astype(float).to_numpy()
    return _parametric_fit("largest_extreme_value", sps.gumbel_r, x, mission_times)


def gev(df: pd.DataFrame, time_col: str,
        censor_col: str | None = None,
        mission_times: list[float] | None = None) -> dict:
    """Generalized Extreme Value — 3-parameter family that covers all
    three EV types (Gumbel, Fréchet, reverse-Weibull) via the shape
    parameter ξ. Standard tool for extreme-value engineering."""
    sub = df[[time_col]].dropna()
    x = sub[time_col].astype(float).to_numpy()
    return _parametric_fit("gev", sps.genextreme, x, mission_times)


def cox_ph(df: pd.DataFrame, time_col: str, event_col: str,
           predictors: list[str]) -> dict:
    """Cox proportional hazards regression — the workhorse of survival
    analysis. Estimates hazard ratios for predictors without assuming a
    specific distribution for the baseline hazard (unlike Weibull AFT).

    event_col: 1 = event observed (death/failure), 0 = censored (still alive
               at end of study).

    Returned hazard_ratio = exp(coef). HR > 1 → predictor increases risk;
    HR < 1 → predictor is protective.

    No external `lifelines` dependency — fits via Breslow partial likelihood
    using scipy.optimize, the same algorithm Cox's original 1972 paper.
    """
    from scipy import optimize as _opt

    sub = df[[time_col, event_col] + predictors].dropna()
    if len(sub) < max(10, len(predictors) * 5):
        raise ValueError(f"cox_ph: need at least {max(10, len(predictors) * 5)} complete cases")
    t = sub[time_col].astype(float).to_numpy()
    e = sub[event_col].astype(int).to_numpy()
    X = sub[predictors].astype(float).to_numpy()
    n, p = X.shape

    # Sort by descending time so risk-set cumulative sums work cleanly.
    order = np.argsort(-t)
    t, e, X = t[order], e[order], X[order]

    def neg_log_partial(beta):
        eta = X @ beta
        # log Σ_{j in risk set} exp(η_j)  — descending sort makes this a cumsum.
        log_risk = np.log(np.cumsum(np.exp(eta)))
        return -np.sum(e * (eta - log_risk))

    def grad(beta):
        eta = X @ beta
        w = np.exp(eta)
        cum_w = np.cumsum(w)                       # Σ w in risk set
        cum_wx = np.cumsum(w[:, None] * X, axis=0) # Σ wX in risk set
        mean_X = cum_wx / cum_w[:, None]
        return -np.sum(e[:, None] * (X - mean_X), axis=0)

    beta0 = np.zeros(p)
    res = _opt.minimize(neg_log_partial, beta0, jac=grad, method="BFGS")
    beta = res.x
    # Information matrix → standard errors. Newton-style observed information.
    eta = X @ beta
    w = np.exp(eta)
    cum_w = np.cumsum(w)
    cum_wx = np.cumsum(w[:, None] * X, axis=0)
    cum_wxx = np.cumsum(w[:, None, None] * X[:, :, None] * X[:, None, :], axis=0)
    mean_X = cum_wx / cum_w[:, None]
    var_X = cum_wxx / cum_w[:, None, None] - mean_X[:, :, None] * mean_X[:, None, :]
    I = np.sum(e[:, None, None] * var_X, axis=0)
    try:
        Iinv = np.linalg.inv(I)
        se = np.sqrt(np.diag(Iinv))
    except Exception:
        se = np.full(p, np.nan)

    coefs = []
    for j, name in enumerate(predictors):
        z = beta[j] / se[j] if se[j] > 0 else float("nan")
        pv = 2 * (1 - sps.norm.cdf(abs(z))) if np.isfinite(z) else float("nan")
        coefs.append({
            "name": name,
            "coef": float(beta[j]),
            "hazard_ratio": float(np.exp(beta[j])),
            "se": float(se[j]),
            "z": float(z),
            "p": float(pv),
            "ci_lo_hr": float(np.exp(beta[j] - 1.96 * se[j])),
            "ci_hi_hr": float(np.exp(beta[j] + 1.96 * se[j])),
        })

    # Concordance (C-index) — survival analogue of AUC. Vectorised broadcast:
    # for each event-i, count how many j outlasted t[i] (permissible), and
    # how many of those had lower predicted risk (concordant) plus half-count
    # for ties. Big speedup vs the original nested loop at n > 500.
    risk = X @ beta
    event_mask = e.astype(bool)
    if event_mask.sum() == 0:
        c_index = None
    else:
        t_i = t[event_mask][:, None]              # (n_events, 1)
        risk_i = risk[event_mask][:, None]
        # Pair against ALL subjects via broadcast.
        permissible_mat = t[None, :] > t_i        # j outlasted event i
        concordant_mat = (risk_i > risk[None, :]) & permissible_mat
        tie_mat        = (risk_i == risk[None, :]) & permissible_mat
        permissible = float(permissible_mat.sum())
        concordant  = float(concordant_mat.sum()) + 0.5 * float(tie_mat.sum())
        c_index = concordant / permissible if permissible else None

    return {"summary": {
        "method": "cox_ph",
        "n": int(n),
        "n_events": int(e.sum()),
        "n_censored": int((1 - e).sum()),
        "log_partial_likelihood": float(-res.fun),
        "coefficients": coefs,
        "c_index": float(c_index) if c_index is not None else None,
        "c_index_interpretation": (
            None if c_index is None else
            "excellent" if c_index >= 0.8 else
            "good" if c_index >= 0.7 else
            "fair" if c_index >= 0.6 else "poor"),
    }}


def crow_amsaa(df: pd.DataFrame, time_col: str,
               failure_col: str | None = None) -> dict:
    """Crow-AMSAA / Duane reliability-growth model.

    Failure intensity is a power function of cumulative test time:
        λ(t) = λ · β · t^(β−1)
    Cumulative failures N(t) = λ · t^β.

    β < 1 : reliability improving (good)
    β = 1 : constant failure rate (HPP)
    β > 1 : reliability worsening (investigate)

    Input: a `time_col` of cumulative test time at each failure event. If
    `failure_col` is supplied (1 = event, 0 = censor), censored rows are
    used only to mark the end of the observation window.
    """
    sub = df[[time_col] + ([failure_col] if failure_col else [])].dropna()
    if failure_col:
        events = sub[sub[failure_col].astype(int) == 1][time_col].astype(float).to_numpy()
        T = float(sub[time_col].astype(float).max())
    else:
        events = sub[time_col].astype(float).to_numpy()
        T = float(events.max()) if events.size else 0.0
    n = events.size
    if n < 3:
        raise ValueError("crow_amsaa needs ≥ 3 failure times")
    events = np.sort(events)
    # Crow's MLE: β = n / Σ ln(T / t_i); λ = n / T^β
    beta = n / np.sum(np.log(T / events))
    lam = n / (T ** beta)
    # MTBF at end of test = 1 / λ_inst(T)
    lam_inst_T = lam * beta * (T ** (beta - 1))
    mtbf_final = 1 / lam_inst_T if lam_inst_T > 0 else float("inf")
    # Interpretation
    verdict = ("improving (β < 1) — reliability growth program is working"
               if beta < 0.95 else
               "stable (β ≈ 1) — no growth yet, HPP-like"
               if beta < 1.05 else
               "worsening (β > 1) — investigate failure modes")
    return {"summary": {"method": "crow_amsaa",
                        "n_failures": int(n),
                        "test_duration": T,
                        "beta": float(beta),
                        "lambda": float(lam),
                        "instantaneous_lambda_at_T": float(lam_inst_T),
                        "instantaneous_MTBF_at_T": float(mtbf_final),
                        "verdict": verdict}}


def eyring(df: pd.DataFrame, time_col: str, stress_col: str,
           stress_type: str = "temperature",
           censor_col: str | None = None,
           use_stress: float | None = None) -> dict:
    """Eyring acceleration model — generalises Arrhenius with a stress-
    dependent prefactor. Standard for thermo-chemical degradation.

        ln(t) = -ln(A) − ln(stress) + Ea / (k·T)

    For non-temperature stress (current, RH), interpret stress_col as the
    applied stress level. use_stress (optional) reports the predicted
    median life at that single stress.
    """
    sub = df[[time_col, stress_col] + ([censor_col] if censor_col else [])].dropna()
    if len(sub) < 4:
        raise ValueError("eyring needs ≥ 4 data points")
    t = sub[time_col].astype(float).to_numpy()
    s = sub[stress_col].astype(float).to_numpy()
    if (t <= 0).any() or (s <= 0).any():
        raise ValueError("eyring: time and stress must be > 0")
    # Linearise: ln(t·stress) = a + b · (1/stress)  →  b = Ea/k
    y = np.log(t * s)
    x = 1.0 / s
    slope, intercept, r, p, se = sps.linregress(x, y)
    Ea_over_k = float(slope)
    # Predict median life at use_stress
    pred = None
    if use_stress is not None and use_stress > 0:
        pred = float(np.exp(intercept + slope / use_stress) / use_stress)
    return {"summary": {"method": "eyring",
                        "stress_type": stress_type,
                        "n": int(len(sub)),
                        "Ea_over_k_kelvin": Ea_over_k,
                        "intercept": float(intercept),
                        "r_squared": float(r ** 2),
                        "p_slope": float(p),
                        "predicted_life_at_use_stress": pred}}


def inverse_power_law(df: pd.DataFrame, time_col: str, stress_col: str,
                      censor_col: str | None = None,
                      use_stress: float | None = None) -> dict:
    """Inverse Power Law — life inversely proportional to stress raised to
    a power. Standard for voltage / mechanical / vibration accelerated tests.

        t = K · stress^(-n)   →   ln(t) = ln(K) − n · ln(stress)
    """
    sub = df[[time_col, stress_col] + ([censor_col] if censor_col else [])].dropna()
    if len(sub) < 4:
        raise ValueError("inverse_power_law needs ≥ 4 points")
    t = sub[time_col].astype(float).to_numpy()
    s = sub[stress_col].astype(float).to_numpy()
    if (t <= 0).any() or (s <= 0).any():
        raise ValueError("inverse_power_law: time and stress must be > 0")
    y = np.log(t); x = np.log(s)
    slope, intercept, r, p, se = sps.linregress(x, y)
    n = -float(slope)     # IPL exponent
    K = float(np.exp(intercept))
    pred = None
    if use_stress is not None and use_stress > 0:
        pred = float(K * (use_stress ** -n))
    return {"summary": {"method": "inverse_power_law",
                        "n_points": int(len(sub)),
                        "ipl_exponent_n": n,
                        "K": K,
                        "r_squared": float(r ** 2),
                        "p_slope": float(p),
                        "predicted_life_at_use_stress": pred}}


def stress_strength(stress_mean: float, stress_sd: float,
                    strength_mean: float, strength_sd: float) -> dict:
    """P(strength > stress) for two normal populations. The standard
    reliability-by-design calc when both load and capacity are known
    distributions.

    z = (μ_strength − μ_stress) / sqrt(σ_strength² + σ_stress²)
    Reliability = Φ(z).
    """
    if stress_sd <= 0 or strength_sd <= 0:
        raise ValueError("stress_strength: standard deviations must be > 0")
    z = (strength_mean - stress_mean) / np.sqrt(strength_sd ** 2 + stress_sd ** 2)
    rel = float(sps.norm.cdf(z))
    return {"summary": {"method": "stress_strength",
                        "stress_mean": stress_mean,
                        "stress_sd": stress_sd,
                        "strength_mean": strength_mean,
                        "strength_sd": strength_sd,
                        "z_safety_index": float(z),
                        "reliability": rel,
                        "failure_probability": 1 - rel,
                        "interpretation": (
                            "highly reliable (R > 0.9999)" if rel > 0.9999
                            else "reliable (R > 0.999)"   if rel > 0.999
                            else "marginal (R > 0.99)"     if rel > 0.99
                            else "unreliable (R < 0.99) — increase safety margin")}}
