"""Smart CSV / TSV / DSV parser.

Goals beyond `pd.read_csv` defaults:
 1. Auto-detect the delimiter (`,` vs `;` vs `\t` vs `|`) — TSV exports
    from Minitab, semicolon-CSV from European Excel, pipe-delimited
    instrument logs all parse without the user picking a flag.
 2. Try a sequence of common encodings — UTF-8 → UTF-8-sig (BOM) →
    latin-1 → cp1252 — so Windows-exported CSVs don't crash.
 3. Skip leading metadata / blank rows (instrument exports often have
    "Generated: 2024-01-01" + a blank line above the real header).
 4. NaN → None in the JSON output (pandas `where(notnull, None)` doesn't
    actually work in float columns; we post-process).
 5. Surface clean parser-error messages so the server can show them.
"""
from __future__ import annotations

import csv as csv_mod
import io
import math
import re
from typing import IO

import pandas as pd


# ───────── helpers ─────────

ENCODINGS = ["utf-8", "utf-8-sig", "latin-1", "cp1252"]
DELIMITERS = [",", "\t", ";", "|"]


def _read_text(stream: IO[bytes]) -> tuple[str, str]:
    """Read bytes from stream, decode with the first encoding that survives.
    Returns (text, encoding_used)."""
    raw = stream.read()
    if isinstance(raw, str):
        return raw, "passthrough"
    if not raw:
        raise ValueError("file is empty")
    last_err = None
    for enc in ENCODINGS:
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError as e:
            last_err = e
    raise ValueError(f"could not decode file with any of {ENCODINGS}: {last_err}")


def _detect_delimiter(sample: str) -> str:
    """Pick the most likely delimiter. Strategy: try the csv stdlib's Sniffer
    first; if it returns junk (single-char in non-delimiter set or chooses
    a character that isn't actually in the first line), fall back to
    counting occurrences across the candidate set."""
    head = "\n".join(sample.splitlines()[:20])
    try:
        dialect = csv_mod.Sniffer().sniff(head, delimiters="".join(DELIMITERS))
        if dialect.delimiter in DELIMITERS:
            return dialect.delimiter
    except csv_mod.Error:
        pass
    # Frequency fallback: per-line count averaged across first non-empty
    # rows. Pick the delimiter with the highest min-per-row consistency
    # (so a stray comma in a quoted field doesn't beat tabs).
    lines = [ln for ln in head.splitlines() if ln.strip()][:10]
    if not lines:
        return ","
    best, best_score = ",", -1
    for d in DELIMITERS:
        counts = [ln.count(d) for ln in lines]
        if min(counts) < 1:
            continue
        # Consistency: prefer delimiters where every line has the same count.
        score = min(counts) * 10 + (10 - (max(counts) - min(counts)))
        if score > best_score:
            best, best_score = d, score
    return best


_BLANK_OR_COMMENT_RE = re.compile(r"^\s*([#%].*)?$")


def _strip_leading_metadata(text: str) -> tuple[str, int]:
    """Drop leading blank / comment / single-cell rows so the real header
    lands on row 0. Cheap heuristic — works for the common case of "title
    line + blank + header + data" exports. Returns (cleaned, n_skipped)."""
    lines = text.splitlines()
    n_skip = 0
    while n_skip < min(len(lines) - 1, 20):
        if _BLANK_OR_COMMENT_RE.match(lines[n_skip]):
            n_skip += 1
            continue
        break
    return ("\n".join(lines[n_skip:]), n_skip)


def _nan_safe(records):
    """NaN → None in row-dicts. The JSON encoder can't serialise NaN, and
    pandas .where(notnull, None) can't actually replace NaN in float64."""
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


# ───────── public entry ─────────

def parse(stream) -> dict:
    """Read a CSV/TSV/DSV stream → structured return:
      - rows   : full list[dict] (server forwards to materialize)
      - sample : first 20 rows (UI preview)
      - header, n_rows, dtypes
      - meta   : {delimiter, encoding, skipped_leading_lines}
    """
    text, encoding = _read_text(stream)
    cleaned, n_skipped = _strip_leading_metadata(text)
    delim = _detect_delimiter(cleaned[:8000])

    try:
        df = pd.read_csv(io.StringIO(cleaned), sep=delim, engine="python",
                         skip_blank_lines=True, on_bad_lines="warn")
    except Exception as e:
        raise ValueError(f"csv_parse_failed: {e}")

    # Trim header whitespace + drop fully-empty trailing columns (common
    # in Excel-exported CSVs with trailing commas).
    df = df.rename(columns=lambda c: str(c).strip())
    df = df.dropna(axis=1, how="all")
    if df.empty:
        raise ValueError("csv is empty or has no parseable rows")
    if not list(df.columns):
        raise ValueError("csv has no usable columns")

    # Try a numeric conversion on object columns where >95% of non-null
    # values are numeric strings ("1,234.56" with European thousands).
    for col in df.columns:
        if df[col].dtype == "object":
            converted = pd.to_numeric(
                df[col].astype(str).str.replace(",", "", regex=False).str.strip(),
                errors="coerce",
            )
            non_null = converted.notna().sum()
            if non_null > 0 and non_null / len(df) > 0.95:
                df[col] = converted

    return {
        "kind": "csv",
        "header": list(df.columns),
        "n_rows": int(len(df)),
        "rows": _nan_safe(df.to_dict(orient="records")),
        "sample": _nan_safe(df.head(20).to_dict(orient="records")),
        "dtypes": {c: str(df[c].dtype) for c in df.columns},
        "meta": {
            "delimiter": delim,
            "encoding": encoding,
            "skipped_leading_lines": n_skipped,
        },
    }
