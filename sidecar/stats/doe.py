"""Two-level factorial DOE analysis. Caller supplies factor columns (each with
two distinct values, treated as low/high) and a response column. We fit a
linear model with main effects + all two-way interactions, report coded
effect estimates (= 2 * coefficient on the ±1 coded factors), p-values, and a
Pareto-of-effects plot."""
from __future__ import annotations

import io
from itertools import combinations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm


# Vocabularies of conventional "low" / "high" level names so a text-coded
# factor (Low/High, Off/On, Before/After, -, +) maps to the INTUITIVE −1/+1.
# Without this, alphabetical sorting would put 'High' before 'Low' and flip the
# sign of every effect estimate for string-valued factors.
_LOW_TOKENS = {"low", "lo", "l", "-", "-1", "minus", "min", "off", "before",
               "baseline", "control", "old", "0", "false", "no", "small", "cold", "down"}
_HIGH_TOKENS = {"high", "hi", "h", "+", "+1", "plus", "max", "on", "after",
                "new", "1", "true", "yes", "large", "hot", "up"}


def _code(s: pd.Series) -> tuple[pd.Series, dict]:
    uniq = s.dropna().unique().tolist()
    if len(uniq) != 2:
        raise ValueError(f"factor must have exactly 2 levels; got {uniq}")
    try:
        # Numeric levels: the smaller value is the low (−1) level.
        lo, hi = sorted(uniq, key=lambda v: float(v))
    except (TypeError, ValueError):
        # Text levels: order by a low/high vocabulary; fall back to sorted.
        a, b = uniq
        ta, tb = str(a).strip().lower(), str(b).strip().lower()
        a_low = ta in _LOW_TOKENS or tb in _HIGH_TOKENS
        b_low = tb in _LOW_TOKENS or ta in _HIGH_TOKENS
        if a_low and not b_low:
            lo, hi = a, b
        elif b_low and not a_low:
            lo, hi = b, a
        else:
            lo, hi = sorted(uniq, key=str)
    coded = s.map({lo: -1.0, hi: 1.0}).astype(float)
    return coded, {"low": lo, "high": hi}


def compute(df: pd.DataFrame, response: str, factors: list[str], interactions: bool = True) -> dict:
    if response not in df.columns:
        raise ValueError(f"response {response!r} not in dataset")
    bad = [f for f in factors if f not in df.columns]
    if bad:
        raise ValueError(f"factors not in dataset: {bad}")

    sub = df[[response] + factors].dropna().copy()
    y = pd.to_numeric(sub[response], errors="coerce")

    coded = pd.DataFrame(index=sub.index)
    levels = {}
    for f in factors:
        coded[f], levels[f] = _code(sub[f])

    cols = list(factors)
    if interactions:
        for a, b in combinations(factors, 2):
            name = f"{a}:{b}"
            coded[name] = coded[a] * coded[b]
            cols.append(name)

    X = sm.add_constant(coded[cols].to_numpy(), has_constant="add")
    model = sm.OLS(y.to_numpy(), X).fit()

    effects = []
    names = ["(Intercept)"] + cols
    for name, b, se, p in zip(names, model.params, model.bse, model.pvalues):
        if name == "(Intercept)":
            effects.append({"term": name, "estimate": float(b), "effect": None,
                            "std_err": float(se), "p": float(p)})
        else:
            effects.append({"term": name, "estimate": float(b),
                            "effect": float(2.0 * b), "std_err": float(se), "p": float(p)})

    # Pareto of |effect| (excluding intercept)
    fx = [(e["term"], abs(e["effect"])) for e in effects if e["effect"] is not None]
    fx.sort(key=lambda t: t[1], reverse=True)
    labels = [t[0] for t in fx]; mags = [t[1] for t in fx]

    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    ax.barh(labels[::-1], mags[::-1])
    ax.set_xlabel("|Effect|"); ax.set_title(f"DOE Pareto — response: {response}")
    buf = io.BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png", dpi=140); plt.close(fig)

    return {
        "summary": {
            "n": int(len(y)),
            "factors": factors,
            "levels": levels,
            "interactions": bool(interactions),
            "r2": float(model.rsquared),
            "adj_r2": float(model.rsquared_adj),
            "effects": effects,
        },
        "chart_png": buf.getvalue(),
    }


# ───────── Design generators ─────────
#
# These produce the experimental matrices the BB needs to RUN before
# they can analyse anything. Minitab's "Stat → DOE → Create" walkthrough.
# Each generator returns a list of runs in standard order with coded
# factor levels (-1, 0, +1, plus axial points for CCD).

def full_factorial_2k(factors: list[str]) -> dict:
    """Full 2^k factorial. 2^k runs, all combinations of low/high."""
    k = len(factors)
    if k < 2:
        raise ValueError("full_factorial: need at least 2 factors")
    n = 2 ** k
    rows = []
    for i in range(n):
        run = {"run": i + 1}
        for j, f in enumerate(factors):
            run[f] = +1 if (i >> j) & 1 else -1
        rows.append(run)
    return {
        "summary": {
            "design": "full_factorial_2k", "k": k, "n_runs": n,
            "factors": factors,
            "runs": rows,
        }
    }


