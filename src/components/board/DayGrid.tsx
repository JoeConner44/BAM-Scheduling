"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { EQUIPMENT_TYPE_ICON } from "@/lib/labels";
import { fmtMinShort, fmtRange } from "@/lib/time";
import { SeverityBadge, blockColors } from "./BlockChip";
import { Draggable, Droppable } from "./dnd";
import { snap } from "./availability";
import type { BoardBlock, BoardData, BoardEmployee } from "./types";

export const DAY_START = 6 * 60;
export const DAY_END = 20 * 60;
export const PX_PER_MIN = 1.6; // 96px per hour
const LABEL_W = 176;
const WIDTH = (DAY_END - DAY_START) * PX_PER_MIN;

const x = (min: number) => (Math.max(DAY_START, Math.min(DAY_END, min)) - DAY_START) * PX_PER_MIN;

/** Put overlapping blocks on separate lanes so nothing hides behind anything else. */
function packLanes(blocks: BoardBlock[]) {
  const lanes: number[] = [];
  const laneOf: Record<string, number> = {};
  for (const b of [...blocks].sort((a, c) => a.startMin - c.startMin)) {
    let lane = lanes.findIndex((end) => end <= b.startMin);
    if (lane === -1) lane = lanes.push(0) - 1;
    lanes[lane] = b.endMin;
    laneOf[b.id] = lane;
  }
  return { laneOf, count: Math.max(1, lanes.length) };
}

/**
 * Day view: a time axis left→right. Blocks are drawn to scale so overlaps and travel gaps
 * are obvious. Drag a project to a time, drag a block sideways to move it, or drag its
 * right edge to change how long it runs.
 */
