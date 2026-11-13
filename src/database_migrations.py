"""Lightweight Database Migration System for AutoClipDaemon.

Manages schema versions and structured upgrades cleanly without ad-hoc ALTERs.
"""

import json
import logging
from typing import Any, Dict, List, Optional
from config.settings import DATABASE_PATH

logger = logging.getLogger(__name__)


MIGRATIONS: List[tuple[int, str, Any]] = []


def migration(version: int, description: str):
    """Decorator to register a migration function."""
    def decorator(fn):
        MIGRATIONS.append((version, description, fn))
        return fn
    return decorator


@migration(1, "Initial base tables & indices")
async def migration_v1(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL CHECK(platform IN ('twitch', 'youtube')),
            channel_id_or_handle TEXT NOT NULL UNIQUE,
            template_name TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            last_checked_at TIMESTAMP,
            last_stream_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS vods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL CHECK(platform IN ('twitch', 'youtube')),
            channel_id TEXT NOT NULL,
            vod_id TEXT NOT NULL UNIQUE,
            title TEXT,
            published_at TIMESTAMP,
            processed_at TIMESTAMP,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

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
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS scheduled_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
            scheduled_for TIMESTAMP NOT NULL,
            yt_status TEXT DEFAULT 'pending' CHECK(yt_status IN ('pending', 'uploaded', 'failed')),
            ig_status TEXT DEFAULT 'pending' CHECK(ig_status IN ('pending', 'uploaded', 'failed')),
            yt_video_id TEXT,
            ig_media_id TEXT,
            last_error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS clip_edls (
            clip_id INTEGER PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
            edl_json TEXT NOT NULL,
            version INTEGER DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)


@migration(2, "Add SQLite performance indices")
async def migration_v2(db):
    await db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_channels_active ON channels(is_active);
        CREATE INDEX IF NOT EXISTS idx_vods_channel ON vods(channel_id);
        CREATE INDEX IF NOT EXISTS idx_clips_status_created ON clips(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clips_channel ON clips(channel_id);
        CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON scheduled_queue(scheduled_for, yt_status, ig_status);
    """)


@migration(3, "Add channel pause/resume fields & rich settings JSON")
async def migration_v3(db):
    # Check existing columns in channels
    cur = await db.execute("PRAGMA table_info(channels)")
    rows = await cur.fetchall()
    cols = [r[1] if isinstance(r, (list, tuple)) else r["name"] for r in rows]

    if "enabled" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN enabled INTEGER DEFAULT 1")
    if "paused_at" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN paused_at TIMESTAMP")
    if "pause_reason" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN pause_reason TEXT")
    if "pause_until" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN pause_until TIMESTAMP")
    if "display_name" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN display_name TEXT")
    if "notes" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN notes TEXT")
    if "settings_json" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN settings_json TEXT")

    # Check clips columns
    c_cur = await db.execute("PRAGMA table_info(clips)")
    c_rows = await c_cur.fetchall()
    c_cols = [r[1] if isinstance(r, (list, tuple)) else r["name"] for r in c_rows]
    if "thumbnail_path" not in c_cols:
        await db.execute("ALTER TABLE clips ADD COLUMN thumbnail_path TEXT")


@migration(4, "Add global daemon state & stage-based jobs table")
async def migration_v4(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS daemon_state (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            is_paused INTEGER DEFAULT 0,
            paused_at TIMESTAMP,
            pause_reason TEXT,
            pause_until TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO daemon_state (id, is_paused) VALUES (1, 0);

        CREATE TABLE IF NOT EXISTS pipeline_jobs (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            clip_id INTEGER,
            stage TEXT NOT NULL CHECK(stage IN ('ingest', 'transcribe', 'score', 'render', 'publish')),
            priority INTEGER DEFAULT 10,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3,
            payload_json TEXT,
            result_json TEXT,
            last_error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            finished_at TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_status_prio ON pipeline_jobs(status, priority DESC, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_jobs_channel ON pipeline_jobs(channel_id, status);
    """)


@migration(5, "Add render versioning, EDL hash, and pending_deletes queue")
async def migration_v5(db):
    # Check clips columns
    c_cur = await db.execute("PRAGMA table_info(clips)")
    c_rows = await c_cur.fetchall()
    c_cols = [r[1] if isinstance(r, (list, tuple)) else r["name"] for r in c_rows]

    if "render_version" not in c_cols:
        await db.execute("ALTER TABLE clips ADD COLUMN render_version INTEGER DEFAULT 1")
    if "edl_hash" not in c_cols:
        await db.execute("ALTER TABLE clips ADD COLUMN edl_hash TEXT")
    if "last_render_error" not in c_cols:
        await db.execute("ALTER TABLE clips ADD COLUMN last_render_error TEXT")
    if "rendered_at" not in c_cols:
        await db.execute("ALTER TABLE clips ADD COLUMN rendered_at TIMESTAMP")

    await db.executescript("""
        CREATE TABLE IF NOT EXISTS pending_deletes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            retry_count INTEGER DEFAULT 0,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pending_deletes_retry ON pending_deletes(retry_count, created_at);
    """)


@migration(6, "Create unified presets table")
async def migration_v6(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            scope TEXT DEFAULT 'global' CHECK(scope IN ('global', 'channel')),
            channel_id TEXT,
            data JSON NOT NULL,
            schema_version INTEGER DEFAULT 1,
            is_default INTEGER DEFAULT 0,
            thumbnail_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_presets_channel ON presets(channel_id, scope);
        CREATE INDEX IF NOT EXISTS idx_presets_name ON presets(name);
    """)


@migration(7, "Support Schema v2 multi-layer layouts in presets and clips")
async def migration_v7(db):
    # Ensure presets data can store schema_version 2
    await db.execute("UPDATE presets SET schema_version = 2 WHERE schema_version = 1")
    await db.commit()


@migration(8, "Add youtube_accounts and streamer_yt_mappings tables")
async def migration_v8(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS youtube_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_key TEXT UNIQUE NOT NULL,
            channel_id TEXT,
            channel_title TEXT NOT NULL,
            custom_url TEXT,
            thumbnail_url TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS streamer_yt_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            streamer_handle TEXT NOT NULL,
            account_key TEXT NOT NULL REFERENCES youtube_accounts(account_key) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(streamer_handle, account_key)
        );

        CREATE TABLE IF NOT EXISTS oauth_app_config (
            provider TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            client_secret TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_streamer_yt_handle ON streamer_yt_mappings(streamer_handle);
    """)
    await db.commit()


@migration(9, "Add account auto-upload rules and destination configurations")
async def migration_v9(db):
    cur = await db.execute("PRAGMA table_info(youtube_accounts)")
    cols = [r["name"] if isinstance(r, dict) else r[1] for r in await cur.fetchall()]

    if "auto_upload" not in cols:
        await db.execute("ALTER TABLE youtube_accounts ADD COLUMN auto_upload INTEGER DEFAULT 0")
    if "min_score_threshold" not in cols:
        await db.execute("ALTER TABLE youtube_accounts ADD COLUMN min_score_threshold INTEGER DEFAULT 75")
    if "drip_delay_hours" not in cols:
        await db.execute("ALTER TABLE youtube_accounts ADD COLUMN drip_delay_hours INTEGER DEFAULT 4")
    if "privacy_status" not in cols:
        await db.execute("ALTER TABLE youtube_accounts ADD COLUMN privacy_status TEXT DEFAULT 'public'")
    if "tag_override" not in cols:
        await db.execute("ALTER TABLE youtube_accounts ADD COLUMN tag_override TEXT DEFAULT '#Shorts #Viral #Gaming'")

    # Table to track per-clip, per-destination upload status
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS clip_destination_uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
            account_key TEXT NOT NULL,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'queued', 'uploading', 'published', 'failed')),
            video_url TEXT,
            video_id TEXT,
            error_message TEXT,
            uploaded_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(clip_id, account_key)
        );
        CREATE INDEX IF NOT EXISTS idx_clip_dest_uploads ON clip_destination_uploads(clip_id, account_key);
    """)
    await db.commit()


@migration(10, "Best Clips Pipeline tables: candidates, pipeline_runs, llm_cache, clip_feedback_events, clip_metrics, channel_learning")
async def migration_v10(db):
    # Alter clips table with intelligence & scoring breakdown columns
    cur = await db.execute("PRAGMA table_info(clips)")
    cols = [r["name"] if isinstance(r, dict) else r[1] for r in await cur.fetchall()]

    if "candidate_id" not in cols:
        await db.execute("ALTER TABLE clips ADD COLUMN candidate_id TEXT")
    if "final_score" not in cols:
        await db.execute("ALTER TABLE clips ADD COLUMN final_score REAL DEFAULT 0.0")
    if "score_breakdown" not in cols:
        await db.execute("ALTER TABLE clips ADD COLUMN score_breakdown TEXT")
    if "flags" not in cols:
        await db.execute("ALTER TABLE clips ADD COLUMN flags TEXT")
    if "prompt_version" not in cols:
        await db.execute("ALTER TABLE clips ADD COLUMN prompt_version TEXT DEFAULT 'v1.0'")

    await db.executescript("""
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

        CREATE TABLE IF NOT EXISTS llm_cache (
            cache_key TEXT PRIMARY KEY,
            model_name TEXT NOT NULL,
            prompt_version TEXT NOT NULL,
            raw_response TEXT NOT NULL,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS clip_feedback_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clip_id INTEGER,
            candidate_id TEXT,
            channel_id TEXT,
            event TEXT NOT NULL CHECK(event IN ('approved', 'rejected', 'trimmed', 'words_edited', 'layout_changed', 'published', 'deleted')),
            payload_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS clip_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
            platform TEXT NOT NULL CHECK(platform IN ('youtube', 'instagram', 'tiktok')),
            window TEXT NOT NULL CHECK(window IN ('24h', '72h', '7d')),
            views INTEGER DEFAULT 0,
            avg_view_duration REAL DEFAULT 0.0,
            retention_pct REAL DEFAULT 0.0,
            likes INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            shares INTEGER DEFAULT 0,
            performance_score REAL DEFAULT 0.0,
            collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS channel_learning (
            channel_id TEXT PRIMARY KEY,
            weights_json TEXT NOT NULL,
            boundary_bias_json TEXT NOT NULL,
            stats_json TEXT NOT NULL,
            is_paused INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates(source_id);
        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_source ON pipeline_runs(source_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_clip ON clip_feedback_events(clip_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_channel ON clip_feedback_events(channel_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_clip_metrics_clip ON clip_metrics(clip_id, platform, window);
    """)
    await db.commit()


@migration(11, "Add system_settings table for dynamic UI configuration")
async def migration_v11(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            description TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    await db.commit()


@migration(12, "Add web auth PINs and sessions tables")
async def migration_v12(db):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS auth_pins (
            pin TEXT PRIMARY KEY,
            session_duration_seconds INTEGER NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY,
            device_info TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_auth_pins_exp ON auth_pins(expires_at);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_exp ON auth_sessions(expires_at);
    """)
    await db.commit()


@migration(13, "Add clips AI context columns and backfill feedback events")
async def migration_v13(db):
    """Additive schema evolution for Phase A pre-flight fixes."""
    # 1. Additive columns for clips
    cur = await db.execute("PRAGMA table_info(clips)")
    cols = [r["name"] if isinstance(r, dict) else r[1] for r in await cur.fetchall()]
    add_cols = {
        "ai_start": "REAL",
        "ai_end": "REAL",
        "model": "TEXT",
        "tokens_in": "INTEGER",
        "tokens_out": "INTEGER",
        "trigger_json": "TEXT",
        "formula_version": "TEXT",
    }
    for col, col_type in add_cols.items():
        if col not in cols:
            await db.execute(f"ALTER TABLE clips ADD COLUMN {col} {col_type}")

    # 2. Additive columns for candidates
    cur = await db.execute("PRAGMA table_info(candidates)")
    cand_cols = [r["name"] if isinstance(r, dict) else r[1] for r in await cur.fetchall()]
    cand_add = {
        "llm_response_json": "TEXT",
        "trigger_json": "TEXT",
        "chat_sample_json": "TEXT",
    }
    for col, col_type in cand_add.items():
        if col not in cand_cols:
            await db.execute(f"ALTER TABLE candidates ADD COLUMN {col} {col_type}")

    # 3. Rebuild clip_feedback_events to allow 'reason_tagged' and 'marked_great'
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS clip_feedback_events_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clip_id INTEGER,
            candidate_id TEXT,
            channel_id TEXT,
            event TEXT NOT NULL CHECK(event IN ('approved', 'rejected', 'trimmed', 'words_edited', 'layout_changed', 'published', 'deleted', 'reason_tagged', 'marked_great')),
            payload_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    # Copy any existing data
    await db.execute("INSERT OR IGNORE INTO clip_feedback_events_new SELECT * FROM clip_feedback_events")
    await db.execute("DROP TABLE clip_feedback_events")
    await db.execute("ALTER TABLE clip_feedback_events_new RENAME TO clip_feedback_events")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_feedback_clip ON clip_feedback_events(clip_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_feedback_channel ON clip_feedback_events(channel_id, created_at)")

    # 4. Backfill feedback events from existing clips
    cur = await db.execute("SELECT id, channel_id, status FROM clips")
    existing_clips = await cur.fetchall()
    for row in existing_clips:
        c_id = row[0] if isinstance(row, (list, tuple)) else row["id"]
        ch_id = row[1] if isinstance(row, (list, tuple)) else row["channel_id"]
        st = row[2] if isinstance(row, (list, tuple)) else row["status"]
        if st in ("approved", "published", "queued"):
            evt = "approved"
        elif st == "rejected":
            evt = "rejected"
        else:
            continue

        # Check if already logged
        chk_cur = await db.execute("SELECT 1 FROM clip_feedback_events WHERE clip_id = ? AND event = ?", (c_id, evt))
        if not await chk_cur.fetchone():
            await db.execute(
                "INSERT INTO clip_feedback_events (clip_id, channel_id, event, payload_json) VALUES (?, ?, ?, ?)",
                (c_id, ch_id, evt, '{"source": "backfill"}')
            )

    await db.commit()


@migration(14, "Add group_tag and avatar_url to channels")
async def migration_v14(db):
    """Add category group_tag and streamer avatar_url to channels table."""
    cur = await db.execute("PRAGMA table_info(channels)")
    rows = await cur.fetchall()
    cols = [r[1] if isinstance(r, (list, tuple)) else r["name"] for r in rows]

    if "group_tag" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN group_tag TEXT DEFAULT 'General'")
    if "avatar_url" not in cols:
        await db.execute("ALTER TABLE channels ADD COLUMN avatar_url TEXT")

    await db.commit()


@migration(15, "Add live_hypes table for pipeline tracking and rejection explanations")
async def migration_v15(db):
    """Store every detected live hype with its evaluation, gate, and rejection reason."""
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS live_hypes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            trigger_value REAL DEFAULT 0.0,
            threshold_value REAL DEFAULT 0.0,
            video_slice_path TEXT,
            status TEXT NOT NULL, -- 'detected', 'transcribing', 'evaluating', 'passed', 'rejected'
            gate_failed TEXT,     -- 'gate_1_sensor', 'gate_3_transcription', 'gate_4_ai_judge', etc.
            rejection_reason TEXT,
            virality_score INTEGER DEFAULT 0,
            rubric_json TEXT,
            transcript_text TEXT,
            clip_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_live_hypes_channel ON live_hypes(channel_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_live_hypes_status ON live_hypes(status);
    """)
    await db.commit()


@migration(16, "Per-channel publishing: slots, daily cap, timezone, quota tracking, per-account queue")
async def migration_v16(db):
    """Each queue row targets ONE YouTube account and is scheduled into that account's slots."""
    cur = await db.execute("PRAGMA table_info(youtube_accounts)")
    cols = {r[1] for r in await cur.fetchall()}
    for col, ddl in (
        ("publish_slots", "TEXT DEFAULT '[\"12:30\",\"17:30\",\"21:30\"]'"),
        ("daily_cap", "INTEGER DEFAULT 3"),
        ("timezone", "TEXT DEFAULT 'Asia/Kolkata'"),
        ("quota_units_per_day", "INTEGER DEFAULT 10000"),
    ):
        if col not in cols:
            await db.execute(f"ALTER TABLE youtube_accounts ADD COLUMN {col} {ddl}")

    # Rebuild scheduled_queue: add account_key and allow 'skipped' (SQLite can't alter CHECKs)
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS scheduled_queue_v16 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
            account_key TEXT,
            scheduled_for TIMESTAMP NOT NULL,
            yt_status TEXT DEFAULT 'pending' CHECK(yt_status IN ('pending', 'uploaded', 'failed', 'skipped')),
            ig_status TEXT DEFAULT 'pending' CHECK(ig_status IN ('pending', 'uploaded', 'failed', 'skipped')),
            yt_video_id TEXT,
            ig_media_id TEXT,
            last_error TEXT,
            attempts INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO scheduled_queue_v16 (id, clip_id, scheduled_for, yt_status, ig_status, yt_video_id, ig_media_id, last_error, created_at)
            SELECT id, clip_id, scheduled_for, yt_status, ig_status, yt_video_id, ig_media_id, last_error, created_at FROM scheduled_queue;
        DROP TABLE scheduled_queue;
        ALTER TABLE scheduled_queue_v16 RENAME TO scheduled_queue;
        CREATE INDEX IF NOT EXISTS idx_queue_due ON scheduled_queue(scheduled_for);
        CREATE INDEX IF NOT EXISTS idx_queue_account ON scheduled_queue(account_key, scheduled_for);

        CREATE TABLE IF NOT EXISTS youtube_api_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_key TEXT NOT NULL,
            project_key TEXT NOT NULL,
            operation TEXT NOT NULL,
            units INTEGER NOT NULL,
            quota_day TEXT NOT NULL,
            success INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_api_usage_day ON youtube_api_usage(project_key, quota_day);
    """)
    await db.commit()


@migration(17, "Auto-approve modes (off/trial/on) and decision log for trial agreement stats")
async def migration_v17(db):
    cur = await db.execute("PRAGMA table_info(youtube_accounts)")
    cols = {r[1] for r in await cur.fetchall()}
    if "auto_mode" not in cols:
        await db.execute("ALTER TABLE youtube_accounts ADD COLUMN auto_mode TEXT DEFAULT 'off'")
        # existing auto-upload accounts keep their behaviour
        await db.execute("UPDATE youtube_accounts SET auto_mode = 'on' WHERE auto_upload = 1")
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS auto_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clip_id INTEGER NOT NULL,
            account_key TEXT NOT NULL,
            mode TEXT NOT NULL,
            score INTEGER NOT NULL,
            threshold INTEGER NOT NULL,
            would_approve INTEGER NOT NULL,
            human_decision TEXT,
            decided_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(clip_id, account_key)
        );
        CREATE INDEX IF NOT EXISTS idx_auto_decisions_account ON auto_decisions(account_key, created_at DESC);
    """)
    await db.commit()


@migration(18, "Per-video YouTube metrics (a clip can be posted to several channels)")
async def migration_v18(db):
    cur = await db.execute("PRAGMA table_info(clip_metrics)")
    cols = {r[1] for r in await cur.fetchall()}
    if "video_id" not in cols:
        await db.execute("ALTER TABLE clip_metrics ADD COLUMN video_id TEXT")
    if "account_key" not in cols:
        await db.execute("ALTER TABLE clip_metrics ADD COLUMN account_key TEXT")
    await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_metrics_video_window ON clip_metrics(video_id, window)")
    await db.commit()


@migration(19, "published_at / source_purged_at for source-footage retention")
async def migration_v19(db):
    cur = await db.execute("PRAGMA table_info(clips)")
    cols = {r[1] for r in await cur.fetchall()}
    if "published_at" not in cols:
        await db.execute("ALTER TABLE clips ADD COLUMN published_at TIMESTAMP")
        await db.execute("UPDATE clips SET published_at = updated_at WHERE status = 'published'")
    if "source_purged_at" not in cols:
        await db.execute("ALTER TABLE clips ADD COLUMN source_purged_at TIMESTAMP")
    await db.commit()


@migration(20, "caption_style per clip")
async def migration_v20(db):
    cur = await db.execute("PRAGMA table_info(clips)")
    if "caption_style" not in {r[1] for r in await cur.fetchall()}:
        await db.execute("ALTER TABLE clips ADD COLUMN caption_style TEXT")
    await db.commit()


@migration(21, "hook_style per clip")
async def migration_v21(db):
    cur = await db.execute("PRAGMA table_info(clips)")
    if "hook_style" not in {r[1] for r in await cur.fetchall()}:
        await db.execute("ALTER TABLE clips ADD COLUMN hook_style TEXT")
    await db.commit()


async def run_migrations(db) -> None:
    """Execute all pending schema migrations inside a single safe transaction."""
    # Ensure schema_version table exists first
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            description TEXT
        );
    """)
    await db.commit()

    cur = await db.execute("SELECT version FROM schema_version")
    rows = await cur.fetchall()
    applied_versions = {r[0] if isinstance(r, (list, tuple)) else r["version"] for r in rows}

    for v, desc, fn in sorted(MIGRATIONS, key=lambda x: x[0]):
        if v not in applied_versions:
            logger.info("Applying database migration v%d: %s...", v, desc)
            await fn(db)
            await db.execute(
                "INSERT INTO schema_version (version, description) VALUES (?, ?)",
                (v, desc)
            )
            await db.commit()
            logger.info("Successfully applied migration v%d.", v)

