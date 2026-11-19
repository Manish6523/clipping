"""Clip Lab: upload one raw video and run every clip-generation feature on it, one at a time.

Isolated sandbox: everything lives in data/lab/<id>/ and NOTHING here creates clips, queue rows or
changes templates. Each feature runs as a background job (poll /api/lab/jobs/<job>).

Steps: probe · transcribe (+profanity) · audio peaks · AI judge (text) · video AI judge ·
chat signals · face tracking (keyframes + debug/compare videos) · template render (+follow face,
captions, auto-edit).
"""

import asyncio
import json
import logging
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from aiohttp import web

from config.settings import BASE_DIR

logger = logging.getLogger(__name__)

LAB_DIR = Path(BASE_DIR) / "data" / "lab"
MAX_UPLOAD = 4 * 1024 * 1024 * 1024          # 4 GB
MAX_CHUNK = 64 * 1024 * 1024
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".ts", ".avi", ".flv"}
_ID_RE = re.compile(r"^[a-f0-9]{12}$")

JOBS: Dict[str, Dict[str, Any]] = {}
_HEAVY = asyncio.Semaphore(1)               # one whisper/render/tracking job at a time
_WHISPER: Dict[str, Any] = {}


# ------------------------------------------------------------------ helpers

def lab_path(lab_id: str) -> Path:
    if not _ID_RE.match(lab_id or ""):
        raise web.HTTPBadRequest(text="bad lab id")
    return LAB_DIR / lab_id


def meta(lab_id: str) -> Dict[str, Any]:
    p = lab_path(lab_id) / "meta.json"
    if not p.exists():
        raise web.HTTPNotFound(text="lab session not found")
    return json.loads(p.read_text())


def save_meta(lab_id: str, data: Dict[str, Any]) -> None:
    (lab_path(lab_id) / "meta.json").write_text(json.dumps(data, indent=2))


def source_of(lab_id: str) -> Path:
    m = meta(lab_id)
    src = lab_path(lab_id) / m["source"]
    if not src.exists():
        raise web.HTTPConflict(text="upload not finished")
    return src


def read_result(lab_id: str, name: str) -> Optional[Any]:
    p = lab_path(lab_id) / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else None


def write_result(lab_id: str, name: str, data: Any) -> None:
    (lab_path(lab_id) / f"{name}.json").write_text(json.dumps(data))


def file_url(lab_id: str, name: str) -> str:
    return f"/api/lab/{lab_id}/file/{name}?v={int(time.time())}"


async def probe(path: Path) -> Dict[str, Any]:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
        "-of", "json", str(path), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"Not a readable video: {err.decode(errors='ignore')[-200:]}")
    d = json.loads(out)
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not v:
        raise RuntimeError("The file has no video stream")
    num, _, den = (v.get("r_frame_rate") or "0/1").partition("/")
    fps = round(float(num) / float(den or 1), 2) if float(den or 1) else 0
    return {"duration": round(float(d["format"].get("duration") or 0), 2), "size": int(d["format"].get("size") or 0),
            "width": v.get("width"), "height": v.get("height"), "fps": fps, "video_codec": v.get("codec_name"),
            "audio_codec": (a or {}).get("codec_name"), "audio_rate": (a or {}).get("sample_rate"),
            "has_audio": bool(a)}


async def run_ffmpeg(args: List[str], log) -> None:
    proc = await asyncio.create_subprocess_exec("ffmpeg", "-y", "-loglevel", "error", *args,
                                                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode(errors='ignore')[-400:]}")


def clamp_window(m: Dict[str, Any], start: Any, end: Any, max_len: float = 180.0) -> tuple:
    dur = float(m["info"]["duration"])
    s = max(0.0, min(dur, float(start or 0)))
    e = float(end) if end not in (None, "") else min(dur, s + 30)
    e = max(s + 1.0, min(dur, e))
    if e - s > max_len:
        e = s + max_len
    return round(s, 2), round(e, 2)


# ------------------------------------------------------------------ upload + sessions

