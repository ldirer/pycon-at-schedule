"""Parse a PyCon Austria 2026 schedule TSV into schedule.json.

Input TSV format: tab-separated with quoted multi-line descriptions.

Usage:
    python scripts/build_schedule.py
    python scripts/build_schedule.py data/20260418_232400_schedule.tsv
    python scripts/build_schedule.py --input data/20260418_232400_schedule.tsv --output data/schedule.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "data" / "schedule.tsv"
DEFAULT_DST = ROOT / "data" / "schedule.json"

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


def build(src: Path) -> dict:
    with src.open(newline="", encoding="utf-8") as f:
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input",
        nargs="?",
        help="Input TSV path (default: data/schedule.tsv)",
    )
    parser.add_argument(
        "--input",
        dest="input_opt",
        help="Input TSV path (overrides positional input)",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_DST.relative_to(ROOT)),
        help="Output JSON path (default: data/schedule.json)",
    )
    return parser.parse_args()


def resolve_from_root(path_str: str) -> Path:
    p = Path(path_str)
    return p if p.is_absolute() else ROOT / p


def main() -> None:
    args = parse_args()

    input_arg = args.input_opt or args.input or str(DEFAULT_SRC.relative_to(ROOT))
    src = resolve_from_root(input_arg)
    dst = resolve_from_root(args.output)

    if not src.exists():
        raise SystemExit(f"Input file not found: {src}")

    data = build(src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    src_label = src.relative_to(ROOT) if src.is_relative_to(ROOT) else src
    dst_label = dst.relative_to(ROOT) if dst.is_relative_to(ROOT) else dst
    print(f"Read {src_label}; wrote {len(data['sessions'])} sessions to {dst_label}")


if __name__ == "__main__":
    main()
