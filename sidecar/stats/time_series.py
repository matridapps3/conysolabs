"""Time-series analysis — exponential smoothing, ARIMA, and decomposition.

Built on statsmodels (already a dependency). Closes Minitab's
"Stat → Time Series" menu for the cases BBs actually run:
  - simple/Holt/Holt-Winters exponential smoothing
  - ARIMA(p,d,q) with optional seasonal component
  - Auto-ARIMA via AIC grid search across small p,d,q
  - Classical decomposition (additive or multiplicative)
"""
from __future__ import annotations

import io
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.seasonal import seasonal_decompose


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def _series(df: pd.DataFrame, value_col: str, time_col: str | None) -> pd.Series:
    if time_col and time_col in df.columns:
        sub = df[[time_col, value_col]].dropna().copy()
        sub[time_col] = pd.to_datetime(sub[time_col], errors="coerce")
        sub = sub.dropna(subset=[time_col]).sort_values(time_col)
        return pd.Series(sub[value_col].astype(float).values,
                         index=pd.DatetimeIndex(sub[time_col].values))
    return pd.Series(df[value_col].dropna().astype(float).values)


# ───────── Exponential smoothing ─────────

def exponential_smoothing(df: pd.DataFrame, value_col: str, time_col: str | None = None,
                          trend: str | None = None, seasonal: str | None = None,
                          seasonal_periods: int | None = None,
                          horizon: int = 12) -> dict:
    """Fit Holt / Holt-Winters and forecast.
      trend:    None | 'add' | 'mul'
      seasonal: None | 'add' | 'mul'  (requires seasonal_periods)

    Use 'add' for additive seasonality (constant amplitude), 'mul' for
    multiplicative (amplitude grows with level)."""
    y = _series(df, value_col, time_col)
    if y.size < 8:
        raise ValueError("exp_smoothing: need at least 8 observations")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = ExponentialSmoothing(
            y, trend=trend, seasonal=seasonal,
            seasonal_periods=seasonal_periods,
            initialization_method="estimated",
        ).fit(optimized=True)
    forecast = model.forecast(horizon)

    fig, ax = plt.subplots(figsize=(8.0, 3.5))
    ax.plot(y.index, y.values, label="observed", marker="o", markersize=3)
    ax.plot(model.fittedvalues.index, model.fittedvalues.values, linestyle="--", label="fitted")
    ax.plot(forecast.index, forecast.values, linestyle=":", label="forecast", marker="o", markersize=3)
    ax.set_title(f"Exponential smoothing — {value_col}")
    ax.legend(loc="best")
    return {
        "summary": {
            "method": "exponential_smoothing",
            "trend": trend, "seasonal": seasonal,
            "seasonal_periods": seasonal_periods,
            "horizon": int(horizon),
            "n": int(y.size),
            "AIC": float(model.aic) if hasattr(model, "aic") else None,
            "SSE": float(model.sse) if hasattr(model, "sse") else None,
            "forecast": [float(v) for v in forecast.values],
            "fitted_last_5": [float(v) for v in model.fittedvalues.values[-5:]],
            "params": {k: float(v) for k, v in model.params.items()
                       if isinstance(v, (int, float, np.floating))},
        },
        "chart_png": _png(fig),
    }


# ───────── ARIMA ─────────

def arima(df: pd.DataFrame, value_col: str, time_col: str | None = None,
          p: int = 1, d: int = 0, q: int = 0,
          seasonal_order: tuple | None = None,
          horizon: int = 12) -> dict:
    """ARIMA(p,d,q) (with optional seasonal SARIMA term)."""
    y = _series(df, value_col, time_col)
    if y.size < max(10, p + d + q + 5):
        raise ValueError("arima: not enough observations for the requested order")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = ARIMA(y, order=(p, d, q),
                      seasonal_order=seasonal_order or (0, 0, 0, 0)).fit()
    fc = model.get_forecast(horizon)
    mean = fc.predicted_mean
    ci = fc.conf_int(alpha=0.05)

    fig, ax = plt.subplots(figsize=(8.0, 3.5))
    ax.plot(y.index, y.values, label="observed", marker="o", markersize=3)
    ax.plot(mean.index, mean.values, linestyle=":", label="forecast", marker="o", markersize=3)
    ax.fill_between(mean.index, ci.iloc[:, 0], ci.iloc[:, 1], alpha=0.2, label="95% CI")
    ax.set_title(f"ARIMA({p},{d},{q}) — {value_col}")
    ax.legend(loc="best")
    return {
        "summary": {
            "method": "ARIMA",
            "order": [int(p), int(d), int(q)],
            "seasonal_order": list(seasonal_order) if seasonal_order else None,
            "n": int(y.size),
            "AIC": float(model.aic), "BIC": float(model.bic),
            "log_likelihood": float(model.llf),
            "horizon": int(horizon),
            "forecast": [float(v) for v in mean.values],
            "forecast_ci_lower": [float(v) for v in ci.iloc[:, 0].values],
            "forecast_ci_upper": [float(v) for v in ci.iloc[:, 1].values],
        },
        "chart_png": _png(fig),
    }


