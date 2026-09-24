"use client";

import clsx from "clsx";
import Link from "next/link";
import { EQUIPMENT_TYPE_ICON } from "@/lib/labels";
import { dayOfWeek, fmtDay, fmtMinShort, fmtRange } from "@/lib/time";
import { BlockChip } from "./BlockChip";
import { Draggable, Droppable } from "./dnd";
import type { BoardData, BoardEmployee, BoardEquipment } from "./types";
import { WeatherBadge } from "./WeatherBadge";

/**
 * Week view: dates across the top; a JOBS row, then one row per person and per piece of
 * equipment. Drop a project on a day to pencil it in, on a person's day to schedule it with
 * them, or drag a job onto a person/truck to assign it.
 */
export function WeekGrid({
  data,
  employees,
  equipment,
  cityFilter,
  selectedBlockId,
  onSelect,
}: {
  data: BoardData;
  employees: Record<string, BoardEmployee>;
  equipment: Record<string, BoardEquipment>;
  cityFilter: string;
  selectedBlockId: string | null;
  onSelect: (id: string) => void;
}) {
  const cols = `minmax(8.5rem, 10rem) repeat(${data.days.length}, minmax(10rem, 1fr))`;
  const byDay = (day: string) => data.blocks.filter((b) => b.day === day).sort((a, b) => a.startMin - b.startMin);

  return (
    <div className="min-w-max">
      {/* Header */}
      <div className="sticky top-0 z-20 grid border-b border-slate-300 bg-slate-100" style={{ gridTemplateColumns: cols }}>
        <div className="sticky left-0 z-10 bg-slate-100 p-2 text-xs font-semibold uppercase text-slate-500">Week</div>
        {data.days.map((day) => (
          <div key={day} className={clsx("border-l border-slate-300 p-2", day === data.today && "bg-yellow-50")}>
            <div className="flex items-center justify-between gap-1">
              <Link href={`/board?view=day&date=${day}`} className="font-bold hover:underline">
                {fmtDay(day)}
                {day === data.today && <span className="ml-1 rounded bg-yellow-300 px-1 text-[10px] uppercase">Today</span>}
              </Link>
              <WeatherBadge weather={data.weather[day] ?? []} blocks={data.blocks.filter((b) => b.day === day)} />
            </div>
          </div>
        ))}
      </div>

      {/* Jobs row */}
      <SectionLabel cols={cols} label="Jobs" hint="Drop a project here to pencil it in" days={data.days.length} />
      <div className="grid border-b-2 border-slate-300" style={{ gridTemplateColumns: cols }}>
        <div className="sticky left-0 z-10 border-r border-slate-200 bg-white p-2 text-xs text-slate-500">All work this day</div>
        {data.days.map((day) => (
          <Droppable
            key={day}
            id={`day:${day}`}
            data={{ kind: "day", day }}
            className={clsx("min-h-24 space-y-1 border-l border-slate-200 p-1", day === data.today ? "bg-yellow-50/40" : "bg-white", isWeekend(day) && "bg-slate-50")}
          >
            {byDay(day).map((b) => (
              <Draggable key={b.id} id={`block:${b.id}`} data={{ kind: "block", blockId: b.id, label: b.label }} disabled={b.progress === "DONE"}>
                <BlockChip
                  block={b}
                  findings={data.findings[b.id] ?? []}
                  employees={employees}
                  equipment={equipment}
                  dimmed={!!cityFilter && b.city !== cityFilter}
                  selected={selectedBlockId === b.id}
                  onSelect={() => onSelect(b.id)}
                />
              </Draggable>
            ))}
          </Droppable>
        ))}
      </div>

      {/* People */}
      <SectionLabel cols={cols} label="People" hint="Drag a job onto a person to assign them" days={data.days.length} />
      {data.employees.map((emp) => (
        <div key={emp.id} className="grid border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
          <div className="sticky left-0 z-10 flex items-center gap-2 border-r border-slate-200 bg-white px-2 py-1.5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: emp.color }} />
            <div className="min-w-0">
              <Link href={`/employees/${emp.id}`} className="block truncate text-sm font-semibold hover:underline">
                {emp.name}
              </Link>
              <div className="truncate text-[11px] text-slate-500">{emp.position}</div>
            </div>
          </div>
          {data.days.map((day) => {
            const offs = emp.off[day] ?? [];
            const fullOff = offs.find((o) => o.startMin === null);
            const nonWorkDay = !emp.workDays.includes(dayOfWeek(day));
            const theirs = data.blocks.filter((b) => b.day === day && b.employeeIds.includes(emp.id)).sort((a, b) => a.startMin - b.startMin);
            return (
              <Droppable
                key={day}
                id={`emp:${emp.id}:${day}`}
                data={{ kind: "employee", employeeId: emp.id, day, timeline: false }}
                label={emp.name}
                className={clsx(
                  "min-h-12 space-y-0.5 border-l border-slate-200 p-1",
                  fullOff ? "bg-[repeating-linear-gradient(135deg,#f1f5f9_0_6px,#e2e8f0_6px_12px)]" : nonWorkDay ? "bg-slate-50" : "bg-white",
                )}
              >
                {offs.map((o, i) => (
                  <div key={i} className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-white" title={o.note ?? undefined}>
                    {o.type === "VACATION" ? "🏖️" : o.type === "SICK" ? "🤒" : "⛔"} {o.type.toLowerCase()}
                    {o.startMin !== null && o.endMin !== null && <span className="font-normal normal-case"> {fmtRange(o.startMin, o.endMin)}</span>}
                  </div>
                ))}
                {theirs.map((b) => (
                  <AssignmentChip
                    key={b.id}
                    id={`asg:emp:${emp.id}:${b.id}`}
                    resource="employee"
                    resourceId={emp.id}
                    block={b}
                    conflict={(data.findings[b.id] ?? []).some((f) => f.severity === "conflict" && f.employeeId === emp.id)}
                    warning={(data.findings[b.id] ?? []).some((f) => f.severity === "warning" && (f.employeeId === emp.id || f.code === "TRAVEL"))}
                    dimmed={!!cityFilter && b.city !== cityFilter}
                    onSelect={() => onSelect(b.id)}
                  />
                ))}
              </Droppable>
            );
          })}
        </div>
      ))}

      {/* Equipment */}
      <SectionLabel cols={cols} label="Equipment" hint="Drag a job onto a truck or trailer to assign it" days={data.days.length} />
      {data.equipment.map((eq) => {
        const outOfService = eq.status === "OUT_OF_SERVICE" || eq.status === "MAINTENANCE";
        return (
          <div key={eq.id} className="grid border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
            <div className="sticky left-0 z-10 flex items-center gap-2 border-r border-slate-200 bg-white px-2 py-1.5">
              <span className="text-base">{EQUIPMENT_TYPE_ICON[eq.type]}</span>
              <div className="min-w-0">
                <Link href={`/equipment/${eq.id}`} className="block truncate text-sm font-semibold hover:underline">
                  {eq.name}
                </Link>
                <div className={clsx("truncate text-[11px]", outOfService ? "font-semibold text-red-600" : "text-slate-500")}>
                  {outOfService ? (eq.status === "MAINTENANCE" ? "Maintenance" : "Out of service") : eq.unitCode}
                </div>
              </div>
            </div>
            {data.days.map((day) => {
              const theirs = data.blocks.filter((b) => b.day === day && b.equipmentIds.includes(eq.id)).sort((a, b) => a.startMin - b.startMin);
              const down = outOfService ? (eq.maintenanceNote ?? eq.status.replaceAll("_", " ").toLowerCase()) : eq.down[day];
              return (
                <Droppable
                  key={day}
                  id={`eq:${eq.id}:${day}`}
                  data={{ kind: "equipment", equipmentId: eq.id, day, timeline: false }}
                  label={eq.name}
                  className={clsx(
                    "min-h-11 space-y-0.5 border-l border-slate-200 p-1",
                    down ? "bg-[repeating-linear-gradient(135deg,#fef2f2_0_6px,#fee2e2_6px_12px)]" : "bg-white",
                  )}
                >
                  {down && <div className="rounded bg-red-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">🔧 {down}</div>}
                  {theirs.map((b) => (
                    <AssignmentChip
                      key={b.id}
                      id={`asg:eq:${eq.id}:${b.id}`}
                      resource="equipment"
                      resourceId={eq.id}
                      block={b}
                      conflict={(data.findings[b.id] ?? []).some((f) => f.severity === "conflict" && f.equipmentId === eq.id)}
                      warning={false}
                      dimmed={!!cityFilter && b.city !== cityFilter}
                      onSelect={() => onSelect(b.id)}
                    />
                  ))}
                </Droppable>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function isWeekend(day: string) {
  const d = dayOfWeek(day);
  return d === 0 || d === 6;
}

function SectionLabel({ cols, label, hint, days }: { cols: string; label: string; hint: string; days: number }) {
  return (
    <div className="grid bg-slate-800 text-white" style={{ gridTemplateColumns: cols }}>
      <div className="sticky left-0 z-10 bg-slate-800 px-2 py-1 text-xs font-bold uppercase tracking-wider">{label}</div>
      <div className="px-2 py-1 text-[11px] text-slate-300" style={{ gridColumn: `span ${days}` }}>
        {hint}
      </div>
    </div>
  );
}

function AssignmentChip({
  id,
  resource,
  resourceId,
  block,
  conflict,
  warning,
  dimmed,
  onSelect,
}: {
  id: string;
  resource: "employee" | "equipment";
  resourceId: string;
  block: BoardData["blocks"][number];
  conflict: boolean;
  warning: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  return (
    <Draggable id={id} data={{ kind: "assignment", resource, resourceId, blockId: block.id, label: block.label }} disabled={block.progress === "DONE"}>
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          "flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[11px] leading-tight",
          block.state === "COMMITTED" ? "border-blue-300 bg-blue-50 text-blue-950" : "tentative border-sky-400 bg-sky-50 text-sky-900",
          block.progress === "DONE" && "border-green-300 bg-green-50 text-green-900",
          conflict && "border-2 border-red-600 bg-red-50 text-red-900",
          !conflict && warning && "border-2 border-amber-500",
          dimmed && "opacity-35",
        )}
        title={`${block.label} ${fmtRange(block.startMin, block.endMin)}`}
      >
        {conflict && <span>⚠️</span>}
        <span className="shrink-0 font-mono">{fmtMinShort(block.startMin)}</span>
        <span className="truncate font-semibold">{block.name}</span>
      </button>
    </Draggable>
  );
}
