from __future__ import annotations

import pytest

from app.core.config import ModelCapability, ModelRole, OutputMode
from app.core.errors import AIServiceError, ProviderPermanentError, ProviderTransientError
from app.llm.router import LLMRouter
from app.llm.types import (
    ChatMessage,
    ProviderStreamChunk,
    TokenUsageData,
    ToolCall,
    ToolCallingResult,
)
from tests.helpers import StubProvider, catalog, profile, result


@pytest.mark.asyncio
async def test_falls_back_only_after_transient_failure() -> None:
    primary_profile = profile()
    backup_profile = profile()
    primary = StubProvider(primary_profile, [ProviderTransientError("timeout")])
    backup = StubProvider(backup_profile, [result("ok")])
    providers = {"primary": primary, "backup": backup}
    router = LLMRouter(
        catalog(
            {"primary": primary_profile, "backup": backup_profile},
            {ModelRole.default: ["primary", "backup"]},
        ),
        lambda name, _profile: providers[name],
    )

    routed = await router.invoke(
        request_id="req-1",
        tenant_id="tenant-1",
        user_id="user-1",
        messages=[ChatMessage(role="user", content="hello")],
        output_mode=OutputMode.text,
        role=ModelRole.default,
        profile_override=None,
        temperature=None,
        max_output_tokens=None,
    )

    assert routed.profile_name == "backup"
    assert routed.fallback_count == 1
    assert len(primary.calls) == len(backup.calls) == 1


@pytest.mark.asyncio
async def test_explicit_profile_does_not_fall_back() -> None:
    primary_profile = profile()
    backup_profile = profile()
    primary = StubProvider(primary_profile, [ProviderTransientError("timeout")])
    backup = StubProvider(backup_profile, [result("unexpected")])
    providers = {"primary": primary, "backup": backup}
    router = LLMRouter(
        catalog(
            {"primary": primary_profile, "backup": backup_profile},
            {ModelRole.default: ["primary", "backup"]},
        ),
        lambda name, _profile: providers[name],
    )

    with pytest.raises(AIServiceError, match="No configured LLM profile") as raised:
        await router.invoke(
            request_id="req-2",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="hello")],
            output_mode=OutputMode.text,
            role=ModelRole.default,
            profile_override="primary",
            temperature=None,
            max_output_tokens=None,
        )

    assert raised.value.code == "LLM_UNAVAILABLE"
    assert len(primary.calls) == 1
    assert not backup.calls


@pytest.mark.asyncio
async def test_permanent_failure_does_not_fall_back() -> None:
    primary_profile = profile()
    backup_profile = profile()
    primary = StubProvider(primary_profile, [ProviderPermanentError("bad request")])
    backup = StubProvider(backup_profile, [result("unexpected")])
    providers = {"primary": primary, "backup": backup}
    router = LLMRouter(
        catalog(
            {"primary": primary_profile, "backup": backup_profile},
            {ModelRole.default: ["primary", "backup"]},
        ),
        lambda name, _profile: providers[name],
    )

    with pytest.raises(AIServiceError) as raised:
        await router.invoke(
            request_id="req-3",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="hello")],
            output_mode=OutputMode.text,
            role=ModelRole.default,
            profile_override=None,
            temperature=None,
            max_output_tokens=None,
        )

    assert raised.value.code == "LLM_UNAVAILABLE"
    assert not backup.calls


@pytest.mark.asyncio
async def test_validates_structured_output_against_schema() -> None:
    structured_profile = profile(modes={OutputMode.json_schema})
    provider = StubProvider(structured_profile, [result({"answer": 42})])
    router = LLMRouter(
        catalog(
            {"structured": structured_profile},
            {ModelRole.structured: ["structured"]},
        ),
        lambda _name, _profile: provider,
    )

    routed = await router.invoke(
        request_id="req-4",
        tenant_id="tenant-1",
        user_id="user-1",
        messages=[ChatMessage(role="user", content="answer")],
        output_mode=OutputMode.json_schema,
        role=ModelRole.structured,
        profile_override=None,
        temperature=0.2,
        max_output_tokens=128,
        schema_name="Answer",
        json_schema={
            "type": "object",
            "properties": {"answer": {"type": "integer"}},
            "required": ["answer"],
        },
    )

    assert routed.provider_result.output == {"answer": 42}
    assert provider.calls[0][1].temperature == 0.2


