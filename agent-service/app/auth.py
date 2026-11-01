"""Verifies and issues the mock session JWT. Must stay in line with order-api/internal/auth."""

from datetime import UTC, datetime, timedelta

import jwt

ISSUER = "destekai"
ALGORITHM = "HS256"


class InvalidTokenError(Exception):
    pass


def verify_token(secret: str, token: str) -> str:
    """Returns the customer ID. Order ownership is still enforced by the order API."""
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
    if not claims["sub"]:
        raise InvalidTokenError
    return claims["sub"]


def issue_dev_token(secret: str, customer_id: str, ttl: timedelta = timedelta(hours=1)) -> str:
    """Stands in for a login flow; used only by the CLI and tests."""
    now = datetime.now(UTC)
    claims = {"iss": ISSUER, "sub": customer_id, "iat": now, "exp": now + ttl}
    return jwt.encode(claims, secret, algorithm=ALGORITHM)
