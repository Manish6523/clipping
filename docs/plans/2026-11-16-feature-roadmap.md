# Feature roadmap (2026-11-16)

Status legend: **[done]** implemented 2026-11-16 · **[now]** being implemented in this round · **[next]** planned · **[later]** idea backlog.

## Overview

| # | Feature | Group | Status |
|---|---------|-------|--------|
| 1 | Video-aware AI judge | Better clips | **[done]** |
| 2 | Chat-spike detection 2.0 | Better clips | **[done]** |
| 3 | Twitch community clips as a signal | Better clips | [next] |
| 4 | Auto hook generation (first 2 s on-screen hook) | Better clips | [next] |
| 5 | Per-platform titles, descriptions, hashtags | Better clips | [next] |
| 6 | Face-tracking auto-reframe | Editing | **[done]** |
| 7 | Auto zoom-ins on the peak moment | Editing | [next] |
| 8 | AI-suggested sound effects / meme overlays | Editing | [later] |
| 9 | Animated word-by-word captions with emoji + key-word colour | Editing | [next] |
| 10 | Background music bed with auto-ducking | Editing | [later] |
| 11 | AI dubbing / translation | Editing | [later] |
| 12 | One-tap publish (YouTube Shorts, TikTok, Instagram Reels) | Publishing | **[done]** (TikTok untested against the live API) |
| 13 | Queue calendar with best-time suggestions | Publishing | [next] (calendar exists) |
| 14 | Performance analytics feeding back into the judge | Publishing | [next] |
| 15 | A/B hooks | Publishing | [later] |
| 16 | Kick + YouTube Live chat support | Multi-streamer | [next] |
| 17 | Per-streamer brand kits | Multi-streamer | [later] |
| 18 | Approval links for streamers/editors | Teams | [later] |
| 19 | Push / Discord notifications | Teams | [next] |
| 20 | Weekly compilations / top-10 videos | Long-form | [later] |
| 21 | Story clips 2.0 (narrated intro) | Long-form | [later] |

## What already exists (starting point)

- **Judge:** `CalibratedJudge` (Gemini, transcript + chat sample + trigger) scores live and VOD moments. It is text-only.
- **Chat:** the live watcher reads Twitch IRC anonymously and triggers on velocity spikes (5 s rate vs. a 10-minute baseline) and keyword bursts. Chat messages and top tokens go to the judge.
- **Face:** `FaceTracker` (Haar cascade) is only used by the legacy `dynamic_face_track` layout. It renders one *static* average crop, so it doesn't actually follow anything.
- **Publishing:** YouTube Shorts (official API, multi-account, quota guard, retries), Instagram Reels (instagrapi), the drip scheduler, slots, "Post now", the queue calendar and Telegram post-now. There is no TikTok support, and a clip can't choose where it goes.

---

## 1. Video-aware AI judge [now]

**Goal:** re-rank the best transcript candidates by what is actually *seen and heard* (reactions, kills, jumpscares, rage, laughter), not just what was said.

**Design**
- New `src/intelligence/video_judge.py`:
  - `make_proxy(source, start, end)`: ffmpeg writes a small proxy of the candidate window: 360p, 2 fps, mono 32 kHz audio, about 1–2 MB for 60 s. The proxy is capped at 75 s.
  - `VideoJudge.rerank(candidates, source_path)`: for the top *K* candidates (default 3), it sends the proxy inline to Gemini with the candidate's title and transcript. It asks for a structured `VisualVerdict`:
    - `visual_score` and `reaction_score` (1–10)
    - `visible_events[]`
    - `verdict` (`boost` / `neutral` / `weak`)
    - `reason`
  - **Blend:** `final = 0.75·text_final + 0.25·visual`, where `visual = (visual_score + reaction_score) · 5`. Candidates are then re-sorted. The verdict and blended score are stored in the candidate's `video_judge` field, and also in the clip's `score_breakdown`, so the UI can show *why*.
