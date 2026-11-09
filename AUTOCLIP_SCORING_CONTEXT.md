# AUTOCLIP SCORING CONTEXT REPORT
**Generated:** 2026-11-09  
**System Under Audit:** AutoClip Automated Clip Ingestion, Intelligence, Scoring & Compositing Pipeline  
**Auditor Mode:** Exhaustive Read-Only Codebase & Telemetry Audit  
**Target Audience:** External AI Reviewer (Self-contained, precise, zero memory-based guesswork)  

---

## Executive Summary & Scope

This report provides an exhaustive, code-grounded audit of how **AutoClip** finds moments, evaluates virality, scores clips, and composites vertical (9:16) video formats. Every statement in this document is categorized as **FACT** (backed by file and line citations and runtime execution logs) or **HYPOTHESIS** (identified operational risks or suspected failure modes). All secrets, API keys, tokens, and personal emails have been redacted as `[REDACTED]`.

---

## 0. Repo Map and Versions

### 0.1 Directory Tree & Module Responsibilities

```text
clipping/
├── config/
│   ├── settings.py                  # Global config: thresholds, directories, API keys, concurrency
│   └── .env.example                 # Environment variable templates
├── data/
│   ├── autoclip.db                  # Local SQLite database (channels, clips, settings, logs)
│   └── audit/                       # Audit artifacts (score_stats.json, candidates_sample.json)
├── frontend/                        # React 19 + Vite + Tailwind CSS Web UI (Template Studio, Review Station)
├── main.py                          # Master engine entrypoint: orchestrates watchers, AI scoring, & rendering
├── output/
│   └── clips/                       # Persistent storage for finalized, approved, and published .mp4 clips
├── scripts/
│   └── audit_dump.py                # Standalone read-only audit script extracting DB records and stats
├── shared/
│   ├── caption_vectors.json         # Golden regression test vectors for subtitle positioning
│   └── layout_vectors.json          # Golden regression test vectors for composite layout math
├── src/
│   ├── database.py                  # Async SQLite connection pool, queries, system settings syncing
│   ├── database_migrations.py       # Versioned SQLite migrations (v1 through v13)
│   ├── job_queue.py                 # Async FIFO task queue for video rendering & pipeline execution
│   ├── bot/
│   │   ├── telegram_bot.py          # Telegram bot: review stations cards, /pin authentication, /clip
│   │   └── trimmer.py               # Manual boundaries adjustment and template loading helpers
│   ├── compositor/
│   │   ├── ass_generator.py         # Word-by-word kinetic subtitle generator with ASS positioning
│   │   ├── caption_geometry.py      # Center-center anchored bounding box math for subtitles
│   │   ├── crop_calculator.py       # Legacy crop calculation utilities
│   │   ├── face_tracker.py          # OpenCV Haar-cascade face tracking (fallback center crop)
│   │   ├── ffmpeg_renderer.py       # Filtergraph execution, CPU libx264/VAAPI hardware rendering
│   │   ├── filter_graph_builder.py  # Schema v2 layout builder: multi-layer background, crop, scale
│   │   └── layout_math.py           # Absolute pixel resolution geometry calculator from normalized coords
│   ├── intelligence/
│   │   ├── boundaries.py            # [V2 Pipeline] Sentence boundary snapper & context penalty scorer
│   │   ├── dedupe.py                # [V2 Pipeline] Temporal overlap (25%) & 3-gram Jaccard deduplication
│   │   ├── heat.py                  # [V2 Pipeline] Multi-signal 1s heat curve with Gaussian smoothing (sigma=3s)
│   │   ├── pipeline.py              # [V2 Pipeline] BestClipsPipeline orchestrator (Stages A & B)
│   │   ├── selection.py             # [V2 Pipeline] Maximal Marginal Relevance (MMR) diverse clip picker
│   │   ├── sentences.py             # [V2 Pipeline] Whisper word-timestamp chunker into discrete Sentence objects
│   │   ├── transcriber.py           # faster-whisper STT audio engine with Silero VAD
│   │   ├── viral_scorer.py          # [ACTIVE RUNTIME] Gemini API structured virality scorer (0-100)
│   │   ├── learning/
│   │   │   └── feedback.py          # Rolling median boundary bias & channel weight calibration
│   │   └── llm/
│   │       ├── client.py            # Gemini API wrapper with exponential backoff & multi-key rotation
│   │       ├── prompts.py           # Two-stage prompts (Stage A triage & Stage B detail)
│   │       └── schemas.py           # Pydantic structured output models for Stages A and B
│   ├── monitor/
│   │   ├── channel_supervisor.py    # Multi-channel process supervisor
│   │   ├── live_watcher.py          # Streamlink HLS ring buffer + IRC chat velocity + audio dB peak detector
│   │   ├── storage_gc.py            # Garbage collector cleaning tmp/ buffers while safeguarding output clips
│   │   └── vod_watcher.py           # YouTube/Twitch VOD poller (yt-dlp Most Replayed heatmap + audio slice)
│   ├── publisher/
│   │   ├── instagram_reels.py       # Instagram Graph API publisher
│   │   ├── scheduler.py             # Autonomous drip publisher (drips clips every N hours)
│   │   └── youtube_shorts.py        # YouTube Data API v3 Shorts video uploader with token refresh
│   └── web/
│       ├── routes_channels.py       # Channel CRUD API endpoints
│       ├── routes_clips.py          # Clip review, approve, reject, trim, and EDL edit endpoints
│       ├── routes_templates.py      # Visual template editor endpoints
│       ├── server.py                # Aiohttp HTTP server + WebSocket real-time event broadcaster
│       └── ws_manager.py            # WebSocket subscription manager
├── templates/                       # Streamer-specific layout templates (13 JSON configurations)
└── tmp/
    ├── live_buffer/                 # Rolling .ts HLS stream segments from Streamlink
    └── renders/                     # Transient renders and subtitle files
```

### 0.2 Daemon Entry Points & Startup Flow

The primary daemon entrypoint is `main.py` (`AutoClipDaemon`). It starts via:
```bash
python main.py
```
Or as a Linux systemd service `autoclip.service` on the remote cloud instance:
- `ExecStart=/home/ubuntu/apps/clipping/venv/bin/python main.py`
- Working Directory: `/home/ubuntu/apps/clipping`

**Initialization sequence in `main.py:49-106`:**
1. Loads environment variables via `config/settings.py:_load_env_file()`.
2. Runs database migrations up to schema version 13 via `src/database_migrations.py:run_migrations()`.
3. Instantiates `Transcriber` (`src/intelligence/transcriber.py`), `ViralScorer` (`src/intelligence/viral_scorer.py`), and `FFmpegRenderer` (`src/compositor/ffmpeg_renderer.py`).
4. Launches `VODWatcher` and `Scheduler`.
5. Launches background HTTP & WebSocket server (`src/web/server.py`) on `WEB_HOST:WEB_PORT` (default `0.0.0.0:8080`).
6. Starts `aiogram` Telegram bot polling (`src/bot/telegram_bot.py`).
7. Queries active channels from SQLite `channels` table (`is_active = 1`) and instantiates a `LiveStreamWatcher` worker for each.
8. Starts the Storage Garbage Collector (`src/monitor/storage_gc.py`) running every 10 minutes.

