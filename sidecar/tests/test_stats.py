"""Deterministic tests for the sidecar stats engine.
Run from the sidecar/ directory: `python -m pytest tests/`.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from stats import capability as cap
from stats import hypothesis as hyp
from stats import control_chart as cc
from stats import regression as reg
from stats import doe


# ---- capability ----------------------------------------------------------

def test_capability_centered_normal():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"x": rng.normal(loc=10.0, scale=1.0, size=400)})
    r = cap.compute(df, column="x", lsl=6.0, usl=14.0)
    s = r["summary"]
    # 8/(6*1) ≈ 1.33; allow for sample variation
    assert 1.1 < s["cp"] < 1.6
    assert 0.9 < s["cpk"] < 1.6
    assert s["n"] == 400
    assert "chart_png" in r and len(r["chart_png"]) > 1000


def test_capability_off_center():
    rng = np.random.default_rng(1)
    df = pd.DataFrame({"x": rng.normal(loc=12.5, scale=1.0, size=300)})
    r = cap.compute(df, column="x", lsl=6.0, usl=14.0)
    # cp similar; cpk lower since process shifted toward USL
    assert r["summary"]["cpk"] < r["summary"]["cp"]


# ---- hypothesis tests ----------------------------------------------------

def test_one_sample_t_against_known_mean():
    rng = np.random.default_rng(2)
    df = pd.DataFrame({"x": rng.normal(loc=10.0, scale=1.0, size=200)})
    r = hyp.compute(df, test="one_sample_t", column="x", group_col=None, mu0=10.0)
    assert r["summary"]["p"] > 0.05  # not different from 10


def test_two_sample_t_separable_groups():
    rng = np.random.default_rng(3)
    df = pd.DataFrame({
        "y": np.r_[rng.normal(0, 1, 100), rng.normal(2, 1, 100)],
        "g": ["a"] * 100 + ["b"] * 100,
    })
    r = hyp.compute(df, test="two_sample_t", column="y", group_col="g")
    assert r["summary"]["p"] < 1e-10
    assert r["summary"]["cohens_d"] is not None


def test_paired_t_within_subject_diff():
    rng = np.random.default_rng(4)
    before = rng.normal(0, 1, 50)
    after = before + rng.normal(0.5, 0.2, 50)  # consistent positive shift
    df = pd.DataFrame({"before": before, "after": after})
    r = hyp.compute(df, test="paired_t", column="before", group_col=None, column_b="after")
    assert r["summary"]["p"] < 1e-5
    assert r["summary"]["mean_diff"] < 0  # before - after


def test_two_proportions_significant():
    df = pd.DataFrame({
        "ok": [1] * 80 + [0] * 20 + [1] * 50 + [0] * 50,
        "g": ["a"] * 100 + ["b"] * 100,
    })
    r = hyp.compute(df, test="two_proportions", column="ok", group_col="g")
    assert r["summary"]["p"] < 1e-3


def test_kruskal_three_groups():
    rng = np.random.default_rng(5)
    df = pd.DataFrame({
        "y": np.r_[rng.normal(0,1,40), rng.normal(0.2,1,40), rng.normal(2,1,40)],
        "g": ["a"]*40 + ["b"]*40 + ["c"]*40,
    })
    r = hyp.compute(df, test="kruskal", column="y", group_col="g")
    assert r["summary"]["p"] < 1e-3
    assert r["summary"]["k"] == 3


# ---- control chart -------------------------------------------------------

def test_imr_chart_in_control():
    rng = np.random.default_rng(6)
    df = pd.DataFrame({"x": rng.normal(0, 1, 50)})
    r = cc.compute(df, kind="I-MR", column="x")
    s = r["summary"]
    assert s["lcl_i"] < s["x_bar"] < s["ucl_i"]
    # WE rule sub-dict present
    assert "we_rules" in s
    for k in ("rule_1","rule_2","rule_3","rule_4"):
        assert k in s["we_rules"]


def test_imr_we_rule3_monotone_run():
    df = pd.DataFrame({"x": list(range(20))})  # strict increasing
    r = cc.compute(df, kind="I-MR", column="x")
    assert len(r["summary"]["we_rules"]["rule_3"]) > 0


def test_xbar_r_chart_subgroups():
    rng = np.random.default_rng(7)
    rows = []
    for sg in range(20):
        for _ in range(5):
            rows.append({"sg": sg, "x": rng.normal(10, 1)})
    df = pd.DataFrame(rows)
    r = cc.compute(df, kind="X-bar/R", column="x", subgroup_col="sg")
    s = r["summary"]
    assert s["subgroup_size"] == 5
    assert s["n_subgroups"] == 20
    assert s["lcl_x"] < s["x_double_bar"] < s["ucl_x"]


def test_p_chart_attribute():
    df = pd.DataFrame({"d": [4,5,3,4,5,4,3,4,5,4], "n": [100]*10})
    r = cc.compute(df, kind="p", column="d", n_col="n")
    assert 0.0 < r["summary"]["p_bar"] < 0.1
    assert r["summary"]["n_subgroups"] == 10


# ---- regression ----------------------------------------------------------

def test_regression_recovers_known_slope():
    rng = np.random.default_rng(8)
    x = rng.normal(0, 1, 200)
    y = 2.5 * x + 1.0 + rng.normal(0, 0.3, 200)
    df = pd.DataFrame({"x": x, "y": y})
    r = reg.compute(df, response="y", predictors=["x"])
    s = r["summary"]
    # find the predictor coefficient
    coef_x = next(c for c in s["coefficients"] if c["name"] == "x")
    assert abs(coef_x["coef"] - 2.5) < 0.2
    assert s["r2"] > 0.95


# ---- doe -----------------------------------------------------------------

def test_doe_two_factor_main_effect():
    # y = 1*A + 2*B + 0.5*A*B + noise; A, B at -1/+1
    rng = np.random.default_rng(9)
    rows = []
    for a in [-1, 1]:
        for b in [-1, 1]:
            for _ in range(8):
                rows.append({"A": a, "B": b, "y": 1*a + 2*b + 0.5*a*b + rng.normal(0, 0.1)})
    df = pd.DataFrame(rows)
    r = doe.compute(df, response="y", factors=["A","B"])
    eff = {e["term"]: e["effect"] for e in r["summary"]["effects"] if e["effect"] is not None}
    # B effect = 2 * coef = 2 * 2 = 4 (signal), A effect = 2
    assert abs(eff["B"] - 4.0) < 0.5
    assert abs(eff["A"] - 2.0) < 0.5
    assert "A:B" in eff
