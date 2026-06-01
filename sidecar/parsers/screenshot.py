"""Light prep for screenshot artifacts. Heavy lifting (OCR, table reconstruction)
happens via LLM vision in the Node layer."""
from __future__ import annotations
import base64


def parse(data: bytes) -> dict:
    return {
        "kind": "screenshot",
        "n_bytes": len(data),
        "base64": base64.b64encode(data).decode("ascii"),
        # node side will hand this to vision() via the LLM router.
    }