@pytest.mark.asyncio
async def test_rejects_remote_json_schema_reference() -> None:
    structured_profile = profile(modes={OutputMode.json_schema})
    provider = StubProvider(structured_profile, [result({})])
    router = LLMRouter(
        catalog(
            {"structured": structured_profile},
            {ModelRole.structured: ["structured"]},
        ),
        lambda _name, _profile: provider,
    )

    with pytest.raises(AIServiceError) as raised:
        await router.invoke(
            request_id="req-5",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="answer")],
            output_mode=OutputMode.json_schema,
            role=ModelRole.structured,
            profile_override=None,
            temperature=None,
            max_output_tokens=None,
            schema_name="Answer",
            json_schema={"type": "object", "$ref": "https://example.com/schema.json"},
        )

    assert raised.value.code == "INVALID_INVOCATION_REQUEST"
    assert raised.value.request_id == "req-5"


@pytest.mark.asyncio
async def test_rejects_profile_token_limit_override() -> None:
    limited_profile = profile(token_limit=64)
    provider = StubProvider(limited_profile, [result("unused")])
    router = LLMRouter(
        catalog({"limited": limited_profile}, {ModelRole.default: ["limited"]}),
        lambda _name, _profile: provider,
    )

    with pytest.raises(AIServiceError) as raised:
        await router.invoke(
            request_id="req-6",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="hello")],
            output_mode=OutputMode.text,
            role=ModelRole.default,
            profile_override=None,
            temperature=None,
            max_output_tokens=65,
        )

    assert raised.value.code == "INVALID_INVOCATION_REQUEST"
    assert not provider.calls


@pytest.mark.asyncio
async def test_rejects_structured_output_that_does_not_match_schema() -> None:
    structured_profile = profile(modes={OutputMode.json_schema})
    provider = StubProvider(structured_profile, [result({"answer": "not-an-integer"})])
    router = LLMRouter(
        catalog(
            {"structured": structured_profile},
            {ModelRole.structured: ["structured"]},
        ),
        lambda _name, _profile: provider,
    )

    with pytest.raises(AIServiceError) as raised:
        await router.invoke(
            request_id="req-7",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="answer")],
            output_mode=OutputMode.json_schema,
            role=ModelRole.structured,
            profile_override=None,
            temperature=None,
            max_output_tokens=None,
            schema_name="Answer",
            json_schema={
                "type": "object",
                "properties": {"answer": {"type": "integer"}},
                "required": ["answer"],
            },
        )

    assert raised.value.code == "LLM_OUTPUT_INVALID"


@pytest.mark.asyncio
async def test_stream_falls_back_only_before_first_chunk() -> None:
    primary_profile = profile()
    backup_profile = profile()
    primary = StubProvider(
        primary_profile,
        [],
        stream_outcomes=[[ProviderTransientError("timeout")]],
    )
    backup = StubProvider(
        backup_profile,
        [],
        stream_outcomes=[
            [
                ProviderStreamChunk(text="hello"),
                ProviderStreamChunk(
                    token_usage=TokenUsageData(
                        input_tokens=3,
                        output_tokens=1,
                        total_tokens=4,
                    )
                ),
            ]
        ],
    )
    providers = {"primary": primary, "backup": backup}
    router = LLMRouter(
        catalog(
            {"primary": primary_profile, "backup": backup_profile},
            {ModelRole.default: ["primary", "backup"]},
        ),
        lambda name, _profile: providers[name],
    )

    routed = await router.start_stream(
        request_id="req-stream-1",
        tenant_id="tenant-1",
        user_id="user-1",
        messages=[ChatMessage(role="user", content="hello")],
        role=ModelRole.default,
        profile_override=None,
        temperature=None,
        max_output_tokens=None,
    )
    chunks = [chunk async for chunk in routed.chunks]

    assert routed.profile_name == "backup"
    assert routed.fallback_count == 1
    assert [chunk.text for chunk in chunks] == ["hello", ""]
    assert len(primary.stream_calls) == len(backup.stream_calls) == 1


