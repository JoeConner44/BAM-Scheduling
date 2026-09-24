"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { assignEmployee, assignEquipment, createBlock, moveBlock, removeBlock } from "@/app/actions/schedule";
import { ProjectCard } from "@/components/ProjectCard";
import { PRIORITY_RANK } from "@/lib/labels";
import { addDays, fmtDay, fmtDayLong } from "@/lib/time";
import { defaultSlot } from "./availability";
import { BlockPanel } from "./BlockPanel";
import { DayGrid, timeAtX } from "./DayGrid";
import { Draggable, Droppable, type DragData, type DropData } from "./dnd";
import { SchedulerProvider, useScheduler } from "./Scheduler";
import type { BoardData } from "./types";
import { WeekGrid } from "./WeekGrid";

export function Board({ data }: { data: BoardData }) {
  return (
    <SchedulerProvider>
      <BoardInner data={data} />
    </SchedulerProvider>
  );
}

function pointerX(event: DragEndEvent) {
  const e = event.activatorEvent as MouseEvent | TouchEvent;
  const start = "touches" in e ? (e.touches[0] ?? e.changedTouches[0]).clientX : e.clientX;
  return start + event.delta.x;
}

function BoardInner({ data }: { data: BoardData }) {
  const router = useRouter();
  const { run, toast } = useScheduler();
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [city, setCity] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const employees = useMemo(() => Object.fromEntries(data.employees.map((e) => [e.id, e])), [data.employees]);
  const equipment = useMemo(() => Object.fromEntries(data.equipment.map((e) => [e.id, e])), [data.equipment]);
  const blocksById = useMemo(() => Object.fromEntries(data.blocks.map((b) => [b.id, b])), [data.blocks]);

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));

  // TO DO sidebar: grouped by location so nearby work is easy to see together.
  const todo = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.todo
      .filter((p) => showAll || p.unscheduledHours > 0)
      .filter((p) => !city || p.city === city)
      .filter((p) => !q || `${p.name} ${p.customer} ${p.city} ${p.code}`.toLowerCase().includes(q))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  }, [data.todo, showAll, city, search]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof todo>();
    for (const p of todo) m.set(p.city, [...(m.get(p.city) ?? []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [todo]);

  const onDragStart = (e: DragStartEvent) => setDragging(e.active.data.current as DragData);

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const drag = event.active.data.current as DragData | undefined;
    const drop = event.over?.data.current as DropData | undefined;
    if (!drag || !drop) return;
    const overRect = event.over!.rect;

    // A project from the TO DO list → create a block.
    if (drag.kind === "project") {
      if (drop.kind === "unschedule") return;
      const employeeId = drop.kind === "employee" ? drop.employeeId : undefined;
      const equipmentId = drop.kind === "equipment" ? drop.equipmentId : undefined;
      let slot = defaultSlot(data, drop.day, drag.hours, employeeId, equipmentId);
      if (drop.kind === "timeline" || ((drop.kind === "employee" || drop.kind === "equipment") && drop.timeline)) {
        const startMin = timeAtX(pointerX(event), overRect.left);
        slot = { startMin, endMin: Math.min(24 * 60, startMin + (slot.endMin - slot.startMin)) };
      }
      run(
        (opts) =>
          createBlock(
            { projectId: drag.projectId, day: drop.day, ...slot, employeeIds: employeeId ? [employeeId] : [], equipmentIds: equipmentId ? [equipmentId] : [] },
            opts,
          ),
        { verb: "Schedule anyway", onDone: (r) => r.ok && setSelected(r.blockId) },
      );
      return;
    }

    // An existing block.
    if (drag.kind === "block") {
      const block = blocksById[drag.blockId];
      if (!block) return;
      if (drop.kind === "unschedule") {
        run(() => removeBlock({ blockId: block.id }));
        return;
      }
      if (drop.kind === "day") {
        if (drop.day !== block.day) run((opts) => moveBlock({ blockId: block.id, day: drop.day, startMin: block.startMin, endMin: block.endMin }, opts), { verb: "Move anyway" });
        return;
      }
      if (drop.kind === "timeline") {
        const left = event.active.rect.current.translated?.left ?? overRect.left;
        const startMin = timeAtX(left, overRect.left);
        const endMin = Math.min(24 * 60, startMin + (block.endMin - block.startMin));
        run((opts) => moveBlock({ blockId: block.id, day: drop.day, startMin, endMin }, opts), { verb: "Move anyway" });
        return;
      }
      if (drop.day !== block.day) {
        toast(`${block.name} is on ${fmtDay(block.day)}. Move it on the Jobs row first, or drop it on ${fmtDay(block.day)}.`, "error");
        return;
      }
      if (drop.kind === "employee") run((opts) => assignEmployee({ blockId: block.id, employeeId: drop.employeeId }, opts), { verb: "Assign anyway" });
      if (drop.kind === "equipment") run((opts) => assignEquipment({ blockId: block.id, equipmentId: drop.equipmentId }, opts), { verb: "Assign anyway" });
      return;
    }

    // An existing assignment dragged to another person/unit → reassign.
    if (drag.kind === "assignment") {
      const block = blocksById[drag.blockId];
      if (!block) return;
      if (drag.resource === "employee" && drop.kind === "employee") {
        if (drop.employeeId === drag.resourceId) return;
        if (drop.day !== block.day) return toast("To move the job to another day, drag it on the Jobs row.", "error");
        run((opts) => assignEmployee({ blockId: block.id, employeeId: drop.employeeId, replaceEmployeeId: drag.resourceId }, opts), { verb: "Reassign anyway" });
      } else if (drag.resource === "equipment" && drop.kind === "equipment") {
        if (drop.equipmentId === drag.resourceId) return;
        if (drop.day !== block.day) return toast("To move the job to another day, drag it on the Jobs row.", "error");
        run((opts) => assignEquipment({ blockId: block.id, equipmentId: drop.equipmentId, replaceEquipmentId: drag.resourceId }, opts), {
          verb: "Reassign anyway",
        });
      }
    }
  };

  const onResize = (blockId: string, endMin: number) => {
    const b = blocksById[blockId];
    if (b) run((opts) => moveBlock({ blockId, day: b.day, startMin: b.startMin, endMin }, opts), { verb: "Change anyway" });
  };

  const step = data.view === "week" ? 7 : 1;
  const nav = (day: string) => `/board?view=${data.view}&date=${day}`;

  return (
    <DndContext id="schedule-board" sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex h-[calc(100vh-52px)] flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <button className="btn-secondary lg:hidden" onClick={() => setSidebarOpen((v) => !v)}>
            🗂️ TO DO
          </button>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {(["week", "day"] as const).map((v) => (
              <Link
                key={v}
                href={`/board?view=${v}&date=${v === "day" && data.view === "week" ? (data.days.includes(data.today) ? data.today : data.days[0]) : data.anchor}`}
                className={clsx("rounded-md px-3 py-1.5 text-sm font-semibold", data.view === v ? "bg-white shadow" : "text-slate-500")}
              >
                {v === "week" ? "Week" : "Day"}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Link className="btn-secondary px-2.5" href={nav(addDays(data.anchor, -step))} aria-label="Previous">
              ◀
            </Link>
            <Link className="btn-secondary" href={nav(data.today)}>
              Today
            </Link>
            <Link className="btn-secondary px-2.5" href={nav(addDays(data.anchor, step))} aria-label="Next">
              ▶
            </Link>
          </div>
          <div className="font-bold">
            {data.view === "week" ? `${fmtDay(data.days[0])} – ${fmtDay(data.days[data.days.length - 1])}` : fmtDayLong(data.days[0])}
          </div>
          <select className="input ml-auto w-auto" value={city} onChange={(e) => setCity(e.target.value)} aria-label="Location filter">
            <option value="">📍 All locations</option>
            {data.cities.map((c) => (
              <option key={c} value={c}>
                📍 {c}
              </option>
            ))}
          </select>
          <Legend />
        </div>

        <div className="relative flex min-h-0 flex-1">
          {/* TO DO sidebar */}
          <aside
            className={clsx(
              "z-30 flex w-80 shrink-0 flex-col border-r border-slate-200 bg-slate-50",
              sidebarOpen ? "absolute inset-y-0 left-0 shadow-xl lg:static lg:shadow-none" : "hidden lg:flex",
            )}
          >
            <Droppable id="unschedule" data={{ kind: "unschedule" }} className="border-b border-slate-200 p-3" activeClassName="bg-rose-50 ring-2 ring-inset ring-rose-400">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">🗂️ TO DO</h2>
                <button className="text-xs font-semibold text-blue-700 lg:hidden" onClick={() => setSidebarOpen(false)}>
                  Hide
                </button>
              </div>
              <input className="input mt-2" placeholder="Search projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                Show all open projects (not only ones needing time)
              </label>
              <p className="mt-1 text-[11px] text-slate-500">Drag a card onto the board. Drag a job back here to unschedule it.</p>
            </Droppable>
            <div className="flex-1 space-y-4 overflow-y-auto p-3">
              {groups.map(([groupCity, cards]) => (
                <section key={groupCity}>
                  <h3 className="mb-1.5 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
                    <span>📍 {groupCity}</span>
                    <span className="rounded-full bg-slate-200 px-1.5">{cards.length}</span>
                  </h3>
                  <div className="space-y-2">
                    {cards.map((p) => (
                      <Draggable key={p.id} id={`proj:${p.id}`} data={{ kind: "project", projectId: p.id, hours: p.unscheduledHours || p.remainingHours, label: p.label }}>
                        <ProjectCard card={p} today={data.today} compact />
                        <div className="-mt-1 flex items-center justify-between rounded-b-lg border border-t-0 border-slate-200 bg-white px-2.5 pb-1.5 pt-2 text-[11px]">
                          <span className={clsx("font-semibold", p.unscheduledHours > 0 ? "text-rose-700" : "text-slate-500")}>
                            {p.unscheduledHours > 0 ? `${p.unscheduledHours.toFixed(1).replace(/\.0$/, "")} hrs to schedule` : "Fully scheduled"}
                          </span>
                          <button
                            className="font-semibold text-blue-700"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => router.push(`/projects/${p.id}`)}
                          >
                            Open
                          </button>
                        </div>
                      </Draggable>
                    ))}
                  </div>
                </section>
              ))}
              {!groups.length && <p className="text-sm text-slate-500">Nothing waiting to be scheduled{city ? ` in ${city}` : ""}. 🎉</p>}
            </div>
          </aside>

          {/* Board */}
          <div className="min-w-0 flex-1 overflow-auto">
            {data.view === "week" ? (
              <WeekGrid data={data} employees={employees} equipment={equipment} cityFilter={city} selectedBlockId={selected} onSelect={setSelected} />
            ) : (
              <DayGrid data={data} employees={employees} cityFilter={city} selectedBlockId={selected} onSelect={setSelected} onResize={onResize} />
            )}
          </div>
        </div>
      </div>

      {selected && <BlockPanel data={data} blockId={selected} onClose={() => setSelected(null)} />}

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="pointer-events-none max-w-56 rounded-lg border-2 border-blue-600 bg-white px-3 py-2 text-sm font-bold shadow-2xl">
            {dragging.kind === "assignment" ? (dragging.resource === "employee" ? "👷 " : "🚚 ") : dragging.kind === "project" ? "📦 " : "📅 "}
            {dragging.kind === "assignment" ? `${(dragging.resource === "employee" ? employees : equipment)[dragging.resourceId]?.name} → ?` : dragging.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Legend() {
  return (
    <details className="relative">
      <summary className="btn-secondary cursor-pointer list-none">Key</summary>
      <div className="absolute right-0 z-50 mt-1 w-64 space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-8 rounded border-2 border-blue-700 bg-blue-600" /> Committed
        </div>
        <div className="flex items-center gap-2">
          <span className="tentative inline-block h-4 w-8 rounded border-2 border-sky-500 bg-sky-50" /> Tentative (penciled in)
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-8 rounded border-2 border-violet-700 bg-violet-600" /> Crew working now
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-8 rounded border-2 border-green-600 bg-green-50" /> Finished visit
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-600 font-bold text-white">!</span> Conflict (double-booked, off, past due)
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 font-bold">!</span> Warning (travel, weather, hours)
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 font-bold">…</span> Still needs people/equipment
        </div>
      </div>
    </details>
  );
}
