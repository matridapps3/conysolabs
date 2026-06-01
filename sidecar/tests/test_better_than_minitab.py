"""Tests for the Minitab-parity-and-beyond additions:
  - new hypothesis tests (Levene, Bartlett, F-test, two-way ANOVA, Fisher's,
    Wilcoxon signed-rank, sign test, Mood's median, Anderson-Darling,
    Ryan-Joiner, KS-normal)
  - CUSUM and MA control charts + Nelson rules 5-8
  - Distribution Identifier
  - Weibull / exponential reliability
  - Capability Box-Cox path + Cpm + Z-bench
  - Power & sample size: ANOVA + regression
"""
import numpy as np
import pandas as pd
import pytest

from stats import hypothesis, control_chart, distribution_id, reliability, sample_size, capability


# ───────── Hypothesis tests ─────────

def _two_groups(n=30, mean_diff=0.0, var_ratio=1.0, seed=1):
    rng = np.random.default_rng(seed)
    a = rng.normal(0, 1, n)
    b = rng.normal(mean_diff, np.sqrt(var_ratio), n)
    return pd.DataFrame({"y": np.concatenate([a, b]),
                         "g": ["A"] * n + ["B"] * n})


def test_levene_equal_variances_not_rejected():
    df = _two_groups(50, mean_diff=0.5, var_ratio=1.0, seed=2)
    r = hypothesis.compute(df, test="levene", column="y", group_col="g")["summary"]
    assert r["p"] > 0.05


def test_levene_unequal_variances_rejected():
    df = _two_groups(80, mean_diff=0.0, var_ratio=10.0, seed=3)
    r = hypothesis.compute(df, test="levene", column="y", group_col="g")["summary"]
    assert r["p"] < 0.05


def test_bartlett_returns_test_stat():
    df = _two_groups(40, var_ratio=4.0, seed=4)
    r = hypothesis.compute(df, test="bartlett", column="y", group_col="g")["summary"]
    assert "T" in r and "p" in r


def test_f_test_variances_two_groups_only():
    df = pd.DataFrame({"y": [1, 2, 3, 4, 5, 6, 7, 8, 9],
                       "g": ["A", "A", "A", "B", "B", "B", "C", "C", "C"]})
    with pytest.raises(ValueError, match="exactly two groups"):
        hypothesis.compute(df, test="f_test_variances", column="y", group_col="g")


def test_two_way_anova_table_has_three_factor_rows():
    rng = np.random.default_rng(5)
    rows = []
    for a in ["lo", "hi"]:
        for b in ["1", "2", "3"]:
            for _ in range(8):
                # Real main effects of a and b but no interaction.
                base = (10 if a == "lo" else 14) + ({"1": 0, "2": 2, "3": 4}[b])
                rows.append({"y": base + rng.normal(0, 1), "fa": a, "fb": b})
    df = pd.DataFrame(rows)
    r = hypothesis.compute(df, test="two_way_anova", column="y",
                           group_col=None, factor_a="fa", factor_b="fb")["summary"]
    sources = [row["source"] for row in r["table"]]
    assert "fa" in sources and "fb" in sources
    assert "within" in sources
    assert "total" in sources
    # fa and fb should be significant.
    p_fa = next(row for row in r["table"] if row["source"] == "fa")["p"]
    p_fb = next(row for row in r["table"] if row["source"] == "fb")["p"]
    assert p_fa < 0.05 and p_fb < 0.05


def test_fisher_exact_2x2():
    df = pd.DataFrame({"outcome": [1, 1, 0, 0, 1, 0, 0, 1, 1, 0],
                       "group":   ["a", "a", "a", "b", "b", "b", "a", "a", "b", "b"]})
    r = hypothesis.compute(df, test="fisher_exact", column="outcome", group_col="group")["summary"]
    assert "odds_ratio" in r and "p" in r


