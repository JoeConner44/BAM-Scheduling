"use client";

import { useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import {
  assignEmployee,
  assignEquipment,
  moveBlock,
  removeBlock,
  setBlockState,
  unassignEmployee,
  unassignEquipment,
} from "@/app/actions/schedule";
import { EQUIPMENT_TYPE_ICON, PRIORITY_BADGE, PRIORITY_LABEL, PROJECT_STATUS_LABEL } from "@/lib/labels";
import { fmtDayLong, fmtRange, parseHHMM, toHHMM } from "@/lib/time";
import { employeeAvailability, equipmentAvailability, type Availability } from "./availability";
import { FINDING_ICON } from "./ConflictDialog";
import { useScheduler } from "./Scheduler";
import type { BoardData } from "./types";

const AVAIL_STYLE: Record<Availability["kind"], string> = {
  free: "bg-emerald-100 text-emerald-800",
  busy: "bg-red-100 text-red-800",
  off: "bg-slate-200 text-slate-700",
  down: "bg-red-100 text-red-800",
};

/** Details for one scheduled block: times, tentative/committed, people, equipment, and why it's flagged. */
export function BlockPanel({ data, blockId, onClose }: { data: BoardData; blockId: string; onClose: () => void }) {
  const block = data.blocks.find((b) => b.id === blockId);
  const { run } = useScheduler();
  const [showAllPeople, setShowAllPeople] = useState(false);

  if (!block) return null;
  const findings = data.findings[block.id] ?? [];
  const done = block.progress === "DONE";
  const employees = data.employees;
  const assignedEmp = employees.filter((e) => block.employeeIds.includes(e.id));
  const assignedEq = data.equipment.filter((e) => block.equipmentIds.includes(e.id));
  const otherEmp = employees.filter((e) => !block.employeeIds.includes(e.id));
  const otherEq = data.equipment.filter((e) => !block.equipmentIds.includes(e.id));
  const freeFirst = <T,>(list: T[], avail: (x: T) => Availability) =>
    [...list].sort((a, b) => Number(avail(a).kind !== "free") - Number(avail(b).kind !== "free"));

  const onTimes = (form: FormData) => {
    const day = String(form.get("day"));
    const startMin = parseHHMM(String(form.get("start")));
    const endMin = parseHHMM(String(form.get("end")));
    if (startMin === null || endMin === null) return;
    run((opts) => moveBlock({ blockId: block.id, day, startMin, endMin }, opts), { verb: "Move anyway" });
  };

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-slate-300 bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:top-[52px] md:max-h-none md:w-[26rem] md:rounded-none md:border-l md:border-t-0">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-slate-200 bg-white p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={clsx("chip", PRIORITY_BADGE[block.priority])}>{PRIORITY_LABEL[block.priority]}</span>
            <span className="chip bg-slate-100 text-slate-700">{PROJECT_STATUS_LABEL[block.projectStatus]}</span>
          </div>
          <h2 className="mt-1 text-lg font-bold leading-tight">{block.label}</h2>
          <div className="text-sm text-slate-600">
            {fmtDayLong(block.day)} · {fmtRange(block.startMin, block.endMin)}
          </div>
          <Link href={`/projects/${block.projectId}`} className="text-sm font-semibold text-blue-700 hover:underline">
            Open project card →
          </Link>
        </div>
        <button onClick={onClose} className="btn-secondary px-2.5" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="space-y-5 p-4">
        {done && <div className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">✅ This visit is finished.</div>}

        {/* Tentative / committed */}
        {!done && (
          <div>
            <div className="label">Schedule status</div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
              {(["TENTATIVE", "COMMITTED"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => run(() => setBlockState({ blockId: block.id, state: s }))}
                  className={clsx(
                    "rounded-md py-2 text-sm font-bold",
                    block.state === s ? (s === "COMMITTED" ? "bg-blue-600 text-white shadow" : "tentative border-2 border-sky-500 bg-sky-50 text-sky-900") : "text-slate-500",
                  )}
                >
                  {s === "TENTATIVE" ? "✏️ Tentative" : "✅ Committed"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Findings */}
        {findings.length > 0 && (
          <div>
            <div className="label">Why it&apos;s flagged</div>
            <ul className="space-y-1.5">
              {findings.map((f) => (
                <li
                  key={f.key}
                  className={clsx(
                    "rounded-md border-l-4 p-2 text-sm",
                    f.severity === "conflict" ? "border-red-600 bg-red-50" : f.severity === "warning" ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-slate-50",
                  )}
                >
                  <span className="font-semibold">
                    {FINDING_ICON[f.code]} {f.title}:
                  </span>{" "}
                  {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Time */}
        {!done && (
          <form action={onTimes} key={`${block.day}-${block.startMin}-${block.endMin}`}>
            <div className="label">Day and time</div>
            <div className="grid grid-cols-3 gap-2">
              <input type="date" name="day" defaultValue={block.day} className="input col-span-3 sm:col-span-1" required />
              <input type="time" name="start" step={900} defaultValue={toHHMM(block.startMin)} className="input" required />
              <input type="time" name="end" step={900} defaultValue={toHHMM(block.endMin)} className="input" required />
            </div>
            <button className="btn-secondary mt-2 w-full">Update time</button>
          </form>
        )}

        {/* People */}
        <div>
          <div className="label">
            People ({block.employeeIds.length} of {block.estCrewSize} needed)
          </div>
          <ul className="space-y-1">
            {assignedEmp.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1.5">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="h-3 w-3 rounded-full" style={{ background: e.color }} />
                  {e.name}
                  <span className="text-xs font-normal text-slate-500">{e.skills.join(", ")}</span>
                </span>
                {!done && (
                  <button className="text-sm text-slate-400 hover:text-red-600" onClick={() => run(() => unassignEmployee({ blockId: block.id, employeeId: e.id }))} title="Remove">
                    ✕
                  </button>
                )}
              </li>
            ))}
            {!assignedEmp.length && <li className="text-sm text-slate-500">No one assigned yet.</li>}
          </ul>
          {!done && (
            <>
              <div className="mt-2 text-xs font-semibold text-slate-500">Add a person</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {freeFirst(otherEmp, (e) => employeeAvailability(e, block, data))
                  .filter((e) => showAllPeople || employeeAvailability(e, block, data).kind === "free")
                  .map((e) => {
                    const a = employeeAvailability(e, block, data);
                    return (
                      <button
                        key={e.id}
                        onClick={() => run((opts) => assignEmployee({ blockId: block.id, employeeId: e.id }, opts), { verb: "Assign anyway" })}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm hover:border-blue-500"
                        title={a.kind === "free" ? "Available" : a.text}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />
                        {e.name}
                        <span className={clsx("chip", AVAIL_STYLE[a.kind])}>{a.kind === "free" ? "free" : a.text}</span>
                      </button>
                    );
                  })}
              </div>
              <button className="mt-1 text-xs font-semibold text-blue-700" onClick={() => setShowAllPeople((v) => !v)}>
                {showAllPeople ? "Show only available people" : "Show everyone (including busy / off)"}
              </button>
            </>
          )}
        </div>

        {/* Equipment */}
        <div>
          <div className="label">Equipment</div>
          <ul className="space-y-1">
            {assignedEq.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 text-sm font-semibold">
                <span>
                  {EQUIPMENT_TYPE_ICON[e.type]} {e.name}
                </span>
                {!done && (
                  <button className="text-slate-400 hover:text-red-600" onClick={() => run(() => unassignEquipment({ blockId: block.id, equipmentId: e.id }))} title="Remove">
                    ✕
                  </button>
                )}
              </li>
            ))}
            {!assignedEq.length && <li className="text-sm text-slate-500">No equipment assigned yet.</li>}
          </ul>
          {!done && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {freeFirst(otherEq, (e) => equipmentAvailability(e, block, data)).map((e) => {
                const a = equipmentAvailability(e, block, data);
                return (
                  <button
                    key={e.id}
                    onClick={() => run((opts) => assignEquipment({ blockId: block.id, equipmentId: e.id }, opts), { verb: "Assign anyway" })}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm hover:border-blue-500"
                    title={a.kind === "free" ? "Available" : a.text}
                  >
                    {EQUIPMENT_TYPE_ICON[e.type]} {e.unitCode}
                    <span className={clsx("chip", AVAIL_STYLE[a.kind])}>{a.kind === "free" ? "free" : a.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!done && (
          <button
            className="btn-secondary w-full text-red-700"
            onClick={() =>
              run(() => removeBlock({ blockId: block.id }), {
                onDone: onClose,
              })
            }
          >
            ↩ Take off the schedule (back to TO DO)
          </button>
        )}
      </div>
    </aside>
  );
}