@pytest.mark.asyncio
async def test_stream_does_not_fall_back_after_first_chunk() -> None:
    primary_profile = profile()
    backup_profile = profile()
    primary = StubProvider(
        primary_profile,
        [],
        stream_outcomes=[
            [ProviderStreamChunk(text="partial"), ProviderTransientError("disconnected")]
        ],
    )
    backup = StubProvider(
        backup_profile,
        [],
        stream_outcomes=[[ProviderStreamChunk(text="unexpected")]],
    )
    providers = {"primary": primary, "backup": backup}
    router = LLMRouter(
        catalog(
            {"primary": primary_profile, "backup": backup_profile},
            {ModelRole.default: ["primary", "backup"]},
        ),
        lambda name, _profile: providers[name],
    )

    routed = await router.start_stream(
        request_id="req-stream-2",
        tenant_id="tenant-1",
        user_id="user-1",
        messages=[ChatMessage(role="user", content="hello")],
        role=ModelRole.default,
        profile_override=None,
        temperature=None,
        max_output_tokens=None,
    )
    iterator = routed.chunks.__aiter__()

    assert (await anext(iterator)).text == "partial"
    with pytest.raises(ProviderTransientError, match="disconnected"):
        await anext(iterator)
    assert not backup.stream_calls


@pytest.mark.asyncio
async def test_invoke_with_tools_routes_to_tool_calling_profile() -> None:
    tool_profile = profile(capabilities={ModelCapability.chat, ModelCapability.tool_calling})
    provider = StubProvider(
        tool_profile,
        [],
        tool_outcomes=[
            ToolCallingResult(
                content="",
                tool_calls=(
                    ToolCall(id="call_1", name="generate_image", arguments={"prompt": "cat"}),
                ),
                token_usage=TokenUsageData(input_tokens=3, output_tokens=2, total_tokens=5),
                finish_reason="tool_calls",
            )
        ],
    )
    router = LLMRouter(
        catalog(
            {"tool": tool_profile},
            {ModelRole.orchestrator: ["tool"]},
        ),
        lambda _name, _profile: provider,
    )

    routed = await router.invoke_with_tools(
        request_id="req-tool-1",
        tenant_id="tenant-1",
        user_id="user-1",
        messages=[ChatMessage(role="user", content="draw a cat")],
        tools=(
            {
                "name": "generate_image",
                "description": "Generate an image",
                "parameters": {"type": "object"},
            },
        ),
    )

    assert routed.profile_name == "tool"
    assert routed.tool_result.tool_calls == (
        ToolCall(id="call_1", name="generate_image", arguments={"prompt": "cat"}),
    )
    assert provider.tool_calls[0][1].tools is not None


@pytest.mark.asyncio
async def test_invoke_with_tools_rejects_profile_without_capability() -> None:
    tool_profile = profile()
    provider = StubProvider(tool_profile, [])
    router = LLMRouter(
        catalog(
            {"tool": tool_profile},
            {ModelRole.orchestrator: ["tool"]},
        ),
        lambda _name, _profile: provider,
    )

    with pytest.raises(AIServiceError) as raised:
        await router.invoke_with_tools(
            request_id="req-tool-2",
            tenant_id="tenant-1",
            user_id="user-1",
            messages=[ChatMessage(role="user", content="draw a cat")],
            tools=(
                {
                    "name": "generate_image",
                    "description": "Generate an image",
                    "parameters": {"type": "object"},
                },
            ),
        )

    assert raised.value.code == "UNSUPPORTED_TOOL_CALLING"
    assert not provider.tool_calls
