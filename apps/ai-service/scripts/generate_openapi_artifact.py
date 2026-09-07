from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE = REPO_ROOT / "packages/contracts/openapi/ai-service.openapi.yaml"
OUTPUT = REPO_ROOT / "apps/ai-service/app/api/generated/openapi.json"


def load_contract() -> dict[str, Any]:
    document = yaml.safe_load(SOURCE.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"OpenAPI contract must be an object: {SOURCE}")
    info = document.get("info")
    if not isinstance(info, dict) or not info.get("title") or not info.get("version"):
        raise ValueError(f"OpenAPI contract must define info.title and info.version: {SOURCE}")
    return document


def main() -> None:
    document = load_contract()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

