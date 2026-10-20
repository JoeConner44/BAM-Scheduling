"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, OFFICE } from "@/lib/auth";
import { groupEvents, icsTextsFromUpload, mentionedEmployees, parseIcs, type CalendarEvent, type ParseStats } from "@/lib/calendar-import";
import { ensureLocation, projectLabel } from "@/lib/data";
import { db } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocode";
import { planningWindow, replan } from "@/lib/planner/run";
import { getSchedulingSettings } from "@/lib/settings";
import { addDays, dayToDate, fmtDay, today } from "@/lib/time";

/** How far ahead to look in the calendar. */
const IMPORT_MONTHS_AHEAD = 12;
const GEOCODE_AT_ONCE = 8;

/** One block to create: calendar events at the same time for the same job (e.g. the same job on two crew calendars) merge. */
export interface ImportSlot {
  ref: string;
  refs: string[];
  day: string;
  startMin: number;
  endMin: number;
  allDay: boolean;
  text: string;
  calendars: string[];
}

export interface PreviewGroup {
  key: string;
  name: string;
  customer: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  /** Work days it takes (1 unless the notes say otherwise). */
  days: number;
  /** When it may be done. */
  firstDay: string;
  lastDay: string;
  crew: string[];
  calendars: string[];
  slots: ImportSlot[];
  alreadyImported: boolean;
}

export type PreviewResult =
  | { ok: true; fileName: string; calendars: { name: string; events: number }[]; groups: PreviewGroup[]; skipped: ParseStats; fromDay: string; toDay: string }
  | { ok: false; error: string };

/** Google exports a calendar file as e.g. "John Smith_abc123@group.calendar.google.com" or "john@company.com". */
const calendarLabel = (calendar: string) => calendar.replace(/@.*$/, "").replace(/_[a-z0-9]{10,}$/i, "").replace(/[._]+/g, " ").trim();

/** The same job on two calendars at the same time is one entry. */
function toSlots(events: CalendarEvent[]): ImportSlot[] {
  const map = new Map<string, ImportSlot>();
  for (const e of events) {
    const k = `${e.day}|${e.startMin}|${e.endMin}`;
    const slot = map.get(k) ?? { ref: e.ref, refs: [], day: e.day, startMin: e.startMin, endMin: e.endMin, allDay: e.allDay, text: "", calendars: [] };
    if (!slot.refs.includes(e.ref)) slot.refs.push(e.ref);
    slot.ref = [...slot.refs].sort()[0];
    slot.text = [slot.text, e.summary, e.description].filter(Boolean).join("\n");
    if (e.calendar && !slot.calendars.includes(e.calendar)) slot.calendars.push(e.calendar);
    map.set(k, slot);
  }
  return [...map.values()];
}

const crewFor = (slots: ImportSlot[], employees: { id: string; name: string }[]) => [
  ...new Set(slots.flatMap((s) => [...mentionedEmployees(s.text, employees), ...s.calendars.flatMap((c) => mentionedEmployees(calendarLabel(c), employees))])),
];

/** Calendar events already in the app (from this import, or the earlier kind that made locked blocks). */
async function importedRefs(refs: string[]) {
  const [projects, blocks] = await Promise.all([
    db.project.findMany({ where: { externalRefs: { hasSome: refs } }, select: { externalRefs: true } }),
    db.scheduleBlock.findMany({ where: { externalRef: { in: refs } }, select: { externalRef: true } }),
  ]);
  return new Set([...projects.flatMap((p) => p.externalRefs), ...blocks.map((b) => b.externalRef!)]);
}

