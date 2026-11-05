"""The simulator's and the judge's model calls, through the agent service's LLM client."""

from dataclasses import dataclass, field

from app.llm.base import LLMClient, Message, RetryingLLMClient, TextDelta, Usage
from app.llm.gemini import GeminiClient
from app.llm.ollama import OllamaClient

from evals.config import EvalSettings


@dataclass
class TokenCount:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class TextModel:
    """Text in, text out, with a running token count for the report."""

    client: LLMClient
    tokens: TokenCount = field(default_factory=TokenCount)

    async def complete(self, system: str, messages: list[Message]) -> str:
        text = ""
        async for event in self.client.stream(system, messages, []):
            match event:
                case TextDelta(delta):
                    text += delta
                case Usage(input_tokens, output_tokens):
                    self.tokens.input_tokens += input_tokens
                    self.tokens.output_tokens += output_tokens
        return text.strip()


def build_model(settings: EvalSettings, model: str) -> TextModel:
    """Same clients as the agent, but more patient: a customer should not wait a minute for
    a reply, while a batch run is better off waiting out a per-minute limit than stopping."""
    name = model or settings.llm_model
    client: LLMClient
    if settings.llm_provider == "gemini":
        client = GeminiClient(settings.gemini_api_key.get_secret_value(), name)
    else:
        client = OllamaClient(settings.ollama_base_url, name)
    return TextModel(RetryingLLMClient(client, max_retries=5, base_delay=10.0, max_delay=60.0))