- `GeminiClient.generate_structured_media(...)`: inline video bytes via `google.genai` `Part.from_bytes`. The cache key includes the SHA-256 of the proxy.
- **Fail-open:** with no key, a quota error or an ffmpeg failure, the original order is kept and the pipeline never blocks.
- **Wiring**
  - **Live:** after the calibrated judge, re-rank its candidates against the buffered slice, which is still on disk at that point.
  - **VOD:** the slices for the top `max_clips + 2` candidates are downloaded anyway. They're judged and re-ranked, then the top `max_clips` are rendered from the already-downloaded slices, with no second download.
- **Settings:** `video_judge_enabled` (default on), `video_judge_top_k` (default 3).

**Tests:** blend and re-rank maths; fail-open with no client; proxy command shape; settings parsing.

## 2. Chat-spike detection 2.0 [now]

**Goal:** chat already tells us *that* something happened. Use it to also say *what kind* of moment it was, catch emote walls that velocity misses, and use chat for YouTube VODs too.

**Design**
- New `src/intelligence/chat_signals.py` (pure functions, unit-tested):
  - `classify_reaction(messages)` returns the mood (`laugh` / `hype` / `shock` / `sad` / `rage` / `mixed`) and its share of recent messages. It uses curated emote/token lexicons: KEKW, LUL, OMEGALUL, ICANT, 💀, 😂, LMAO for laugh; POG, W, LETSGO for hype; and so on.
  - `emote_wall(messages)`: the share of messages that are the same token repeated, such as "KEKW KEKW KEKW".
  - `chat_signal_score(ratio, mood_share, unique_chatters)` gives a 0–100 signal strength, replacing the linear `50 + 10·ratio` guess in the judge.
  - `spikes_from_replay(comments, window=5)` finds velocity peaks in a timestamped comment list (for VODs).
- **Live watcher**
  - A new trigger type, `emote_burst`, fires when at least 60 % of messages in 5 s are reaction emotes, with at least 8 messages, from at least 5 distinct chatters, and with chat at 1.3× or more of its baseline. A wall of KEKW at normal chat speed is a real moment that the velocity trigger missed.
  - The trigger context now carries the `mood`, `mood_share` and `unique_chatters_5s`.
- **Judge:** the prompt gets "Chat reaction: laugh (72 % of messages, 31 chatters)", and the signal score uses `chat_signal_score`.
- **YouTube VOD chat replay:** for YouTube VODs (past live streams), `yt-dlp --write-subs --sub-langs live_chat` downloads the chat replay. Chat peaks feed the VOD trigger context alongside the "most replayed" heatmap. Best-effort: no replay means nothing changes.

**Tests:** mood classification, emote walls, signal score monotonicity, replay spike finding, the emote_burst trigger in the watcher.

## 6. Face-tracking auto-reframe [now]

**Goal:** a layer can **follow the face**. The crop window moves smoothly with the streamer when they lean or move, instead of staying fixed where it was drawn in the Studio.

**Design**
- Template layer option: `track: {"mode": "face", "strength": 0.0–1.0}`, off by default.
- `src/compositor/face_tracker.py` is upgraded:
  - It uses **YuNet** (`cv2.FaceDetectorYN`, OpenCV 4.14, about 230 KB ONNX model). The model is downloaded once to `config/models/`. If it's missing, the tracker falls back to the Haar cascade.
  - `track_region(video, start, dur, crop_rect, src_size)` samples about 5 fps inside a **search region**, which is the layer's crop grown by 35 % on each side. Following stays local, so it can't jump to a face in the gameplay. It picks the face closest to the previous one (size-weighted). Gaps are held.
  - **Smoothing:** a rolling median, then a **dead zone** (it only moves when the face drifts more than 8 % of the crop width from the target), then an ease-out pass. The output is keyframes every 0.5 s.
  - The output is an offset `(dx, dy)` keyframe list in the 1920×1080 layout space, clamped so the crop never leaves the frame or its search region.
- `filter_graph_builder`: when a layer has motion keyframes, its `crop` gets per-frame `x`/`y` expressions. These are a piecewise-linear sum of `between(t,…)` terms, so ffmpeg interpolates between keyframes and nothing is re-encoded twice.
- `ffmpeg_renderer.render_clip`: for tracked layers, the motion is analysed on the `[start, start+duration]` window before the graph is built. Input seeking makes `t` start at 0, which matches. Any analysis failure renders the static crop.
- The legacy `dynamic_face_track` layout uses the same tracker, so it moves now instead of using a static average.
- **Studio:** a "Follow face" toggle on the selected layer, shown on desktop and phone.

