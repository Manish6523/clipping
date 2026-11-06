"""YouTube Shorts Uploader with multi-account OAuth2 authentication."""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from config.settings import TOKENS_DIR

logger = logging.getLogger(__name__)


class YouTubeShortsPublisher:
    """Manages multi-account YouTube Shorts distribution."""

    def __init__(self, account_key: str):
        self.account_key = account_key
        self.token_file = Path(TOKENS_DIR) / f"yt_{account_key}.json"

    def _get_authenticated_service(self):
        """Build Google API YouTube client using saved OAuth2 credentials."""
        if not self.token_file.exists():
            raise FileNotFoundError(
                f"OAuth2 token file not found for YouTube account key '{self.account_key}'. "
                f"Expected at: {self.token_file}"
            )

        with open(self.token_file, "r", encoding="utf-8") as f:
            token_data = json.load(f)

        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=["https://www.googleapis.com/auth/youtube.upload"],
        )

        return build("youtube", "v3", credentials=creds)

    async def upload_short(
        self,
        video_path: str,
        title: str,
        description: str = "",
        hashtags: Optional[List[str]] = None,
        category_id: str = "20",  # 20 = Gaming, 22 = People & Blogs
    ) -> Dict[str, Any]:
        """
        Upload vertical MP4 to YouTube Shorts.
        """
        v_path = Path(video_path)
        if not v_path.exists():
            raise FileNotFoundError(f"Video file not found for upload: {video_path}")

        # Ensure #Shorts is in title or description
        full_title = title if "#Shorts" in title else f"{title} #Shorts"
        full_title = full_title[:100]  # YouTube 100 char title limit

        tag_list = hashtags or ["#Shorts", "#Gaming", "#Viral"]
        tags_str = " ".join(t if t.startswith("#") else f"#{t}" for t in tag_list)
        full_description = f"{description}\n\n{tags_str}\n\nUploaded automatically by AutoClipDaemon."

        body = {
            "snippet": {
                "title": full_title,
                "description": full_description,
                "tags": [t.lstrip("#") for t in tag_list],
                "categoryId": category_id,
            },
            "status": {
                "privacyStatus": "public",
                "selfDeclaredMadeForKids": False,
            },
        }

        try:
            youtube = self._get_authenticated_service()
            media = MediaFileUpload(
                str(v_path),
                mimetype="video/mp4",
                resumable=True,
                chunksize=1024 * 1024 * 10,
            )

            request = youtube.videos().insert(
                part="snippet,status",
                body=body,
                media_body=media,
            )

            logger.info("Starting YouTube Shorts upload: '%s' to account '%s'...", full_title, self.account_key)
            response = None
            while response is None:
                status, response = request.next_chunk()
                if status:
                    logger.debug("Upload progress: %d%%", int(status.progress() * 100))

            video_id = response.get("id")
            video_url = f"https://youtube.com/shorts/{video_id}"
            logger.info("YouTube Short published successfully! URL: %s", video_url)

            return {
                "success": True,
                "video_id": video_id,
                "url": video_url,
                "account_key": self.account_key,
            }

        except Exception as e:
            logger.error("YouTube upload failed for %s: %s", self.account_key, e)
            return {
                "success": False,
                "error": str(e),
                "account_key": self.account_key,
            }

