# AutoClipDaemon: Automated Live & VOD Social Media Clipping Engine

An autonomous, production-ready Python clipping pipeline controlled entirely via Telegram. Monitors live streams and newly uploaded VODs from Twitch and YouTube, detects viral moments using multi-modal triggers (chat velocity, audio peaks, heatmap spikes, and Gemini AI), reframes them to 9:16 vertical videos using creator templates, burns in kinetic `.ass` word-by-word subtitles, and delivers interactive 1-tap review cards to Telegram before publishing to YouTube Shorts and Instagram Reels.

---

## Key Highlights

- **Dual Ingestion**: Real-time Streamlink 4-minute circular ring buffer for Twitch/YouTube live streams + targeted VOD extraction with YouTube heatmap analysis.
- **Multi-Modal Viral Triggers**:
  - Live chat velocity spike detection (IRC / YouTube chat) & keyword triggers (`CLIP IT`, `WTF`, `LMAO`, `W SPEED`).
  - Audio dB RMS peak & scream detector.
  - YouTube "Most Replayed" retention heatmap parser (>0.75 score filter).
  - Google Gemini API structured hook/climax scoring.
- **Creator Templates**: Customizable layouts (`facecam_top_gameplay_bottom`, `split_screen_50_50`, `dynamic_face_track`, `blurred_bg_center`).
- **Kinetic Subtitle Engine**: Word-by-word pop-in animation (`\t(0,70,\fscx118\fscy118)`) and karaoke color highlighting via `.ass` format.
- **VAAPI Hardware Acceleration**: Fast Linux VAAPI transcoding with automatic graceful fallback to CPU `libx264`.
- **Anti-Shadowban Engine**: Micro-speed adjustment (`1.02x`), subtle contrast/saturation grading, optional watermark, and background tension riser audio.
- **Telegram Control Center**: 1-tap mobile review card with live video preview, `[-3s/+3s]` start/end trimmer buttons, teaser toggle, and reply-to-edit caption support.
- **Multi-Account Drip Publisher**: Automated uploads to YouTube Shorts (OAuth2) and Instagram Reels (`instagrapi`) spaced by optimal drip intervals.

---

## System Architecture

```text
Streamlink (Live) / yt-dlp (VOD)
             │
             ▼
   Ring Buffer / Heatmap
             │
             ▼
  Spike & Scream Detection
             │
             ▼
   faster-whisper (Audio)
             │
             ▼
 Gemini AI Hook Evaluation (25-58s)
             │
             ▼
Face Tracking & Template Layout
             │
             ▼
  Kinetic Subtitle Burning
             │
             ▼
   Telegram Approval Card ───► [Trim -3s/+3s / Toggle Teaser]
             │
       ┌─────┴─────┐
       ▼           ▼
  [Post Now]  [Drip Queue]
       │           │
       └─────┬─────┘
             ▼
 YouTube Shorts & Instagram Reels
```

---

## Quick Start & Installation

### 1. Prerequisites
- **Python**: 3.11+
- **FFmpeg**: 6.0+ compiled with VAAPI support (and `libass` for subtitles)
- **Linux** (Ubuntu 22.04+ / Debian 12 recommended) or Windows/macOS for development.

### 2. Setup Virtual Environment
```bash
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp config/.env.example config/.env
```
Fill in the configuration details:
```env
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
ADMIN_CHAT_ID=123456789
GEMINI_API_KEY="your_gemini_api_key"
USE_VAAPI=false
VAAPI_DEVICE="/dev/dri/renderD128"
```

### 4. Run the Engine
```bash
python main.py
```

---

## Dual Control Interfaces: Telegram Bot + Web UI Dashboard

AutoClipDaemon provides **two synchronized control planes**:
1. **Telegram Bot**: 1-tap mobile review cards, `/clip` triggers, inline `[-3s/+3s]` trimming, and reply-to-edit captions.
2. **Web UI Dashboard**: A real-time web dashboard running at `http://localhost:8080` with a 9:16 video player, channel management, drip queue timeline, and template preview.

```text
       ┌────────────────────────┐
       │     AutoClipDaemon     │
       │     Engine (Python)    │
       └─────┬────────────┬─────┘
             │            │
             ▼            ▼
     📱 Telegram Bot    🌐 Web Dashboard
     (@manishclipbot)   (http://localhost:8080)
```

---

## Web UI Dashboard Features

Access the dashboard in any browser at: **`http://localhost:8080`**

- **Review Station**: 9:16 vertical video player previewing candidate clips with real-time `[-3s/+3s]` start/end trimmer, teaser toggle, title/caption editor, and `[Post Now (YT + IG)]` button.
- **Channels & Monitors**: View active Twitch & YouTube channel watchers, monitor live status, and add new creators via modal.
- **Drip Queue**: Visual timeline of scheduled upcoming posts with countdowns and publishing statuses.
- **Creator Templates**: Visual gallery of creator layouts (`ishowspeed_gaming`, `podcast_split`, `irl_streamer`).
- **Quick Clip**: Paste any YouTube or Twitch URL directly in the browser to extract and render a 9:16 clip on demand.

---

## Telegram Bot Commands

| Command | Usage | Description |
| :--- | :--- | :--- |
| `/start` | `/start` | Welcome message & system status |
| `/add` | `/add <twitch\|youtube> <channel_or_handle> <template>` | Start monitoring a channel with a layout template |
| `/remove` | `/remove <channel_or_handle>` | Stop monitoring a channel |
| `/clip` | `/clip <url> <template> [start-end]` | Manually download, process, and render a clip |
| `/templates` | `/templates` | List all available creator templates |
| `/queue` | `/queue` | View scheduled drip uploads |

---

## Directory Structure

```text
autoclip-daemon/
├── config/
│   ├── .env.example
│   ├── settings.py
│   └── tokens/
├── templates/
│   ├── ishowspeed_gaming.json
│   ├── podcast_split.json
│   └── irl_streamer.json
├── assets/
│   ├── fonts/
│   ├── watermarks/
│   └── sfx/
├── src/
│   ├── database.py
│   ├── monitor/
│   │   ├── live_watcher.py
│   │   └── vod_watcher.py
│   ├── intelligence/
│   │   ├── transcriber.py
│   │   └── viral_scorer.py
│   ├── compositor/
│   │   ├── face_tracker.py
│   │   ├── ass_generator.py
│   │   └── ffmpeg_renderer.py
│   ├── bot/
│   │   ├── telegram_bot.py
│   │   └── trimmer.py
│   └── publisher/
│       ├── youtube_shorts.py
│       ├── instagram_reels.py
│       └── scheduler.py
├── main.py
├── requirements.txt
├── PROJECT_SPEC.md
└── README.md
```