def auto_arima(df: pd.DataFrame, value_col: str, time_col: str | None = None,
               max_p: int = 3, max_d: int = 2, max_q: int = 3,
               horizon: int = 12) -> dict:
    """Grid search small (p,d,q) and pick the AIC-best fit. Returns the
    full forecast for the chosen model. Pragmatic — not a full pmdarima
    replacement, but covers the common case where the BB doesn't know
    which order to specify."""
    y = _series(df, value_col, time_col)
    if y.size < 12:
        raise ValueError("auto_arima: need at least 12 observations")
    best = None
    best_aic = float("inf")
    tried = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for d in range(max_d + 1):
            for p in range(max_p + 1):
                for q in range(max_q + 1):
                    if p == 0 and d == 0 and q == 0:
                        continue
                    try:
                        m = ARIMA(y, order=(p, d, q)).fit()
                        aic = float(m.aic)
                        tried.append({"order": [p, d, q], "AIC": aic})
                        if aic < best_aic:
                            best_aic = aic
                            best = (p, d, q, m)
                    except Exception:
                        continue
    if best is None:
        raise RuntimeError("auto_arima: no order converged")
    p, d, q, model = best
    result = arima(df, value_col, time_col, p=p, d=d, q=q, horizon=horizon)
    result["summary"]["auto_search"] = sorted(tried, key=lambda r: r["AIC"])[:10]
    result["summary"]["chosen_order"] = [p, d, q]
    return result


# ───────── Decomposition ─────────

