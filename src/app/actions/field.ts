"use server";

import { revalidatePath } from "next/cache";
import type { ConditionReason, Prisma, ProjectStatus } from "@prisma/client";
import { authorize, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CONDITION_REASON_LABEL } from "@/lib/labels";
import { setProjectStatus } from "@/lib/status";
import { savePhoto } from "@/lib/storage";

// Actions the field crew takes from their phone. They can only touch blocks they are
// assigned to, and they can never move or reassign anything on the company schedule.

export type FieldResult = { ok: true; message: string } | { ok: false; error: string };

async function loadBlockFor(user: SessionUser, blockId: string) {
  const block = await db.scheduleBlock.findUnique({ where: { id: blockId }, include: { project: true, assignments: true } });
  if (!block) throw new Error("This job is no longer on the schedule. Pull down to refresh.");
  if (user.role === "FIELD" && !block.assignments.some((a) => a.employeeId === user.employeeId)) {
    throw new Error("You're not assigned to this job.");
  }
  return block;
}

async function guard(fn: (user: SessionUser) => Promise<FieldResult>): Promise<FieldResult> {
  try {
    const user = await authorize();
    const result = await fn(user);
    revalidatePath("/", "layout");
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const num = (f: FormData, k: string) => {
  const v = f.get(k);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function log(tx: Prisma.TransactionClient, user: SessionUser, blockId: string, action: string, summary: string, reason?: string | null) {
  await tx.auditLog.create({ data: { actorId: user.id, entityType: "ScheduleBlock", entityId: blockId, action, summary, reason: reason ?? null } });
}

/** Record hours for this visit. The project's actual hours move by the difference, so repeated reports don't double count. */
function hoursDelta(previous: number | null, next: number | null) {
  return next === null ? 0 : next - (previous ?? 0);
}

export async function startJob(blockId: string): Promise<FieldResult> {
  return guard(async (user) => {
    const block = await loadBlockFor(user, blockId);
    await db.$transaction(async (tx) => {
      await tx.scheduleBlock.update({
        where: { id: blockId },
        data: { progress: "ACTIVE", startedAt: block.startedAt ?? new Date(), pausedAt: null },
      });
      if (block.project.status !== "IN_PROGRESS") await setProjectStatus(tx, block.projectId, block.project.status, "IN_PROGRESS", user.id, "Crew started work");
      await log(tx, user, blockId, block.progress === "PAUSED" ? "RESUME" : "START", `${user.name} ${block.progress === "PAUSED" ? "resumed" : "started"} ${block.project.name} — ${block.project.city}`);
    });
    return { ok: true, message: block.progress === "PAUSED" ? "Job resumed." : "Job started. Good luck!" };
  });
}

export async function pauseJob(blockId: string): Promise<FieldResult> {
  return guard(async (user) => {
    const block = await loadBlockFor(user, blockId);
    await db.$transaction(async (tx) => {
      await tx.scheduleBlock.update({ where: { id: blockId }, data: { progress: "PAUSED", pausedAt: new Date() } });
      await log(tx, user, blockId, "PAUSE", `${user.name} paused ${block.project.name} — ${block.project.city}`);
    });
    return { ok: true, message: "Job paused." };
  });
}

const STOP_STATUS: Partial<Record<ConditionReason, ProjectStatus>> = {
  CONSTRUCTION_INCOMPLETE: "WAITING_ON_CONSTRUCTION",
  SURFACE_NOT_READY: "WAITING_ON_CONSTRUCTION",
  CARS_NOT_MOVED: "WAITING_ON_CUSTOMER",
  ACCESS_BLOCKED: "WAITING_ON_CUSTOMER",
  SCOPE_CHANGED: "WAITING_ON_CUSTOMER",
  WEATHER_CHANGED: "WEATHER_DELAY",
};

/** 🚧 JOB CONDITIONS CHANGED */
export async function reportConditions(form: FormData): Promise<FieldResult> {
  return guard(async (user) => {
    const blockId = String(form.get("blockId"));
    const block = await loadBlockFor(user, blockId);
    const reason = String(form.get("reason")) as ConditionReason;
    if (!(reason in CONDITION_REASON_LABEL)) throw new Error("Pick what changed.");
    const percentComplete = num(form, "percentComplete");
    const hoursWorked = num(form, "hoursWorked");
    const remainingHours = num(form, "remainingHours");
    const canProceed = form.get("canProceed") !== "no";
    const note = (form.get("note") as string | null)?.trim() || null;
    const photos = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
    const keys = await Promise.all(photos.map(savePhoto));

    const parts = [
      percentComplete !== null && `${percentComplete}% complete`,
      hoursWorked !== null && `${hoursWorked} hrs worked`,
      remainingHours !== null && `about ${remainingHours} hrs remaining`,
    ].filter(Boolean);
    const summary = `🚧 ${CONDITION_REASON_LABEL[reason]}${canProceed ? "" : " — crew had to stop"}${parts.length ? ` — ${parts.join(", ")}` : ""}.`;

    await db.$transaction(async (tx) => {
      await tx.conditionReport.create({
        data: { projectId: block.projectId, blockId, reportedById: user.id, reason, percentComplete, hoursWorked, remainingHours, canProceed, note },
      });
      await tx.projectNote.create({
        data: { projectId: block.projectId, blockId, authorId: user.id, kind: "CONDITION_REPORT", body: note ? `${summary} “${note}”` : summary },
      });
      for (const fileKey of keys) {
        await tx.projectPhoto.create({ data: { projectId: block.projectId, blockId, uploadedById: user.id, fileKey, caption: CONDITION_REASON_LABEL[reason] } });
      }
      await tx.project.update({
        where: { id: block.projectId },
        data: {
          ...(percentComplete !== null && { percentComplete: Math.max(0, Math.min(100, Math.round(percentComplete))) }),
          ...(remainingHours !== null && { remainingHoursOverride: Math.max(0, remainingHours) }),
          actualHours: { increment: hoursDelta(block.actualHours, hoursWorked) },
        },
      });
      await tx.scheduleBlock.update({
        where: { id: blockId },
        data: {
          ...(hoursWorked !== null && { actualHours: hoursWorked }),
          ...(!canProceed && { progress: "CANNOT_PROCEED", completedAt: new Date() }),
        },
      });
      if (!canProceed) {
        const next = STOP_STATUS[reason] ?? "DELAYED";
        await setProjectStatus(tx, block.projectId, block.project.status, next, user.id, CONDITION_REASON_LABEL[reason]);
      }
      await log(tx, user, blockId, "CONDITIONS", `${block.project.name} — ${block.project.city}: ${summary}`, note);
    });
    return { ok: true, message: canProceed ? "Sent to the office. Keep going!" : "Sent. The office will reschedule the rest." };
  });
}

/** ✅ MARK COMPLETE — whole job, or just this visit (partial completion). */
export async function completeJob(form: FormData): Promise<FieldResult> {
  return guard(async (user) => {
    const blockId = String(form.get("blockId"));
    const block = await loadBlockFor(user, blockId);
    const allDone = form.get("allDone") === "yes";
    const hoursWorked = num(form, "hoursWorked");
    const percentComplete = allDone ? 100 : Math.max(0, Math.min(99, Math.round(num(form, "percentComplete") ?? block.project.percentComplete)));
    const remainingHours = allDone ? 0 : num(form, "remainingHours");
    const note = (form.get("note") as string | null)?.trim() || null;
    if (!allDone && (remainingHours === null || remainingHours <= 0)) throw new Error("About how many hours are left?");

    const label = `${block.project.name} — ${block.project.city}`;
    const summary = allDone
      ? `✅ Job complete${hoursWorked !== null ? ` (${hoursWorked} hrs on this visit)` : ""}.`
      : `⏸ Partially complete — ${percentComplete}% done, about ${remainingHours} hrs remaining${hoursWorked !== null ? ` (${hoursWorked} hrs on this visit)` : ""}.`;

    await db.$transaction(async (tx) => {
      await tx.scheduleBlock.update({
        where: { id: blockId },
        data: { progress: "DONE", completedAt: new Date(), ...(hoursWorked !== null && { actualHours: hoursWorked }) },
      });
      await tx.project.update({
        where: { id: block.projectId },
        data: { percentComplete, remainingHoursOverride: remainingHours, actualHours: { increment: hoursDelta(block.actualHours, hoursWorked) } },
      });
      const next: ProjectStatus = allDone ? "COMPLETE" : "PARTIALLY_COMPLETE";
      if (block.project.status !== next) await setProjectStatus(tx, block.projectId, block.project.status, next, user.id, allDone ? "Crew marked complete" : "Crew finished part of the job");
      await tx.projectNote.create({ data: { projectId: block.projectId, blockId, authorId: user.id, kind: "SYSTEM", body: note ? `${summary} “${note}”` : summary } });
      await log(tx, user, blockId, allDone ? "COMPLETE" : "PARTIAL", `${user.name}: ${label} ${summary}`, note);
    });
    return { ok: true, message: allDone ? "Marked complete. Nice work!" : "Saved. The rest goes back on the TO DO list." };
  });
}

export async function addFieldNote(form: FormData): Promise<FieldResult> {
  return guard(async (user) => {
    const blockId = String(form.get("blockId"));
    const block = await loadBlockFor(user, blockId);
    const body = (form.get("body") as string | null)?.trim();
    if (!body) throw new Error("Type a note first.");
    const delay = form.get("kind") === "DELAY";
    await db.projectNote.create({ data: { projectId: block.projectId, blockId, authorId: user.id, kind: delay ? "DELAY" : "NOTE", body: delay ? `⏱ Running late: ${body}` : body } });
    if (delay) await db.auditLog.create({ data: { actorId: user.id, entityType: "ScheduleBlock", entityId: blockId, action: "DELAY", summary: `${user.name} reported a delay on ${block.project.name} — ${block.project.city}`, reason: body } });
    return { ok: true, message: "Note sent to the office." };
  });
}

export async function addFieldPhoto(form: FormData): Promise<FieldResult> {
  return guard(async (user) => {
    const blockId = String(form.get("blockId"));
    const block = await loadBlockFor(user, blockId);
    const files = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("No photo selected.");
    for (const file of files) {
      const fileKey = await savePhoto(file);
      await db.projectPhoto.create({ data: { projectId: block.projectId, blockId, uploadedById: user.id, fileKey } });
    }
    return { ok: true, message: files.length > 1 ? `${files.length} photos uploaded.` : "Photo uploaded." };
  });
}
