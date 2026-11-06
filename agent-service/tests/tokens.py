"""Signs tokens the way the order API does, with a key pair made for this test run. Only tests
can sign: the service itself has no private key."""

from datetime import UTC, datetime, timedelta

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

TEST_KEY = Ed25519PrivateKey.generate()
PUBLIC_KEY = TEST_KEY.public_key()


def make_token(
    customer_id: str = "CUS-1001",
    ttl: timedelta = timedelta(hours=1),
    viewer: str | None = None,
    key: Ed25519PrivateKey = TEST_KEY,
    **extra,
) -> str:
    now = datetime.now(UTC)
    claims = {"iss": "destekai", "sub": customer_id, "role": "customer", "iat": now}
    claims["exp"] = now + ttl
    if viewer:
        claims |= {"readonly": True, "act": {"sub": viewer}}
    return jwt.encode(claims | extra, key, algorithm="EdDSA")