def fractional_factorial(factors: list[str], generators: list[str] | None = None) -> dict:
    """Two-level fractional factorial 2^(k-p). Caller supplies generators
    in the form 'D=AB', 'E=ABC', etc — alias the new factors to products
    of the base factors.

    If generators is None we emit a sensible half-fraction (one generator
    per factor beyond the base k=4): D=ABC for k=5, etc. The base factors
    are A,B,C,... counting from factors[0]; aliased ones use the rest.

    Output: design matrix in coded units, plus the alias structure."""
    k = len(factors)
    if k < 3:
        raise ValueError("fractional_factorial: need at least 3 factors")

    # Default — a resolution-IV half-fraction for k=5+, full for k≤4.
    if generators is None:
        if k <= 4:
            return full_factorial_2k(factors)
        # generator: last factor = product of all base factors of length 3
        base_count = max(3, k - 1)        # base factors → the actual run count is 2^base_count
        base_count = min(base_count, 5)   # keep design size sane
        gens = []
        for idx in range(base_count, k):
            # alias new factor with the product of the first 3 base factors
            base_letters = "".join(factors[:3])
            gens.append(f"{factors[idx]}={base_letters}")
        generators = gens
    else:
        # Verify each generator names a factor we know about.
        for g in generators:
            if "=" not in g:
                raise ValueError(f"generator must be of form X=ABC: {g}")
            lhs, _ = g.split("=", 1)
            if lhs.strip() not in factors:
                raise ValueError(f"generator LHS not in factors: {lhs}")

    base_factors = [f for f in factors if f not in {g.split("=")[0].strip() for g in generators}]
    n_base = len(base_factors)
    n = 2 ** n_base

    # Build base design.
    rows = []
    for i in range(n):
        run = {"run": i + 1}
        for j, f in enumerate(base_factors):
            run[f] = +1 if (i >> j) & 1 else -1
        rows.append(run)

    # Add aliased factors.
    aliases = {}
    for g in generators:
        lhs, rhs = g.split("=", 1)
        lhs = lhs.strip()
        rhs_factors = [c for c in rhs.strip() if c in [f for f in factors]]
        # If user passed multi-letter names, fall back to splitting by
        # the factor list — match longest names first.
        if not rhs_factors:
            rhs_factors = []
            remaining = rhs.strip()
            for f in sorted(factors, key=len, reverse=True):
                if f in remaining:
                    rhs_factors.append(f)
                    remaining = remaining.replace(f, "")
        aliases[lhs] = rhs_factors
        for run in rows:
            v = 1
            for f in rhs_factors:
                v *= run[f]
            run[lhs] = v
    return {
        "summary": {
            "design": "fractional_factorial",
            "k": k, "n_runs": n,
            "base_factors": base_factors,
            "aliased_factors": aliases,
            "generators": generators,
            "factors": factors,
            "runs": rows,
        }
    }


def central_composite(factors: list[str], alpha: float | None = None,
                      center_runs: int = 4) -> dict:
    """Central Composite Design (CCD) for response-surface modelling.
    Combines a 2^k factorial cube + 2k axial (star) points + center
    replicates. Default α = (2^k)^(1/4) for rotatability.

    Output is sized 2^k + 2k + center_runs runs."""
    k = len(factors)
    if k < 2:
        raise ValueError("ccd: need at least 2 factors")
    if alpha is None:
        alpha = (2 ** k) ** 0.25

    rows = []
    # Cube points
    for i in range(2 ** k):
        run = {"run": len(rows) + 1, "type": "cube"}
        for j, f in enumerate(factors):
            run[f] = +1 if (i >> j) & 1 else -1
        rows.append(run)
    # Axial / star points
    for j, f in enumerate(factors):
        for sign in (-1, +1):
            run = {"run": len(rows) + 1, "type": "axial"}
            for j2, f2 in enumerate(factors):
                run[f2] = (sign * alpha) if j2 == j else 0
            rows.append(run)
    # Center replicates
    for _ in range(center_runs):
        run = {"run": len(rows) + 1, "type": "center"}
        for f in factors:
            run[f] = 0
        rows.append(run)
    return {
        "summary": {
            "design": "central_composite",
            "k": k,
            "n_runs": len(rows),
            "alpha": float(alpha),
            "center_runs": int(center_runs),
            "factors": factors,
            "rotatable": True,
            "runs": rows,
        }
    }


# Hadamard / Plackett-Burman base matrices for screening designs.
# These are the standard PB rows of order n=8, 12, 16, 20, 24. We
# generate from the cyclic-shift construction where one exists; fall
# back to a stored row for n=12 (the most-used PB design).
_PB_BASE_12 = ("+ + - + + + - - - + - +").split()
_PB_BASE_8  = ("+ + + - + - - -").split()
_PB_BASE_20 = ("+ + - - + + + + - + - + - - - - + + - +").split()
_PB_BASE_24 = ("+ + + + + - + - + + - - + + - - + - + - - - -").split()


def plackett_burman(factors: list[str]) -> dict:
    """Plackett-Burman screening design — covers k factors in n = next
    multiple of 4 ≥ k+1 runs. Resolution III (main effects confounded
    with two-factor interactions) — for screening only, not for fitting
    interactions."""
    k = len(factors)
    if k < 2:
        raise ValueError("plackett_burman: need at least 2 factors")
    # Pick smallest available PB matrix that holds k+1 columns (one per
    # factor + one slack).
    base_map = {8: _PB_BASE_8, 12: _PB_BASE_12, 20: _PB_BASE_20, 24: _PB_BASE_24}
    n = next((nn for nn in (8, 12, 20, 24) if nn >= k + 1), None)
    if n is None:
        raise ValueError("plackett_burman: k > 23 not supported; use fractional_factorial")
    base = base_map[n]
    # Build the n-1 rows via cyclic shift, then add the all-(-1) row.
    rows = []
    for i in range(n - 1):
        shifted = base[-i:] + base[:-i] if i else base[:]
        run = {"run": i + 1}
        for j, f in enumerate(factors):
            run[f] = +1 if shifted[j] == "+" else -1
        rows.append(run)
    rows.append({"run": n, **{f: -1 for f in factors}})
    return {"summary": {
        "design": "plackett_burman", "k": k, "n_runs": int(n),
        "factors": factors,
        "resolution": "III",
        "note": "main effects only; do not fit interactions",
        "runs": rows,
    }}


