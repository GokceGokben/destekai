"""When to hand a conversation to a human, decided by rules rather than by the model.

The model can still hand off through escalate_to_human, but these triggers do not depend on it
noticing: an explicit request for a person, a clearly angry customer, or repeated failure.
The frustration check is a word list, so it misses sarcasm and unusual phrasing; the
evaluation scenarios measure how often.
"""

import re

from app.guardrails.injection import normalize
from app.guardrails.pii import mask_pii

MAX_FAILED_TURNS = 3
# Frustration hands off when one message scores this much, or two messages in a row score
# FRUSTRATION_STREAK each. Not a running total: mild words such as "hâlâ" add up over a long,
# calm conversation.
FRUSTRATION_THRESHOLD = 3
FRUSTRATION_STREAK = 2
SUMMARY_LIMIT = 1000

# "yetkili servis" is the warranty repair shop, not a person to talk to.
_HUMAN = r"(temsilci|insan|yetkili(?! ?servis)|canli destek|operator|gercek (bir )?kisi)\w*"
_CONNECT = r"(bagla|baglan|gorus|konus|aktar|istiyorum|ister|ulas|devret)\w*"
# The second form is a message that is nothing but the request, e.g. "Temsilci".
_WANTS_HUMAN = re.compile(rf"\b{_HUMAN}( \w+){{0,3}} {_CONNECT}|^{_HUMAN}$")

# Two points each: one of these on its own is enough to read as anger, with any other sign.
_STRONG = re.compile(
    r"\b(rezalet|berbat|skandal|sacmalik|yeter artik|artik yeter|bikt\w+|"
    r"dalga mi gec\w+|kandir\w+|dolandiric\w+|sikayet edece\w+|tuketici hakem\w*|"
    r"avukat\w*|mahkeme\w*|bir daha (asla )?alisveris yapma\w*|rezil\w*|"
    r"utanmiyor mu\w*|insanlik\w* yok)"
)
# One point each.
_MILD = re.compile(
    r"\b(hala|kacinci kez|kac kez|yine mi|hep ayni|cevap ver\w*|ilgilenen yok|"
    # Not "sinir" alone: normalized, it is also "sınır", as in the return time limit.
    r"kimse ilgilen\w*|inanilmaz|kabul edilemez|sinirlen\w*|sinir oldum|ofke\w*)"
)


def wants_human(text: str) -> bool:
    """For example "Temsilciye bağlan", "bir insanla görüşmek istiyorum", "canlı destek"."""
    return bool(_WANTS_HUMAN.search(normalize(text)))


def frustration_score(text: str) -> int:
    normalized = normalize(text)
    score = 2 * len(_STRONG.findall(normalized)) + len(_MILD.findall(normalized))
    letters = [char for char in text if char.isalpha()]
    # Shouting: a whole message in capitals, or a run of exclamation marks.
    if len(letters) >= 8 and sum(char.isupper() for char in letters) / len(letters) > 0.7:
        score += 2
    if re.search(r"[!?]{3,}", text):
        score += 1
    return score


def _shorten(text: str, limit: int = 200) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build_summary(reason: str, customer_messages: list[str], failures: list[str]) -> str:
    """A summary for the human agent, built without a model call. Personal data is masked,
    since the summary is stored."""
    lines = [f"Devir nedeni: {REASON_LABELS[reason]}."]
    # Each message is cut short, so that one long message cannot push the failures out.
    recent = [_shorten(message.strip()) for message in customer_messages[-3:] if message.strip()]
    if recent:
        lines.append("Müşterinin son mesajları: " + " | ".join(recent))
    if failures:
        lines.append("Başarısız denemeler: " + ", ".join(failures[-5:]))
    return mask_pii("\n".join(lines))[:SUMMARY_LIMIT]


REASON_LABELS = {
    "customer_request": "müşteri temsilci istedi",
    "frustration": "müşteri belirgin şekilde sinirli",
    "repeated_failures": f"{MAX_FAILED_TURNS} başarısız deneme",
    "agent_decision": "asistan talebi çözemedi",
}
