"""Test the wrangle.materialize pipeline against an in-memory fake S3 + a
synthetic plan. Verifies column renaming, unit conversions, outlier flagging,
and parquet write."""
from __future__ import annotations

import io
import uuid

import pandas as pd

from wrangle import materialize as mat


class FakeS3:
    """Tiny stand-in for boto3 S3 client. Stores bytes by (bucket, key)."""
    def __init__(self):
        self.store: dict[tuple[str, str], bytes] = {}

    def put_object(self, *, Bucket, Key, Body, ContentType=None):
        self.store[(Bucket, Key)] = Body if isinstance(Body, bytes) else bytes(Body)
        return {}

    def get_object(self, *, Bucket, Key):
        body = self.store[(Bucket, Key)]
        return {"Body": _StreamWrap(body)}


class _StreamWrap:
    def __init__(self, b): self._b = b
    def read(self): return self._b


def _put_csv(s3, bucket, key, df: pd.DataFrame):
    buf = io.StringIO(); df.to_csv(buf, index=False)
    s3.put_object(Bucket=bucket, Key=key, Body=buf.getvalue().encode("utf-8"))


def test_materialize_renames_units_and_concats():
    s3 = FakeS3(); bucket = "test"

    art_a = {"id": "a", "kind": "csv", "storage_key": "raw/a.csv"}
    art_b = {"id": "b", "kind": "csv", "storage_key": "raw/b.csv"}

    _put_csv(s3, bucket, art_a["storage_key"], pd.DataFrame({
        "CT": [1.0, 1.1, 1.2, 1.05],          # in MINUTES
        "Op": ["x","y","x","y"],
    }))
    _put_csv(s3, bucket, art_b["storage_key"], pd.DataFrame({
        "cycle_time_sec": [62, 65, 70, 1000.0],   # SECONDS, last is an outlier
        "Operator": ["x","y","x","z"],
    }))

    plan = {
        "schema": [
            {"name": "cycle_time", "type": "float", "unit": "seconds"},
            {"name": "operator",   "type": "string"},
        ],
        "sources": [
            {
                "artifact_id": "a",
                "column_map": {"CT": "cycle_time", "Op": "operator"},
                "unit_conversions": {"cycle_time": {"from": "minutes", "to": "seconds"}},
            },
            {
                "artifact_id": "b",
                "column_map": {"cycle_time_sec": "cycle_time", "Operator": "operator"},
                "unit_conversions": {},
            },
        ],
        "outlier_policy": {"method": "iqr", "k": 1.5},
    }

    def get_artifact(aid):
        return {"a": art_a, "b": art_b}[aid]

    out = mat.materialize(s3, bucket, plan, project_id="proj", get_artifact=get_artifact)
    assert out["n_rows"] == 8

    # Read back the parquet to inspect contents.
    rows_bytes = s3.store[(bucket, out["rows_storage_key"])]
    df = pd.read_parquet(io.BytesIO(rows_bytes))
    # All values should now be in seconds (≈60–70 from source A; 62–70 + outlier 1000 from source B)
    assert df["cycle_time"].min() > 50
    assert df["cycle_time"].max() == 1000.0
    # The outlier (1000) should be flagged
    assert df["_outlier"].sum() >= 1
    # Provenance column present
    assert "_source_artifact_id" in df.columns
    assert set(df["_source_artifact_id"]) == {"a", "b"}


def test_materialize_unknown_unit_raises():
    s3 = FakeS3(); bucket = "test"
    art = {"id": "x", "kind": "csv", "storage_key": "raw/x.csv"}
    _put_csv(s3, bucket, art["storage_key"], pd.DataFrame({"v": [1.0, 2.0]}))
    plan = {
        "schema": [{"name": "v", "type": "float", "unit": "stones"}],
        "sources": [{
            "artifact_id": "x",
            "column_map": {"v": "v"},
            "unit_conversions": {"v": {"from": "barleycorns", "to": "stones"}},
        }],
        "outlier_policy": {"method": "none"},
    }
    try:
        mat.materialize(s3, bucket, plan, project_id="p", get_artifact=lambda _: art)
    except ValueError as e:
        assert "barleycorns" in str(e) or "stones" in str(e)
    else:
        raise AssertionError("expected ValueError for unknown unit conversion")
