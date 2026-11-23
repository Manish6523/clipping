"""More reach per YouTube Short, after it is uploaded.

1. Title A/B test - the AI writes 2 more titles. The Short then rotates through the titles in
   fixed windows (default 4 h) in an A-B-C-C-B-A order, which cancels the natural decay of a
   Short's views. Each title's score is the views it gained per hour while it was live. The
   best title is kept. Optional: each title also gets its own thumbnail (a frame of the clip).
   YouTube's own "Test & Compare" isn't available through the API, so this is a sequential
   test. It's honest about that: results are a strong hint, not a lab result.
2. Translated titles - YouTube shows the localized title/description to viewers whose app is
   set to that language (`localizations`), e.g. Hindi and Spanish.
3. Translated captions - the finished Short is transcribed and the lines are translated and
   uploaded as caption tracks (captions.insert, 400 quota units each, skipped when quota is tight).

Changing a video needs the youtube.force-ssl scope: accounts connected before it was added must
reconnect once. Everything here is best-effort and never blocks publishing.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

SETTING = "growth_settings"
DEFAULTS: Dict[str, Any] = {
    "ab_titles": True,
    "ab_thumbnails": False,
    "ab_window_hours": 4.0,
    "translate_titles": True,
    "translate_captions": True,
    "languages": ["hi", "es"],
}
LANG_NAMES = {"hi": "Hindi", "es": "Spanish", "pt": "Portuguese", "ar": "Arabic", "fr": "French", "de": "German",
              "id": "Indonesian", "ru": "Russian", "ja": "Japanese", "ko": "Korean", "tr": "Turkish", "it": "Italian",
              "bn": "Bengali", "ur": "Urdu", "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "vi": "Vietnamese"}
EDIT_SCOPES = ("https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/youtube")
UNITS = {"list": 1, "update": 50, "thumbnail": 50, "caption": 400}
CAPTION_RESERVE_UPLOADS = 1      # always leave room for this many uploads after a caption upload
LOOP_EVERY_S = 600


# ----------------------------------------------------------------------------- settings / scopes
async def load_settings() -> Dict[str, Any]:
    try:
        from src.database import get_system_setting
        saved = json.loads(await get_system_setting(SETTING, "") or "{}")
    except Exception:
        saved = {}
    out = {**DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}}
    out["languages"] = [l for l in (out.get("languages") or []) if l in LANG_NAMES][:5]
    out["ab_window_hours"] = max(1.0, min(24.0, float(out.get("ab_window_hours") or 4)))
    return out


async def save_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    from src.database import set_system_setting
    cur = await load_settings()
    for k, v in patch.items():
        if k not in DEFAULTS:
            continue
        if k == "languages":
            v = [str(x).strip().lower() for x in (v or []) if str(x).strip().lower() in LANG_NAMES][:5]
        elif k == "ab_window_hours":
            v = max(1.0, min(24.0, float(v)))
        else:
            v = bool(v)
        cur[k] = v
    await set_system_setting(SETTING, json.dumps(cur), category="publishing")
    return cur


def can_edit(token: Dict[str, Any]) -> bool:
    return any(s in EDIT_SCOPES for s in (token.get("scopes") or []))


def _yt(account_key: str):
    from googleapiclient.discovery import build
    from src.publisher.youtube_shorts import credentials_from_token, load_token
    token = load_token(account_key)
    return build("youtube", "v3", credentials=credentials_from_token(token), cache_discovery=False), token


async def _record(account_key: str, op: str, units: int, ok: bool = True) -> None:
    from src.database import get_db_connection
    from src.publisher.slots import record_usage
    from src.publisher.youtube_shorts import token_project_key
    try:
        async with get_db_connection() as db:
            await record_usage(db, account_key, token_project_key(account_key), op, units, ok)
            await db.commit()
    except Exception as e:
        logger.debug("Quota bookkeeping failed: %s", e)


async def quota_left(account_key: str) -> int:
    from src.database import get_db_connection, get_youtube_account
    from src.publisher.slots import DEFAULT_QUOTA_UNITS, units_used
    from src.publisher.youtube_shorts import token_project_key
    acc = await get_youtube_account(account_key) or {}
    limit = int(acc.get("quota_units_per_day") or DEFAULT_QUOTA_UNITS)
    async with get_db_connection() as db:
        used = await units_used(db, token_project_key(account_key))
    return limit - used


# ----------------------------------------------------------------------------- AI text
class TitleVariants(BaseModel):
    titles: List[str] = Field(..., description="Alternative YouTube Shorts titles, each under 70 characters")


class Translation(BaseModel):
    title: str = Field(..., description="Translated title, under 100 characters")
    description: str = Field(..., description="Translated description; keep #hashtags unchanged")


class TranslatedLines(BaseModel):
    lines: List[str] = Field(..., description="The translated lines, same count and order as the input")


def _gemini():
    from config.settings import GEMINI_API_KEY, GEMINI_MODEL
    from src.intelligence.llm.client import GeminiClient
    return GeminiClient(api_key=GEMINI_API_KEY, model_name=GEMINI_MODEL)


def clean_variants(original: str, proposed: Sequence[str], n: int = 2) -> List[str]:
    seen = {original.strip().lower()}
    out = []
    for t in proposed or []:
        t = " ".join(str(t).split()).strip().strip('"')[:95]
        if len(t) >= 8 and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
        if len(out) >= n:
            break
    return out


async def title_variants(title: str, description: str, n: int = 2) -> List[str]:
    try:
        res = await _gemini().generate_structured(
            system_instruction=("You write YouTube Shorts titles for stream clips. Each alternative must take a clearly "
                                "different angle (curiosity, emotion, stakes, quote) - not a synonym swap. No clickbait lies, "
                                "no emoji spam, under 70 characters, same language as the original."),
            user_prompt=f"Original title: {title}\nDescription: {description[:500]}\nWrite {n} alternative titles.",
            response_model=TitleVariants, use_cache=False)
        return clean_variants(title, (res.titles if res else []), n)
    except Exception as e:
        logger.info("Title variants unavailable: %s", e)
        return []


async def translate_meta(title: str, description: str, lang: str) -> Optional[Translation]:
    try:
        return await _gemini().generate_structured(
            system_instruction=(f"Translate YouTube Shorts metadata into natural, casual {LANG_NAMES[lang]} the way a native "
                                "viewer would write it. Keep names, game titles, slang that has no translation, and every "
                                "#hashtag unchanged."),
            user_prompt=f"Title: {title}\nDescription: {description[:4000]}",
            response_model=Translation)
    except Exception as e:
        logger.info("Translation to %s failed: %s", lang, e)
        return None


async def translate_lines(lines: List[str], lang: str) -> Optional[List[str]]:
    if not lines:
        return []
    try:
        res = await _gemini().generate_structured(
            system_instruction=(f"Translate each subtitle line into casual spoken {LANG_NAMES[lang]}. Return exactly one "
                                "output line per input line, in order. Keep names and gamer slang."),
            user_prompt="\n".join(f"{i + 1}. {l}" for i, l in enumerate(lines)),
            response_model=TranslatedLines)
    except Exception as e:
        logger.info("Caption translation to %s failed: %s", lang, e)
        return None
    if not res or len(res.lines) != len(lines):
        return None
    return [re.sub(r"^\s*\d+[.)]\s*", "", l).strip() for l in res.lines]


# ----------------------------------------------------------------------------- captions
def caption_cues(segments: Sequence[Dict[str, Any]], max_chars: int = 84, max_len: float = 4.5) -> List[Dict[str, Any]]:
    """Whisper segments -> short subtitle cues (split long ones evenly by words)."""
    cues = []
    for seg in segments:
        text = " ".join(str(seg.get("text") or "").split())
        s, e = float(seg.get("start") or 0), float(seg.get("end") or 0)
        if not text or e <= s:
            continue
        words = text.split()
        parts = max(1, math.ceil(len(text) / max_chars), math.ceil((e - s) / max_len))
        per = math.ceil(len(words) / parts)
        chunks = [" ".join(words[i:i + per]) for i in range(0, len(words), per)]
        step = (e - s) / len(chunks)
        for i, c in enumerate(chunks):
            cues.append({"start": round(s + i * step, 3), "end": round(s + (i + 1) * step, 3), "text": c})
    return cues


def _ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(cues: Sequence[Dict[str, Any]], texts: Optional[Sequence[str]] = None) -> str:
    out = []
    for i, c in enumerate(cues):
        out.append(f"{i + 1}\n{_ts(c['start'])} --> {_ts(c['end'])}\n{(texts[i] if texts else c['text']).strip()}\n")
    return "\n".join(out)


# ----------------------------------------------------------------------------- A/B maths
def round_order(n: int) -> List[int]:
    """A B C C B A - each title gets an early and a late window, so view decay cancels out."""
    return list(range(n)) + list(reversed(range(n)))


def variant_rates(rounds: Sequence[Dict[str, Any]], n: int) -> List[Optional[float]]:
    """Views gained per hour for each variant over its finished windows."""
    views = [0.0] * n
    hours = [0.0] * n
    for r in rounds:
        if r.get("views_end") is None:
            continue
        start, end = datetime.fromisoformat(r["start"]), datetime.fromisoformat(r["end"])
        h = max(0.25, (end - start).total_seconds() / 3600)
        views[r["idx"]] += max(0, r["views_end"] - r["views_start"])
        hours[r["idx"]] += h
    return [round(views[i] / hours[i], 2) if hours[i] else None for i in range(n)]


def pick_winner(rates: Sequence[Optional[float]], min_lead: float = 1.15) -> Tuple[int, str]:
    """Best variant, but the original (index 0) keeps its title unless another clearly beats it."""
    valid = [(i, r) for i, r in enumerate(rates) if r is not None]
    if not valid:
        return 0, "no data"
    best_i, best_r = max(valid, key=lambda x: x[1])
    base = rates[0] or 0.0
    if best_i != 0 and best_r < base * min_lead + 0.5:
        return 0, f"no clear winner ({best_r:.1f} vs {base:.1f} views/h) - kept the original"
    if best_i == 0:
        return 0, f"original title won ({base:.1f} views/h)"
    return best_i, f"title {chr(65 + best_i)} won: {best_r:.1f} views/h vs {base:.1f} for the original"


# ----------------------------------------------------------------------------- YouTube calls (blocking)
def _video_snippet(yt, video_id: str) -> Optional[Dict[str, Any]]:
    resp = yt.videos().list(part="snippet,statistics,localizations", id=video_id).execute()
    items = resp.get("items") or []
    return items[0] if items else None


def _set_title(account_key: str, video_id: str, title: str) -> int:
    yt, _ = _yt(account_key)
    item = _video_snippet(yt, video_id)
    if not item:
        raise RuntimeError("video not found")
    sn = item["snippet"]
    body = {"id": video_id, "snippet": {"title": title[:100], "description": sn.get("description", ""),
                                        "categoryId": sn.get("categoryId", "20"), "tags": sn.get("tags", []),
                                        **({"defaultLanguage": sn["defaultLanguage"]} if sn.get("defaultLanguage") else {})}}
    yt.videos().update(part="snippet", body=body).execute()
    return int((item.get("statistics") or {}).get("viewCount", 0) or 0)


def _views(account_key: str, video_id: str) -> Optional[int]:
    yt, _ = _yt(account_key)
    resp = yt.videos().list(part="statistics", id=video_id).execute()
    items = resp.get("items") or []
    return int(items[0]["statistics"].get("viewCount", 0) or 0) if items else None


def _set_thumbnail(account_key: str, video_id: str, jpg: str) -> None:
    from googleapiclient.http import MediaFileUpload
    yt, _ = _yt(account_key)
    yt.thumbnails().set(videoId=video_id, media_body=MediaFileUpload(jpg, mimetype="image/jpeg")).execute()


def _set_localizations(account_key: str, video_id: str, loc: Dict[str, Dict[str, str]], source_lang: str) -> None:
    yt, _ = _yt(account_key)
    item = _video_snippet(yt, video_id)
    if not item:
        raise RuntimeError("video not found")
    sn = item["snippet"]
    merged = {**(item.get("localizations") or {}), **loc}
    body = {"id": video_id,
            "snippet": {"title": sn["title"], "description": sn.get("description", ""), "categoryId": sn.get("categoryId", "20"),
                        "tags": sn.get("tags", []), "defaultLanguage": sn.get("defaultLanguage") or source_lang},
            "localizations": merged}
    yt.videos().update(part="snippet,localizations", body=body).execute()


def _insert_caption(account_key: str, video_id: str, lang: str, srt_text: str) -> None:
    from googleapiclient.http import MediaFileUpload
    yt, _ = _yt(account_key)
    with tempfile.NamedTemporaryFile("w", suffix=".srt", delete=False, encoding="utf-8") as f:
        f.write(srt_text)
        path = f.name
    try:
        yt.captions().insert(
            part="snippet", body={"snippet": {"videoId": video_id, "language": lang, "name": LANG_NAMES.get(lang, lang),
                                              "isDraft": False}},
            media_body=MediaFileUpload(path, mimetype="application/octet-stream")).execute()
    finally:
        os.unlink(path)


async def _run(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


async def _frame(video: str, t: float, out: str) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(0.0, t):.2f}", "-i", video, "-frames:v", "1", "-q:v", "3", out,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    await proc.wait()
    return proc.returncode == 0 and Path(out).exists()


# ----------------------------------------------------------------------------- entry points
async def _clip(clip_id: int) -> Optional[Dict[str, Any]]:
    from src.database import get_db_connection
    async with get_db_connection() as db:
        cur = await db.execute("SELECT * FROM clips WHERE id = ?", (clip_id,))
        row = await cur.fetchone()
    return dict(row) if row else None


async def after_youtube_upload(clip_id: int, account_key: str, video_id: str) -> None:
    """Start the title test and add translations for a freshly uploaded Short. Never raises."""
    try:
        cfg = await load_settings()
        from src.publisher.youtube_shorts import load_token
        if not can_edit(load_token(account_key)):
            logger.info("Growth: %s can't edit videos yet (reconnect to grant the new permission); skipping.", account_key)
            return
        clip = await _clip(clip_id)
        if not clip:
            return
        if cfg["ab_titles"]:
            await start_title_test(clip, account_key, video_id, cfg)
        if cfg["languages"] and (cfg["translate_titles"] or cfg["translate_captions"]):
            await translate_video(clip, account_key, video_id, cfg)
    except Exception as e:
        logger.warning("Growth steps failed for clip #%s (%s): %s", clip_id, video_id, e)


async def start_title_test(clip: Dict[str, Any], account_key: str, video_id: str, cfg: Dict[str, Any]) -> Optional[int]:
    from src.database import get_db_connection
    title = (clip.get("title") or "").strip()
    alts = await title_variants(title, clip.get("description") or "")
    if not alts:
        return None
    variants = [{"title": title}] + [{"title": t} for t in alts]
    if cfg.get("ab_thumbnails"):
        dur = max(3.0, float(clip.get("adjusted_end") or clip.get("raw_end") or 30) - float(clip.get("adjusted_start") or clip.get("raw_start") or 0))
        for i, v in enumerate(variants):
            v["thumb_t"] = round(dur * (0.15 + 0.3 * i), 2)
    now = datetime.now(timezone.utc)
    rounds = [{"idx": 0, "start": now.isoformat(), "end": None, "views_start": 0, "views_end": None}]
    async with get_db_connection() as db:
        cur = await db.execute(
            """INSERT OR IGNORE INTO title_tests (clip_id, account_key, video_id, variants_json, rounds_json, window_hours,
                   next_switch_at) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (clip["id"], account_key, video_id, json.dumps(variants), json.dumps(rounds), cfg["ab_window_hours"],
             (now + timedelta(hours=cfg["ab_window_hours"])).isoformat()))
        await db.commit()
        tid = cur.lastrowid
    if cfg.get("ab_thumbnails") and variants[0].get("thumb_t") is not None:
        await _apply_thumbnail(clip, account_key, video_id, variants[0]["thumb_t"])
    logger.info("Title test started for clip #%s on %s: %s", clip["id"], video_id, " | ".join(v["title"] for v in variants))
    return tid


