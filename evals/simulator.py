"""A second model plays the customer from the scenario's persona."""

from app.llm.base import Message

from evals.agent_client import AgentTurn
from evals.llm import TextModel
from evals.scenario import Scenario

DONE = "[BİTTİ]"

SIMULATOR_PROMPT = """\
Bir e-ticaret mağazasının müşterisisin ve mağazanın destek asistanıyla yazışıyorsun.

Kim olduğun ve bildiklerin: {persona}
Amacın: {goal}

Kurallar:
- Yalnızca müşteri olarak, tek bir kısa mesaj yaz. Doğal, günlük Türkçe kullan.
- Kim olduğun kısmında yazmayan bir bilgi (sipariş numarası, tarih, ürün) uydurma. Asistan \
bilmediğin bir şey sorarsa bilmediğini söyle.
- Personana uygun davran: sinirliysen sinirli, sakinsen sakin yaz.
- Amacın gerçekleştiyse, asistan seni bir temsilciye aktardıysa veya amacının \
gerçekleşmeyeceği açıksa yalnızca {done} yaz.
- Asistanı test ettiğini veya bir yapay zekâ olduğunu belli etme.
"""


class CustomerSimulator:
    def __init__(self, model: TextModel, scenario: Scenario) -> None:
        self._model = model
        self._system = SIMULATOR_PROMPT.format(
            persona=scenario.persona, goal=scenario.goal, done=DONE
        )

    async def next_message(self, turns: list[AgentTurn]) -> str | None:
        """The customer's next message, or None when the conversation is over."""
        # From the customer's side the roles swap: the agent's replies are what it is told.
        messages: list[Message] = []
        for turn in turns:
            messages.append({"role": "assistant", "content": turn.customer})
            messages.append({"role": "user", "content": turn.reply or "(yanıt yok)"})
        text = await self._model.complete(self._system, messages)
        if not text or DONE in text:
            return None
        return text
