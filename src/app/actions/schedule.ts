"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { authorize, NotAllowedError, OFFICE, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadSnapshotForDay, projectLabel, toEBlock } from "@/lib/data";
import { introducedFindings, withBlock } from "@/lib/engine/conflicts";
import type { EBlock, Finding } from "@/lib/engine/types";
import { syncProjectStatus } from "@/lib/status";
import { dayToDate, fmtDay, fmtRange, isDay, type Day } from "@/lib/time";

/**
 * Every scheduling change goes through `applyChange`:
 *   1. Build the schedule as it is, and as it would be after the change.
 *   2. Ask the engine what the change would introduce.
 *   3. If anything, return it so the user can Cancel or Proceed anyway (never silent).
 *   4. On proceed, save the change, the audit entry, and — if there were findings — an override record.
 */

export type ScheduleResult =
  | { ok: true; blockId: string; overridden: boolean }
  | { ok: false; needsConfirm: true; findings: Finding[]; summary: string }
  | { ok: false; needsConfirm?: false; error: string };

export interface ConfirmOptions {
  /** The user saw the findings and chose to proceed. */
  override?: boolean;
  reason?: string;
}

const blockInclude = { assignments: true, equipmentAssignments: true, project: true } satisfies Prisma.ScheduleBlockInclude;

async function getBlock(blockId: string) {
  const block = await db.scheduleBlock.findUnique({ where: { id: blockId }, include: blockInclude });
  if (!block) throw new Error("That schedule block no longer exists. The board will refresh.");
  return block;
}

function validTimes(day: Day, startMin: number, endMin: number) {
  if (!isDay(day)) throw new Error("Invalid date.");
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440 || endMin <= startMin) {
    throw new Error("End time must be after start time.");
  }
}

async function applyChange(input: {
  user: SessionUser;
  action: string;
  projectId: string;
  before: EBlock | null;
  after: EBlock;
  summary: string;
  opts: ConfirmOptions;
  persist: (tx: Prisma.TransactionClient) => Promise<string>;
  auditBefore?: Prisma.InputJsonValue;
  auditAfter?: Prisma.InputJsonValue;
}): Promise<ScheduleResult> {
  const { user, action, projectId, before, after, summary, opts } = input;

  const current = await loadSnapshotForDay(after.day, [projectId]);
  const proposed = withBlock(current, after);
  const findings = introducedFindings(current, proposed, after.id);

  if (findings.length && !opts.override) return { ok: false, needsConfirm: true, findings, summary };

  const blockId = await db.$transaction(async (tx) => {
    const id = await input.persist(tx);
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        entityType: "ScheduleBlock",
        entityId: id,
        action,
        summary: findings.length ? `${summary} (override)` : summary,
        before: input.auditBefore ?? (before ? (before as unknown as Prisma.InputJsonValue) : undefined),
        after: input.auditAfter ?? ({ ...after, id } as unknown as Prisma.InputJsonValue),
        reason: opts.reason?.trim() || null,
      },
    });
    if (findings.length) {
      await tx.schedulingOverride.create({
        data: {
          actorId: user.id,
          blockId: id,
          action,
          findings: findings as unknown as Prisma.InputJsonValue,
          reason: opts.reason?.trim() || null,
        },
      });
    }
    await syncProjectStatus(tx, projectId, user.id);
    return id;
  });

  revalidatePath("/", "layout");
  return { ok: true, blockId, overridden: findings.length > 0 };
}

async function guard(fn: (user: SessionUser) => Promise<ScheduleResult>): Promise<ScheduleResult> {
  try {
    const user = await authorize(OFFICE);
    return await fn(user);
  } catch (e) {
    if (e instanceof NotAllowedError || e instanceof Error) return { ok: false, error: e.message };
    return { ok: false, error: "Something went wrong." };
  }
}

// ───────────────────────── Actions ─────────────────────────

