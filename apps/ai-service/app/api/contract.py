from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTRACT_PATH = Path(__file__).resolve().parent / "generated/openapi.json"


@lru_cache(maxsize=1)
def load_openapi_contract() -> dict[str, Any]:
    document = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"Generated OpenAPI contract must be an object: {CONTRACT_PATH}")
    return document
