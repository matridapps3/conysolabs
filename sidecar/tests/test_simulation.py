"""Tests for Monte-Carlo simulation + tolerance stack-up, including the
security boundary of the formula evaluator."""
from __future__ import annotations

import numpy as np
import pytest

from stats import simulation as sim


def test_sum_stackup_mean_and_sd():
    # Three independent N(10,1) → sum ~ N(30, sqrt(3)).
    inp = [{"name": f"x{i}", "dist": "normal", "params": {"mean": 10, "sd": 1}} for i in range(3)]
    r = sim.monte_carlo(inp, {"type": "sum"}, n_runs=50000)["summary"]
    assert abs(r["mean"] - 30) < 0.1
    assert abs(r["sd"] - np.sqrt(3)) < 0.05
    assert len(r["sensitivity"]) == 3
    # Equal inputs → ~33% each.
    assert all(abs(s["contribution_pct"] - 33.3) < 3 for s in r["sensitivity"])


def test_monte_carlo_returns_png():
    inp = [{"name": "a", "dist": "normal", "params": {"mean": 5, "sd": 1}}]
    out = sim.monte_carlo(inp, {"type": "sum"}, n_runs=5000)
    assert out["chart_png"][:4] == b"\x89PNG"


def test_linear_transfer_and_capability():
    inp = [{"name": "a", "params": {"mean": 10, "sd": 1}},
           {"name": "b", "params": {"mean": 5, "sd": 2}}]
    r = sim.monte_carlo(inp, {"type": "linear", "coeffs": {"a": 1, "b": 1}, "const": 0},
                        n_runs=60000, lsl=10, usl=20, target=15)["summary"]
    assert abs(r["mean"] - 15) < 0.1
    assert r["capability"] is not None and r["capability"]["cpk"] is not None
    # b has 2× the sd → dominates variance (4:1 in variance terms → ~80%).
    top = r["sensitivity"][0]
    assert top["name"] == "b" and top["contribution_pct"] > 70


def test_formula_transfer():
    inp = [{"name": "a", "params": {"mean": 3, "sd": 0.01}},
           {"name": "b", "params": {"mean": 4, "sd": 0.01}}]
    r = sim.monte_carlo(inp, {"type": "formula", "expr": "sqrt(a*a + b*b)"}, n_runs=20000)["summary"]
    assert abs(r["mean"] - 5.0) < 0.05     # 3-4-5


def test_formula_rejects_malicious():
    inp = [{"name": "a", "params": {"mean": 1, "sd": 1}}]
    for bad in ["__import__('os').system('x')", "a.__class__", "open('/etc/passwd')",
                "a; b", "[x for x in range(3)]", "lambda: 1"]:
        with pytest.raises(ValueError):
            sim.monte_carlo(inp, {"type": "formula", "expr": bad}, n_runs=1000)


def test_formula_rejects_unknown_name():
    inp = [{"name": "a", "params": {"mean": 1, "sd": 1}}]
    with pytest.raises(ValueError):
        sim.monte_carlo(inp, {"type": "formula", "expr": "a + zzz"}, n_runs=1000)


def test_duplicate_input_names_rejected():
    inp = [{"name": "a", "params": {}}, {"name": "a", "params": {}}]
    with pytest.raises(ValueError):
        sim.monte_carlo(inp, {"type": "sum"}, n_runs=1000)


def test_empty_inputs_rejected():
    with pytest.raises(ValueError):
        sim.monte_carlo([], {"type": "sum"})


# ───────── tolerance stack-up ─────────

def test_tolerance_stack_worst_case_and_rss():
    comps = [{"name": "A", "nominal": 10, "tol": 0.1},
             {"name": "B", "nominal": 20, "tol": 0.1},
             {"name": "C", "nominal": 5, "tol": 0.1}]
    r = sim.tolerance_stack(comps)["summary"]
    assert r["assembly_nominal"] == 35
    assert abs(r["worst_case_tol"] - 0.3) < 1e-9              # 0.1+0.1+0.1
    assert abs(r["rss_tol"] - np.sqrt(3) * 0.1) < 1e-9        # sqrt(3·0.01)
    # RSS interval is tighter than worst-case.
    assert (r["rss_interval"][1] - r["rss_interval"][0]) < (r["worst_case_interval"][1] - r["worst_case_interval"][0])


def test_tolerance_stack_cpk_with_spec():
    comps = [{"name": "A", "nominal": 10, "tol": 0.3}]
    r = sim.tolerance_stack(comps, lsl=9, usl=11)["summary"]
    assert "cpk_rss" in r and r["cpk_rss"] > 0


def test_tolerance_stack_coeff_and_shares():
    comps = [{"name": "A", "nominal": 10, "tol": 0.2, "coeff": 2},
             {"name": "B", "nominal": 5, "tol": 0.1, "coeff": 1}]
    r = sim.tolerance_stack(comps)["summary"]
    assert r["assembly_nominal"] == 25                        # 2·10 + 1·5
    # A dominates: (2·0.2)²=0.16 vs (1·0.1)²=0.01 → ~94%.
    assert r["components"][0]["name"] == "A"
    assert r["components"][0]["rss_share_pct"] > 90
