"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EquipmentType, Prisma, Priority, ProjectStatus, WeatherSensitivity } from "@prisma/client";
import { authorize, OFFICE } from "@/lib/auth";
import { ensureLocation } from "@/lib/data";
import { db } from "@/lib/db";
import { EQUIPMENT_TYPE_LABEL, PRIORITY_LABEL, PROJECT_STATUS_LABEL, WEATHER_SENSITIVITY_LABEL } from "@/lib/labels";
import { setProjectStatus, syncProjectStatus } from "@/lib/status";
import { savePhoto } from "@/lib/storage";
import { dayToDate, isDay } from "@/lib/time";

export type FormState = { error?: string; ok?: boolean } | undefined;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (f: FormData, k: string) => {
  const v = str(f, k);
  return v && isDay(v) ? dayToDate(v) : null;
};
const oneOf = <T extends string>(labels: Record<string, string>, v: string | null, fallback: T): T => (v && v in labels ? (v as T) : fallback);

async function nextProjectCode() {
  const last = await db.project.findFirst({ where: { code: { startsWith: "P-" } }, orderBy: { code: "desc" } });
  const n = last ? Number(last.code.slice(2)) + 1 : 1001;
  return `P-${n}`;
}

/** Create or update a project from the project form. */
export async function saveProject(_prev: FormState, form: FormData): Promise<FormState> {
  let user;
  try {
    user = await authorize(OFFICE);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const id = str(form, "id");
  const customerName = str(form, "customer");
  const name = str(form, "name");
  const city = str(form, "city");
  const state = (str(form, "state") ?? "GA").toUpperCase();
  const estTotalHours = num(form, "estTotalHours");
  if (!customerName || !name || !city || estTotalHours === null || estTotalHours <= 0) {
    return { error: "Customer, project name, city and estimated hours are required." };
  }

  const lat = num(form, "lat");
  const lng = num(form, "lng");
  const location = await ensureLocation(city, state, { lat, lng });
  const customer = await db.customer.upsert({ where: { name: customerName }, update: {}, create: { name: customerName } });
  const jobTypeName = str(form, "jobType");
  const jobType = jobTypeName ? await db.jobType.upsert({ where: { name: jobTypeName }, update: {}, create: { name: jobTypeName } }) : null;

  const skills = form.getAll("skills").map(String);
  const requiredSkills = skills.map((skillId) => ({ skillId, minCount: Math.max(1, num(form, `skillCount_${skillId}`) ?? 1) }));
  const requiredEquipment = (Object.keys(EQUIPMENT_TYPE_LABEL) as EquipmentType[])
    .map((type) => ({ type, quantity: num(form, `equip_${type}`) ?? 0 }))
    .filter((r) => r.quantity > 0);

  const remaining = num(form, "remainingHoursOverride");
  const data = {
    customerId: customer.id,
    name,
    contactName: str(form, "contactName"),
    contactPhone: str(form, "contactPhone"),
    contactEmail: str(form, "contactEmail"),
    street: str(form, "street"),
    city: location.city,
    state: location.state,
    zip: str(form, "zip"),
    lat,
    lng,
    locationId: location.id,
    jobTypeId: jobType?.id ?? null,
    scope: str(form, "scope"),
    estTotalHours,
    estCrewSize: Math.max(1, num(form, "estCrewSize") ?? 2),
    earliestDate: date(form, "earliestDate"),
    preferredDate: date(form, "preferredDate"),
    deadline: date(form, "deadline"),
    inspectionDate: date(form, "inspectionDate"),
    priority: oneOf<Priority>(PRIORITY_LABEL, str(form, "priority"), "NORMAL"),
    weatherSensitivity: oneOf<WeatherSensitivity>(WEATHER_SENSITIVITY_LABEL, str(form, "weatherSensitivity"), "LOW"),
    surfaceReady: form.get("surfaceReady") === "on",
    customerReady: form.get("customerReady") === "on",
    notes: str(form, "notes"),
    percentComplete: Math.min(100, Math.max(0, num(form, "percentComplete") ?? 0)),
    actualHours: Math.max(0, num(form, "actualHours") ?? 0),
    remainingHoursOverride: remaining === null ? null : Math.max(0, remaining),
  } satisfies Prisma.ProjectUncheckedUpdateInput;
  const status = oneOf<ProjectStatus>(PROJECT_STATUS_LABEL, str(form, "status"), "TO_DO");

  let projectId: string;
  if (id) {
    const before = await db.project.findUnique({ where: { id } });
    if (!before) return { error: "Project not found." };
    await db.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: {
          ...data,
          requiredSkills: { deleteMany: {}, create: requiredSkills },
          requiredEquipment: { deleteMany: {}, create: requiredEquipment },
        },
      });
      if (status !== before.status) await setProjectStatus(tx, id, before.status, status, user.id, "Edited by office");
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          entityType: "Project",
          entityId: id,
          action: "UPDATE",
          summary: `Edited project ${name} — ${location.city}`,
          before: before as unknown as Prisma.InputJsonValue,
          after: { ...data, status } as unknown as Prisma.InputJsonValue,
        },
      });
      await syncProjectStatus(tx, id, user.id);
    });
    projectId = id;
  } else {
    const created = await db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          ...data,
          code: await nextProjectCode(),
          status,
          requiredSkills: { create: requiredSkills },
          requiredEquipment: { create: requiredEquipment },
          statusHistory: { create: { toStatus: status, changedById: user.id, reason: "Created" } },
        },
      });
      await tx.auditLog.create({
        data: { actorId: user.id, entityType: "Project", entityId: p.id, action: "CREATE", summary: `Added project ${name} — ${location.city} (${PRIORITY_LABEL[data.priority]} priority)` },
      });
      return p;
    });
    projectId = created.id;
  }
  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}`);
}

export async function changeProjectStatus(form: FormData) {
  const user = await authorize(OFFICE);
  const id = String(form.get("projectId"));
  const status = oneOf<ProjectStatus>(PROJECT_STATUS_LABEL, str(form, "status"), "TO_DO");
  const reason = str(form, "reason");
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  if (project.status === status) return;
  await db.$transaction(async (tx) => {
    await setProjectStatus(tx, id, project.status, status, user.id, reason);
    if (status === "COMPLETE") await tx.project.update({ where: { id }, data: { percentComplete: 100, remainingHoursOverride: 0 } });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        entityType: "Project",
        entityId: id,
        action: "STATUS",
        summary: `${project.name} — ${project.city}: ${PROJECT_STATUS_LABEL[project.status]} → ${PROJECT_STATUS_LABEL[status]}`,
        reason,
      },
    });
  });
  revalidatePath("/", "layout");
}

/** Notes can be added by anyone who can see the project (office, or field crew on the job). */
export async function addProjectNote(form: FormData) {
  const user = await authorize();
  const projectId = String(form.get("projectId"));
  const body = str(form, "body");
  if (!body) return;
  await assertCanTouchProject(user, projectId);
  await db.projectNote.create({ data: { projectId, blockId: str(form, "blockId"), authorId: user.id, body, kind: form.get("kind") === "DELAY" ? "DELAY" : "NOTE" } });
  revalidatePath("/", "layout");
}

export async function uploadProjectPhoto(form: FormData) {
  const user = await authorize();
  const projectId = String(form.get("projectId"));
  await assertCanTouchProject(user, projectId);
  const files = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    const fileKey = await savePhoto(file);
    await db.projectPhoto.create({ data: { projectId, blockId: str(form, "blockId"), uploadedById: user.id, fileKey, caption: str(form, "caption") } });
  }
  revalidatePath("/", "layout");
}

export async function deleteProject(form: FormData) {
  const user = await authorize(["OWNER"]);
  const id = String(form.get("projectId"));
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  await db.$transaction([
    db.project.delete({ where: { id } }),
    db.auditLog.create({ data: { actorId: user.id, entityType: "Project", entityId: id, action: "DELETE", summary: `Deleted project ${project.name} — ${project.city}` } }),
  ]);
  revalidatePath("/", "layout");
  redirect("/todo");
}

/** Field users may only touch projects they're assigned to. */
async function assertCanTouchProject(user: Awaited<ReturnType<typeof authorize>>, projectId: string) {
  if (user.role !== "FIELD") return;
  const assigned = await db.assignment.findFirst({ where: { employeeId: user.employeeId ?? "__none__", block: { projectId } } });
  if (!assigned) throw new Error("You're not assigned to this project.");
}
