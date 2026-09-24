import { Board } from "@/components/board/Board";
import type { BoardData, BoardEmployee, BoardEquipment, BoardWeather } from "@/components/board/types";
import { OFFICE, requireUser } from "@/lib/auth";
import { buildSnapshot, loadEmployees, loadEquipment, openProjects, projectInclude, projectLabel, toCard } from "@/lib/data";
import { db } from "@/lib/db";
import { checkAll } from "@/lib/engine/conflicts";
import { addDays, dateToDay, dayOfWeek, dayRange, dayToDate, isDay, today, type Day } from "@/lib/time";

export const metadata = { title: "Schedule · BAM Scheduling" };

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  await requireUser(OFFICE);
  const sp = await searchParams;
  const view = sp.view === "day" ? "day" : "week";
  const t = today();
  const anchor = typeof sp.date === "string" && isDay(sp.date) ? sp.date : t;
  // Week view rolls forward from the chosen day (dispatchers look ahead, not back), skipping Sundays.
  const days: Day[] = view === "day" ? [anchor] : dayRange(anchor, 7).filter((d) => dayOfWeek(d) !== 0);
  const from = days[0];
  const to = days[days.length - 1];

  const [blocks, employees, equipment, forecasts, open] = await Promise.all([
    db.scheduleBlock.findMany({
      where: { day: { gte: dayToDate(addDays(from, -1)), lte: dayToDate(addDays(to, 1)) } },
      include: { assignments: true, equipmentAssignments: true },
      orderBy: [{ day: "asc" }, { startMin: "asc" }],
    }),
    loadEmployees(),
    loadEquipment(),
    db.weatherForecast.findMany({ where: { day: { gte: dayToDate(from), lte: dayToDate(to) } }, include: { location: true } }),
    openProjects(),
  ]);
  const projects = await db.project.findMany({ where: { id: { in: [...new Set(blocks.map((b) => b.projectId))] } }, include: projectInclude });
  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));

  const snapshot = buildSnapshot({ blocks, projects, employees, equipment, forecasts });
  const findings = checkAll(snapshot);

  const visible = blocks.filter((b) => {
    const d = dateToDay(b.day);
    return d >= from && d <= to;
  });

  const boardEmployees: BoardEmployee[] = employees
    .filter((e) => e.active)
    .map((e) => {
      const off: BoardEmployee["off"] = {};
      for (const day of days) {
        const entries = e.timeOff.filter((o) => dateToDay(o.startDay) <= day && dateToDay(o.endDay) >= day);
        if (entries.length) off[day] = entries.map((o) => ({ startMin: o.startMin, endMin: o.endMin, type: o.type, note: o.note }));
      }
      return {
        id: e.id,
        name: e.name,
        color: e.color,
        position: e.position,
        skills: e.skills.map((s) => s.skill.name),
        active: e.active,
        workDays: e.workDays,
        normalStartMin: e.normalStartMin,
        normalEndMin: e.normalEndMin,
        off,
      };
    });

  const boardEquipment: BoardEquipment[] = equipment
    .filter((e) => e.active)
    .map((e) => {
      const down: BoardEquipment["down"] = {};
      for (const day of days) {
        const d = e.downtime.find((x) => dateToDay(x.startDay) <= day && dateToDay(x.endDay) >= day);
        if (d) down[day] = d.reason ?? "maintenance";
      }
      return { id: e.id, name: e.name, unitCode: e.unitCode, type: e.type, color: e.color, status: e.status, maintenanceNote: e.maintenanceNote, down };
    });

  const weather: Record<Day, BoardWeather[]> = {};
  for (const f of forecasts) {
    const d = dateToDay(f.day);
    (weather[d] ??= []).push({ locationId: f.locationId, city: f.location.city, precipChance: f.precipChance, summary: f.summary });
  }

  const data: BoardData = {
    today: t,
    view,
    anchor,
    days,
    blocks: visible.map((b) => {
      const p = projectById[b.projectId];
      return {
        id: b.id,
        projectId: b.projectId,
        name: p.name,
        city: p.city,
        locationId: p.locationId,
        label: projectLabel(p),
        priority: p.priority,
        projectStatus: p.status,
        day: dateToDay(b.day),
        startMin: b.startMin,
        endMin: b.endMin,
        state: b.state,
        progress: b.progress,
        employeeIds: b.assignments.map((a) => a.employeeId),
        equipmentIds: b.equipmentAssignments.map((a) => a.equipmentId),
        estCrewSize: p.estCrewSize,
      };
    }),
    employees: boardEmployees,
    equipment: boardEquipment,
    todo: open.map(toCard),
    findings: Object.fromEntries(visible.map((b) => [b.id, findings[b.id] ?? []])),
    weather,
    cities: [...new Set([...open.map((p) => p.city), ...projects.map((p) => p.city)])].sort(),
  };

  return <Board data={data} />;
}