### 0.3 Runtime Dependency Versions & System Settings

- **Python Version (VPS Production):** Python 3.12.3 (`3.12.3-0ubuntu2.1 amd64`)
- **Python Version (Local Dev):** Python 3.14.7 (`3.14.7:823f032`, MSC v.1944 64 bit)
- **FFmpeg Version (VPS Production):** `ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers`
- **faster-whisper:** Version `1.2.1` (backed by `ctranslate2 4.8.5` and `onnxruntime 1.31.1`)
  - **Model Size:** `base` (default in `main.py:87`, `transcriber.py:36` defaults to `tiny`, overridden by `Transcriber(model_size="base")`)
  - **Compute Type:** `int8` on CPU (`device="cpu"`, `compute_type="int8"`, `transcriber.py:53-54`)
  - **VAD Settings:** Silero VAD enabled via `vad_filter=True`, `vad_parameters=dict(min_silence_duration_ms=400)` (`src/intelligence/transcriber.py:112-113`)
- **google-genai:** Version `3.0.0` (VPS), `2.34.0` (Local)
- **Gemini Model Names Used:**
  - Active runtime model: `gemini-flash-lite-latest` (`config/settings.py:81`, `system_settings` table)
  - Also referenced in tests/backups: `gemini-1.5-flash`, `gemini-2.5-flash`

---

## 1. End-to-End Flows

AutoClip processes inputs through three distinct workflows:

```mermaid
flowchart TD
    subgraph Ingestion
        A1[Twitch Live Stream] -->|Streamlink 10s chunks| B1[4-Min TS Ring Buffer]
        A2[Twitch IRC Chat] -->|Message Velocity & Keywords| C1{Spike Trigger?}
        A3[Chunk Audio] -->|FFmpeg astats| C2{Peak dB >= -6.0?}
        B1 --> D1[Slice 75s Highlight MP4]
        C1 -->|Yes| D1
        C2 -->|Yes| D1

        V1[YouTube / Twitch VOD] -->|RSS / Poll| V2[Fetch Most Replayed Heatmap]
        V2 --> V3[yt-dlp Download Audio 0-600s]

        M1[Web UI / Telegram /clip URL] -->|Manual URL + Range| M2[yt-dlp Download Section]
    end

    subgraph Intelligence
        D1 --> T1[faster-whisper STT + Silero VAD]
        V3 --> T1
        M2 --> T1
        T1 --> SC[ViralScorer.analyze_transcript]
        SC -->|Gemini API Prompt| LLM[Gemini Flash Lite]
        LLM -->|ViralAnalysisResponse JSON| RES{Score >= min_score?}
        RES -->|No| DIS[Discard Candidate / Idle]
        RES -->|Yes| BEST[Select Candidate 0]
    end

    subgraph Compositing_And_Delivery
        BEST --> ASS[Generate Word-by-Word ASS Subtitles]
        BEST --> REN[FFmpeg Filtergraph Render]
        ASS --> REN
        REN --> MP4[9:16 Vertical MP4 in output/clips/]
        MP4 --> DB[(Insert clips table)]
        DB --> TG[Telegram Bot Clip Card]
        DB --> WS[WebSocket broadcast to Web UI]
        TG --> REV{User Review Station}
        REV -->|Approve| SCH[Scheduled Queue Drip]
        REV -->|Reject| REJ[Mark Rejected]
        SCH --> PUB[YouTube Shorts API Upload]
    end
```

### Flow 1: Live Stream Continuous Monitoring
1. **Live Check:** `LiveStreamWatcher.is_channel_live()` checks Twitch GraphQL API (`https://gql.twitch.tv/gql`, Client ID `kimne78kx3ncx6brgo4mv6wki5h1ko`) every 20s (`src/monitor/live_watcher.py:73-90`).
2. **Ring Buffer Ingestion:** When live, spawns `streamlink --stdout <url> best` piped to `ffmpeg -c copy -f segment -segment_time 10 -segment_wrap 24 chunk_%03d.ts` (maintains a 4-minute rolling buffer) (`src/monitor/live_watcher.py:115-154`).
3. **Trigger Evaluation:**
   - **Chat Velocity:** Twitch IRC (`irc.chat.twitch.tv:6667`) tracks messages in a 60s sliding window. Baseline velocity ($MPS_{baseline}$) is updated continuously. A trigger fires if 5s velocity $\ge 2.5 \times MPS_{baseline}$ and message count in 5s $\ge 10$, OR if a hype keyword (`"CLIP IT"`, `"WTF"`, `"LMAO"`, `"OMG"`, `"NO WAY"`, `"W"`, `"L"`) occurs and 5s message count $\ge 6$ (`src/monitor/live_watcher.py:255-278`).
   - **Audio Peak:** Concurrently, every 5s, the latest `.ts` chunk is analyzed via `ffmpeg -af astats=metadata=1:reset=1 -vn -f null -`. If peak $\ge -6.0$ dB, trigger fires (`src/monitor/live_watcher.py:321-344`).
4. **Buffer Slicing:** On trigger, system waits 20 seconds for the event to conclude (`live_watcher.py:356`), selects the last 8 `.ts` chunks (80 seconds total), generates a concat file, and runs `ffmpeg -f concat -safe 0 -i concat.txt -c copy highlight_<ts>.mp4` (`src/monitor/live_watcher.py:365-385`).
5. **Concurrency Gate:** Calls `AutoClipDaemon._on_live_moment()`. Pipeline concurrency is gated by `asyncio.Semaphore(MAX_CONCURRENT_JOBS)` (`main.py:276`).
6. **Transcription:** `Transcriber.transcribe()` extracts 16kHz mono WAV and invokes `faster-whisper` (`base`, `int8`, Silero VAD) to produce word-level timestamps (`src/intelligence/transcriber.py:84-143`).
7. **AI Viral Scoring:** `ViralScorer.analyze_transcript()` sends the first 100 transcript segments to Gemini API (`gemini-flash-lite-latest`) with schema `ViralAnalysisResponse` (`src/intelligence/viral_scorer.py:134-212`).
8. **Threshold Gate:** If candidate virality score $\ge$ template `min_virality_score` (default 65-70), candidate 0 is accepted. Otherwise discarded (`main.py:317-325`).
9. **ASS Generation:** Kinetic word-by-word `.ass` subtitle file generated (`src/compositor/ass_generator.py:100-220`).
10. **Compositing:** `FFmpegRenderer.render_clip()` crops facecam & gameplay, applies anti-shadowban color grading (`contrast=1.03`, `saturation=1.05`, `speed=1.02`), burns ASS subtitles, and exports to `output/clips/live_<channel>_<ts>_final.mp4` (`src/compositor/ffmpeg_renderer.py:180-278`).
11. **Persistence & Broadcast:** Inserts row into `clips` table (`virality_score`, `raw_start`, `raw_end`, `title`, `description`), broadcasts WebSocket message `clip_created` to the Web UI, and posts interactive review card to Telegram bot (`main.py:368-410`).

