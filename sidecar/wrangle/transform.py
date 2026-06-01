"""In-app column transforms — the Minitab gap closed.

Operations supported:
    compute   — new column from a safe expression of existing columns
    recode    — replace values via a mapping (with optional default)
    retype    — coerce a column to number / int / date / boolean / string
    rename    — rename one column to another name
    drop      — drop one or more columns
    impute    — fill missing values via a strategy (mean / median / mode /
                forward fill / constant)
    filter    — keep rows matching a safe expression
    stack     — unpivot wide → long (id_vars + value_vars → variable, value)
    unstack   — pivot long → wide (id + variable + value → id × variable)
    log       — natural-log transform of a numeric column → new column
    boxcox    — Box-Cox transform of a numeric column → new column + λ
    standardize — z-score scaling of a numeric column → new column
    bin       — equal-width bucketing of a numeric column into categories

Each op takes a DataFrame + params dict, returns (transformed_df, meta).
Errors raise ValueError with a human-readable message.

Safety: `compute` and `filter` use a restricted expression evaluator
(no eval(), no __import__, etc.) — only arithmetic + math on column refs.
"""
from __future__ import annotations

import ast
import math
import operator as op

import numpy as np
import pandas as pd
from scipy import stats as sps


# ─── Safe expression evaluator ────────────────────────────────────────
#
# Used by `compute` and `filter`. Allows column refs (bare names), numbers,
# strings, arithmetic, comparisons, and a whitelisted set of math functions.
# Refuses anything else — no attribute access, no calls outside whitelist.

_BINOPS = {
    ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv,
    ast.FloorDiv: op.floordiv, ast.Mod: op.mod, ast.Pow: op.pow,
}
_CMPOPS = {
    ast.Eq: op.eq, ast.NotEq: op.ne, ast.Lt: op.lt, ast.LtE: op.le,
    ast.Gt: op.gt, ast.GtE: op.ge,
}
_BOOLOPS = {ast.And: lambda a, b: a & b, ast.Or: lambda a, b: a | b}
_UNARY = {ast.UAdd: op.pos, ast.USub: op.neg, ast.Not: op.invert}

_SAFE_FUNCS = {
    "abs": abs, "min": min, "max": max, "round": round,
    "sqrt": np.sqrt, "exp": np.exp, "log": np.log, "log10": np.log10,
    "log2": np.log2, "sin": np.sin, "cos": np.cos, "tan": np.tan,
    "floor": np.floor, "ceil": np.ceil,
    "isna": pd.isna, "notna": pd.notna,
    "where": np.where,
    "pi": math.pi, "e": math.e,
}


def _eval(node, df: pd.DataFrame):
    if isinstance(node, ast.Expression):
        return _eval(node.body, df)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Num):  # py<3.8 compat
        return node.n
    if isinstance(node, ast.Name):
        # Column reference, or whitelisted constant (pi, e)
        if node.id in df.columns:
            return df[node.id]
        if node.id in _SAFE_FUNCS:
            return _SAFE_FUNCS[node.id]
        raise ValueError(f"unknown name in expression: {node.id}")
    if isinstance(node, ast.BinOp):
        return _BINOPS[type(node.op)](_eval(node.left, df), _eval(node.right, df))
    if isinstance(node, ast.UnaryOp):
        return _UNARY[type(node.op)](_eval(node.operand, df))
    if isinstance(node, ast.Compare):
        left = _eval(node.left, df)
        result = None
        for cop, comparator in zip(node.ops, node.comparators):
            right = _eval(comparator, df)
            r = _CMPOPS[type(cop)](left, right)
            result = r if result is None else (result & r)
            left = right
        return result
    if isinstance(node, ast.BoolOp):
        vals = [_eval(v, df) for v in node.values]
        out = vals[0]
        for v in vals[1:]:
            out = _BOOLOPS[type(node.op)](out, v)
        return out
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _SAFE_FUNCS:
            raise ValueError(f"unsafe function call in expression")
        if node.keywords:
            raise ValueError("keyword arguments not supported in expressions")
        return _SAFE_FUNCS[node.func.id](*(_eval(a, df) for a in node.args))
    raise ValueError(f"unsupported expression node: {type(node).__name__}")


def safe_eval(expr: str, df: pd.DataFrame):
    """Evaluate `expr` against `df`. Returns a Series (or scalar). Raises
    ValueError on anything outside the safe subset."""
    if not isinstance(expr, str) or not expr.strip():
        raise ValueError("expression is empty")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ValueError(f"syntax error in expression: {e.msg}") from e
    return _eval(tree, df)


# ─── Op implementations ───────────────────────────────────────────────

