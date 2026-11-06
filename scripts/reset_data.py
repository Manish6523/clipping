"""CLI Script for AutoClipDaemon Clean Database and File Reset.

Usage:
  python -m scripts.reset_data [--yes] [--keep-channels] [--wipe-channels] [--keep-presets] [--wipe-presets] [--no-backup]
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.maintenance import execute_database_reset


async def main():
    parser = argparse.ArgumentParser(description="Reset AutoClipDaemon database and rendered files.")
    parser.add_argument("--yes", "-y", action="store_true", help="Confirm execution without interactive prompt")
    parser.add_argument("--keep-channels", action="store_true", default=True, help="Preserve monitored channels (default: True)")
    parser.add_argument("--wipe-channels", action="store_true", help="Wipe monitored channels as well")
    parser.add_argument("--keep-presets", action="store_true", default=True, help="Preserve visual styling presets (default: True)")
    parser.add_argument("--wipe-presets", action="store_true", help="Wipe visual styling presets as well")
    parser.add_argument("--no-backup", action="store_true", help="Skip creating safety DB backup")

    args = parser.parse_args()

    keep_channels = not args.wipe_channels
    keep_presets = not args.wipe_presets
    create_backup = not args.no_backup

    if not args.yes:
        print("⚠️  WARNING: You are about to RESET the AutoClipDaemon database and media cache.")
        print(f"  - Keep Monitored Channels: {keep_channels}")
        print(f"  - Keep Presets:            {keep_presets}")
        print(f"  - Create Safety Backup:    {create_backup}")
        answer = input("\nType 'RESET' to confirm: ").strip()
        if answer != "RESET":
            print("Reset aborted by user.")
            sys.exit(0)

    print("\n⏳ Executing database and storage reset...")
    res = await execute_database_reset(
        keep_channels=keep_channels,
        keep_presets=keep_presets,
        create_backup=create_backup,
    )

    print("✅ Reset finished successfully!")
    print(f"  - Safety Backup:    {res['backup_path']}")
    print(f"  - Cleared Tables:   {', '.join(res['cleared_tables'])}")
    print(f"  - Deleted Renders:  {res['deleted_render_files']} files")
    print(f"  - Deleted Buffers:  {res['deleted_buffer_files']} files")


if __name__ == "__main__":
    asyncio.run(main())

