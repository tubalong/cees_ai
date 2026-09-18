from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.core.config import Settings
from app.core.runtime import AppRuntime
from app.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = REPO_ROOT / "packages/contracts/openapi/ai-service.openapi.yaml"
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
SCHEMAS_TO_COMPARE = {
    "HealthResponse",
    "ReadinessResponse",
    "InvokeRequest",
    "InvokeResponse",
    "ExecutionMetadata",
    "StreamRequest",
    "ChatRequest",
    "ChatInvokeResponse",
    "CompactChatRequest",
    "CompactChatResponse",
    "ChatContextUsage",
    "ComposeDocumentRequest",
    "ComposeDocumentResponse",
    "DocumentPlan",
    "RenderDocxRequest",
    "DocumentSpec",
    "FileExtractionRequest",
    "FileExtractionResponse",
    "FileExtractionMetadata",
    "KnowledgeIndexRequest",
    "KnowledgeIndexResponse",
    "KnowledgeIndexDeleteRequest",
    "KnowledgeIndexDeleteResponse",
    "KnowledgeRetrieveScope",
    "KnowledgeRetrieveRequest",
    "KnowledgeRetrieveResponse",
    "RetrievedChunk",
    "KnowledgeAnswerRequest",
    "KnowledgeAnswerCitation",
    "KnowledgeAnswerResponse",
    "ParsedBlock",
    "ParsedDocument",
    "KnowledgeVisibilityScope",
    "ErrorResponse",
}


def load_contract() -> dict[str, Any]:
    document = yaml.safe_load(CONTRACT_PATH.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def build_app() -> FastAPI:
    runtime = AppRuntime(
        settings=Settings(node_env="test", ai_internal_token="secret"),
        catalog=None,
        router=None,
        readiness_errors=[],
    )
    return create_app(runtime=runtime)


def generate_runtime_openapi() -> dict[str, Any]:
    application = build_app()
    return get_openapi(
        title=application.title,
        version=application.version,
        openapi_version=application.openapi_version,
        description=application.description,
        routes=application.routes,
        tags=application.openapi_tags,
        servers=application.servers,
    )


def operations(document: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (path, method): operation
        for path, path_item in document["paths"].items()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
    }


def resolve_ref(document: dict[str, Any], value: dict[str, Any]) -> dict[str, Any]:
    resolved = value
    while "$ref" in resolved:
        reference = resolved["$ref"]
        assert reference.startswith("#/"), reference
        current: Any = document
        for part in reference[2:].split("/"):
            current = current[part.replace("~1", "/").replace("~0", "~")]
        assert isinstance(current, dict)
        resolved = current
    return resolved


def response_schema_name(document: dict[str, Any], response: dict[str, Any]) -> str | None:
    resolved_response = resolve_ref(document, response)
    content = resolved_response.get("content", {}).get("application/json")
    if content is None:
        return None
    schema = resolve_ref(document, content["schema"])
    reference = content["schema"].get("$ref")
    if reference is not None:
        return reference.rsplit("/", 1)[-1]
    return schema.get("title")


def normalized_security(operation: dict[str, Any]) -> list[dict[str, list[str]]]:
    return operation.get("security", [])


def test_generated_document_is_the_authoritative_contract() -> None:
    contract = load_contract()
    application = build_app()

    assert application.openapi() == contract


def test_runtime_openapi_matches_contract_operations() -> None:
    contract = load_contract()
    runtime = generate_runtime_openapi()
    contract_operations = operations(contract)
    runtime_operations = operations(runtime)

    assert runtime_operations.keys() == contract_operations.keys()

    for key, contract_operation in contract_operations.items():
        runtime_operation = runtime_operations[key]
        assert runtime_operation["operationId"] == contract_operation["operationId"]
        assert runtime_operation.get("summary") == contract_operation.get("summary")
        assert runtime_operation.get("tags", []) == contract_operation.get("tags", [])
        assert normalized_security(runtime_operation) == normalized_security(contract_operation)
        assert runtime_operation["responses"].keys() == contract_operation["responses"].keys()

        contract_request = contract_operation.get("requestBody")
        runtime_request = runtime_operation.get("requestBody")
        assert (runtime_request is None) == (contract_request is None)
        if contract_request is not None and runtime_request is not None:
            assert runtime_request.get("required") == contract_request.get("required")
            assert response_schema_name(
                contract,
                {"content": contract_request["content"]},
            ) == response_schema_name(
                runtime,
                {"content": runtime_request["content"]},
            )

        for status, contract_response in contract_operation["responses"].items():
            runtime_response = runtime_operation["responses"][status]
            resolved_contract_response = resolve_ref(contract, contract_response)
            assert runtime_response["description"] == resolved_contract_response["description"]
            assert response_schema_name(runtime, runtime_response) == response_schema_name(
                contract, contract_response
            )


def test_runtime_openapi_matches_contract_metadata_and_security() -> None:
    contract = load_contract()
    runtime = generate_runtime_openapi()

    assert runtime["info"] == contract["info"]
    assert runtime.get("servers") == contract.get("servers")
    assert runtime.get("tags") == contract.get("tags")
    assert runtime["components"]["securitySchemes"] == contract["components"]["securitySchemes"]


def test_runtime_openapi_models_keep_contract_fields() -> None:
    contract = load_contract()
    runtime = generate_runtime_openapi()

    for name in SCHEMAS_TO_COMPARE:
        contract_schema = contract["components"]["schemas"][name]
        runtime_schema = runtime["components"]["schemas"][name]
        assert runtime_schema.get("additionalProperties") == contract_schema.get(
            "additionalProperties"
        )
        assert set(runtime_schema.get("required", [])) == set(contract_schema.get("required", []))
        assert (
            runtime_schema.get("properties", {}).keys()
            == contract_schema.get("properties", {}).keys()
        )


def test_document_binary_responses_match_contract_media_types_and_headers() -> None:
    contract = load_contract()
    runtime = generate_runtime_openapi()

    for path in (
        "/internal/v1/documents/render-docx",
        "/internal/v1/documents/generate-docx",
    ):
        contract_response = contract["paths"][path]["post"]["responses"]["200"]
        runtime_response = runtime["paths"][path]["post"]["responses"]["200"]
        assert (
            runtime_response.get("content", {}).keys()
            == contract_response.get("content", {}).keys()
        )
        assert (
            runtime_response.get("headers", {}).keys()
            == contract_response.get("headers", {}).keys()
        )
