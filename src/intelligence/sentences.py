"""Structured Sentence representation and Whisper word-timestamp boundary chunker.

Transforms raw faster-whisper word timestamps into clean sentences snapped to:
- Terminal punctuation (. ! ? : ;)
- Pauses >= 0.7s
- Whisper segment boundaries
- Merges fragments shorter than 0.8s into neighboring sentences.
"""

from dataclasses import asdict, dataclass
import re
from typing import Any, Dict, List, Optional


@dataclass
class Sentence:
    id: str
    start: float
    end: float
    text: str
    first_word_idx: int
    last_word_idx: int

    def get(self, key: str, default: Any = None) -> Any:
        """Allow dict-like get access for compatibility."""
        return getattr(self, key, default)

    def __getitem__(self, key: str) -> Any:
        """Allow dict-like item access for compatibility."""
        try:
            return getattr(self, key)
        except AttributeError:
            raise KeyError(key)

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_compact(self) -> Dict[str, Any]:
        """Compact format for prompt injection: {'s': 's101', 't': [12.34, 15.67], 'x': 'text'}."""
        return {
            "s": self.id,
            "t": [round(self.start, 2), round(self.end, 2)],
            "x": self.text,
        }


class SentenceChunker:
    """Extracts, formats, and caches clean sentences from Whisper transcriptions."""

    TERMINAL_PUNCTUATION = re.compile(r"[\.\!\?\;\:]$")
    PAUSE_THRESHOLD_SECONDS = 0.70
    MIN_SENTENCE_DURATION = 0.80

    @classmethod
    def from_whisper_result(cls, transcript_result: Dict[str, Any]) -> List[Sentence]:
        """Builds a sequence of clean sentences from segments and word timestamps."""
        words_raw = transcript_result.get("words", [])
        segments_raw = transcript_result.get("segments", [])

        # If words aren't flattened at root, collect them from segments
        if not words_raw and segments_raw:
            words_raw = []
            for seg in segments_raw:
                for w in seg.get("words", []):
                    words_raw.append(w)

        if not words_raw:
            # Fallback to segment-level sentences if word timestamps are absent
            sentences: List[Sentence] = []
            for idx, seg in enumerate(segments_raw):
                text = str(seg.get("text", "")).strip()
                if not text:
                    continue
                sentences.append(
                    Sentence(
                        id=f"s{idx+1:03d}",
                        start=round(float(seg.get("start", 0.0)), 3),
                        end=round(float(seg.get("end", 0.0)), 3),
                        text=text,
                        first_word_idx=0,
                        last_word_idx=0,
                    )
                )
            return cls._merge_short_fragments(sentences)

        # Standard word-level aggregation
        sentences: List[Sentence] = []
        cur_words: List[str] = []
        sentence_idx = 1
        s_start = None
        s_first_idx = 0

        for w_idx, w in enumerate(words_raw):
            word_text = str(w.get("word") or w.get("w") or "").strip()
            if not word_text:
                continue

            w_s = float(w.get("start", w.get("s", 0.0)))
            w_e = float(w.get("end", w.get("e", w_s + 0.3)))

            if s_start is None:
                s_start = w_s
                s_first_idx = w_idx

            cur_words.append(word_text)
            has_terminal = bool(cls.TERMINAL_PUNCTUATION.search(word_text))

            # Look ahead for pause to next word
            next_pause = 0.0
            if w_idx + 1 < len(words_raw):
                nw = words_raw[w_idx + 1]
                nw_s = float(nw.get("start", nw.get("s", w_e)))
                next_pause = max(0.0, nw_s - w_e)

            is_pause_break = next_pause >= cls.PAUSE_THRESHOLD_SECONDS
            is_last_word = (w_idx == len(words_raw) - 1)

            if has_terminal or is_pause_break or is_last_word:
                joined_text = " ".join(cur_words).strip()
                if joined_text:
                    sentences.append(
                        Sentence(
                            id=f"s{sentence_idx:03d}",
                            start=round(s_start, 3),
                            end=round(w_e, 3),
                            text=joined_text,
                            first_word_idx=s_first_idx,
                            last_word_idx=w_idx,
                        )
                    )
                    sentence_idx += 1
                cur_words = []
                s_start = None

        return cls._merge_short_fragments(sentences)

    @classmethod
    def _merge_short_fragments(cls, sentences: List[Sentence]) -> List[Sentence]:
        """Merges sentence fragments shorter than 0.8s into preceding or following neighbors."""
        if len(sentences) <= 1:
            return sentences

        merged: List[Sentence] = []
        for s in sentences:
            if not merged:
                merged.append(s)
                continue

            prev = merged[-1]
            if s.duration < cls.MIN_SENTENCE_DURATION:
                # Merge into previous sentence
                merged[-1] = Sentence(
                    id=prev.id,
                    start=prev.start,
                    end=s.end,
                    text=f"{prev.text} {s.text}".strip(),
                    first_word_idx=prev.first_word_idx,
                    last_word_idx=s.last_word_idx,
                )
            else:
                merged.append(s)

        # Re-index nicely
        final_sentences: List[Sentence] = []
        for idx, s in enumerate(merged):
            final_sentences.append(
                Sentence(
                    id=f"s{idx+1:03d}",
                    start=s.start,
                    end=s.end,
                    text=s.text,
                    first_word_idx=s.first_word_idx,
                    last_word_idx=s.last_word_idx,
                )
            )
        return final_sentences

    @staticmethod
    def estimate_tokens(compact_sentences: List[Dict[str, Any]]) -> int:
        """Lightweight token estimator: ~1 token per 3.8 characters for prompt budgeting."""
        import json
        dumped = json.dumps(compact_sentences, ensure_ascii=False)
        return max(1, int(len(dumped) / 3.8))