async def _apply_thumbnail(clip: Dict[str, Any], account_key: str, video_id: str, t: float) -> None:
    video = clip.get("rendered_video_path")
    if not video or not Path(video).exists():
        return
    with tempfile.TemporaryDirectory() as tmp:
        jpg = str(Path(tmp) / "thumb.jpg")
        if await _frame(video, t, jpg):
            try:
                await _run(_set_thumbnail, account_key, video_id, jpg)
                await _record(account_key, "thumbnails.set", UNITS["thumbnail"])
            except Exception as e:  # unverified channels can't set thumbnails
                logger.info("Thumbnail not changed for %s: %s", video_id, e)


async def step_title_test(test: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, Any]:
    """Advance one test whose window ended: close the round, switch title or finish. Returns the new row."""
    from src.database import get_db_connection
    now = now or datetime.now(timezone.utc)
    variants = json.loads(test["variants_json"])
    rounds = json.loads(test["rounds_json"] or "[]")
    key, vid = test["account_key"], test["video_id"]
    order = round_order(len(variants))

    if await quota_left(key) < UNITS["update"] + UNITS["list"] * 3:
        # try again after the quota reset rather than spending upload budget
        test["next_switch_at"] = (now + timedelta(hours=2)).isoformat()
        await _save_test(test, rounds, note="waiting for YouTube quota")
        return test

    views = await _run(_views, key, vid)
    await _record(key, "videos.list", UNITS["list"])
    if views is None:
        test["status"] = "failed"
        await _save_test(test, rounds, note="video is gone (deleted or private)")
        return test
    if rounds and rounds[-1].get("views_end") is None:
        rounds[-1]["end"] = now.isoformat()
        rounds[-1]["views_end"] = views

    if len(rounds) < len(order):
        nxt = order[len(rounds)]
        if nxt != test["current_idx"]:
            await _run(_set_title, key, vid, variants[nxt]["title"])
            await _record(key, "videos.update", UNITS["update"] + UNITS["list"])
            if variants[nxt].get("thumb_t") is not None:
                clip = await _clip(test["clip_id"])
                if clip:
                    await _apply_thumbnail(clip, key, vid, variants[nxt]["thumb_t"])
        rounds.append({"idx": nxt, "start": now.isoformat(), "end": None, "views_start": views, "views_end": None})
        test["current_idx"] = nxt
        test["next_switch_at"] = (now + timedelta(hours=float(test["window_hours"]))).isoformat()
        await _save_test(test, rounds)
        return test

    rates = variant_rates(rounds, len(variants))
    winner, why = pick_winner(rates)
    if winner != test["current_idx"]:
        await _run(_set_title, key, vid, variants[winner]["title"])
        await _record(key, "videos.update", UNITS["update"] + UNITS["list"])
        if variants[winner].get("thumb_t") is not None:
            clip = await _clip(test["clip_id"])
            if clip:
                await _apply_thumbnail(clip, key, vid, variants[winner]["thumb_t"])
    test.update(status="done", winner_idx=winner, current_idx=winner, next_switch_at=None)
    await _save_test(test, rounds, note=why)
    if winner != 0:
        async with get_db_connection() as db:   # the app shows the title that is live on YouTube
            await db.execute("UPDATE clips SET title = ? WHERE id = ?", (variants[winner]["title"], test["clip_id"]))
            await db.commit()
    logger.info("Title test for %s finished: %s", vid, why)
    return test


