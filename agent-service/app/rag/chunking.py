"""Splits the Markdown policies by heading, then by paragraph if a section is long."""

import hashlib
from dataclasses import dataclass

MAX_SECTION_CHARS = 1000


@dataclass(frozen=True)
class Chunk:
    document: str
    section: str
    content: str

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.content.encode()).hexdigest()


def split_sections(markdown: str) -> tuple[str, list[tuple[str, str]]]:
    """Returns the document title and its (heading, body) pairs."""
    title = ""
    sections: list[tuple[str, list[str]]] = []
    for line in markdown.splitlines():
        if line.startswith("## "):
            sections.append((line.removeprefix("## ").strip(), []))
        elif line.startswith("# "):
            title = line.removeprefix("# ").strip()
        elif sections:
            sections[-1][1].append(line)
    return title, [(heading, "\n".join(lines).strip()) for heading, lines in sections]


def split_long(body: str, max_chars: int = MAX_SECTION_CHARS) -> list[str]:
    """Keeps paragraphs whole. Each part repeats the last paragraph of the previous one,
    so a rule that depends on the sentence before it is not cut off from it."""
    if len(body) <= max_chars:
        return [body]

    paragraphs = [paragraph.strip() for paragraph in body.split("\n\n") if paragraph.strip()]
    parts: list[str] = []
    current: list[str] = []
    for paragraph in paragraphs:
        if current and len("\n\n".join([*current, paragraph])) > max_chars:
            parts.append("\n\n".join(current))
            current = current[-1:]
        current.append(paragraph)
    parts.append("\n\n".join(current))
    return parts


def chunk_document(name: str, markdown: str) -> list[Chunk]:
    title, sections = split_sections(markdown)
    return [
        # The heading is part of the text: "14 gün" alone does not say what it is about.
        Chunk(document=name, section=heading, content=f"{title} - {heading}\n\n{part}")
        for heading, body in sections
        for part in split_long(body)
        if part
    ]
