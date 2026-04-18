const SCHEDULE_URL = "data/schedule.json";

const state = {
  schedule: null,
  activeDay: "all",
};

const el = {
  scheduleRoot: document.getElementById("schedule"),
  dayTabs: document.getElementById("day-tabs"),
  confName: document.getElementById("conf-name"),
  confDates: document.getElementById("conf-dates"),
  confLocation: document.getElementById("conf-location"),
  downloadBtn: document.getElementById("download-ics"),
  dialog: document.getElementById("session-dialog"),
  dialogTitle: document.getElementById("dialog-title"),
  dialogMeta: document.getElementById("dialog-meta"),
  dialogSpeakers: document.getElementById("dialog-speakers"),
  dialogDescription: document.getElementById("dialog-description"),
};

init();

async function init() {
  el.downloadBtn.addEventListener("click", onDownloadIcs);
  el.dialog
    .querySelector(".dialog__close")
    .addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("click", (e) => {
    if (e.target === el.dialog) el.dialog.close();
  });

  try {
    const res = await fetch(SCHEDULE_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.schedule = await res.json();
  } catch (err) {
    el.scheduleRoot.innerHTML = `<p class="schedule__status">Couldn't load schedule: ${escapeHtml(
      err.message
    )}</p>`;
    return;
  }

  renderHeader(state.schedule.conference);
  renderDayTabs(state.schedule);
  render();
}

function renderHeader(conf) {
  el.confName.textContent = conf.name;
  el.confDates.textContent = formatDateRange(conf.dates);
  el.confLocation.textContent = conf.location || "";
}

function renderDayTabs(schedule) {
  const days = uniqueDays(schedule.sessions);
  const tabs = [{ key: "all", label: "All days" }].concat(
    days.map((d) => ({ key: d.date, label: formatDayLabel(d) }))
  );

  el.dayTabs.innerHTML = "";
  tabs.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-tabs__btn";
    btn.textContent = t.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(state.activeDay === t.key));
    btn.addEventListener("click", () => {
      state.activeDay = t.key;
      el.dayTabs.querySelectorAll(".day-tabs__btn").forEach((b) => {
        b.setAttribute(
          "aria-selected",
          String(b.textContent === t.label)
        );
      });
      render();
    });
    el.dayTabs.appendChild(btn);
  });
}

function render() {
  const sessions = state.schedule.sessions.filter((s) =>
    state.activeDay === "all" ? true : s.date === state.activeDay
  );

  if (sessions.length === 0) {
    el.scheduleRoot.innerHTML = `<p class="schedule__status">No sessions found.</p>`;
    return;
  }

  const byDay = groupBy(sessions, (s) => s.date);
  const orderedDays = Object.keys(byDay).sort();

  el.scheduleRoot.innerHTML = "";
  orderedDays.forEach((date) => {
    const section = document.createElement("section");
    section.className = "day-section";

    const heading = document.createElement("h2");
    heading.className = "day-section__heading";
    heading.textContent = formatDayLabel({
      day: byDay[date][0].day,
      date,
    });
    section.appendChild(heading);

    const byTime = groupBy(
      byDay[date].sort((a, b) => a.startTime.localeCompare(b.startTime)),
      (s) => `${s.startTime}–${s.endTime}`
    );

    Object.keys(byTime).forEach((timeRange) => {
      const group = document.createElement("div");
      group.className = "slot-group";

      const timeHeader = document.createElement("h3");
      timeHeader.className = "slot-group__time";
      timeHeader.textContent = timeRange.replace("–", " – ");
      group.appendChild(timeHeader);

      const list = document.createElement("div");
      list.className = "sessions";
      byTime[timeRange].forEach((s) => list.appendChild(renderSession(s)));
      group.appendChild(list);

      section.appendChild(group);
    });

    el.scheduleRoot.appendChild(section);
  });
}