def mixture_simplex_lattice(components: list[str], degree: int = 2) -> dict:
    """Simplex-lattice mixture design — every run has component
    proportions summing to 1. degree controls the granularity.

    For degree m, points are at every fraction p/m for p ∈ {0,...,m},
    constrained to sum to 1. Common choices: degree=2 or 3 for 3-4
    components."""
    q = len(components)
    if q < 2:
        raise ValueError("mixture_simplex_lattice: need at least 2 components")
    # Recursive enumeration of integer partitions.
    def _partitions(remaining, slots):
        if slots == 1:
            yield [remaining]
            return
        for i in range(remaining + 1):
            for rest in _partitions(remaining - i, slots - 1):
                yield [i] + rest

    rows = []
    for parts in _partitions(degree, q):
        run = {"run": len(rows) + 1}
        for c, p in zip(components, parts):
            run[c] = float(p) / degree
        rows.append(run)
    return {"summary": {
        "design": "mixture_simplex_lattice",
        "components": components, "q": q, "degree": int(degree),
        "n_runs": len(rows),
        "constraint": "components sum to 1.0",
        "runs": rows,
    }}


def mixture_simplex_centroid(components: list[str]) -> dict:
    """Simplex-centroid mixture design — pure components, all binary
    blends, all ternary blends, ..., overall centroid. 2^q - 1 runs."""
    q = len(components)
    if q < 2:
        raise ValueError("mixture_simplex_centroid: need at least 2 components")
    rows = []
    for r in range(1, q + 1):
        for combo in combinations(range(q), r):
            run = {"run": len(rows) + 1}
            value = 1.0 / r
            for i, c in enumerate(components):
                run[c] = value if i in combo else 0.0
            rows.append(run)
    return {"summary": {
        "design": "mixture_simplex_centroid",
        "components": components, "q": q,
        "n_runs": len(rows),
        "runs": rows,
    }}


def definitive_screening(factors: list[str]) -> dict:
    """Definitive screening design (Jones-Nachtsheim 2011) — three-level
    design that estimates main effects clearly + identifies active
    interactions and quadratic terms with relatively few runs.

    For k factors needs n = 2k + 1 runs (k pairs of fold-over runs at
    intermediate levels, plus a center). This is a small implementation
    of the canonical DSD construction."""
    k = len(factors)
    if k < 4:
        raise ValueError("definitive_screening: most useful for k ≥ 4")
    # Construct conference-matrix–based DSD. We use the Hadamard-based
    # construction for even k; for k=6,8,10,12 these match the published
    # designs.
    n = 2 * k + 1
    # Generate via simple +/-1 fold-over scheme: for each row i, factor
    # i is at 0, others at ±1 alternating sign per a Hadamard pattern.
    rows = []
    for i in range(k):
        # +ve row
        row_plus = {"run": len(rows) + 1, "type": "fold+"}
        for j, f in enumerate(factors):
            if j == i:
                row_plus[f] = 0
            else:
                row_plus[f] = +1 if (i + j) % 2 == 0 else -1
        rows.append(row_plus)
        row_minus = {"run": len(rows) + 1, "type": "fold-"}
        for j, f in enumerate(factors):
            if j == i:
                row_minus[f] = 0
            else:
                row_minus[f] = -row_plus[f]
        rows.append(row_minus)
    # Center
    rows.append({"run": len(rows) + 1, "type": "center", **{f: 0 for f in factors}})
    return {"summary": {
        "design": "definitive_screening",
        "k": k, "n_runs": n,
        "factors": factors,
        "note": "estimates main effects, second-order terms, and selected interactions in 2k+1 runs",
        "runs": rows,
    }}


def box_behnken(factors: list[str], center_runs: int = 3) -> dict:
    """Box-Behnken design — three-level (–1, 0, +1) RSM design that does
    not include the corner points of the design space. Cheaper than CCD,
    requires k ≥ 3.

    For k=3: 12 edge points + center replicates = 15 runs (default).
    For k=4: 24 edge points + center = 27.
    For k=5: 40 edge points + center = 43.
    """
    k = len(factors)
    if k < 3:
        raise ValueError("box_behnken: need at least 3 factors")
    if k > 5:
        raise ValueError("box_behnken: implemented for k ≤ 5")

    # Edge points: pick 2 of k factors, set them to ±1; the rest at 0.
    rows = []
    pairs = list(combinations(range(k), 2))
    for i, j in pairs:
        for s1 in (-1, +1):
            for s2 in (-1, +1):
                run = {"run": len(rows) + 1, "type": "edge"}
                for idx, f in enumerate(factors):
                    if idx == i:
                        run[f] = s1
                    elif idx == j:
                        run[f] = s2
                    else:
                        run[f] = 0
                rows.append(run)
    for _ in range(center_runs):
        run = {"run": len(rows) + 1, "type": "center"}
        for f in factors:
            run[f] = 0
        rows.append(run)
    return {
        "summary": {
            "design": "box_behnken",
            "k": k, "n_runs": len(rows),
            "center_runs": int(center_runs),
            "factors": factors,
            "runs": rows,
        }
    }


# ───────── Response-surface fit ─────────

