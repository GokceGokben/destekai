from app.config import Settings
from app.llm.base import LLMClient, RetryingLLMClient
from app.llm.gemini import GeminiClient
from app.llm.ollama import OllamaClient


def build_llm_client(settings: Settings) -> LLMClient:
    client: LLMClient
    if settings.llm_provider == "gemini":
        client = GeminiClient(settings.gemini_api_key.get_secret_value(), settings.llm_model)
    else:
        client = OllamaClient(settings.ollama_base_url, settings.llm_model)
    return RetryingLLMClient(client)
