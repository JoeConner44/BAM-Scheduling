"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EmployeeStatus, EquipmentStatus, EquipmentType, Prisma, TimeOffType } from "@prisma/client";
import { authorize, OFFICE } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYEE_STATUS_LABEL, EQUIPMENT_STATUS_LABEL, EQUIPMENT_TYPE_LABEL, TIME_OFF_LABEL } from "@/lib/labels";
import { dayToDate, fmtDay, fmtRange, isDay, parseHHMM, today } from "@/lib/time";
import type { FormState } from "./projects";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

// ───────────────────────── Employees ─────────────────────────

export async function saveEmployee(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await authorize(OFFICE);
  const id = str(form, "id");
  const name = str(form, "name");
  if (!name) return { error: "Name is required." };
  const normalStartMin = parseHHMM(str(form, "normalStart") ?? "07:00") ?? 420;
  const normalEndMin = parseHHMM(str(form, "normalEnd") ?? "17:30") ?? 1050;
  if (normalEndMin <= normalStartMin) return { error: "Normal hours: end must be after start." };
  const workDays = form.getAll("workDays").map(Number).filter((d) => d >= 0 && d <= 6);
  const skillIds = form.getAll("skills").map(String);
  const certs = new Set(form.getAll("certs").map(String));
  const status = (str(form, "status") ?? "AVAILABLE") as EmployeeStatus;
  if (!(status in EMPLOYEE_STATUS_LABEL)) return { error: "Invalid status." };

  const data = {
    name,
    phone: str(form, "phone"),
    position: str(form, "position"),
    color: str(form, "color") ?? "#2563eb",
    normalStartMin,
    normalEndMin,
    workDays,
    status,
    active: form.get("active") !== "off",
  };
  const skills = skillIds.map((skillId) => ({ skillId, isCertification: certs.has(skillId) }));

  const saved = await db.$transaction(async (tx) => {
    const e = id
      ? await tx.employee.update({ where: { id }, data: { ...data, skills: { deleteMany: {}, create: skills } } })
      : await tx.employee.create({ data: { ...data, skills: { create: skills } } });
    await tx.auditLog.create({
      data: { actorId: user.id, entityType: "Employee", entityId: e.id, action: id ? "UPDATE" : "CREATE", summary: `${id ? "Updated" : "Added"} employee ${name}` },
    });
    // Every employee gets a field login (phone + PIN in phase 2).
    if (!id) await tx.user.create({ data: { name, phone: data.phone, role: "FIELD", employeeId: e.id } });
    // Keep the crew member's phone login in step (name, and off when they leave).
    else await tx.user.updateMany({ where: { employeeId: e.id }, data: { name, active: data.active } });
    return e;
  });
  revalidatePath("/", "layout");
  redirect(`/employees/${saved.id}`);
}

/** Mark someone off. Returns the scheduled work this affects so the office can react. */
export type TimeOffState = { error?: string; ok?: boolean; affected?: string[] } | undefined;

export async function addTimeOff(_prev: TimeOffState, form: FormData): Promise<TimeOffState> {
  const user = await authorize(OFFICE);
  const employeeId = String(form.get("employeeId"));
  const startDay = str(form, "startDay");
  const endDay = str(form, "endDay") ?? startDay;
  const type = (str(form, "type") ?? "OFF") as TimeOffType;
  if (!startDay || !endDay || !isDay(startDay) || !isDay(endDay) || endDay < startDay) return { error: "Pick a valid date range." };
  if (!(type in TIME_OFF_LABEL)) return { error: "Invalid type." };
  const partial = form.get("partial") === "on";
  const startMin = partial ? parseHHMM(str(form, "startTime") ?? "") : null;
  const endMin = partial ? parseHHMM(str(form, "endTime") ?? "") : null;
  if (partial && (startMin === null || endMin === null || endMin <= startMin)) return { error: "Pick valid times for the partial day." };

  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const affected = await db.scheduleBlock.findMany({
    where: {
      day: { gte: dayToDate(startDay), lte: dayToDate(endDay) },
      progress: { not: "DONE" },
      assignments: { some: { employeeId } },
      ...(partial ? { startMin: { lt: endMin! }, endMin: { gt: startMin! } } : {}),
    },
    include: { project: true },
    orderBy: [{ day: "asc" }, { startMin: "asc" }],
  });

  const range = startDay === endDay ? fmtDay(startDay) : `${fmtDay(startDay)}–${fmtDay(endDay)}`;
  await db.$transaction([
    db.timeOff.create({
      data: {
        employeeId,
        startDay: dayToDate(startDay),
        endDay: dayToDate(endDay),
        startMin,
        endMin,
        type,
        note: str(form, "note"),
        createdById: user.id,
      },
    }),
    db.auditLog.create({
      data: {
        actorId: user.id,
        entityType: "Employee",
        entityId: employeeId,
        action: "TIME_OFF",
        summary: `Marked ${employee.name} ${TIME_OFF_LABEL[type].toLowerCase()} ${range}${partial ? ` ${fmtRange(startMin!, endMin!)}` : ""}${affected.length ? ` — affects ${affected.length} scheduled job(s)` : ""}`,
        reason: str(form, "note"),
      },
    }),
  ]);
  revalidatePath("/", "layout");
  return {
    ok: true,
    affected: affected.map((b) => `${b.project.name} — ${b.project.city}, ${fmtDay(b.day.toISOString().slice(0, 10))} ${fmtRange(b.startMin, b.endMin)}`),
  };
}

