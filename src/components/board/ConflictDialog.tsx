"use client";

import { useState } from "react";
import clsx from "clsx";
import type { Finding } from "@/lib/engine/types";
import { OVERRIDE_REASONS } from "@/lib/labels";

export const FINDING_ICON: Record<string, string> = {
  EMPLOYEE_OVERLAP: "👷",
  EQUIPMENT_OVERLAP: "🚚",
  EMPLOYEE_TIME_OFF: "🏖️",
  EMPLOYEE_INACTIVE: "🚫",
  EMPLOYEE_OUTSIDE_HOURS: "🕔",
  EMPLOYEE_OVERLOADED: "🥵",
  EQUIPMENT_UNAVAILABLE: "🔧",
  TRAVEL: "🚗",
  PAST_DEADLINE: "⏰",
  PAST_INSPECTION: "🔍",
  INSPECTION_DAY: "🔍",
  BEFORE_EARLIEST: "📆",
  NOT_READY: "🚧",
  WEATHER: "🌧️",
  UNDERSTAFFED: "👥",
  MISSING_SKILL: "🎓",
  MISSING_EQUIPMENT: "🧰",
};

/**
 * "⚠️ THIS CHANGE AFFECTS…" — shown whenever a change would create a conflict or warning.
 * Nothing is ever blocked: the user can cancel, or proceed and have the override recorded.
 */
export function ConflictDialog({
  findings,
  summary,
  verb,
  onCancel,
  onConfirm,
}: {
  findings: Finding[];
  summary: string;
  verb: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const hasConflict = findings.some((f) => f.severity === "conflict");
  const subjects = [...new Set(findings.map((f) => f.subject))];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-2 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className={clsx("rounded-t-2xl px-5 py-4 text-white", hasConflict ? "bg-red-600" : "bg-amber-500")}>
          <h2 id="conflict-title" className="text-lg font-bold">
            ⚠️ {hasConflict ? findings.find((f) => f.severity === "conflict")!.title.toUpperCase() : "PLEASE CHECK"}
          </h2>
          <p className="text-sm opacity-90">{summary}</p>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <div className="label">This change affects</div>
            <div className="flex flex-wrap gap-1.5">
              {subjects.map((s) => (
                <span key={s} className="chip bg-slate-900 px-2.5 py-1 text-sm text-white">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <ul className="space-y-2">
            {findings.map((f) => (
              <li
                key={f.key}
                className={clsx("rounded-lg border-l-4 p-3 text-sm", f.severity === "conflict" ? "border-red-600 bg-red-50" : "border-amber-500 bg-amber-50")}
              >
                <div className="font-bold">
                  {FINDING_ICON[f.code]} {f.title}
                </div>
                <div className="text-slate-700">{f.message}</div>
              </li>
            ))}
          </ul>

          <div>
            <label className="label" htmlFor="override-reason">
              Reason (optional — saved in the activity log)
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {OVERRIDE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={clsx("chip border px-2.5 py-1 text-xs", reason === r ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700")}
                >
                  {r}
                </button>
              ))}
            </div>
            <input id="override-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you making this change?" />
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-200 p-4">
          <button className="btn-secondary flex-1 py-3 text-base" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className={clsx("flex-1 py-3 text-base", hasConflict ? "btn-danger" : "btn-warning")} onClick={() => onConfirm(reason)}>
            {verb}
          </button>
        </div>
      </div>
    </div>
  );
}