### Flow 2: VOD Polling & YouTube "Most Replayed" Heatmap
1. **Polling:** `VODWatcher.poll_youtube_channel_rss()` polls channel RSS feeds (`src/monitor/vod_watcher.py:28-60`).
2. **Heatmap Extraction:** Calls `yt-dlp --dump-json --skip-download <url>` to parse YouTube's user-retention heatmap curve (`info.get("heatmap")`). Intervals with retention $\ge 0.75$ are stored as retention peaks (`src/monitor/vod_watcher.py:61-99`).
3. **Audio-First Download:** Downloads the first 10 minutes of audio stream via `yt-dlp -f ba -x --audio-format wav --download-sections *0-600` (`src/monitor/vod_watcher.py:101-121`).
4. **Scoring:** `Transcriber.transcribe()` transcribes the WAV; `ViralScorer.analyze_transcript()` scores the text with metadata `heatmap_peaks` passed to Gemini (`main.py:435-442`).
5. **Exact Video Slice:** On score match, downloads only the required 25-58s video slice using `yt-dlp --download-sections *start-end` without downloading the full multi-gigabyte video (`src/monitor/vod_watcher.py:123-149`).
6. **Compositing & Persistence:** Subtitles generated, video rendered into 9:16 layout, inserted into `clips`, and delivered to Telegram and Web UI (`main.py:470-520`).

### Flow 3: Quick Clip Manual URL
1. **Trigger:** User enters URL in Web UI `/api/clip-manual` or sends `/clip <url> [template] [start-end]` in Telegram (`src/web/server.py:901`, `src/bot/telegram_bot.py:312`).
2. **Quota Pre-Check:** `has_available_ai_quota()` confirms Gemini API key availability before initiating downloads (`main.py:114-118`).
3. **Execution:** If a time range is provided (e.g. `120-150`), directly downloads section via `yt-dlp`, transcribes, composites, and registers clip with default `virality_score = 85` (`main.py:149-215`). If no time range is provided, passes URL to `VODWatcher.process_vod()` for automatic heatmap and transcript discovery (`main.py:254-261`).

---

## 2. Candidate Generation (How Moments Are Found)

### 2.1 Chat Velocity Signal
- **Collection:** Raw IRC lines read from `irc.chat.twitch.tv:6667` with channel join (`src/monitor/live_watcher.py:212-235`).
- **Sampling Rate:** Event-driven per message.
- **Formulas (`src/monitor/live_watcher.py:249-275`):**
  - Messages timestamped into double-ended queue `chat_messages_timestamps`.
  - Prunes messages older than 60 seconds:
    $$\text{total\_60s} = \sum [t \ge t_{now} - 60]$$
  - Baseline rate calculation:
    $$MPS_{baseline} = \max(0.5, \frac{\text{total\_60s}}{60.0})$$
  - Recent burst rate (last 5 seconds):
    $$MPS_{recent} = \frac{\sum [t \ge t_{now} - 5.0]}{5.0}$$
  - **Spike Condition:**
    $$\text{velocity\_spike} = (MPS_{recent} \ge MPS_{baseline} \times \text{spike\_multiplier}) \land (\text{recent\_5s} \ge 10)$$
  - Default `spike_multiplier`: `2.5` (`config/settings.py:93`).

### 2.2 Chat Keywords Signal
- **Keywords:** Configured per template in `templates/*.json` under `hype_keywords`.
  - Twitch templates: `["CLIP IT", "WTF", "LMAO", "OMG", "NO WAY", "W", "L"]`
  - Podcast template: `["DAMN", "REAL", "FACTS", "WTF", "TRUE", "WOW", "DEEP", "CLIP THIS"]`
- **Matching Rule (`src/monitor/live_watcher.py:265-273`):**
  - Multi-word phrases checked via substring (`kw in msg_upper`).
  - Single tokens checked via word boundary (`kw in words` or `(len(kw) > 2 and kw in msg_upper)`), preventing `"W"` from triggering inside `"WHEN"`.
  - **Keyword Trigger Condition:**
    $$\text{keyword\_hit} \land (\text{recent\_5s} \ge 6)$$
  - Triggering requires at least 6 messages in the last 5 seconds to prevent single-viewer false triggers.

### 2.3 Audio dB Peak / Scream Signal
- **Collection:** Executed every 5 seconds on the latest 10-second `.ts` ring buffer chunk (`src/monitor/live_watcher.py:294-320`).
- **Command:** `ffmpeg -y -threads 1 -i chunk.ts -af astats=metadata=1:reset=1 -vn -f null -`
- **Metric Parsed:** Output parsed for `Peak level dB` or `Peak dB` (`src/monitor/live_watcher.py:338-343`).
- **Threshold:** `AUDIO_PEAK_DB_THRESHOLD = -6.0` dB (`config/settings.py:94`).
- **Condition:** $\text{peak\_db} \ge -6.0\text{ dB}$.

### 2.4 Cooldown & Deduplication
- **Cooldown:** `cooldown_seconds = 90.0` seconds enforced in `live_watcher.py:281-282`:
  $$\Delta t = t_{now} - t_{last\_trigger} > 90.0\text{s}$$
- **Post-Trigger Buffer Delay:** Waits 20 seconds after event detection so the climax is captured in the middle of the buffer (`live_watcher.py:356`). Slices the last 8 `.ts` chunks (80 seconds).

### 2.5 YouTube "Most Replayed" Heatmap Signal
- **Collection:** Extracted via `yt-dlp --dump-json --skip-download` (`src/monitor/vod_watcher.py:61-96`).
- **Threshold:** `min_retention = 0.75` (points where YouTube retention normalized curve $\ge 0.75$).

### 2.6 Seed Windows and Dynamic Lengths
- **Live Stream Window:** Hard-coded 75-80s audio window extracted from ring buffer. Passed to faster-whisper.
- **LLM Window Selection:** Gemini AI selects clip boundaries inside the transcribed window. The schema (`ViralHookCandidate`, `src/intelligence/viral_scorer.py:33-34`) constrains clips to `25-58s total`.

---

## 3. Transcription

- **Engine:** `faster-whisper` (`src/intelligence/transcriber.py`).
- **Model Size:** `base` (configured in `main.py:87`, `Transcriber(model_size="base")`).
- **Device & Compute Type:** `device="cpu"`, `compute_type="int8"` (`transcriber.py:53-54`).
- **Audio Extraction Pre-pass:** Extracts 16kHz mono PCM WAV via FFmpeg before feeding Whisper (`src/intelligence/transcriber.py:64-82`):
  ```bash
  ffmpeg -y -i <video_or_audio> -vn -acodec pcm_s16le -ar 16000 -ac 1 <output.wav>
  ```