def acf_pacf(df: pd.DataFrame, value_col: str, time_col: str | None = None,
             nlags: int = 20) -> dict:
    """Autocorrelation and partial-autocorrelation functions. Used to
    pick (p,d,q) for ARIMA: ACF tails off → AR; PACF tails off → MA;
    both cut off → ARMA."""
    from statsmodels.tsa.stattools import acf, pacf
    y = _series(df, value_col, time_col)
    if y.size < 8:
        raise ValueError("acf_pacf: need at least 8 observations")
    nlags = min(nlags, y.size // 2 - 1)
    a = acf(y.values, nlags=nlags, fft=False)
    p = pacf(y.values, nlags=nlags, method="yw")
    fig, axes = plt.subplots(2, 1, figsize=(7.5, 5.0))
    axes[0].vlines(range(len(a)), 0, a)
    axes[0].axhline(0, linestyle="-")
    axes[0].axhline(1.96 / np.sqrt(y.size), linestyle="--")
    axes[0].axhline(-1.96 / np.sqrt(y.size), linestyle="--")
    axes[0].set_title("ACF")
    axes[1].vlines(range(len(p)), 0, p)
    axes[1].axhline(0, linestyle="-")
    axes[1].axhline(1.96 / np.sqrt(y.size), linestyle="--")
    axes[1].axhline(-1.96 / np.sqrt(y.size), linestyle="--")
    axes[1].set_title("PACF")
    return {"summary": {"n": int(y.size), "nlags": int(nlags),
                        "acf": a.tolist(), "pacf": p.tolist()},
            "chart_png": _png(fig)}


def cross_correlation(df: pd.DataFrame, x_col: str, y_col: str,
                      time_col: str | None = None, max_lag: int = 20) -> dict:
    """Cross-correlation between two series at lags -max_lag..+max_lag.
    Identifies whether one series leads the other."""
    sub = df[[x_col, y_col] + ([time_col] if time_col else [])].dropna()
    if time_col:
        sub = sub.copy()
        sub[time_col] = pd.to_datetime(sub[time_col], errors="coerce")
        sub = sub.dropna(subset=[time_col]).sort_values(time_col)
    x = sub[x_col].astype(float).to_numpy()
    y = sub[y_col].astype(float).to_numpy()
    n = min(len(x), len(y))
    x = x[:n] - x.mean(); y = y[:n] - y.mean()
    sx, sy = x.std(), y.std()
    if sx == 0 or sy == 0:
        raise ValueError("cross_correlation: zero variance")
    lags = list(range(-max_lag, max_lag + 1))
    corrs = []
    for k in lags:
        if k >= 0:
            r = np.corrcoef(x[:n - k], y[k:])[0, 1]
        else:
            r = np.corrcoef(x[-k:], y[:n + k])[0, 1]
        corrs.append(float(r))
    fig, ax = plt.subplots(figsize=(7.5, 3.5))
    ax.vlines(lags, 0, corrs)
    ax.axhline(0)
    ax.axhline(1.96 / np.sqrt(n), linestyle="--")
    ax.axhline(-1.96 / np.sqrt(n), linestyle="--")
    ax.set_title(f"Cross-correlation: {x_col} vs {y_col}")
    return {"summary": {"n": int(n), "max_lag": int(max_lag),
                        "lags": lags, "correlations": corrs,
                        "lag_at_max_abs": int(lags[int(np.argmax(np.abs(corrs)))])},
            "chart_png": _png(fig)}


def decompose(df: pd.DataFrame, value_col: str, time_col: str | None = None,
              period: int = 12, model: str = "additive") -> dict:
    """Classical decomposition into trend, seasonal, residual."""
    y = _series(df, value_col, time_col)
    if y.size < 2 * period:
        raise ValueError(f"decompose: need at least {2 * period} observations for period={period}")
    if model not in ("additive", "multiplicative"):
        raise ValueError("model must be 'additive' or 'multiplicative'")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = seasonal_decompose(y, model=model, period=period, two_sided=True)
    fig, axes = plt.subplots(4, 1, figsize=(8.0, 7.5), sharex=True)
    axes[0].plot(y.index, y.values); axes[0].set_title("Observed")
    axes[1].plot(result.trend.index, result.trend.values); axes[1].set_title("Trend")
    axes[2].plot(result.seasonal.index, result.seasonal.values); axes[2].set_title("Seasonal")
    axes[3].plot(result.resid.index, result.resid.values, marker="o", linestyle="None", markersize=2)
    axes[3].set_title("Residual")
    return {
        "summary": {
            "method": "classical_decomposition",
            "model": model, "period": int(period),
            "n": int(y.size),
            "trend_last_5": [float(v) if pd.notna(v) else None for v in result.trend.values[-5:]],
            "seasonal_first_period": [float(v) if pd.notna(v) else None for v in result.seasonal.values[:period]],
            "residual_std": float(np.nanstd(result.resid.values, ddof=1)),
        },
        "chart_png": _png(fig),
    }


def changepoint(df: pd.DataFrame, value_col: str, time_col: str | None = None,
                min_segment_len: int = 10, penalty: float | None = None) -> dict:
    """Mean-shift changepoint detection via PELT (Pruned Exact Linear Time).
    Locates the timestamps where the series mean shifted, segmenting into
    constant-mean intervals.

    No external `ruptures` dependency — implements PELT with L2 (mean-shift)
    cost and BIC-like penalty.

    Use cases: "when did the deploy break things?", "did the process control
    chart's drift start at the supplier change?", regime detection.
    """
    y = _series(df, value_col, time_col).astype(float).to_numpy()
    n = len(y)
    if n < 2 * min_segment_len:
        raise ValueError(f"need ≥ {2 * min_segment_len} observations for changepoint detection")
    # Default BIC-style penalty: c·log(n)·σ²
    sigma2 = float(np.var(y, ddof=1))
    if penalty is None:
        penalty = 2.0 * np.log(n) * sigma2

    # Precompute prefix sums for O(1) segment-cost lookup.
    csum = np.concatenate([[0], np.cumsum(y)])
    csum2 = np.concatenate([[0], np.cumsum(y ** 2)])

    def seg_cost(a: int, b: int) -> float:
        """Cost of treating y[a:b] as one mean — sum of squared deviations."""
        m = b - a
        if m < 1:
            return 0.0
        s = csum[b] - csum[a]
        s2 = csum2[b] - csum2[a]
        return float(s2 - s * s / m)

    # F[t] = min cost to segment y[:t]; pred[t] = previous changepoint.
    F = [float("inf")] * (n + 1)
    pred = [0] * (n + 1)
    F[0] = -penalty                    # absorb the +penalty per cut
    R = [0]                            # candidate previous-changepoints

    for t in range(min_segment_len, n + 1):
        best = float("inf"); best_s = 0
        new_R = []
        for s in R:
            # Candidates that don't yet satisfy min_segment_len can't be the
            # best for THIS t — but may be the best for a LATER t, so carry
            # them forward in R rather than dropping them entirely.
            if t - s < min_segment_len:
                new_R.append(s)
                continue
            cost = F[s] + seg_cost(s, t) + penalty
            if cost < best:
                best, best_s = cost, s
            # PELT prune: keep s only if it could still be optimal later.
            if F[s] + seg_cost(s, t) <= best:
                new_R.append(s)
        F[t] = best
        pred[t] = best_s
        new_R.append(t)
        R = new_R

    # Backtrack changepoints
    cps = []
    t = n
    while t > 0:
        s = pred[t]
        if s > 0:
            cps.append(int(s))
        t = s
    cps = sorted(cps)

    # Build segments
    bounds = [0] + cps + [n]
    segments = []
    for i in range(len(bounds) - 1):
        a, b = bounds[i], bounds[i + 1]
        segment_y = y[a:b]
        segments.append({
            "start_index": int(a),
            "end_index": int(b - 1),
            "n": int(b - a),
            "mean": float(segment_y.mean()),
            "std": float(segment_y.std(ddof=1)) if b - a > 1 else 0.0,
        })

    return {"summary": {
        "method": "changepoint_pelt",
        "n": int(n),
        "n_changepoints": int(len(cps)),
        "changepoint_indices": cps,        # 1-indexed in the user's mind, 0-indexed here
        "segments": segments,
        "penalty": float(penalty),
    }}
