// Calendar helpers. A "Day" is a local calendar date string: "YYYY-MM-DD".
// Times of day are minutes after midnight (e.g. 480 = 8:00 AM).

export type Day = string;

export const COMPANY_TIME_ZONE = process.env.BAM_TIME_ZONE ?? "America/New_York";

/** Today in the company's time zone. BAM_TODAY can pin it for demos/tests. */
export function today(): Day {
  if (process.env.BAM_TODAY) return process.env.BAM_TODAY;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COMPANY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Convert a Day to the Date Prisma uses for @db.Date columns (UTC midnight). */
export function dayToDate(day: Day): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function dateToDay(date: Date): Day {
  return date.toISOString().slice(0, 10);
}

export function maybeDay(date: Date | null | undefined): Day | null {
  return date ? dateToDay(date) : null;
}

export function isDay(value: unknown): value is Day {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(dayToDate(value).getTime());
}

export function addDays(day: Day, n: number): Day {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dateToDay(d);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(day: Day): number {
  return dayToDate(day).getUTCDay();
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000);
}

/** Monday of the week containing `day`. */
export function weekStart(day: Day): Day {
  const dow = dayOfWeek(day);
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function dayRange(start: Day, count: number): Day[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** The next weekday on or after `day` (skips Sat/Sun). */
export function nextWorkday(day: Day): Day {
  let d = day;
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, 1);
  return d;
}

/** The nth work day counting from `day` (n = 0 → `day` itself if a weekday). */
export function workdayOffset(day: Day, n: number): Day {
  let d = nextWorkday(day);
  for (let i = 0; i < n; i++) d = nextWorkday(addDays(d, 1));
  return d;
}

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Tue 9/29" */
export function fmtDay(day: Day): string {
  const [, m, d] = day.split("-").map(Number);
  return `${DOW_SHORT[dayOfWeek(day)]} ${m}/${d}`;
}

/** "Tuesday, Sep 29" */
export function fmtDayLong(day: Day): string {
  const d = dayToDate(day);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${DOW_LONG[dayOfWeek(day)]}, ${month} ${d.getUTCDate()}`;
}

export function dowShort(dow: number): string {
  return DOW_SHORT[dow];
}

/** 480 → "8:00 AM" */
export function fmtMin(min: number): string {
  if (min >= 1440) return "end of day";
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** 480 → "8a", 690 → "11:30a" (compact, for the board) */
export function fmtMinShort(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h24 < 12 ? "a" : "p"}`;
}

export function fmtRange(startMin: number, endMin: number): string {
  return `${fmtMin(startMin)}–${fmtMin(endMin)}`;
}

/** "08:30" → 510. Returns null for invalid input. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** 510 → "08:30" (for <input type="time">) */
export function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function fmtHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toString()} hr${rounded === 1 ? "" : "s"}`;
}

export function fmtTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: COMPANY_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