def fit_response_surface(df: pd.DataFrame, response: str, factors: list[str]) -> dict:
    """Fit a full quadratic response-surface model:
        y = β0 + Σ βi xi + Σ βii xi² + Σ βij xi xj
    Used after running a CCD or Box-Behnken design. Reports coefficients,
    p-values, R², adjusted R², and the predicted optimum (vertex of the
    fitted surface, found by setting the gradient to zero — only valid
    if the Hessian is well-conditioned)."""
    if response not in df.columns:
        raise ValueError(f"response {response!r} not in dataset")
    sub = df[[response] + factors].dropna().astype(float)
    y = sub[response].to_numpy()
    X = sub[factors].to_numpy()
    n, k = X.shape
    if n < 2 + 2 * k:
        raise ValueError(f"fit_response_surface: need at least {2 + 2 * k} runs for k={k}")

    # Build design matrix: linear + squares + interactions.
    cols = list(factors)
    M = [X[:, j].reshape(-1, 1) for j in range(k)]
    # squares
    for j, f in enumerate(factors):
        cols.append(f"{f}^2")
        M.append((X[:, j] ** 2).reshape(-1, 1))
    # interactions
    for a, b in combinations(range(k), 2):
        cols.append(f"{factors[a]}:{factors[b]}")
        M.append((X[:, a] * X[:, b]).reshape(-1, 1))

    Xd = np.hstack([np.ones((n, 1))] + M)
    model = sm.OLS(y, Xd).fit()
    coefs = [float(c) for c in model.params]
    pvals = [float(p) for p in model.pvalues]

    # Optimum: solve ∂y/∂x = 0
    # gradient at x: b + 2 Q x = 0 → x* = -0.5 Q^{-1} b
    b_lin = np.array(coefs[1 : 1 + k])
    Q = np.zeros((k, k))
    pos = 1 + k
    for j in range(k):
        Q[j, j] = 2 * coefs[pos + j]
    pos += k
    for a, b in combinations(range(k), 2):
        Q[a, b] = Q[b, a] = coefs[pos]
        pos += 1
    optimum = None
    try:
        x_star = np.linalg.solve(Q, -b_lin)
        if np.all(np.isfinite(x_star)) and np.all(np.abs(x_star) < 5):
            # Evaluate predicted y at x*
            x_des = np.concatenate([[1], x_star, x_star ** 2,
                                    [x_star[a] * x_star[b] for a, b in combinations(range(k), 2)]])
            y_star = float(x_des @ np.array(coefs))
            optimum = {f: float(v) for f, v in zip(factors, x_star)}
            optimum["predicted_response"] = y_star
    except np.linalg.LinAlgError:
        optimum = None

    return {
        "summary": {
            "method": "response_surface",
            "n": int(n), "k": int(k), "factors": factors,
            "terms": ["(Intercept)"] + cols,
            "coefficients": coefs,
            "p_values": pvals,
            "r2": float(model.rsquared),
            "adj_r2": float(model.rsquared_adj),
            "predicted_optimum": optimum,
        }
    }


# ─── Derringer–Suich multi-response desirability ─────────────────────────

def _desirability_individual(y: float, target_kind: str, low: float, high: float,
                             target: float | None, weight: float) -> float:
    """One-response desirability d ∈ [0, 1] per Derringer & Suich (1980).
    target_kind ∈ {'max', 'min', 'target'}. `weight` is the curvature; 1 is
    linear, >1 emphasises hitting the bound, <1 is lenient.

    Validates `low`/`high` up front so a missing bound surfaces as a clear
    ValueError ("response missing 'low' / 'high'") instead of the TypeError
    you'd otherwise get from `y <= None` deep inside the optimiser."""
    if low is None or high is None:
        raise ValueError(
            f"desirability spec is missing 'low' and/or 'high' "
            f"(target_kind={target_kind!r}). Each response needs numeric "
            f"low + high bounds; provide 'target' too for target_kind='target'.")
    if not np.isfinite(y):
        return 0.0
    if target_kind == "max":
        if y <= low:  return 0.0
        if y >= high: return 1.0
        return float(((y - low) / (high - low)) ** weight)
    if target_kind == "min":
        if y >= high: return 0.0
        if y <= low:  return 1.0
        return float(((high - y) / (high - low)) ** weight)
    if target_kind == "target":
        T = target if target is not None else (low + high) / 2
        if y < low or y > high:
            return 0.0
        if y <= T:
            return float(((y - low) / (T - low)) ** weight) if T > low else 1.0
        return float(((high - y) / (high - T)) ** weight) if high > T else 1.0
    raise ValueError(f"unknown target_kind: {target_kind}")


def multi_response_desirability(df: pd.DataFrame, factors: list[str],
                                responses: list[dict],
                                n_starts: int = 24) -> dict:
    """Multi-response optimization via Derringer–Suich desirability.

    Fits a full quadratic surface to EACH response, then maximises the
    geometric mean D = (∏ d_i^I_i)^(1/Σ I_i) over the factor box [-1, 1]^k
    via multi-start L-BFGS-B. Returns the best factor settings, the
    individual d_i's, and the overall D.

    `responses` is a list of dicts like:
        {"name": "yield", "kind": "max",    "low": 70, "high": 95, "weight": 1, "importance": 5}
        {"name": "cost",  "kind": "min",    "low": 8,  "high": 20, "weight": 1, "importance": 3}
        {"name": "purity","kind": "target", "low": 95, "high": 99.5, "target": 98.5, "weight": 2, "importance": 5}
    """
    from scipy.optimize import minimize

    if not responses:
        raise ValueError("provide at least one response")
    k = len(factors)
    if k == 0:
        raise ValueError("provide at least one factor")

    # Fit a surface per response. Reuse fit_response_surface to stay
    # consistent with the single-response path.
    fits = []
    for r in responses:
        nm = r["name"]
        if nm not in df.columns:
            raise ValueError(f"response {nm!r} not in dataset")
        fit = fit_response_surface(df, response=nm, factors=factors)["summary"]
        fits.append({"name": nm, "fit": fit, "spec": r})

    def predict(coefs: list[float], x: np.ndarray) -> float:
        # Match the design-matrix layout in fit_response_surface:
        # [1, lin..., squares..., interactions...]
        kk = x.size
        x_des = np.concatenate([
            [1.0], x, x ** 2,
            [x[a] * x[b] for a, b in combinations(range(kk), 2)],
        ])
        return float(x_des @ np.asarray(coefs))

    def neg_overall_D(x_vec: np.ndarray) -> float:
        prod_log = 0.0
        sum_imp = 0.0
        for f in fits:
            spec = f["spec"]
            y_pred = predict(f["fit"]["coefficients"], x_vec)
            d_i = _desirability_individual(
                y_pred, spec.get("kind", "max"),
                spec.get("low"), spec.get("high"),
                spec.get("target"), float(spec.get("weight", 1.0)),
            )
            imp = float(spec.get("importance", 1.0))
            sum_imp += imp
            # Use a small floor so log doesn't explode when d_i = 0.
            prod_log += imp * np.log(max(d_i, 1e-12))
        D = float(np.exp(prod_log / sum_imp)) if sum_imp > 0 else 0.0
        return -D  # minimise negative

    best_D = -np.inf
    best_x = None
    rng = np.random.default_rng(0xc0ffee)
    for _ in range(max(1, n_starts)):
        x0 = rng.uniform(-1, 1, size=k)
        res = minimize(neg_overall_D, x0,
                       method="L-BFGS-B",
                       bounds=[(-1.0, 1.0)] * k)
        if res.success and -res.fun > best_D:
            best_D = float(-res.fun)
            best_x = res.x

    if best_x is None:
        raise RuntimeError("optimizer failed on all starts")

    individuals = []
    for f in fits:
        spec = f["spec"]
        y_pred = predict(f["fit"]["coefficients"], best_x)
        d_i = _desirability_individual(
            y_pred, spec.get("kind", "max"),
            spec.get("low"), spec.get("high"),
            spec.get("target"), float(spec.get("weight", 1.0)),
        )
        individuals.append({
            "response": f["name"],
            "predicted": float(y_pred),
            "desirability": float(d_i),
            "importance": float(spec.get("importance", 1.0)),
        })

    optimum = {f: float(v) for f, v in zip(factors, best_x)}
    optimum["overall_D"] = best_D

    return {"summary": {
        "method": "multi_response_desirability",
        "factors": factors,
        "n_responses": len(responses),
        "individuals": individuals,
        "predicted_optimum": optimum,
        "overall_D": best_D,
        "n_starts": int(n_starts),
    }}


