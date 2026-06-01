"""HTTP integration tests — exercise the *real* request → validate → dispatch
→ serialize → respond path via FastAPI's TestClient.

These exist because the unit tests call stats functions directly and therefore
cannot catch wiring bugs in the API layer. Three such bugs shipped to a live
server precisely because nothing tested HTTP:
  * control_chart passed `kind` twice → every chart 500'd
  * pareto returned raw chart_png bytes → UnicodeDecodeError on serialize → 500
  * ValueError from any stats fn surfaced as an opaque 500 instead of a 400

Each test here would have caught one of those. New chart-producing endpoints
should get a line in `test_chart_endpoints_serialize`.
"""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("httpx")  # TestClient needs httpx
from fastapi.testclient import TestClient

import app

client = TestClient(app.app)


@pytest.fixture(scope="module")
def dataset_key():
    rs = np.random.RandomState(0)
    n = 90
    rows = [{
        "x": float(rs.normal(10, 1)), "y": float(rs.normal(5, 1) + 0.5 * rs.normal()),
        "g": ["A", "B", "C"][i % 3],
        "cnt": int(rs.poisson(4) + 1), "n": 50, "defects": int(rs.poisson(3)),
        "t": float(abs(rs.normal(100, 20)) + 1), "between": int(rs.poisson(40) + 5),
        "part": i % 10, "op": ["o1", "o2"][i % 2],
    } for i in range(n)]
    r = client.post("/materialize-rows", json={"rows": rows})
    assert r.status_code == 200, r.text
    return r.json()["rows_storage_key"]


# Every chart-producing analysis with VALID params → must be 200 AND must not
# leak raw bytes (the chart must come back as a *_storage_key, not chart_png).
CHART_CASES = [
    ("/stats/capability", {"column": "x", "lsl": 6, "usl": 14, "target": 10}),
    ("/stats/control_chart", {"kind": "I-MR", "column": "x"}),
    ("/stats/control_chart", {"kind": "G", "column": "between"}),
    ("/stats/control_chart", {"kind": "T", "column": "t"}),
    ("/stats/pareto", {"category_col": "g"}),
    ("/stats/regression", {"response": "y", "predictors": ["x"], "method": "ols"}),
    ("/stats/regression", {"response": "y", "predictors": ["x"], "method": "lasso", "penalty": 0.1}),
    ("/stats/distribution-id", {"column": "x"}),
    ("/stats/multivariate", {"method": "pca", "columns": ["x", "y"]}),
    ("/stats/multivariate", {"method": "factor", "columns": ["x", "y", "t"]}),
    ("/stats/sixpack", {"column": "x"}),
]


@pytest.mark.parametrize("endpoint,params", CHART_CASES)
def test_chart_endpoints_serialize(dataset_key, endpoint, params):
    r = client.post(endpoint, json={"rows_storage_key": dataset_key, **params})
    assert r.status_code == 200, f"{endpoint} → {r.status_code}: {r.text[:200]}"
    body = r.json()                       # would raise if bytes leaked into JSON
    assert '"chart_png"' not in r.text, f"{endpoint} leaked raw chart bytes instead of a storage key"


# Broader valid-params sweep — guards the wiring (dispatch + serialize) for the
# rest of the dataset-analysis surface, not just the chart producers.
VALID_CASES = [
    ("/stats/sixpack", {"column": "x"}),
    ("/stats/distribution-id", {"column": "x"}),
    ("/stats/correlation", {"columns": ["x", "y"]}),
    ("/stats/bootstrap", {"column": "x"}),
    ("/stats/predictive-cpk", {"column": "x", "lsl": 6, "usl": 14}),
    ("/stats/posthoc", {"test": "tukey_hsd", "value_col": "x", "group_col": "g"}),
    ("/stats/time_series", {"method": "acf_pacf", "value_col": "x"}),
    ("/stats/tolerance", {"method": "normal", "column": "x"}),
    ("/stats/msa", {"measurement_col": "x", "part_col": "part", "operator_col": "op"}),
    ("/stats/anom", {"value_col": "x", "group_col": "g"}),
    ("/stats/hypothesis", {"test": "one_way_anova", "column": "x", "group_col": "g"}),
    ("/stats/multivariate", {"method": "kmeans", "columns": ["x", "y"], "k": 2}),
]


