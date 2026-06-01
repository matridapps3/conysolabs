"""Dunn's test — the non-parametric post-hoc for a significant Kruskal-Wallis.

Known-answer tests derived by hand from Dunn (1964):
  z_ij = (R̄_i − R̄_j) / sqrt( σ² · (1/n_i + 1/n_j) )
  σ²   = N(N+1)/12 − Σ(t_k³ − t_k) / (12(N−1))     (t_k = size of each tie group)
where R̄ are mean ranks over the POOLED sample (average ranks for ties).
"""
import math

import pandas as pd

from stats import posthoc, followups


def _df(groups: dict) -> pd.DataFrame:
    rows = []
    for g, vals in groups.items():
        for v in vals:
            rows.append({"y": v, "grp": g})
    return pd.DataFrame(rows)


def _pair(res, a, b):
    for c in res["summary"]["comparisons"]:
        if {c["group_a"], c["group_b"]} == {a, b}:
            return c
    raise AssertionError(f"pair {a},{b} not found")


def test_dunn_no_ties_matches_hand_computed_z():
    # A:1-3 B:4-6 C:7-9 → pooled mean ranks 2, 5, 8 ; N=9 ; σ²=9·10/12=7.5
    df = _df({"A": [1, 2, 3], "B": [4, 5, 6], "C": [7, 8, 9]})
    res = posthoc.dunn(df, "y", "grp")
    se = math.sqrt(7.5 * (1 / 3 + 1 / 3))  # = 2.2360679...
    ab, ac = _pair(res, "A", "B"), _pair(res, "A", "C")
    assert math.isclose(ab["se"], se, rel_tol=1e-9)
    assert math.isclose(abs(ab["z"]), 3 / se, rel_tol=1e-9)   # |2−5|/se
    assert math.isclose(abs(ac["z"]), 6 / se, rel_tol=1e-9)   # |2−8|/se


def test_dunn_pairwise_count_is_k_choose_2():
    df = _df({"A": [1, 2, 3], "B": [4, 5, 6], "C": [7, 8, 9], "D": [10, 11, 12]})
    res = posthoc.dunn(df, "y", "grp")
    assert len(res["summary"]["comparisons"]) == 6  # 4 choose 2


def test_dunn_applies_tie_correction():
    # pooled [1,1,2,3,3,3]: Σ(t³−t)=(2³−2)+(3³−3)=6+24=30 ; N=6
    # σ² = 6·7/12 − 30/(12·5) = 3.5 − 0.5 = 3.0  (NOT the uncorrected 3.5)
    df = _df({"A": [1, 1], "B": [2, 3], "C": [3, 3]})
    res = posthoc.dunn(df, "y", "grp")
    ab = _pair(res, "A", "B")
    se_corrected = math.sqrt(3.0 * (1 / 2 + 1 / 2))     # = sqrt(3.0)
    assert math.isclose(ab["se"], se_corrected, rel_tol=1e-9)
    assert not math.isclose(ab["se"], math.sqrt(3.5), rel_tol=1e-3)


def test_dunn_holm_adjusted_ge_raw_and_flags_use_adjusted():
    df = _df({"A": [1, 2, 3], "B": [4, 5, 6], "C": [7, 8, 9]})
    res = posthoc.dunn(df, "y", "grp", p_adjust="holm")
    for c in res["summary"]["comparisons"]:
        assert c["p_adj"] >= c["p_raw"] - 1e-12
        assert c["reject_h0"] == (c["p_adj"] < 0.05)


def test_dunn_most_separated_pair_is_most_significant():
    df = _df({"A": [1, 2, 3], "B": [4, 5, 6], "C": [7, 8, 9]})
    res = posthoc.dunn(df, "y", "grp")
    ab, ac, bc = _pair(res, "A", "B"), _pair(res, "A", "C"), _pair(res, "B", "C")
    assert ac["p_raw"] < ab["p_raw"] and ac["p_raw"] < bc["p_raw"]


def test_significant_kruskal_recommends_dunn_followup():
    # A significant Kruskal-Wallis must steer the user to Dunn's (NOT Tukey).
    fu = followups.for_kind("hypothesis_test",
                            {"test": "kruskal", "p": 0.001},
                            {"column": "y", "group_col": "grp"})
    dunn_recs = [f for f in fu if f.get("params", {}).get("test") == "dunn"]
    assert dunn_recs, "expected a Dunn's-test follow-up for a significant Kruskal-Wallis"
    assert dunn_recs[0]["kind"] == "posthoc"


def test_nonsignificant_kruskal_does_not_recommend_dunn():
    fu = followups.for_kind("hypothesis_test",
                            {"test": "kruskal", "p": 0.42},
                            {"column": "y", "group_col": "grp"})
    assert not [f for f in fu if f.get("params", {}).get("test") == "dunn"]
