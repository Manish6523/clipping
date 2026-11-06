"""Instagram Reels Uploader with persistent session caching via instagrapi.

All imports placed at the top of the file according to standards.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from instagrapi import Client
    HAS_INSTAGRAPI = True
except ImportError:
    Client = None
    HAS_INSTAGRAPI = False

from config.settings import TOKENS_DIR

logger = logging.getLogger(__name__)


class InstagramReelsPublisher:
    """Manages multi-account Instagram Reels distribution."""

    def __init__(self, account_key: str):
        self.account_key = account_key
        self.token_file = Path(TOKENS_DIR) / f"ig_{account_key}.json"
        self._client = None

    def _get_client(self):
        """Initialize and authenticate instagrapi Client using cached session or credentials."""
        if self._client is not None:
            return self._client

        if not HAS_INSTAGRAPI or Client is None:
            raise ImportError("instagrapi library is not installed.")

        client = Client()
        client.delay_range = [2, 5]

        if not self.token_file.exists():
            raise FileNotFoundError(
                f"Instagram credentials/session file missing for key '{self.account_key}'. "
                f"Expected at: {self.token_file}"
            )

        with open(self.token_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        session_settings = data.get("settings")
        username = data.get("username")
        password = data.get("password")

        # 1. Try loading cached session
        if session_settings:
            try:
                client.set_settings(session_settings)
                client.get_timeline_feed()
                logger.info("Loaded valid Instagram session for '%s'.", username or self.account_key)
                self._client = client
                return self._client
            except Exception as e:
                logger.warning("Cached Instagram session expired: %s. Re-authenticating...", e)

        # 2. Login with credentials if session invalid
        if username and password:
            client.login(username, password)
            data["settings"] = client.get_settings()
            with open(self.token_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            self._client = client
            return self._client

        raise ValueError(f"Insufficient credentials to authenticate Instagram account '{self.account_key}'.")

    async def upload_reel(
        self,
        video_path: str,
        caption: str,
        hashtags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Upload vertical 9:16 video to Instagram Reels.
        """
        v_path = Path(video_path)
        if not v_path.exists():
            raise FileNotFoundError(f"Reel video file missing: {video_path}")

        tag_list = hashtags or ["#Reels", "#Viral", "#Trending"]
        tags_str = " ".join(t if t.startswith("#") else f"#{t}" for t in tag_list)
        full_caption = f"{caption}\n.\n.\n{tags_str}"

        try:
            client = self._get_client()
            logger.info("Uploading Reel to Instagram account '%s'...", self.account_key)

            media = client.clip_upload(
                path=str(v_path),
                caption=full_caption,
            )

            media_id = str(getattr(media, "pk", getattr(media, "id", "")))
            code = getattr(media, "code", "")
            media_url = f"https://www.instagram.com/reel/{code}/" if code else ""

            logger.info("Instagram Reel published successfully! URL: %s", media_url)
            return {
                "success": True,
                "media_id": media_id,
                "url": media_url,
                "account_key": self.account_key,
            }

        except Exception as e:
            logger.error("Instagram Reels upload failed for %s: %s", self.account_key, e)
            return {
                "success": False,
                "error": str(e),
                "account_key": self.account_key,
            }
