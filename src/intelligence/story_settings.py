"""Apply the dashboard's persisted story-engine settings to the live config (called at startup)."""

import logging

import config.settings as settings
from src.database import get_system_setting

logger = logging.getLogger(__name__)


async def load_story_settings_from_db() -> None:
    """The Settings page stores these in the DB; without this the engine would silently run on env defaults after a restart."""
    try:
        enabled = await get_system_setting("story_engine_enabled")
        if enabled is not None:
            settings.STORY_ENGINE_ENABLED = str(enabled).lower() in ("true", "1", "yes")
        mode = await get_system_setting("story_mode")
        if mode in ("shadow", "live"):
            settings.STORY_MODE = mode
        cpu = await get_system_setting("story_seed_cpu_budget")
        if cpu is not None:
            settings.STORY_SEED_CPU_BUDGET = min(1.0, max(0.1, float(cpu)))
        grace = await get_system_setting("story_session_grace_minutes")
        if grace is not None:
            settings.STORY_SESSION_GRACE_MINUTES = max(5, int(grace))
        logger.info("Story engine: enabled=%s mode=%s", settings.STORY_ENGINE_ENABLED, settings.STORY_MODE)
    except Exception as e:
        logger.warning("Could not load story settings from DB: %s", e)
