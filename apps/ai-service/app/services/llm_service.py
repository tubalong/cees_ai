from typing import Protocol, TypeVar

from pydantic import BaseModel

OutputModel = TypeVar("OutputModel", bound=BaseModel)


class LLMProvider(Protocol):
    async def structured_output(
        self, prompt: str, output_model: type[OutputModel]
    ) -> OutputModel: ...


class MockLLMProvider:
    """Deterministic provider used until a production LangChain chat model is configured."""

    async def structured_output(
        self, prompt: str, output_model: type[OutputModel]
    ) -> OutputModel:
        raise NotImplementedError(
            f"Mock output for {output_model.__name__} must be supplied by its domain service"
        )


# TODO: Add a LangChain ChatModel adapter that calls with_structured_output(output_model).