export async function deleteTimeOff(form: FormData) {
  const user = await authorize(OFFICE);
  const id = String(form.get("id"));
  const t = await db.timeOff.findUniqueOrThrow({ where: { id }, include: { employee: true } });
  await db.$transaction([
    db.timeOff.delete({ where: { id } }),
    db.auditLog.create({
      data: { actorId: user.id, entityType: "Employee", entityId: t.employeeId, action: "TIME_OFF_REMOVED", summary: `Removed time off for ${t.employee.name} (${TIME_OFF_LABEL[t.type]})` },
    }),
  ]);
  revalidatePath("/", "layout");
}

/** One-tap "sick today" from the people list. */
export async function markSickToday(form: FormData) {
  const fd = new FormData();
  const t = today();
  fd.set("employeeId", String(form.get("employeeId")));
  fd.set("startDay", t);
  fd.set("endDay", t);
  fd.set("type", "SICK");
  fd.set("note", "Called in sick");
  await addTimeOff(undefined, fd);
}

// ───────────────────────── Equipment ─────────────────────────

export async function saveEquipment(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await authorize(OFFICE);
  const id = str(form, "id");
  const name = str(form, "name");
  const unitCode = str(form, "unitCode");
  const type = str(form, "type") as EquipmentType | null;
  const status = (str(form, "status") ?? "AVAILABLE") as EquipmentStatus;
  if (!name || !unitCode || !type || !(type in EQUIPMENT_TYPE_LABEL)) return { error: "Name, equipment ID and type are required." };
  if (!(status in EQUIPMENT_STATUS_LABEL)) return { error: "Invalid status." };
  const clash = await db.equipment.findFirst({ where: { unitCode, NOT: id ? { id } : undefined } });
  if (clash) return { error: `Equipment ID ${unitCode} is already used by ${clash.name}.` };

  const data = {
    name,
    unitCode,
    type,
    status,
    maintenanceNote: str(form, "maintenanceNote"),
    currentLocationId: str(form, "locationId"),
    color: str(form, "color") ?? "#475569",
    active: form.get("active") !== "off",
  };
  const before = id ? await db.equipment.findUnique({ where: { id } }) : null;
  const saved = await db.$transaction(async (tx) => {
    const e = id ? await tx.equipment.update({ where: { id }, data }) : await tx.equipment.create({ data });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        entityType: "Equipment",
        entityId: e.id,
        action: id ? "UPDATE" : "CREATE",
        summary:
          before && before.status !== status
            ? `${name}: ${EQUIPMENT_STATUS_LABEL[before.status]} → ${EQUIPMENT_STATUS_LABEL[status]}`
            : `${id ? "Updated" : "Added"} equipment ${name}`,
        reason: data.maintenanceNote,
        before: (before ?? undefined) as unknown as Prisma.InputJsonValue,
      },
    });
    return e;
  });
  revalidatePath("/", "layout");
  redirect(`/equipment/${saved.id}`);
}

export async function addDowntime(form: FormData) {
  const user = await authorize(OFFICE);
  const equipmentId = String(form.get("equipmentId"));
  const startDay = str(form, "startDay");
  const endDay = str(form, "endDay") ?? startDay;
  if (!startDay || !endDay || !isDay(startDay) || !isDay(endDay) || endDay < startDay) return;
  const eq = await db.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
  await db.$transaction([
    db.equipmentDowntime.create({ data: { equipmentId, startDay: dayToDate(startDay), endDay: dayToDate(endDay), reason: str(form, "reason") } }),
    db.auditLog.create({
      data: {
        actorId: user.id,
        entityType: "Equipment",
        entityId: equipmentId,
        action: "DOWNTIME",
        summary: `Scheduled maintenance for ${eq.name}: ${startDay === endDay ? fmtDay(startDay) : `${fmtDay(startDay)}–${fmtDay(endDay)}`}`,
        reason: str(form, "reason"),
      },
    }),
  ]);
  revalidatePath("/", "layout");
}

export async function deleteDowntime(form: FormData) {
  await authorize(OFFICE);
  await db.equipmentDowntime.delete({ where: { id: String(form.get("id")) } });
  revalidatePath("/", "layout");
}

// ───────────────────────── Office logins & skills ─────────────────────────

/** Owner only: add an office login (another owner or a dispatcher). Crew logins come with each employee. */
export async function addOfficeUser(form: FormData) {
  const user = await authorize(["OWNER"]);
  const name = str(form, "name");
  const role = str(form, "role") === "OWNER" ? "OWNER" : "DISPATCHER";
  if (!name) return;
  await db.$transaction([
    db.user.create({ data: { name, role } }),
    db.auditLog.create({ data: { actorId: user.id, entityType: "User", entityId: name, action: "CREATE", summary: `Added office login for ${name} (${role.toLowerCase()})` } }),
  ]);
  revalidatePath("/", "layout");
}

export async function setOfficeUserActive(form: FormData) {
  const user = await authorize(["OWNER"]);
  const id = String(form.get("id"));
  if (id === user.id) return; // can't lock yourself out
  const active = form.get("active") === "on";
  const target = await db.user.update({ where: { id }, data: { active } });
  await db.auditLog.create({ data: { actorId: user.id, entityType: "User", entityId: id, action: active ? "ENABLE" : "DISABLE", summary: `${active ? "Re-enabled" : "Turned off"} login for ${target.name}` } });
  revalidatePath("/", "layout");
}

export async function addSkill(form: FormData) {
  await authorize(OFFICE);
  const name = str(form, "name");
  if (!name) return;
  await db.skill.upsert({ where: { name }, update: {}, create: { name } });
  revalidatePath("/", "layout");
}
