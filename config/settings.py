"""Central configuration settings for AutoClipDaemon.

All imports placed at the top of the file according to standards.
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    HAS_DOTENV = True
except ImportError:
    HAS_DOTENV = False

# Resolve project base directory
BASE_DIR = Path(__file__).resolve().parent.parent

# Safe .env loader
def _load_env_file():
    env_paths = [BASE_DIR / "config" / ".env", BASE_DIR / ".env"]
    for env_path in env_paths:
        if env_path.exists():
            if HAS_DOTENV:
                load_dotenv(env_path)
                return
            else:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k not in os.environ:
                                os.environ[k] = v
                return

_load_env_file()

# Directory Structure
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

BUFFER_DIR = Path(os.getenv("BUFFER_DIR", BASE_DIR / "tmp" / "live_buffer"))
BUFFER_DIR.mkdir(parents=True, exist_ok=True)

RENDER_DIR = Path(os.getenv("RENDER_DIR", BASE_DIR / "tmp" / "renders"))
RENDER_DIR.mkdir(parents=True, exist_ok=True)

# Persistent output directory for finalized, queued, and published clips
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", BASE_DIR / "output" / "clips"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Persistent raw 16:9 source directory for interactive editing in Review Station
SOURCES_DIR = Path(os.getenv("SOURCES_DIR", BASE_DIR / "data" / "sources"))
SOURCES_DIR.mkdir(parents=True, exist_ok=True)

TEMPLATES_DIR = BASE_DIR / "templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

ASSETS_DIR = BASE_DIR / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"
WATERMARKS_DIR = ASSETS_DIR / "watermarks"
SFX_DIR = ASSETS_DIR / "sfx"

for d in [FONTS_DIR, WATERMARKS_DIR, SFX_DIR]:
    d.mkdir(parents=True, exist_ok=True)

TOKENS_DIR = BASE_DIR / "config" / "tokens"
TOKENS_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_PATH = DATA_DIR / "autoclip.db"

# Telegram Bot
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
ADMIN_CHAT_ID = int(os.getenv("ADMIN_CHAT_ID", "0"))
TELEGRAM_POLLING_ENABLED = os.getenv("TELEGRAM_POLLING_ENABLED", "false").lower() in ("true", "1", "yes")

# Pipeline Mode: 'legacy' (original single-call viral_scorer) | 'shadow' (run new pipeline in background) | 'new' (use new judge pipeline)
PIPELINE_MODE = os.getenv("PIPELINE_MODE", "legacy").lower().strip()
SHADOW_MAX_RUNS_PER_DAY = int(os.getenv("SHADOW_MAX_RUNS_PER_DAY", "50"))
GEMINI_JUDGE_MODEL = os.getenv("GEMINI_JUDGE_MODEL", os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest"))

# Gemini API & Multi-Key Pool
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
_keys_env = os.getenv("GEMINI_API_KEYS", "")
GEMINI_API_KEYS = [k.strip() for k in _keys_env.split(",") if k.strip()]
if GEMINI_API_KEY and GEMINI_API_KEY not in GEMINI_API_KEYS:
    GEMINI_API_KEYS.insert(0, GEMINI_API_KEY)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")

# Twitch Credentials
TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "")
TWITCH_CLIENT_SECRET = os.getenv("TWITCH_CLIENT_SECRET", "")

# Hardware Acceleration
USE_VAAPI = os.getenv("USE_VAAPI", "false").lower() in ("true", "1", "yes")
VAAPI_DEVICE = os.getenv("VAAPI_DEVICE", "/dev/dri/renderD128")

# Detection Thresholds
DEFAULT_MIN_VIRALITY_SCORE = int(os.getenv("DEFAULT_MIN_VIRALITY_SCORE", "70"))
CHAT_SPIKE_MULTIPLIER = float(os.getenv("CHAT_SPIKE_MULTIPLIER", "2.5"))
AUDIO_PEAK_DB_THRESHOLD = float(os.getenv("AUDIO_PEAK_DB_THRESHOLD", "-6.0"))

# Pipeline Concurrency (1 on low-spec 2-vCPU VPS to prevent lockups, 3-8 on multi-core local machines)
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "1"))

# Scheduler
DRIP_INTERVAL_HOURS = int(os.getenv("DRIP_INTERVAL_HOURS", "4"))

# Web UI Server & Security
WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.getenv("WEB_PORT", "8080"))
# Web lock / Telegram PIN protection (defaults to False for localhost convenience, True in production/VPS)
# faster-whisper model for clip transcription (tiny | base | small | medium | large-v3-turbo).
# Bigger models catch swear words far more reliably; editable from the Settings page.
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")

AUTH_LOCK_ENABLED = os.getenv("AUTH_LOCK_ENABLED", "false").lower() in ("true", "1", "yes")
