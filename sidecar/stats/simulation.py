"""Monte-Carlo simulation + tolerance analysis — DFSS capability prediction.

Given the statistical behaviour of each *input* (component dimension, process
parameter) and a transfer function Y = f(inputs), this predicts the
distribution and capability of the *output* before anything is built — and
ranks which inputs drive the output's variation (sensitivity). It's the
"design it right the first time" tool Minitab gates behind Workspace/Engage.

Deterministic: a fixed seed makes every run reproducible (on-brand; the
reproducibility hashes stay stable).

Two entry points:
  * monte_carlo(...)   — simulate N runs through a transfer function.
  * tolerance_stack(...) — analytic worst-case + RSS tolerance stack-up.

Security note: the optional `formula` transfer is evaluated by a hardened
AST walker that permits ONLY arithmetic over the named inputs and a small
whitelist of math functions — no attribute access, calls, names, or builtins.
"""
from __future__ import annotations

import ast
import io
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


# ───────── safe arithmetic formula evaluator ─────────

_ALLOWED_FUNCS = {
    "sqrt": np.sqrt, "exp": np.exp, "log": np.log, "log10": np.log10,
    "abs": np.abs, "sin": np.sin, "cos": np.cos, "tan": np.tan,
    "min": np.minimum, "max": np.maximum,
}
_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod)
_ALLOWED_UNARY = (ast.UAdd, ast.USub)


def _compile_formula(expr: str, var_names: set):
    """Parse `expr` and return a function (dict_of_arrays) -> array. Raises
    ValueError on anything outside the arithmetic whitelist."""
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ValueError(f"invalid formula: {e}")

    def _check(node):
        if isinstance(node, ast.Expression):
            _check(node.body)
        elif isinstance(node, ast.BinOp):
            if not isinstance(node.op, _ALLOWED_BINOPS):
                raise ValueError("operator not allowed in formula")
            _check(node.left); _check(node.right)
        elif isinstance(node, ast.UnaryOp):
            if not isinstance(node.op, _ALLOWED_UNARY):
                raise ValueError("unary operator not allowed")
            _check(node.operand)
        elif isinstance(node, ast.Call):
            if not (isinstance(node.func, ast.Name) and node.func.id in _ALLOWED_FUNCS):
                raise ValueError(f"only these functions are allowed: {sorted(_ALLOWED_FUNCS)}")
            if node.keywords:
                raise ValueError("keyword args not allowed in formula")
            for a in node.args:
                _check(a)
        elif isinstance(node, ast.Name):
            if node.id not in var_names and node.id not in _ALLOWED_FUNCS:
                raise ValueError(f"unknown name '{node.id}' in formula (inputs: {sorted(var_names)})")
        elif isinstance(node, ast.Constant):
            if not isinstance(node.value, (int, float)):
                raise ValueError("only numeric constants allowed")
        else:
            raise ValueError(f"disallowed expression element: {type(node).__name__}")

    _check(tree)
    code = compile(tree, "<formula>", "eval")

    def run(env: dict):
        return eval(code, {"__builtins__": {}}, {**_ALLOWED_FUNCS, **env})
    return run


# ───────── input sampling ─────────

def _sample(rng, dist: str, params: dict, n: int):
    d = (dist or "normal").lower()
    if d == "normal":
        return rng.normal(params.get("mean", 0.0), params.get("sd", 1.0), n)
    if d == "uniform":
        lo, hi = params.get("low", 0.0), params.get("high", 1.0)
        return rng.uniform(lo, hi, n)
    if d == "triangular":
        return rng.triangular(params["low"], params.get("mode", (params["low"] + params["high"]) / 2), params["high"], n)
    if d == "lognormal":
        return rng.lognormal(params.get("mean", 0.0), params.get("sd", 1.0), n)
    if d == "exponential":
        return rng.exponential(params.get("scale", 1.0), n)
    raise ValueError(f"unknown input distribution: {dist}")


def _png(fig):
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)
    return buf.getvalue()


