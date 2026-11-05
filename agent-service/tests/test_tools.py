from datetime import timedelta

import pytest
from pydantic import ValidationError

from app.auth import InvalidTokenError, issue_dev_token, verify_token
from app.config import Settings
from app.main import create_app
from app.tools import format_try
from tests.conftest import SECRET


def test_missing_key_error_does_not_print_secrets():
    with pytest.raises(ValidationError) as exc_info:
        Settings(jwt_secret=SECRET, llm_provider="gemini", gemini_api_key="")
    assert "GEMINI_API_KEY is required" in str(exc_info.value)
    assert SECRET[:8] not in str(exc_info.value)


@pytest.mark.parametrize(
    ("kurus", "expected"),
    [(0, "0,00 TL"), (5, "0,05 TL"), (239700, "2.397,00 TL"), (123456789, "1.234.567,89 TL")],
)
def test_format_try(kurus, expected):
    assert format_try(kurus) == expected


def test_app_refuses_a_short_jwt_secret():
    settings = Settings(jwt_secret="short", llm_provider="ollama", embedding_provider="local")
    with pytest.raises(ValueError, match="JWT_SECRET"):
        create_app(settings)


def test_verify_token_returns_customer():
    claims = verify_token(SECRET, issue_dev_token(SECRET, "CUS-1001"))
    assert claims.customer_id == "CUS-1001"
    assert not claims.read_only


def test_verify_token_rejects_expired():
    token = issue_dev_token(SECRET, "CUS-1001", ttl=timedelta(hours=-1))
    with pytest.raises(InvalidTokenError):
        verify_token(SECRET, token)


def test_verify_token_rejects_wrong_secret():
    token = issue_dev_token("another-secret-another-secret-123", "CUS-1001")
    with pytest.raises(InvalidTokenError):
        verify_token(SECRET, token)