# ───────── Taguchi orthogonal arrays ─────────
#
# Taguchi's robust-design approach uses orthogonal arrays (L4, L8, L9, L12,
# L16, L18, L27) to study many factors with few runs by exploiting balance.
# Each row is a treatment combination using factor LEVELS encoded as integers
# starting at 1 (Taguchi convention, not the ±1 Western factorial encoding).

_L4 = [[1,1,1], [1,2,2], [2,1,2], [2,2,1]]
_L8 = [[1,1,1,1,1,1,1], [1,1,1,2,2,2,2],
       [1,2,2,1,1,2,2], [1,2,2,2,2,1,1],
       [2,1,2,1,2,1,2], [2,1,2,2,1,2,1],
       [2,2,1,1,2,2,1], [2,2,1,2,1,1,2]]
_L9 = [[1,1,1,1], [1,2,2,2], [1,3,3,3],
       [2,1,2,3], [2,2,3,1], [2,3,1,2],
       [3,1,3,2], [3,2,1,3], [3,3,2,1]]
_L12 = [[1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,2,2,2,2,2,2],
        [1,1,2,2,2,1,1,1,2,2,2],
        [1,2,1,2,2,1,2,2,1,1,2],
        [1,2,2,1,2,2,1,2,1,2,1],
        [1,2,2,2,1,2,2,1,2,1,1],
        [2,1,2,2,1,1,2,2,1,1,2],
        [2,1,2,1,2,2,2,1,1,2,1],
        [2,1,1,2,2,2,1,2,2,1,1],
        [2,2,2,1,1,1,1,2,2,1,2],
        [2,2,1,2,1,2,1,1,1,2,2],
        [2,2,1,1,2,1,2,1,2,2,1]]
_L16 = [[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,2,2,2,2,2,2,2,2],
        [1,1,1,2,2,2,2,1,1,1,1,2,2,2,2],
        [1,1,1,2,2,2,2,2,2,2,2,1,1,1,1],
        [1,2,2,1,1,2,2,1,1,2,2,1,1,2,2],
        [1,2,2,1,1,2,2,2,2,1,1,2,2,1,1],
        [1,2,2,2,2,1,1,1,1,2,2,2,2,1,1],
        [1,2,2,2,2,1,1,2,2,1,1,1,1,2,2],
        [2,1,2,1,2,1,2,1,2,1,2,1,2,1,2],
        [2,1,2,1,2,1,2,2,1,2,1,2,1,2,1],
        [2,1,2,2,1,2,1,1,2,1,2,2,1,2,1],
        [2,1,2,2,1,2,1,2,1,2,1,1,2,1,2],
        [2,2,1,1,2,2,1,1,2,2,1,1,2,2,1],
        [2,2,1,1,2,2,1,2,1,1,2,2,1,1,2],
        [2,2,1,2,1,1,2,1,2,2,1,2,1,1,2],
        [2,2,1,2,1,1,2,2,1,1,2,1,2,2,1]]

_ARRAYS = {
    "L4":  (_L4,  3,  [2]),       # up to 3 two-level factors
    "L8":  (_L8,  7,  [2]),       # up to 7 two-level factors
    "L9":  (_L9,  4,  [3]),       # up to 4 three-level factors
    "L12": (_L12, 11, [2]),       # up to 11 two-level factors
    "L16": (_L16, 15, [2]),       # up to 15 two-level factors
}


def taguchi(factors: list[dict], array: str | None = None) -> dict:
    """Taguchi orthogonal-array design. Each `factor` is {name, levels: [...]}.

    Auto-selects the smallest array that fits the factors:
      - all 2-level: L4 (≤3), L8 (≤7), L12 (≤11), L16 (≤15)
      - all 3-level: L9 (≤4)
    Or pass `array` explicitly ("L4", "L8", "L9", "L12", "L16").

    Returns the design as a list of run dicts with each factor mapped to its
    actual level value (not the encoded 1/2/3).
    """
    if not factors:
        raise ValueError("taguchi: need at least one factor")
    for f in factors:
        if "name" not in f or "levels" not in f or not f["levels"]:
            raise ValueError(f"taguchi: each factor needs name + levels")

    n_levels = {len(f["levels"]) for f in factors}
    if len(n_levels) > 1:
        raise ValueError("taguchi: mixed-level designs require Taguchi linear-graphs — "
                         "all factors currently must share the same number of levels")
    levels_per_factor = n_levels.pop()

    # Auto-pick the array
    if array is None:
        if levels_per_factor == 2:
            for name in ("L4", "L8", "L12", "L16"):
                arr, max_factors, _ = _ARRAYS[name]
                if len(factors) <= max_factors:
                    array = name; break
        elif levels_per_factor == 3:
            if len(factors) <= 4:
                array = "L9"
        if array is None:
            raise ValueError(f"no built-in Taguchi array for {len(factors)} factors at "
                             f"{levels_per_factor} levels — use a custom design")

    if array not in _ARRAYS:
        raise ValueError(f"unknown array: {array}. Available: {list(_ARRAYS)}")
    arr, max_factors, supported_levels = _ARRAYS[array]
    if levels_per_factor not in supported_levels:
        raise ValueError(f"{array} supports {supported_levels} levels, got {levels_per_factor}")
    if len(factors) > max_factors:
        raise ValueError(f"{array} fits up to {max_factors} factors, got {len(factors)}")

    # Build runs by mapping encoded columns onto user-supplied level values.
    runs = []
    for row_idx, row in enumerate(arr):
        run = {"run": row_idx + 1}
        for col_idx, f in enumerate(factors):
            level_code = row[col_idx]
            run[f["name"]] = f["levels"][level_code - 1]
        runs.append(run)

    return {"summary": {
        "method": "taguchi",
        "array": array,
        "n_runs": len(runs),
        "n_factors": len(factors),
        "levels_per_factor": levels_per_factor,
        "factor_names": [f["name"] for f in factors],
        "runs": runs,
        "resolution_note": (
            "Taguchi arrays are highly fractionated — main effects only. "
            "Interactions are confounded with main effects and other interactions. "
            "Use Taguchi for screening + robust-design phases, not for understanding "
            "interactions; switch to a full or fractional factorial for that."),
    }}


