"""One format for hashtags everywhere: "#Shorts #Funny #kaicenat".

The AI sometimes returns plain words ("kaicenat funny streamer"), lists, or comma-separated text;
users paste anything. Every write and every publish goes through normalize_hashtags()."""

from __future__ import annotations

import re
from typing import Iterable, List, Union

_SPLIT = re.compile(r"[\s,;]+")
_BAD = re.compile(r"[^\w]", re.UNICODE)       # a hashtag is letters/digits/underscore only
MAX_TAGS = 30


def hashtag_list(value: Union[str, Iterable[str], None]) -> List[str]:
    """['#Shorts', '#Funny'] - '#'-prefixed, punctuation dropped, duplicates (any case) removed."""
    if value is None:
        return []
    words = _SPLIT.split(value) if isinstance(value, str) else [w for v in value for w in _SPLIT.split(str(v or ""))]
    out, seen = [], set()
    for w in words:
        tag = _BAD.sub("", w.lstrip("#"))
        if not tag or tag.lower() in seen:
            continue
        seen.add(tag.lower())
        out.append("#" + tag)
        if len(out) >= MAX_TAGS:
            break
    return out


def normalize_hashtags(value: Union[str, Iterable[str], None]) -> str:
    return " ".join(hashtag_list(value))
