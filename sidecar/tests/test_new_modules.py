"""Tests for the four new Bench-only analysis modules + power/effect-size
additions to hypothesis tests + the wrangle.transform engine.

Each test covers happy path + at least one edge case so regressions show up
immediately.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from stats import agreement
from stats import bootstrap
from stats import correlation
from stats import gage_linearity
from stats import hypothesis
from wrangle import transform


# ─── Agreement ─────────────────────────────────────────────────────────

def test_agreement_two_appraisers_perfect():
    """Two appraisers agree on every part — kappa = 1.0."""
    df = pd.DataFrame([
        {"app": "A", "part": p, "rating": "P", "trial": 1} for p in range(10)
    ] + [
        {"app": "B", "part": p, "rating": "P", "trial": 1} for p in range(10)
    ])
    r = agreement.compute(df, appraiser_col="app", part_col="part",
                          rating_col="rating", trial_col="trial")
    assert r["summary"]["kappa"]["kind"] == "cohen"
    assert r["summary"]["kappa"]["kappa"] == pytest.approx(1.0) or \
           r["summary"]["kappa"]["kappa"] is None  # all-same-cat edge


def test_agreement_disagreement_drops_kappa():
    df = pd.DataFrame([
        {"app": "A", "part": 0, "rating": "P"}, {"app": "B", "part": 0, "rating": "F"},
        {"app": "A", "part": 1, "rating": "F"}, {"app": "B", "part": 1, "rating": "P"},
        {"app": "A", "part": 2, "rating": "P"}, {"app": "B", "part": 2, "rating": "P"},
        {"app": "A", "part": 3, "rating": "F"}, {"app": "B", "part": 3, "rating": "F"},
    ])
    r = agreement.compute(df, appraiser_col="app", part_col="part",
                          rating_col="rating")
    k = r["summary"]["kappa"]["kappa"]
    assert k is not None
    assert k < 0.5   # moderate disagreement


def test_agreement_three_appraisers_uses_fleiss():
    df = pd.DataFrame([
        {"app": a, "part": p, "rating": "P"}
        for a in ["A", "B", "C"] for p in range(6)
    ])
    r = agreement.compute(df, appraiser_col="app", part_col="part",
                          rating_col="rating")
    assert r["summary"]["kappa"]["kind"] == "fleiss"


def test_agreement_vs_standard():
    df = pd.DataFrame([
        {"app": "A", "part": 0, "rating": "P", "std": "P"},
        {"app": "A", "part": 1, "rating": "F", "std": "P"},  # wrong
        {"app": "A", "part": 2, "rating": "P", "std": "P"},
    ])
    r = agreement.compute(df, appraiser_col="app", part_col="part",
                          rating_col="rating", standard_col="std")
    assert "vs_standard" in r["summary"]
    assert r["summary"]["vs_standard"]["A"]["matched"] == 2
    assert r["summary"]["vs_standard"]["A"]["total"] == 3


# ─── Bootstrap ─────────────────────────────────────────────────────────

def test_bootstrap_mean_ci_brackets_true_mean():
    rng = np.random.default_rng(42)
    df = pd.DataFrame({"x": rng.normal(50, 10, 200)})
    r = bootstrap.compute(df, column="x", statistic="mean", n_boot=2000, seed=1)
    s = r["summary"]
    assert s["ci_low"] < s["theta_hat"] < s["ci_high"]
    assert abs(s["theta_hat"] - 50) < 2  # within 2 of true mean


def test_bootstrap_median_works():
    df = pd.DataFrame({"x": [1, 2, 3, 4, 5, 100]})  # outlier; mean ≠ median
    r = bootstrap.compute(df, column="x", statistic="median", n_boot=1000, seed=1)
    assert 3 <= r["summary"]["theta_hat"] <= 4  # median should be ~3.5


def test_bootstrap_unknown_statistic_raises():
    df = pd.DataFrame({"x": [1, 2, 3]})
    with pytest.raises(ValueError):
        bootstrap.compute(df, column="x", statistic="not_a_stat")


def test_bootstrap_group_mode():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({
        "x": np.concatenate([rng.normal(0, 1, 50), rng.normal(2, 1, 50)]),
        "g": ["A"] * 50 + ["B"] * 50,
    })
    r = bootstrap.compute(df, column="x", statistic="mean",
                          group_col="g", n_boot=500, seed=1)
    assert "groups" in r["summary"]
    assert set(r["summary"]["groups"].keys()) == {"A", "B"}


# ─── Correlation ───────────────────────────────────────────────────────

def test_correlation_perfect_collinearity_flagged():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [2, 4, 6, 8, 10]})
    r = correlation.compute(df, method="pearson", min_r=0.5)
    s = r["summary"]
    assert s["r"][0][1] == pytest.approx(1.0)
    assert any(p["x"] == "a" and p["y"] == "b" for p in s["multicollinearity"])


def test_correlation_independent_columns():
    rng = np.random.default_rng(42)
    df = pd.DataFrame({"a": rng.normal(0, 1, 500), "b": rng.normal(0, 1, 500)})
    r = correlation.compute(df)
    s = r["summary"]
    assert abs(s["r"][0][1]) < 0.2  # near-zero correlation
    assert len(s["multicollinearity"]) == 0


def test_correlation_requires_two_columns():
    df = pd.DataFrame({"a": [1, 2, 3]})
    with pytest.raises(ValueError):
        correlation.compute(df)


def test_correlation_spearman_handles_monotonic():
    # Strictly monotone but non-linear — Spearman should be 1, Pearson < 1.
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [1, 4, 9, 16, 25]})
    rp = correlation.compute(df, method="pearson")["summary"]["r"][0][1]
    rs = correlation.compute(df, method="spearman")["summary"]["r"][0][1]
    assert rs == pytest.approx(1.0)
    assert rp < rs


# ─── Gage Linearity & Bias ─────────────────────────────────────────────

def test_gage_linearity_zero_bias_clean():
    """A gage with zero bias across the range — both verdicts acceptable."""
    rng = np.random.default_rng(0)
    rows = []
    for ref in [1.0, 5.0, 10.0]:
        for _ in range(12):
            rows.append({"part": f"p{ref}", "ref": ref,
                         "meas": ref + rng.normal(0, 0.1)})
    df = pd.DataFrame(rows)
    r = gage_linearity.compute(df, part_col="part", reference_col="ref",
                               measurement_col="meas")
    assert r["summary"]["bias_overall"]["verdict"] == "acceptable"
    assert r["summary"]["linearity"]["verdict"] == "acceptable"


def test_gage_linearity_detects_slope():
    """Bias proportional to reference — must flag significant linearity."""
    rng = np.random.default_rng(0)
    rows = []
    for ref in [1, 5, 10, 15, 20]:
        for _ in range(8):
            # bias grows with reference
            rows.append({"part": f"p{ref}", "ref": ref,
                         "meas": ref + 0.05 * ref + rng.normal(0, 0.05)})
    df = pd.DataFrame(rows)
    r = gage_linearity.compute(df, part_col="part", reference_col="ref",
                               measurement_col="meas")
    assert r["summary"]["linearity"]["p_slope"] < 0.05


def test_gage_linearity_needs_two_refs():
    df = pd.DataFrame({"part": ["a"] * 10, "ref": [1] * 10,
                       "meas": list(range(10))})
    with pytest.raises(ValueError):
        gage_linearity.compute(df, part_col="part", reference_col="ref",
                               measurement_col="meas")


# ─── Hypothesis: power + effect sizes ──────────────────────────────────

def test_one_sample_t_now_returns_power_and_d():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"x": rng.normal(10.5, 1, 50)})
    r = hypothesis.compute(df, test="one_sample_t", column="x", group_col=None,
                           mu0=10.0)
    s = r["summary"]
    assert "power" in s and s["power"] is not None
    assert "cohens_d" in s and s["cohens_d"] is not None
    assert "power_label" in s


def test_two_sample_t_ships_ci_diff_and_power():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({
        "x": np.concatenate([rng.normal(0, 1, 50), rng.normal(0.7, 1, 50)]),
        "g": ["A"] * 50 + ["B"] * 50,
    })
    r = hypothesis.compute(df, test="two_sample_t", column="x", group_col="g")
    s = r["summary"]
    assert "ci_95_diff" in s and len(s["ci_95_diff"]) == 2
    assert "power" in s and s["power"] is not None


def test_anova_returns_omega_squared_and_power():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({
        "x": np.concatenate([rng.normal(0, 1, 30), rng.normal(1, 1, 30), rng.normal(2, 1, 30)]),
        "g": ["A"] * 30 + ["B"] * 30 + ["C"] * 30,
    })
    r = hypothesis.compute(df, test="one_way_anova", column="x", group_col="g")
    s = r["summary"]
    assert s["omega_squared"] is not None
    assert s["power"] is not None
    assert s["power"] > 0.8  # large effect, n=90 → very powerful


def test_chi_square_returns_cramers_v():
    df = pd.DataFrame({
        "x": (["P", "F"] * 50) + (["P"] * 80 + ["F"] * 20),
        "g": (["A"] * 100) + (["B"] * 100),
    })
    r = hypothesis.compute(df, test="chi_square", column="x", group_col="g")
    s = r["summary"]
    assert s["cramers_v"] is not None
    assert 0 <= s["cramers_v"] <= 1


def test_mann_whitney_returns_rank_biserial():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({
        "x": np.concatenate([rng.normal(0, 1, 30), rng.normal(2, 1, 30)]),
        "g": ["A"] * 30 + ["B"] * 30,
    })
    r = hypothesis.compute(df, test="mann_whitney", column="x", group_col="g")
    s = r["summary"]
    assert "rank_biserial_r" in s
    assert abs(s["rank_biserial_r"]) > 0.3  # large effect


# ─── Wrangle.transform ─────────────────────────────────────────────────

def test_transform_compute_creates_column():
    df = pd.DataFrame({"a": [1, 2, 3], "b": [10, 20, 30]})
    out, meta = transform.apply(df, op="compute",
                                params={"new_column": "ab", "expression": "a + b"})
    assert "ab" in out.columns
    assert out["ab"].tolist() == [11, 22, 33]
    assert meta["op"] == "compute"


def test_transform_compute_rejects_unsafe_expression():
    df = pd.DataFrame({"a": [1, 2, 3]})
    with pytest.raises(ValueError):
        transform.apply(df, op="compute",
                        params={"new_column": "x", "expression": "__import__('os')"})


def test_transform_compute_supports_math_funcs():
    df = pd.DataFrame({"a": [1, 2, 4]})
    out, _ = transform.apply(df, op="compute",
                             params={"new_column": "la", "expression": "log(a)"})
    assert out["la"][2] == pytest.approx(np.log(4))


def test_transform_recode_with_mapping():
    df = pd.DataFrame({"grade": ["A", "B", "C", "D"]})
    out, meta = transform.apply(df, op="recode",
                                params={"column": "grade",
                                        "mapping": {"A": 4, "B": 3, "C": 2, "D": 1},
                                        "new_column": "gpa"})
    assert out["gpa"].tolist() == [4, 3, 2, 1]
    assert meta["n_mapped"] == 4


def test_transform_retype_number():
    df = pd.DataFrame({"x": ["1", "2", "not a number", "4"]})
    out, meta = transform.apply(df, op="retype",
                                params={"column": "x", "type": "number"})
    assert out["x"].dtype == float
    assert meta["n_coerced_to_null"] == 1


def test_transform_impute_mean():
    df = pd.DataFrame({"x": [1.0, 2.0, None, 4.0, None]})
    out, meta = transform.apply(df, op="impute",
                                params={"column": "x", "strategy": "mean"})
    assert out["x"].isna().sum() == 0
    assert meta["n_filled"] == 2


def test_transform_filter_keeps_matching():
    df = pd.DataFrame({"x": [1, 2, 3, 4, 5]})
    out, meta = transform.apply(df, op="filter",
                                params={"expression": "x > 2"})
    assert out["x"].tolist() == [3, 4, 5]
    assert meta["n_dropped"] == 2


def test_transform_stack_unpivots():
    df = pd.DataFrame({"id": [1, 2], "q1": [10, 20], "q2": [11, 21]})
    out, meta = transform.apply(df, op="stack",
                                params={"id_vars": ["id"],
                                        "value_vars": ["q1", "q2"]})
    assert len(out) == 4
    assert set(out.columns) == {"id", "variable", "value"}


def test_transform_unstack_pivots():
    df = pd.DataFrame({"id": [1, 1, 2, 2], "q": ["a", "b", "a", "b"],
                       "v": [10, 11, 20, 21]})
    out, meta = transform.apply(df, op="unstack",
                                params={"id_vars": ["id"], "var_col": "q",
                                        "value_col": "v"})
    assert set(out.columns) == {"id", "a", "b"}
    assert len(out) == 2


def test_transform_log_handles_zero():
    df = pd.DataFrame({"x": [0, 1, 10, 100]})
    out, meta = transform.apply(df, op="log",
                                params={"column": "x", "new_column": "lx"})
    assert "lx" in out.columns
    assert meta["shift"] > 0          # should auto-shift to avoid log(0)


def test_transform_standardize_zero_mean_unit_sd():
    df = pd.DataFrame({"x": [1, 2, 3, 4, 5]})
    out, _ = transform.apply(df, op="standardize",
                             params={"column": "x", "new_column": "zx"})
    assert out["zx"].mean() == pytest.approx(0)
    assert out["zx"].std(ddof=1) == pytest.approx(1)


def test_transform_bin_equal_width():
    df = pd.DataFrame({"x": list(range(100))})
    out, meta = transform.apply(df, op="bin",
                                params={"column": "x", "bins": 4,
                                        "strategy": "equal_width"})
    assert "x_bin" in out.columns
    assert out["x_bin"].nunique() == 4


def test_transform_unknown_op_raises():
    df = pd.DataFrame({"x": [1]})
    with pytest.raises(ValueError):
        transform.apply(df, op="not_an_op", params={})
