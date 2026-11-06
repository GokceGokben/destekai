"""Verifies the session JWT. Must stay in line with order-api/internal/auth.

Tokens are signed with Ed25519 by the order API. This service holds only the public key: it
can check a token but cannot create one, so a compromised agent cannot mint an admin token.
"""

from dataclasses import dataclass
from pathlib import Path

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

ISSUER = "destekai"
ALGORITHM = "EdDSA"


class InvalidTokenError(Exception):
    pass


@dataclass(frozen=True)
class TokenClaims:
    customer_id: str
    # Set when an admin views the customer's panel; admin_id is that admin.
    read_only: bool = False
    admin_id: str | None = None


def load_public_key(path: str) -> Ed25519PublicKey:
    key = load_pem_public_key(Path(path).read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError(f"{path} is not an Ed25519 public key")
    return key


def verify_token(public_key: Ed25519PublicKey, token: str) -> TokenClaims:
    """Accepts customer tokens only: an admin talks to the agent through a read-only view
    token for one customer. Order ownership is still enforced by the order API. Pinning the
    algorithm rejects "alg: none" and an HMAC token keyed with the public key."""
    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError from exc
    if not claims["sub"] or claims.get("role") != "customer":
        raise InvalidTokenError
    read_only = claims.get("readonly") is True
    actor = claims.get("act")
    admin_id = actor.get("sub") if isinstance(actor, dict) else None
    # The same rule as the order API: a read-only token names its admin, and only it may.
    if read_only != bool(admin_id) or (actor is not None and not admin_id):
        raise InvalidTokenError
    return TokenClaims(customer_id=claims["sub"], read_only=read_only, admin_id=admin_id)
