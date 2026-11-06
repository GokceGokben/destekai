from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from evals import ROOT


class EvalSettings(BaseSettings):
    """Read from the repository's .env, the same file docker compose uses."""

    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", extra="ignore", hide_input_in_errors=True
    )

    agent_service_port: int = 8000
    order_api_port: int = 8080
    postgres_user: str = "destekai"
    postgres_password: SecretStr = SecretStr("")
    postgres_db: str = "destekai"
    postgres_port: int = 5432

    llm_provider: str = "gemini"
    llm_model: str = "gemini-3.6-flash"
    gemini_api_key: SecretStr = SecretStr("")
    ollama_base_url: str = "http://localhost:11434"
    # The simulated customer and the judge can use another model, which keeps them off the
    # agent's daily quota. Empty means the agent's model.
    simulator_model: str = ""
    judge_model: str = ""

    # USD per million tokens, for the cost column. Unset, cost is reported as unknown.
    price_input_per_mtok: float | None = None
    price_output_per_mtok: float | None = None

    @field_validator("price_input_per_mtok", "price_output_per_mtok", mode="before")
    @classmethod
    def empty_is_unknown(cls, value: object) -> object:
        # .env.example leaves the prices empty, which arrives as "".
        return None if value == "" else value

    @property
    def agent_url(self) -> str:
        return f"http://localhost:{self.agent_service_port}"

    @property
    def order_api_url(self) -> str:
        return f"http://localhost:{self.order_api_port}"

    @property
    def database_url(self) -> str:
        password = self.postgres_password.get_secret_value()
        return (
            f"postgresql://{self.postgres_user}:{password}"
            f"@localhost:{self.postgres_port}/{self.postgres_db}"
        )
