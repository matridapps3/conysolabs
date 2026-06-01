"""Tests for the competitive-parity batch (closing gaps vs Minitab / JMP):
- Power & sample-size curves (statsmodels noncentral solvers)
- Regularized regression (ridge / lasso / elastic-net)
- Rare-event control charts (G & T)
- D-optimal / I-optimal custom DOE + factorial power
- MANOVA + exploratory factor analysis
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stats import sample_size, regression, control_chart, doe, multivariate as mv


# ───────── Power curves ─────────

def test_power_curve_two_sample_t_matches_gpower():
    # Cohen's d=0.5, α=0.05 two-sided, power 0.80 → 64 per group (G*Power).
    r = sample_size.power_curve(kind="two_sample_t", effect_size=0.5)
    assert r["summary"]["n_required"] == 64
    assert len(r["curve"]["series"]) == 4
    assert r["chart_png"][:4] == b"\x89PNG"
    # Power must increase monotonically with n along the target curve.
    target = next(s for s in r["curve"]["series"] if s["multiplier"] == 1.0)
    p = target["power"]
    assert all(p[i] <= p[i + 1] + 1e-9 for i in range(len(p) - 1))


def test_power_curve_one_sample_from_raw_delta():
    r = sample_size.power_curve(kind="one_sample_t", delta=2.0, sigma=4.0)
    assert r["summary"]["effect_size"] == pytest.approx(0.5, abs=1e-9)
    assert r["summary"]["n_required"] == 34          # G*Power one-sample d=0.5


def test_power_curve_anova_and_proportions():
    ra = sample_size.power_curve(kind="anova", effect_size=0.25, k_groups=4)
    assert ra["summary"]["n_required"] == 45          # 45/group, N≈180
    rp = sample_size.power_curve(kind="two_proportions", p1=0.1, p2=0.2)
    assert 150 < rp["summary"]["n_required"] < 250


def test_power_curve_requires_effect_inputs():
    with pytest.raises(ValueError):
        sample_size.power_curve(kind="two_sample_t")     # no effect_size/delta


# ───────── Regularized regression ─────────

def _collinear_frame(seed=0):
    rs = np.random.RandomState(seed)
    n = 150
    x1 = rs.normal(0, 1, n)
    x2 = x1 + rs.normal(0, 0.1, n)        # collinear with x1
    x3 = rs.normal(0, 1, n)              # irrelevant
    y = 3 * x1 + 0 * x3 + 1.0 + rs.normal(0, 0.5, n)
    return pd.DataFrame({"y": y, "x1": x1, "x2": x2, "x3": x3})


def test_lasso_drives_irrelevant_to_zero():
    # With a moderate explicit penalty, L1 zeroes the collinear/irrelevant
    # terms exactly while keeping the true predictor — the defining behaviour.
    df = _collinear_frame()
    r = regression.regularized(df, "y", ["x1", "x2", "x3"], method="lasso", alpha=0.1)
    s = r["summary"]
    assert s["method"] == "lasso_regression"
    assert s["n_shrunk_to_zero"] >= 1                 # x3 (and usually x2) → exactly 0
    x3 = next(c for c in s["coefficients"] if c["term"] == "x3")
    assert x3["shrunk_to_zero"] is True
    assert s["r2"] > 0.9                              # still explains the variance
    assert r["chart_png"][:4] == b"\x89PNG"


def test_lasso_cv_shrinks_weak_terms():
    # CV-chosen α keeps things but heavily shrinks the irrelevant predictor.
    df = _collinear_frame()
    r = regression.regularized(df, "y", ["x1", "x2", "x3"], method="lasso")
    s = r["summary"]
    assert s["alpha_selected_by_cv"] is not None
    x3 = next(c for c in s["coefficients"] if c["term"] == "x3")
    assert abs(x3["coef"]) < 0.15                     # near-zero even if not exact


def test_ridge_keeps_all_terms_shrinks():
    df = _collinear_frame()
    r = regression.regularized(df, "y", ["x1", "x2", "x3"], method="ridge")
    s = r["summary"]
    assert s["n_nonzero"] == 3                         # ridge shrinks, never zeros
    assert s["alpha_selected_by_cv"] is not None       # CV-chosen


def test_elastic_net_with_explicit_alpha():
    df = _collinear_frame()
    r = regression.regularized(df, "y", ["x1", "x2", "x3"],
                               method="elastic_net", alpha=0.05, l1_ratio=0.5)
    assert r["summary"]["alpha"] == pytest.approx(0.05)
    assert r["summary"]["alpha_selected_by_cv"] is None


# ───────── G & T rare-event charts ─────────

def test_g_chart_geometric_limits():
    df = pd.DataFrame({"between": [50, 62, 48, 55, 71, 60, 58, 53, 66, 49, 57]})
    r = control_chart.compute(df, kind="G", column="between")
    s = r["summary"]
    assert s["kind"] == "G"
    assert s["lcl"] >= 0
    assert s["ucl"] > s["g_bar"] > s["lcl"]            # skewed: UCL far above mean
    assert r["chart_png"][:4] == b"\x89PNG"


def test_t_chart_flags_short_gap():
    # One event arrives far too quickly (5h) among ~120h gaps → below LCL.
    df = pd.DataFrame({"hours": [120, 140, 95, 160, 110, 130, 5, 150, 125, 138]})
    r = control_chart.compute(df, kind="T", column="hours")
    s = r["summary"]
    assert s["kind"] == "T"
    assert 6 in s["violations"]                        # the 5h point (index 6)
    assert s["lcl"] >= 0


def test_t_chart_rejects_nonpositive():
    df = pd.DataFrame({"hours": [10, 20, -1, 30]})
    with pytest.raises(ValueError):
        control_chart.compute(df, kind="T", column="hours")


# ───────── Optimal DOE + power ─────────

def test_d_optimal_full_rank_and_efficient():
    r = doe.optimal_design(["A", "B", "C"], n_runs=10, model="interaction", criterion="D")
    s = r["summary"]
    assert s["design"] == "D-optimal"
    assert len(s["runs"]) == 10
    assert s["d_efficiency"] > 0.5                     # full-rank, decent design
    # All coded values within [-1, 1].
    for run in s["runs"]:
        assert all(-1.0 <= run[f] <= 1.0 for f in ["A", "B", "C"])


def test_i_optimal_not_degenerate():
    # Quadratic in 2 factors needs 6 terms; 9 runs should cover the 3² grid.
    r = doe.optimal_design(["A", "B"], n_runs=9, model="quadratic", criterion="I")
    s = r["summary"]
    pts = {tuple(run[f] for f in ["A", "B"]) for run in s["runs"]}
    assert len(pts) == 9                               # full coverage, not collapsed
    assert s["d_efficiency"] > 0.3
    assert s["i_optimality"] > 0


def test_optimal_rejects_too_few_runs():
    with pytest.raises(ValueError):
        doe.optimal_design(["A", "B"], n_runs=3, model="quadratic")  # 6 terms > 3 runs


def test_factorial_power_increases_with_replication():
    low = doe.factorial_power(n_runs=8, n_factors=3, effect_size=1.0)["summary"]["power"]
    high = doe.factorial_power(n_runs=8, n_factors=3, effect_size=1.0,
                               n_replicates=3)["summary"]["power"]
    assert high > low
    assert 0 <= low <= 1 and 0 <= high <= 1


# ───────── MANOVA + factor analysis ─────────

def test_manova_detects_group_separation():
    rs = np.random.RandomState(3)
    grp = np.repeat(["A", "B", "C"], 25)
    y1 = np.concatenate([rs.normal(0, 1, 25), rs.normal(1.2, 1, 25), rs.normal(0, 1, 25)])
    y2 = np.concatenate([rs.normal(0, 1, 25), rs.normal(0.8, 1, 25), rs.normal(0, 1, 25)])
    df = pd.DataFrame({"y1": y1, "y2": y2, "grp": grp})
    r = mv.manova(df, ["y1", "y2"], "grp")
    s = r["summary"]
    assert s["n_groups"] == 3
    assert "Pillai's trace" in s["tests"]
    assert s["significant"] is True


def test_manova_no_separation_not_significant():
    rs = np.random.RandomState(4)
    grp = np.repeat(["A", "B"], 40)
    df = pd.DataFrame({"y1": rs.normal(0, 1, 80), "y2": rs.normal(0, 1, 80), "grp": grp})
    r = mv.manova(df, ["y1", "y2"], "grp")
    assert r["summary"]["significant"] is False


def test_factor_analysis_recovers_two_factors():
    rs = np.random.RandomState(5)
    f1, f2 = rs.normal(0, 1, 100), rs.normal(0, 1, 100)
    df = pd.DataFrame({
        "v1": f1 + rs.normal(0, .3, 100), "v2": f1 + rs.normal(0, .3, 100),
        "v3": f1 + rs.normal(0, .3, 100), "v4": f2 + rs.normal(0, .3, 100),
        "v5": f2 + rs.normal(0, .3, 100),
    })
    r = mv.factor_analysis(df, ["v1", "v2", "v3", "v4", "v5"])
    s = r["summary"]
    assert s["n_factors"] == 2                         # Kaiser rule recovers 2
    assert s["total_variance_explained"] > 0.7
    assert len(s["loadings"]) == 5
    assert r["chart_png"][:4] == b"\x89PNG"


def test_factor_analysis_needs_two_vars():
    df = pd.DataFrame({"v1": [1.0, 2, 3, 4, 5]})
    with pytest.raises(ValueError):
        mv.factor_analysis(df, ["v1"])


# ───────── Decision-support integration (narrative / followups / preflight) ─────────

def test_narrative_covers_new_kinds():
    from stats import narrative as nv
    assert "odds ratio" in nv.for_kind("mixed_effects", {
        "method": "gee", "link_effect": "odds_ratio",
        "coefficients": [{"name": "x", "coef": 0.66, "p": 0.01, "effect_ratio": 1.95}]})["headline"]
    assert "differ" in nv.for_kind("multivariate", {
        "method": "manova", "significant": True,
        "tests": {"Pillai's trace": {"p_value": 0.002}}})["headline"]
    assert "factor" in nv.for_kind("multivariate", {
        "method": "factor_analysis", "n_factors": 2, "total_variance_explained": 0.9})["headline"].lower()
    assert "out of control" in nv.for_kind("control_chart", {"kind": "I-MR", "violations": [3, 7]})["headline"]
    assert "in control" in nv.for_kind("control_chart", {"kind": "G", "violations": []})["headline"]
    assert "Lasso kept 1 of 3" in nv.for_kind("regression", {
        "method": "lasso_regression", "r2": 0.98, "n_nonzero": 1, "n_predictors": 3, "alpha": 0.1})["headline"]


def test_followups_cover_new_kinds():
    from stats import followups as fu
    gee = [f["label"] for f in fu.for_kind("mixed_effects", {"method": "gee"},
                                           {"fixed": "y ~ x", "group": "s", "family": "binomial"})]
    assert any("GLMM" in l for l in gee)
    manova = fu.for_kind("multivariate", {"method": "manova", "significant": True,
                                          "responses": ["y1", "y2"]}, {"class_col": "g"})
    assert any("ANOVA on y1" in f["label"] for f in manova)
    lasso = fu.for_kind("regression",
                        {"method": "lasso_regression",
                         "coefficients": [{"term": "x1", "shrunk_to_zero": False},
                                          {"term": "x2", "shrunk_to_zero": True}]},
                        {"response": "y", "predictors": ["x1", "x2"]})
    assert any("OLS" in f["label"] for f in lasso)


def test_preflight_covers_new_kinds():
    from stats import preflight as pf
    rs = np.random.RandomState(0)
    few = pd.DataFrame({"y": rs.normal(0, 1, 60), "x": rs.normal(0, 1, 60),
                        "subj": [i % 4 for i in range(60)]})           # only 4 clusters
    r = pf.check(few, kind="mixed_effects", params={"fixed": "y ~ x", "group": "subj"})
    assert r["status"] == "fail"                                       # too few groups
    many = pd.DataFrame({"y": rs.normal(0, 1, 200), "x": rs.normal(0, 1, 200),
                         "subj": [i % 25 for i in range(200)]})        # 25 clusters
    assert pf.check(many, kind="mixed_effects", params={"fixed": "y ~ x", "group": "subj"})["status"] == "ok"
    thin = pd.DataFrame({"a": rs.normal(0, 1, 12), "b": rs.normal(0, 1, 12),
                         "c": rs.normal(0, 1, 12), "g": ["A", "B"] * 6})
    assert pf.check(thin, kind="multivariate",
                    params={"method": "manova", "columns": ["a", "b", "c"], "class_col": "g"})["status"] in ("warn", "fail")


# ───────── NIST StRD validation ─────────

def test_nist_strd_all_pass_high_precision():
    from stats import validation
    r = validation.nist_strd()["summary"]
    assert r["all_passed"] is True
    assert r["n_checks"] >= 9
    # Every check must agree with NIST's certified value to ≥ 6 sig digits;
    # the regression/mean checks should be far tighter.
    assert r["min_sig_digits"] >= 6
    assert r["median_sig_digits"] >= 10
    # Longley is the canonical near-collinear killer — must still be ~10+ digits.
    longley = [c for c in r["checks"] if c["dataset"] == "Longley"]
    assert all(c["sig_digits"] >= 9 for c in longley)


# ───────── GEE + GLMM ─────────

def _clustered_binary(seed=0, n_sub=30, k=6, slope=0.8):
    rs = np.random.RandomState(seed)
    rows = []
    for s in range(n_sub):
        u = rs.normal(0, 1.2)
        for _ in range(k):
            x = rs.normal(0, 1)
            p = 1 / (1 + np.exp(-(-0.3 + slope * x + u)))
            rows.append({"y": int(rs.rand() < p), "x": float(x), "subj": s})
    return pd.DataFrame(rows)


def test_gee_logistic_recovers_positive_effect():
    from stats import mixed_effects as me
    df = _clustered_binary()
    r = me.gee(df, "y ~ x", group="subj", family="binomial", cov_struct="exchangeable")
    s = r["summary"]
    assert s["method"] == "gee" and s["family"] == "binomial"
    xc = next(c for c in s["coefficients"] if c["name"] == "x")
    assert xc["coef"] > 0                       # positive effect detected
    assert xc["effect_ratio"] == pytest.approx(np.exp(xc["coef"]), rel=1e-6)
    assert s["n_groups"] == 30


def test_gee_validates_family_and_cov():
    from stats import mixed_effects as me
    df = _clustered_binary()
    with pytest.raises(ValueError):
        me.gee(df, "y ~ x", group="subj", family="weibull")
    with pytest.raises(ValueError):
        me.gee(df, "y ~ x", group="subj", cov_struct="banana")


def test_glmm_conditional_effect_larger_than_marginal():
    # GLMM (subject-specific) slope should exceed the attenuated GEE (marginal)
    # slope for the same conditional data-generating process.
    from stats import mixed_effects as me
    df = _clustered_binary()
    gee_x = next(c for c in me.gee(df, "y ~ x", group="subj", family="binomial")
                 ["summary"]["coefficients"] if c["name"] == "x")["coef"]
    glmm_r = me.glmm(df, "y ~ x", group="subj", family="binomial")["summary"]
    glmm_x = next(c for c in glmm_r["coefficients"] if c["name"] == "x")["coef"]
    assert glmm_x > gee_x                       # conditional > marginal
    assert glmm_r["method"] == "glmm"
    assert glmm_r["random_intercept_logsd_posterior_mean"] is not None
