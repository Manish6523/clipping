"""Script to report Same-Stream Narrative Storyline statistics and shadow mode matches.

Usage:
    python scripts/story_report.py
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import get_db_connection
from src.intelligence.session_storyline import get_pattern_stats


async def generate_report():
    print("=" * 60)
    print(" 📖 SAME-STREAM NARRATIVE STORYLINE ENGINE REPORT")
    print("=" * 60)

    # 1. Pattern stats
    print("\n[1] Seed Regex Pattern Performance:")
    patterns = await get_pattern_stats()
    if not patterns:
        print("  No pattern stats recorded yet.")
    else:
        for p in patterns:
            status = "ACTIVE" if p.get("is_active") else "DISABLED (PRUNED)"
            print(f"  - {p['pattern_name']:<15} | Hits: {p.get('hits', 0):<4} | Confirmed: {p.get('confirmed', 0):<4} | Confirm Rate: {p.get('confirm_rate', 0.0) * 100:.1f}% | Status: {status}")

    # 2. Stream sessions summary
    async with get_db_connection() as db:
        c = await db.execute("SELECT COUNT(*) FROM stream_sessions")
        total_sessions = (await c.fetchone())[0]

        c = await db.execute("SELECT COUNT(*) FROM story_seeds")
        total_seeds = (await c.fetchone())[0]

        c = await db.execute("SELECT COUNT(*) FROM seed_staging WHERE status = 'pending'")
        pending_staging = (await c.fetchone())[0]

        c = await db.execute("SELECT COUNT(*) FROM clips WHERE stitched = 1")
        total_stitched = (await c.fetchone())[0]

        c = await db.execute("SELECT COUNT(*) FROM clip_story_links")
        total_links = (await c.fetchone())[0]

    print("\n[2] Session & Seed Totals:")
    print(f"  - Total Stream Sessions: {total_sessions}")
    print(f"  - Confirmed Story Seeds: {total_seeds}")
    print(f"  - Pending Staged Snippets: {pending_staging}")
    print(f"  - Stitched Clips Created: {total_stitched}")
    print(f"  - Story Matches / Links: {total_links}")

    # 3. Recent narrative links
    print("\n[3] Recent Narrative Links (Payoffs & Shadows):")
    async with get_db_connection() as db:
        c = await db.execute("""
            SELECT l.id, l.clip_id, l.seed_id, l.relation, l.confidence,
                   l.standalone_score, l.stitched_score, c.title, c.status
            FROM clip_story_links l
            LEFT JOIN clips c ON c.id = l.clip_id
            ORDER BY l.created_at DESC
            LIMIT 10
        """)
        links = await c.fetchall()
        if not links:
            print("  No narrative links logged yet.")
        else:
            for link in links:
                row = dict(link)
                print(f"  - Link #{row['id']}: Clip #{row['clip_id']} ('{row['title']}') -> Seed #{row['seed_id']}")
                print(f"    Relation: {row['relation']} (Confidence: {row['confidence']:.2f}) | Score: {row['standalone_score']} -> {row['stitched_score']} | Status: {row['status']}")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    asyncio.run(generate_report())

