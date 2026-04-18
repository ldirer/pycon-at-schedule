const SCHEDULE_URL = "data/schedule.json";

const state = {
  schedule: null,
  activeDay: null,
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

  const closeBtn = el.dialog.querySelector(".dialog__close");
  closeBtn.addEventListener("click", () => el.dialog.close());
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

  const days = getConferenceDays(state.schedule);
  state.activeDay = days[0]?.date ?? null;

  renderHeader(state.schedule.conference);
  renderDayTabs(days);
  render();
}

function renderHeader(conf) {
  el.confName.textContent = conf.name;
  el.confDates.textContent = formatDateRange(conf.dates);
  el.confLocation.textContent = conf.location || "";
}

function renderDayTabs(days) {
  el.dayTabs.innerHTML = "";

  days.forEach((day) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-tabs__btn";
    btn.textContent = formatDayLabel(day);
    btn.setAttribute("role", "tab");
    btn.dataset.date = day.date;
    btn.setAttribute("aria-selected", String(state.activeDay === day.date));

    btn.addEventListener("click", () => {
      state.activeDay = day.date;
      renderDayTabs(days);
      render();
    });

    el.dayTabs.appendChild(btn);
  });
}

function render() {
  if (!state.activeDay) {
    el.scheduleRoot.innerHTML = `<p class="schedule__status">No conference days configured.</p>`;
    return;
  }

  const sessions = state.schedule.sessions
    .filter((s) => s.date === state.activeDay)
    .sort((a, b) => {
      const byTime = a.startTime.localeCompare(b.startTime);
      if (byTime !== 0) return byTime;
      return a.room.localeCompare(b.room);
    });

  if (!sessions.length) {
    const day = getConferenceDays(state.schedule).find((d) => d.date === state.activeDay);
    el.scheduleRoot.innerHTML = `<p class="schedule__status">No sessions yet for ${escapeHtml(
      formatDayLabel(day || { date: state.activeDay })
    )}.</p>`;
    return;
  }

  const rooms = unique(sessions.map((s) => s.room));
  const slotKeys = unique(
    sessions.map((s) => `${s.startTime}–${s.endTime}`)
  ).sort((a, b) => a.localeCompare(b));

  const bySlotAndRoom = new Map();
  sessions.forEach((s) => {
    const key = `${s.startTime}–${s.endTime}||${s.room}`;
    if (!bySlotAndRoom.has(key)) bySlotAndRoom.set(key, []);
    bySlotAndRoom.get(key).push(s);
  });

  const selectedDay = getConferenceDays(state.schedule).find(
    (d) => d.date === state.activeDay
  );

  const section = document.createElement("section");
  section.className = "day-section";

  const heading = document.createElement("h2");
  heading.className = "day-section__heading";
  heading.textContent = formatDayLabel(selectedDay || { date: state.activeDay });
  section.appendChild(heading);

  const tableWrap = document.createElement("div");
  tableWrap.className = "schedule-grid-wrap";

  const table = document.createElement("table");
  table.className = "schedule-grid";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  const thTime = document.createElement("th");
  thTime.className = "schedule-grid__timecol";
  thTime.textContent = "Time";
  headRow.appendChild(thTime);

  rooms.forEach((room) => {
    const th = document.createElement("th");
    th.textContent = room;
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  slotKeys.forEach((slot) => {
    const row = document.createElement("tr");

    const timeCell = document.createElement("th");
    timeCell.className = "schedule-grid__time";
    timeCell.scope = "row";
    timeCell.textContent = slot.replace("–", " – ");
    row.appendChild(timeCell);

    rooms.forEach((room) => {
      const td = document.createElement("td");
      td.className = "schedule-grid__cell";
      td.setAttribute("data-room", room);
      td.setAttribute("data-time", slot.replace("–", " – "));

      const key = `${slot}||${room}`;
      const cellSessions = bySlotAndRoom.get(key) || [];

      if (!cellSessions.length) {
        td.classList.add("schedule-grid__cell--empty");
      } else {
        cellSessions.forEach((s) => td.appendChild(renderSession(s)));
      }

      row.appendChild(td);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  section.appendChild(tableWrap);

  el.scheduleRoot.innerHTML = "";
  el.scheduleRoot.appendChild(section);
}

function renderSession(s) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "session" + (s.canceled ? " session--canceled" : "");

  const meta = document.createElement("div");
  meta.className = "session__meta";
  meta.appendChild(badge(s.type || "talk"));
  if (s.canceled) meta.appendChild(badge("canceled"));

  if (s.language) {
    const lang = document.createElement("span");
    lang.textContent = s.language;
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
  const normalized = ["workshop", "talk", "canceled"].includes(kind)
    ? kind
    : "talk";
  const b = document.createElement("span");
  b.className = "badge badge--" + normalized;
  b.textContent = normalized;
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
  el.dialogDescription.textContent = s.description || "No description available.";

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
  const tzid = schedule.conference.timezone || "Europe/Vienna";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PyCon Austria 2026//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(schedule.conference.name)}`,
    `X-WR-TIMEZONE:${escapeIcs(tzid)}`,
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
      lines.push(`DTSTART;TZID=${tzid}:${icsLocal(s.date, s.startTime)}`);
      lines.push(`DTEND;TZID=${tzid}:${icsLocal(s.date, s.endTime)}`);
      lines.push(`SUMMARY:${escapeIcs(s.title)}`);
      if (s.room) lines.push(`LOCATION:${escapeIcs(s.room)}`);

      const descParts = [];
      if (s.speakers && s.speakers.length) {
        descParts.push("Speakers: " + s.speakers.join(", "));
      }
      if (s.language) descParts.push("Language: " + s.language);
      if (s.description) descParts.push("", s.description);
      if (descParts.length) lines.push(`DESCRIPTION:${escapeIcs(descParts.join("\n"))}`);

      lines.push(`CATEGORIES:${s.type === "workshop" ? "Workshop" : "Talk"}`);
      lines.push("END:VEVENT");
    });

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

function icsLocal(isoDate, time) {
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

function getConferenceDays(schedule) {
  const confDates = schedule?.conference?.dates || [];
  if (confDates.length) {
    return confDates.map((date) => {
      const matching = schedule.sessions.find((s) => s.date === date);
      return {
        date,
        day: matching?.day || null,
      };
    });
  }

  const uniqueDates = unique(schedule.sessions.map((s) => s.date)).sort();
  return uniqueDates.map((date) => ({ date, day: null }));
}

function unique(arr) {
  return Array.from(new Set(arr));
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

function formatDayLabel({ date }) {
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
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
