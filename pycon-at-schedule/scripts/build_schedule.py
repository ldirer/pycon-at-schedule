"""Parse the PyCon Austria 2026 schedule TSV into schedule.json.

Input:  data/schedule.tsv  (tab-separated, with quoted multi-line descriptions)
Output: data/schedule.json

Usage:
    python scripts/build_schedule.py
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "schedule.tsv"
DST = ROOT / "data" / "schedule.json"

DAY_TO_DATE = {
    "sunday": "2026-04-19",
    "monday": "2026-04-20",
}

TYPE_MAP = {"W": "workshop", "T": "talk"}


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def parse_timeslot(slot: str) -> tuple[str, str]:
    start, end = slot.split("-", 1)
    return start.strip(), end.strip()


def parse_speakers(owner: str, second: str) -> list[str]:
    return [s.strip() for s in (owner, second) if s and s.strip()]


def row_to_session(row: dict[str, str]) -> dict:
    day = row["Day"].strip().lower()
    start, end = parse_timeslot(row["Timeslot"])
    room = row["Room"].strip()
    title = row["Title"].strip()
    kind = TYPE_MAP.get(row["Workshop_or_Talk"].strip().upper(), "talk")
    category = row.get("Category", "").strip()

    return {
        "id": f"{day}-{start.replace(':', '')}-{slugify(room)}-{slugify(title)[:40]}",
        "day": day,
        "date": DAY_TO_DATE[day],
        "startTime": start,
        "endTime": end,
        "room": room,
        "type": kind,
        "title": title,
        "description": row.get("Description", "").strip(),
        "speakers": parse_speakers(row.get("Owner", ""), row.get("Second_Speaker", "")),
        "language": row.get("language", "").strip(),
        "firstTimeSpeaker": row.get("first_time_speaker", "").strip().lower() == "checked",
        "category": category,
        "canceled": category.lower() == "canceled",
        "slideUrl": row.get("slide_url", "").strip(),
        "imageFilename": row.get("image_filename", "").strip(),
    }


def build() -> dict:
    with SRC.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", quotechar='"')
        sessions = [row_to_session(r) for r in reader if r.get("Day")]

    sessions.sort(key=lambda s: (s["date"], s["startTime"], s["room"]))

    return {
        "conference": {
            "name": "PyCon Austria 2026",
            "location": "Eisenstadt, Austria",
            "dates": ["2026-04-19", "2026-04-20"],
            "timezone": "Europe/Vienna",
        },
        "sessions": sessions,
    }


def main() -> None:
    data = build()
    DST.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['sessions'])} sessions to {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