**Tests:** smoothing and dead-zone maths, clamping, expression builder (valid ffmpeg: a real render of a synthetic clip), and a no-face fallback.

## 12. One-tap publish [now]

**Goal:** from any clip, one sheet: **pick platforms → Post now or Schedule → done**, with TikTok added.

**Design**
- **TikTok** (`src/publisher/tiktok.py`, official Content Posting API v2):
  - **OAuth (Login Kit v2):** `/api/tiktok/app-config` stores the client key and secret, `/api/tiktok/auth-url` builds the login link, and `/api/tiktok/oauth2callback` saves the token to `config/tokens/tt_{open_id}.json`. Tokens refresh automatically (24 h access, 365 d refresh).
  - **Upload:** `FILE_UPLOAD` in 10 MB chunks, then poll `status/fetch`.
    - **Default "inbox" mode** sends the video to the account's TikTok drafts. The user taps post in the app. This works for unaudited apps.
    - **"direct" mode** is for audited apps and uses the configured privacy level.
- **Queue:** `scheduled_queue` gets `tt_status` and `tt_publish_id` (migration). The scheduler uploads TikTok once per clip, like Instagram, with the same retry and permanent-error logic.
- **API:** `POST /api/clips/{id}/publish {platforms: ["youtube","instagram","tiktok"], when: "now" | "slot" | ISO time}`. It creates or updates the queue rows with only the chosen platforms set to `pending` and the others `skipped`. For `now`, it runs `publish_clip_now`. `GET /api/publish/targets?channel=` lists the connected accounts per platform for the sheet.
- **UI:** a `PublishSheet` (bottom sheet on phone, dialog on desktop):
  - platform toggles with the account names (disabled with "Connect…" when not set up)
  - Post now / Next free slot / Pick time
  - per-platform results
  - It opens from the swipe review's Approve button, the clip review detail and the Overview tile menu.
  - A TikTok card in the Accounts page has the connect flow.

**Tests:** queue-row platform selection, TikTok init and chunk payloads (mocked HTTP), the token refresh path, and the publish endpoint (mocked uploads; no real posting).

**Limits to know:** TikTok direct posting from an unaudited app is restricted to private (`SELF_ONLY`) videos, which is why inbox mode is the default. TikTok needs a developer app (client key and secret) with the `video.upload` scope (plus `video.publish` for direct mode).

---

## Rollout order

1. Video judge, then 2. chat signals (both scoring-only and fail-open), then 6. face tracking (opt-in per layer), then 12. publishing (opt-in per clip).
2. After each feature: run the backend tests and the frontend build. For UI parts, run a Playwright check with writes blocked or mocked.

## Implementation notes (2026-11-16)

- **1:** `src/intelligence/video_judge.py` and `GeminiClient.generate_structured_media`. It's wired into live (`_video_rerank_live`) and VOD (`_video_rerank_vod`, which reuses the downloaded slices). Settings: "Video AI judge" On/Off and how many candidates it watches. Checked with a real Gemini call.
- **2:** `src/intelligence/chat_signals.py`. The live watcher has the `emote_burst` trigger and mood fields. The judge prompt is `v3.1_calibrated_judge_chatmood`. YouTube chat replay comes from `VODWatcher.fetch_chat_peaks` (yt-dlp `live_chat`), which is not yet run on a real VOD.
- **6:** `src/compositor/face_tracker.py` (YuNet with a Haar fallback; model in `config/models/`, downloaded on first use and checksum-verified). Moving crops are built in `filter_graph_builder` and `FFmpegRenderer.face_motion`. The Studio has a "Follow face" switch (inspector and phone peek sheet). Rendered on real stream footage.
- **12:** `src/publisher/tiktok.py`, `src/web/routes_publish.py`, migration v23 (`tt_status`, `tt_publish_id`, `tt_account_key`), and `schedule_clip(platforms, when, replace_pending)`. The UI is `PublishSheet.jsx` (swipe and review) and `TikTokAccounts.jsx` (Accounts > TikTok). The TikTok flow is tested against a fake TikTok server only: it needs a TikTok developer app and an https redirect URI.
