// The conflict engine. Given a snapshot of the schedule it reports every conflict,
// warning and staffing gap for each block. It never blocks anything: callers decide
// whether to ask the user to confirm an override.

import { estimateTravelMinutes } from "../geo";
import { dayOfWeek, fmtDay, fmtRange, fmtMin } from "../time";
import type { EBlock, Finding, FindingCode, Severity, Snapshot } from "./types";

export const DEFAULT_SETTINGS = {
  maxDayMinutes: 10 * 60,
  weatherThreshold: { LOW: 60, HIGH: 30 },
  travel: { averageMph: 40, roadFactor: 1.3, minimumMinutes: 10 },
};

const overlaps = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) =>
  a.startMin < b.endMin && b.startMin < a.endMin;

/** Blocks that no longer occupy anyone (finished, or the crew had to stop) are ignored by the checks. */
export const isLive = (b: { progress: string }) => b.progress !== "DONE" && b.progress !== "CANNOT_PROCEED";

function finding(
  block: EBlock,
  code: FindingCode,
  severity: Severity,
  title: string,
  message: string,
  subject: string,
  extra: Partial<Pick<Finding, "employeeId" | "equipmentId" | "otherBlockId">> & { dedupeKey?: string } = {},
): Finding {
  const key = [code, block.id, extra.employeeId ?? extra.equipmentId ?? "", extra.otherBlockId ?? ""].join(":");
  return {
    key,
    dedupeKey: extra.dedupeKey ?? key,
    code,
    severity,
    title,
    message,
    subject,
    blockId: block.id,
    employeeId: extra.employeeId,
    equipmentId: extra.equipmentId,
    otherBlockId: extra.otherBlockId,
  };
}

