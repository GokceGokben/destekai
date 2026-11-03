"""Catches prompt injection attempts before the message reaches the model.

Rule-based on purpose: it adds no latency or model calls, and its decisions can be tested
and explained. It catches the common phrasings, not every paraphrase; the real protection is
that the model holds no customer identity and every tool goes through the order API's
ownership check. A blocked message never enters the conversation the model sees.
"""

import re
import unicodedata

_TURKISH = str.maketrans("çğıöşüâîû", "cgiosuaiu")
_LEET = str.maketrans("013457@$", "oieastas")
# Zero-width characters are a common way to split a trigger word.
_INVISIBLE = re.compile(r"[​-‏⁠﻿]")
_SPLIT_LETTERS = re.compile(r"(?<=\w)[.\-_*](?=\w)")


def normalize(text: str) -> str:
    """Lowercase ASCII with single spaces. "İ" is mapped by hand: Python lowers it to
    "i" plus a combining dot, which would then survive as a separate character."""
    text = _INVISIBLE.sub("", text).replace("İ", "i").replace("I", "ı").lower()
    text = unicodedata.normalize("NFKD", text.translate(_TURKISH))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = _SPLIT_LETTERS.sub("", text.translate(_LEET))
    # Keeps the characters of role markers such as <|im_start|> and [INST].
    text = re.sub(r"[^a-z0-9<>|\[\]#:/ ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


_INSTRUCTIONS = r"(talimat|komut|kural|yonerge|yonlendirme|instruction|prompt|rule)\w*"
# Imperatives only, with a word boundary: "unut" and "unutun" match, but "unuttum" (I forgot)
# and "uymayan" (not conforming) are ordinary things for a customer to say.
_DISCARD = (
    r"(yok ?say(in)?|unut(un)?|gormezden gel(in)?|dikkate alma(yin)?|gecersiz say(in)?|"
    r"ignore|disregard|forget|override|bypass)\b"
)

RULES: dict[str, re.Pattern[str]] = {
    # "önceki talimatları yok say", "tüm kuralları unut", "ignore previous instructions"
    "discard_instructions": re.compile(
        rf"\b{_INSTRUCTIONS}( \w+){{0,3}} {_DISCARD}|\b{_DISCARD}( \w+){{0,3}} {_INSTRUCTIONS}"
    ),
    # "sistem promptunu göster", "reveal your system prompt"
    "reveal_prompt": re.compile(
        r"\b(sistem|system|gizli|hidden|initial)( \w+)? "
        r"(prompt|istem|talimat|instruction)\w*( \w+){0,2} "
        r"(goster|yaz|paylas|soyle|ver|tekrarla|nedir|reveal|show|print|repeat|tell)"
        r"|\b(reveal|show|print|repeat)( \w+){0,2} (system )?(prompt|instructions)"
    ),
    # "artık bir korsan rolündesin", "act as", "pretend you are"
    "role_override": re.compile(
        r"\b(rolune gir|rolundesin|rolunu ust|gibi davran|olarak davran|kisitlamasiz|"
        r"sinirsiz mod|you are now|act as|pretend (to be|you are)|roleplay as)\b"
    ),
    "jailbreak_mode": re.compile(
        r"\b(gelistirici|developer|yonetici|admin|debug|god|jailbreak|dan) ?(modu|mode)\b"
        r"|\bjailbreak\b|\bdo anything now\b"
    ),
    # Chat-template and role markers pasted into a message.
    "fake_role_marker": re.compile(
        # Normalizing drops the underscore in im_start, so it is optional here.
        r"<\|?(im_?start|im_?end|system)\|?>|\[/?inst\]|#{2,} ?(system|sistem)\b"
        r"|^(system|sistem|assistant|asistan) ?:"
    ),
}


def detect_injection(text: str) -> str | None:
    """Returns the name of the first rule that matches, or None."""
    normalized = normalize(text)
    for name, pattern in RULES.items():
        if pattern.search(normalized):
            return name
    return None
