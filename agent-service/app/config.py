from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Validation errors would otherwise print the raw inputs, secrets included, into the logs.
    model_config = SettingsConfigDict(hide_input_in_errors=True)

    jwt_secret: SecretStr
    order_api_url: str = "http://order-api:8080"

    llm_provider: Literal["gemini", "ollama"] = "gemini"
    llm_model: str = "gemini-3.6-flash"
    gemini_api_key: SecretStr = SecretStr("")
    ollama_base_url: str = "http://localhost:11434"

    @model_validator(mode="after")
    def require_gemini_key(self) -> "Settings":
        if self.llm_provider == "gemini" and not self.gemini_api_key.get_secret_value():
            raise ValueError("GEMINI_API_KEY is required when LLM_PROVIDER is gemini")
        return self