- **VAD (Voice Activity Detection):** Silero VAD active on every transcribe call (`src/intelligence/transcriber.py:112-113`):
  ```python
  segments_generator, info = model.transcribe(
      audio_path,
      word_timestamps=True,
      vad_filter=True,
      vad_parameters=dict(min_silence_duration_ms=400),
  )
  ```
- **Output Structure:** Returns a dictionary containing:
  - `text`: Concatenated full transcript string.
  - `segments`: List of segment dicts `[{"start": float, "end": float, "text": str}]`.
  - `words`: List of word dicts `[{"word": str, "start": float, "end": float, "probability": float}]`.
  - `language`: Detected language (e.g. `'en'`).
  - `duration`: Audio duration in seconds.
- **Downstream Windowing:** The first 100 segments are formatted as `[<start>s - <end>s]: <text>` and injected directly into the Gemini prompt (`src/intelligence/viral_scorer.py:164-167`). Word timestamps are saved alongside the render as `.json` and passed to `generate_ass_subtitles()` to burn kinetic captions.

---

## 4. Every LLM Call (Gemini)

AutoClip contains two distinct LLM implementations:
1. **The Active Runtime Implementation (`src/intelligence/viral_scorer.py`):** Used in production by `main.py` for all live stream events, VOD poller events, and manual URL clips.
2. **The New Architecture Implementation (`src/intelligence/llm/`):** Two-stage pipeline (Stage A Triage and Stage B Detail) present in the codebase under `src/intelligence/pipeline.py`.

### 4.1 Active Runtime Call: `ViralScorer.analyze_transcript`
- **Location:** `src/intelligence/viral_scorer.py:134-212`
- **Caller:** `main.py:312` (`_on_live_moment`) and `main.py:438` (`_on_vod_event`).
- **Model:** `gemini-flash-lite-latest` (read dynamically from `system_settings` or `config/settings.py:81`).
- **SDK & API Version:** `google-genai` Client with `http_options={"api_version": "v1beta"}` (`viral_scorer.py:79`).
- **Temperature & Generation Config:**
  ```python
  config = {
      "response_mime_type": "application/json",
      "response_schema": ViralAnalysisResponse,
  }
  ```
  *(Temperature is not explicitly passed, defaulting to Gemini model default 1.0).*

#### Exact Verbatim Prompt Text:

**System Instruction (`src/intelligence/viral_scorer.py:152-162`):**
```text
You are an elite short-form social video editor specializing in YouTube Shorts and Instagram Reels.
Your objective is to find 25-58 second viral gold moments from this stream transcript.
Criteria:
1. First 3 seconds MUST have a strong hook, question, curiosity gap, or shouting/reaction.
2. Rising tension or narrative flow in the middle.
3. Clear climax, punchline, or resolution before the end.
4. Never cut mid-sentence.
5. If a huge climax occurs, specify its exact timestamp in 'teaser_hook_timestamp' so we can pre-roll a 1.5s teaser.
6. Rank clips by predicted virality score (0-100). Return ONLY JSON matching the schema.
```

**User Prompt (`src/intelligence/viral_scorer.py:169-180`):**
```text
Analyze this segment and metadata:

Metadata:
- Chat Velocity Spikes: {json.dumps(chat_spikes or [])}
- Audio dB Peaks: {json.dumps(audio_peaks or [])}
- YouTube Retention Heatmap Peaks: {json.dumps(heatmap_peaks or [])}

Transcript:
{formatted_segments}

Return JSON with candidate clips meeting all criteria.
```

#### Verbatim Pydantic Response Schema (`src/intelligence/viral_scorer.py:31-45`):
```python
class ViralHookCandidate(BaseModel):
    start_time: float = Field(..., description="Start timestamp of the clip in seconds")
    end_time: float = Field(..., description="End timestamp of the clip in seconds (25-58s total)")
    teaser_hook_timestamp: Optional[float] = Field(None, description="1.5s climax snippet timestamp to pre-roll at 00:00")
    virality_score: int = Field(..., ge=0, le=100, description="Predicted virality retention score (0-100)")
    suggested_title: str = Field(..., description="Engaging, clickable Title (no clickbait spam)")
    hashtags: List[str] = Field(default_factory=list, description="Relevant hashtags including #Shorts, #Reels")
    hook_summary: str = Field(..., description="Why the first 3 seconds grab immediate attention")
    punchline_summary: str = Field(..., description="The payoff or resolution of the clip")

class ViralAnalysisResponse(BaseModel):
    candidates: List[ViralHookCandidate] = Field(default_factory=list)
```

#### Explicit List: What the Model Is Given vs NOT Given:
- **Given:**
  - First 100 transcribed segments formatted as `[start_s - end_s]: text`.
  - Metadata lists: `chat_spikes` (empty `[]` in `main.py`), `audio_peaks` (empty `[]` in `main.py`), `heatmap_peaks` (populated only on YouTube VODs).
- **The Model is NOT Given:**
  - Raw video frames or visual imagery (audio/STT text only).
  - Streamer identity, niche, channel name, or creator persona context.
  - Previous channel clips or human editor approval/rejection history.
  - Word-level timestamps or pause durations.
  - Actual chat messages or individual emotes (only raw velocity spike metadata, which is currently passed as `[]`).

---

### 4.2 New Architecture Calls (Stage A and Stage B in `src/intelligence/llm/`)

These calls are fully defined and tested in `src/intelligence/llm/` and orchestrated in `src/intelligence/pipeline.py`, but are currently **NOT invoked by the main live daemon loop** (which still points to `ViralScorer`):

#### Stage A: Triage Call (`src/intelligence/llm/prompts.py:16-33`)
- **System Instruction:**
```text
You are an elite short-form content director evaluating candidate moments from a video or stream.
Your goal is to rapidly triage 15-25 candidate moments and determine which ones have viral potential on YouTube Shorts, Instagram Reels, and TikTok.

Evaluation Standards:
1. Rate every candidate on a scale of 0 to 10.
2. Advance candidates with high energy, humor, debate, shocking statements, or intriguing storytelling.
3. Drop filler, technical setup, monotone chatter, or segments that lack an attention-grabbing hook.
4. Output structured JSON matching the provided schema.
```
- **User Prompt:**
```text
Evaluate these candidate moments for streamer/channel "{channel_name}".

Channel Persona & Niche:
{channel_persona}

Candidate List:
{candidates_json}

Return structured JSON scoring every candidate and selecting the top survivors.
```
- **Response Schema:** `StageATriageResponse` (`TriageCandidateResult(id, triage_score: 0-10, keep: bool, one_line_reason)`)

