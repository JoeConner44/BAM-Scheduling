import "server-only";
import type { Prisma } from "@prisma/client";
import { refreshAlerts, type PlanChange } from "../alerts";
import { loadEmployees, loadEquipment, loadWeather, projectInclude, projectLabel, remainingHours, toEEmployee, toEEquipment } from "../data";
import { db } from "../db";
import { isLive } from "../engine/conflicts";
import { EQUIPMENT_TYPE_LABEL, PRIORITY_RANK } from "../labels";
import { getSchedulingSettings } from "../settings";
import { syncProjectStatus } from "../status";
import { addDays, dateToDay, dayToDate, fmtDay, fmtRange, maybeDay, today, workdayOffset } from "../time";
import { planSchedule, type PlanBusyBlock, type PlanJob } from "./plan";

/** Statuses the auto-scheduler works on. "Waiting on…" and finished jobs are left alone. */
const PLANNABLE = ["TO_DO", "READY", "TENTATIVE", "SCHEDULED", "IN_PROGRESS", "PARTIALLY_COMPLETE", "DELAYED", "WEATHER_DELAY"] as const;

/** Where the auto-scheduler may place and move work, given the settings. */
export async function planningWindow() {
  const settings = await getSchedulingSettings();
  const t = today();
  return {
    settings,
    today: t,
    // Today plus `lockDays` work days are frozen: crews already know where they're going.
    firstDay: workdayOffset(t, settings.lockDays + 1),
    lastDay: addDays(t, settings.horizonDays),
  };
}

/**
 * Rebuild the auto-scheduled part of the schedule. Runs after every change (a job accepted,
 * a requested date set, someone off, a truck down, a field report, new weather, a setting).
 * Work that people placed, locked, confirmed or started is never moved; everything the app
 * placed itself is re-planned to the best fit. Never throws: a failed re-plan must not
 * break the change that triggered it.
 */
export async function replan(trigger: string, actorId: string | null = null) {
  try {
    return await replanNow(trigger, actorId);
  } catch (e) {
    console.error("Auto-scheduler failed:", e);
    return null;
  }
}

const sig = (b: { day: string; startMin: number; endMin: number; employeeIds: string[]; equipmentIds: string[] }) =>
  [b.day, b.startMin, b.endMin, [...b.employeeIds].sort().join(","), [...b.equipmentIds].sort().join(",")].join("|");

