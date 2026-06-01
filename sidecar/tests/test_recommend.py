"""Tests for the DMAIC recommendation engine. Each rule gets explicit coverage;
the engine is a pure function over dicts so no fixtures/I-O are needed."""
from __future__ import annotations

import pytest

from stats import recommend as R


def _an(kind, summary=None, id=None, **params):
    return {"id": id or kind, "kind": kind, "params": params, "summary": summary or {}}


def keys(result):
    return {r["key"] for r in result["summary"]["recommendations"]}


def by_key(result, key):
    return next((r for r in result["summary"]["recommendations"] if r["key"] == key), None)


# ───────── basics ─────────

def test_unknown_phase_raises():
    with pytest.raises(ValueError):
        R.recommend("banana")


def test_define_empty_recommends_pareto_and_gate_blocked():
    r = R.recommend("define", dataset={"n_rows": 100, "columns": []}, history=[])
    assert "define.pareto" in keys(r)
    g = r["summary"]["gate"]
    assert g["ready"] is False
    assert any("Pareto" in m for m in g["missing_artifacts"])


def test_recommendations_sorted_by_priority():
    r = R.recommend("analyze", history=[
        _an("control_chart", {"violations": [3, 7]}),       # blocker
        _an("capability", {"cpk": 0.8, "cp": 0.85}),        # high
    ])
    prios = [x["priority"] for x in r["summary"]["recommendations"]]
    ranks = [R.PRIORITY_RANK[p] for p in prios]
    assert ranks == sorted(ranks)


# ───────── MEASURE: MSA gate ─────────

def test_measure_no_msa_is_blocker():
    r = R.recommend("measure", history=[])
    rec = by_key(r, "measure.msa")
    assert rec and rec["priority"] == "blocker" and rec["blocks_gate"]
    assert r["summary"]["gate"]["ready"] is False


def test_measure_bad_grr_blocks():
    r = R.recommend("measure", history=[_an("msa", {"total_grr_pct": 42.0}, id="m1")])
    rec = by_key(r, "measure.msa.bad")
    assert rec and rec["priority"] == "blocker"
    assert "m1" in rec["based_on"]


def test_measure_marginal_grr_is_medium_not_blocker():
    r = R.recommend("measure", history=[_an("msa", {"total_grr_pct": 18.0})])
    rec = by_key(r, "measure.msa.marginal")
    assert rec and rec["priority"] == "medium" and not rec["blocks_gate"]


def test_measure_good_grr_then_wants_baseline():
    r = R.recommend("measure", history=[_an("msa", {"total_grr_pct": 6.0})])
    assert "measure.baseline" in keys(r)
    assert by_key(r, "measure.msa.bad") is None and by_key(r, "measure.msa") is None


def test_measure_small_n_flag():
    r = R.recommend("measure", dataset={"n_rows": 8, "columns": []},
                    history=[_an("msa", {"total_grr_pct": 5.0})])
    assert "measure.n" in keys(r)


# ───────── ANALYZE: stability / OOC / Cpk escalation ─────────

def test_analyze_capability_without_stability():
    r = R.recommend("analyze", history=[_an("capability", {"cpk": 1.5, "cp": 1.5})])
    assert "analyze.stability" in keys(r)


def test_analyze_ooc_is_blocker():
    r = R.recommend("analyze", history=[_an("control_chart", {"violations": [2, 5, 9]}, id="cc1")])
    rec = by_key(r, "analyze.ooc")
    assert rec and rec["priority"] == "blocker" and "cc1" in rec["based_on"]
    assert r["summary"]["gate"]["ready"] is False


def test_analyze_offcenter_recommends_recentre():
    # Cpk much worse than Cp, Cp healthy → centring first.
    r = R.recommend("analyze", history=[
        _an("control_chart", {"violations": []}),
        _an("capability", {"cpk": 0.9, "cp": 1.5}, id="c1")])
    rec = by_key(r, "analyze.recenter")
    assert rec and "c1" in rec["based_on"]
    assert by_key(r, "analyze.reduce_var") is None


def test_analyze_spread_limited_recommends_doe():
    r = R.recommend("analyze", history=[
        _an("control_chart", {"violations": []}),
        _an("capability", {"cpk": 0.9, "cp": 0.95})])
    assert "analyze.reduce_var" in keys(r)
    assert by_key(r, "analyze.recenter") is None


def test_analyze_good_cpk_no_escalation():
    r = R.recommend("analyze", history=[
        _an("control_chart", {"violations": []}),
        _an("capability", {"cpk": 1.6, "cp": 1.7})])
    assert "analyze.recenter" not in keys(r) and "analyze.reduce_var" not in keys(r)


def test_analyze_anova_significant_wants_posthoc():
    r = R.recommend("analyze", history=[
        _an("hypothesis_test", {"test": "one_way_anova", "p": 0.001}, id="a1")])
    rec = by_key(r, "analyze.posthoc")
    assert rec and "a1" in rec["based_on"]


def test_analyze_anova_nonsig_no_posthoc():
    r = R.recommend("analyze", history=[
        _an("hypothesis_test", {"test": "one_way_anova", "p": 0.6})])
    assert "analyze.posthoc" not in keys(r)


def test_analyze_high_vif_recommends_regularization():
    r = R.recommend("analyze", history=[
        _an("regression", {"r2": 0.9, "vif": [{"term": "x1", "vif": 12.0}]}, id="r1")])
    rec = by_key(r, "analyze.vif")
    assert rec and "r1" in rec["based_on"]


def test_analyze_weak_r2():
    r = R.recommend("analyze", history=[_an("regression", {"r2": 0.3, "vif": []})])
    assert "analyze.weakr2" in keys(r)


# ───────── IMPROVE / CONTROL ─────────

def test_improve_needs_doe():
    r = R.recommend("improve", history=[])
    rec = by_key(r, "improve.doe")
    assert rec and rec["blocks_gate"]


def test_improve_doe_then_confirm():
    r = R.recommend("improve", history=[_an("doe", {"r2": 0.9})])
    assert "improve.confirm" in keys(r)
    assert by_key(r, "improve.doe") is None


def test_control_needs_chart():
    r = R.recommend("control", history=[])
    rec = by_key(r, "control.chart")
    assert rec and rec["priority"] == "blocker"


def test_control_chart_then_sixpack():
    r = R.recommend("control", history=[_an("control_chart", {"violations": []})])
    assert "control.sixpack" in keys(r)
    assert r["summary"]["gate"]["ready"] is True   # chart present, no blockers


# ───────── gate + open items ─────────

def test_gate_ready_when_clean():
    r = R.recommend("define", history=[_an("pareto", {})])
    assert r["summary"]["gate"]["ready"] is True


def test_open_items_surface_as_low():
    r = R.recommend("control",
                    history=[_an("control_chart", {"violations": []})],
                    open_items=[{"title": "Schedule a 30-day audit", "rationale": "verify the gain holds"}])
    rec = next((x for x in r["summary"]["recommendations"] if x["title"] == "Schedule a 30-day audit"), None)
    assert rec and rec["priority"] == "low"


def test_every_recommendation_has_required_fields():
    r = R.recommend("measure", dataset={"n_rows": 5, "columns": []}, history=[])
    for rec in r["summary"]["recommendations"]:
        assert set(["key", "priority", "title", "rationale", "action", "blocks_gate", "based_on"]) <= set(rec)
        assert rec["priority"] in R.PRIORITY_RANK
