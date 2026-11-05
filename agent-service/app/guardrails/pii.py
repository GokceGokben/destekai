"""Masks personal data before it is written to logs or stored in a handoff summary.

Numbers are masked only when their check digits are valid, so order numbers, prices and
tracking codes stay readable in the logs.
"""

import logging
import re

# Spaces and dashes are allowed between groups, as people type them.
_IBAN = re.compile(r"\bTR\d{2}(?:[ ]?\d{4}){5}[ ]?\d{2}\b", re.IGNORECASE)
_CARD = re.compile(r"(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])")
_TC_KIMLIK = re.compile(r"(?<!\d)[1-9]\d{10}(?!\d)")
# Mobile (5xx) and landline (2xx-4xx) numbers, with an optional +90 or 0 in front.
_PHONE = re.compile(
    r"(?<![\d+])(?:\+?90[ -]?|0)?\(?[2-5]\d{2}\)?[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)"
)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")


def _luhn_valid(digits: str) -> bool:
    total = 0
    for position, char in enumerate(reversed(digits)):
        digit = int(char)
        if position % 2 == 1:
            digit = digit * 2 - 9 if digit > 4 else digit * 2
        total += digit
    return total % 10 == 0


def _tc_kimlik_valid(number: str) -> bool:
    """The official rule: digit 10 and digit 11 are checksums of the ones before them."""
    d = [int(char) for char in number]
    tenth = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10
    return d[9] == tenth and d[10] == sum(d[:10]) % 10


def _mask_card(match: re.Match[str]) -> str:
    digits = re.sub(r"\D", "", match.group())
    return "[KART]" if _luhn_valid(digits) else match.group()


def _mask_tc_kimlik(match: re.Match[str]) -> str:
    return "[TC_KIMLIK]" if _tc_kimlik_valid(match.group()) else match.group()


def mask_pii(text: str) -> str:
    # IBAN first, as it contains digit runs the other patterns would take apart.
    text = _IBAN.sub("[IBAN]", text)
    text = _CARD.sub(_mask_card, text)
    text = _TC_KIMLIK.sub(_mask_tc_kimlik, text)
    text = _PHONE.sub("[TELEFON]", text)
    return _EMAIL.sub("[E-POSTA]", text)


def _mask_value(value: object) -> object:
    # Non-strings keep their type, so "%d" and the like still format.
    return mask_pii(value) if isinstance(value, str) else value


def install_log_masking() -> None:
    """Masks every log record at creation, whichever library logs it. A filter on our own
    loggers would miss uvicorn's and httpx's. Exception tracebacks are not masked, so the
    service logs exception types, not messages."""
    factory = logging.getLogRecordFactory()
    if getattr(factory, "masks_pii", False):
        return

    def masking_factory(*args, **kwargs) -> logging.LogRecord:
        record = factory(*args, **kwargs)
        # Masked in place, not merged into the message: some formatters read the arguments
        # themselves, e.g. uvicorn's access log unpacks (client, method, path, ...).
        if isinstance(record.msg, str):
            record.msg = mask_pii(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_mask_value(value) for value in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: _mask_value(value) for key, value in record.args.items()}
        return record

    masking_factory.masks_pii = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(masking_factory)