/** Check one block against the rest of the snapshot. */
export function checkBlock(block: EBlock, snap: Snapshot): Finding[] {
  if (!isLive(block)) return [];
  const out: Finding[] = [];
  const project = snap.projects[block.projectId];
  const label = project?.label ?? "This project";
  const sameDay = snap.blocks.filter((b) => b.id !== block.id && b.day === block.day && isLive(b));
  const blockRange = `${fmtDay(block.day)} ${fmtRange(block.startMin, block.endMin)}`;
  const projectLabel = (id: string) => snap.projects[id]?.label ?? "another project";

  // ── People ──
  for (const empId of block.employeeIds) {
    const emp = snap.employees[empId];
    if (!emp) continue;

    if (!emp.active) {
      out.push(finding(block, "EMPLOYEE_INACTIVE", "conflict", "Employee inactive", `${emp.name} is no longer active.`, emp.name, { employeeId: empId }));
    }

    for (const other of sameDay) {
      if (!other.employeeIds.includes(empId) || !overlaps(block, other)) continue;
      out.push(
        finding(
          block,
          "EMPLOYEE_OVERLAP",
          "conflict",
          "Employee conflict",
          `${emp.name} is already assigned to ${projectLabel(other.projectId)}, ${fmtRange(other.startMin, other.endMin)}. ` +
            `This assignment: ${label}, ${fmtRange(block.startMin, block.endMin)}.`,
          emp.name,
          { employeeId: empId, otherBlockId: other.id, dedupeKey: pairKey("EMP", empId, block.id, other.id) },
        ),
      );
    }

    for (const off of emp.timeOff) {
      if (block.day < off.startDay || block.day > off.endDay) continue;
      const partial = off.startMin !== null && off.endMin !== null;
      if (partial && !overlaps(block, { startMin: off.startMin!, endMin: off.endMin! })) continue;
      const what = off.type.toLowerCase();
      out.push(
        finding(
          block,
          "EMPLOYEE_TIME_OFF",
          "conflict",
          "Employee not available",
          partial
            ? `${emp.name} is ${what} ${fmtRange(off.startMin!, off.endMin!)} on ${fmtDay(block.day)}.`
            : `${emp.name} is ${what} on ${fmtDay(block.day)}.`,
          emp.name,
          { employeeId: empId },
        ),
      );
    }

    if (!emp.workDays.includes(dayOfWeek(block.day))) {
      out.push(
        finding(block, "EMPLOYEE_OUTSIDE_HOURS", "warning", "Not a normal work day", `${fmtDay(block.day)} is not one of ${emp.name}'s normal work days.`, emp.name, {
          employeeId: empId,
        }),
      );
    } else if (block.startMin < emp.normalStartMin || block.endMin > emp.normalEndMin) {
      out.push(
        finding(
          block,
          "EMPLOYEE_OUTSIDE_HOURS",
          "warning",
          "Outside normal hours",
          `${emp.name} normally works ${fmtRange(emp.normalStartMin, emp.normalEndMin)}.`,
          emp.name,
          { employeeId: empId },
        ),
      );
    }

    const booked = [block, ...sameDay.filter((b) => b.employeeIds.includes(empId))].reduce((sum, b) => sum + (b.endMin - b.startMin), 0);
    if (booked > snap.settings.maxDayMinutes) {
      out.push(
        finding(
          block,
          "EMPLOYEE_OVERLOADED",
          "warning",
          "Long day",
          `${emp.name} would be booked ${(booked / 60).toFixed(1)} hours on ${fmtDay(block.day)}.`,
          emp.name,
          { employeeId: empId, dedupeKey: `OVERLOAD:${empId}:${block.day}` },
        ),
      );
    }
  }

  // ── Equipment ──
  for (const eqId of block.equipmentIds) {
    const eq = snap.equipment[eqId];
    if (!eq) continue;

    for (const other of sameDay) {
      if (!other.equipmentIds.includes(eqId) || !overlaps(block, other)) continue;
      out.push(
        finding(
          block,
          "EQUIPMENT_OVERLAP",
          "conflict",
          "Equipment conflict",
          `${eq.name} is already assigned to ${projectLabel(other.projectId)}, ${fmtRange(other.startMin, other.endMin)}. ` +
            `This assignment: ${label}, ${fmtRange(block.startMin, block.endMin)}.`,
          eq.name,
          { equipmentId: eqId, otherBlockId: other.id, dedupeKey: pairKey("EQ", eqId, block.id, other.id) },
        ),
      );
    }

    if (!eq.active) {
      out.push(finding(block, "EQUIPMENT_UNAVAILABLE", "conflict", "Equipment retired", `${eq.name} is no longer active.`, eq.name, { equipmentId: eqId }));
    } else if ((eq.status === "MAINTENANCE" || eq.status === "OUT_OF_SERVICE") && block.day >= snap.settings.today) {
      const status = eq.status === "MAINTENANCE" ? "in maintenance" : "out of service";
      out.push(
        finding(
          block,
          "EQUIPMENT_UNAVAILABLE",
          "conflict",
          "Equipment unavailable",
          `${eq.name} is ${status}${eq.maintenanceNote ? ` (${eq.maintenanceNote})` : ""}.`,
          eq.name,
          { equipmentId: eqId },
        ),
      );
    } else {
      const down = eq.downtime.find((d) => block.day >= d.startDay && block.day <= d.endDay);
      if (down) {
        out.push(
          finding(
            block,
            "EQUIPMENT_UNAVAILABLE",
            "conflict",
            "Equipment unavailable",
            `${eq.name} is scheduled for maintenance on ${fmtDay(block.day)}${down.reason ? ` (${down.reason})` : ""}.`,
            eq.name,
            { equipmentId: eqId },
          ),
        );
      }
    }
  }

  // ── Travel: flag on the later block, once per previous block ──
  if (project && project.lat !== null && project.lng !== null) {
    const byPrev = new Map<string, { prev: EBlock; names: string[] }>();
    const resources: { id: string; name: string; has: (b: EBlock) => boolean }[] = [
      ...block.employeeIds.map((id) => ({ id, name: snap.employees[id]?.name ?? "?", has: (b: EBlock) => b.employeeIds.includes(id) })),
      ...block.equipmentIds.map((id) => ({ id, name: snap.equipment[id]?.name ?? "?", has: (b: EBlock) => b.equipmentIds.includes(id) })),
    ];
    for (const r of resources) {
      const prev = sameDay
        .filter((b) => r.has(b) && b.endMin <= block.startMin)
        .sort((a, b) => b.endMin - a.endMin)[0];
      if (!prev) continue;
      const entry = byPrev.get(prev.id) ?? { prev, names: [] };
      entry.names.push(r.name);
      byPrev.set(prev.id, entry);
    }
    for (const { prev, names } of byPrev.values()) {
      const from = snap.projects[prev.projectId];
      if (!from || from.lat === null || from.lng === null) continue;
      const need = estimateTravelMinutes({ lat: from.lat, lng: from.lng }, { lat: project.lat, lng: project.lng }, snap.settings.travel);
      const gap = block.startMin - prev.endMin;
      if (gap >= need) continue;
      out.push(
        finding(
          block,
          "TRAVEL",
          "warning",
          "Possible travel conflict",
          `${names.join(", ")}: ${from.label} ends ${fmtMin(prev.endMin)}, ${label} starts ${fmtMin(block.startMin)}. ` +
            `Drive ${from.city} → ${project.city} is about ${need} min; gap is ${gap} min.`,
          `Travel ${from.city} → ${project.city}`,
          { otherBlockId: prev.id },
        ),
      );
    }
  }

  if (!project) return out;

  // ── Dates and readiness ──
  if (project.deadline && block.day > project.deadline) {
    out.push(finding(block, "PAST_DEADLINE", "conflict", "After deadline", `${label} is due ${fmtDay(project.deadline)}; this block is ${blockRange}.`, `Deadline ${fmtDay(project.deadline)}`));
  }
  if (project.inspectionDate && block.day > project.inspectionDate) {
    out.push(finding(block, "PAST_INSPECTION", "conflict", "After inspection", `Inspection is ${fmtDay(project.inspectionDate)}; this block is ${blockRange}.`, `Inspection ${fmtDay(project.inspectionDate)}`));
  } else if (project.inspectionDate && block.day === project.inspectionDate) {
    out.push(finding(block, "INSPECTION_DAY", "warning", "Same day as inspection", `Inspection is the same day (${fmtDay(project.inspectionDate)}).`, `Inspection ${fmtDay(project.inspectionDate)}`));
  }
  if (project.earliestDate && block.day < project.earliestDate) {
    out.push(finding(block, "BEFORE_EARLIEST", "warning", "Before earliest date", `${label} can't start before ${fmtDay(project.earliestDate)}.`, `Earliest ${fmtDay(project.earliestDate)}`));
  }
  const notReady = [
    !project.surfaceReady && "surface not ready",
    !project.customerReady && "customer not ready",
    project.status === "WAITING_ON_CUSTOMER" && "waiting on customer",
    project.status === "WAITING_ON_CONSTRUCTION" && "waiting on construction",
  ].filter(Boolean);
  if (notReady.length) {
    out.push(finding(block, "NOT_READY", "warning", "Project not ready", `${label}: ${notReady.join(", ")}.`, "Readiness"));
  }

  // ── Weather ──
  if (project.weatherSensitivity !== "NONE" && project.locationId) {
    const fc = snap.forecasts.find((f) => f.locationId === project.locationId && f.day === block.day);
    const threshold = snap.settings.weatherThreshold[project.weatherSensitivity];
    if (fc && fc.precipChance >= threshold) {
      out.push(
        finding(
          block,
          "WEATHER",
          "warning",
          "Weather risk",
          `${fc.precipChance}% chance of rain in ${project.city} on ${fmtDay(block.day)}${fc.summary ? ` (${fc.summary})` : ""}.`,
          `Weather ${project.city}`,
        ),
      );
    }
  }

  // ── Staffing (info only: a block is expected to be incomplete while it's being built) ──
  if (block.employeeIds.length < project.estCrewSize) {
    out.push(
      finding(block, "UNDERSTAFFED", "info", "Needs people", `Needs ${project.estCrewSize} people; ${block.employeeIds.length} assigned.`, "Crew size"),
    );
  }
  for (const req of project.requiredSkills) {
    const have = block.employeeIds.filter((id) => snap.employees[id]?.skillIds.includes(req.skillId)).length;
    if (have < req.minCount) {
      out.push(
        finding(block, "MISSING_SKILL", "info", "Missing skill", `Needs ${req.minCount} × ${req.skillName}; ${have} assigned.`, req.skillName, {
          dedupeKey: `SKILL:${block.id}:${req.skillId}`,
        }),
      );
    }
  }
  for (const req of project.requiredEquipment) {
    const have = block.equipmentIds.filter((id) => snap.equipment[id]?.type === req.type).length;
    if (have < req.quantity) {
      out.push(
        finding(block, "MISSING_EQUIPMENT", "info", "Missing equipment", `Needs ${req.quantity} × ${req.typeLabel}; ${have} assigned.`, req.typeLabel, {
          dedupeKey: `EQTYPE:${block.id}:${req.type}`,
        }),
      );
    }
  }

  return out;
}

