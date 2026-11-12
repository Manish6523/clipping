"""Per-channel posting slots, daily caps and quota-day logic."""

import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.publisher.slots import next_quota_reset, next_slot, parse_slots, quota_day, slots_to_strings  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
ACC = {"publish_slots": '["12:30","17:30","21:30"]', "daily_cap": 3, "timezone": "Asia/Kolkata"}


def ist(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=IST)


def test_parse_slots_variants_and_defaults():
    assert slots_to_strings(parse_slots('["21:30","12:30","12:30"]')) == ["12:30", "21:30"]
    assert slots_to_strings(parse_slots("9:05, 18:00")) == ["09:05", "18:00"]
    assert slots_to_strings(parse_slots(["25:00", "x"])) == ["12:30", "17:30", "21:30"]   # invalid -> defaults
    assert slots_to_strings(parse_slots(None)) == ["12:30", "17:30", "21:30"]


def test_next_slot_today_then_fills_in_order():
    now = ist(2026, 11, 12, 10, 0)
    s1 = next_slot(ACC, [], now)
    assert s1.astimezone(IST) == ist(2026, 11, 12, 12, 30)
    s2 = next_slot(ACC, [s1], now)
    assert s2.astimezone(IST) == ist(2026, 11, 12, 17, 30)
    s3 = next_slot(ACC, [s1, s2], now)
    s4 = next_slot(ACC, [s1, s2, s3], now)
    assert s3.astimezone(IST) == ist(2026, 11, 12, 21, 30)
    assert s4.astimezone(IST) == ist(2026, 11, 13, 12, 30)          # cap 3 -> tomorrow


def test_daily_cap_counts_and_past_slots_skipped():
    now = ist(2026, 11, 12, 18, 0)                                  # 12:30 and 17:30 passed
    assert next_slot(ACC, [], now).astimezone(IST) == ist(2026, 11, 12, 21, 30)
    cap1 = {**ACC, "daily_cap": 1}
    earlier_today = ist(2026, 11, 12, 12, 30)                        # already used today's single post
    assert next_slot(cap1, [earlier_today], now).astimezone(IST) == ist(2026, 11, 13, 12, 30)


def test_slot_starting_right_now_is_skipped():
    assert next_slot(ACC, [], ist(2026, 11, 12, 12, 29)).astimezone(IST) == ist(2026, 11, 12, 17, 30)


def test_other_timezone_and_utc_strings():
    acc = {"publish_slots": ["09:00"], "daily_cap": 2, "timezone": "America/New_York"}
    now = datetime(2026, 11, 12, 15, 0, tzinfo=timezone.utc)        # 10:00 New York
    s = next_slot(acc, ["2026-11-13T14:00:00+00:00"], now)          # tomorrow 09:00 NY taken
    assert s == datetime(2026, 11, 14, 14, 0, tzinfo=timezone.utc)


def test_quota_day_is_pacific():
    # 07:00 UTC on the 12th is still the 11th in California
    assert quota_day(datetime(2026, 11, 12, 7, 0, tzinfo=timezone.utc)) == "2026-11-11"
    assert quota_day(datetime(2026, 11, 12, 9, 0, tzinfo=timezone.utc)) == "2026-11-12"
    assert next_quota_reset(datetime(2026, 11, 12, 9, 0, tzinfo=timezone.utc)) > datetime(2026, 11, 13, 7, 0, tzinfo=timezone.utc)
