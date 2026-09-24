import { isLive } from "@/lib/engine/conflicts";
import type { BoardBlock, BoardData, BoardEmployee, BoardEquipment } from "./types";

export type Availability =
  | { kind: "free" }
  | { kind: "off"; text: string }
  | { kind: "busy"; text: string }
  | { kind: "down"; text: string };

const overlaps = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) =>
  a.startMin < b.endMin && b.startMin < a.endMin;

/** Is this person free for this block? Used to label the "add person" list. */
export function employeeAvailability(emp: BoardEmployee, block: BoardBlock, data: BoardData): Availability {
  for (const off of emp.off[block.day] ?? []) {
    if (off.startMin === null || off.endMin === null || overlaps(block, { startMin: off.startMin, endMin: off.endMin })) {
      return { kind: "off", text: off.type.toLowerCase() + (off.startMin !== null ? " part of day" : "") };
    }
  }
  const clash = data.blocks.find((b) => b.id !== block.id && b.day === block.day && isLive(b) && b.employeeIds.includes(emp.id) && overlaps(b, block));
  if (clash) return { kind: "busy", text: `on ${clash.label}` };
  return { kind: "free" };
}

export function equipmentAvailability(eq: BoardEquipment, block: BoardBlock, data: BoardData): Availability {
  if (eq.status === "OUT_OF_SERVICE" || eq.status === "MAINTENANCE") return { kind: "down", text: eq.status === "MAINTENANCE" ? "maintenance" : "out of service" };
  if (eq.down[block.day]) return { kind: "down", text: `shop: ${eq.down[block.day]}` };
  const clash = data.blocks.find((b) => b.id !== block.id && b.day === block.day && isLive(b) && b.equipmentIds.includes(eq.id) && overlaps(b, block));
  if (clash) return { kind: "busy", text: `on ${clash.label}` };
  return { kind: "free" };
}

export const SNAP = 15;
export const snap = (min: number) => Math.round(min / SNAP) * SNAP;

/** Sensible default time for a project dropped on a day (optionally for one person). */
export function defaultSlot(data: BoardData, day: string, hours: number, employeeId?: string, equipmentId?: string) {
  const duration = Math.min(10 * 60, Math.max(60, snap(hours * 60)));
  let start = 8 * 60;
  if (employeeId || equipmentId) {
    const theirs = data.blocks.filter(
      (b) => b.day === day && isLive(b) && ((employeeId && b.employeeIds.includes(employeeId)) || (equipmentId && b.equipmentIds.includes(equipmentId))),
    );
    const lastEnd = Math.max(0, ...theirs.map((b) => b.endMin));
    if (lastEnd) start = Math.ceil((lastEnd + 30) / SNAP) * SNAP;
  }
  start = Math.min(start, 22 * 60);
  return { startMin: start, endMin: Math.min(24 * 60, start + duration) };
}