def test_wilcoxon_signed_rank_paired_difference():
    df = pd.DataFrame({"before": [10, 12, 8, 9, 11, 13, 14, 7, 10, 12],
                       "after":  [11, 14, 9, 11, 12, 16, 15, 9, 11, 14]})
    r = hypothesis.compute(df, test="wilcoxon_signed_rank", column="before",
                           group_col=None, column_b="after")["summary"]
    assert "W" in r and "p" in r and r["n"] == 10


def test_sign_test_against_median():
    df = pd.DataFrame({"x": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]})
    r = hypothesis.compute(df, test="sign_test", column="x", group_col=None,
                           median0=3.0)["summary"]
    assert "p" in r and r["n"] >= 5


def test_mood_median_three_groups():
    rng = np.random.default_rng(6)
    df = pd.DataFrame({
        "y": np.concatenate([rng.normal(0, 1, 50), rng.normal(0.2, 1, 50), rng.normal(2, 1, 50)]),
        "g": ["A"] * 50 + ["B"] * 50 + ["C"] * 50,
    })
    r = hypothesis.compute(df, test="mood_median", column="y", group_col="g")["summary"]
    assert "p" in r and r["p"] < 0.05


def test_anderson_darling_normal_data_not_rejected():
    rng = np.random.default_rng(7)
    df = pd.DataFrame({"x": rng.normal(0, 1, 200)})
    r = hypothesis.compute(df, test="anderson_darling_normality",
                           column="x", group_col=None)["summary"]
    assert r["p_approx"] > 0.05


def test_anderson_darling_skewed_data_rejected():
    rng = np.random.default_rng(8)
    df = pd.DataFrame({"x": rng.exponential(1.0, 300)})
    r = hypothesis.compute(df, test="anderson_darling_normality",
                           column="x", group_col=None)["summary"]
    assert r["p_approx"] < 0.05


def test_supported_tests_export_has_18_plus_names():
    assert len(hypothesis.SUPPORTED_TESTS) >= 18


# ───────── Control charts ─────────

def test_cusum_detects_persistent_shift():
    rng = np.random.default_rng(9)
    stable = rng.normal(10, 1, 30)
    shifted = rng.normal(11, 1, 30)
    df = pd.DataFrame({"x": np.concatenate([stable, shifted])})
    # Pass the in-control mean as target so CUSUM doesn't dilute the shift
    # by recentering on the post-shift mean.
    r = control_chart.compute(df, kind="CUSUM", column="x", target=10.0)["summary"]
    assert r["first_upper_violation"] is not None
    assert r["first_upper_violation"] >= 30


def test_ma_chart_returns_violations_list():
    rng = np.random.default_rng(10)
    df = pd.DataFrame({"x": rng.normal(0, 1, 50)})
    r = control_chart.compute(df, kind="MA", column="x", w=5)["summary"]
    assert "violations" in r and isinstance(r["violations"], list)


def test_we_rules_now_emit_8_buckets():
    # Just exercise the rule-violation function directly.
    values = list(range(50))  # monotonic — fires several rules
    out = control_chart._we_rules(values, center=25, sigma=10)
    for k in ("rule_1", "rule_2", "rule_3", "rule_4",
              "rule_5", "rule_6", "rule_7", "rule_8"):
        assert k in out


# ───────── Distribution ID ─────────

def test_distribution_id_picks_normal_for_normal_data():
    rng = np.random.default_rng(11)
    df = pd.DataFrame({"x": rng.normal(50, 5, 300)})
    # Constrain candidates so 3-parameter weibull_min (which can mimic
    # almost any unimodal shape) doesn't out-fit the true generating
    # distribution. In production we let users pass `candidates` for
    # the same reason.
    r = distribution_id.compute(df, column="x",
                                candidates=["normal", "lognormal", "exponential", "logistic"])["summary"]
    assert r["best_fit"] == "normal"


