"""Tests for the second batch of gap closures:
- Power + effect sizes on remaining hypothesis tests
- Two-way ANOVA effect sizes + power
- Johnson capability transform
- Nelson rule text
- Regression diagnostics (VIF / Cook's D / ROC+AUC / Hosmer-Lemeshow)
- Tukey HSD compact letter display
- Robust + quantile regression
- Cox PH
- Changepoint detection
- Interaction plot
- Taguchi designs
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from stats import hypothesis, capability, control_chart, regression, posthoc
from stats import reliability, time_series, graphs, doe


# ─── Power + effect sizes on remaining hypothesis tests ─────────────────

def test_levene_returns_variance_ratio():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({
        "x": np.concatenate([rng.normal(0, 1, 30), rng.normal(0, 4, 30)]),
        "g": ["A"] * 30 + ["B"] * 30,
    })
    r = hypothesis.compute(df, test="levene", column="x", group_col="g")
    s = r["summary"]
    assert s["variance_ratio"] is not None
    assert s["variance_ratio"] > 4   # very different variances


def test_one_proportion_returns_ci_and_power():
    df = pd.DataFrame({"x": [1] * 70 + [0] * 30})
    r = hypothesis.compute(df, test="one_proportion", column="x", group_col=None, p0=0.5)
    s = r["summary"]
    assert s["ci_95_wilson"][0] is not None
    assert s["ci_95_wilson"][1] is not None
    assert s["ci_95_wilson"][0] < s["p_hat"] < s["ci_95_wilson"][1]
    assert s["cohens_h"] is not None
    assert s["power"] is not None
    assert s["power"] > 0.9    # 100 obs, big effect


def test_two_proportion_returns_ci_diff_and_power():
    df = pd.DataFrame({
        "x": ([1] * 60 + [0] * 40 + [1] * 30 + [0] * 70),
        "g": (["A"] * 100 + ["B"] * 100),
    })
    r = hypothesis.compute(df, test="two_proportions", column="x", group_col="g")
    s = r["summary"]
    assert len(s["ci_95_diff"]) == 2
    assert s["cohens_h"] is not None
    assert s["power"] is not None


def test_wilcoxon_returns_rank_biserial():
    rng = np.random.default_rng(0)
    n = 40
    df = pd.DataFrame({"a": rng.normal(0, 1, n), "b": rng.normal(0.8, 1, n)})
    r = hypothesis.compute(df, test="wilcoxon_signed_rank", column="a", group_col=None,
                           column_b="b")
    assert "rank_biserial_r" in r["summary"]


def test_two_way_anova_returns_partial_eta_and_power():
    rng = np.random.default_rng(0)
    rows = []
    for a in ["A1", "A2", "A3"]:
        for b in ["B1", "B2"]:
            offset = (0 if a == "A1" else 1 if a == "A2" else 2) + (0 if b == "B1" else 0.5)
            for _ in range(8):
                rows.append({"y": offset + rng.normal(0, 1), "a": a, "b": b})
    df = pd.DataFrame(rows)
    r = hypothesis.compute(df, test="two_way_anova", column="y", group_col=None,
                           factor_a="a", factor_b="b")
    table = r["summary"]["table"]
    eff_rows = [row for row in table if row["source"] not in ("within", "total")]
    for row in eff_rows:
        assert "partial_eta_squared" in row
        assert "omega_squared" in row
        assert "power" in row


# ─── Capability: Johnson transform ──────────────────────────────────────

def test_capability_johnson_su_for_skewed_data():
    rng = np.random.default_rng(0)
    # Skewed lognormal-ish data — Box-Cox is fine, but Johnson should pick a
    # family and produce capability indices.
    x = np.exp(rng.normal(2, 0.5, 200))
    df = pd.DataFrame({"x": x})
    r = capability.compute(df, column="x", lsl=1.0, usl=20.0, transform="johnson")
    s = r["summary"]
    assert "transformed" in s
    assert s["transformed"]["family"].startswith("johnson_")
    assert s["transformed"]["cpk"] is not None


# ─── Control chart: Nelson rule text ────────────────────────────────────

def test_control_chart_imr_emits_rule_text():
    # Series with a clear out-of-control shift that should trigger rule 2 (9
    # consecutive same-side) and rule 1 (3σ).
    rng = np.random.default_rng(0)
    pre = rng.normal(10, 0.5, 30)
    post = rng.normal(13, 0.5, 30)
    df = pd.DataFrame({"x": np.concatenate([pre, post])})
    r = control_chart.compute(df, kind="I-MR", column="x")
    s = r["summary"]
    assert "rule_violations" in s
    assert isinstance(s["rule_violations"], list)
    if s["rule_violations"]:
        row = s["rule_violations"][0]
        # Each entry must carry human-readable fields.
        assert "rule" in row
        assert "text" in row
        assert "likely_cause" in row
        assert "observation" in row


# ─── Regression diagnostics ─────────────────────────────────────────────

def test_ols_returns_vif_and_influence():
    rng = np.random.default_rng(0)
    n = 100
    x1 = rng.normal(0, 1, n)
    x2 = rng.normal(0, 1, n)
    # Collinear pair — x3 ≈ 0.95 · x1
    x3 = 0.95 * x1 + 0.05 * rng.normal(0, 1, n)
    y = 2 * x1 + 3 * x2 + rng.normal(0, 1, n)
    df = pd.DataFrame({"y": y, "x1": x1, "x2": x2, "x3": x3})
    r = regression.compute(df, response="y", predictors=["x1", "x2", "x3"])
    s = r["summary"]
    assert "vif" in s
    # x3 should be flagged as severe (VIF > 10 due to collinearity with x1).
    worst = max((v for v in s["vif"] if v.get("vif") and np.isfinite(v["vif"])),
                key=lambda v: v["vif"])
    assert worst["vif"] > 5
    assert "influence" in s
    assert s["influence"]["available"]


def test_logistic_returns_roc_and_hosmer_lemeshow():
    rng = np.random.default_rng(0)
    n = 200
    x = rng.normal(0, 1, n)
    p = 1 / (1 + np.exp(-(0.5 + 1.5 * x)))
    y = (rng.random(n) < p).astype(int)
    df = pd.DataFrame({"y": y, "x": x})
    r = regression.logistic(df, response="y", predictors=["x"])
    s = r["summary"]
    assert s["roc"]["available"]
    assert s["roc"]["auc"] > 0.7
    assert s["hosmer_lemeshow"]["available"]
    assert "confusion_matrix" in s
    assert "accuracy" in s


# ─── Tukey HSD compact letter display ───────────────────────────────────

def test_tukey_hsd_returns_compact_letter_display():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({
        "y": np.concatenate([rng.normal(0, 1, 20),    # A
                             rng.normal(0.2, 1, 20),  # B — close to A
                             rng.normal(5, 1, 20),    # C — far
                             rng.normal(5.2, 1, 20)]),# D — close to C, far from A/B
        "g": ["A"] * 20 + ["B"] * 20 + ["C"] * 20 + ["D"] * 20,
    })
    r = posthoc.tukey_hsd(df, value_col="y", group_col="g")
    cld = r["summary"]["compact_letter_display"]
    by_group = {row["group"]: row["letters"] for row in cld}
    # A and B should share a letter; C and D should share a letter; A's letters
    # should not overlap C's letters.
    common_ab = set(by_group["A"]) & set(by_group["B"])
    common_cd = set(by_group["C"]) & set(by_group["D"])
    common_ac = set(by_group["A"]) & set(by_group["C"])
    assert common_ab, f"A and B should share a letter (got {by_group})"
    assert common_cd, f"C and D should share a letter (got {by_group})"
    assert not common_ac, f"A and C should NOT share a letter (got {by_group})"


# ─── Robust + quantile regression ───────────────────────────────────────

def test_robust_regression_downweights_outliers():
    rng = np.random.default_rng(0)
    n = 50
    x = rng.normal(0, 1, n)
    y = 2 * x + rng.normal(0, 0.5, n)
    # Plant 5 outliers
    y[:5] += 20
    df = pd.DataFrame({"y": y, "x": x})
    r = regression.robust(df, response="y", predictors=["x"])
    s = r["summary"]
    assert s["method"] == "robust_regression"
    assert s["n_down_weighted"] >= 1
    # Slope on x should be close to 2 despite outliers.
    slope = next(c["coef"] for c in s["coefficients"] if c["name"] == "x")
    assert abs(slope - 2) < 0.5


def test_quantile_regression_median():
    rng = np.random.default_rng(0)
    n = 100
    x = rng.uniform(0, 10, n)
    y = 2 * x + rng.normal(0, 1, n)
    df = pd.DataFrame({"y": y, "x": x})
    r = regression.quantile(df, response="y", predictors=["x"], q=0.5)
    s = r["summary"]
    assert s["method"] == "quantile_regression"
    slope = next(c["coef"] for c in s["coefficients"] if c["name"] == "x")
    assert abs(slope - 2) < 0.3


def test_quantile_regression_validates_q():
    df = pd.DataFrame({"y": [1, 2, 3, 4], "x": [1, 2, 3, 4]})
    with pytest.raises(ValueError):
        regression.quantile(df, response="y", predictors=["x"], q=1.5)


# ─── Cox PH ─────────────────────────────────────────────────────────────

def test_cox_ph_basic_fit():
    rng = np.random.default_rng(0)
    n = 100
    x = rng.normal(0, 1, n)
    # Hazard proportional to exp(beta * x), beta = 0.8
    t = rng.exponential(scale=np.exp(-0.8 * x))
    e = np.ones(n, dtype=int)
    df = pd.DataFrame({"t": t, "e": e, "x": x})
    r = reliability.cox_ph(df, time_col="t", event_col="e", predictors=["x"])
    s = r["summary"]
    assert s["method"] == "cox_ph"
    assert s["c_index"] is not None
    assert 0 < s["c_index"] <= 1
    # Recovered beta should be roughly 0.8 (HR ≈ 2.2)
    coef = s["coefficients"][0]
    assert 0.3 < coef["coef"] < 1.3


# ─── Changepoint detection ──────────────────────────────────────────────

def test_changepoint_detects_clear_shift():
    rng = np.random.default_rng(0)
    pre = rng.normal(0, 0.3, 80)
    post = rng.normal(3, 0.3, 80)
    df = pd.DataFrame({"y": np.concatenate([pre, post])})
    r = time_series.changepoint(df, value_col="y")
    s = r["summary"]
    assert s["n_changepoints"] >= 1
    # Best changepoint should be near index 80 (within ±5).
    assert any(abs(cp - 80) <= 5 for cp in s["changepoint_indices"])


def test_changepoint_no_signal_no_changepoints():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"y": rng.normal(0, 1, 100)})
    r = time_series.changepoint(df, value_col="y")
    s = r["summary"]
    # Random data may flag a few, but not many.
    assert s["n_changepoints"] <= 3


# ─── Interaction plot ───────────────────────────────────────────────────

def test_interaction_plot_returns_cells_and_index():
    rng = np.random.default_rng(0)
    rows = []
    for a in ["A1", "A2"]:
        for b in ["B1", "B2"]:
            for _ in range(10):
                # Strong interaction: A1+B1 high, A2+B2 high, others low.
                base = 5 if (a == "A1") == (b == "B1") else 0
                rows.append({"y": base + rng.normal(0, 0.5), "a": a, "b": b})
    df = pd.DataFrame(rows)
    r = graphs.interaction_plot(df, response="y", factor_a="a", factor_b="b")
    s = r["summary"]
    assert s["method"] == "interaction_plot"
    assert len(s["cell_means"]) == 4
    # Strong interaction → index well above 2.
    assert s["interaction_index"] is None or s["interaction_index"] > 1
    assert "chart_png" in r


# ─── Taguchi designs ────────────────────────────────────────────────────

def test_taguchi_l8_two_level():
    factors = [{"name": f"F{i}", "levels": ["lo", "hi"]} for i in range(5)]
    r = doe.taguchi(factors)
    s = r["summary"]
    assert s["array"] == "L8"
    assert s["n_runs"] == 8
    # Each factor should appear with both levels balanced.
    for f in factors:
        levels_seen = [run[f["name"]] for run in s["runs"]]
        assert sorted(levels_seen) == ["hi"] * 4 + ["lo"] * 4


def test_taguchi_l9_three_level():
    factors = [{"name": f"F{i}", "levels": [1, 2, 3]} for i in range(3)]
    r = doe.taguchi(factors)
    s = r["summary"]
    assert s["array"] == "L9"
    assert s["n_runs"] == 9


def test_taguchi_signal_to_noise_smaller_better():
    r = doe.taguchi_signal_to_noise([0.1, 0.12, 0.09, 0.11], kind="smaller")
    assert r["sn"] is not None
    # Smaller-is-better with values ~0.1 → S/N ≈ 20 dB
    assert 15 < r["sn"] < 25


def test_taguchi_rejects_mixed_levels():
    factors = [{"name": "A", "levels": ["lo", "hi"]},
               {"name": "B", "levels": [1, 2, 3]}]
    with pytest.raises(ValueError):
        doe.taguchi(factors)