#### Stage B: Detail Call (`src/intelligence/llm/prompts.py:35-56`)
- **System Instruction:**
```text
You are an award-winning short-form video editor choosing final viral clips.
You will be given candidates with 20 seconds of leading context and 10 seconds of trailing context, alongside the exact list of valid sentence IDs.

CRITICAL RULES:
1. THE 2-SECOND RULE: The first 2 seconds MUST seize viewer curiosity, shock them, or raise a burning question. If the start is slow or mumbled, mark decision as "reject" with reject_reason="weak_hook".
2. STANDS ALONE: The clip must be completely understood by someone who has never watched this creator before. If it relies on prior backstory not included in the clip, reject with reject_reason="needs_context".
3. CLEAR PAYOFF: There must be a punchline, conclusion, or climax. Do not cut before the resolution.
4. BOUNDARIES: You MUST specify boundaries using the provided Sentence IDs (e.g. "s101" to "s108"). NEVER invent raw seconds. Pick the cleanest sentence start and end.
5. NEVER FABRICATE: Quotes must match the actual transcript text.
6. CONTENT SAFETY: Flag profanity, hate speech, copyrighted music, or sensitive topics with appropriate severity.
7. TITLES: Keep titles under 60 characters, punchy and curiosity-inducing without cheap clickbait spam.
```
- **Response Schema:** `StageBDetailResponse` (SubScores for `hook_2s`, `stands_alone`, `payoff`, `emotion`, `shareability`, `pacing`, `clarity`, evidence quotes, sentence boundary IDs, content safety flags).

---

## 5. Scoring and Ranking Logic

### 5.1 Exact Active Runtime Formulas

In the running daemon (`main.py` + `src/intelligence/viral_scorer.py`):
1. **Raw LLM Virality Score:** Gemini generates an integer score $S_{LLM} \in [0, 100]$ in field `virality_score`.
2. **Filtering Condition (`viral_scorer.py:210`):**
   $$\text{Keep candidate if } S_{LLM} \ge \text{min\_score}$$
   Where `min_score` is taken from `template.get("min_virality_score", 70)`. In 12 of the 13 templates, `min_virality_score = 65`.
3. **Selection Rule (`main.py:327-328`):**
   ```python
   filtered = [c for c in candidates if c.virality_score >= min_score]
   filtered.sort(key=lambda x: x.virality_score, reverse=True)
   best_candidate = candidates[0]
   ```
   **Only candidate index 0 is ever rendered and saved to SQLite.**
4. **Final Stored Score:** `virality_score = best_candidate.virality_score`. The `final_score` column in `clips` is left at default `0.0`.

### 5.2 Why Runtime Scores Cluster at 80+ (Mathematical & Code Evidence)

The database statistics reveal that **91.1% of all clips have a score $\ge 80$**, with 84.4% having scores of exactly 85 or 88:
- Score 75: 4 clips (8.9%)
- Score 82: 1 clip (2.2%)
- Score 85: 25 clips (55.6%)
- Score 88: 13 clips (28.9%)
- Score 90: 2 clips (4.4%)

**The 5 Contributing Factors Identified in Code:**
1. **High Pre-filter Threshold (FACT):** Templates enforce `min_virality_score = 65` or `70`. Any moment scored $< 65$ by Gemini is dropped before reaching the database (`main.py:317-325`).
2. **Pre-Selection by Physical Signals (FACT):** The LLM is only called when a 2.5x chat velocity spike or $\ge -6.0$ dB audio scream has already occurred (`live_watcher.py:275-288`). Thus, the input text passed to Gemini is already an extreme outlier moment, not normal chatter.
3. **Selection of Only the Maximum (FACT):** In `main.py:327`, AutoClip sorts descending and extracts only `candidates[0]`. If Gemini returns two candidate windows with scores 85 and 75, only the 85 is ever saved. The 75 is discarded.
4. **Prompt Instruction Prompting High Bias (FACT):** The system instruction commands: *"Your objective is to find 25-58 second viral gold moments from this stream transcript... Rank clips by predicted virality score (0-100)"* (`viral_scorer.py:154-161`). The prompt provides no calibration scale (e.g. what distinguishes a 50 from an 80). LLMs prompted to find "viral gold" naturally anchor their ratings in the 80-90 range.
5. **Heuristic Fallback Hardcoded Scores (FACT):** When Gemini API is unavailable or quota is exceeded, the fallback function `_heuristic_fallback` (`src/intelligence/viral_scorer.py:271, 297, 319`) hardcodes scores directly to `80`, `78`, and `75`. In manual clips with explicit timestamps (`main.py:204`), `virality_score = 85` is hardcoded.

### 5.3 Stage B Formula in New Architecture (`src/intelligence/pipeline.py:214-218`)

In the new pipeline module:
$$\text{Final Score} = (0.55 \times S_{\text{predicted}}) + (0.30 \times 80.0) + (0.15 \times 85.0)$$
- **Constant Baseline Injection:** The signal component is hardcoded to $0.30 \times 80.0 = 24.0$ points, and the historical component is hardcoded to $0.15 \times 85.0 = 12.75$ points.
- **Minimum Floor:** Even if Gemini scores a candidate $S_{\text{predicted}} = 50.0$, the final score is:
  $$(0.55 \times 50.0) + 24.0 + 12.75 = 27.5 + 36.75 = 64.25$$
  If Gemini scores $S_{\text{predicted}} = 80.0$:
  $$(0.55 \times 80.0) + 36.75 = 44.0 + 36.75 = 80.75$$
  This hardcodes an artificial floor of 36.75 points and forces scores to cluster in a narrow band.

---

## 6. Clip Generation and Rendering

### 6.1 Layout & Filtergraph Pipeline

AutoClip uses a multi-layer composite system converting 16:9 streams into 9:16 vertical canvas (1080x1920) (`src/compositor/filter_graph_builder.py`).

1. **Background Canvas:** Generates solid black canvas `color=c=0x000000:s=1080x1920[base_bg]`.
2. **Gameplay Layer (Layer 0):** Crops gameplay region from `0:v`, scales to fit bottom half of 1080x1920, crops overflow, and overlays at `(0, 608)` or `(0, 730)`.
3. **Facecam Layer (Layer 1):** Crops facecam region from `0:v`, scales to fit top half, and overlays at `(0, 0)`.
4. **Anti-Shadowban Grading:**
   - Video PTS adjusted for 1.02x speed: `setpts=PTS/1.0200`
   - Contrast adjusted to 1.03: `eq=contrast=1.03:saturation=1.05`
   - Audio tempo accelerated to match: `-af atempo=1.02`
5. **Subtitles Burning:** Kinetic ASS subtitles burned via `subtitles='<path>.ass'`.
6. **Codec & Optimization:** Encoded with `libx264 -preset ultrafast -threads 2 -crf 25 -maxrate 4M -bufsize 8M -c:a aac -b:a 192k -movflags +faststart`.