export function DayGrid({
  data,
  employees,
  cityFilter,
  selectedBlockId,
  onSelect,
  onResize,
}: {
  data: BoardData;
  employees: Record<string, BoardEmployee>;
  cityFilter: string;
  selectedBlockId: string | null;
  onSelect: (id: string) => void;
  onResize: (blockId: string, endMin: number) => void;
}) {
  const day = data.days[0];
  const blocks = data.blocks.filter((b) => b.day === day);
  const { laneOf, count } = packLanes(blocks);
  const LANE_H = 76;

  const [resize, setResize] = useState<{ id: string; startMin: number; endMin: number } | null>(null);
  const origin = useRef<{ clientX: number; endMin: number } | null>(null);

  const startResize = (e: React.PointerEvent, b: BoardBlock) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    origin.current = { clientX: e.clientX, endMin: b.endMin };
    setResize({ id: b.id, startMin: b.startMin, endMin: b.endMin });
  };
  const moveResize = (e: React.PointerEvent) => {
    if (!resize || !origin.current) return;
    const end = snap(origin.current.endMin + (e.clientX - origin.current.clientX) / PX_PER_MIN);
    setResize({ ...resize, endMin: Math.max(resize.startMin + 15, Math.min(24 * 60, end)) });
  };
  const endResize = () => {
    if (resize && origin.current && resize.endMin !== origin.current.endMin) onResize(resize.id, resize.endMin);
    origin.current = null;
    setResize(null);
  };

  return (
    <div className="min-w-max select-none">
      {/* Hours header */}
      <div className="sticky top-0 z-20 flex border-b border-slate-300 bg-slate-100">
        <div className="sticky left-0 z-10 shrink-0 bg-slate-100 p-2 text-xs font-semibold uppercase text-slate-500" style={{ width: LABEL_W }}>
          Time
        </div>
        <div className="relative h-8" style={{ width: WIDTH }}>
          {HOURS.map((h) => (
            <div key={h} className="absolute top-0 h-full border-l border-slate-300 pl-1 text-xs font-semibold text-slate-600" style={{ left: x(h) }}>
              {fmtMinShort(h)}
            </div>
          ))}
        </div>
      </div>

      {/* Jobs lane */}
      <SectionBar label="Jobs" hint="Drop a project at a time · drag a job sideways to move it · drag its right edge to resize" />
      <Row label={<span className="text-xs text-slate-500">All work this day</span>}>
        <Droppable id={`tl:${day}`} data={{ kind: "timeline", day }} className="relative bg-white" style={{ width: WIDTH, height: count * LANE_H + 8 }}>
          <Axis />
          {blocks.map((b) => {
            const live = resize?.id === b.id ? resize : b;
            return (
              <Draggable
                key={b.id}
                id={`block:${b.id}`}
                data={{ kind: "block", blockId: b.id, label: b.label }}
                disabled={b.progress === "DONE" || resize?.id === b.id}
                className="absolute"
                style={{ left: x(live.startMin), width: Math.max(28, x(live.endMin) - x(live.startMin)), top: 4 + laneOf[b.id] * LANE_H, height: LANE_H - 6 }}
              >
                <div
                  onClick={() => onSelect(b.id)}
                  className={clsx(
                    "relative h-full overflow-hidden rounded-md border-2 px-1.5 py-1 text-xs shadow-sm",
                    blockColors(b),
                    cityFilter && b.city !== cityFilter && "opacity-35",
                    selectedBlockId === b.id && "ring-2 ring-yellow-400 ring-offset-1",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-mono text-[11px]">{fmtRange(live.startMin, live.endMin)}</span>
                    <SeverityBadge findings={data.findings[b.id] ?? []} />
                  </div>
                  <div className="truncate font-semibold">{b.name}</div>
                  <div className="truncate text-[11px] opacity-80">
                    📍 {b.city} · {b.employeeIds.map((id) => employees[id]?.name).join(", ") || "no one yet"}
                  </div>
                  {b.progress !== "DONE" && (
                    <div
                      onPointerDown={(e) => startResize(e, b)}
                      onPointerMove={moveResize}
                      onPointerUp={endResize}
                      className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-black/10 hover:bg-black/25"
                      title="Drag to change end time"
                    />
                  )}
                </div>
              </Draggable>
            );
          })}
        </Droppable>
      </Row>

      <SectionBar label="People" hint="Drop a project on a person's row to schedule it with them · drag a job here to assign" />
      {data.employees.map((emp) => {
        const offs = emp.off[day] ?? [];
        const theirs = blocks.filter((b) => b.employeeIds.includes(emp.id));
        return (
          <Row
            key={emp.id}
            label={
              <>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: emp.color }} />
                <Link href={`/employees/${emp.id}`} className="truncate text-sm font-semibold hover:underline">
                  {emp.name}
                </Link>
              </>
            }
          >
            <Droppable
              id={`emp:${emp.id}:${day}`}
              data={{ kind: "employee", employeeId: emp.id, day, timeline: true }}
              label={emp.name}
              className="relative h-11 bg-white"
              style={{ width: WIDTH }}
            >
              {/* Outside normal hours */}
              <div className="absolute inset-y-0 bg-slate-100" style={{ left: 0, width: x(emp.normalStartMin) }} />
              <div className="absolute inset-y-0 right-0 bg-slate-100" style={{ left: x(emp.normalEndMin) }} />
              <Axis />
              {offs.map((o, i) => {
                const s = o.startMin ?? DAY_START;
                const e = o.endMin ?? DAY_END;
                return (
                  <div
                    key={i}
                    className="absolute inset-y-1 flex items-center rounded bg-[repeating-linear-gradient(135deg,#334155_0_6px,#475569_6px_12px)] px-2 text-[11px] font-bold uppercase text-white"
                    style={{ left: x(s), width: x(e) - x(s) }}
                    title={o.note ?? undefined}
                  >
                    {o.type.toLowerCase()}
                  </div>
                );
              })}
              {theirs.map((b) => {
                const conflict = (data.findings[b.id] ?? []).some((f) => f.severity === "conflict" && f.employeeId === emp.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onSelect(b.id)}
                    className={clsx(
                      "absolute inset-y-1.5 truncate rounded border-2 px-1 text-left text-[11px] font-semibold",
                      blockColors(b),
                      conflict && "!border-red-600 !bg-red-100 !text-red-900",
                    )}
                    style={{ left: x(b.startMin), width: Math.max(20, x(b.endMin) - x(b.startMin)) }}
                    title={`${b.label} ${fmtRange(b.startMin, b.endMin)}`}
                  >
                    {conflict && "⚠️ "}
                    {b.name}
                  </button>
                );
              })}
            </Droppable>
          </Row>
        );
      })}

      <SectionBar label="Equipment" hint="Drag a job onto a truck or trailer to assign it" />
      {data.equipment.map((eq) => {
        const outOfService = eq.status === "OUT_OF_SERVICE" || eq.status === "MAINTENANCE";
        const down = outOfService ? (eq.maintenanceNote ?? "out of service") : eq.down[day];
        const theirs = blocks.filter((b) => b.equipmentIds.includes(eq.id));
        return (
          <Row
            key={eq.id}
            label={
              <>
                <span>{EQUIPMENT_TYPE_ICON[eq.type]}</span>
                <Link href={`/equipment/${eq.id}`} className="truncate text-sm font-semibold hover:underline">
                  {eq.name}
                </Link>
              </>
            }
          >
            <Droppable
              id={`eq:${eq.id}:${day}`}
              data={{ kind: "equipment", equipmentId: eq.id, day, timeline: true }}
              label={eq.name}
              className={clsx("relative h-10", down ? "bg-[repeating-linear-gradient(135deg,#fef2f2_0_6px,#fee2e2_6px_12px)]" : "bg-white")}
              style={{ width: WIDTH }}
            >
              <Axis />
              {down && <div className="absolute left-2 top-2 rounded bg-red-700 px-1.5 text-[11px] font-semibold text-white">🔧 {down}</div>}
              {theirs.map((b) => {
                const conflict = (data.findings[b.id] ?? []).some((f) => f.severity === "conflict" && f.equipmentId === eq.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onSelect(b.id)}
                    className={clsx(
                      "absolute inset-y-1.5 truncate rounded border-2 px-1 text-left text-[11px] font-semibold",
                      blockColors(b),
                      conflict && "!border-red-600 !bg-red-100 !text-red-900",
                    )}
                    style={{ left: x(b.startMin), width: Math.max(20, x(b.endMin) - x(b.startMin)) }}
                    title={`${b.label} ${fmtRange(b.startMin, b.endMin)}`}
                  >
                    {conflict && "⚠️ "}
                    {b.name}
                  </button>
                );
              })}
            </Droppable>
          </Row>
        );
      })}
    </div>
  );
}

const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START + i * 60);

function Axis() {
  return (
    <>
      {HOURS.map((h) => (
        <div key={h} className="pointer-events-none absolute inset-y-0 border-l border-slate-200" style={{ left: x(h) }} />
      ))}
    </>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex border-b border-slate-200">
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-2 py-1.5" style={{ width: LABEL_W }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function SectionBar({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex bg-slate-800 text-white">
      <div className="sticky left-0 z-10 shrink-0 bg-slate-800 px-2 py-1 text-xs font-bold uppercase tracking-wider" style={{ width: LABEL_W }}>
        {label}
      </div>
      <div className="px-2 py-1 text-[11px] text-slate-300">{hint}</div>
    </div>
  );
}

/** Convert a pointer x position over a timeline row to a snapped time of day. */
export function timeAtX(clientX: number, rowLeft: number) {
  return snap(DAY_START + (clientX - rowLeft) / PX_PER_MIN);
}