@pytest.mark.parametrize("endpoint,params", VALID_CASES)
def test_valid_params_return_200(dataset_key, endpoint, params):
    r = client.post(endpoint, json={"rows_storage_key": dataset_key, **params})
    assert r.status_code == 200, f"{endpoint} → {r.status_code}: {r.text[:200]}"
    assert '"chart_png"' not in r.text       # no leaked binary on any endpoint


def test_power_curve_and_doe_power():
    r = client.post("/stats/power-curve", json={"kind": "two_sample_t", "effect_size": 0.5})
    assert r.status_code == 200 and r.json()["summary"]["n_required"] == 64
    r = client.post("/stats/doe-power", json={"n_runs": 8, "n_factors": 3, "effect_size": 2.0, "n_replicates": 2})
    assert r.status_code == 200 and 0 <= r.json()["summary"]["power"] <= 1


def test_validation_endpoint():
    r = client.get("/validation/nist")
    assert r.status_code == 200
    assert r.json()["summary"]["all_passed"] is True


def test_recommend_endpoint():
    r = client.post("/recommend", json={
        "phase": "analyze",
        "history": [{"id": "c1", "kind": "capability", "summary": {"cpk": 0.8, "cp": 0.85}},
                    {"id": "cc1", "kind": "control_chart", "summary": {"violations": []}}],
    })
    assert r.status_code == 200
    s = r.json()["summary"]
    assert s["phase"] == "analyze"
    assert any(rec["key"] == "analyze.reduce_var" for rec in s["recommendations"])
    assert "gate" in s


def test_recommend_bad_phase_is_400():
    r = client.post("/recommend", json={"phase": "banana"})
    assert r.status_code == 400


def test_monte_carlo_endpoint():
    r = client.post("/stats/monte-carlo", json={
        "inputs": [{"name": "a", "params": {"mean": 10, "sd": 1}},
                   {"name": "b", "params": {"mean": 5, "sd": 2}}],
        "transfer": {"type": "sum"}, "n_runs": 20000, "lsl": 10, "usl": 20})
    assert r.status_code == 200
    s = r.json()["summary"]
    assert "sensitivity" in s and len(s["sensitivity"]) == 2
    assert '"chart_png"' not in r.text   # bytes converted to storage key


def test_monte_carlo_malicious_formula_is_400():
    r = client.post("/stats/monte-carlo", json={
        "inputs": [{"name": "a", "params": {"mean": 1, "sd": 1}}],
        "transfer": {"type": "formula", "expr": "__import__('os').system('x')"}})
    assert r.status_code == 400


def test_tolerance_stack_endpoint():
    r = client.post("/stats/tolerance-stack", json={
        "inputs": [{"name": "A", "nominal": 10, "tol": 0.1},
                   {"name": "B", "nominal": 20, "tol": 0.1}]})
    assert r.status_code == 200
    assert r.json()["summary"]["assembly_nominal"] == 30


def test_survey_endpoint():
    rs = np.random.RandomState(0); n = 120
    trait = rs.normal(3, 1, n)
    rows = [{f"q{j}": float(np.clip(round(trait[i] + rs.normal(0, 0.4)), 1, 5)) for j in range(5)}
            for i in range(n)]
    key = client.post("/materialize-rows", json={"rows": rows}).json()["rows_storage_key"]
    r = client.post("/stats/survey", json={"rows_storage_key": key, "items": [f"q{j}" for j in range(5)]})
    assert r.status_code == 200
    assert r.json()["summary"]["cronbach_alpha"] > 0.6
    assert '"chart_png"' not in r.text


def test_text_pareto_endpoint():
    rows = [{"c": t} for t in (["long wait time"] * 4 + ["rude staff"] * 2 + ["billing error"])]
    key = client.post("/materialize-rows", json={"rows": rows}).json()["rows_storage_key"]
    r = client.post("/stats/text-pareto", json={"rows_storage_key": key, "text_col": "c", "use_bigrams": False})
    assert r.status_code == 200
    assert r.json()["summary"]["n_comments"] == 7


