const SCHEDULE_URL = "data/schedule.json";
const TALKS_URL = "data/talks.json";

const state = {
  schedule: null,
  activeDay: null,
  scheduleToTalkId: {},
  talksById: {},
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
    const { schedule, talksData } = await loadScheduleAndTalks();
    state.schedule = schedule;

    const talks = Array.isArray(talksData?.talks) ? talksData.talks : [];
    state.scheduleToTalkId = buildScheduleToTalkMapping(schedule.sessions, talks);
    state.talksById = indexTalksById(talks);
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

async function loadScheduleAndTalks() {
  const schedule = await loadJson(SCHEDULE_URL);
  const talksData = await loadJson(TALKS_URL).catch(() => ({ talks: [] }));
  return { schedule, talksData };
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return res.json();
}

function buildScheduleToTalkMapping(scheduleSessions, talks) {
  const talkTitles = talks.map((talk) => ({
    id: talk.id,
    normalizedTitle: normalizeTitleForMatching(talk.title || ""),
  }));

  return scheduleSessions.reduce((acc, session) => {
    const sessionTitle = normalizeTitleForMatching(session.title || "");
    if (!sessionTitle || !talkTitles.length) return acc;

    let bestTalkId = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    talkTitles.forEach((talk) => {
      const dist = levenshteinDistance(sessionTitle, talk.normalizedTitle);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestTalkId = talk.id;
      }
    });

    if (bestTalkId) acc[session.id] = bestTalkId;
    return acc;
  }, {});
}

function indexTalksById(talks) {
  return talks.reduce((acc, talk) => {
    if (talk?.id) acc[talk.id] = talk;
    return acc;
  }, {});
}

function getMatchedTalkForSession(session) {
  const talkId = state.scheduleToTalkId[session.id];
  return talkId ? state.talksById[talkId] || null : null;
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
  const minuteStarts = sessions
    .map((s) => timeToMinutes(s.startTime))
    .filter((n) => Number.isFinite(n));
  const minuteEnds = sessions
    .map((s) => timeToMinutes(s.endTime))
    .filter((n) => Number.isFinite(n));

  if (!minuteStarts.length || !minuteEnds.length) {
    el.scheduleRoot.innerHTML = `<p class="schedule__status">Schedule contains invalid time values.</p>`;
    return;
  }

  const dayStart = floorToHour(Math.min(...minuteStarts));
  const dayEnd = ceilToHour(Math.max(...minuteEnds));
  const totalMinutes = Math.max(60, dayEnd - dayStart);
  const slotMinutes = 10;
  const pixelsPerMinute = 3.5;
  const slotHeight = Math.round(slotMinutes * pixelsPerMinute * 10) / 10;
  const slotCount = Math.ceil(totalMinutes / slotMinutes);

  const selectedDay = getConferenceDays(state.schedule).find(
    (d) => d.date === state.activeDay
  );

  const section = document.createElement("section");
  section.className = "day-section";

  const heading = document.createElement("h2");
  heading.className = "day-section__heading";
  heading.textContent = formatDayLabel(selectedDay || { date: state.activeDay });
  section.appendChild(heading);

  const wrap = document.createElement("div");
  wrap.className = "timeline-wrap";

  const timetable = document.createElement("div");
  timetable.className = "timetable";
  timetable.style.setProperty("--room-count", String(rooms.length));
  timetable.style.setProperty("--slot-count", String(slotCount));
  timetable.style.setProperty("--slot-height", `${slotHeight}px`);

  const timeHead = document.createElement("div");
  timeHead.className = "timetable__head";
  timeHead.textContent = "Time";
  timeHead.style.gridColumn = "1";
  timeHead.style.gridRow = "1";
  timetable.appendChild(timeHead);

  const roomIndex = new Map();
  rooms.forEach((room, index) => {
    roomIndex.set(room, index);

    const roomHead = document.createElement("div");
    roomHead.className = "timetable__head";
    if (index === rooms.length - 1) roomHead.classList.add("timetable__head--last");
    roomHead.textContent = room;
    roomHead.style.gridColumn = String(2 + index);
    roomHead.style.gridRow = "1";
    timetable.appendChild(roomHead);

    const roomBg = document.createElement("div");
    roomBg.className = "timetable__room-bg";
    if (index === rooms.length - 1) roomBg.classList.add("timetable__room-bg--last");
    roomBg.style.gridColumn = String(2 + index);
    roomBg.style.gridRow = `2 / span ${slotCount}`;
    timetable.appendChild(roomBg);
  });

  for (let m = dayStart; m <= dayEnd; m += 60) {
    const slotIndex = Math.round((m - dayStart) / slotMinutes);
    const gridRow = 2 + slotIndex;

    const label = document.createElement("div");
    label.className = "timetable__time-label";
    if (m === dayStart) label.classList.add("timetable__time-label--start");
    if (m === dayEnd) label.classList.add("timetable__time-label--end");
    label.textContent = minutesToTime(m);
    label.style.gridColumn = "1";
    label.style.gridRow = String(gridRow);
    timetable.appendChild(label);

    const line = document.createElement("div");
    line.className = "timetable__hour-line";
    line.style.gridColumn = `2 / span ${rooms.length}`;
    line.style.gridRow = String(gridRow);
    timetable.appendChild(line);
  }

  sessions.forEach((s) => {
    const roomCol = roomIndex.get(s.room);
    if (roomCol === undefined) return;

    const startMinute = timeToMinutes(s.startTime);
    const endMinute = timeToMinutes(s.endTime);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) {
      return;
    }

    const startSlot = Math.floor((startMinute - dayStart) / slotMinutes);
    const endSlot = Math.ceil((endMinute - dayStart) / slotMinutes);
    const rowStart = 2 + Math.max(0, startSlot);
    const rowEnd = 2 + Math.max(startSlot + 1, endSlot);

    const card = renderSession(s);
    card.classList.add("timetable__session");
    card.style.gridColumn = String(2 + roomCol);
    card.style.gridRow = `${rowStart} / ${rowEnd}`;
    timetable.appendChild(card);
  });

  wrap.appendChild(timetable);
  section.appendChild(wrap);

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

  const matchedTalk = getMatchedTalkForSession(s);
  if (matchedTalk?.description) {
    el.dialogDescription.innerHTML = matchedTalk.description;
  } else if (s.description) {
    el.dialogDescription.textContent = s.description;
  } else {
    el.dialogDescription.textContent = "No description available.";
  }

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
  const normalizedTime = normalizeTime(time);
  const [hh, mm] = normalizedTime.split(":");
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

function normalizeTitleForMatching(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

function normalizeTime(time) {
  return String(time || "")
    .trim()
    .replace(";", ":");
}

function timeToMinutes(time) {
  const normalized = normalizeTime(time);
  const [h, m] = normalized.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function floorToHour(minutes) {
  return Math.floor(minutes / 60) * 60;
}

function ceilToHour(minutes) {
  return Math.ceil(minutes / 60) * 60;
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
