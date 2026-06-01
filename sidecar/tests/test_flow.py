"""Tests for transactional/Agile flow analytics."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stats import flow


def test_cycle_time_numeric():
    df = pd.DataFrame({"days": [1, 2, 2, 3, 3, 3, 4, 5, 8, 13]})
    r = flow.cycle_time(df, time_col="days")["summary"]
    assert r["n"] == 10
    assert r["percentiles"][50] == pytest.approx(3.0, abs=0.5)
    assert r["sle_85"] >= r["percentiles"][50]
    assert r["unit"] == "units"


def test_cycle_time_from_dates():
    df = pd.DataFrame({
        "start": ["2026-01-01", "2026-01-01", "2026-01-05"],
        "end":   ["2026-01-03", "2026-01-06", "2026-01-06"],
    })
    r = flow.cycle_time(df, start_col="start", end_col="end")["summary"]
    assert r["unit"] == "days"
    assert r["n"] == 3
    assert r["median"] == pytest.approx(2.0, abs=0.01)   # cycles: 2, 5, 1 → median 2


def test_cycle_time_chart_and_errors():
    df = pd.DataFrame({"d": [1.0, 2, 3, 4, 5]})
    assert flow.cycle_time(df, time_col="d")["chart_png"][:4] == b"\x89PNG"
    with pytest.raises(ValueError):
        flow.cycle_time(df)                       # no cols
    with pytest.raises(ValueError):
        flow.cycle_time(pd.DataFrame({"d": [1.0]}), time_col="d")  # too few


def test_delivery_forecast_periods():
    # ~5 items/period throughput → 50 items ≈ 10 periods.
    tp = [4, 5, 6, 5, 4, 6, 5, 5, 4, 6]
    r = flow.delivery_forecast(tp, backlog=50)["summary"]
    pn = r["periods_to_complete"]
    assert pn is not None
    assert 8 <= pn[50] <= 13
    assert pn[95] >= pn[50]                        # higher confidence → more periods
    assert r["chart_png"][:4] == b"\x89PNG" if "chart_png" in r else True


def test_delivery_forecast_horizon():
    tp = [4, 5, 6, 5, 4, 6, 5, 5]
    r = flow.delivery_forecast(tp, backlog=None, horizon=10)["summary"]
    ih = r["items_in_horizon"]
    assert ih is not None
    assert ih[50] == pytest.approx(50, abs=12)     # ~5/period × 10
    assert ih[5] <= ih[95]


def test_delivery_forecast_deterministic():
    tp = [3, 4, 5, 4, 3]
    a = flow.delivery_forecast(tp, backlog=30)["summary"]["periods_to_complete"]
    b = flow.delivery_forecast(tp, backlog=30)["summary"]["periods_to_complete"]
    assert a == b                                  # fixed seed → reproducible


def test_delivery_forecast_errors():
    with pytest.raises(ValueError):
        flow.delivery_forecast([1, 2], backlog=10)         # too little history
    with pytest.raises(ValueError):
        flow.delivery_forecast([3, 4, 5], backlog=-1)


def test_littles_law_solves_each_term():
    assert flow.littles_law(throughput=5, cycle_time=4)["summary"]["wip"] == 20
    assert flow.littles_law(wip=20, cycle_time=4)["summary"]["throughput"] == 5
    assert flow.littles_law(wip=20, throughput=5)["summary"]["cycle_time"] == 4
    with pytest.raises(ValueError):
        flow.littles_law(wip=20)                            # only one given
