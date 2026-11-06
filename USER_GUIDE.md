# AutoClipDaemon: Complete Operator & User Guide

Welcome to **AutoClipDaemon**, an autonomous clipping engine designed to monitor live streams and VODs, extract high-retention viral moments, reframe them into 9:16 vertical videos with kinetic subtitles, and publish them to YouTube Shorts and Instagram Reels via **Telegram** and the **Web UI Dashboard**.

---

## Table of Contents
1. [1-Click Quickstart](#1-1-click-quickstart)
2. [Telegram Bot Operations Guide](#2-telegram-bot-operations-guide)
3. [Web UI Dashboard Guide](#3-web-ui-dashboard-guide)
4. [Connecting Social Media Publishing Accounts](#4-connecting-social-media-publishing-accounts)
5. [Creator Templates Customization](#5-creator-templates-customization)
6. [24/7 Cloud / VPS Deployment Guide](#6-247-cloud--vps-deployment-guide)

---

## 1. 1-Click Quickstart

### On Windows
Double-click `run.bat` or run:
```powershell
.\run.bat
```
*(Automatically tests dependencies, runs health diagnostics, and launches the engine).*

### On Linux / macOS
```bash
chmod +x run.sh
./run.sh
```

### Manual Launch (Virtual Environment)
```powershell
.\venv\Scripts\Activate.ps1
python main.py
```

Once running:
- **Web UI Dashboard:** Open [**http://localhost:8080**](http://localhost:8080)
- **Telegram Bot:** Open your bot (e.g., `@manishclipbot`)

---

## 2. Telegram Bot Operations Guide

All bot commands are restricted to your `ADMIN_CHAT_ID`.

### Commands Reference

| Command | Syntax | Description | Example |
| :--- | :--- | :--- | :--- |
| `/start` | `/start` | Displays status and command directory | `/start` |
| `/add` | `/add <platform> <channel> <template>` | Monitors a Twitch or YouTube creator | `/add twitch ishowspeed ishowspeed_gaming` |
| `/remove` | `/remove <channel>` | Deactivates monitoring for a creator | `/remove ishowspeed` |
| `/clip` | `/clip <url> <template> [start-end]` | Forces on-demand clipping of a video link | `/clip https://youtu.be/XYZ ishowspeed_gaming 15-45` |
| `/templates` | `/templates` | Lists loaded templates & target social accounts | `/templates` |
| `/queue` | `/queue` | Shows upcoming scheduled drip posts | `/queue` |

---

### The Interactive Review Card

When a live hype moment triggers or a VOD finishes processing, your Telegram bot delivers a vertical video card:

```text
┌──────────────────────────────────────────┐
│  [ Vertical 9:16 MP4 Video Preview ]     │
├──────────────────────────────────────────┤
│  🔥 Viral Candidate #3                   │
│  📺 Channel: ishowspeed                  │
│  🎨 Template: ishowspeed_gaming          │
│  📈 Virality Score: 88/100               │
│  ⏱️ Duration: 35.5s (12.0s - 47.5s)      │
│  🎬 Teaser Pre-Roll: Enabled             │
│                                          │
│  📝 Title: IShowSpeed CRAZY Scream!      │
│  🏷️ Tags: #Shorts #Speed #Gaming         │
├──────────────────────────────────────────┤
│  [✅ Post Now (YT+IG)]  [🗓️ Drip Queue]  │
│  [⏪ -3s Start]         [⏩ +3s Start]    │
│  [⏪ -3s End]           [⏩ +3s End]      │
│  [🎬 Teaser: ON]        [❌ Discard]      │
└──────────────────────────────────────────┘
```

#### What Each Button Does:
1. **`[✅ Post Now (YT + IG)]`**:
   - Immediately publishes the clip in parallel to your mapped YouTube Shorts and Instagram Reels accounts.
   - Edits the Telegram card with direct clickable links to the live posts.
2. **`[🗓️ Add to Drip Queue]`**:
   - Enqueues the clip in SQLite to post at the next optimal slot (spaced 4 hours apart) so algorithms don't penalize you for upload spam.
3. **`[⏪ -3s Start]` / `[⏩ +3s Start]`**:
   - Adjusts the clip opening timestamp by -3 or +3 seconds.
   - Re-slices the source video, re-generates kinetic subtitles, re-renders the vertical video, and updates the Telegram preview in-place.
4. **`[⏪ -3s End]` / `[⏩ +3s End]`**:
   - Extends or shortens the clip conclusion by 3 seconds.
5. **`[🎬 Teaser: ON / OFF]`**:
   - Toggles prepending a 1.5-second climax pre-roll at 00:00 with a white flash transition.
6. **`[❌ Discard]`**:
   - Deletes the local MP4 file and marks the clip rejected in the database.

#### Editing Title & Caption on Mobile:
Simply **Reply** to the bot's video message with any text:
```text
Admin: "Speed Loses His Mind in EA FC 25! 😱"
Bot: "✏️ Clip #3 title updated to: Speed Loses His Mind in EA FC 25! 😱"
```
The video message caption updates automatically in Telegram and the database.

---

## 3. Web UI Dashboard Guide

Open [**http://localhost:8080**](http://localhost:8080) in any desktop or mobile browser.

### Key Sections:

1. **Top Metrics Bar:**
   - Real-time counts of Monitored Channels, Clips in Review, Drip Queue, and Published Clips.
2. **Review Station:**
   - **9:16 Video Player**: Stream rendered vertical MP4 video with full playback controls.
   - **Fine-Tuning Controls**: Tap `[-3s/+3s]` buttons for instant server re-rendering.
   - **Editable Metadata**: Edit Title, Description, and Hashtags in form inputs and click `Save Edits`.
   - **Action Bar**: Click `Post Now`, `Add to Drip Queue`, or `Discard`.
3. **Channels & Monitors:**
   - Table of active Twitch and YouTube streams.
   - Click `+ Add New Channel` to add creators without opening Telegram.
4. **Drip Queue:**
   - Timeline of scheduled posts, countdowns, and upload status tags.
5. **Quick Clip URL:**
   - Paste any YouTube or Twitch link, pick a template, and trigger instant clipping.

---

## 4. Connecting Social Media Publishing Accounts

Target accounts are mapped per template in `templates/*.json` (e.g. `"youtube_account_key": "speed_yt"`).

### Setting Up YouTube Shorts (OAuth2)
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **YouTube Data API v3**.
3. Create an **OAuth 2.0 Client ID** (Application type: Desktop App).
4. Save credentials to `config/tokens/yt_<account_key>.json`:
```json
{
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "client_secret": "YOUR_CLIENT_SECRET",
  "refresh_token": "YOUR_REFRESH_TOKEN",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

### Setting Up Instagram Reels (instagrapi)
Save your login credentials or session settings to `config/tokens/ig_<account_key>.json`:
```json
{
  "username": "your_instagram_page_username",
  "password": "your_instagram_password"
}
```
*The engine automatically logs in, handles challenges, and saves the persistent session cache.*

---

## 5. Creator Templates Customization

Templates are stored in `templates/` as JSON files.

### Example: `templates/ishowspeed_gaming.json`
```json
{
  "name": "ishowspeed_gaming",
  "min_virality_score": 75,
  "chat_spike_multiplier": 2.5,
  "hype_keywords": ["CLIP IT", "WTF", "LMAO", "W SPEED"],
  "layout": {
    "type": "facecam_top_gameplay_bottom",
    "top_crop": {
      "source_x": 0, "source_y": 0, "source_w": 640, "source_h": 480,
      "target_w": 1080, "target_h": 730
    },
    "bottom_crop": {
      "source_x": 320, "source_y": 0, "source_w": 1280, "source_h": 1080,
      "target_w": 1080, "target_h": 1190
    }
  },
  "subtitles": {
    "font_name": "Montserrat ExtraBold",
    "font_size": 76,
    "primary_color": "&H00FFFFFF",
    "highlight_color": "&H0000FFFF",
    "outline": 4.0,
    "margin_v": 730,
    "max_words_per_screen": 2,
    "animation_tag": "{\\t(0,70,\\fscx118\\fscy118)}"
  },
  "anti_shadowban": {
    "speed_multiplier": 1.02,
    "contrast": 1.03,
    "saturation": 1.05
  },
  "destinations": {
    "youtube_account_key": "speed_yt",
    "instagram_account_key": "speed_ig"
  }
}
```

#### Key Customizations:
- **`layout.type`**:
  - `"facecam_top_gameplay_bottom"`: Stacks webcam (38%) over gameplay (62%).
  - `"split_screen_50_50"`: Dual speaker vertical stack (1080x960 each).
  - `"dynamic_face_track"`: Single 9:16 crop smoothly following the active speaker.
  - `"blurred_bg_center"`: 16:9 foreground over blurred 9:16 background.
- **`subtitles.margin_v`**: Vertical position. Setting `730` places captions directly on the seam line between facecam and gameplay.
- **`subtitles.highlight_color`**: ASS format `&HBBGGRR` (e.g. `&H0000FFFF` is bright yellow, `&H0033FF33` is neon lime, `&H0000D0FF` is cyan/gold).

---

## 6. 24/7 Cloud / VPS Deployment Guide

### Option A: Docker Compose (Easiest for VPS)
```bash
git clone <your-repo>
cd autoclip-daemon
cp config/.env.example config/.env
# Edit config/.env with your API keys

docker-compose up -d --build
```
Check logs:
```bash
docker-compose logs -f
```

### Option B: Linux Systemd Service (Ubuntu / Debian)
Create `/etc/systemd/system/autoclip.service`:
```ini
[Unit]
Description=AutoClipDaemon Social Media Clipping Engine
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/autoclip-daemon
ExecStart=/home/ubuntu/autoclip-daemon/venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable autoclip
sudo systemctl start autoclip
```
Check status:
```bash
sudo systemctl status autoclip
```

