"""Regression tests for the statistical-correctness audit fixes.

Each test pins a bug that was found by differential testing against
scipy/statsmodels and authoritative SPC constant tables, so they cannot recur.
"""
import math

import numpy as np
import pandas as pd
import pytest
import scipy.stats as sps

from stats import probability, doe
from stats._constants import D4, n_to_idx


# ── (1) Discrete probability distributions must not crash on pmf/cdf ──
# Bug: the dispatch map eagerly evaluated dist.pdf, which discrete scipy dists
# (binom, poisson) do not have → AttributeError on EVERY mode.
@pytest.mark.parametrize("mode", ["pdf", "cdf", "ppf"])
def test_binomial_probability_modes_work(mode):
    x = 3 if mode != "ppf" else 0.5
    r = probability.calculator("binomial", mode, x, {"n": 10, "p": 0.3})
    assert "result" in r["summary"]


def test_binomial_pmf_matches_scipy():
    r = probability.calculator("binomial", "pdf", 3, {"n": 10, "p": 0.3})
    assert math.isclose(r["summary"]["result"], sps.binom.pmf(3, 10, 0.3), rel_tol=1e-9)


def test_poisson_pmf_matches_scipy():
    r = probability.calculator("poisson", "pdf", 2, {"mu": 3.0})
    assert math.isclose(r["summary"]["result"], sps.poisson.pmf(2, 3.0), rel_tol=1e-9)


# ── (2) DOE coding of text factor levels must not invert effect signs ──
# Bug: alphabetical sort coded 'High'→-1, 'Low'→+1, flipping every effect.
def test_doe_text_levels_code_low_minus_high_plus():
    coded, meta = doe._code(pd.Series(["Low", "High", "Low", "High"]))
    assert meta["low"] == "Low" and meta["high"] == "High"
    assert coded.tolist() == [-1.0, 1.0, -1.0, 1.0]


def test_doe_offon_levels_code_correctly():
    _, meta = doe._code(pd.Series(["On", "Off", "On", "Off"]))
    assert meta["low"] == "Off" and meta["high"] == "On"


def test_doe_effect_sign_matches_between_numeric_and_text():
    # response increases by +6 per step from low→high; effect on A must be +ve.
    a_levels = [-1, 1, -1, 1, -1, 1, -1, 1]
    resp = [10, 16, 10, 16, 10, 16, 10, 16]
    df_num = pd.DataFrame({"A": a_levels, "resp": resp})
    df_txt = pd.DataFrame({"A": ["Low" if a < 0 else "High" for a in a_levels], "resp": resp})
    eff_num = doe.compute(df_num, response="resp", factors=["A"])["summary"]["effects"]
    eff_txt = doe.compute(df_txt, response="resp", factors=["A"])["summary"]["effects"]

    def effect_of(effects, name):
        for e in effects:
            if e.get("term") == name or e.get("name") == name or e.get("factor") == name:
                return e.get("effect", e.get("estimate"))
        return None

    a_num = effect_of(eff_num, "A")
    a_txt = effect_of(eff_txt, "A")
    assert a_num is not None and a_txt is not None
    assert a_num > 0 and a_txt > 0           # both positive (low→high increases resp)
    assert math.isclose(a_num, a_txt, rel_tol=1e-9)  # identical magnitude AND sign


# ── (3) SPC D4 constants match authoritative (Montgomery) values ──
def test_d4_constants_match_montgomery():
    # n -> D4 (Montgomery, Intro to SQC, Appendix VI)
    ref = {2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924}
    for n, want in ref.items():
        assert math.isclose(D4[n_to_idx(n)], want, abs_tol=1e-3), f"D4({n})={D4[n_to_idx(n)]} != {want}"
