"""Stable, conservative product identity; descriptions and sources stay on instances."""

import hashlib
import json
import unicodedata

IDENTITY_FIELDS = ("brand", "model", "market", "edition", "firmware_version")


def product_identity(spec):
    identity = {key: spec.get(key) for key in IDENTITY_FIELDS}
    normalized = {
        key: " ".join(
            unicodedata.normalize("NFKC", str(value or "")).split()
        ).casefold()
        for key, value in identity.items()
    }
    return hashlib.sha256(
        json.dumps(normalized, sort_keys=True).encode()
    ).hexdigest(), identity