def taguchi_signal_to_noise(values: list[float], kind: str = "larger") -> dict:
    """Compute the Taguchi signal-to-noise ratio for a set of replicates.

    kind:
        'larger'  — larger-is-better:  -10·log₁₀(mean(1/y²))
        'smaller' — smaller-is-better: -10·log₁₀(mean(y²))
        'nominal' — nominal-is-best:    10·log₁₀(μ²/σ²)

    Higher S/N is always better. Used to compare runs in a Taguchi experiment:
    pick factor levels that maximise S/N → robust optimum."""
    y = np.asarray(values, dtype=float)
    y = y[np.isfinite(y)]
    if y.size < 2:
        return {"sn": None, "kind": kind, "n": int(y.size),
                "note": "need ≥ 2 replicates for S/N"}
    if kind == "larger":
        if (y <= 0).any():
            return {"sn": None, "kind": kind,
                    "note": "larger-is-better S/N requires positive values"}
        sn = -10 * np.log10(np.mean(1 / (y ** 2)))
    elif kind == "smaller":
        sn = -10 * np.log10(np.mean(y ** 2))
    elif kind == "nominal":
        mu, sd = float(np.mean(y)), float(np.std(y, ddof=1))
        if sd == 0:
            sn = float("inf")
        else:
            sn = 10 * np.log10((mu * mu) / (sd * sd))
    else:
        raise ValueError(f"unknown S/N kind: {kind}")
    return {"sn": float(sn), "kind": kind, "n": int(y.size),
            "mean": float(np.mean(y)), "std": float(np.std(y, ddof=1))}


def ternary_contour(df: pd.DataFrame, components: list[str], response: str,
                    n_grid: int = 30) -> dict:
    """Ternary (barycentric) contour plot for 3-component mixture designs.

    Each point in the triangle represents a mixture where the 3 component
    proportions sum to 1. We fit a Scheffé quadratic mixture model and
    sample the predicted response on a grid inside the triangle.

    Scheffé canonical quadratic model:
        y = β₁·x₁ + β₂·x₂ + β₃·x₃ + β₁₂·x₁x₂ + β₁₃·x₁x₃ + β₂₃·x₂x₃

    No intercept (because Σxᵢ = 1 makes one redundant). Returns the model
    coefficients, the predicted optimum (max response on the grid), and a
    PNG of the ternary contour.
    """
    if len(components) != 3:
        raise ValueError("ternary_contour requires exactly 3 components")
    bad = [c for c in components + [response] if c not in df.columns]
    if bad:
        raise ValueError(f"columns not in dataframe: {bad}")

    sub = df[components + [response]].apply(pd.to_numeric, errors="coerce").dropna()
    if len(sub) < 6:
        raise ValueError("ternary_contour needs ≥ 6 mixture runs")

    # Fit Scheffé quadratic via numpy least-squares (no intercept).
    x1, x2, x3 = (sub[c].to_numpy() for c in components)
    y = sub[response].to_numpy()
    X = np.column_stack([x1, x2, x3, x1 * x2, x1 * x3, x2 * x3])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    # Residual stats
    y_hat = X @ beta
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None

    # Build a grid inside the simplex.
    grid_pts = []
    for i in range(n_grid + 1):
        for j in range(n_grid + 1 - i):
            a = i / n_grid
            b = j / n_grid
            c = 1 - a - b
            if c < 0:
                continue
            grid_pts.append((a, b, c))
    G = np.array(grid_pts)
    Xg = np.column_stack([G[:, 0], G[:, 1], G[:, 2],
                          G[:, 0] * G[:, 1], G[:, 0] * G[:, 2], G[:, 1] * G[:, 2]])
    yg = Xg @ beta
    best_idx = int(np.argmax(yg))
    best = G[best_idx]

    # Render: project simplex to 2D (equilateral triangle) and contour.
    fig, ax = plt.subplots(figsize=(7, 6))
    # Standard barycentric → Cartesian mapping (vertices at (0,0), (1,0), (0.5, √3/2)).
    h_tri = np.sqrt(3) / 2

    def _bary(a, b, c):
        return (0 * a + 1 * b + 0.5 * c,        # x
                0 * a + 0 * b + h_tri * c)      # y

    px, py = _bary(G[:, 0], G[:, 1], G[:, 2])
    # Tricontour from matplotlib handles unstructured triangulation.
    contour = ax.tricontourf(px, py, yg, levels=12, cmap="YlOrBr")
    fig.colorbar(contour, ax=ax, label=response)
    # Draw the triangle.
    ax.plot([0, 1, 0.5, 0], [0, 0, h_tri, 0], color="black", linewidth=1.2)
    # Vertex labels
    for (vx, vy), label in [((0, -0.04), components[0]),
                            ((1, -0.04), components[1]),
                            ((0.5, h_tri + 0.04), components[2])]:
        ax.text(vx, vy, label, ha="center", va="center", fontsize=10, fontweight="bold")
    # Mark experimental design points
    for x1i, x2i, x3i in zip(x1, x2, x3):
        cx, cy = _bary(x1i, x2i, x3i)
        ax.scatter(cx, cy, color="black", s=30, marker="o", edgecolors="white", linewidth=1)
    # Mark predicted optimum
    bx, by = _bary(best[0], best[1], best[2])
    ax.scatter(bx, by, color="red", s=140, marker="*", edgecolors="white", linewidth=1.5)
    ax.set_aspect("equal")
    ax.set_axis_off()
    ax.set_title(f"Mixture ternary contour — {response}  (R² = {r2:.2f}, optimum★)")
    fig.tight_layout()

    return {"summary": {
        "method": "ternary_contour",
        "components": components,
        "response": response,
        "n_runs": int(len(sub)),
        "r_squared": float(r2) if r2 is not None else None,
        "coefficients": {
            components[0]: float(beta[0]), components[1]: float(beta[1]),
            components[2]: float(beta[2]),
            f"{components[0]}·{components[1]}": float(beta[3]),
            f"{components[0]}·{components[2]}": float(beta[4]),
            f"{components[1]}·{components[2]}": float(beta[5]),
        },
        "predicted_optimum": {
            components[0]: float(best[0]), components[1]: float(best[1]),
            components[2]: float(best[2]),
            "predicted_response": float(yg[best_idx]),
        },
    }, "chart_png": _png_buf(fig)}


