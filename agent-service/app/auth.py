"""Verifies and issues the session JWT. Must stay in line with order-api/internal/auth."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

ISSUER = "destekai"
ALGORITHM = "HS256"


class InvalidTokenError(Exception):
    pass


@dataclass(frozen=True)
class TokenClaims:
    customer_id: str
    # Set when an admin views the customer's panel; admin_id is that admin.
    read_only: bool = False
    admin_id: str | None = None


def verify_token(secret: str, token: str) -> TokenClaims:
    """Accepts customer tokens only: an admin talks to the agent through a read-only view
    token for one customer. Order ownership is still enforced by the order API."""
    try:
        claims = jwt.decode(
            token,
            secret,
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


def issue_dev_token(
    secret: str,
    customer_id: str,
    ttl: timedelta = timedelta(hours=1),
    viewer: str | None = None,
) -> str:
    """Stands in for a login flow; used only by the CLI, tests and evals. With a viewer it
    issues an admin's read-only view token, as the order API does."""
    now = datetime.now(UTC)
    claims: dict = {"iss": ISSUER, "sub": customer_id, "role": "customer", "iat": now}
    claims["exp"] = now + ttl
    if viewer:
        claims |= {"readonly": True, "act": {"sub": viewer}}
    return jwt.encode(claims, secret, algorithm=ALGORITHM)
