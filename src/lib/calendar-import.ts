// Reads a Google Calendar export (.ics, or the .zip Google downloads) and turns the events
// into jobs to import. Pure code so it can be tested; the server action does the saving.

import ICAL from "ical.js";
import { unzipSync, strFromU8 } from "fflate";
import { addDays, COMPANY_TIME_ZONE, dayOfWeek, type Day } from "./time";

export interface CalendarEvent {
  /** Stable id for this occurrence (UID + start), so importing twice doesn't duplicate. */
  ref: string;
  summary: string;
  location: string;
  description: string;
  day: Day;
  startMin: number;
  endMin: number;
  allDay: boolean;
  /** Which calendar it came from (in Google's export, one file per calendar). */
  calendar?: string;
}

export interface ImportGroup {
  /** Back-to-back events with the same title are one job that can be done on any of those days. */
  key: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  /** Work days the job takes: 1 unless the notes say otherwise ("3 days"). */
  days: number;
  /** The days it may be done on (the span of its events). */
  firstDay: Day;
  lastDay: Day;
  events: CalendarEvent[];
}

const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMPANY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A moment in time → the company's local day and minutes after midnight. */
export function toLocalDayMin(date: Date): { day: Day; min: number } {
  const p = Object.fromEntries(localParts.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Pull the .ics text out of an upload: a plain .ics file, or Google's .zip export (all calendars). */
export function icsTextsFromUpload(name: string, bytes: Uint8Array): { calendar: string; text: string }[] {
  if (name.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const files = unzipSync(bytes);
    return Object.entries(files)
      .filter(([path]) => path.toLowerCase().endsWith(".ics"))
      .map(([path, data]) => ({ calendar: path.split("/").pop()!.replace(/\.ics$/i, ""), text: strFromU8(data) }));
  }
  return [{ calendar: name.replace(/\.ics$/i, ""), text: new TextDecoder().decode(bytes) }];
}

/** What was left out of an import, and why (shown in the preview). */
export interface ParseStats {
  past: number;
  later: number;
  cancelled: number;
}

/** Repeating events are walked from their first date; this only stops runaway rules. */
const MAX_RECURRENCE_STEPS = 100_000;

/**
 * Parse an .ics file into individual occurrences between `fromDay` and `toDay` (repeating
 * events are expanded). All-day and multi-day events become one full workday per day they
 * cover (weekdays only, unless the event is only on a weekend).
 */
export function parseIcs(
  text: string,
  opts: { fromDay: Day; toDay: Day; workdayStartMin: number; workdayEndMin: number; stats?: ParseStats },
): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
  const stats = opts.stats ?? { past: 0, later: 0, cancelled: 0 };

  const out: CalendarEvent[] = [];
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  const cancelledOccurrences = new Set<string>();
  for (const comp of root.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(comp);
    const cancelled = comp.getFirstPropertyValue("status")?.toString().toUpperCase() === "CANCELLED";
    if (ev.isRecurrenceException()) {
      if (cancelled) cancelledOccurrences.add(`${ev.uid}|${ev.recurrenceId.toUnixTime()}`);
      else exceptions.push(ev);
      continue;
    }
    if (cancelled) {
      stats.cancelled++;
      continue;
    }
    // Events copied or imported into Google can share a UID; keep every one.
    let key = ev.uid || `no-uid-${masters.size}`;
    for (let n = 2; masters.has(key); n++) key = `${ev.uid}~${n}`;
    masters.set(key, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master?.isRecurring()) master.relateException(ex);
    else masters.set(`${ex.uid}~${ex.recurrenceId.toString()}`, ex); // its series is gone: a one-off event
  }

  const fromDate = new Date(`${opts.fromDay}T00:00:00Z`);
  const toDate = new Date(`${addDays(opts.toDay, 2)}T00:00:00Z`);
  const isWeekend = (d: Day) => dayOfWeek(d) === 0 || dayOfWeek(d) === 6;

  const add = (ev: { summary: string; location: string; description: string }, uid: string, start: ICAL.Time, end: ICAL.Time, repeat = false) => {
    const summary = (ev.summary ?? "").trim() || "(no title)";
    const location = (ev.location ?? "").trim();
    const description = (ev.description ?? "").trim();
    let first: Day, last: Day;
    let timed: { startMin: number; endMin: number } | null = null;
    if (start.isDate) {
      first = start.toString().slice(0, 10);
      last = addDays(end.toString().slice(0, 10), -1); // DTEND is exclusive
      if (last < first) last = first; // no end: one day
    } else {
      const s = toLocalDayMin(start.toJSDate());
      const e = toLocalDayMin(end.toJSDate());
      first = s.day;
      last = e.day > s.day && e.min === 0 ? addDays(e.day, -1) : e.day < s.day ? s.day : e.day; // ends at midnight → previous day
      if (last === first) timed = { startMin: s.min, endMin: Math.max(e.day === s.day ? e.min : 24 * 60, Math.min(s.min + 60, 24 * 60)) };
    }
    // Only one-off events count as skipped; a series' earlier and later repeats aren't news.
    if (last < opts.fromDay) {
      if (!repeat) stats.past++;
      return;
    }
    if (first > opts.toDay) {
      if (!repeat) stats.later++;
      return;
    }
    const all: Day[] = [];
    for (let d = first; d <= last && all.length < 366; d = addDays(d, 1)) all.push(d);
    const days = all.some((d) => !isWeekend(d)) ? all.filter((d) => !isWeekend(d)) : all;
    for (const d of days) {
      if (d < opts.fromDay || d > opts.toDay) continue;
      out.push({
        ref: timed ? `${uid}#${start.toString()}` : `${uid}#${d}`,
        summary,
        location,
        description,
        day: d,
        startMin: timed?.startMin ?? opts.workdayStartMin,
        endMin: timed?.endMin ?? opts.workdayEndMin,
        allDay: !timed,
      });
    }
  };

  for (const [key, ev] of masters) {
    const uid = key.includes("~") || !ev.isRecurring() ? key : ev.uid;
    if (!ev.isRecurring()) {
      add(ev, uid, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    for (let next = it.next(), n = 0; next && n < MAX_RECURRENCE_STEPS; next = it.next(), n++) {
      if (next.toJSDate() > toDate) break;
      if (cancelledOccurrences.has(`${ev.uid}|${next.toUnixTime()}`)) continue;
      const details = ev.getOccurrenceDetails(next);
      if (details.endDate.toJSDate() < fromDate) continue; // earlier repeats of a series that's still going aren't counted as skipped
      add(details.item, uid, details.startDate, details.endDate, true);
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin);
}

/** "1720 Epps Bridge Pkwy, Athens, GA 30606, USA" → parts. Missing pieces come back empty. */
export function parseAddress(location: string): { street: string; city: string; state: string; zip: string } {
  const parts = location
    .split(/\n|,/)
    .map((p) => p.trim())
    .filter((p) => p && !/^(usa|united states)$/i.test(p));
  const result = { street: "", city: "", state: "", zip: "" };
  const stateIdx = parts.findIndex((p) => /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/i.test(p));
  if (stateIdx > 0) {
    const [state, zip] = parts[stateIdx].split(/\s+/);
    result.state = state.toUpperCase();
    result.zip = zip ?? "";
    result.city = parts[stateIdx - 1];
    result.street = parts.slice(0, stateIdx - 1).join(", ");
  } else if (parts.length >= 2) {
    result.street = parts.slice(0, -1).join(", ");
    result.city = parts[parts.length - 1];
  } else if (parts.length === 1) {
    // Just a place name, e.g. "Athens" or "Kroger Athens"
    result.city = /\d/.test(parts[0]) ? "" : parts[0];
    result.street = /\d/.test(parts[0]) ? parts[0] : "";
  }
  return result;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** "3 days", "2-day job", "two days" in the title or notes → that many days. */
export function daysNoted(text: string): number | null {
  const m = text.toLowerCase().match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*days?\b/);
  if (!m) return null;
  const n = NUMBER_WORDS[m[1]] ?? Number(m[1]);
  return n >= 1 && n <= 30 ? n : null;
}

/** The next work day after `day` (Mon–Fri). */
const nextWorkday = (day: Day) => {
  let d = addDays(day, 1);
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, 1);
  return d;
};

/**
 * Every event is its own one-day job. An event spanning several days (or the same title on
 * back-to-back work days) is still one day of work: those days are when it may be done.
 * "3 days" in the title or notes makes it a longer job.
 */
export function groupEvents(events: CalendarEvent[]): ImportGroup[] {
  const sorted = [...events].sort((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin);
  const open = new Map<string, CalendarEvent[]>(); // title → the run of events it's currently extending
  const runs: CalendarEvent[][] = [];
  for (const e of sorted) {
    const title = normalize(e.summary);
    const run = open.get(title);
    const lastDay = run?.[run.length - 1].day;
    if (run && lastDay && (e.day === lastDay || e.day === nextWorkday(lastDay))) run.push(e);
    else {
      const fresh = [e];
      runs.push(fresh);
      open.set(title, fresh);
    }
  }
  return runs.map((evs) => {
    const withLocation = evs.find((e) => e.location);
    const addr = parseAddress(withLocation?.location ?? "");
    const notes = [...new Set(evs.map((e) => e.description).filter(Boolean))].join("\n\n").slice(0, 2000);
    return {
      key: `${normalize(evs[0].summary)}|${evs[0].day}`,
      name: evs[0].summary,
      ...addr,
      state: addr.state || "GA",
      notes,
      days: daysNoted(`${evs[0].summary} ${notes}`) ?? 1,
      firstDay: evs[0].day,
      lastDay: evs[evs.length - 1].day,
      events: evs,
    };
  });
}

/** Crew names mentioned in the title or notes (e.g. "Kroger — John, David"). */
export function mentionedEmployees(text: string, employees: { id: string; name: string }[]): string[] {
  const words = ` ${normalize(text)} `;
  return employees.filter((e) => e.name.trim() && words.includes(` ${normalize(e.name)} `)).map((e) => e.id);
}
