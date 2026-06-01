"""Standalone outlier check on an existing canonical dataset."""
from __future__ import annotations

import io
import numpy as np
import pandas as pd


def compute(s3, bucket: str, rows_key: str, method: str = 'iqr', k: float = 1.5) -> dict:
    body = s3.get_object(Bucket=bucket, Key=rows_key)['Body'].read()
    df = pd.read_parquet(io.BytesIO(body))
    by_column = {}
    flagged_total = 0
    for c in df.select_dtypes(include='number').columns:
        x = df[c]
        if method == 'iqr':
            q1, q3 = np.nanpercentile(x, 25), np.nanpercentile(x, 75)
            iqr = q3 - q1
            lo, hi = q1 - k * iqr, q3 + k * iqr
            m = ((x < lo) | (x > hi)).fillna(False)
        elif method == 'mad':
            med = np.nanmedian(x); mad = np.nanmedian(np.abs(x - med))
            m = (np.abs(x - med) / (1.4826 * mad) > k).fillna(False) if mad else pd.Series(False, index=df.index)
        else:
            m = pd.Series(False, index=df.index)
        c_count = int(m.sum())
        flagged_total += c_count
        by_column[c] = c_count
    return {'method': method, 'k': k, 'flagged_count': flagged_total, 'by_column': by_column}
