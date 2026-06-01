"""Apply a wrangling plan to the project's artifacts:
   - read each source (Excel/CSV/PDF/screenshot-vision)
   - select the right table
   - rename via column_map
   - convert units
   - apply optional filter
   - concat across sources
   - flag outliers per the policy
   - write canonical parquet to S3, return its key
"""
from __future__ import annotations

import io
import uuid

import numpy as np
import pandas as pd


# Common unit conversions. The plan can override with an explicit factor.
UNIT_FACTORS = {
    ('minutes', 'seconds'): 60.0,
    ('seconds', 'minutes'): 1 / 60.0,
    ('hours',   'seconds'): 3600.0,
    ('seconds', 'hours'):   1 / 3600.0,
    ('hours',   'minutes'): 60.0,
    ('minutes', 'hours'):   1 / 60.0,
    ('mm', 'cm'): 0.1,    ('cm', 'mm'): 10.0,
    ('m',  'cm'): 100.0,  ('cm', 'm'):  0.01,
    ('m',  'mm'): 1000.0, ('mm', 'm'):  0.001,
    ('kg', 'g'):  1000.0, ('g',  'kg'): 0.001,
    ('lb', 'kg'): 0.45359237, ('kg', 'lb'): 1 / 0.45359237,
    ('in', 'mm'): 25.4,   ('mm', 'in'): 1 / 25.4,
}


def _factor(conv: dict) -> float:
    if conv.get('factor') is not None:
        return float(conv['factor'])
    src = (conv.get('from') or '').lower()
    dst = (conv.get('to') or '').lower()
    if src == dst:
        return 1.0
    if (src, dst) in UNIT_FACTORS:
        return UNIT_FACTORS[(src, dst)]
    raise ValueError(f'unknown unit conversion: {src}→{dst} (provide explicit factor)')


def _coerce(series: pd.Series, target_type: str) -> pd.Series:
    if target_type == 'float':    return pd.to_numeric(series, errors='coerce').astype(float)
    if target_type == 'int':      return pd.to_numeric(series, errors='coerce').astype('Int64')
    if target_type == 'datetime': return pd.to_datetime(series, errors='coerce')
    if target_type == 'bool':     return series.astype('boolean')
    return series.astype(str)


def _read_artifact_table(s3, bucket, artifact_row, source) -> pd.DataFrame:
    key = artifact_row['storage_key']
    body = s3.get_object(Bucket=bucket, Key=key)['Body'].read()
    if artifact_row['kind'] == 'excel':
        sheet = source.get('sheet')
        return pd.read_excel(io.BytesIO(body), sheet_name=sheet) if sheet else pd.read_excel(io.BytesIO(body))
    if artifact_row['kind'] == 'csv':
        return pd.read_csv(io.BytesIO(body))
    if artifact_row['kind'] == 'pdf':
        # The plan should reference parsed_json.tables; we materialize directly from parsed_json,
        # passed via source['rows'] from the Node side when needed.
        rows = source.get('rows') or []
        header = source.get('header') or []
        return pd.DataFrame(rows, columns=header)
    if artifact_row['kind'] == 'screenshot':
        rows = source.get('rows') or []
        header = source.get('header') or []
        return pd.DataFrame(rows, columns=header)
    raise ValueError(f'unsupported artifact kind: {artifact_row["kind"]}')


def materialize(s3, bucket: str, plan: dict, project_id: str, get_artifact) -> dict:
    schema = plan.get('schema') or []
    sources = plan.get('sources') or []
    outlier = plan.get('outlier_policy') or {'method': 'iqr', 'k': 1.5}

    frames: list[pd.DataFrame] = []
    src_summary = []

    for src in sources:
        artifact = get_artifact(src['artifact_id'])
        if not artifact:
            continue
        df = _read_artifact_table(s3, bucket, artifact, src)

        # Rename via column_map
        col_map = src.get('column_map') or {}
        df = df.rename(columns=col_map)

        # Subset to canonical schema columns
        keep = [c['name'] for c in schema if c['name'] in df.columns]
        df = df[keep].copy()

        # Apply unit conversions
        for canonical_col, conv in (src.get('unit_conversions') or {}).items():
            if canonical_col in df.columns and conv:
                f = _factor(conv)
                df[canonical_col] = pd.to_numeric(df[canonical_col], errors='coerce') * f

        # Optional filter (a pandas-eval expression — keep it server-trusted; here it's
        # already produced by the LLM under our schema, but still scope eval to df).
        flt = src.get('filter')
        if flt:
            try:
                df = df.query(flt)
            except Exception:
                pass

        df['_source_artifact_id'] = src['artifact_id']
        frames.append(df)
        src_summary.append({'artifact_id': src['artifact_id'], 'rows': int(len(df))})

    if not frames:
        canonical = pd.DataFrame(columns=[c['name'] for c in schema])
    else:
        canonical = pd.concat(frames, ignore_index=True)

    # Coerce types per schema
    for col in schema:
        if col['name'] in canonical.columns:
            canonical[col['name']] = _coerce(canonical[col['name']], col.get('type', 'string'))

    # Outlier flagging on numeric columns
    flags = _flag_outliers(canonical, schema, outlier)
    canonical['_outlier'] = flags['mask']

    # Write parquet to S3
    buf = io.BytesIO()
    canonical.to_parquet(buf, index=False)
    rows_key = f"datasets/{project_id}/{uuid.uuid4()}.parquet"
    s3.put_object(Bucket=bucket, Key=rows_key, Body=buf.getvalue(),
                  ContentType='application/octet-stream')

    return {
        'rows_storage_key': rows_key,
        'n_rows': int(len(canonical)),
        'sources': src_summary,
        'outliers': {
            'method': outlier.get('method'),
            'k': outlier.get('k'),
            'flagged_count': int(canonical['_outlier'].sum()),
            'by_column': flags['by_column'],
        },
    }


def _flag_outliers(df: pd.DataFrame, schema: list, policy: dict) -> dict:
    method = (policy or {}).get('method', 'iqr')
    k = float((policy or {}).get('k') or 1.5)
    mask = pd.Series(False, index=df.index)
    by_column = {}
    if method == 'none':
        return {'mask': mask, 'by_column': by_column}
    for col in schema:
        if col.get('type') not in ('float', 'int'):
            continue
        name = col['name']
        if name not in df.columns:
            continue
        x = pd.to_numeric(df[name], errors='coerce')
        col_mask = pd.Series(False, index=df.index)
        if method == 'iqr':
            q1, q3 = np.nanpercentile(x, 25), np.nanpercentile(x, 75)
            iqr = q3 - q1
            lo, hi = q1 - k * iqr, q3 + k * iqr
            col_mask = (x < lo) | (x > hi)
        elif method == 'mad':
            med = np.nanmedian(x)
            mad = np.nanmedian(np.abs(x - med))
            if mad and mad > 0:
                col_mask = (np.abs(x - med) / (1.4826 * mad)) > k
        elif method == 'grubbs':
            mu, sd = np.nanmean(x), np.nanstd(x, ddof=1)
            if sd and sd > 0:
                col_mask = np.abs((x - mu) / sd) > k
        col_mask = col_mask.fillna(False)
        by_column[name] = int(col_mask.sum())
        mask = mask | col_mask
    return {'mask': mask, 'by_column': by_column}