def monte_carlo(inputs: list, transfer: dict, n_runs: int = 10000,
                lsl: float | None = None, usl: float | None = None,
                target: float | None = None, seed: int = 20260531) -> dict:
    """Propagate input variation through a transfer function.

    inputs:   [{name, dist, params:{...}}]
    transfer: {"type":"sum"} | {"type":"linear","coeffs":{name:c},"const":k}
              | {"type":"formula","expr":"a*b + c"}
    """
    if not inputs:
        raise ValueError("provide at least one input variable")
    n_runs = int(max(1000, min(n_runs, 1_000_000)))
    rng = np.random.RandomState(seed)
    names = [i["name"] for i in inputs]
    if len(set(names)) != len(names):
        raise ValueError("input names must be unique")
    samples = {i["name"]: _sample(rng, i.get("dist", "normal"), i.get("params", {}), n_runs)
               for i in inputs}

    ttype = (transfer or {}).get("type", "sum")
    if ttype == "sum":
        Y = np.zeros(n_runs)
        for nm in names:
            Y = Y + samples[nm]
    elif ttype == "linear":
        coeffs = transfer.get("coeffs", {})
        Y = np.full(n_runs, float(transfer.get("const", 0.0)))
        for nm in names:
            Y = Y + float(coeffs.get(nm, 1.0)) * samples[nm]
    elif ttype == "formula":
        run = _compile_formula(transfer.get("expr", ""), set(names))
        Y = np.asarray(run(samples), dtype=float)
        if Y.shape != (n_runs,):
            Y = np.broadcast_to(Y, (n_runs,)).astype(float)
    else:
        raise ValueError(f"unknown transfer type: {ttype}")

    Y = Y[np.isfinite(Y)]
    if Y.size < 2:
        raise ValueError("transfer produced no finite output — check the formula/inputs")
    mean, sd = float(np.mean(Y)), float(np.std(Y, ddof=1))
    pct = {p: float(np.percentile(Y, p)) for p in (0.135, 2.5, 50, 97.5, 99.865)}

    # Capability of the predicted output (if spec given).
    cap = None
    if (lsl is not None or usl is not None) and sd > 0:
        cpu = (usl - mean) / (3 * sd) if usl is not None else None
        cpl = (mean - lsl) / (3 * sd) if lsl is not None else None
        cpk = min([v for v in (cpu, cpl) if v is not None]) if (cpu is not None or cpl is not None) else None
        cp = ((usl - lsl) / (6 * sd)) if (lsl is not None and usl is not None) else None
        below = float(np.mean(Y < lsl)) if lsl is not None else 0.0
        above = float(np.mean(Y > usl)) if usl is not None else 0.0
        dpmo = (below + above) * 1_000_000
        cap = {"cp": cp, "cpk": cpk, "cpu": cpu, "cpl": cpl,
               "predicted_dpmo": dpmo, "predicted_yield_pct": 100.0 * (1 - (below + above))}

    # Sensitivity: each input's share of output variance.
    # Linear/sum → analytic (coef·σ)². Formula → squared Pearson corr (normalised).
    contributions = []
    var_y = float(np.var(Y, ddof=1))
    if ttype in ("sum", "linear") and var_y > 0:
        coeffs = transfer.get("coeffs", {}) if ttype == "linear" else {}
        total = 0.0
        raw = {}
        for nm in names:
            c = float(coeffs.get(nm, 1.0))
            v = (c * float(np.std(samples[nm], ddof=1))) ** 2
            raw[nm] = v; total += v
        for nm in names:
            contributions.append({"name": nm, "contribution_pct": 100.0 * raw[nm] / total if total else 0.0})
    else:
        sq = {}
        tot = 0.0
        for nm in names:
            xv = samples[nm][:Y.size]
            if np.std(xv) > 0:
                r = float(np.corrcoef(xv, Y)[0, 1])
            else:
                r = 0.0
            sq[nm] = r * r; tot += r * r
        for nm in names:
            contributions.append({"name": nm, "contribution_pct": 100.0 * sq[nm] / tot if tot else 0.0})
    contributions.sort(key=lambda d: -d["contribution_pct"])

    # Output histogram with spec lines.
    fig, ax = plt.subplots(figsize=(7.5, 4))
    ax.hist(Y, bins=60, color="#c9a24b", alpha=0.85)
    if lsl is not None: ax.axvline(lsl, ls="--", color="#c0504d", label=f"LSL={lsl}")
    if usl is not None: ax.axvline(usl, ls="--", color="#c0504d", label=f"USL={usl}")
    if target is not None: ax.axvline(target, ls=":", color="#3a7ca5", label=f"Target={target}")
    ax.axvline(mean, color="#333", lw=1, label=f"mean={mean:.3g}")
    ax.set_title("Monte-Carlo predicted output distribution")
    ax.set_xlabel("Output (Y)"); ax.set_ylabel("frequency"); ax.legend(fontsize=8)

    return {"summary": {
        "method": "monte_carlo", "n_runs": n_runs, "transfer": ttype,
        "mean": mean, "sd": sd, "percentiles": pct,
        "capability": cap,
        "sensitivity": contributions,
        "lsl": lsl, "usl": usl, "target": target,
        "note": "Predicted output before build. Sensitivity ranks which inputs drive output variation — attack the top contributors first.",
    }, "chart_png": _png(fig)}


def tolerance_stack(inputs: list, method: str = "both",
                    lsl: float | None = None, usl: float | None = None) -> dict:
    """Analytic linear tolerance stack-up.

    inputs: [{name, nominal, tol, coeff?}]  — tol is the ± half-tolerance.
    Worst-case: Σ|coeff|·tol. RSS: sqrt(Σ(coeff·tol)²) (assumes independent,
    ~normal, ±3σ tolerances). Returns assembly nominal ± both stacks, and
    predicted Cpk vs spec if given (RSS basis)."""
    if not inputs:
        raise ValueError("provide at least one component")
    nominal = 0.0
    wc = 0.0
    rss_sq = 0.0
    rows = []
    for c in inputs:
        coeff = float(c.get("coeff", 1.0))
        nom = float(c["nominal"]); tol = abs(float(c["tol"]))
        nominal += coeff * nom
        wc += abs(coeff) * tol
        rss_sq += (coeff * tol) ** 2
        rows.append({"name": c.get("name", "?"), "nominal": nom, "tol": tol, "coeff": coeff,
                     "rss_share_pct": (coeff * tol) ** 2})
    rss = math.sqrt(rss_sq)
    tot = sum(r["rss_share_pct"] for r in rows) or 1.0
    for r in rows:
        r["rss_share_pct"] = 100.0 * r["rss_share_pct"] / tot

    out = {"assembly_nominal": nominal,
           "worst_case_tol": wc, "rss_tol": rss,
           "worst_case_interval": [nominal - wc, nominal + wc],
           "rss_interval": [nominal - rss, nominal + rss],
           "components": sorted(rows, key=lambda d: -d["rss_share_pct"]),
           "method": method}
    if lsl is not None and usl is not None and rss > 0:
        # RSS tol ≈ 3σ_assembly → σ = rss/3.
        sigma = rss / 3.0
        out["cpk_rss"] = min((usl - nominal), (nominal - lsl)) / (3 * sigma)
        out["cp_rss"] = (usl - lsl) / (6 * sigma)
    return {"summary": out}
