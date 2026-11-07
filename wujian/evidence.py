"""Locate literal evidence while tolerating document layout whitespace only."""


def locate_quote(text, quote):
    if not isinstance(quote, str) or not quote.strip():
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


def locate_user_quote(text, quote):
    """Re-anchor lexically identical user words despite quote typography.

    Unlike PDF layout matching, preserve word boundaries: ``a b`` must not
    match ``ab``. Only same-kind curly/fullwidth quote glyphs and consecutive
    whitespace are equivalent. Never paraphrase, case-fold, drop punctuation,
    normalize numbers or use similarity. The return is ALWAYS an actual
    contiguous original span, so downstream evidence still stays verbatim.
    This is for evidence, not a substitute for explicit action/AI/share consent.
    """
    if not isinstance(quote, str) or not quote.strip():
        return None
    if quote in text:
        return quote
    glyphs = {"‘": "'", "’": "'", "＇": "'", "“": '"', "”": '"', "＂": '"'}

    def view(value):
        characters, positions = [], []
        for index, char in enumerate(value):
            if char.isspace():
                if not characters or characters[-1] == " ":
                    continue
                char = " "
            else:
                char = glyphs.get(char, char)
            characters.append(char); positions.append(index)
        if characters and characters[-1] == " ":
            characters.pop(); positions.pop()
        return "".join(characters), positions

    original, positions = view(text)
    needle, _ = view(quote)
    start = original.find(needle)
    if not needle or start < 0:
        return None
    return text[positions[start]:positions[start + len(needle) - 1] + 1]
