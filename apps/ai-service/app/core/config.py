from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://workbench:change_me@postgres:5432/workbench"
    llm_provider: str = "mock"
    llm_model: str = "mock-structured-v1"
    ai_internal_token: str = "development-only"
    rag_confidence_threshold: float = 0.65


@lru_cache
def get_settings() -> Settings:
    return Settings()