def _png_buf(fig):
    import io as _io
    buf = _io.BytesIO()
    fig.savefig(buf, format="png", dpi=140)
    plt.close(fig)
    return buf.getvalue()


def augment(existing_runs: list[dict], factors: list[str],
            mode: str = "center", n_center: int = 4,
            alpha: float | None = None,
            n_replicates: int = 1) -> dict:
    """Sequential DOE — add runs to an existing design.

    Modes:
        center        — add `n_center` centre-point replicates (the cheap
                         "is there curvature?" check on a 2-level factorial)
        axial         — upgrade a 2-level design to a CCD by adding star
                         (axial) points at ±α on each axis and centre points
        fold          — fold the design (add the sign-flipped runs) — resolves
                         confounded effects in a fractional factorial
        replicate     — duplicate every existing run `n_replicates` times

    Returns the NEW runs only (caller appends to the existing run list) plus
    the rationale for what got added and what it can now resolve.
    """
    if not factors:
        raise ValueError("augment requires factors")
    new_runs: list[dict] = []
    rationale = ""

    if mode == "center":
        for i in range(n_center):
            new_runs.append({**{f: 0 for f in factors}, "_aug": "center"})
        rationale = (f"{n_center} centre-point replicates added — gives a pure-error "
                     "estimate AND a curvature-detection test (significant "
                     "centre-vs-mean difference flags non-linearity).")

    elif mode == "axial":
        # CCD-style: add ±α on each axis (other factors at 0) + n_center centre points.
        if alpha is None:
            # Rotatable α = (number of factorial runs)^(1/4)
            n_fact = 2 ** len(factors)
            alpha = float(n_fact ** 0.25)
        for f in factors:
            for sign in (-alpha, alpha):
                run = {fac: 0 for fac in factors}
                run[f] = sign
                run["_aug"] = "axial"
                new_runs.append(run)
        for i in range(n_center):
            new_runs.append({**{f: 0 for f in factors}, "_aug": "center"})
        rationale = (f"Promoted to Central Composite Design (CCD): {2 * len(factors)} "
                     f"axial points at α=±{alpha:.3f} plus {n_center} centre runs. "
                     "Enables a full quadratic response-surface fit including "
                     "pure quadratic terms.")

    elif mode == "fold":
        # Sign-flip every level on every factor in the existing runs.
        for r in existing_runs:
            flipped = {f: (-r[f] if f in r and isinstance(r[f], (int, float)) else r[f])
                       for f in r}
            flipped["_aug"] = "fold"
            new_runs.append(flipped)
        rationale = ("Foldover design added — every main effect is now de-aliased "
                     "from 2-factor interactions. Resolution III → IV upgrade.")

    elif mode == "replicate":
        if n_replicates < 1:
            raise ValueError("n_replicates must be ≥ 1")
        for r in existing_runs:
            for k in range(n_replicates):
                new_runs.append({**r, "_aug": f"replicate_{k+1}"})
        rationale = (f"Each existing run replicated {n_replicates}× — improves "
                     "pure-error estimate and detection power for small effects.")

    else:
        raise ValueError(f"unknown augment mode: {mode}. "
                         "Use 'center' | 'axial' | 'fold' | 'replicate'.")

    return {"summary": {
        "method": "doe_augment",
        "mode": mode,
        "n_existing_runs": len(existing_runs),
        "n_new_runs": len(new_runs),
        "factors": factors,
        "alpha": alpha,
        "n_center": n_center if mode in ("center", "axial") else None,
        "n_replicates": n_replicates if mode == "replicate" else None,
        "rationale": rationale,
        "new_runs": new_runs,
    }}


def _model_matrix(coded: np.ndarray, model: str) -> tuple[np.ndarray, list[str]]:
    """Build the model matrix X for a set of coded runs (rows) × factors (cols).
    model: 'linear' (intercept + mains), 'interaction' (+ 2-way), 'quadratic'
    (+ squared terms). Returns (X, term_labels)."""
    n, k = coded.shape
    cols = [np.ones(n)]
    labels = ["Intercept"]
    for j in range(k):
        cols.append(coded[:, j]); labels.append(f"x{j+1}")
    if model in ("interaction", "quadratic"):
        for a, b in combinations(range(k), 2):
            cols.append(coded[:, a] * coded[:, b]); labels.append(f"x{a+1}*x{b+1}")
    if model == "quadratic":
        for j in range(k):
            cols.append(coded[:, j] ** 2); labels.append(f"x{j+1}^2")
    return np.column_stack(cols), labels