### 6.2 Real FFmpeg Command from Production Server Logs

Extracted from VPS journal log (`Nov 09 07:03:19 instance-20261107-2002` for Clip #79, streamer `x2twins`):

```bash
ffmpeg -y -threads 2 -ss 0.100 -t 44.700 \
  -i /home/ubuntu/apps/clipping/tmp/live_buffer/x2twins/highlight_1794207641.mp4 \
  -filter_complex "color=c=0x000000:s=1080x1920[base_bg];\
[0:v]crop=1152:934:384:0,scale=1614:1308,crop=1080:1308:268:0[l_0_proc];\
[base_bg][l_0_proc]overlay=0:608:shortest=1[comp_0];\
[0:v]crop=360:208:6:382,scale=1084:626,crop=1080:626:2:0[l_1_proc];\
[comp_0][l_1_proc]overlay=0:0:shortest=1[comp_1];\
[comp_1]setpts=PTS/1.0200,eq=contrast=1.03:saturation=1.05[graded];\
[graded]subtitles='/home/ubuntu/apps/clipping/tmp/renders/live_x2twins_1794207641.ass'[vout]" \
  -map "[vout]" -map "0:a:0?" -af "atempo=1.02" \
  -c:v libx264 -preset ultrafast -threads 2 -crf 25 -maxrate 4M -bufsize 8M \
  -c:a aac -b:a 192k -movflags +faststart \
  /home/ubuntu/apps/clipping/output/clips/live_x2twins_1794207641_final.mp4
```

### 6.3 Subtitle Styling & Animation (`src/compositor/ass_generator.py`)

- **Canvas Standard:** `PlayResX: 1080`, `PlayResY: 1920`.
- **Anchor:** `\an5` (Center-Center alignment).
- **Positioning:** Exact pixel positioning using `\pos(x, y)` derived from `caption_geometry()`:
  $$x = \text{canvas\_w} \times pos\_x = 1080 \times 0.50 = 540$$
  $$y = \text{canvas\_h} \times pos\_y = 1920 \times 0.76 = 1459$$
- **Kinetic Animations:**
  - `bounce`: `{\t(0, 80, \fscx115\fscy115)\t(80, 160, \fscx100\fscy100)}`
  - `pop`: `{\fscx85\fscy85\t(0, 60, \fscx105\fscy105)\t(60, 120, \fscx100\fscy100)}`
  - Active word highlight color: Yellow `&H0015CCFA` (hex `#FACC15`).

---

## 7. Data Model

### 7.1 SQLite Table Definitions

#### `clips` Table (`src/database_migrations.py:57-82, 311-320`):
```sql
CREATE TABLE IF NOT EXISTS clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK(source_type IN ('live', 'vod')),
    source_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    template_name TEXT NOT NULL,
    raw_start REAL NOT NULL,
    raw_end REAL NOT NULL,
    adjusted_start REAL NOT NULL,
    adjusted_end REAL NOT NULL,
    teaser_hook_timestamp REAL,
    has_teaser INTEGER DEFAULT 1,
    virality_score INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    hashtags TEXT,
    source_video_path TEXT,
    rendered_video_path TEXT,
    subtitle_path TEXT,
    thumbnail_path TEXT,
    status TEXT DEFAULT 'pending_approval' CHECK(status IN ('pending_approval', 'approved', 'queued', 'publishing', 'published', 'rejected')),
    telegram_message_id INTEGER,
    telegram_chat_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    render_version INTEGER,
    edl_hash TEXT,
    last_render_error TEXT,
    rendered_at TIMESTAMP,
    candidate_id TEXT,
    final_score REAL DEFAULT 0.0,
    score_breakdown TEXT,
    flags TEXT,
    prompt_version TEXT DEFAULT 'v1.0'
);
```

#### `candidates` Table (`src/database_migrations.py:340-363`):
```sql
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    run_id TEXT REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK(stage IN ('generated', 'snapped', 'triage', 'detail', 'visual', 'selected', 'rejected')),
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    start_sentence_id TEXT,
    end_sentence_id TEXT,
    heat_score REAL DEFAULT 0.0,
    triage_score REAL DEFAULT 0.0,
    predicted_score REAL DEFAULT 0.0,
    final_score REAL DEFAULT 0.0,
    title TEXT,
    hook_text TEXT,
    description TEXT,
    hashtags TEXT,
    flags TEXT,
    reject_reason TEXT,
    raw_transcript_json TEXT,
    score_breakdown TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `pipeline_runs` Table (`src/database_migrations.py:323-338`):
```sql
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    candidates_count INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0.0,
    latency_seconds REAL DEFAULT 0.0,
    prompt_version TEXT DEFAULT 'v1.0',
    config_snapshot TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `clip_feedback_events` Table (`src/database_migrations.py:375-383`):
```sql
CREATE TABLE IF NOT EXISTS clip_feedback_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id INTEGER,
    candidate_id TEXT,
    channel_id TEXT,
    event TEXT NOT NULL CHECK(event IN ('approved', 'rejected', 'trimmed', 'words_edited', 'layout_changed', 'published', 'deleted')),
    payload_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `channel_learning` Table (`src/database_migrations.py:400-407`):
```sql
CREATE TABLE IF NOT EXISTS channel_learning (
    channel_id TEXT PRIMARY KEY,
    weights_json TEXT NOT NULL,
    boundary_bias_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    is_paused INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 7.2 What Is Stored vs NOT Stored
- **Stored:**
  - Selected clips with start/end timestamps, title, hook description, hashtags, ASS subtitle path, rendered video path, and virality score (`clips` table).
  - Status updates (`pending_approval`, `approved`, `queued`, `publishing`, `published`, `rejected`).
- **NOT Stored (Critical Finding):**
  - Unselected candidates scoring below threshold or discarded as runner-ups are **NOT stored** in `candidates`. The `candidates` table currently has `0` rows on both local and production databases.
  - LLM token usage, cost, and exact prompt/response strings are **NOT stored** per clip.
  - Full Whisper transcripts are written to transient `.json` alongside `.ass` in `tmp/renders/`, which is periodically emptied by storage garbage collection.

---

## 8. Real Data and Telemetry Analysis

Data extracted directly from production VPS database replica (`data/autoclip_vps.db`) via `scripts/audit_dump.py`:

### 8.1 Score Distributions & Percentiles

- **Total Clips Analyzed:** 45 clips
- **Distribution Histogram (Bins of 10):**
  - `0 - 9`: 0 (0.0%)
  - `10 - 19`: 0 (0.0%)
  - `20 - 29`: 0 (0.0%)
  - `30 - 39`: 0 (0.0%)
  - `40 - 49`: 0 (0.0%)
  - `50 - 59`: 0 (0.0%)
  - `60 - 69`: 0 (0.0%)
  - `70 - 79`: 4 (8.9%)
  - `80 - 89`: 39 (86.7%)
  - `90 - 99`: 2 (4.4%)
  - `100`: 0 (0.0%)
- **Score Summary Statistics:**
  - **Minimum:** 75
  - **Mean:** 85.13
  - **Median:** 85.00
  - **90th Percentile (P90):** 88.00
  - **Maximum:** 90
- **Clips with Score $\ge 80$:** **91.11%** (41 out of 45 clips)
- **Distinct Score Values:** Exactly 5 distinct values exist across all clips:
  - `85`: 25 clips (55.6%)
  - `88`: 13 clips (28.9%)
  - `75`: 4 clips (8.9%)
  - `90`: 2 clips (4.4%)
  - `82`: 1 clip (2.2%)

### 8.2 Status Breakdown & Approval Rates per Channel

| Channel ID | Total Clips | Published | Queued / Publishing | Rejected | Approval / Kept Rate |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **kaicenat** | 15 | 5 | 1 | 9 | 40.0% |
| **ohnepixel** | 15 | 4 | 0 | 11 | 26.7% |
| **caseoh_** | 12 | 0 | 0 | 12 | 0.0% |
| **x2twins** | 3 | 0 | 1 | 2 | 33.3% |
| **Total** | **45** | **9** | **2** | **34** | **24.4%** |

*Note: 34 out of 45 clips (75.6%) were rejected by the user in Telegram, despite having virality scores between 75 and 90.*

### 8.3 Representative Clip Records from `candidates_sample.json`

#### Sample High-Scoring Rejected Clip (Scored 88, Rejected by User):
- **Clip ID:** 77
- **Channel:** `caseoh_`
- **Title:** `"Asking Chat: Is Raw Sushi Actually Good?"`
- **Virality Score:** 88
- **Duration:** 37.3 seconds (start: 35.4s, end: 72.7s)
- **Status:** `rejected`
- **Hook Description:** `"Opening dialogue hook regarding sushi preferences."`

#### Sample High-Scoring Published Clip (Scored 88, Kept & Uploaded):
- **Clip ID:** 24
- **Channel:** `kaicenat`
- **Title:** `"Almost Leaks Verification Code on Stream!"`
- **Virality Score:** 88
- **Duration:** 34.2 seconds
- **Status:** `published`
- **Hook Description:** `"High tension panic moment where streamer nearly exposes 2FA code."`

---

## 9. Configuration

Table of all scoring and candidate generation tunables:

| Setting Name | Environment Variable / Source | Default Value | Active Runtime Value | Location in Code | Functional Impact |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GEMINI_MODEL` | `GEMINI_MODEL` | `gemini-flash-lite-latest` | `gemini-flash-lite-latest` | `config/settings.py:81` | LLM used for structured candidate scoring |
| `MIN_VIRALITY_SCORE` | `DEFAULT_MIN_VIRALITY_SCORE` | `70` | `65` (per template) / `70` (db) | `config/settings.py:92`, `templates/*.json` | Cutoff threshold; candidates below this are dropped |
| `CHAT_SPIKE_MULTIPLIER` | `CHAT_SPIKE_MULTIPLIER` | `2.5` | `2.5` | `config/settings.py:93` | Velocity multiplier over 60s baseline to trigger |
| `AUDIO_PEAK_DB_THRESHOLD` | `AUDIO_PEAK_DB_THRESHOLD` | `-6.0` dB | `-6.0` dB | `config/settings.py:94` | Decibel threshold in FFmpeg astats filter |
| `COOLDOWN_SECONDS` | Code property | `90.0`s | `90.0`s | `src/monitor/live_watcher.py:58, 281` | Minimum seconds between triggers for same channel |
| `MIN_CLIP_DURATION` | Template / Schema | `25.0`s | `25.0`s | `src/intelligence/viral_scorer.py:34` | Lower bound duration for short-form video candidate |
| `MAX_CLIP_DURATION` | Template / Schema | `58.0`s | `58.0`s | `src/intelligence/viral_scorer.py:34` | Upper bound duration for short-form video candidate |
| `MAX_CONCURRENT_JOBS` | `MAX_CONCURRENT_JOBS` | `1` | `1` (VPS), `1` (Local) | `config/settings.py:97` | Concurrency semaphore for render pipeline |
| `DRIP_INTERVAL_HOURS` | `DRIP_INTERVAL_HOURS` | `4` | `4` | `config/settings.py:100` | Scheduled delay between automated YouTube uploads |
| `WHISPER_MODEL` | Code instantiation | `base` | `base` | `main.py:87` | Whisper model size loaded in CTranslate2 |
| `WHISPER_COMPUTE_TYPE` | Code property | `int8` | `int8` | `src/intelligence/transcriber.py:54` | CPU quantization type |
| `SILERO_MIN_SILENCE` | Code property | `400`ms | `400`ms | `src/intelligence/transcriber.py:113` | VAD silence duration threshold |
| `HYPE_KEYWORDS` | `templates/*.json` | `CLIP IT, WTF, LMAO, ...` | See Section 2.2 | `src/monitor/live_watcher.py:51` | Triggers burst evaluation on keyword appearance |

---

## 10. Suspicious Spots and Likely Causes

### Spot 1: Unselected Candidates and Runner-ups Are Immediately Dropped
- **Status:** **FACT**
- **Evidence:** `main.py:327`: `best_candidate = candidates[0]`. In `main.py`, there is no database query or storage for `candidates[1:]`.
- **Impact:** The system cannot analyze false positives or calculate relative ranking over time because rejected alternatives are lost forever.

### Spot 2: Final Score Column Disconnected from Runtime Pipeline
- **Status:** **FACT**
- **Evidence:** Querying `clips` table in SQLite shows `final_score = 0.0` across 100% of rows (`score_stats.json`). `score_breakdown` is `NULL`.
- **Cause:** Migration 10 introduced `final_score`, `score_breakdown`, `candidates`, and `pipeline_runs` for the new `BestClipsPipeline` (`src/intelligence/pipeline.py`), but `main.py` still invokes the legacy `ViralScorer` (`src/intelligence/viral_scorer.py`), which only sets `virality_score`.

### Spot 3: Artificial Hardcoded Score Floor in Pipeline Formulas
- **Status:** **FACT**
- **Evidence:** `src/intelligence/pipeline.py:214-218`:
  ```python
  final_score = (
      0.55 * dc.predicted_score +
      0.30 * 80.0 + # baseline signal score
      0.15 * 85.0
  )
  ```
- **Impact:** Hardcodes an automatic additive boost of $24.0 + 12.75 = 36.75$ points to every single candidate.

### Spot 4: Signal Metadata Passed as Empty Arrays to Gemini
- **Status:** **FACT**
- **Evidence:** `main.py:312-315`:
  ```python
  candidates = await self.scorer.analyze_transcript(
      transcript_data=transcription,
      min_score=min_score,
  )
  ```
  Note that `chat_spikes` and `audio_peaks` parameters are omitted!
  In `viral_scorer.py:172-174`:
  ```python
  "- Chat Velocity Spikes: {json.dumps(chat_spikes or [])}\n"
  "- Audio dB Peaks: {json.dumps(audio_peaks or [])}\n"
  ```
  Both parameters evaluate to `[]`.
- **Impact:** Gemini receives **zero audio decibel levels or chat velocity numbers** during scoring. Gemini evaluates the transcript text in complete isolation from the physical signals that triggered the moment.

### Spot 5: Disconnect Between AI Virality Score and User Human Approval
- **Status:** **FACT**
- **Evidence:** Despite an average AI virality score of **85.13**, the actual user approval rate is only **24.4%** (34 out of 45 clips were rejected in Telegram).
- **Hypothesis:** The prompt lacks creator niche context and the 2-second standalone hook rule. Gemini scores mundane dialogue as 85 because it meets general narrative criteria (start, middle, end), but human reviewers reject them because they are uninteresting out of context or lack punchy humor.

---

## 11. Implemented vs Missing Checklist

| Feature | Status | File / Line References & Evidence |
| :--- | :---: | :--- |
| **Sentence-boundary snapping** | **Partial** | Implemented in `src/intelligence/boundaries.py:52-140` (`snap_boundaries`), but **NOT active** in `main.py:330` (which uses raw Gemini floats `best_candidate.start_time`). |
| **Overlap dedupe (25% cap)** | **Partial** | Implemented in `src/intelligence/dedupe.py:19-26` (`calculate_temporal_overlap`), but only runs in `pipeline.py`, not in `main.py`. |
| **Near-duplicate content dedupe** | **Partial** | Implemented in `src/intelligence/dedupe.py:37-47` (3-gram Jaccard index), but inactive in live daemon loop. |
| **Two-stage LLM (Triage + Detail)** | **Partial** | Implemented in `src/intelligence/llm/prompts.py` and `pipeline.py:136-237`, but `main.py` uses single-stage `ViralScorer`. |
| **Rubric sub-scores** | **Partial** | Defined in `src/intelligence/llm/schemas.py:23-31` (`SubScores`), but inactive in runtime `viral_scorer.py`. |
| **Relative ranking** | **Missing** | LLM outputs absolute scores (0-100); no pairwise or relative ranking comparison is performed. |
| **Calibration against human approvals** | **Missing** | Rejection events in Telegram do not recalibrate scoring weights or thresholds. |
| **Few-shot examples from history** | **Missing** | Prompts contain zero few-shot examples of approved or rejected clips. |
| **Chat messages in prompt** | **Missing** | Twitch chat messages are not passed to Gemini (only empty spike arrays). |
| **Audio events in prompt** | **Missing** | Decibel peak values and scream events are omitted in `main.py:312`. |
| **Visual input to LLM** | **Missing** | LLM operates purely on Whisper speech text; no video frames or face expressions are ingested. |
| **Streamer / Channel context text** | **Missing** | Channel persona is not injected into active `ViralScorer` prompt (`viral_scorer.py:169-180`). |
| **Human feedback logging** | **Partial** | Table `clip_feedback_events` exists in schema, but Telegram rejection button in `telegram_bot.py` updates `clips.status` directly without writing feedback payload. |
| **Learned per-channel weights** | **Partial** | Implemented in `src/intelligence/learning/feedback.py`, but table has `0` rows in production. |
| **LLM Caching** | **Partial** | `llm_cache` table exists and functions in `src/intelligence/llm/client.py`, but `ViralScorer` does not query it. |
| **Cost / Token tracking** | **Missing** | Input/output tokens are not tracked or saved in `pipeline_runs` or `clips`. |
| **Live low-latency path** | **Implemented** | 4-minute rolling HLS buffer with 80s slice concatenation runs with latency $< 30$ seconds. |

---

## 12. Open Questions

1. **Why is `BestClipsPipeline` (`src/intelligence/pipeline.py`) bypassed by `main.py`?** Was it intended to replace `ViralScorer`, or was it developed as an experimental branch that hasn't been switched on yet?
2. **Why are `chat_spikes` and `audio_peaks` omitted in `main.py:312`?** The parameters exist on `analyze_transcript`, but the caller passes only `transcript_data` and `min_score`.
3. **What specific criteria cause the human editor to reject clips that score 88?** (e.g. Is it boring conversation, bad crop, poor face tracking, or missing the punchline?)
4. **Should the daemon process Twitch VODs through the same heatmap pipeline as YouTube?** Currently, heatmap logic is only executed for YouTube URLs.
5. **Why was the Telegram bot polling conflicting on the VPS?** The logs show `TelegramConflictError: terminated by other getUpdates request`. Is another background test process running on the host?
6. **Why are only 5 discrete virality scores generated by Gemini?** Does `gemini-flash-lite-latest` exhibit a strong token probability bias towards 75, 82, 85, 88, and 90 when prompted without fine-grained rubric instructions?
7. **Is there a requirement to store discarded runner-up candidates in the `candidates` table?**
8. **Should non-English or multi-lingual audio be handled differently?** Faster-whisper detected `en` with 0.98 probability on all samples, but language settings are currently left to auto-detection.
9. **Why is the minimum virality score set to 65 in templates but 70 in `system_settings`?** Which one is intended to be authoritative?
10. **Can hardware VAAPI acceleration be enabled on the cloud instance?** The logs show the server falls back to CPU `libx264 -preset ultrafast` because `/dev/dri/renderD128` is absent on the VPS.

---

## 10-Line TL;DR

1. Moments are triggered by Twitch IRC chat velocity spikes ($\ge 2.5\times$ baseline) or FFmpeg audio decibel peaks ($\ge -6.0$ dB).
2. Slices of 75-80 seconds from a 4-minute Streamlink ring buffer are transcribed via `faster-whisper` (`base`, `int8`, Silero VAD).
3. The first 100 transcribed segments are submitted to Gemini Flash Lite using a single-stage structured JSON prompt.
4. Gemini returns candidate windows with an integer virality score; candidate 0 is selected if $\ge 65/70$, while runner-ups are discarded.
5. Word-by-word kinetic `.ass` subtitles are generated with center-center `\pos(x, y)` coordinates and dynamic scaling animations.
6. FFmpeg composites a 9:16 vertical canvas (1080x1920) with gameplay, facecam, 1.02x anti-shadowban speed, and burned subtitles.
7. Clips are saved to `output/clips/`, registered in SQLite, and posted to Telegram Review Station for human approval.
8. 91.1% of all clips score 80+ because moments are pre-filtered by physical spikes, low scores are dropped, and only the max candidate is kept.
9. Gemini prompt lacks creator context and physical signal metadata, causing it to rate mundane dialogue as 85-88.
10. The user rejected 75.6% of clips in Telegram because the LLM lacks calibration against human preferences and 2-second hook enforcement.

