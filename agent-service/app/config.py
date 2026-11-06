from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Validation errors would otherwise print the raw inputs, secrets included, into the logs.
    model_config = SettingsConfigDict(hide_input_in_errors=True)

    # The order API signs tokens; this service only verifies them with the public key.
    jwt_public_key_file: str = "/run/secrets/jwt_public.pem"
    order_api_url: str = "http://order-api:8080"
    database_url: SecretStr = SecretStr("")

    llm_provider: Literal["gemini", "ollama"] = "gemini"
    llm_model: str = "gemini-3.6-flash"
    gemini_api_key: SecretStr = SecretStr("")
    ollama_base_url: str = "http://localhost:11434"

    embedding_provider: Literal["gemini", "local"] = "gemini"
    embedding_model: str = "gemini-embedding-001"

    policy_dir: str = "/policies"

    # Traces always go to the project's Postgres. Langfuse only when both keys are set.
    langfuse_host: str = "https://cloud.langfuse.com"
    langfuse_public_key: str = ""
    langfuse_secret_key: SecretStr = SecretStr("")
    # USD per million tokens of LLM_MODEL, for the cost column. Empty: cost is unknown.
    price_input_per_mtok: float | None = None
    price_output_per_mtok: float | None = None

    # Messages one account may send; protects the model quota from a single sender.
    chat_limit_per_minute: int = 20
    chat_limit_per_day: int = 300
    # Conversations untouched for this long are deleted from memory.
    memory_retention_days: int = 30

    @field_validator("price_input_per_mtok", "price_output_per_mtok", mode="before")
    @classmethod
    def empty_is_unknown(cls, value: object) -> object:
        return None if value == "" else value

    @model_validator(mode="after")
    def require_gemini_key(self) -> "Settings":
        uses_gemini = "gemini" in (self.llm_provider, self.embedding_provider)
        if uses_gemini and not self.gemini_api_key.get_secret_value():
            raise ValueError("GEMINI_API_KEY is required for the gemini providers")
        return self
