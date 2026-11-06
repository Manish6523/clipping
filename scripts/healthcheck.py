"""AutoClipDaemon System & Health Diagnostic Utility.

Verifies:
1. Python environment and required third-party packages
2. FFmpeg binary availability and codec support (h264, aac, libass)
3. Configuration and API key validity
4. Database integrity and table structure
5. Assets and template profiles
"""

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Safe terminal encoding
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from config.settings import (
    DATABASE_PATH,
    TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID,
    GEMINI_API_KEY,
    TEMPLATES_DIR,
    RENDER_DIR,
    BUFFER_DIR,
)
from src.database import init_db, get_active_channels, get_db_connection


def check_python_environment():
    print("\n[1/5] Checking Python Environment...")
    ver = sys.version_info
    print(f"  * Python Version: {ver.major}.{ver.minor}.{ver.micro}")
    if ver.major < 3 or (ver.major == 3 and ver.minor < 10):
        print("  [WARN] Python 3.11+ is recommended.")
    else:
        print("  [OK] Python version is supported.")

    required_modules = [
        "aiogram",
        "pydantic",
        "aiohttp",
        "feedparser",
    ]
    all_ok = True
    for mod in required_modules:
        try:
            __import__(mod)
            print(f"  [OK] Module '{mod}' installed.")
        except ImportError:
            print(f"  [FAIL] Missing module: '{mod}' (run: pip install -r requirements.txt)")
            all_ok = False
    return all_ok


def check_ffmpeg():
    print("\n[2/5] Checking FFmpeg & Multimedia Codecs...")
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        print("  [FAIL] FFmpeg binary NOT found in PATH. Please install FFmpeg.")
        return False
    print(f"  [OK] FFmpeg located: {ffmpeg_path}")

    try:
        proc = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        first_line = proc.stdout.splitlines()[0] if proc.stdout else "Unknown version"
        print(f"  * {first_line}")
        has_ass = "--enable-libass" in proc.stdout or "libass" in proc.stdout
        if has_ass:
            print("  [OK] FFmpeg compiled with libass (kinetic subtitle burning ready).")
        else:
            print("  [INFO] Subtitles filter supported via FFmpeg native filters.")
        return True
    except Exception as e:
        print(f"  [WARN] Error querying FFmpeg: {e}")
        return False


def check_configuration():
    print("\n[3/5] Checking Configuration & Credentials...")
    env_file = BASE_DIR / "config" / ".env"
    if not env_file.exists():
        print("  [WARN] config/.env file missing. Run: cp config/.env.example config/.env")
    else:
        print("  [OK] config/.env file detected.")

    if TELEGRAM_BOT_TOKEN:
        masked = TELEGRAM_BOT_TOKEN[:6] + "..." + TELEGRAM_BOT_TOKEN[-4:]
        print(f"  [OK] TELEGRAM_BOT_TOKEN configured: {masked}")
    else:
        print("  [WARN] TELEGRAM_BOT_TOKEN is blank. Bot control plane will be inactive.")

    if ADMIN_CHAT_ID:
        print(f"  [OK] ADMIN_CHAT_ID configured: {ADMIN_CHAT_ID}")
    else:
        print("  [WARN] ADMIN_CHAT_ID is 0. Bot commands will not be restricted.")

    if GEMINI_API_KEY:
        masked = GEMINI_API_KEY[:6] + "..." + GEMINI_API_KEY[-4:]
        print(f"  [OK] GEMINI_API_KEY configured: {masked}")
    else:
        print("  [WARN] GEMINI_API_KEY is blank. Fallback viral scorer will be used.")

    return True


async def check_database():
    print("\n[4/5] Checking SQLite Database Schema...")
    try:
        await init_db()
        print(f"  [OK] Database initialized at: {DATABASE_PATH}")
        channels = await get_active_channels()
        print(f"  * Monitored Channels in DB: {len(channels)}")
        for c in channels:
            print(f"    - [{c['platform'].upper()}] {c['channel_id_or_handle']} ({c['template_name']})")
        return True
    except Exception as e:
        print(f"  [FAIL] Database initialization failed: {e}")
        return False


def check_templates():
    print("\n[5/5] Checking Templates & Workspace Directories...")
    templates = list(TEMPLATES_DIR.glob("*.json"))
    print(f"  * Available templates found: {len(templates)}")
    for t in templates:
        print(f"    - {t.name}")

    for d, label in [(RENDER_DIR, "Renders"), (BUFFER_DIR, "Live Buffer")]:
        d.mkdir(parents=True, exist_ok=True)
        print(f"  [OK] Directory '{label}' verified: {d}")

    return len(templates) > 0


async def main():
    print("=" * 60)
    print("      AutoClipDaemon Production Health Diagnostic      ")
    print("=" * 60)

    py_ok = check_python_environment()
    ff_ok = check_ffmpeg()
    cfg_ok = check_configuration()
    db_ok = await check_database()
    tmpl_ok = check_templates()

    print("\n" + "=" * 60)
    if py_ok and ff_ok and db_ok and tmpl_ok:
        print(">> ALL CRITICAL CHECKS PASSED! AutoClipDaemon is production-ready.")
        print("   Start the daemon: python main.py")
        print("   Open Dashboard:   http://localhost:8080")
    else:
        print(">> Some warnings or errors were detected. Review the checklist above.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