export async function createBlock(
  input: { projectId: string; day: Day; startMin: number; endMin: number; employeeIds?: string[]; equipmentIds?: string[]; state?: "TENTATIVE" | "COMMITTED" },
  opts: ConfirmOptions = {},
): Promise<ScheduleResult> {
  return guard(async (user) => {
    validTimes(input.day, input.startMin, input.endMin);
    const project = await db.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new Error("Project not found.");
    const employeeIds = [...new Set(input.employeeIds ?? [])];
    const equipmentIds = [...new Set(input.equipmentIds ?? [])];
    const after: EBlock = {
      id: "__new__",
      projectId: project.id,
      day: input.day,
      startMin: input.startMin,
      endMin: input.endMin,
      state: input.state ?? "TENTATIVE",
      progress: "PLANNED",
      employeeIds,
      equipmentIds,
    };
    return applyChange({
      user,
      action: "CREATE",
      projectId: project.id,
      before: null,
      after,
      summary: `Scheduled ${projectLabel(project)} on ${fmtDay(input.day)} ${fmtRange(input.startMin, input.endMin)} (${after.state.toLowerCase()})`,
      opts,
      persist: async (tx) => {
        const block = await tx.scheduleBlock.create({
          data: {
            projectId: project.id,
            day: dayToDate(input.day),
            startMin: input.startMin,
            endMin: input.endMin,
            state: after.state,
            createdById: user.id,
            assignments: { create: employeeIds.map((employeeId) => ({ employeeId })) },
            equipmentAssignments: { create: equipmentIds.map((equipmentId) => ({ equipmentId })) },
          },
        });
        return block.id;
      },
    });
  });
}

export async function moveBlock(
  input: { blockId: string; day: Day; startMin: number; endMin: number },
  opts: ConfirmOptions = {},
): Promise<ScheduleResult> {
  return guard(async (user) => {
    validTimes(input.day, input.startMin, input.endMin);
    const block = await getBlock(input.blockId);
    const before = toEBlock(block);
    if (before.day === input.day && before.startMin === input.startMin && before.endMin === input.endMin) {
      return { ok: true, blockId: block.id, overridden: false };
    }
    const after: EBlock = { ...before, day: input.day, startMin: input.startMin, endMin: input.endMin };
    const label = projectLabel(block.project);
    const summary =
      before.day === after.day
        ? `Changed ${label} on ${fmtDay(after.day)} from ${fmtRange(before.startMin, before.endMin)} to ${fmtRange(after.startMin, after.endMin)}`
        : `Moved ${label} from ${fmtDay(before.day)} ${fmtRange(before.startMin, before.endMin)} to ${fmtDay(after.day)} ${fmtRange(after.startMin, after.endMin)}`;
    return applyChange({
      user,
      action: "MOVE",
      projectId: block.projectId,
      before,
      after,
      summary,
      opts,
      persist: async (tx) => {
        await tx.scheduleBlock.update({ where: { id: block.id }, data: { day: dayToDate(input.day), startMin: input.startMin, endMin: input.endMin } });
        return block.id;
      },
    });
  });
}

export async function assignEmployee(
  input: { blockId: string; employeeId: string; replaceEmployeeId?: string },
  opts: ConfirmOptions = {},
): Promise<ScheduleResult> {
  return guard(async (user) => {
    const block = await getBlock(input.blockId);
    const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw new Error("Employee not found.");
    const before = toEBlock(block);
    if (before.employeeIds.includes(employee.id) && !input.replaceEmployeeId) return { ok: true, blockId: block.id, overridden: false };
    const replaced = input.replaceEmployeeId ? await db.employee.findUnique({ where: { id: input.replaceEmployeeId } }) : null;
    const after: EBlock = {
      ...before,
      employeeIds: [...before.employeeIds.filter((id) => id !== input.replaceEmployeeId && id !== employee.id), employee.id],
    };
    const label = `${projectLabel(block.project)} (${fmtDay(before.day)} ${fmtRange(before.startMin, before.endMin)})`;
    return applyChange({
      user,
      action: replaced ? "REASSIGN_EMPLOYEE" : "ASSIGN_EMPLOYEE",
      projectId: block.projectId,
      before,
      after,
      summary: replaced ? `Replaced ${replaced.name} with ${employee.name} on ${label}` : `Assigned ${employee.name} to ${label}`,
      opts,
      persist: async (tx) => {
        if (replaced) await tx.assignment.deleteMany({ where: { blockId: block.id, employeeId: replaced.id } });
        await tx.assignment.upsert({
          where: { blockId_employeeId: { blockId: block.id, employeeId: employee.id } },
          update: {},
          create: { blockId: block.id, employeeId: employee.id },
        });
        return block.id;
      },
    });
  });
}

export async function unassignEmployee(input: { blockId: string; employeeId: string }): Promise<ScheduleResult> {
  return guard(async (user) => {
    const block = await getBlock(input.blockId);
    const employee = await db.employee.findUnique({ where: { id: input.employeeId } });
    const before = toEBlock(block);
    return applyChange({
      user,
      action: "UNASSIGN_EMPLOYEE",
      projectId: block.projectId,
      before,
      after: { ...before, employeeIds: before.employeeIds.filter((id) => id !== input.employeeId) },
      summary: `Removed ${employee?.name ?? "employee"} from ${projectLabel(block.project)} (${fmtDay(before.day)})`,
      opts: { override: true },
      persist: async (tx) => {
        await tx.assignment.deleteMany({ where: { blockId: block.id, employeeId: input.employeeId } });
        return block.id;
      },
    });
  });
}

