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
  /** Events with the same title become one job with several days. */
  key: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  hours: number;
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

/**
 * Parse an .ics file into individual occurrences between `fromDay` and `toDay` (repeating
 * events are expanded). All-day events become full workdays, one per weekday.
 */
export function parseIcs(text: string, opts: { fromDay: Day; toDay: Day; workdayStartMin: number; workdayEndMin: number }): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const out: CalendarEvent[] = [];
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const comp of root.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(comp);
    if (comp.getFirstPropertyValue("status")?.toString().toUpperCase() === "CANCELLED") continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const fromDate = new Date(`${opts.fromDay}T00:00:00Z`);
  const toDate = new Date(`${addDays(opts.toDay, 2)}T00:00:00Z`);

  const add = (ev: ICAL.Event | { summary: string; location: string; description: string }, uid: string, start: ICAL.Time, end: ICAL.Time) => {
    const summary = (ev.summary ?? "").trim() || "(no title)";
    const location = (ev.location ?? "").trim();
    const description = (ev.description ?? "").trim();
    if (start.isDate) {
      // All-day: one workday per weekday the event covers.
      const first = start.toString().slice(0, 10);
      const last = addDays(end.toString().slice(0, 10), -1); // DTEND is exclusive
      for (let d = first; d <= last; d = addDays(d, 1)) {
        const dow = dayOfWeek(d);
        if (dow === 0 || dow === 6 || d < opts.fromDay || d > opts.toDay) continue;
        out.push({ ref: `${uid}#${d}`, summary, location, description, day: d, startMin: opts.workdayStartMin, endMin: opts.workdayEndMin, allDay: true });
      }
      return;
    }
    const s = toLocalDayMin(start.toJSDate());
    const e = toLocalDayMin(end.toJSDate());
    if (s.day < opts.fromDay || s.day > opts.toDay) return;
    const endMin = e.day === s.day ? e.min : 24 * 60; // runs past midnight → end of day
    if (endMin <= s.min) return;
    out.push({ ref: `${uid}#${start.toString()}`, summary, location, description, day: s.day, startMin: s.min, endMin, allDay: false });
  };

  for (const [uid, ev] of masters) {
    if (!ev.isRecurring()) {
      add(ev, uid, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    for (let next = it.next(), n = 0; next && n < 1000; next = it.next(), n++) {
      const when = next.toJSDate();
      if (when > toDate) break;
      const details = ev.getOccurrenceDetails(next);
      if (details.endDate.toJSDate() < fromDate) continue;
      add(details.item, uid, details.startDate, details.endDate);
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

/** Same title = same job (e.g. "Kroger Athens" on Mon and Tue → one job, two days). */
export function groupEvents(events: CalendarEvent[]): ImportGroup[] {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = normalize(e.summary);
    map.set(k, [...(map.get(k) ?? []), e]);
  }
  return [...map.entries()]
    .map(([key, evs]) => {
      const withLocation = evs.find((e) => e.location);
      const addr = parseAddress(withLocation?.location ?? "");
      return {
        key,
        name: evs[0].summary,
        ...addr,
        state: addr.state || "GA",
        notes: [...new Set(evs.map((e) => e.description).filter(Boolean))].join("\n\n").slice(0, 2000),
        hours: Math.round((evs.reduce((s, e) => s + (e.endMin - e.startMin), 0) / 60) * 4) / 4,
        events: evs,
      };
    })
    .sort((a, b) => a.events[0].day.localeCompare(b.events[0].day));
}

/** Crew names mentioned in the title or notes (e.g. "Kroger — John, David"). */
export function mentionedEmployees(text: string, employees: { id: string; name: string }[]): string[] {
  const words = ` ${normalize(text)} `;
  return employees.filter((e) => e.name.trim() && words.includes(` ${normalize(e.name)} `)).map((e) => e.id);
}
