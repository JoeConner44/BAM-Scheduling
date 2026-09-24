import clsx from "clsx";
import type { ProjectCardData } from "@/lib/data";
import {
  EQUIPMENT_TYPE_ICON,
  EQUIPMENT_TYPE_LABEL,
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  PRIORITY_STRIPE,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from "@/lib/labels";
import { daysBetween, fmtDay, fmtHours, fmtMinShort, type Day } from "@/lib/time";

export function dateUrgency(day: Day | null, today: Day): "past" | "soon" | "later" | null {
  if (!day) return null;
  const d = daysBetween(today, day);
  return d < 0 ? "past" : d <= 2 ? "soon" : "later";
}

const URGENCY_CLASS = {
  past: "bg-red-600 text-white",
  soon: "bg-red-100 text-red-800",
  later: "bg-slate-100 text-slate-700",
};

/**
 * A project as a game piece. Shows the essentials at a glance: priority, where, how big,
 * how urgent, whether it's ready, and whether/when it's on the board.
 */
export function ProjectCard({ card, today, compact = false }: { card: ProjectCardData; today: Day; compact?: boolean }) {
  const deadline = dateUrgency(card.deadline, today);
  const inspection = dateUrgency(card.inspectionDate, today);
  const partlyDone = card.percentComplete > 0;

  return (
    <div className={clsx("rounded-lg border border-l-[6px] border-slate-200 bg-white p-2.5 text-left shadow-sm", PRIORITY_STRIPE[card.priority])}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold leading-tight text-slate-900">{card.name}</div>
          <div className="truncate text-xs text-slate-500">
            📍 {card.city} · {card.jobType ?? "Job"}
          </div>
        </div>
        <span className={clsx("chip shrink-0", PRIORITY_BADGE[card.priority])}>{PRIORITY_LABEL[card.priority]}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
        <span className="chip bg-slate-100 text-slate-700" title="Hours remaining">
          ⏱ {fmtHours(card.remainingHours)}
          {card.remainingHours !== card.estTotalHours && <span className="font-normal text-slate-500"> / {fmtHours(card.estTotalHours)}</span>}
        </span>
        <span className="chip bg-slate-100 text-slate-700" title="People needed">
          👷 {card.estCrewSize}
        </span>
        {card.requiredEquipment.map((r) => (
          <span key={r.type} className="chip bg-slate-100 text-slate-700" title={EQUIPMENT_TYPE_LABEL[r.type]}>
            {EQUIPMENT_TYPE_ICON[r.type]}
            {r.quantity > 1 && `×${r.quantity}`}
          </span>
        ))}
        {card.weatherSensitivity === "HIGH" && (
          <span className="chip bg-cyan-50 text-cyan-800" title="Very weather sensitive">
            ☔
          </span>
        )}
        {!card.surfaceReady && <span className="chip bg-yellow-100 text-yellow-800">Surface not ready</span>}
        {!card.customerReady && <span className="chip bg-yellow-100 text-yellow-800">Customer not ready</span>}
      </div>

      {(deadline || inspection) && (
        <div className="mt-1.5 flex flex-wrap gap-1 text-xs">
          {deadline && <span className={clsx("chip", URGENCY_CLASS[deadline])}>⏰ Due {fmtDay(card.deadline!)}</span>}
          {inspection && <span className={clsx("chip", URGENCY_CLASS[inspection])}>🔍 Inspection {fmtDay(card.inspectionDate!)}</span>}
        </div>
      )}

      {partlyDone && (
        <div className="mt-2">
          <div className="flex justify-between text-[11px] font-semibold text-amber-800">
            <span>{card.percentComplete}% complete</span>
            <span>{fmtHours(card.remainingHours)} remaining</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-200">
            <div className="h-full bg-amber-500" style={{ width: `${card.percentComplete}%` }} />
          </div>
        </div>
      )}

      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-1.5 text-xs">
          <span className={clsx("chip", PROJECT_STATUS_COLOR[card.status])}>{PROJECT_STATUS_LABEL[card.status]}</span>
          {card.blocks.map((b) => (
            <span
              key={b.id}
              className={clsx(
                "chip border",
                b.state === "COMMITTED" ? "border-blue-600 bg-blue-600 text-white" : "tentative border-sky-500 bg-sky-50 text-sky-800",
              )}
            >
              {fmtDay(b.day)} {fmtMinShort(b.startMin)}–{fmtMinShort(b.endMin)}
            </span>
          ))}
          {card.unscheduledHours > 0 && (
            <span className="chip bg-rose-50 text-rose-700">{card.blocks.length ? `${fmtHours(card.unscheduledHours)} still to schedule` : "Not scheduled"}</span>
          )}
        </div>
      )}
    </div>
  );
}