function pairKey(kind: string, resourceId: string, a: string, b: string) {
  return [kind, resourceId, ...[a, b].sort()].join(":");
}

/** Check every block in the snapshot. */
export function checkAll(snap: Snapshot): Record<string, Finding[]> {
  const result: Record<string, Finding[]> = {};
  for (const block of snap.blocks) result[block.id] = checkBlock(block, snap);
  return result;
}

/**
 * What would a change introduce? Returns the conflicts and warnings that exist after the
 * change but not before, with two-sided findings (e.g. John double-booked on A and B)
 * reported once — from the changed block's side when `changedBlockId` is given.
 * Staffing gaps ("needs 3 people") never require confirmation.
 */
export function introducedFindings(before: Snapshot, after: Snapshot, changedBlockId?: string): Finding[] {
  const had = new Set(Object.values(checkAll(before)).flat().map((f) => f.key));
  const seen = new Set<string>();
  const out: Finding[] = [];
  // Describe two-sided problems from the point of view of the block being changed.
  const all = Object.values(checkAll(after))
    .flat()
    .sort((a, b) => Number(b.blockId === changedBlockId) - Number(a.blockId === changedBlockId));
  for (const f of all) {
    if (f.severity === "info" || had.has(f.key) || seen.has(f.dedupeKey)) continue;
    seen.add(f.dedupeKey);
    out.push(f);
  }
  return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

export function severityRank(s: Severity): number {
  return s === "conflict" ? 0 : s === "warning" ? 1 : 2;
}

/** Worst severity in a list, or null when empty. */
export function worstSeverity(findings: Finding[]): Severity | null {
  if (!findings.length) return null;
  return findings.reduce<Severity>((worst, f) => (severityRank(f.severity) < severityRank(worst) ? f.severity : worst), "info");
}

/** Apply a change to a copy of the snapshot. */
export function withBlock(snap: Snapshot, block: EBlock): Snapshot {
  const exists = snap.blocks.some((b) => b.id === block.id);
  return {
    ...snap,
    blocks: exists ? snap.blocks.map((b) => (b.id === block.id ? block : b)) : [...snap.blocks, block],
  };
}
