"""Pull every sheet, every contiguous table, into structured form.

Returns a JSON-serializable dict the wrangler agent can reason over.
"""
from __future__ import annotations

import math
import openpyxl
import pandas as pd


def _nan_safe(records):
    """NaN → None in row-dicts (Starlette JSON encoder can't handle NaN)."""
    out = []
    for rec in records:
        clean = {}
        for k, v in rec.items():
            if isinstance(v, float) and math.isnan(v):
                clean[k] = None
            else:
                clean[k] = v
        out.append(clean)
    return out


def parse(stream) -> dict:
    wb = openpyxl.load_workbook(stream, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            sheets.append({"name": ws.title, "tables": []})
            continue
        # Heuristic: first non-empty row = header.
        header_idx = next((i for i, r in enumerate(rows) if any(c is not None for c in r)), 0)
        header = [str(c) if c is not None else f"col_{i}" for i, c in enumerate(rows[header_idx])]
        body = rows[header_idx + 1:]
        df = pd.DataFrame(body, columns=header).dropna(how="all")
        sheets.append({
            "name": ws.title,
            "tables": [{
                "header": header,
                "n_rows": int(len(df)),
                # Full rows for materialize; sample for cheap UI preview.
                # Both keys are required so the server doesn't reject the
                # upload as `no_rows_extracted`. NaN → None to keep the
                # JSON encoder happy on columns with missing values.
                "rows": _nan_safe(df.to_dict(orient="records")),
                "sample": _nan_safe(df.head(20).to_dict(orient="records")),
                "dtypes": {c: str(df[c].dtype) for c in df.columns},
            }],
        })
    # Top-level convenience: also expose the first sheet's first table
    # as `rows` so a single-sheet workbook follows the same shape as CSV.
    top_rows = sheets[0]["tables"][0]["rows"] if sheets and sheets[0]["tables"] else []
    return {"kind": "excel", "sheets": sheets, "rows": top_rows}
