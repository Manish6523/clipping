"""Chat signals 2.0: what KIND of moment chat is reacting to, emote walls, signal strength,
and velocity spikes from a chat replay (VODs). Pure functions; no I/O."""

import math
import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# Lower-case tokens. Matching is per token (emote names) or substring (emoji / laugh strings).
MOOD_LEXICON: Dict[str, Tuple[set, Tuple[str, ...]]] = {
    "laugh": ({"kekw", "lul", "lulw", "omegalul", "icant", "lmao", "lmfao", "lol", "xd", "xdd", "kek", "pepelaugh",
               "kekl", "lolw", "hahaha", "haha", "dead", "crying", "omegakek", "kappa"},
              ("😂", "🤣", "💀", "hahah", "lmao", "kekw")),
    "hype": ({"pog", "pogchamp", "poggers", "pogu", "w", "ww", "www", "letsgo", "lets", "goated", "ez", "clutch",
              "insane", "gg", "hype", "peepoclap", "clap", "pagman", "pagchomp", "fire"},
             ("🔥", "🐐", "letsgoo", "w speed", "pog")),
    "shock": ({"wtf", "omg", "monkas", "monkaw", "what", "wait", "noway", "nah", "bruh", "dafuq", "holy", "d:", "o_o"},
              ("😱", "😳", "😨", "no way", "wtf")),
    "sad": ({"sadge", "f", "rip", "pepehands", "biblethump", "feelsbadman", "unlucky", "l"},
            ("😭", "😢", "💔", "rip")),
    "rage": ({"madge", "reeee", "angry", "trash", "ratio", "mald", "malding", "tilted"},
             ("😡", "🤬", "reeee")),
}
MOOD_ORDER = ("laugh", "hype", "shock", "sad", "rage")
_TOKEN_RE = re.compile(r"[\w:']+|[^\w\s]", re.UNICODE)


def _tokens(message: str) -> List[str]:
    low = re.sub(r"(.)\1{3,}", r"\1\1\1", message.lower())   # "LMAOOOOO" -> "lmaooo", keeps "www"
    return _TOKEN_RE.findall(low)


def message_moods(message: str) -> set:
    """Moods a single chat message expresses (a message can be both 'laugh' and 'shock')."""
    low = message.lower()
    toks = set(_tokens(message))
    found = set()
    for mood in MOOD_ORDER:
        words, subs = MOOD_LEXICON[mood]
        if toks & words or any(s in low for s in subs):
            found.add(mood)
    return found


def classify_reaction(messages: Sequence[str]) -> Dict[str, Any]:
    """Dominant mood of a burst of chat. `share` = fraction of messages expressing it.
    'mixed' when the top two moods are close, 'none' when < 20 % of messages show any mood."""
    msgs = [m for m in messages if m and m.strip()]
    if not msgs:
        return {"mood": "none", "share": 0.0, "shares": {}}
    counts: Counter = Counter()
    for m in msgs:
        for mood in message_moods(m):
            counts[mood] += 1
    shares = {mood: round(counts[mood] / len(msgs), 3) for mood in MOOD_ORDER if counts[mood]}
    if not shares or max(shares.values()) < 0.2:
        return {"mood": "none", "share": max(shares.values(), default=0.0), "shares": shares}
    ranked = sorted(shares.items(), key=lambda kv: kv[1], reverse=True)
    top, top_share = ranked[0]
    if len(ranked) > 1 and ranked[1][1] >= top_share * 0.8:
        return {"mood": "mixed", "share": top_share, "shares": shares, "top": [ranked[0][0], ranked[1][0]]}
    return {"mood": top, "share": top_share, "shares": shares}


def emote_wall(messages: Sequence[str]) -> Dict[str, Any]:
    """Share of messages dominated by ONE repeated token ("KEKW KEKW KEKW", "W", "💀💀")."""
    msgs = [m for m in messages if m and m.strip()]
    if not msgs:
        return {"token": None, "share": 0.0}
    per_msg: Counter = Counter()
    for m in msgs:
        toks = [t for t in _tokens(m) if t.strip()]
        if not toks:
            continue
        tok, n = Counter(toks).most_common(1)[0]
        if n / len(toks) >= 0.6:          # the message is mostly that one token
            per_msg[tok] += 1
    if not per_msg:
        return {"token": None, "share": 0.0}
    tok, n = per_msg.most_common(1)[0]
    return {"token": tok, "share": round(n / len(msgs), 3)}


