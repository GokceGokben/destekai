import base64
import hashlib
import hmac
import json
from datetime import timedelta

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from pydantic import ValidationError

from app.auth import InvalidTokenError, verify_token
from app.config import Settings
from app.main import create_app
from app.tools import format_try
from tests.tokens import PUBLIC_KEY, make_token

SECRET = "sk-lf-very-secret-value"


def _b64(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def test_missing_key_error_does_not_print_secrets():
    with pytest.raises(ValidationError) as exc_info:
        Settings(langfuse_secret_key=SECRET, llm_provider="gemini", gemini_api_key="")
    assert "GEMINI_API_KEY is required" in str(exc_info.value)
    assert SECRET[:8] not in str(exc_info.value)


@pytest.mark.parametrize(
    ("kurus", "expected"),
    [(0, "0,00 TL"), (5, "0,05 TL"), (239700, "2.397,00 TL"), (123456789, "1.234.567,89 TL")],
)
def test_format_try(kurus, expected):
    assert format_try(kurus) == expected


def test_app_refuses_to_start_without_the_public_key(tmp_path):
    settings = Settings(
        jwt_public_key_file=str(tmp_path / "missing.pem"),
        llm_provider="ollama",
        embedding_provider="local",
    )
    with pytest.raises(FileNotFoundError):
        create_app(settings)


def test_verify_token_returns_customer():
    claims = verify_token(PUBLIC_KEY, make_token("CUS-1001"))
    assert claims.customer_id == "CUS-1001"
    assert not claims.read_only


def test_verify_token_rejects_expired():
    token = make_token("CUS-1001", ttl=timedelta(hours=-1))
    with pytest.raises(InvalidTokenError):
        verify_token(PUBLIC_KEY, token)


def test_verify_token_rejects_another_key():
    token = make_token("CUS-1001", key=Ed25519PrivateKey.generate())
    with pytest.raises(InvalidTokenError):
        verify_token(PUBLIC_KEY, token)


def test_verify_token_rejects_hmac_keyed_with_the_public_key():
    """Algorithm confusion: the public key is not secret, so an HS256 token "signed" with
    it must never pass."""
    public_pem = PUBLIC_KEY.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    claims = {"iss": "destekai", "sub": "CUS-1001", "role": "customer", "exp": 4102444800}
    # Built by hand: PyJWT itself refuses to HMAC with a public key, an attacker would not.
    header = _b64({"alg": "HS256", "typ": "JWT"})
    body = f"{header}.{_b64(claims)}"
    signature = hmac.new(public_pem, body.encode(), hashlib.sha256).digest()
    forged = f"{body}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"
    with pytest.raises(InvalidTokenError):
        verify_token(PUBLIC_KEY, forged)