/** Step 1: read the Google Calendar export and show what would be imported. Nothing is saved yet. */
export async function previewCalendar(form: FormData): Promise<PreviewResult> {
  try {
    await authorize(OFFICE);
    const file = form.get("calendar");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the calendar file first." };
    if (!/\.(ics|zip)$/i.test(file.name)) return { ok: false, error: "That isn't a calendar export. Upload the .zip (or .ics) file Google Calendar gave you." };

    const settings = await getSchedulingSettings();
    const fromDay = today();
    const toDay = addDays(fromDay, IMPORT_MONTHS_AHEAD * 31);
    const files = icsTextsFromUpload(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!files.length) return { ok: false, error: "There are no calendars in that file." };

    const calendars: { name: string; events: number }[] = [];
    const events: CalendarEvent[] = [];
    const skipped: ParseStats = { past: 0, later: 0, cancelled: 0 };
    for (const f of files) {
      const found = parseIcs(f.text, { fromDay, toDay, workdayStartMin: settings.workdayStartMin, workdayEndMin: settings.workdayEndMin, stats: skipped }).map((e) => ({ ...e, calendar: f.calendar }));
      calendars.push({ name: calendarLabel(f.calendar) || f.calendar, events: found.length });
      events.push(...found);
    }

    const employees = await db.employee.findMany({ where: { active: true }, select: { id: true, name: true } });
    const nameOf = new Map(employees.map((e) => [e.id, e.name]));
    const existing = await importedRefs(events.map((e) => e.ref));

    const groups = groupEvents(events).map((g): PreviewGroup => {
      const slots = toSlots(g.events);
      return {
        key: g.key,
        name: g.name,
        customer: g.name,
        street: g.street,
        city: g.city,
        state: g.state,
        zip: g.zip,
        notes: g.notes,
        days: g.days,
        firstDay: g.firstDay,
        lastDay: g.lastDay,
        crew: crewFor(slots, employees).map((id) => nameOf.get(id)!),
        calendars: [...new Set(slots.flatMap((s) => s.calendars.map(calendarLabel)))],
        slots,
        alreadyImported: slots.some((s) => s.refs.some((r) => existing.has(r))),
      };
    });
    return { ok: true, fileName: file.name, calendars, groups, skipped, fromDay, toDay };
  } catch (e) {
    console.error("Calendar preview failed:", e);
    return { ok: false, error: "That file couldn't be read as a calendar. Upload the .zip (or .ics) file exactly as Google Calendar exported it." };
  }
}

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Slot = z.object({
  ref: z.string().min(1).max(500),
  refs: z.array(z.string().max(500)).max(50),
  day: DAY,
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
  allDay: z.boolean(),
  text: z.string().max(20000),
  calendars: z.array(z.string().max(500)).max(50),
});
const Job = z.object({
  name: z.string().trim().min(1).max(200),
  customer: z.string().trim().min(1).max(200),
  street: z.string().trim().max(300),
  city: z.string().trim().max(100),
  state: z.string().trim().length(2),
  zip: z.string().trim().max(10),
  notes: z.string().max(5000),
  days: z.number().int().min(1, "A job takes at least 1 day.").max(30),
  firstDay: DAY,
  lastDay: DAY,
  slots: z.array(Slot).min(1).max(1000),
});

export type ImportState = { error?: string } | undefined;

/**
 * Step 2: create the jobs. Each becomes a job that takes `days` work days and may be done
 * any day from `firstDay` to `lastDay`; the auto-scheduler puts it on the least busy of them.
 * Jobs whose days are all inside the frozen days are booked as the calendar had them.
 * Events imported before are skipped, so importing the same file again is safe.
 */