async def upload_start(request: web.Request) -> web.Response:
    data = await request.json()
    name = Path(str(data.get("name") or "video.mp4")).name
    size = int(data.get("size") or 0)
    ext = Path(name).suffix.lower()
    if ext not in VIDEO_EXT:
        return web.json_response({"error": f"Unsupported file type {ext or '(none)'}. Use mp4, mov, mkv, webm…"}, status=400)
    if size <= 0 or size > MAX_UPLOAD:
        return web.json_response({"error": "File must be between 1 byte and 4 GB"}, status=400)
    lab_id = uuid.uuid4().hex[:12]
    d = LAB_DIR / lab_id
    d.mkdir(parents=True, exist_ok=True)
    save_meta(lab_id, {"id": lab_id, "name": name, "size": size, "source": f"source{ext}", "received": 0,
                       "created": time.time(), "ready": False})
    return web.json_response({"id": lab_id, "chunk_size": 16 * 1024 * 1024})


async def upload_chunk(request: web.Request) -> web.Response:
    lab_id = request.match_info["id"]
    m = meta(lab_id)
    offset = int(request.query.get("offset", "-1"))
    if offset != m["received"]:
        return web.json_response({"error": "out of order", "received": m["received"]}, status=409)
    target = lab_path(lab_id) / (m["source"] + ".part")
    got = 0
    with open(target, "ab") as f:
        async for chunk in request.content.iter_chunked(256 * 1024):
            got += len(chunk)
            if got > MAX_CHUNK or m["received"] + got > m["size"]:
                return web.json_response({"error": "chunk too large"}, status=413)
            f.write(chunk)
    m["received"] += got
    save_meta(lab_id, m)
    return web.json_response({"received": m["received"]})


async def upload_finish(request: web.Request) -> web.Response:
    lab_id = request.match_info["id"]
    m = meta(lab_id)
    part = lab_path(lab_id) / (m["source"] + ".part")
    if m["received"] != m["size"] or not part.exists():
        return web.json_response({"error": f"Upload incomplete ({m['received']}/{m['size']} bytes)"}, status=409)
    final = lab_path(lab_id) / m["source"]
    part.replace(final)
    try:
        m["info"] = await probe(final)
    except Exception as e:
        shutil.rmtree(lab_path(lab_id), ignore_errors=True)
        return web.json_response({"error": str(e)}, status=400)
    m["ready"] = True
    save_meta(lab_id, m)
    # poster frame for the crop picker
    try:
        await run_ffmpeg(["-ss", str(min(5.0, m["info"]["duration"] / 3)), "-i", str(final), "-frames:v", "1",
                          "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,scale=960:540",
                          str(lab_path(lab_id) / "frame.jpg")], None)
    except Exception:
        pass
    return web.json_response(session_view(lab_id))


def session_view(lab_id: str) -> Dict[str, Any]:
    m = meta(lab_id)
    d = lab_path(lab_id)
    results = {}
    for name in ("transcribe", "audio", "judge", "video_judge", "chat", "face", "render", "auto_template"):
        r = read_result(lab_id, name)
        if r is not None:
            results[name] = r
    return {"id": lab_id, "name": m["name"], "info": m.get("info"), "ready": m.get("ready"), "created": m.get("created"),
            "source_url": f"/api/lab/{lab_id}/file/{m['source']}", "frame_url": file_url(lab_id, "frame.jpg") if (d / "frame.jpg").exists() else None,
            "results": results,
            "jobs": [summ(j) for j in JOBS.values() if j["lab_id"] == lab_id and j["status"] in ("queued", "running")]}


