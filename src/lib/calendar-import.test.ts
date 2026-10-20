import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { daysNoted, groupEvents, icsTextsFromUpload, mentionedEmployees, parseAddress, parseIcs } from "./calendar-import";

// Shaped like a Google Calendar export.
const ICS = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
X-WR-CALNAME:BAM Jobs
X-WR-TIMEZONE:America/New_York
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261021T080000
DTEND;TZID=America/New_York:20261021T110000
UID:kroger1@google.com
SUMMARY:Kroger Athens - John & David
LOCATION:1720 Epps Bridge Pkwy, Athens, GA 30606, USA
DESCRIPTION:Restripe 220 stalls
END:VEVENT
BEGIN:VEVENT
DTSTART:20261022T120000Z
DTEND:20261022T150000Z
UID:kroger2@google.com
SUMMARY:Kroger Athens - John & David
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261023
DTEND;VALUE=DATE:20261027
UID:school@google.com
SUMMARY:Maple Creek MS thermo
LOCATION:Lawrenceville
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261020T070000
DTEND;TZID=America/New_York:20261020T090000
RRULE:FREQ=WEEKLY;COUNT=3
UID:weekly@google.com
SUMMARY:Publix sweep
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261027T100000
DTEND;TZID=America/New_York:20261027T120000
RECURRENCE-ID;TZID=America/New_York:20261027T070000
UID:weekly@google.com
SUMMARY:Publix sweep
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20261021T130000
DTEND;TZID=America/New_York:20261021T140000
UID:cancelled@google.com
STATUS:CANCELLED
SUMMARY:Cancelled thing
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20250101T080000
DTEND;TZID=America/New_York:20250101T090000
UID:old@google.com
SUMMARY:Old job
END:VEVENT
END:VCALENDAR`;

const opts = { fromDay: "2026-10-19", toDay: "2027-04-19", workdayStartMin: 420, workdayEndMin: 1050 };

describe("Google Calendar import", () => {
  const events = parseIcs(ICS, opts);

  it("reads timed events in local time (including UTC ones)", () => {
    const kroger = events.filter((e) => e.summary.startsWith("Kroger"));
    expect(kroger.map((e) => [e.day, e.startMin, e.endMin])).toEqual([
      ["2026-10-21", 480, 660],
      ["2026-10-22", 480, 660], // 12:00 UTC = 8:00 AM EDT
    ]);
  });

  it("turns all-day events into workdays, skipping the weekend", () => {
    const school = events.filter((e) => e.summary.startsWith("Maple"));
    expect(school.map((e) => e.day)).toEqual(["2026-10-23", "2026-10-26"]); // Fri, (Sat/Sun skipped), Mon
    expect(school.every((e) => e.allDay && e.startMin === 420 && e.endMin === 1050)).toBe(true);
  });

  it("expands repeating events and applies moved occurrences", () => {
    const publix = events.filter((e) => e.summary === "Publix sweep");
    expect(publix.map((e) => [e.day, e.startMin])).toEqual([
      ["2026-10-20", 420],
      ["2026-10-27", 600], // this one was moved to 10 AM
      ["2026-11-03", 420],
    ]);
    expect(new Set(publix.map((e) => e.ref)).size).toBe(3);
  });

  it("skips cancelled and old events", () => {
    expect(events.some((e) => e.summary === "Cancelled thing" || e.summary === "Old job")).toBe(false);
  });

  it("makes each event a one-day job; a span of days is when it may be done", () => {
    const groups = groupEvents(events);
    const krogers = groups.filter((g) => g.name.startsWith("Kroger"));
    expect(krogers.length).toBeGreaterThan(0);
    expect(krogers[0]).toMatchObject({ street: "1720 Epps Bridge Pkwy", city: "Athens", state: "GA", zip: "30606", notes: "Restripe 220 stalls" });
    expect(groups.find((g) => g.name.startsWith("Maple"))).toMatchObject({ city: "Lawrenceville", street: "" });

    const ev = (summary: string, day: string, description = "") => ({ ref: `${summary}#${day}`, summary, location: "", description, day, startMin: 480, endMin: 600, allDay: false });
    const jobs = groupEvents([
      ev("Publix", "2026-10-26"), // Mon
      ev("Publix", "2026-11-09"), // two weeks later: a separate visit
      ev("Walmart", "2026-10-30"), // Fri …
      ev("Walmart", "2026-11-02"), // … and Mon: back-to-back, one job
      ev("School lot", "2026-10-27", "Sealcoat, 3 days"),
    ]);
    expect(jobs.map((j) => [j.name, j.firstDay, j.lastDay, j.days])).toEqual([
      ["Publix", "2026-10-26", "2026-10-26", 1],
      ["School lot", "2026-10-27", "2026-10-27", 3],
      ["Walmart", "2026-10-30", "2026-11-02", 1],
      ["Publix", "2026-11-09", "2026-11-09", 1],
    ]);
    expect(daysNoted("2-day job")).toBe(2);
    expect(daysNoted("two days")).toBe(2);
    expect(daysNoted("Kroger 220 stalls")).toBeNull();
  });

  it("parses addresses and finds crew names", () => {
    expect(parseAddress("316 N Broad St\nWinder, GA 30680")).toEqual({ street: "316 N Broad St", city: "Winder", state: "GA", zip: "30680" });
    expect(parseAddress("Kroger, Watkinsville")).toEqual({ street: "Kroger", city: "Watkinsville", state: "", zip: "" });
    expect(mentionedEmployees("Kroger Athens - John & David", [{ id: "1", name: "John" }, { id: "2", name: "David" }, { id: "3", name: "Jo" }])).toEqual(["1", "2"]);
  });

  it("reads Google's .zip export with several calendars", () => {
    const zip = zipSync({ "Takeout/Calendar/BAM Jobs.ics": strToU8(ICS), "Takeout/Calendar/Holidays.ics": strToU8("BEGIN:VCALENDAR\nEND:VCALENDAR"), "readme.txt": strToU8("x") });
    expect(icsTextsFromUpload("calendar.zip", zip).map((f) => f.calendar)).toEqual(["BAM Jobs", "Holidays"]);
  });
});
