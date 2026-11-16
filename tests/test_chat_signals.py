"""Chat signals 2.0: moods, emote walls, signal score, replay spikes, YouTube replay parsing, live emote_burst."""
import asyncio
import json
import time

from src.intelligence.chat_signals import (
    chat_signal_score, classify_reaction, describe_reaction, emote_wall, is_emote_burst, spikes_from_replay,
)


def test_classify_reaction_moods():
    assert classify_reaction(["KEKW", "LMAOOOO", "💀💀💀", "ICANT", "bro"])["mood"] == "laugh"
    assert classify_reaction(["POGGERS", "W", "LETSGO", "🔥🔥", "clutch"])["mood"] == "hype"
    assert classify_reaction(["WTF", "no way", "monkaS", "😱", "hi"])["mood"] == "shock"
    assert classify_reaction(["hello", "how are you", "nice stream"])["mood"] == "none"
    mixed = classify_reaction(["KEKW", "WTF", "LUL", "OMG"])
    assert mixed["mood"] == "mixed" and set(mixed["top"]) == {"laugh", "shock"}
    assert classify_reaction([])["mood"] == "none"


def test_emote_wall():
    wall = emote_wall(["KEKW KEKW KEKW", "KEKW", "kekw kekw", "lol what", "KEKW KEKW"])
    assert wall["token"] == "kekw" and wall["share"] == 0.8
    assert emote_wall(["this is a sentence", "another one here"])["token"] is None


def test_signal_score_monotonic_and_bounded():
    assert chat_signal_score(1.0) == 40.0
    assert chat_signal_score(3) < chat_signal_score(6) < chat_signal_score(12) <= 100
    assert chat_signal_score(4, 0.2, 5) < chat_signal_score(4, 0.9, 40)
    assert chat_signal_score(100, 1, 1000) == 100.0


def test_is_emote_burst():
    msgs = ["KEKW"] * 7 + ["LMAO", "💀", "ok"]
    users = [f"u{i}" for i in range(10)]
    ok, info = is_emote_burst(msgs, users, ratio=1.4)
    assert ok and info["mood"] == "laugh" and info["unique_chatters"] == 10
    assert not is_emote_burst(msgs, ["same"] * 10, ratio=1.4)[0]        # one spammer is not a moment
    assert not is_emote_burst(msgs, users, ratio=1.0)[0]                 # dead-slow chat
    assert not is_emote_burst(["hi"] * 10, users, ratio=2.0)[0]          # no reaction


def test_spikes_from_replay():
    comments = [(t + 0.1, "chatting") for t in range(0, 1200, 4)]          # ~0.25 msg/s background
    comments += [(600 + i * 0.2, "KEKW") for i in range(25)]                # 25 msgs in 5 s
    comments += [(900 + i * 0.25, "WTF") for i in range(12)]                # smaller one
    spikes = spikes_from_replay(comments)
    assert [s["time"] for s in spikes] == [602.5, 902.5]
    assert spikes[0]["mood"] == "laugh" and spikes[1]["mood"] == "shock"
    assert spikes[0]["score"] > spikes[1]["score"]
    assert spikes_from_replay([]) == []


def test_describe_reaction():
    assert describe_reaction({"mood": "laugh", "mood_share": 0.72, "unique_chatters_5s": 31}) == \
        "Chat reaction: laugh (72% of messages, 31 different chatters)"
    assert describe_reaction({}) == "No clear chat reaction."


def test_parse_youtube_live_chat(tmp_path):
    from src.monitor.vod_watcher import parse_live_chat_replay

    def line(ms, runs):
        return json.dumps({"replayChatItemAction": {"videoOffsetTimeMsec": str(ms), "actions": [
            {"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {"message": {"runs": runs}}}}}]}})
    f = tmp_path / "chat.live_chat.json"
    f.write_text("\n".join([
        line(1500, [{"text": "no way"}, {"emoji": {"emojiId": "😂", "shortcuts": [":joy:"]}}]),
        line(2500, [{"emoji": {"emojiId": "UCx/abc", "isCustomEmoji": True, "shortcuts": [":kekw:"]}}]),
        "not json",
        json.dumps({"replayChatItemAction": {"videoOffsetTimeMsec": "3000", "actions": [{"addLiveChatTickerItemAction": {}}]}}),
    ]))
    assert parse_live_chat_replay(f) == [(1.5, "no way 😂"), (2.5, "kekw")]


def test_live_watcher_emote_burst_trigger(monkeypatch):
    from src.monitor import live_watcher as lw

    w = lw.LiveStreamWatcher.__new__(lw.LiveStreamWatcher)
    # minimal state the chat handler needs
    from collections import deque
    w.channel_id, w.platform = "tester", "twitch"
    w._is_channel_live = True
    w.chat_messages_timestamps, w.chat_history_buffer = deque(), deque(maxlen=300)
    w.chat_baseline_mps, w.spike_multiplier = 1.0, 10.0          # velocity trigger effectively off
    w.hype_keywords, w._keyword_hits = [], deque()
    w._chat_feed, w._chatters, w._chat_total = deque(maxlen=80), {}, 0
    w.last_trigger_time, w._trigger_count = 0.0, 0
    w.cooldown_seconds = 60
    fired = []

    async def fake_handle(reason, trigger_context, chat_features):
        fired.append(trigger_context)
    w._handle_hype_event = fake_handle
    w._extract_chat_features = lambda: {}
    monkeypatch.setattr(lw.telemetry, "moment_event", lambda *a, **k: None)

    now = time.time()
    # 10 minutes of slow baseline chat (0.6 msg/s), then a KEKW wall at ~1.6 msg/s from 9 people
    w._chat_first_seen = now - 700
    w._chat_buckets = deque([[int(now - 700 + i), 1] for i in range(0, 690, 2)])

    async def run():
        for i in range(9):
            await w._on_chat_message("KEKW KEKW", user=f"viewer{i}")
        await asyncio.sleep(0.05)
    asyncio.run(run())
    assert fired, "emote wall did not trigger"
    ctx = fired[0]
    assert ctx["type"] == "emote_burst" and ctx["mood"] == "laugh" and ctx["unique_chatters_5s"] == 8   # fires as soon as the 8th distinct chatter joins the wall
    assert ctx["emote_wall"] == "kekw" and 40 <= ctx["signal_score"] <= 100