def test_distribution_id_picks_lognormal_for_lognormal_data():
    rng = np.random.default_rng(12)
    df = pd.DataFrame({"x": np.exp(rng.normal(2, 0.5, 400))})
    r = distribution_id.compute(df, column="x")["summary"]
    # Lognormal must be in the top 2 candidates.
    top_two = [r["results"][0]["distribution"]]
    if len(r["results"]) > 1 and "rank" in r["results"][1]:
        top_two.append(r["results"][1]["distribution"])
    assert "lognormal" in top_two


# ───────── Reliability ─────────

def test_weibull_recovers_known_parameters():
    rng = np.random.default_rng(13)
    # True β=2, η=100; n=200 uncensored failures
    true_beta, true_eta = 2.0, 100.0
    times = true_eta * rng.weibull(true_beta, 200)
    df = pd.DataFrame({"t": times})
    r = reliability.weibull(df, time_col="t",
                            mission_times=[50.0, 100.0, 150.0])["summary"]
    # With n=200 we expect both within ~10% of truth.
    assert abs(r["shape_beta"] - true_beta) < 0.3
    assert abs(r["scale_eta"] - true_eta) < 15
    assert 50.0 in r["reliability_at_mission_times"]
    # R(50) > R(100) > R(150) — monotone decreasing.
    rs = r["reliability_at_mission_times"]
    assert rs[50.0] > rs[100.0] > rs[150.0]


def test_weibull_handles_right_censoring():
    rng = np.random.default_rng(14)
    times = 100.0 * rng.weibull(2.0, 100)
    censor = (times > 80).astype(int)
    times = np.minimum(times, 80.0)  # right-censor at t=80
    df = pd.DataFrame({"t": times, "c": censor})
    r = reliability.weibull(df, time_col="t", censor_col="c")["summary"]
    assert r["n_censored"] > 0
    assert r["shape_beta"] > 0


def test_exponential_reliability_basic():
    rng = np.random.default_rng(15)
    times = rng.exponential(50.0, 200)
    df = pd.DataFrame({"t": times})
    r = reliability.exponential(df, time_col="t",
                                mission_times=[25.0, 50.0])["summary"]
    # MTBF should be near 50.
    assert 40 < r["MTBF"] < 60
    assert r["reliability_at_mission_times"][50.0] < r["reliability_at_mission_times"][25.0]


# ───────── Capability extensions ─────────

def test_capability_emits_cpm_when_target_supplied():
    rng = np.random.default_rng(16)
    df = pd.DataFrame({"x": rng.normal(10.5, 0.2, 200)})
    r = capability.compute(df, column="x", lsl=10.0, usl=11.0, target=10.5)["summary"]
    assert r["cpm"] is not None
    assert r["cpk"] is not None


def test_capability_emits_z_bench():
    rng = np.random.default_rng(17)
    df = pd.DataFrame({"x": rng.normal(10.5, 0.2, 200)})
    r = capability.compute(df, column="x", lsl=10.0, usl=11.0)["summary"]
    assert r["z_bench"] is not None


def test_capability_box_cox_transform_path():
    rng = np.random.default_rng(18)
    # Lognormal — non-normal but positive.
    df = pd.DataFrame({"x": np.exp(rng.normal(0, 0.4, 200))})
    r = capability.compute(df, column="x", lsl=0.3, usl=2.5,
                           transform="box-cox")["summary"]
    assert "box_cox" in r
    assert r["box_cox"]["lambda"] is not None
    assert r["box_cox"]["cpk"] is not None


# ───────── Power & sample size ─────────

def test_anova_sample_size_returns_n_per_group():
    r = sample_size.anova(k_groups=4, effect_size_f=0.25)["summary"]
    assert r["n_per_group"] >= 10
    assert r["power_achieved"] >= 0.80


def test_regression_sample_size_returns_n():
    r = sample_size.regression(n_predictors=5, effect_size_f2=0.15)["summary"]
    assert r["n"] >= 50
    assert r["power_achieved"] >= 0.80
