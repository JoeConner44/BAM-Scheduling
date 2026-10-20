"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, OFFICE } from "@/lib/auth";
import { groupEvents, icsTextsFromUpload, mentionedEmployees, parseIcs, type CalendarEvent } from "@/lib/calendar-import";
import { ensureLocation, projectLabel } from "@/lib/data";
import { db } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocode";
import { replan } from "@/lib/planner/run";
import { getSchedulingSettings } from "@/lib/settings";
import { addDays, dayToDate, today } from "@/lib/time";

/** How far ahead to look in the calendar. */
const IMPORT_MONTHS_AHEAD = 12;

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
  hours: number;
  crew: string[];
  calendars: string[];
  slots: ImportSlot[];
  /** Slots already in the app from an earlier import. */
  alreadyImported: number;
}

export type PreviewResult =
  | { ok: true; fileName: string; calendars: { name: string; events: number }[]; groups: PreviewGroup[]; fromDay: string; toDay: string }
  | { ok: false; error: string };

/** Google exports a calendar file as e.g. "John Smith_abc123@group.calendar.google.com" or "john@company.com". */
const calendarLabel = (calendar: string) => calendar.replace(/@.*$/, "").replace(/_[a-z0-9]{10,}$/i, "").replace(/[._]+/g, " ").trim();

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

const crewFor = (slot: ImportSlot, employees: { id: string; name: string }[]) => [
  ...new Set([...mentionedEmployees(slot.text, employees), ...slot.calendars.flatMap((c) => mentionedEmployees(calendarLabel(c), employees))]),
];

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
    for (const f of files) {
      const found = parseIcs(f.text, { fromDay, toDay, workdayStartMin: settings.workdayStartMin, workdayEndMin: settings.workdayEndMin }).map((e) => ({ ...e, calendar: f.calendar }));
      calendars.push({ name: calendarLabel(f.calendar) || f.calendar, events: found.length });
      events.push(...found);
    }

    const employees = await db.employee.findMany({ where: { active: true }, select: { id: true, name: true } });
    const nameOf = new Map(employees.map((e) => [e.id, e.name]));
    const existing = new Set(
      (await db.scheduleBlock.findMany({ where: { externalRef: { in: events.map((e) => e.ref) } }, select: { externalRef: true } })).map((b) => b.externalRef),
    );

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
        hours: Math.round(slots.reduce((s, x) => s + (x.endMin - x.startMin) / 60, 0) * 4) / 4,
        crew: [...new Set(slots.flatMap((s) => crewFor(s, employees)))].map((id) => nameOf.get(id)!),
        calendars: [...new Set(slots.flatMap((s) => s.calendars.map(calendarLabel)))],
        slots,
        alreadyImported: slots.filter((s) => s.refs.some((r) => existing.has(r))).length,
      };
    });
    return { ok: true, fileName: file.name, calendars, groups, fromDay, toDay };
  } catch (e) {
    console.error("Calendar preview failed:", e);
    return { ok: false, error: "That file couldn't be read as a calendar. Upload the .zip (or .ics) file exactly as Google Calendar exported it." };
  }
}

const Slot = z.object({
  ref: z.string().min(1).max(500),
  refs: z.array(z.string().max(500)).max(50),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  slots: z.array(Slot).min(1).max(1000),
});

export type ImportState = { error?: string } | undefined;

/**
 * Step 2: create the jobs. Each calendar event becomes a locked, committed block (the
 * auto-scheduler never moves it; it only warns about rain or double-booking).
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

  const employees = await db.employee.findMany({ where: { active: true }, select: { id: true, name: true } });
  let created = 0;
  let updated = 0;
  let blocks = 0;
  const start = today();

  for (const job of jobs) {
    const allRefs = job.slots.flatMap((s) => [s.ref, ...s.refs]);
    const existing = await db.scheduleBlock.findMany({ where: { externalRef: { in: allRefs } }, select: { externalRef: true, projectId: true } });
    const done = new Set(existing.map((b) => b.externalRef));
    const slots = job.slots.filter((s) => s.endMin > s.startMin && s.day >= start && ![s.ref, ...s.refs].some((r) => done.has(r)));
    if (!slots.length) continue;
    const hours = slots.reduce((s, x) => s + (x.endMin - x.startMin) / 60, 0);
    const state = job.state.toUpperCase();

    let projectId = existing[0]?.projectId;
    if (projectId) {
      await db.project.update({ where: { id: projectId }, data: { estTotalHours: { increment: hours } } });
      updated++;
    } else {
      // Calendar events often have only a name; the Inbox asks for the missing address later.
      const coords = job.street && job.city ? await geocodeAddress(`${job.street}, ${job.city}, ${state} ${job.zip}`.trim()) : null;
      const location = job.city ? await ensureLocation(job.city, state, coords ?? undefined) : null;
      if (coords && location && location.lat === null) await db.location.update({ where: { id: location.id }, data: coords });
      const customer = await db.customer.upsert({ where: { name: job.customer }, update: {}, create: { name: job.customer } });
      const last = await db.project.findFirst({ where: { code: { startsWith: "P-" } }, orderBy: { code: "desc" } });
      const firstDay = slots.map((s) => s.day).sort()[0];
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
          estTotalHours: Math.round(hours * 4) / 4,
          estCrewSize: 2,
          requestedDate: dayToDate(firstDay),
          status: "SCHEDULED",
          acceptedAt: new Date(),
          statusHistory: { create: { toStatus: "SCHEDULED", changedById: user.id, reason: "Imported from Google Calendar" } },
        },
      });
      projectId = p.id;
      created++;
    }

    for (const s of slots) {
      await db.scheduleBlock.create({
        data: {
          projectId,
          day: dayToDate(s.day),
          startMin: s.startMin,
          endMin: s.endMin,
          state: "COMMITTED",
          pinned: true,
          externalRef: s.ref,
          createdById: user.id,
          assignments: { create: crewFor(s, employees).map((employeeId) => ({ employeeId })) },
        },
      });
      blocks++;
    }
    await db.auditLog.create({
      data: { actorId: user.id, entityType: "Project", entityId: projectId, action: "IMPORT", summary: `Imported ${projectLabel(job)} from Google Calendar (${slots.length} day${slots.length === 1 ? "" : "s"})` },
    });
  }

  if (blocks) await replan("calendar import", user.id);
  revalidatePath("/", "layout");
  redirect(`/import?created=${created}&updated=${updated}&blocks=${blocks}`);
}