async function replanNow(trigger: string, actorId: string | null) {
  const win = await planningWindow();
  const [employees, equipment, weather] = await Promise.all([loadEmployees(), loadEquipment(), loadWeather(win.firstDay, addDays(win.lastDay, 1))]);

  const outcome = await db.$transaction(
    async (tx) => {
      // One re-plan at a time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;

      const blocks = await tx.scheduleBlock.findMany({
        where: { day: { gte: dayToDate(win.today), lte: dayToDate(win.lastDay) } },
        include: { assignments: true, equipmentAssignments: true, project: { include: { location: true } } },
      });
      const live = blocks.filter(isLive);
      const movable = live.filter((b) => b.auto && !b.pinned && b.state === "TENTATIVE" && b.progress === "PLANNED" && dateToDay(b.day) >= win.firstDay);
      const movableIds = new Set(movable.map((b) => b.id));

      const fixed: PlanBusyBlock[] = live
        .filter((b) => !movableIds.has(b.id))
        .map((b) => ({
          projectId: b.projectId,
          day: dateToDay(b.day),
          startMin: b.startMin,
          endMin: b.endMin,
          employeeIds: b.assignments.map((a) => a.employeeId),
          equipmentIds: b.equipmentAssignments.map((a) => a.equipmentId),
          city: b.project.city,
          lat: b.project.lat ?? b.project.location?.lat ?? null,
          lng: b.project.lng ?? b.project.location?.lng ?? null,
        }));

      const projects = await tx.project.findMany({
        where: { status: { in: [...PLANNABLE] }, requestedDate: { not: null }, surfaceReady: true, customerReady: true },
        include: projectInclude,
      });

      const jobs: PlanJob[] = projects.map((p) => {
        const lockedHours = p.blocks
          .filter((b) => isLive(b) && dateToDay(b.day) >= win.today && !movableIds.has(b.id))
          .reduce((s, b) => s + (b.endMin - b.startMin) / 60, 0);
        const due = [maybeDay(p.deadline), maybeDay(p.inspectionDate)].filter(Boolean).sort()[0] ?? null;
        return {
          id: p.id,
          label: projectLabel(p),
          city: p.city,
          locationId: p.locationId,
          jobTypeId: p.jobTypeId,
          lat: p.lat ?? p.location?.lat ?? null,
          lng: p.lng ?? p.location?.lng ?? null,
          hoursNeeded: Math.max(0, remainingHours(p) - lockedHours),
          crewSize: p.estCrewSize,
          requiredSkills: p.requiredSkills.map((r) => ({ skillId: r.skillId, skillName: r.skill.name, minCount: r.minCount })),
          requiredEquipment: p.requiredEquipment.map((r) => ({ type: r.type, typeLabel: EQUIPMENT_TYPE_LABEL[r.type], quantity: r.quantity })),
          requestedDate: dateToDay(p.requestedDate!),
          earliestDate: maybeDay(p.earliestDate),
          dueDate: due,
          priorityRank: PRIORITY_RANK[p.priority],
          weatherSensitive: p.weatherSensitivity !== "NONE",
          previousDays: movable.filter((b) => b.projectId === p.id).map((b) => dateToDay(b.day)),
        };
      });

      const plan = planSchedule({
        firstDay: win.firstDay,
        lastDay: win.lastDay,
        workdayStartMin: win.settings.workdayStartMin,
        workdayEndMin: win.settings.workdayEndMin,
        workSaturdays: win.settings.workSaturdays,
        employees: employees.map(toEEmployee),
        equipment: equipment.map(toEEquipment),
        jobs: jobs.filter((j) => j.hoursNeeded > 0),
        fixed,
        ...weather,
      });

      // Apply only what changed, project by project.
      const labels = new Map(projects.map((p) => [p.id, projectLabel(p)]));
      for (const b of movable) labels.set(b.projectId, projectLabel(b.project));
      const affected = new Set([...movable.map((b) => b.projectId), ...plan.blocks.map((b) => b.projectId)]);
      const changes: PlanChange[] = [];

      for (const projectId of affected) {
        const before = movable
          .filter((b) => b.projectId === projectId)
          .map((b) => ({
            id: b.id,
            day: dateToDay(b.day),
            startMin: b.startMin,
            endMin: b.endMin,
            employeeIds: b.assignments.map((a) => a.employeeId),
            equipmentIds: b.equipmentAssignments.map((a) => a.equipmentId),
          }))
          .sort((a, b) => a.day.localeCompare(b.day));
        const after = plan.blocks.filter((b) => b.projectId === projectId);
        if (before.map(sig).sort().join(";") === after.map(sig).sort().join(";")) continue;

        if (before.length) await tx.scheduleBlock.deleteMany({ where: { id: { in: before.map((b) => b.id) } } });
        for (const b of after) {
          await tx.scheduleBlock.create({
            data: {
              projectId,
              day: dayToDate(b.day),
              startMin: b.startMin,
              endMin: b.endMin,
              state: "TENTATIVE",
              auto: true,
              notes: `Auto-scheduled: ${b.why.join("; ")}`,
              assignments: { create: b.employeeIds.map((employeeId) => ({ employeeId })) },
              equipmentAssignments: { create: b.equipmentIds.map((equipmentId) => ({ equipmentId })) },
            },
          });
        }
        await syncProjectStatus(tx, projectId, actorId);
        changes.push({
          projectId,
          label: labels.get(projectId) ?? "Project",
          from: before.map((b) => ({ day: b.day, startMin: b.startMin, endMin: b.endMin })),
          to: after.map((b) => ({ day: b.day, startMin: b.startMin, endMin: b.endMin })),
          why: after[0]?.why ?? [],
        });
      }

      let planRunId: string | null = null;
      if (changes.length) {
        const summary = describe(changes);
        const run = await tx.planRun.create({ data: { trigger, summary, changes: changes as unknown as Prisma.InputJsonValue } });
        planRunId = run.id;
        await tx.auditLog.create({
          data: { actorId, entityType: "PlanRun", entityId: run.id, action: "AUTO_SCHEDULE", summary: `Auto-scheduler (${trigger}): ${summary}` },
        });
      }
      return { changes, unplaced: plan.unplaced, late: plan.blocks.filter((b) => b.late), planRunId };
    },
    { timeout: 60_000, maxWait: 60_000 },
  );

  await refreshAlerts({ ...outcome, window: win });
  return outcome;
}

export function describeSlots(slots: { day: string; startMin: number; endMin: number }[]) {
  return slots.length ? slots.map((s) => `${fmtDay(s.day)} ${fmtRange(s.startMin, s.endMin)}`).join(", ") : "not scheduled";
}

function describe(changes: PlanChange[]) {
  const placed = changes.filter((c) => !c.from.length && c.to.length).length;
  const moved = changes.filter((c) => c.from.length && c.to.length).length;
  const removed = changes.filter((c) => c.from.length && !c.to.length).length;
  return [placed && `placed ${placed} job${placed > 1 ? "s" : ""}`, moved && `moved ${moved}`, removed && `unscheduled ${removed}`].filter(Boolean).join(", ");
}