def test_variance_budget_endpoint():
    rs = np.random.RandomState(0); n = 150
    op = rs.choice(["A", "B", "C"], n)
    rows = [{"y": float({"A": 0, "B": 3, "C": -3}[op[i]] + rs.normal()), "operator": op[i],
             "machine": ["M1", "M2"][i % 2]} for i in range(n)]
    key = client.post("/materialize-rows", json={"rows": rows}).json()["rows_storage_key"]
    r = client.post("/stats/variance-budget", json={"rows_storage_key": key, "response": "y", "factors": ["operator", "machine"]})
    assert r.status_code == 200
    assert r.json()["summary"]["largest_source"] == "operator"


def test_flow_endpoints():
    rows = [{"days": float(d), "tp": float(t)} for d, t in
            zip([1, 2, 3, 4, 5, 8, 13, 3, 2, 5], [4, 5, 6, 5, 4, 6, 5, 5, 4, 6])]
    key = client.post("/materialize-rows", json={"rows": rows}).json()["rows_storage_key"]
    r = client.post("/stats/cycle-time", json={"rows_storage_key": key, "time_col": "days"})
    assert r.status_code == 200 and r.json()["summary"]["sle_85"] > 0
    r = client.post("/stats/delivery-forecast", json={"rows_storage_key": key, "throughput_col": "tp", "backlog": 50})
    assert r.status_code == 200 and r.json()["summary"]["periods_to_complete"]["50"] > 0
    r = client.post("/stats/littles-law", json={"throughput": 5, "cycle_time": 4})
    assert r.status_code == 200 and r.json()["summary"]["wip"] == 20


def test_bad_input_is_400_not_500(dataset_key):
    # A 3-level categorical sent to a 2-level factorial raises ValueError in the
    # stats layer. The user must see a clean 400 with the reason — not a 500.
    r = client.post("/stats/doe", json={"rows_storage_key": dataset_key,
                                        "response": "y", "factors": ["g"]})
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:150]}"
    assert "2 levels" in r.json().get("detail", "").lower() or "level" in r.json().get("detail", "").lower()


@pytest.mark.parametrize("endpoint,params", [
    ("/stats/hypothesis", {"test": "one_sample_t", "column": "NOPE", "mu0": 0}),
    ("/stats/control_chart", {"kind": "I-MR", "column": "NOPE"}),
    ("/stats/posthoc", {"test": "tukey_hsd", "value_col": "NOPE", "group_col": "g"}),
    ("/stats/capability", {"column": "NOPE", "lsl": 0, "usl": 10}),
])
def test_wrong_column_is_400_not_500(dataset_key, endpoint, params):
    # Pointing an analysis at a non-existent column must be a clean 400 (KeyError
    # or ValueError), never an opaque 500.
    r = client.post(endpoint, json={"rows_storage_key": dataset_key, **params})
    assert r.status_code == 400, f"{endpoint} → {r.status_code}: {r.text[:150]}"
    assert "detail" in r.json()


def test_missing_required_field_is_422(dataset_key):
    # Omitting a required body field is a validation error (FastAPI → 422).
    r = client.post("/stats/regression", json={"rows_storage_key": dataset_key})
    assert r.status_code == 422


def test_gee_glmm_over_http():
    rs = np.random.RandomState(1)
    rows = []
    for s in range(25):
        u = rs.normal(0, 1.2)
        for _ in range(6):
            x = rs.normal(0, 1)
            p = 1 / (1 + np.exp(-(-0.3 + 0.8 * x + u)))
            rows.append({"yy": int(rs.rand() < p), "x": float(x), "subj": s})
    key = client.post("/materialize-rows", json={"rows": rows}).json()["rows_storage_key"]
    for method, extra in [("gee", {"family": "binomial", "cov_struct": "exchangeable"}),
                          ("glmm", {"family": "binomial"})]:
        r = client.post("/stats/mixed-effects", json={
            "rows_storage_key": key, "fixed": "yy ~ x", "group": "subj",
            "method": method, **extra})
        assert r.status_code == 200, f"{method} → {r.status_code}: {r.text[:160]}"
        assert r.json()["summary"]["method"] == method
