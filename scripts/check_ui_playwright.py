#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_PATH = ROOT / "data" / "schedule.json"


@dataclass
class SessionPair:
    short_title: str
    long_title: str
    short_time: str
    long_time: str


def to_minutes(hhmm: str) -> int:
    normalized = hhmm.strip().replace(";", ":")
    h, m = normalized.split(":")
    return int(h) * 60 + int(m)


def find_pair(sessions: list[dict]) -> SessionPair:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for s in sessions:
        key = (s["date"], s["startTime"])
        grouped.setdefault(key, []).append(s)

    for group in grouped.values():
        if len(group) < 2:
            continue
        ordered = sorted(group, key=lambda s: to_minutes(s["endTime"]) - to_minutes(s["startTime"]))
        short = ordered[0]
        long = ordered[-1]
        if short["endTime"] != long["endTime"]:
            return SessionPair(
                short_title=short["title"],
                long_title=long["title"],
                short_time=f"{short['startTime']}-{short['endTime']}",
                long_time=f"{long['startTime']}-{long['endTime']}",
            )

    raise RuntimeError("Could not find session pair with same start and different durations")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args):
        return

    def end_headers(self):
        if self.path.endswith(".json"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path: str):
        guessed = mimetypes.guess_type(path)[0]
        return guessed or "application/octet-stream"


async def main() -> None:
    schedule = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    pair = find_pair(schedule["sessions"])

    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{server.server_port}"
    print(f"Serving {ROOT} at {base_url}")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            page = await context.new_page()
            page.set_default_timeout(1000)

            page.on("console", lambda msg: print(f"[browser:{msg.type}] {msg.text}"))

            await page.goto(f"{base_url}/index.html", wait_until="domcontentloaded", timeout=1000)
            await page.wait_for_selector(".timetable", timeout=1000)
            await page.evaluate("console.log('playwright-check: schedule loaded')")

            conf_name = (await page.text_content("#conf-name") or "").strip()
            assert conf_name == "PyCon Austria 2026", f"Conference title mismatch: {conf_name}"

            ics_visible = await page.is_visible("#download-ics")
            assert ics_visible, "ICS button is not visible"

            tabs = [t.strip() for t in await page.locator(".day-tabs__btn").all_text_contents()]
            assert any("Sunday" in t for t in tabs), f"Missing Sunday tab in {tabs}"
            assert any("Monday" in t for t in tabs), f"Missing Monday tab in {tabs}"

            geometry = await page.evaluate(
                """
                ({ shortTitle, longTitle }) => {
                  function cardGeometry(title) {
                    const titleEls = Array.from(document.querySelectorAll('.timetable__session .session__title'));
                    const titleEl = titleEls.find((el) => el.textContent.trim() === title);
                    if (!titleEl) return null;
                    const card = titleEl.closest('.timetable__session');
                    if (!card) return null;
                    const r = card.getBoundingClientRect();
                    return { top: r.top, height: r.height };
                  }

                  const marks = Array.from(document.querySelectorAll('.timetable__hour-line'))
                    .map((el) => el.getBoundingClientRect().top)
                    .filter((n) => Number.isFinite(n));

                  return {
                    shortCard: cardGeometry(shortTitle),
                    longCard: cardGeometry(longTitle),
                    marks,
                  };
                }
                """,
                {"shortTitle": pair.short_title, "longTitle": pair.long_title},
            )

            assert geometry["shortCard"], f"Short session not found: {pair.short_title}"
            assert geometry["longCard"], f"Long session not found: {pair.long_title}"

            top_delta = abs(geometry["shortCard"]["top"] - geometry["longCard"]["top"])
            assert top_delta <= 2, f"Cards are not aligned at start: top delta {top_delta:.2f}px"

            short_h = geometry["shortCard"]["height"]
            long_h = geometry["longCard"]["height"]
            assert long_h > short_h, f"Long session is not taller ({long_h} <= {short_h})"

            marks = geometry["marks"]
            assert len(marks) >= 3, f"Not enough time marks: {marks}"
            spacing_a = marks[1] - marks[0]
            spacing_b = marks[2] - marks[1]
            assert abs(spacing_a - spacing_b) < 0.05, (
                f"Timeline spacing not even: {spacing_a} vs {spacing_b}"
            )

            print("✅ Playwright UI checks passed")
            print(
                f"Checked pair: '{pair.short_title}' ({pair.short_time}) vs "
                f"'{pair.long_title}' ({pair.long_time})"
            )

            await context.close()
            await browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


if __name__ == "__main__":
    asyncio.run(main())