def chat_signal_score(ratio: float, mood_share: float = 0.0, unique_chatters: int = 0) -> float:
    """0-100 strength of a chat moment. Velocity matters most (log-scaled so 10x isn't 4x of 2.5x),
    then how unanimous the reaction is, then how many different people reacted."""
    r = max(0.0, float(ratio))
    velocity = min(1.0, math.log(1.0 + max(0.0, r - 1.0)) / math.log(1.0 + 7.0))   # 1x->0, 8x->1
    agreement = max(0.0, min(1.0, float(mood_share)))
    breadth = min(1.0, math.log(1.0 + max(0, unique_chatters)) / math.log(1.0 + 40.0))  # 40 chatters -> 1
    return round(40.0 + 60.0 * (0.55 * velocity + 0.25 * agreement + 0.20 * breadth), 1)


def is_emote_burst(messages: Sequence[str], users: Sequence[Optional[str]], ratio: float,
                   min_messages: int = 8, min_share: float = 0.6, min_users: int = 5, min_ratio: float = 1.3) -> Tuple[bool, Dict[str, Any]]:
    """A wall of reactions at (near-)normal chat speed: velocity alone misses these."""
    reaction = classify_reaction(messages)
    distinct = len({u for u in users if u})
    ok = (len(messages) >= min_messages and reaction["mood"] not in ("none",)
          and reaction["share"] >= min_share and distinct >= min_users and ratio >= min_ratio)
    return ok, {**reaction, "unique_chatters": distinct}


def spikes_from_replay(comments: Iterable[Tuple[float, str]], duration: Optional[float] = None,
                       bin_s: float = 5.0, min_ratio: float = 2.5, min_count: int = 8,
                       min_gap_s: float = 60.0, top_n: int = 12) -> List[Dict[str, Any]]:
    """Velocity spikes in a timestamped chat replay [(offset_seconds, text), ...].
    Baseline = median rate over the surrounding 10 minutes (robust to the spike itself)."""
    items = sorted((float(t), m) for t, m in comments if t is not None and t >= 0)
    if not items:
        return []
    end = duration or items[-1][0] + bin_s
    nbins = int(end // bin_s) + 1
    counts = [0] * nbins
    texts: List[List[str]] = [[] for _ in range(nbins)]
    for t, m in items:
        i = min(nbins - 1, int(t // bin_s))
        counts[i] += 1
        if len(texts[i]) < 60:
            texts[i].append(m)
    half = int(300 // bin_s)
    cands = []
    for i, c in enumerate(counts):
        if c < min_count:
            continue
        window = sorted(counts[max(0, i - half): i] + counts[i + 1: i + 1 + half])
        base = max(1.0, window[len(window) // 2] if window else 1.0)
        ratio = c / base
        if ratio >= min_ratio:
            reaction = classify_reaction(texts[i])
            cands.append({"time": round(i * bin_s + bin_s / 2, 1), "count": c, "ratio": round(ratio, 2),
                          "mood": reaction["mood"], "mood_share": reaction["share"],
                          "score": chat_signal_score(ratio, reaction["share"], min(c, 40))})
    cands.sort(key=lambda s: s["score"], reverse=True)
    picked: List[Dict[str, Any]] = []
    for s in cands:
        if all(abs(s["time"] - p["time"]) >= min_gap_s for p in picked):
            picked.append(s)
        if len(picked) >= top_n:
            break
    return sorted(picked, key=lambda s: s["time"])


def describe_reaction(ctx: Dict[str, Any]) -> str:
    """One line for the judge prompt."""
    mood = ctx.get("mood")
    if not mood or mood == "none":
        return "No clear chat reaction."
    share = ctx.get("mood_share", ctx.get("share", 0.0)) or 0.0
    users = ctx.get("unique_chatters_5s") or ctx.get("unique_chatters")
    who = f", {users} different chatters" if users else ""
    label = "/".join(ctx.get("top", [])) if mood == "mixed" and ctx.get("top") else mood
    return f"Chat reaction: {label} ({share * 100:.0f}% of messages{who})"
