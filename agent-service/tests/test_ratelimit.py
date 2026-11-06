import json

from app.ratelimit import ChatLimiter
from tests.conftest import FakeLLM, text
from tests.tokens import make_token


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_minute_and_day_windows():
    clock = Clock()
    limiter = ChatLimiter(per_minute=2, per_day=3, now=clock)
    assert limiter.allow("a") and limiter.allow("a")
    assert not limiter.allow("a")  # third in the same minute
    assert limiter.allow("b")  # senders are counted apart

    clock.now = 61
    assert limiter.allow("a")  # a new minute
    clock.now = 125
    assert not limiter.allow("a")  # but three already today

    clock.now = 86_401
    assert limiter.allow("a")  # a new day


def test_a_refused_message_is_not_counted():
    clock = Clock()
    limiter = ChatLimiter(per_minute=1, per_day=100, now=clock)
    assert limiter.allow("a")
    for _ in range(5):
        assert not limiter.allow("a")
    clock.now = 61
    assert limiter.allow("a")


async def test_the_chat_endpoint_refuses_a_flood(harness):
    h = harness(FakeLLM(*[text("Tamam") for _ in range(4)]), chat_limit_per_minute=2)
    assert (await h.post("bir")).status_code == 200
    assert (await h.post("iki")).status_code == 200

    refused = await h.post("üç")
    assert refused.status_code == 429
    assert refused.headers["Retry-After"] == "60"
    assert json.loads(refused.text) == {"detail": "rate_limited"}
    # Another customer, and an admin viewing this one, have their own budgets.
    assert (await h.post("merhaba", customer="CUS-1002")).status_code == 200
    viewer = make_token("CUS-1001", viewer="ADM-1001")
    assert (await h.post_with_token(viewer, "merhaba")).status_code == 200
    # The refused message never reached the model.
    assert len(h.llm.calls) == 4


async def test_personal_numbers_never_reach_the_model_or_memory(harness):
    h = harness(FakeLLM(text("Tamam")))
    await h.post("Numaram 0532 123 45 67, kartım 4111 1111 1111 1111")

    sent = json.dumps(h.llm.calls[0]["messages"], ensure_ascii=False)
    assert "0532" not in sent and "4111" not in sent
    assert "[TELEFON]" in sent and "[KART]" in sent
    stored = repr(h.app.state.graph.checkpointer.storage)
    assert "0532 123 45 67" not in stored
