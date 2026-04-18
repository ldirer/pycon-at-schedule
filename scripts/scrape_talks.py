"""Scrape talks/workshops from https://2026.pycon.at/talks-and-workshops/.

Outputs a standalone JSON file with HTML-rich long-form fields.

Usage:
    .venv/bin/python scripts/scrape_talks.py
    .venv/bin/python scripts/scrape_talks.py --output data/talks.json
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "data" / "talks.json"
SOURCE_URL = "https://2026.pycon.at/talks-and-workshops/"


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def clean_text(text: str) -> str:
    return " ".join(text.split())


def clean_title(title: str) -> tuple[str, str]:
    title = clean_text(title)
    if title.startswith("(Workshop) "):
        return title[len("(Workshop) ") :].strip(), "workshop"
    return title, "talk"


def html_of(node: Tag | None) -> str:
    if node is None:
        return ""
    return node.decode_contents().strip()


def parse_session(details: Tag, section_label: str) -> dict[str, Any]:
    title_raw = clean_text(details.select_one(".session_title").get_text(" ", strip=True))
    title, session_type = clean_title(title_raw)

    speaker_block = details.select_one(".session_speaker")
    speaker_link = speaker_block.select_one("a[href]") if speaker_block else None
    speaker_name = clean_text(
        (speaker_link.get_text(" ", strip=True) if speaker_link else speaker_block.get_text(" ", strip=True))
        if speaker_block
        else ""
    )

    speaker_image = speaker_block.select_one("img") if speaker_block else None

    description_block = details.select_one(".session_description_content")
    speaker_info = details.select_one(".session_speaker_info")
    bio_block = details.select_one(".session_speaker_bio")

    # Capture headings in session_details as additional structure/context.
    detail_headings = [clean_text(h.get_text(" ", strip=True)) for h in details.select(".session_details > div > h2")]

    videos = [
        {
            "label": clean_text(a.get_text(" ", strip=True)),
            "url": a["href"],
        }
        for a in details.select(".session_speaker_videos a[href]")
        if a.get("href", "").strip()
    ]

    session_id = f"{slugify(title)[:80]}-{slugify(speaker_name)[:40]}".strip("-")

    return {
        "id": session_id,
        "title": title,
        "title_raw": title_raw,
        "type": session_type,
        "track": "english" if "English" in section_label else "german",
        "section": section_label,
        "author": speaker_name,
        "author_url": speaker_link["href"] if speaker_link else "",
        "author_image_url": speaker_image["src"] if speaker_image and speaker_image.has_attr("src") else "",
        "description": html_of(description_block),
        "author_bio": html_of(bio_block),
        "speaker_info_html": html_of(speaker_info),
        "detail_headings": detail_headings,
        "speaker_videos": videos,
    }


def parse_page(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    content = soup.select_one(".entry-content")
    if content is None:
        raise RuntimeError("Could not find .entry-content on source page")

    talks: list[dict[str, Any]] = []
    for sessions_table in content.select("div.sessionstable"):
        previous_h2 = sessions_table.find_previous_sibling(lambda t: isinstance(t, Tag) and t.name == "h2")
        section_label = clean_text(previous_h2.get_text(" ", strip=True)) if previous_h2 else ""

        for details in sessions_table.select("details.session"):
            talks.append(parse_session(details, section_label))

    return talks


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT.relative_to(ROOT)),
        help="Output JSON path (default: data/talks.json)",
    )
    parser.add_argument(
        "--url",
        default=SOURCE_URL,
        help="Source URL (default: PyCon Austria talks/workshops page)",
    )
    return parser.parse_args()


def resolve_from_root(path_str: str) -> Path:
    p = Path(path_str)
    return p if p.is_absolute() else ROOT / p


def main() -> None:
    args = parse_args()
    output_path = resolve_from_root(args.output)

    response = requests.get(args.url, timeout=30)
    response.raise_for_status()
    response.encoding = "utf-8"

    talks = parse_page(response.text)

    payload = {
        "source_url": args.url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "count": len(talks),
        "talks": talks,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    label = output_path.relative_to(ROOT) if output_path.is_relative_to(ROOT) else output_path
    print(f"Wrote {len(talks)} talks to {label}")


if __name__ == "__main__":
    main()
