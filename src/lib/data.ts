import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { DEFAULT_SETTINGS, isLive } from "./engine/conflicts";
import type { EBlock, EEmployee, EEquipment, EProject, Snapshot } from "./engine/types";
import { EQUIPMENT_TYPE_LABEL } from "./labels";
import { addDays, dateToDay, dayToDate, maybeDay, today, type Day } from "./time";

// ───────────────────────── Project shapes ─────────────────────────

export const projectInclude = {
  customer: true,
  jobType: true,
  location: true,
  requiredSkills: { include: { skill: true } },
  requiredEquipment: true,
  blocks: { orderBy: [{ day: "asc" }, { startMin: "asc" }] },
} satisfies Prisma.ProjectInclude;

export type ProjectWithRefs = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

export function projectLabel(p: { name: string; city: string }) {
  return `${p.name} — ${p.city}`;
}

/** Hours still to do: the crew's latest estimate if they gave one, otherwise estimate − actual. */
export function remainingHours(p: { estTotalHours: number; actualHours: number; remainingHoursOverride: number | null }) {
  return Math.max(0, p.remainingHoursOverride ?? p.estTotalHours - p.actualHours);
}

/** Remaining hours not yet covered by an open (not finished) block. */
export function unscheduledHours(p: ProjectWithRefs) {
  const planned = p.blocks.filter(isLive).reduce((sum, b) => sum + (b.endMin - b.startMin) / 60, 0);
  return Math.max(0, remainingHours(p) - planned);
}

export function toEProject(p: ProjectWithRefs): EProject {
  return {
    id: p.id,
    label: projectLabel(p),
    city: p.city,
    locationId: p.locationId,
    lat: p.lat ?? p.location?.lat ?? null,
    lng: p.lng ?? p.location?.lng ?? null,
    deadline: maybeDay(p.deadline),
    inspectionDate: maybeDay(p.inspectionDate),
    earliestDate: maybeDay(p.earliestDate),
    surfaceReady: p.surfaceReady,
    customerReady: p.customerReady,
    status: p.status,
    weatherSensitivity: p.weatherSensitivity,
    estCrewSize: p.estCrewSize,
    requiredSkills: p.requiredSkills.map((r) => ({ skillId: r.skillId, skillName: r.skill.name, minCount: r.minCount })),
    requiredEquipment: p.requiredEquipment.map((r) => ({ type: r.type, typeLabel: EQUIPMENT_TYPE_LABEL[r.type], quantity: r.quantity })),
  };
}

/** Everything a project card needs, as plain serializable data. */
export interface ProjectCardData {
  id: string;
  code: string;
  label: string;
  name: string;
  customer: string;
  city: string;
  state: string;
  locationId: string | null;
  address: string;
  jobType: string | null;
  priority: string;
  status: string;
  estTotalHours: number;
  remainingHours: number;
  unscheduledHours: number;
  estCrewSize: number;
  percentComplete: number;
  deadline: Day | null;
  inspectionDate: Day | null;
  earliestDate: Day | null;
  preferredDate: Day | null;
  surfaceReady: boolean;
  customerReady: boolean;
  weatherSensitivity: string;
  requiredEquipment: { type: string; quantity: number }[];
  requiredSkills: string[];
  blocks: { id: string; day: Day; startMin: number; endMin: number; state: string; progress: string }[];
}

export function toCard(p: ProjectWithRefs): ProjectCardData {
  return {
    id: p.id,
    code: p.code,
    label: projectLabel(p),
    name: p.name,
    customer: p.customer.name,
    city: p.city,
    state: p.state,
    locationId: p.locationId,
    address: [p.street, p.city, `${p.state} ${p.zip ?? ""}`.trim()].filter(Boolean).join(", "),
    jobType: p.jobType?.name ?? null,
    priority: p.priority,
    status: p.status,
    estTotalHours: p.estTotalHours,
    remainingHours: remainingHours(p),
    unscheduledHours: unscheduledHours(p),
    estCrewSize: p.estCrewSize,
    percentComplete: p.percentComplete,
    deadline: maybeDay(p.deadline),
    inspectionDate: maybeDay(p.inspectionDate),
    earliestDate: maybeDay(p.earliestDate),
    preferredDate: maybeDay(p.preferredDate),
    surfaceReady: p.surfaceReady,
    customerReady: p.customerReady,
    weatherSensitivity: p.weatherSensitivity,
    requiredEquipment: p.requiredEquipment.map((r) => ({ type: r.type, quantity: r.quantity })),
    requiredSkills: p.requiredSkills.map((r) => r.skill.name),
    blocks: p.blocks
      .filter(isLive)
      .map((b) => ({ id: b.id, day: dateToDay(b.day), startMin: b.startMin, endMin: b.endMin, state: b.state, progress: b.progress })),
  };
}

export async function openProjects() {
  return db.project.findMany({
    where: { status: { notIn: ["COMPLETE", "CANCELLED"] } },
    include: projectInclude,
    orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });
}

// ───────────────────────── Engine snapshot ─────────────────────────

