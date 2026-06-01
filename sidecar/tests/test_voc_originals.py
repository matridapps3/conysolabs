"""Tests for text-comment auto-Pareto and the Variance Budget original."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stats import text_pareto, variance_budget


# ───────── text auto-Pareto ─────────

def test_text_pareto_keyword_basis():
    comments = (["the wait time was too long"] * 5 +
                ["staff were rude and unhelpful"] * 3 +
                ["billing error on my invoice"] * 2)
    df = pd.DataFrame({"comment": comments})
    r = text_pareto.analyze(df, "comment", top_n=10, use_bigrams=False)["summary"]
    assert r["basis"] == "keywords"
    assert r["n_comments"] == 10
    themes = [t["theme"] for t in r["themes"]]
    assert "wait" in themes                     # most frequent stemmed token
    # cumulative pct is monotone non-decreasing
    cps = [t["cum_pct"] for t in r["themes"]]
    assert all(cps[i] <= cps[i+1] + 1e-9 for i in range(len(cps)-1))


def test_text_pareto_theme_mapping():
    comments = ["waited forever in the queue", "the queue was slow",
                "rude staff at the desk", "billing was wrong"]
    df = pd.DataFrame({"c": comments})
    themes = {"Wait": ["wait", "queue", "slow"], "Staff": ["rude", "staff"], "Billing": ["billing"]}
    r = text_pareto.analyze(df, "c", themes=themes)["summary"]
    assert r["basis"] == "themes"
    top = r["themes"][0]
    assert top["theme"] == "Wait" and top["count"] == 2


def test_text_pareto_chart_and_errors():
    df = pd.DataFrame({"c": ["good service", "great product"]})
    out = text_pareto.analyze(df, "c", use_bigrams=False)
    assert out["chart_png"][:4] == b"\x89PNG"
    with pytest.raises(ValueError):
        text_pareto.analyze(df, "NOPE")
    with pytest.raises(ValueError):
        text_pareto.analyze(pd.DataFrame({"c": ["only one"]}), "c")


# ───────── Variance Budget ─────────

def _factored(seed=0, n=180):
    rs = np.random.RandomState(seed)
    op = rs.choice(["A", "B", "C"], n)
    machine = rs.choice(["M1", "M2"], n)
    op_eff = {"A": 0.0, "B": 3.0, "C": -3.0}     # operator drives a lot
    mach_eff = {"M1": 0.0, "M2": 0.4}            # machine drives a little
    y = np.array([op_eff[o] + mach_eff[m] + rs.normal(0, 1) for o, m in zip(op, machine)])
    return pd.DataFrame({"y": y, "operator": op, "machine": machine})


def test_variance_budget_finds_dominant_source():
    df = _factored()
    r = variance_budget.analyze(df, "y", ["operator", "machine"])["summary"]
    assert r["largest_source"] == "operator"
    # budget sums to ~100%
    assert abs(sum(b["pct"] for b in r["budget"]) - 100.0) < 1e-6
    assert any(b["source"] == "Unexplained (residual)" for b in r["budget"])
    assert r["chart_png"][:4] == b"\x89PNG" if "chart_png" in r else True


def test_variance_budget_chart_and_errors():
    df = _factored()
    out = variance_budget.analyze(df, "y", ["operator", "machine"])
    assert out["chart_png"][:4] == b"\x89PNG"
    with pytest.raises(ValueError):
        variance_budget.analyze(df, "NOPE", ["operator"])
    with pytest.raises(ValueError):
        variance_budget.analyze(df, "y", [])