export async function assignEquipment(
  input: { blockId: string; equipmentId: string; replaceEquipmentId?: string },
  opts: ConfirmOptions = {},
): Promise<ScheduleResult> {
  return guard(async (user) => {
    const block = await getBlock(input.blockId);
    const unit = await db.equipment.findUnique({ where: { id: input.equipmentId } });
    if (!unit) throw new Error("Equipment not found.");
    const before = toEBlock(block);
    if (before.equipmentIds.includes(unit.id) && !input.replaceEquipmentId) return { ok: true, blockId: block.id, overridden: false };
    const replaced = input.replaceEquipmentId ? await db.equipment.findUnique({ where: { id: input.replaceEquipmentId } }) : null;
    const after: EBlock = {
      ...before,
      equipmentIds: [...before.equipmentIds.filter((id) => id !== input.replaceEquipmentId && id !== unit.id), unit.id],
    };
    const label = `${projectLabel(block.project)} (${fmtDay(before.day)} ${fmtRange(before.startMin, before.endMin)})`;
    return applyChange({
      user,
      action: replaced ? "REASSIGN_EQUIPMENT" : "ASSIGN_EQUIPMENT",
      projectId: block.projectId,
      before,
      after,
      summary: replaced ? `Swapped ${replaced.name} for ${unit.name} on ${label}` : `Assigned ${unit.name} to ${label}`,
      opts,
      persist: async (tx) => {
        if (replaced) await tx.equipmentAssignment.deleteMany({ where: { blockId: block.id, equipmentId: replaced.id } });
        await tx.equipmentAssignment.upsert({
          where: { blockId_equipmentId: { blockId: block.id, equipmentId: unit.id } },
          update: {},
          create: { blockId: block.id, equipmentId: unit.id },
        });
        return block.id;
      },
    });
  });
}

export async function unassignEquipment(input: { blockId: string; equipmentId: string }): Promise<ScheduleResult> {
  return guard(async (user) => {
    const block = await getBlock(input.blockId);
    const unit = await db.equipment.findUnique({ where: { id: input.equipmentId } });
    const before = toEBlock(block);
    return applyChange({
      user,
      action: "UNASSIGN_EQUIPMENT",
      projectId: block.projectId,
      before,
      after: { ...before, equipmentIds: before.equipmentIds.filter((id) => id !== input.equipmentId) },
      summary: `Removed ${unit?.name ?? "equipment"} from ${projectLabel(block.project)} (${fmtDay(before.day)})`,
      opts: { override: true },
      persist: async (tx) => {
        await tx.equipmentAssignment.deleteMany({ where: { blockId: block.id, equipmentId: input.equipmentId } });
        return block.id;
      },
    });
  });
}

export async function setBlockState(input: { blockId: string; state: "TENTATIVE" | "COMMITTED" }): Promise<ScheduleResult> {
  return guard(async (user) => {
    const block = await getBlock(input.blockId);
    const before = toEBlock(block);
    if (before.state === input.state) return { ok: true, blockId: block.id, overridden: false };
    return applyChange({
      user,
      action: input.state === "COMMITTED" ? "COMMIT" : "MAKE_TENTATIVE",
      projectId: block.projectId,
      before,
      after: { ...before, state: input.state },
      summary: `${input.state === "COMMITTED" ? "Committed" : "Changed to tentative:"} ${projectLabel(block.project)} on ${fmtDay(before.day)}`,
      opts: { override: true },
      persist: async (tx) => {
        await tx.scheduleBlock.update({ where: { id: block.id }, data: { state: input.state } });
        return block.id;
      },
    });
  });
}

/** Take a block off the board. The project stays on the TO DO list. */
export async function removeBlock(input: { blockId: string; reason?: string }): Promise<ScheduleResult> {
  return guard(async (user) => {
    const block = await getBlock(input.blockId);
    const before = toEBlock(block);
    await db.$transaction(async (tx) => {
      await tx.scheduleBlock.delete({ where: { id: block.id } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          entityType: "ScheduleBlock",
          entityId: block.id,
          action: "UNSCHEDULE",
          summary: `Took ${projectLabel(block.project)} off ${fmtDay(before.day)} ${fmtRange(before.startMin, before.endMin)} — back to TO DO`,
          before: before as unknown as Prisma.InputJsonValue,
          reason: input.reason?.trim() || null,
        },
      });
      await syncProjectStatus(tx, block.projectId, user.id);
    });
    revalidatePath("/", "layout");
    return { ok: true, blockId: block.id, overridden: false };
  });
}