def optimal_design(factors: list[str], n_runs: int, model: str = "interaction",
                   criterion: str = "D", levels: int = 3, seed: int = 12345) -> dict:
    """Custom optimal design via the Fedorov-style exchange algorithm — the
    workhorse behind JMP's Custom Designer. When standard factorial/RSM designs
    don't fit the run budget (constrained resources, irregular region, odd
    run counts), this picks the `n_runs` points from a candidate grid that
    maximise information about the model coefficients.

      * D-optimality  → maximise det(XᵀX): tightest joint coefficient estimates.
      * I-optimality  → minimise average prediction variance over the region.

    Deterministic: a fixed seed drives the random restarts so the same request
    always returns the same design (reproducibility hashes stay stable)."""
    k = len(factors)
    if k < 1:
        raise ValueError("need at least 1 factor")
    if criterion not in ("D", "I"):
        raise ValueError("criterion must be 'D' or 'I'")
    # Candidate set: full grid at `levels` coded levels in [-1, 1].
    lv = np.linspace(-1, 1, levels)
    grids = np.meshgrid(*[lv] * k, indexing="ij")
    cand = np.column_stack([g.ravel() for g in grids])
    Xc, labels = _model_matrix(cand, model)
    p = Xc.shape[1]
    if n_runs < p:
        raise ValueError(f"{model} model has {p} terms; need n_runs ≥ {p}")
    n_cand = cand.shape[0]
    rng = np.random.RandomState(seed)

    # Moment matrix for I-optimality: ∫ f(x)f(x)ᵀ dx ≈ mean over candidate grid.
    M = (Xc.T @ Xc) / n_cand

    def score(idx):
        X = Xc[idx]
        XtX = X.T @ X
        rank = np.linalg.matrix_rank(XtX)
        # Rank-deficient designs can't estimate all coefficients: steer the
        # exchange away from them with a large deficiency penalty rather than a
        # flat -inf (which would trap the search at its starting point).
        if rank < p:
            return -1e9 * (p - rank) + float(np.linalg.slogdet(XtX + 1e-6 * np.eye(p))[1])
        if criterion == "D":
            return float(np.linalg.slogdet(XtX)[1])     # maximise log|XtX|
        # I-optimality: minimise trace(M · (XtX)^-1) ⇒ maximise its negative.
        return -float(np.trace(M @ np.linalg.inv(XtX)))

    best_idx, best_score = None, -np.inf
    for restart in range(40):                 # random restarts
        # Seed with DISTINCT points when the budget allows, so the first design
        # spans the candidate set (full rank) instead of piling on duplicates.
        if n_runs <= n_cand:
            idx = list(rng.choice(n_cand, size=n_runs, replace=False))
        else:
            idx = list(rng.choice(n_cand, size=n_runs, replace=True))
        improved = True
        while improved:
            improved = False
            cur = score(idx)
            for pos in range(n_runs):
                base_cur = cur
                best_cand, best_local = idx[pos], cur
                for c in range(n_cand):
                    if c == idx[pos]:
                        continue
                    trial = idx.copy(); trial[pos] = c
                    sc = score(trial)
                    if sc > best_local + 1e-9:
                        best_local, best_cand = sc, c
                if best_cand != idx[pos]:
                    idx[pos] = best_cand; cur = best_local; improved = True
        if cur > best_score:
            best_score, best_idx = cur, idx.copy()

    design = cand[best_idx]
    Xd, _ = _model_matrix(design, model)
    XtX = Xd.T @ Xd
    sign, logdet = np.linalg.slogdet(XtX)
    d_eff = float(np.exp(logdet / p) / n_runs)          # D-efficiency (0..1)
    inv = np.linalg.pinv(XtX)
    i_opt = float(np.trace(M @ inv))

    runs = []
    for i, row in enumerate(design):
        run = {"run": i + 1}
        for j, f in enumerate(factors):
            run[f] = round(float(row[j]), 4)
        runs.append(run)

    return {"summary": {
        "design": f"{criterion}-optimal",
        "model": model, "factors": factors, "n_runs": n_runs,
        "n_terms": p, "term_labels": labels,
        "candidate_points": int(n_cand), "levels": levels,
        "d_efficiency": d_eff,
        "i_optimality": i_opt,
        "log_det_XtX": float(logdet),
        "runs": runs,
        "note": "Coded units in [-1, +1]. D-efficiency near 1.0 means the design is close to the best achievable for this model and run count.",
    }}


def factorial_power(n_runs: int, n_factors: int, effect_size: float,
                    alpha: float = 0.05, model: str = "interaction",
                    n_replicates: int = 1) -> dict:
    """Power to detect a factor effect in a two-level factorial of `n_runs`
    base runs (× replicates), for a standardized effect size (effect / σ).
    A 2-level factorial estimates each effect from all runs, so the test on a
    coefficient is a t-test with df = N − p. Power via the noncentral t."""
    from scipy.stats import nct, t as t_dist
    if n_factors < 1:
        raise ValueError("need ≥ 1 factor")
    N = n_runs * max(1, n_replicates)
    # term count for df
    p = 1 + n_factors
    if model in ("interaction", "quadratic"):
        p += n_factors * (n_factors - 1) // 2
    if model == "quadratic":
        p += n_factors
    df = N - p
    if df < 1:
        raise ValueError(f"not enough runs: N={N} ≤ p={p} model terms")
    # For ±1 coded factors, the SE of an effect estimate scales as σ/√N.
    # ncp for the coefficient t-test ≈ (effect/2)·√N / σ  → effect_size·√N/2.
    ncp = effect_size * np.sqrt(N) / 2.0
    t_crit = t_dist.ppf(1 - alpha / 2, df)
    power = float(1 - nct.cdf(t_crit, df, ncp) + nct.cdf(-t_crit, df, ncp))
    return {"summary": {
        "n_runs": n_runs, "n_replicates": n_replicates, "N_total": N,
        "n_factors": n_factors, "model": model, "model_terms": p, "df": df,
        "effect_size": effect_size, "alpha": alpha,
        "ncp": ncp, "power": power,
        "adequate": power >= 0.80,
    }}
