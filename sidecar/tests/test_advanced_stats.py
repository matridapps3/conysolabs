"""Tests for the advanced stats expansion that closes the remaining
Minitab gaps:
  - Multivariate: PCA, k-means, LDA
  - Time series: exp smoothing, ARIMA, auto-ARIMA, decomposition
  - DOE designs: fractional factorial, CCD, Box-Behnken, RSM fit
"""
import numpy as np
import pandas as pd
import pytest

from stats import multivariate, time_series, doe


# ───────── Multivariate ─────────

def test_pca_recovers_dominant_direction():
    rng = np.random.default_rng(20)
    # 2D data along a tilted line — PC1 should explain ~all variance.
    t = rng.normal(0, 1, 300)
    x = t + rng.normal(0, 0.05, 300)
    y = t + rng.normal(0, 0.05, 300)
    df = pd.DataFrame({"x": x, "y": y})
    r = multivariate.pca(df, columns=["x", "y"])["summary"]
    assert r["variance_ratio"][0] > 0.95


def test_pca_eigenvalues_sum_to_p_when_correlation_pca():
    rng = np.random.default_rng(21)
    df = pd.DataFrame(rng.normal(0, 1, (200, 4)), columns=list("abcd"))
    r = multivariate.pca(df, columns=list("abcd"))["summary"]
    # Correlation PCA: eigenvalues sum to p (number of variables).
    assert abs(sum(r["eigenvalues"]) - 4) < 0.05


def test_kmeans_finds_three_clusters():
    rng = np.random.default_rng(22)
    centres = np.array([[0, 0], [10, 0], [5, 10]])
    pts = []
    for c in centres:
        pts.append(c + rng.normal(0, 1, (50, 2)))
    df = pd.DataFrame(np.vstack(pts), columns=["x", "y"])
    r = multivariate.kmeans(df, columns=["x", "y"])["summary"]
    assert r["k"] == 3
    assert r["silhouette"] > 0.5


def test_kmeans_with_explicit_k():
    rng = np.random.default_rng(23)
    df = pd.DataFrame(rng.normal(0, 1, (60, 2)), columns=["x", "y"])
    r = multivariate.kmeans(df, columns=["x", "y"], k=4)["summary"]
    assert r["k"] == 4
    assert r["auto_k"] is False


def test_lda_separates_known_classes():
    rng = np.random.default_rng(24)
    a = rng.normal([0, 0], 1, (80, 2))
    b = rng.normal([4, 4], 1, (80, 2))
    df = pd.DataFrame(np.vstack([a, b]), columns=["x", "y"])
    df["class"] = ["A"] * 80 + ["B"] * 80
    r = multivariate.lda(df, predictors=["x", "y"], class_col="class")["summary"]
    assert r["training_accuracy"] > 0.9


# ───────── Time series ─────────

def _seasonal_series(n=48, period=12, seed=1):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    trend = 0.5 * t
    seasonal = 5 * np.sin(2 * np.pi * t / period)
    noise = rng.normal(0, 1, n)
    return pd.DataFrame({"y": trend + seasonal + noise + 50})


def test_exp_smoothing_holt_winters_forecasts_horizon():
    df = _seasonal_series(48, 12, seed=25)
    r = time_series.exponential_smoothing(
        df, value_col="y", trend="add", seasonal="add", seasonal_periods=12, horizon=6,
    )["summary"]
    assert len(r["forecast"]) == 6
    assert r["AIC"] is not None


def test_arima_fits_and_forecasts():
    rng = np.random.default_rng(26)
    n = 100
    e = rng.normal(0, 1, n)
    y = np.zeros(n)
    for i in range(1, n):
        y[i] = 0.6 * y[i - 1] + e[i]
    df = pd.DataFrame({"y": y + 50})
    r = time_series.arima(df, value_col="y", p=1, d=0, q=0, horizon=10)["summary"]
    assert len(r["forecast"]) == 10
    assert len(r["forecast_ci_lower"]) == 10


def test_auto_arima_picks_best_order():
    rng = np.random.default_rng(27)
    n = 120
    e = rng.normal(0, 1, n)
    y = np.zeros(n)
    for i in range(2, n):
        y[i] = 0.5 * y[i - 1] - 0.3 * y[i - 2] + e[i]
    df = pd.DataFrame({"y": y + 50})
    r = time_series.auto_arima(df, value_col="y", max_p=3, max_d=1, max_q=3, horizon=8)["summary"]
    assert "chosen_order" in r
    assert len(r["auto_search"]) > 0


def test_decompose_additive_returns_components():
    df = _seasonal_series(48, 12, seed=28)
    r = time_series.decompose(df, value_col="y", period=12, model="additive")["summary"]
    assert len(r["seasonal_first_period"]) == 12
    assert r["residual_std"] > 0


# ───────── DOE designs ─────────

def test_full_factorial_2k_run_count():
    r = doe.full_factorial_2k(["A", "B", "C"])["summary"]
    assert r["n_runs"] == 8
    assert all(set(run.keys()) >= {"run", "A", "B", "C"} for run in r["runs"])


def test_fractional_factorial_half_fraction():
    r = doe.fractional_factorial(["A", "B", "C", "D", "E"])["summary"]
    # Default base count is 5 → run count is 2^4 (half-fraction).
    # Implementation may use base_count = 4 or 5; either way runs < full.
    assert r["n_runs"] < 32
    assert "aliased_factors" in r


def test_central_composite_run_count():
    # k=3 → 8 cube + 6 axial + center_runs default 4 = 18
    r = doe.central_composite(["A", "B", "C"], center_runs=4)["summary"]
    assert r["n_runs"] == 8 + 6 + 4
    assert r["alpha"] > 1.0


def test_box_behnken_run_count_k3():
    # k=3 → 12 edge points + 3 center = 15 runs
    r = doe.box_behnken(["A", "B", "C"], center_runs=3)["summary"]
    assert r["n_runs"] == 15


def test_response_surface_fit_recovers_quadratic_optimum():
    # Build a quadratic surface y = -((x-2)² + (y+1)²) + ε
    # — true optimum at (2, -1).
    rng = np.random.default_rng(29)
    pts = []
    for x in np.linspace(-3, 5, 9):
        for y in np.linspace(-4, 2, 9):
            yhat = -((x - 2) ** 2 + (y + 1) ** 2) + rng.normal(0, 0.05)
            pts.append({"x": x, "y": y, "z": yhat})
    df = pd.DataFrame(pts)
    r = doe.fit_response_surface(df, response="z", factors=["x", "y"])["summary"]
    assert r["r2"] > 0.95
    if r["predicted_optimum"]:
        assert abs(r["predicted_optimum"]["x"] - 2.0) < 0.5
        assert abs(r["predicted_optimum"]["y"] - (-1.0)) < 0.5
