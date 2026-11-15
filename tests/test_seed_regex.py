import pytest
from src.monitor.seed_detector import match_seed_patterns, normalize_transcript_text

def test_normalization():
    raw = "Every   Time I die I’ll do ten pushups!  "
    norm = normalize_transcript_text(raw)
    assert norm == "every time i die i'll do ten pushups!"

def test_regex_hits():
    # Exactly matching required test sentences from Addendum 3
    hits = [
        "I'll donate a dollar every time I laugh",
        "I will donate one dollar every time I laugh",
        "I'm gonna donate a dollar every time I laugh",
        "Every time I die I'll do ten pushups",
        "Every time I laugh, I'll donate a dollar",
        "Whenever I lose I'm gonna sing",
        "If I die again I'll quit",
        "I'll quit if I die again",
        "Every time I die I’ll do ten pushups",
        "I promise I'm not gonna laugh",
        "I bet we win this game",
    ]
    for sentence in hits:
        res = match_seed_patterns(sentence)
        assert res is not None, f"Expected match for: '{sentence}'"
        assert res[0] in ("trigger_first", "commit_first", "if_then", "then_if", "bet", "promise")

def test_regex_misses():
    # Sentences that must NOT match
    misses = [
        "Every time you go to the store they raise the price",
        "Whenever you see this guy it's a good day",
        "That's crazy chat",
        "I can't believe this happens every time",
        "Just a regular sentence without commitments",
        "Watch this gameplay guys",
    ]
    for sentence in misses:
        res = match_seed_patterns(sentence)
        assert res is None, f"Expected NO match for: '{sentence}', got: {res}"