async def list_sessions(request: web.Request) -> web.Response:
    out = []
    if LAB_DIR.exists():
        for d in sorted(LAB_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                m = json.loads((d / "meta.json").read_text())
                if m.get("ready"):
                    out.append({"id": m["id"], "name": m["name"], "duration": m["info"]["duration"], "created": m["created"]})
            except Exception:
                continue
    return web.json_response({"sessions": out[:30]})


async def get_session(request: web.Request) -> web.Response:
    return web.json_response(session_view(request.match_info["id"]))


async def delete_session(request: web.Request) -> web.Response:
    d = lab_path(request.match_info["id"])
    shutil.rmtree(d, ignore_errors=True)
    return web.json_response({"success": True})


async def serve_file(request: web.Request) -> web.StreamResponse:
    d = lab_path(request.match_info["id"])
    name = Path(request.match_info["name"]).name
    f = d / name
    if not f.exists() or f.suffix == ".part":
        raise web.HTTPNotFound()
    return web.FileResponse(f, headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------------ jobs

def summ(j: Dict[str, Any]) -> Dict[str, Any]:
    return {k: j[k] for k in ("id", "lab_id", "step", "status", "progress", "log", "error", "started", "finished") if k in j}


async def run_step(request: web.Request) -> web.Response:
    lab_id, step = request.match_info["id"], request.match_info["step"]
    if step not in RUNNERS:
        return web.json_response({"error": f"Unknown step {step}"}, status=404)
    m = meta(lab_id)
    if not m.get("ready"):
        return web.json_response({"error": "Upload not finished"}, status=409)
    try:
        params = await request.json() if request.can_read_body else {}
    except Exception:
        params = {}
    for j in JOBS.values():
        if j["lab_id"] == lab_id and j["step"] == step and j["status"] in ("queued", "running"):
            return web.json_response({"error": "That test is already running", "job": summ(j)}, status=409)
    job = {"id": uuid.uuid4().hex[:10], "lab_id": lab_id, "step": step, "status": "queued", "progress": "", "log": [],
           "error": None, "started": time.time(), "finished": None}
    JOBS[job["id"]] = job

    def log(msg: str) -> None:
        job["log"].append(f"{time.strftime('%H:%M:%S')} {msg}")
        job["progress"] = msg

    async def go():
        heavy = step in ("transcribe", "face", "render", "video_judge", "auto_template")
        try:
            if heavy:
                if _HEAVY.locked():
                    log("Waiting for another heavy test to finish…")
                async with _HEAVY:
                    job["status"] = "running"
                    result = await RUNNERS[step](lab_id, m, params, log)
            else:
                job["status"] = "running"
                result = await RUNNERS[step](lab_id, m, params, log)
            write_result(lab_id, step, result)
            job["status"] = "done"
            log("Done")
        except Exception as e:
            logger.warning("Lab step %s failed: %s", step, e, exc_info=True)
            job["status"], job["error"] = "failed", str(e)[:600]
        finally:
            job["finished"] = time.time()
            for k in [k for k, v in JOBS.items() if v["finished"] and time.time() - v["finished"] > 3600]:
                JOBS.pop(k, None)

    asyncio.create_task(go())
    return web.json_response({"job": summ(job)})


async def get_job(request: web.Request) -> web.Response:
    j = JOBS.get(request.match_info["job"])
    if not j:
        return web.json_response({"error": "job not found"}, status=404)
    out = summ(j)
    if j["status"] == "done":
        out["result"] = read_result(j["lab_id"], j["step"])
    return web.json_response(out)


# ------------------------------------------------------------------ runners

async def step_transcribe(lab_id, m, p, log):
    from src.intelligence.transcriber import Transcriber
    from src.intelligence.sentences import SentenceChunker
    from src.compositor.profanity import prepare_censor
    if not m["info"].get("has_audio"):
        raise RuntimeError("This video has no audio track")
    model = p.get("model") or None
    key = model or "default"
    if key not in _WHISPER:
        _WHISPER.clear()                                    # keep only one model in memory
        _WHISPER[key] = Transcriber(model_size=model, model_setting="LIVE_WHISPER_MODEL", beam_size=1)
    tr = _WHISPER[key]
    log(f"Transcribing with Whisper '{tr.model_size}' (first run loads the model)…")
    t0 = time.time()
    res = await tr.transcribe(str(source_of(lab_id)))
    took = time.time() - t0
    words, censor_cfg = await prepare_censor(res.get("words", []))
    sentences = SentenceChunker.from_whisper_result(res)
    flagged = [{"word": w.get("word"), "start": w.get("start"), "tier": w.get("profanity"), "censored": bool(w.get("censored"))}
               for w in words if w.get("profanity")]
    log(f"{len(words)} words, {len(sentences)} sentences in {took:.0f}s")
    return {"model": tr.model_size, "seconds": round(took, 1), "rtf": round(took / max(1, m["info"]["duration"]), 2),
            "text": res.get("text", ""), "words": words, "language": res.get("language"),
            "sentences": [{"id": s.id, "start": s.start, "end": s.end, "text": s.text} for s in sentences],
            "profanity": {"flagged": flagged, "enabled": bool(censor_cfg.get("enabled", True))}}


async def step_audio(lab_id, m, p, log):
    from src.compositor.auto_edit import audio_energy
    from config.settings import AUDIO_PEAK_DB_THRESHOLD
    if not m["info"].get("has_audio"):
        raise RuntimeError("This video has no audio track")
    log("Measuring loudness every 0.5 s…")
    series = await audio_energy(str(source_of(lab_id)), window=0.5)
    vals = sorted(v for _, v in series if v > -89)
    median = vals[len(vals) // 2] if vals else -60.0
    threshold = float(p.get("threshold") or AUDIO_PEAK_DB_THRESHOLD)
    peaks, last = [], -999.0
    for t, v in sorted(series, key=lambda x: x[1], reverse=True):
        if v >= threshold or v >= median + 18:
            if all(abs(t - q["time"]) > 8 for q in peaks):
                peaks.append({"time": round(t, 1), "db": round(v, 1), "above_median": round(v - median, 1)})
        if len(peaks) >= 10:
            break
    log(f"{len(peaks)} loud moments (live trigger threshold {threshold} dBFS, median {median:.1f})")
    step = max(1, len(series) // 600)
    return {"series": [[round(t, 1), round(v, 1)] for t, v in series[::step]], "median": round(median, 1),
            "threshold": threshold, "peaks": sorted(peaks, key=lambda q: q["time"])}


def parse_chat(text: str) -> List[tuple]:
    """Lines like '12:34 KEKW', '754.2 lol', '[1:02:03] user: msg' or plain lines (no time)."""
    out = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        mt = re.match(r"^\[?(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)\]?\s+(.*)$", line)
        if mt:
            parts = [float(x) for x in mt.group(1).split(":")]
            secs = 0.0
            for x in parts:
                secs = secs * 60 + x
            msg = mt.group(2)
            msg = re.sub(r"^[\w.]{2,25}:\s+", "", msg)         # strip "user: "
            out.append((secs, msg))
        else:
            out.append((None, line))
    return out


async def step_chat(lab_id, m, p, log):
    from src.intelligence.chat_signals import (
        chat_signal_score, classify_reaction, describe_reaction, emote_wall, spikes_from_replay)
    lines = parse_chat(p.get("chat") or "")
    if not lines:
        raise RuntimeError("Paste some chat messages first")
    msgs = [x for _, x in lines]
    reaction = classify_reaction(msgs)
    wall = emote_wall(msgs)
    users = int(p.get("chatters") or max(1, len(set(msgs))))
    ratio = float(p.get("ratio") or 3.0)
    timed = [(t, x) for t, x in lines if t is not None]
    spikes = spikes_from_replay(timed, duration=m["info"]["duration"], min_count=int(p.get("min_count") or 8)) if timed else []
    log(f"{len(msgs)} messages, mood {reaction['mood']}, {len(spikes)} spikes")
    return {"messages": len(msgs), "timed": len(timed), "reaction": reaction, "wall": wall,
            "description": describe_reaction({"mood": reaction["mood"], "mood_share": reaction["share"],
                                              "unique_chatters": users, "top": reaction.get("top")}),
            "signal_score": chat_signal_score(ratio, reaction["share"], users), "ratio": ratio, "chatters": users,
            "spikes": spikes}


async def step_judge(lab_id, m, p, log):
    from src.intelligence.calibrated_judge import CalibratedJudge
    tr = read_result(lab_id, "transcribe")
    if not tr:
        raise RuntimeError("Run Transcription first")
    sentences = tr["sentences"]
    s, e = clamp_window(m, p.get("start"), p.get("end"), max_len=900)
    sents = [x for x in sentences if x["end"] > s and x["start"] < e] or sentences
    trigger = {"type": "lab_test"}
    chat = read_result(lab_id, "chat")
    chat_features = None
    if p.get("use_chat") and chat:
        trigger = {"type": "chat_spike", "ratio": chat["ratio"], "mood": chat["reaction"]["mood"],
                   "mood_share": chat["reaction"]["share"], "unique_chatters_5s": chat["chatters"],
                   "signal_score": chat["signal_score"]}
    log(f"Gemini judging {len(sents)} sentences ({s:.0f}-{e:.0f}s)…")
    judge = CalibratedJudge()
    cands = await judge.evaluate_moment(channel_id=p.get("channel") or "lab", sentences=sents[:120],
                                        trigger_context=trigger, chat_features=chat_features, min_score=0,
                                        include_rejected=True)
    if not cands and judge.client._client is None:
        raise RuntimeError("No Gemini API key configured (Settings > AI keys)")
    log(f"{len(cands)} candidates")
    keep = ("title", "reject_reason", "hook_text", "description", "hashtags", "start_time", "end_time", "virality_score", "final_score",
            "predicted_score", "would_post", "scores", "evidence", "flags", "editorial_reason")
    return {"window": [s, e], "trigger": trigger, "model": judge.model_name,
            "candidates": [{k: c.get(k) for k in keep} for c in cands]}


async def step_video_judge(lab_id, m, p, log):
    from src.intelligence.video_judge import VideoJudge, blend_score
    s, e = clamp_window(m, p.get("start"), p.get("end"), max_len=75)
    score = float(p.get("score") or 70)
    judge = VideoJudge()
    if getattr(judge.client, "_client", None) is None:
        await judge.client._sync_keys_from_db()
    if getattr(judge.client, "_client", None) is None:
        raise RuntimeError("No Gemini API key configured (Settings > AI keys)")
    log(f"Gemini is watching {s:.0f}-{e:.0f}s (360p, 2 fps proxy)…")
    v = await judge.judge_one(str(source_of(lab_id)), {"start": s, "end": e, "score": score,
                                                       "title": p.get("title") or "Lab test", "text": p.get("text") or ""})
    if not v:
        raise RuntimeError("Gemini returned no verdict (quota, overload or the proxy failed) - try again")
    return {"window": [s, e], "text_score": score, "verdict": v.model_dump(), "blended": blend_score(score, v)}


async def step_face(lab_id, m, p, log):
    from src.compositor.face_tracker import (
        FaceTracker, _Detector, crop_filter, motion_expr, search_region, track_crop, LAYOUT_W, LAYOUT_H)
    s, e = clamp_window(m, p.get("start"), p.get("end"), max_len=120)
    dur = e - s
    src = str(source_of(lab_id))
    full = p.get("mode") == "full"
    det = _Detector()
    detector_name = "YuNet" if det.yunet is not None else ("Haar cascade" if det.haar is not None else "none")
    if full:
        crop = FaceTracker().full_frame_crop()
        pad, headroom, smooth = 1.2, 0.4, float(p.get("smooth", 0.85))
    else:
        c = p.get("crop") or {"x": 0.0, "y": 0.1, "w": 0.22, "h": 0.32}
        x, y = int(float(c["x"]) * LAYOUT_W) // 2 * 2, int(float(c["y"]) * LAYOUT_H) // 2 * 2
        w = max(32, int(float(c["w"]) * LAYOUT_W) // 2 * 2)
        h = max(32, int(float(c["h"]) * LAYOUT_H) // 2 * 2)
        w, h = min(w, LAYOUT_W - x), min(h, LAYOUT_H - y)
        crop = (x, y, w, h)
        pad, headroom, smooth = float(p.get("range", 0.35)), 0.42, float(p.get("smooth", 0.8))
    aspect = float(p["view_aspect"]) if p.get("view_aspect") else None
    log(f"Detecting faces ({detector_name}) at 5 fps over {dur:.0f}s…")
    t0 = time.time()
    kfs = await asyncio.to_thread(track_crop, src, s, dur, crop, smooth, pad, headroom, det, aspect)
    took = time.time() - t0
    log(f"{len(kfs)} keyframes in {took:.1f}s; rendering previews…")
    d = lab_path(lab_id)
    norm = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1"

    # 1) debug view: whole frame with the search region (yellow), drawn crop (white) and followed crop (green)
    rx, ry, rw, rh = search_region(crop, pad)
    half = [(t, dx / 2, dy / 2) for t, dx, dy in kfs]
    cx, cy, cw, ch = crop
    gx = motion_expr(cx // 2, half, 1, 0, (LAYOUT_W - cw) // 2) if kfs else str(cx // 2)
    gy = motion_expr(cy // 2, half, 2, 0, (LAYOUT_H - ch) // 2) if kfs else str(cy // 2)
    debug_vf = (f"{norm},scale=960:540,"
                f"drawbox=x={int(rx/2)}:y={int(ry/2)}:w={int(rw/2)}:h={int(rh/2)}:color=yellow@0.7:t=2,"
                f"drawbox=x={cx//2}:y={cy//2}:w={cw//2}:h={ch//2}:color=white@0.8:t=2,"
                f"drawbox=x='{gx}':y='{gy}':w={cw//2}:h={ch//2}:color=0x22c55e:t=4")
    await run_ffmpeg(["-ss", f"{s:.3f}", "-t", f"{dur:.3f}", "-i", src, "-vf", debug_vf, "-an",
                      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                      str(d / "face_debug.mp4")], log)

    # 2) side by side: static crop | followed crop (with audio)
    th = 640
    tw = int(round(cw * th / ch / 2)) * 2
    graph = (f"[0:v]{norm},split=2[a][b];[a]crop={cw}:{ch}:{cx}:{cy},scale={tw}:{th},setsar=1[l];"
             f"[b]{crop_filter(crop, kfs)},scale={tw}:{th},setsar=1[r];"
             f"[l]pad={tw + 8}:{th}:0:0:color=black[lp];[lp][r]hstack=inputs=2[v]")
    args = ["-ss", f"{s:.3f}", "-t", f"{dur:.3f}", "-i", src, "-filter_complex", graph, "-map", "[v]"]
    if m["info"].get("has_audio"):
        args += ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k"]
    await run_ffmpeg(args + ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
                             "-movflags", "+faststart", str(d / "face_compare.mp4")], log)
    xs = [k[1] for k in kfs] or [0]
    ys = [k[2] for k in kfs] or [0]
    return {"window": [s, e], "mode": "full" if full else "crop", "detector": detector_name, "crop": list(crop),
            "search_region": [int(rx), int(ry), int(rw), int(rh)], "range": pad, "smooth": smooth,
            "keyframes": kfs, "seconds": round(took, 1), "followed": bool(kfs),
            "max_shift": [round(max(map(abs, xs)), 1), round(max(map(abs, ys)), 1)],
            "debug_url": file_url(lab_id, "face_debug.mp4"), "compare_url": file_url(lab_id, "face_compare.mp4")}


async def step_render(lab_id, m, p, log):
    import copy
    from src.bot.trimmer import load_template
    from src.compositor.ass_generator import generate_ass_subtitles
    from src.compositor.auto_edit import auto_edit_clip, cut_segments, resolve_config
    from src.compositor.ffmpeg_renderer import FFmpegRenderer
    from src.compositor.profanity import prepare_censor
    from src.intelligence.story_stitch import window_words

    s, e = clamp_window(m, p.get("start"), p.get("end"), max_len=180)
    dur = e - s
    src = str(source_of(lab_id))
    if isinstance(p.get("template_json"), dict) and (p["template_json"].get("layout") or {}).get("layers"):
        template = copy.deepcopy(p["template_json"])
        name = template.get("name") or "auto template"
    else:
        name = p.get("template") or "Bottom Left"
        template = copy.deepcopy(load_template(name))
    follow = set(p.get("follow_face") or [])
    layers = (template.get("layout") or {}).get("layers") or []
    for layer in layers:
        if layer.get("id") in follow:
            layer["tracking"] = {**(layer.get("tracking") or {}), "mode": "face", "smooth": float(p.get("smooth", 0.8))}
        elif p.get("follow_face") is not None:
            layer["tracking"] = {**(layer.get("tracking") or {}), "mode": "off"}
    d = lab_path(lab_id)
    tr = read_result(lab_id, "transcribe")
    words = tr["words"] if tr and p.get("captions", True) else []
    words, censor_cfg = await prepare_censor(words, template)
    renderer = FFmpegRenderer()
    out = d / "render.mp4"
    out.unlink(missing_ok=True)
    auto = resolve_config({"enabled": True, "style": p.get("auto_edit_style") or "punchy",
                           "hook_card": bool(p.get("hook_text"))}) if p.get("auto_edit") else None
    tracked = [l.get("name") or l.get("id") for l in layers if (l.get("tracking") or {}).get("mode") == "face"]
    log(f"Rendering '{name}' {s:.0f}-{e:.0f}s" + (f", following face on {', '.join(tracked)}" if tracked else "")
        + (", auto-edit " + p.get("auto_edit_style", "punchy") if auto else "") + "…")
    t0 = time.time()
    summary = None
    if auto:
        window = d / "render_window.mp4"
        await cut_segments(src, [(s, e)], window)
        try:
            edited = await auto_edit_clip(renderer, window, window_words(words, s, e, 0.0), dur, template, auto,
                                          censor_cfg, out, d / "work", "lab", hook_text=p.get("hook_text") or None)
            summary = edited.get("summary")
        finally:
            window.unlink(missing_ok=True)
            shutil.rmtree(d / "work", ignore_errors=True)
    else:
        ass = d / "render.ass"
        if words:
            generate_ass_subtitles(word_timestamps=words, output_path=str(ass), template_config=template,
                                   time_offset=s, max_duration=dur, censor_cfg=censor_cfg)
        await renderer.render_clip(source_path=src, start_time=s, end_time=e, output_path=str(out), template=template,
                                   ass_path=str(ass) if words else None, include_teaser=False,
                                   censor_words=words, censor_cfg=censor_cfg)
    took = time.time() - t0
    if not out.exists():
        raise RuntimeError("Render produced no file")
    info = await probe(out)
    log(f"Rendered {info['width']}x{info['height']} {info['duration']}s in {took:.0f}s")
    return {"window": [s, e], "template": name, "followed_layers": tracked, "captions": bool(words),
            "auto_edit": p.get("auto_edit_style") if auto else None, "auto_edit_summary": summary,
            "seconds": round(took, 1), "info": info, "url": file_url(lab_id, "render.mp4")}


async def step_auto_template(lab_id, m, p, log):
    from src.bot.trimmer import load_template
    from src.compositor import auto_template as at
    from src.compositor.filter_graph_builder import build_filter_graph
    from src.compositor.ffmpeg_renderer import normalize_source_input, probe_video_size

    src = str(source_of(lab_id))
    dur = float(m["info"]["duration"])
    d = lab_path(lab_id)
    r = await at.analyse(src, dur, use_gemini=p.get("use_gemini", True), log=log)
    kind, confidence, edge_sides, face, cam = r["kind"], r["confidence"], r["edge_sides"], r["face"], r["cam"]
    heur, gem_box, source, sides, gemini = r["heur"], r["gem_box"], r["source"], r["sides"], r["gemini"]
    frames, best_i = r["frames"], r["best_i"]
    variants = at.build_variants(kind, cam, face)
    base_name = p.get("base") or "Bottom Left"
    base = load_template(base_name)
    stem = re.sub(r"[^A-Za-z0-9 _-]+", "", Path(m["name"]).stem).strip()[:40] or "stream"
    t_frame = frames[best_i][0]
    src_size = await probe_video_size(src)
    log(f"Rendering previews of {len(variants)} layouts…")
    out_variants = []
    for v in variants:
        tpl = at.make_template(base, v["layout"], f"{stem} {v['id']}",
                               f"Auto-generated from {m['name']} ({v['title']}). Captions/pacing from '{base_name}'.")
        graph = build_filter_graph(tpl["layout"], speed_multiplier=1.0)["filter_complex"]
        graph = normalize_source_input(graph, src_size) + ";[vout]scale=360:640[thumb]"
        img = d / f"auto_{v['id']}.jpg"
        try:
            # output-side -ss: skip the first frames (the solid background starts before the video does)
            await run_ffmpeg(["-ss", f"{max(0.0, t_frame - 0.5):.2f}", "-i", src, "-filter_complex", graph, "-map", "[thumb]",
                              "-ss", "0.5", "-frames:v", "1", str(img)], log)
            preview = file_url(lab_id, img.name)
        except Exception as e:
            log(f"Preview for {v['id']} failed: {e}")
            preview = None
        out_variants.append({"id": v["id"], "title": v["title"], "hint": v["hint"], "preview_url": preview, "template": tpl})

    await asyncio.to_thread(at.draw_debug, frames[best_i][1], face, cam, gem_box, heur, str(d / "auto_debug.jpg"))
    return {"kind": kind, "confidence": confidence, "edge_sides": edge_sides, "face": face, "cam_box": [round(v) for v in cam] if cam else None, "source": source,
            "side_confidence": sides, "gemini": gemini, "frames": len(frames), "base": base_name,
            "debug_url": file_url(lab_id, "auto_debug.jpg"), "variants": out_variants}


async def template_layers(request: web.Request) -> web.Response:
    """Templates with their layers (for 'follow face' and 'use this crop')."""
    from config.settings import TEMPLATES_DIR
    from src.compositor.template_migration import migrate_layout_to_v2
    out = []
    for f in sorted(Path(TEMPLATES_DIR).glob("*.json")):
        try:
            t = json.loads(f.read_text())
            layout = t.get("layout") or {}
            v2 = layout if (layout.get("schema") == 2 or "layers" in layout) else migrate_layout_to_v2(t)
            out.append({"name": f.stem, "layers": [
                {"id": l.get("id"), "name": l.get("name") or l.get("id"), "src": l.get("src"), "dst": l.get("dst"),
                 "fit": l.get("fit", "cover"), "tracking": (l.get("tracking") or {}).get("mode", "off")}
                for l in v2.get("layers", [])]})
        except Exception:
            continue
    return web.json_response({"templates": out})


RUNNERS = {
    "transcribe": step_transcribe, "audio": step_audio, "chat": step_chat, "judge": step_judge,
    "video_judge": step_video_judge, "face": step_face, "render": step_render, "auto_template": step_auto_template,
}


def register_lab_routes(app: web.Application) -> None:
    app.router.add_post("/api/lab/upload", upload_start)
    app.router.add_put("/api/lab/{id}/chunk", upload_chunk)
    app.router.add_post("/api/lab/{id}/finish", upload_finish)
    app.router.add_get("/api/lab/sessions", list_sessions)
    app.router.add_get("/api/lab/templates", template_layers)
    app.router.add_get("/api/lab/jobs/{job}", get_job)
    app.router.add_get("/api/lab/{id}", get_session)
    app.router.add_delete("/api/lab/{id}", delete_session)
    app.router.add_get("/api/lab/{id}/file/{name}", serve_file)
    app.router.add_post("/api/lab/{id}/run/{step}", run_step)
