"""Locate literal evidence while tolerating document layout whitespace only."""


def locate_quote(text, quote):
    if not quote.strip():
        return None
    if quote in text:
        return quote
    positions = [i for i, char in enumerate(text) if not char.isspace()]
    compact = "".join(text[i] for i in positions)
    needle = "".join(char for char in quote if not char.isspace())
    start = compact.find(needle)
    if not needle or start < 0:
        return None
    return text[positions[start] : positions[start + len(needle) - 1] + 1]