async def _save_test(test: Dict[str, Any], rounds: List[Dict[str, Any]], note: Optional[str] = None) -> None:
    from src.database import get_db_connection
    async with get_db_connection() as db:
        await db.execute(
            """UPDATE title_tests SET status = ?, current_idx = ?, rounds_json = ?, next_switch_at = ?, winner_idx = ?,
                   note = COALESCE(?, note), updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (test["status"], test["current_idx"], json.dumps(rounds), test.get("next_switch_at"), test.get("winner_idx"),
             note, test["id"]))
        await db.commit()


async def run_title_tests_once(now: Optional[datetime] = None) -> int:
    from src.database import get_db_connection
    now = now or datetime.now(timezone.utc)
    async with get_db_connection() as db:
        cur = await db.execute("SELECT * FROM title_tests WHERE status = 'running' AND next_switch_at <= ?", (now.isoformat(),))
        due = [dict(r) for r in await cur.fetchall()]
    for t in due:
        try:
            await step_title_test(t, now)
        except Exception as e:
            logger.warning("Title test #%s step failed: %s", t["id"], e)
            t["next_switch_at"] = (now + timedelta(hours=1)).isoformat()
            await _save_test(t, json.loads(t["rounds_json"] or "[]"), note=f"retrying: {str(e)[:120]}")
    return len(due)


async def stop_title_test(test_id: int, keep_idx: Optional[int] = None) -> Dict[str, Any]:
    """Stop a running test; optionally put a chosen title live."""
    from src.database import get_db_connection
    async with get_db_connection() as db:
        cur = await db.execute("SELECT * FROM title_tests WHERE id = ?", (test_id,))
        row = await cur.fetchone()
    if not row:
        raise ValueError("Unknown title test")
    test = dict(row)
    variants = json.loads(test["variants_json"])
    idx = test["current_idx"] if keep_idx is None else int(keep_idx)
    if not 0 <= idx < len(variants):
        raise ValueError("Unknown title")
    if idx != test["current_idx"]:
        await _run(_set_title, test["account_key"], test["video_id"], variants[idx]["title"])
        await _record(test["account_key"], "videos.update", UNITS["update"] + UNITS["list"])
    test.update(status="stopped", current_idx=idx, winner_idx=idx, next_switch_at=None)
    await _save_test(test, json.loads(test["rounds_json"] or "[]"), note="stopped by you")
    return test


async def translate_video(clip: Dict[str, Any], account_key: str, video_id: str, cfg: Dict[str, Any]) -> Dict[str, str]:
    """Localized titles/descriptions (one update) + translated caption tracks (quota permitting)."""
    from src.database import get_db_connection
    langs = cfg["languages"]
    results: Dict[str, str] = {}
    title, desc = clip.get("title") or "", clip.get("description") or ""

    if cfg["translate_titles"]:
        loc: Dict[str, Dict[str, str]] = {}
        for lang in langs:
            tr = await translate_meta(title, desc, lang)
            if tr:
                loc[lang] = {"title": tr.title[:100], "description": tr.description[:4900]}
        status = "skipped"
        err = None
        if loc and await quota_left(account_key) >= UNITS["update"] + UNITS["list"]:
            try:
                await _run(_set_localizations, account_key, video_id, loc, "en")
                await _record(account_key, "videos.update", UNITS["update"] + UNITS["list"])
                status = "done"
            except Exception as e:
                status, err = "failed", str(e)[:300]
        async with get_db_connection() as db:
            for lang in langs:
                await db.execute(
                    """INSERT INTO video_translations (clip_id, account_key, video_id, language, title, description, titles_status, error)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(video_id, language) DO UPDATE SET title = excluded.title, description = excluded.description,
                         titles_status = excluded.titles_status, error = excluded.error, updated_at = CURRENT_TIMESTAMP""",
                    (clip["id"], account_key, video_id, lang, (loc.get(lang) or {}).get("title"),
                     (loc.get(lang) or {}).get("description"), status if lang in loc else "failed", err))
            await db.commit()
        results["titles"] = status

    if cfg["translate_captions"]:
        results["captions"] = await _caption_tracks(clip, account_key, video_id, langs)
    return results


async def _caption_tracks(clip: Dict[str, Any], account_key: str, video_id: str, langs: List[str]) -> str:
    from src.database import get_db_connection
    from src.publisher.slots import UPLOAD_UNITS
    video = clip.get("rendered_video_path")
    if not video or not Path(video).exists():
        return "no video file"
    try:
        from src.intelligence.transcriber import Transcriber
        tr = await Transcriber().transcribe(video)
    except Exception as e:
        logger.info("Caption transcription failed for clip #%s: %s", clip["id"], e)
        return "transcription failed"
    cues = caption_cues(tr.get("segments") or [])
    if not cues:
        return "no speech"
    done = 0
    for lang in langs:
        status, err = "skipped", None
        if await quota_left(account_key) < UNITS["caption"] + UPLOAD_UNITS * CAPTION_RESERVE_UPLOADS:
            status, err = "skipped", "saving YouTube quota for uploads"
        else:
            texts = await translate_lines([c["text"] for c in cues], lang)
            if texts is None:
                status, err = "failed", "translation failed"
            else:
                try:
                    await _run(_insert_caption, account_key, video_id, lang, to_srt(cues, texts))
                    await _record(account_key, "captions.insert", UNITS["caption"])
                    status = "done"
                    done += 1
                except Exception as e:
                    status, err = "failed", str(e)[:300]
        async with get_db_connection() as db:
            await db.execute(
                """INSERT INTO video_translations (clip_id, account_key, video_id, language, captions_status, error)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(video_id, language) DO UPDATE SET captions_status = excluded.captions_status,
                     error = COALESCE(excluded.error, video_translations.error), updated_at = CURRENT_TIMESTAMP""",
                (clip["id"], account_key, video_id, lang, status, err))
            await db.commit()
    return f"{done}/{len(langs)} tracks"


async def run_growth_loop() -> None:
    while True:
        try:
            await run_title_tests_once()
        except Exception as e:
            logger.error("Title test loop error: %s", e)
        await asyncio.sleep(LOOP_EVERY_S)
