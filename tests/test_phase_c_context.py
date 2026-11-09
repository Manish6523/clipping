import unittest
import asyncio
import os
import aiosqlite
import json
from src.monitor.live_watcher import LiveStreamWatcher

class TestPhaseCContext(unittest.IsolatedAsyncioTestCase):
    async def test_live_watcher_chat_and_trigger_context(self):
        watcher = LiveStreamWatcher(
            channel_id="test_streamer",
            platform="twitch",
            template_config={"hype_keywords": ["CLIP IT", "W"]},
        )
        # Simulate channel live
        watcher._is_channel_live = True

        # Append messages
        for i in range(15):
            await watcher._on_chat_message(f"Wwwwwwwwwww insane play {i}!")
        
        # Test feature extraction
        features = watcher._extract_chat_features()
        self.assertIn("top_messages", features)
        self.assertIn("top_tokens", features)
        self.assertGreaterEqual(len(features["top_messages"]), 1)
        # Check repetitive character collapsing: 'Wwwwwwwwwww' -> 'Www'
        self.assertTrue(any("Www" in m for m in features["top_messages"]))

if __name__ == "__main__":
    unittest.main()