export async function importCalendar(_prev: ImportState, form: FormData): Promise<ImportState> {
  let user;
  try {
    user = await authorize(OFFICE);
  } catch (e) {
    return { error: (e as Error).message };
  }
  let jobs: z.infer<typeof Job>[];
  try {
    const parsed = z.array(Job).min(1, "Tick at least one job to import.").safeParse(JSON.parse(String(form.get("jobs") ?? "[]")));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something in the list isn't right." };
    jobs = parsed.data;
  } catch {
    return { error: "Something in the list isn't right." };
  }

  const win = await planningWindow();
  const workdayHours = (win.settings.workdayEndMin - win.settings.workdayStartMin) / 60;
  const employees = await db.employee.findMany({ where: { active: true }, select: { id: true, name: true } });
  let created = 0;
  let booked = 0;

  // Look up street addresses a few at a time up front: one by one, a big calendar could time out.
  const addressOf = (job: z.infer<typeof Job>) => (job.street && job.city ? `${job.street}, ${job.city}, ${job.state.toUpperCase()} ${job.zip}`.trim() : null);
  const addresses = [...new Set(jobs.map(addressOf).filter((a): a is string => !!a))];
  const coordsByAddress = new Map<string, { lat: number; lng: number } | null>();
  for (let i = 0; i < addresses.length; i += GEOCODE_AT_ONCE) {
    const batch = addresses.slice(i, i + GEOCODE_AT_ONCE);
    const found = await Promise.all(batch.map((a) => geocodeAddress(a).catch(() => null)));
    batch.forEach((a, j) => coordsByAddress.set(a, found[j]));
  }

  for (const job of jobs) {
    const refs = job.slots.flatMap((s) => [s.ref, ...s.refs]);
    if ((await importedRefs(refs)).size) continue;
    const slots = job.slots.filter((s) => s.day >= win.today);
    if (!slots.length) continue;
    const firstDay = job.firstDay < win.today ? win.today : job.firstDay;
    const lastDay = job.lastDay < firstDay ? firstDay : job.lastDay;
    const crew = crewFor(slots, employees);
    // Too soon for the app to move (frozen days): book it as the calendar had it.
    const frozen = lastDay < win.firstDay;
    const state = job.state.toUpperCase();

    // Calendar events often have only a name; the Inbox asks for the missing address later.
    const address = addressOf(job);
    const coords = address ? (coordsByAddress.get(address) ?? null) : null;
    const location = job.city ? await ensureLocation(job.city, state, coords ?? undefined) : null;
    if (coords && location && location.lat === null) await db.location.update({ where: { id: location.id }, data: coords });
    const customer = await db.customer.upsert({ where: { name: job.customer }, update: {}, create: { name: job.customer } });
    const last = await db.project.findFirst({ where: { code: { startsWith: "P-" } }, orderBy: { code: "desc" } });
    const status = frozen ? "SCHEDULED" : "READY";
    const p = await db.project.create({
      data: {
        code: `P-${last ? Number(last.code.slice(2)) + 1 : 1001}`,
        customerId: customer.id,
        name: job.name,
        street: job.street || null,
        city: location?.city ?? "",
        state: location?.state ?? state,
        zip: job.zip || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        locationId: location?.id ?? null,
        notes: job.notes || null,
        externalRefs: refs,
        estTotalHours: job.days * workdayHours,
        estCrewSize: crew.length || 2,
        requestedDate: dayToDate(firstDay),
        // A span of days on the calendar is the window it may be done in.
        earliestDate: lastDay > firstDay ? dayToDate(firstDay) : null,
        deadline: lastDay > firstDay ? dayToDate(lastDay) : null,
        status,
        acceptedAt: new Date(),
        statusHistory: { create: { toStatus: status, changedById: user.id, reason: "Imported from Google Calendar" } },
        blocks: frozen
          ? {
              create: {
                day: dayToDate(slots[0].day),
                startMin: win.settings.workdayStartMin,
                endMin: win.settings.workdayEndMin,
                state: "COMMITTED",
                pinned: true,
                createdById: user.id,
                assignments: { create: crew.map((employeeId) => ({ employeeId })) },
              },
            }
          : undefined,
      },
    });
    created++;
    if (frozen) booked++;
    const when = lastDay > firstDay ? `any day ${fmtDay(firstDay)}–${fmtDay(lastDay)}` : fmtDay(firstDay);
    await db.auditLog.create({
      data: { actorId: user.id, entityType: "Project", entityId: p.id, action: "IMPORT", summary: `Imported ${projectLabel(p)} from Google Calendar (${job.days} day${job.days === 1 ? "" : "s"}, ${when})` },
    });
  }

  if (created) await replan("calendar import", user.id);
  revalidatePath("/", "layout");
  redirect(`/import?created=${created}&booked=${booked}`);
}

/**
 * Remove the jobs an earlier import created, so the calendar can be imported again with
 * the current rules. Jobs the crew has started or reported on are kept.
 */
export async function removeImportedJobs() {
  const user = await authorize(OFFICE);
  const candidates = await db.project.findMany({
    where: { OR: [{ externalRefs: { isEmpty: false } }, { blocks: { some: { externalRef: { not: null } } } }] },
    select: { id: true, actualHours: true, blocks: { select: { progress: true } }, _count: { select: { conditionReports: true, photos: true } } },
  });
  const removable = candidates.filter((p) => p.actualHours === 0 && p.blocks.every((b) => b.progress === "PLANNED") && !p._count.conditionReports && !p._count.photos);
  if (removable.length) {
    await db.project.deleteMany({ where: { id: { in: removable.map((p) => p.id) } } });
    await db.auditLog.create({
      data: { actorId: user.id, entityType: "Project", entityId: "calendar-import", action: "DELETE", summary: `Removed ${removable.length} job${removable.length === 1 ? "" : "s"} imported from Google Calendar` },
    });
    await replan("imported jobs removed", user.id);
  }
  revalidatePath("/", "layout");
  redirect(`/import?removed=${removable.length}&kept=${candidates.length - removable.length}`);
}
