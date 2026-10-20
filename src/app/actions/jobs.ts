"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EquipmentType, Priority, WeatherSensitivity } from "@prisma/client";
import { authorize, OFFICE } from "@/lib/auth";
import { ensureLocation, projectLabel } from "@/lib/data";
import { db } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocode";
import { EQUIPMENT_TYPE_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import { replan } from "@/lib/planner/run";
import { saveFile } from "@/lib/storage";
import { dayToDate, fmtDay, isDay, today } from "@/lib/time";
import { readWorkOrder, workOrderFileError, workOrderReadingEnabled, type WorkOrderFields } from "@/lib/workorder";

const ACCEPTERS = ["OWNER", "DISPATCHER", "ESTIMATOR"] as const;

export type ExtractResult = { ok: true; fields: WorkOrderFields; fileKey: string } | { ok: false; error: string; fileKey?: string };

/** Step 1 of accepting a job: upload the work order and let the app read it. */
export async function extractWorkOrder(form: FormData): Promise<ExtractResult> {
  try {
    await authorize([...ACCEPTERS]);
    const file = form.get("workOrder");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the work order file first." };
    const problem = workOrderFileError(file);
    if (problem) return { ok: false, error: problem };
    const fileKey = await saveFile(file);
    if (!workOrderReadingEnabled()) {
      return { ok: false, fileKey, error: "Automatic reading isn't switched on yet (the ANTHROPIC_API_KEY setting is missing). The work order is attached; fill in the job below." };
    }
    const jobTypes = (await db.jobType.findMany({ orderBy: { name: "asc" } })).map((j) => j.name);
    const fields = await readWorkOrder(file, jobTypes, today());
    return { ok: true, fields, fileKey };
  } catch (e) {
    console.error("Work order reading failed:", e);
    return { ok: false, error: "The work order couldn't be read automatically. Fill in the job below." };
  }
}

export type AcceptState = { error?: string } | undefined;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
const day = (f: FormData, k: string) => {
  const v = str(f, k);
  return v && isDay(v) ? dayToDate(v) : null;
};

/** Step 2: the estimator checks the details and marks the job accepted. The scheduler takes it from here. */
export async function acceptJob(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  let user;
  try {
    user = await authorize([...ACCEPTERS]);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const customerName = str(form, "customer");
  const name = str(form, "name");
  const city = str(form, "city");
  const state = (str(form, "state") ?? "GA").toUpperCase().slice(0, 2);
  const hours = num(form, "estTotalHours");
  if (!customerName || !name || !city || hours === null || hours <= 0) {
    return { error: "Customer, job name, city and estimated hours are needed." };
  }

  const street = str(form, "street");
  const zip = str(form, "zip");
  const coords = street ? await geocodeAddress(`${street}, ${city}, ${state} ${zip ?? ""}`.trim()) : null;
  const location = await ensureLocation(city, state, coords ?? undefined);
  if (coords && location.lat === null) await db.location.update({ where: { id: location.id }, data: coords });
  const customer = await db.customer.upsert({ where: { name: customerName }, update: {}, create: { name: customerName } });
  const jobTypeName = str(form, "jobType");
  const jobType = jobTypeName ? await db.jobType.upsert({ where: { name: jobTypeName }, update: {}, create: { name: jobTypeName } }) : null;

  const names = form.getAll("materialName").map(String);
  const qtys = form.getAll("materialQty").map(String);
  const units = form.getAll("materialUnit").map(String);
  const materials = names
    .map((n, i) => ({ name: n.trim(), quantity: qtys[i]?.trim() ? Number(qtys[i]) : null, unit: units[i]?.trim() || null, sortOrder: i }))
    .filter((m) => m.name && (m.quantity === null || Number.isFinite(m.quantity)));
  const equipment = (Object.keys(EQUIPMENT_TYPE_LABEL) as EquipmentType[]).map((type) => ({ type, quantity: num(form, `equip_${type}`) ?? 0 })).filter((e) => e.quantity > 0);
  const priority = (str(form, "priority") ?? "NORMAL") as Priority;
  const requestedDate = day(form, "requestedDate");

  const last = await db.project.findFirst({ where: { code: { startsWith: "P-" } }, orderBy: { code: "desc" } });
  const code = `P-${last ? Number(last.code.slice(2)) + 1 : 1001}`;

  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        code,
        customerId: customer.id,
        name,
        workOrderNumber: str(form, "workOrderNumber"),
        workOrderFileKey: str(form, "workOrderFileKey"),
        contactName: str(form, "contactName"),
        contactPhone: str(form, "contactPhone"),
        contactEmail: str(form, "contactEmail"),
        street,
        city: location.city,
        state: location.state,
        zip,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        locationId: location.id,
        jobTypeId: jobType?.id ?? null,
        scope: str(form, "scope"),
        notes: str(form, "notes"),
        estTotalHours: hours,
        estCrewSize: Math.max(1, Math.round(num(form, "estCrewSize") ?? 2)),
        deadline: day(form, "deadline"),
        requestedDate,
        priority: priority in PRIORITY_LABEL ? priority : "NORMAL",
        weatherSensitivity: (str(form, "weatherSensitivity") ?? "HIGH") as WeatherSensitivity,
        status: "READY",
        acceptedAt: new Date(),
        materials: { create: materials },
        requiredEquipment: { create: equipment },
        statusHistory: { create: { toStatus: "READY", changedById: user.id, reason: "Job accepted" } },
      },
    });
    await tx.auditLog.create({
      data: { actorId: user.id, entityType: "Project", entityId: p.id, action: "ACCEPT", summary: `Accepted job ${name} — ${location.city}${requestedDate ? ` (requested ${fmtDay(requestedDate.toISOString().slice(0, 10))})` : ""}` },
    });
    return p;
  });

  await replan("job accepted", user.id);
  revalidatePath("/", "layout");
  redirect(`/jobs/new?accepted=${project.id}`);
}

/** The scheduler records the customer's requested date; the auto-scheduler aims for it. */
export async function setRequestedDate(form: FormData) {
  const user = await authorize(OFFICE);
  const projectId = String(form.get("projectId"));
  const value = String(form.get("requestedDate") ?? "");
  if (!isDay(value)) return;
  const p = await db.project.update({ where: { id: projectId }, data: { requestedDate: dayToDate(value) } });
  await db.auditLog.create({
    data: { actorId: user.id, entityType: "Project", entityId: projectId, action: "REQUESTED_DATE", summary: `Requested date for ${projectLabel(p)}: ${fmtDay(value)}` },
  });
  await replan("requested date set", user.id);
  revalidatePath("/", "layout");
}

export async function dismissAlert(form: FormData) {
  await authorize(OFFICE);
  await db.alert.update({ where: { id: String(form.get("alertId")) }, data: { dismissedAt: new Date() } });
  revalidatePath("/", "layout");
}

/** "Re-plan now": fetch fresh weather (if stale) and rebuild the auto-schedule. */
export async function replanFromInbox() {
  const user = await authorize(OFFICE);
  const { refreshWeather } = await import("@/lib/weather/refresh");
  await refreshWeather();
  await replan("re-plan requested", user.id);
  revalidatePath("/", "layout");
}