def _op_compute(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { new_column: str, expression: str }"""
    name = params.get("new_column") or params.get("name")
    expr = params.get("expression")
    if not name or not expr:
        raise ValueError("compute requires new_column and expression")
    if name in df.columns and not params.get("overwrite"):
        raise ValueError(f"column {name!r} exists — pass overwrite:true to replace")
    result = safe_eval(expr, df)
    out = df.copy()
    out[name] = result
    return out, {"op": "compute", "new_column": name, "expression": expr,
                 "n_rows": int(len(out))}


def _op_recode(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { column: str, mapping: dict, default: any, new_column: str? }"""
    col = params.get("column")
    mapping = params.get("mapping") or {}
    if not col or not mapping:
        raise ValueError("recode requires column and mapping")
    if col not in df.columns:
        raise ValueError(f"unknown column: {col}")
    new_col = params.get("new_column") or col
    default = params.get("default")
    out = df.copy()
    # Map preserves dtype; ensure key types match by coercing keys to str.
    src = out[col].astype(str).map({str(k): v for k, v in mapping.items()})
    if default is not None:
        src = src.where(src.notna(), default)
    else:
        # Unmapped values pass through unchanged.
        src = src.where(src.notna(), out[col])
    out[new_col] = src
    n_mapped = int(out[col].astype(str).isin([str(k) for k in mapping]).sum())
    return out, {"op": "recode", "column": col, "new_column": new_col,
                 "n_mapped": n_mapped, "n_levels": len(mapping)}


def _op_retype(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { column: str, type: 'number'|'int'|'date'|'bool'|'string' }"""
    col = params.get("column")
    target = (params.get("type") or "").lower()
    if not col or not target:
        raise ValueError("retype requires column and type")
    if col not in df.columns:
        raise ValueError(f"unknown column: {col}")
    out = df.copy()
    before_null = int(out[col].isna().sum())
    if target in ("number", "float"):
        out[col] = pd.to_numeric(out[col], errors="coerce")
    elif target == "int":
        out[col] = pd.to_numeric(out[col], errors="coerce").astype("Int64")
    elif target in ("date", "datetime"):
        out[col] = pd.to_datetime(out[col], errors="coerce")
    elif target in ("bool", "boolean"):
        truthy = {"true", "yes", "y", "1", "t"}
        falsy  = {"false", "no", "n", "0", "f"}
        def _to_bool(v):
            s = str(v).strip().lower()
            if s in truthy: return True
            if s in falsy:  return False
            return pd.NA
        out[col] = out[col].map(_to_bool).astype("boolean")
    elif target == "string":
        out[col] = out[col].astype(str)
    else:
        raise ValueError(f"unknown target type: {target}")
    after_null = int(out[col].isna().sum())
    return out, {"op": "retype", "column": col, "type": target,
                 "n_coerced_to_null": after_null - before_null}


def _op_rename(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { mapping: { old: new, ... } } OR { from: str, to: str }"""
    if "from" in params and "to" in params:
        mapping = {params["from"]: params["to"]}
    else:
        mapping = params.get("mapping") or {}
    if not mapping:
        raise ValueError("rename requires mapping or from/to")
    unknown = [k for k in mapping if k not in df.columns]
    if unknown:
        raise ValueError(f"unknown columns: {unknown}")
    out = df.rename(columns=mapping)
    return out, {"op": "rename", "renamed": mapping}


def _op_drop(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { columns: list[str] }"""
    cols = params.get("columns") or ([params["column"]] if params.get("column") else [])
    if not cols:
        raise ValueError("drop requires columns")
    unknown = [c for c in cols if c not in df.columns]
    if unknown:
        raise ValueError(f"unknown columns: {unknown}")
    out = df.drop(columns=cols)
    return out, {"op": "drop", "columns": cols, "n_remaining": int(out.shape[1])}


def _op_impute(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { column: str, strategy: 'mean'|'median'|'mode'|'ffill'|'bfill'|'constant', value: any? }"""
    col = params.get("column")
    strategy = (params.get("strategy") or "mean").lower()
    if not col:
        raise ValueError("impute requires column")
    if col not in df.columns:
        raise ValueError(f"unknown column: {col}")
    out = df.copy()
    before_null = int(out[col].isna().sum())
    if strategy == "mean":
        out[col] = out[col].fillna(pd.to_numeric(out[col], errors="coerce").mean())
    elif strategy == "median":
        out[col] = out[col].fillna(pd.to_numeric(out[col], errors="coerce").median())
    elif strategy == "mode":
        mode = out[col].mode()
        if not mode.empty:
            out[col] = out[col].fillna(mode.iat[0])
    elif strategy == "ffill":
        out[col] = out[col].ffill()
    elif strategy == "bfill":
        out[col] = out[col].bfill()
    elif strategy == "constant":
        if "value" not in params:
            raise ValueError("impute constant requires value")
        out[col] = out[col].fillna(params["value"])
    else:
        raise ValueError(f"unknown strategy: {strategy}")
    after_null = int(out[col].isna().sum())
    return out, {"op": "impute", "column": col, "strategy": strategy,
                 "n_filled": before_null - after_null,
                 "n_remaining_null": after_null}


def _op_filter(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { expression: str }"""
    expr = params.get("expression")
    if not expr:
        raise ValueError("filter requires expression")
    mask = safe_eval(expr, df)
    if not isinstance(mask, (pd.Series, np.ndarray)):
        raise ValueError("filter expression must yield a boolean column")
    mask = pd.Series(mask).fillna(False).astype(bool)
    if len(mask) != len(df):
        raise ValueError("filter expression yielded wrong length")
    out = df.loc[mask.values].reset_index(drop=True)
    return out, {"op": "filter", "expression": expr,
                 "n_kept": int(len(out)), "n_dropped": int(len(df) - len(out))}


def _op_stack(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """Wide → long. params: { id_vars: list[str], value_vars: list[str],
    var_name: str?, value_name: str? }"""
    id_vars = params.get("id_vars") or []
    value_vars = params.get("value_vars") or []
    if not value_vars:
        raise ValueError("stack requires value_vars")
    out = pd.melt(df, id_vars=id_vars, value_vars=value_vars,
                  var_name=params.get("var_name", "variable"),
                  value_name=params.get("value_name", "value"))
    return out, {"op": "stack", "id_vars": id_vars, "value_vars": value_vars,
                 "n_rows": int(len(out))}


def _op_unstack(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """Long → wide. params: { id_vars: list[str], var_col: str, value_col: str,
    aggfunc: 'first'|'mean'|'sum'|... }"""
    id_vars = params.get("id_vars") or []
    var_col = params.get("var_col") or params.get("variable")
    val_col = params.get("value_col") or params.get("value")
    if not id_vars or not var_col or not val_col:
        raise ValueError("unstack requires id_vars, var_col, value_col")
    aggfunc = params.get("aggfunc", "first")
    out = df.pivot_table(index=id_vars, columns=var_col, values=val_col,
                         aggfunc=aggfunc).reset_index()
    out.columns.name = None
    return out, {"op": "unstack", "id_vars": id_vars, "n_cols": int(out.shape[1])}


def _op_log(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    col = params.get("column"); new_col = params.get("new_column") or f"log_{col}"
    if not col or col not in df.columns:
        raise ValueError("log requires existing column")
    x = pd.to_numeric(df[col], errors="coerce")
    if (x <= 0).any():
        # Shift so log is defined; report the shift in meta.
        shift = float(-(x.min()) + 1) if x.min() <= 0 else 0.0
        out = df.copy()
        out[new_col] = np.log(x + shift)
        return out, {"op": "log", "column": col, "new_column": new_col, "shift": shift}
    out = df.copy()
    out[new_col] = np.log(x)
    return out, {"op": "log", "column": col, "new_column": new_col, "shift": 0.0}


def _op_boxcox(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    col = params.get("column"); new_col = params.get("new_column") or f"bc_{col}"
    if not col or col not in df.columns:
        raise ValueError("boxcox requires existing column")
    x = pd.to_numeric(df[col], errors="coerce").dropna().to_numpy()
    if (x <= 0).any():
        raise ValueError("boxcox requires strictly positive values")
    y, lam = sps.boxcox(x)
    # Re-align to original index with NaN for non-positive rows.
    mapped = pd.Series(index=df.index, dtype=float)
    pos_mask = pd.to_numeric(df[col], errors="coerce") > 0
    mapped.loc[pos_mask] = y
    out = df.copy()
    out[new_col] = mapped
    return out, {"op": "boxcox", "column": col, "new_column": new_col, "lambda": float(lam)}


def _op_standardize(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    col = params.get("column"); new_col = params.get("new_column") or f"z_{col}"
    if not col or col not in df.columns:
        raise ValueError("standardize requires existing column")
    x = pd.to_numeric(df[col], errors="coerce")
    mu, sd = float(x.mean()), float(x.std(ddof=1))
    if sd == 0 or not np.isfinite(sd):
        raise ValueError("standardize: column has zero variance")
    out = df.copy()
    out[new_col] = (x - mu) / sd
    return out, {"op": "standardize", "column": col, "new_column": new_col,
                 "mean": mu, "stdev": sd}


def _op_bin(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """params: { column, new_column?, bins: int|list, labels?: list,
    strategy: 'equal_width'|'quantile' }"""
    col = params.get("column"); new_col = params.get("new_column") or f"{col}_bin"
    if not col or col not in df.columns:
        raise ValueError("bin requires existing column")
    bins = params.get("bins", 5)
    strategy = (params.get("strategy") or "equal_width").lower()
    labels = params.get("labels")
    x = pd.to_numeric(df[col], errors="coerce")
    if strategy == "quantile":
        cuts = pd.qcut(x, q=bins, labels=labels, duplicates="drop")
    else:
        cuts = pd.cut(x, bins=bins, labels=labels, include_lowest=True)
    out = df.copy()
    out[new_col] = cuts.astype(str).where(cuts.notna(), None)
    return out, {"op": "bin", "column": col, "new_column": new_col,
                 "strategy": strategy, "n_bins": (bins if isinstance(bins, int) else len(bins) - 1)}


# ─── Dispatch ─────────────────────────────────────────────────────────

def _op_mice(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """Multiple Imputation by Chained Equations — iterative regression-based
    imputation. The modern replacement for single-value mean/median fills.

    params:
        columns      : list of columns to impute (default: all numeric with NA)
        n_iterations : (default 10) — chained-equations rounds
        random_state : (default 42)

    Single-imputation variant: returns one completed dataset (not the full
    MI multiple-completion sample). Good enough for downstream stats with no
    propagation of imputation uncertainty.
    """
    try:
        from sklearn.experimental import enable_iterative_imputer   # noqa: F401
        from sklearn.impute import IterativeImputer
    except Exception as e:
        raise ValueError(f"MICE requires sklearn ≥ 0.22: {e}")
    cols = params.get("columns") or df.select_dtypes(include="number").columns.tolist()
    cols = [c for c in cols if c in df.columns and df[c].isna().any()]
    if not cols:
        return df.copy(), {"op": "mice", "n_imputed": 0,
                           "note": "no columns had missing values"}
    n_iter = int(params.get("n_iterations") or 10)
    rs = int(params.get("random_state") or 42)
    imp = IterativeImputer(max_iter=n_iter, random_state=rs)
    # Fit on the numeric subframe so non-numeric columns pass through.
    sub = df[cols].apply(pd.to_numeric, errors="coerce")
    imputed = imp.fit_transform(sub)
    out = df.copy()
    n_filled = 0
    for i, c in enumerate(cols):
        was_na = out[c].isna().sum()
        out[c] = imputed[:, i]
        n_filled += int(was_na)
    return out, {"op": "mice", "columns": cols,
                 "n_iterations": n_iter,
                 "n_filled": n_filled}


def _op_set_cell(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """Direct cell edit. params: { row: int, column: str, value }. Keeps a
    numeric column numeric where the value coerces."""
    col = params.get("column")
    if col not in df.columns:
        raise ValueError(f"unknown column: {col}")
    i = int(params.get("row", -1))
    if i < 0 or i >= len(df):
        raise ValueError(f"row {i} out of range (0..{len(df) - 1})")
    val = params.get("value")
    out = df.copy()
    if pd.api.types.is_numeric_dtype(out[col]):
        try:
            f = float(val); val = int(f) if f == int(f) else f
        except (TypeError, ValueError):
            pass
    out.iloc[i, out.columns.get_loc(col)] = val
    return out, {"op": "set_cell", "row": i, "column": col, "value": val}


_OPS = {
    "set_cell":    _op_set_cell,
    "compute":     _op_compute,
    "recode":      _op_recode,
    "retype":      _op_retype,
    "rename":      _op_rename,
    "drop":        _op_drop,
    "impute":      _op_impute,
    "filter":      _op_filter,
    "stack":       _op_stack,
    "unstack":     _op_unstack,
    "log":         _op_log,
    "boxcox":      _op_boxcox,
    "standardize": _op_standardize,
    "bin":         _op_bin,
    "mice":        _op_mice,
}


def apply(df: pd.DataFrame, *, op: str, params: dict | None = None) -> tuple[pd.DataFrame, dict]:
    """Apply a single transform op to df. Returns (new_df, meta_dict)."""
    if op not in _OPS:
        raise ValueError(f"unknown op: {op}. Available: {sorted(_OPS.keys())}")
    return _OPS[op](df, params or {})


# Module-level export so app.py can `from wrangle import transform`
__all__ = ["apply", "safe_eval"]