function renderSession(s) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "session" + (s.canceled ? " session--canceled" : "");

  const meta = document.createElement("div");
  meta.className = "session__meta";
  meta.appendChild(badge(s.type));
  if (s.canceled) meta.appendChild(badge("canceled"));
  const room = document.createElement("span");
  room.textContent = s.room;
  meta.appendChild(room);
  if (s.language) {
    const lang = document.createElement("span");
    lang.textContent = "· " + s.language;
    meta.appendChild(lang);
  }

  const title = document.createElement("h3");
  title.className = "session__title";
  title.textContent = s.title;

  card.appendChild(meta);
  card.appendChild(title);

  if (s.speakers && s.speakers.length) {
    const speakers = document.createElement("p");
    speakers.className = "session__speakers";
    speakers.textContent = s.speakers.join(", ");
    card.appendChild(speakers);
  }

  card.addEventListener("click", () => openDialog(s));
  return card;
}

function badge(kind) {
  const b = document.createElement("span");
  b.className = "badge badge--" + kind;
  b.textContent = kind;
  return b;
}

function openDialog(s) {
  el.dialogTitle.textContent = s.title;
  el.dialogMeta.textContent = [
    formatDayLabel({ day: s.day, date: s.date }),
    `${s.startTime}–${s.endTime}`,
    s.room,
    s.language,
  ]
    .filter(Boolean)
    .join(" · ");
  el.dialogSpeakers.textContent = (s.speakers || []).join(", ");
  el.dialogDescription.textContent =
    s.description || "No description available.";
  if (typeof el.dialog.showModal === "function") {
    el.dialog.showModal();
  } else {
    el.dialog.setAttribute("open", "");
  }
}

/* ---------- ICS export ---------- */

function onDownloadIcs() {
  if (!state.schedule) return;
  const ics = buildIcs(state.schedule);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pycon-at-2026.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildIcs(schedule) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PyCon Austria 2026//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(schedule.conference.name)}`,
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Vienna",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ];

  const dtstamp = formatIcsUtc(new Date());

  schedule.sessions
    .filter((s) => !s.canceled)
    .forEach((s) => {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${s.id}@pycon.at`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART;TZID=Europe/Vienna:${icsLocal(s.date, s.startTime)}`);
      lines.push(`DTEND;TZID=Europe/Vienna:${icsLocal(s.date, s.endTime)}`);
      lines.push(`SUMMARY:${escapeIcs(s.title)}`);
      if (s.room) lines.push(`LOCATION:${escapeIcs(s.room)}`);
      const descParts = [];
      if (s.speakers && s.speakers.length)
        descParts.push("Speakers: " + s.speakers.join(", "));
      if (s.language) descParts.push("Language: " + s.language);
      if (s.description) descParts.push("", s.description);
      if (descParts.length)
        lines.push(`DESCRIPTION:${escapeIcs(descParts.join("\n"))}`);
      lines.push(`CATEGORIES:${s.type === "workshop" ? "Workshop" : "Talk"}`);
      lines.push("END:VEVENT");
    });

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

function icsLocal(isoDate, time) {
  // isoDate: "2026-04-19", time: "10:00"
  const [y, m, d] = isoDate.split("-");
  const [hh, mm] = time.split(":");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function formatIcsUtc(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcs(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLine(line) {
  // RFC 5545: lines SHOULD NOT exceed 75 octets; fold with CRLF + space
  if (line.length <= 75) return line;
  const chunks = [];
  let i = 0;
  chunks.push(line.slice(i, i + 75));
  i += 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

/* ---------- helpers ---------- */

function uniqueDays(sessions) {
  const seen = new Map();
  sessions.forEach((s) => {
    if (!seen.has(s.date)) seen.set(s.date, { day: s.day, date: s.date });
  });
  return Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

function formatDateRange(dates) {
  if (!dates || !dates.length) return "";
  const parse = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  if (dates.length === 1) return fmt.format(parse(dates[0]));
  const first = parse(dates[0]);
  const last = parse(dates[dates.length - 1]);
  return `${fmt.format(first).replace(/ \d{4}$/, "")} – ${fmt.format(last)}`;
}

function formatDayLabel({ day, date }) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const name = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(dt);
  const dayMonth = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dt);
  return `${name}, ${dayMonth}`;
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}