const blockInclude = { assignments: true, equipmentAssignments: true } satisfies Prisma.ScheduleBlockInclude;
type BlockWithRefs = Prisma.ScheduleBlockGetPayload<{ include: typeof blockInclude }>;

export function toEBlock(b: BlockWithRefs): EBlock {
  return {
    id: b.id,
    projectId: b.projectId,
    day: dateToDay(b.day),
    startMin: b.startMin,
    endMin: b.endMin,
    state: b.state,
    progress: b.progress,
    employeeIds: b.assignments.map((a) => a.employeeId),
    equipmentIds: b.equipmentAssignments.map((a) => a.equipmentId),
  };
}

export async function loadEmployees() {
  return db.employee.findMany({
    include: { skills: { include: { skill: true } }, timeOff: { orderBy: { startDay: "asc" } } },
    orderBy: { name: "asc" },
  });
}

export async function loadEquipment() {
  return db.equipment.findMany({ include: { downtime: { orderBy: { startDay: "asc" } } }, orderBy: [{ type: "asc" }, { unitCode: "asc" }] });
}

export function toEEmployee(e: Awaited<ReturnType<typeof loadEmployees>>[number]): EEmployee {
  return {
    id: e.id,
    name: e.name,
    active: e.active,
    normalStartMin: e.normalStartMin,
    normalEndMin: e.normalEndMin,
    workDays: e.workDays,
    skillIds: e.skills.map((s) => s.skillId),
    timeOff: e.timeOff.map((t) => ({ startDay: dateToDay(t.startDay), endDay: dateToDay(t.endDay), startMin: t.startMin, endMin: t.endMin, type: t.type })),
  };
}

export function toEEquipment(e: Awaited<ReturnType<typeof loadEquipment>>[number]): EEquipment {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    status: e.status,
    active: e.active,
    maintenanceNote: e.maintenanceNote,
    downtime: e.downtime.map((d) => ({ startDay: dateToDay(d.startDay), endDay: dateToDay(d.endDay), reason: d.reason })),
  };
}

/**
 * Load what the engine needs to check blocks between `from` and `to` (inclusive).
 * One day of padding on each side keeps overlap and travel checks accurate at the edges.
 */
export async function loadSnapshot(from: Day, to: Day) {
  const [blocks, employees, equipment, forecasts] = await Promise.all([
    db.scheduleBlock.findMany({
      where: { day: { gte: dayToDate(addDays(from, -1)), lte: dayToDate(addDays(to, 1)) } },
      include: blockInclude,
      orderBy: [{ day: "asc" }, { startMin: "asc" }],
    }),
    loadEmployees(),
    loadEquipment(),
    db.weatherForecast.findMany({ where: { day: { gte: dayToDate(from), lte: dayToDate(to) } } }),
  ]);
  const projectIds = [...new Set(blocks.map((b) => b.projectId))];
  const projects = await db.project.findMany({ where: { id: { in: projectIds } }, include: projectInclude });
  return buildSnapshot({ blocks, projects, employees, equipment, forecasts });
}

/** Snapshot for checking a change to one block: loads that block's day (and project). */
export async function loadSnapshotForDay(day: Day, extraProjectIds: string[] = []) {
  const snap = await loadSnapshot(day, day);
  const missing = extraProjectIds.filter((id) => !snap.projects[id]);
  if (missing.length) {
    const extra = await db.project.findMany({ where: { id: { in: missing } }, include: projectInclude });
    for (const p of extra) snap.projects[p.id] = toEProject(p);
  }
  return snap;
}

export function buildSnapshot(input: {
  blocks: BlockWithRefs[];
  projects: ProjectWithRefs[];
  employees: Awaited<ReturnType<typeof loadEmployees>>;
  equipment: Awaited<ReturnType<typeof loadEquipment>>;
  forecasts: { locationId: string; day: Date; precipChance: number; summary: string | null }[];
}): Snapshot {
  return {
    blocks: input.blocks.map(toEBlock),
    projects: Object.fromEntries(input.projects.map((p) => [p.id, toEProject(p)])),
    employees: Object.fromEntries(input.employees.map((e) => [e.id, toEEmployee(e)])),
    equipment: Object.fromEntries(input.equipment.map((e) => [e.id, toEEquipment(e)])),
    forecasts: input.forecasts.map((f) => ({ locationId: f.locationId, day: dateToDay(f.day), precipChance: f.precipChance, summary: f.summary })),
    settings: { today: today(), ...DEFAULT_SETTINGS },
  };
}

// ───────────────────────── Locations ─────────────────────────

/** Find or create the Location for a city. Cities are never hard-coded. */
export async function ensureLocation(city: string, state: string, coords?: { lat: number | null; lng: number | null }) {
  const cleanCity = city.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const cleanState = state.trim().toUpperCase();
  return db.location.upsert({
    where: { city_state: { city: cleanCity, state: cleanState } },
    update: {},
    create: { city: cleanCity, state: cleanState, lat: coords?.lat ?? null, lng: coords?.lng ?? null },
  });
}
