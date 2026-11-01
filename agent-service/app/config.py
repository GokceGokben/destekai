from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Validation errors would otherwise print the raw inputs, secrets included, into the logs.
    model_config = SettingsConfigDict(hide_input_in_errors=True)

    jwt_secret: SecretStr = SecretStr("")
    order_api_url: str = "http://order-api:8080"
    database_url: SecretStr = SecretStr("")

    llm_provider: Literal["gemini", "ollama"] = "gemini"
    llm_model: str = "gemini-3.6-flash"
    gemini_api_key: SecretStr = SecretStr("")
    ollama_base_url: str = "http://localhost:11434"

    embedding_provider: Literal["gemini", "local"] = "gemini"
    embedding_model: str = "gemini-embedding-001"

    policy_dir: str = "/policies"

    @model_validator(mode="after")
    def require_gemini_key(self) -> "Settings":
        uses_gemini = "gemini" in (self.llm_provider, self.embedding_provider)
        if uses_gemini and not self.gemini_api_key.get_secret_value():
            raise ValueError("GEMINI_API_KEY is required for the gemini providers")
        return self
