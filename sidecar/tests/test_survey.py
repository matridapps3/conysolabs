"""Tests for survey/Likert analysis + Cronbach's alpha."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stats import survey


def _coherent_scale(seed=0, n=200, k=5):
    """A reliable scale: a latent trait drives all items → high alpha."""
    rs = np.random.RandomState(seed)
    trait = rs.normal(3, 1, n)
    data = {}
    for j in range(k):
        vals = np.clip(np.round(trait + rs.normal(0, 0.4, n)), 1, 5)
        data[f"q{j+1}"] = vals
    return pd.DataFrame(data)


def test_coherent_scale_high_alpha():
    df = _coherent_scale()
    r = survey.analyze(df, [f"q{i+1}" for i in range(5)])["summary"]
    assert r["cronbach_alpha"] > 0.7
    assert r["alpha_interpretation"] in ("acceptable", "good", "excellent")
    assert r["n_items"] == 5
    assert len(r["items"]) == 5


def test_incoherent_scale_low_alpha():
    rs = np.random.RandomState(1)
    df = pd.DataFrame({f"q{j}": np.clip(np.round(rs.normal(3, 1, 200)), 1, 5) for j in range(5)})
    r = survey.analyze(df, list(df.columns))["summary"]
    assert r["cronbach_alpha"] < 0.5    # independent items → unreliable scale


def test_alpha_known_value():
    # Cronbach's alpha is deterministic for fixed data; compare to manual formula.
    df = _coherent_scale(seed=3)
    items = list(df.columns)
    r = survey.analyze(df, items)["summary"]
    X = df[items].to_numpy(float)
    k = X.shape[1]
    manual = (k / (k - 1)) * (1 - X.var(axis=0, ddof=1).sum() / X.sum(axis=1).var(ddof=1))
    assert abs(r["cronbach_alpha"] - manual) < 1e-9


def test_item_diagnostics_present():
    df = _coherent_scale()
    r = survey.analyze(df, list(df.columns))["summary"]
    for it in r["items"]:
        assert "item_total_corr" in it and "alpha_if_deleted" in it


def test_top_box_and_distribution():
    df = _coherent_scale()
    r = survey.analyze(df, list(df.columns))["summary"]
    assert 0 <= r["top_2_box_pct"] <= 100
    assert sum(r["response_distribution"].values()) == r["n_responses"]


def test_chart_returned():
    df = _coherent_scale()
    out = survey.analyze(df, list(df.columns))
    assert out["chart_png"][:4] == b"\x89PNG"


def test_needs_two_items():
    df = _coherent_scale()
    with pytest.raises(ValueError):
        survey.analyze(df, ["q1"])
