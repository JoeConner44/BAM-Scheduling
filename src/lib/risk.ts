import "server-only";
import type { Finding } from "./engine/types";
import { daysBetween, fmtDay, type Day } from "./time";
import type { ProjectCardData } from "./data";

export interface RiskItem {
  projectId: string;
  label: string;
  reasons: string[];
  level: "high" | "medium";
}

/**
 * Projects that may miss a deadline or inspection, or that don't have the people or
 * equipment they need. Explains the reason in plain words; never changes anything.
 */
export function jobsAtRisk(
  cards: ProjectCardData[],
  findingsByBlock: Record<string, Finding[]>,
  blockProject: Record<string, string>,
  today: Day,
): RiskItem[] {
  const findingsByProject: Record<string, Finding[]> = {};
  for (const [blockId, fs] of Object.entries(findingsByBlock)) {
    const pid = blockProject[blockId];
    if (pid) (findingsByProject[pid] ??= []).push(...fs);
  }

  const out: RiskItem[] = [];
  for (const p of cards) {
    const reasons: string[] = [];
    let high = false;
    const fs = findingsByProject[p.id] ?? [];

    for (const [label, date] of [
      ["Deadline", p.deadline],
      ["Inspection", p.inspectionDate],
    ] as const) {
      if (!date) continue;
      const days = daysBetween(today, date);
      if (days < 0) {
        reasons.push(`${label} ${fmtDay(date)} has passed`);
        high = true;
      } else if (days <= 7 && p.unscheduledHours > 0) {
        reasons.push(`${label} ${fmtDay(date)} — ${p.unscheduledHours.toFixed(1).replace(/\.0$/, "")} hrs not scheduled yet`);
        high ||= days <= 3;
      }
    }
    if (fs.some((f) => f.code === "PAST_DEADLINE" || f.code === "PAST_INSPECTION")) {
      reasons.push("Scheduled after its deadline/inspection");
      high = true;
    }
    const people = fs.filter((f) => f.code === "EMPLOYEE_TIME_OFF" || f.code === "EMPLOYEE_OVERLAP");
    if (people.length) {
      reasons.push(`Workforce problem: ${[...new Set(people.map((f) => f.subject))].join(", ")}`);
      high = true;
    }
    const gear = fs.filter((f) => f.code === "EQUIPMENT_OVERLAP" || f.code === "EQUIPMENT_UNAVAILABLE");
    if (gear.length) {
      reasons.push(`Equipment problem: ${[...new Set(gear.map((f) => f.subject))].join(", ")}`);
      high = true;
    }
    const soon = p.blocks.filter((b) => daysBetween(today, b.day) <= 2).map((b) => b.id);
    if (fs.some((f) => (f.code === "UNDERSTAFFED" || f.code === "MISSING_SKILL" || f.code === "MISSING_EQUIPMENT") && soon.includes(f.blockId))) {
      reasons.push("Not fully staffed/equipped for the next visit");
    }
    if (fs.some((f) => f.code === "WEATHER")) reasons.push("Rain forecast on a scheduled day");

    if (reasons.length) out.push({ projectId: p.id, label: p.label, reasons, level: high ? "high" : "medium" });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
}
