"use client";

import clsx from "clsx";
import { worstSeverity } from "@/lib/engine/conflicts";
import type { Finding } from "@/lib/engine/types";
import { fmtMinShort } from "@/lib/time";
import type { BoardBlock, BoardEmployee, BoardEquipment } from "./types";

export function SeverityBadge({ findings, className }: { findings: Finding[]; className?: string }) {
  const worst = worstSeverity(findings);
  if (!worst) return null;
  const count = findings.filter((f) => f.severity === worst).length;
  return (
    <span
      className={clsx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold",
        worst === "conflict" ? "bg-red-600 text-white" : worst === "warning" ? "bg-amber-400 text-slate-950" : "bg-slate-200 text-slate-600",
        className,
      )}
      title={findings.map((f) => `${f.title}: ${f.message}`).join("\n")}
    >
      {worst === "info" ? "…" : "!"}
      {worst !== "info" && count > 1 ? count : ""}
    </span>
  );
}

export function blockColors(block: Pick<BoardBlock, "state" | "progress">) {
  if (block.progress === "DONE") return "border-green-600 bg-green-50 text-green-900";
  if (block.progress === "ACTIVE") return "border-violet-700 bg-violet-600 text-white";
  if (block.progress === "CANNOT_PROCEED") return "border-orange-600 bg-orange-100 text-orange-900";
  return block.state === "COMMITTED" ? "border-blue-700 bg-blue-600 text-white" : "tentative border-sky-500 bg-sky-50 text-sky-900";
}

/** A scheduled piece of work on the board. */
export function BlockChip({
  block,
  findings,
  employees,
  equipment,
  dimmed,
  selected,
  onSelect,
}: {
  block: BoardBlock;
  findings: Finding[];
  employees: Record<string, BoardEmployee>;
  equipment: Record<string, BoardEquipment>;
  dimmed?: boolean;
  selected?: boolean;
  onSelect: () => void;
}) {
  const visible = findings.filter((f) => f.severity !== "info");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "block w-full rounded-md border-2 px-1.5 py-1 text-left text-xs shadow-sm transition",
        blockColors(block),
        dimmed && "opacity-35",
        selected && "ring-2 ring-yellow-400 ring-offset-1",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[11px] opacity-90">
          {fmtMinShort(block.startMin)}–{fmtMinShort(block.endMin)}
        </span>
        <SeverityBadge findings={visible.length ? visible : findings} />
      </div>
      <div className="truncate font-semibold leading-tight">{block.name}</div>
      <div className="truncate text-[11px] opacity-80">
        📍 {block.city}
        {block.state === "TENTATIVE" && block.progress === "PLANNED" && " · tentative"}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
        {block.employeeIds.map((id) => (
          <span
            key={id}
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-1 ring-white/70"
            style={{ background: employees[id]?.color ?? "#64748b" }}
            title={employees[id]?.name}
          >
            {employees[id]?.name.slice(0, 2) ?? "?"}
          </span>
        ))}
        {Array.from({ length: Math.max(0, block.estCrewSize - block.employeeIds.length) }).map((_, i) => (
          <span key={i} className="inline-block h-4 w-4 rounded-full border border-dashed border-current opacity-60" title="Open seat" />
        ))}
        {block.equipmentIds.map((id) => (
          <span key={id} className="rounded bg-black/15 px-1 text-[10px] font-semibold" title={equipment[id]?.name}>
            {equipment[id]?.unitCode ?? "?"}
          </span>
        ))}
      </div>
    </button>
  );
}
