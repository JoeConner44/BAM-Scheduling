"use client";

import { useActionState, useState } from "react";
import { addTimeOff, saveEmployee, type TimeOffState } from "@/app/actions/resources";
import type { FormState } from "@/app/actions/projects";
import { EMPLOYEE_STATUS_LABEL, TIME_OFF_LABEL } from "@/lib/labels";

export interface EmployeeFormValues {
  id?: string;
  name: string;
  phone: string;
  position: string;
  color: string;
  normalStart: string;
  normalEnd: string;
  workDays: number[];
  status: string;
  active: boolean;
  skills: Record<string, boolean>; // skillId → isCertification
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function EmployeeForm({ values: v, skills }: { values: EmployeeFormValues; skills: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEmployee, undefined);
  return (
    <form action={action} className="card space-y-4 p-4">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {state?.error && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{state.error}</div>}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className="label">Name *</span>
          <input name="name" className="input" defaultValue={v.name} required />
        </label>
        <label>
          <span className="label">Phone</span>
          <input name="phone" type="tel" className="input" defaultValue={v.phone} />
        </label>
        <label>
          <span className="label">Color on board</span>
          <input name="color" type="color" className="h-10 w-full rounded-lg border border-slate-300" defaultValue={v.color} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Position</span>
          <input name="position" className="input" defaultValue={v.position} />
        </label>
        <label>
          <span className="label">Normal start</span>
          <input name="normalStart" type="time" className="input" defaultValue={v.normalStart} />
        </label>
        <label>
          <span className="label">Normal end</span>
          <input name="normalEnd" type="time" className="input" defaultValue={v.normalEnd} />
        </label>
      </div>
      <div>
        <span className="label">Normal work days</span>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <input type="checkbox" name="workDays" value={i} defaultChecked={v.workDays.includes(i)} /> {d}
            </label>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Skills (tick 🎓 for a certification)</span>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {skills.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-2 py-1 text-sm">
              <label className="flex flex-1 items-center gap-1.5">
                <input type="checkbox" name="skills" value={s.id} defaultChecked={s.id in v.skills} /> {s.name}
              </label>
              <label className="flex items-center gap-1 text-xs" title="Certification / qualification">
                <input type="checkbox" name="certs" value={s.id} defaultChecked={v.skills[s.id] === true} /> 🎓
              </label>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label>
          <span className="label">Status</span>
          <select name="status" className="input" defaultValue={v.status}>
            {["AVAILABLE", "UNAVAILABLE", "DELAYED"].map((s) => (
              <option key={s} value={s}>
                {EMPLOYEE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Active</span>
          <select name="active" className="input" defaultValue={v.active ? "on" : "off"}>
            <option value="on">Active</option>
            <option value="off">No longer with company</option>
          </select>
        </label>
        <p className="text-xs text-slate-500 sm:col-span-2 sm:self-end">Off / sick / vacation come from time off below; &quot;assigned&quot; comes from the schedule.</p>
      </div>
      <button className="btn-primary px-6" disabled={pending}>
        {pending ? "Saving…" : v.id ? "Save" : "Add person"}
      </button>
    </form>
  );
}

export function TimeOffForm({ employeeId, today }: { employeeId: string; today: string }) {
  const [state, action, pending] = useActionState<TimeOffState, FormData>(addTimeOff, undefined);
  const [partial, setPartial] = useState(false);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      {state?.error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.ok && (
        <div className={state.affected?.length ? "rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm" : "rounded bg-emerald-50 p-2 text-sm text-emerald-800"}>
          {state.affected?.length ? (
            <>
              <div className="font-bold">⚠️ Saved. This affects {state.affected.length} scheduled job(s):</div>
              <ul className="list-disc pl-5">
                {state.affected.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <div className="mt-1">They&apos;re flagged red on the schedule board so you can reassign.</div>
            </>
          ) : (
            "Saved. No scheduled work is affected."
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">Type</span>
          <select name="type" className="input">
            {Object.entries(TIME_OFF_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Note</span>
          <input name="note" className="input" placeholder="Optional" />
        </label>
        <label>
          <span className="label">From</span>
          <input name="startDay" type="date" className="input" defaultValue={today} required />
        </label>
        <label>
          <span className="label">To</span>
          <input name="endDay" type="date" className="input" defaultValue={today} required />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="partial" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Partial day only
      </label>
      {partial && (
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">Off from</span>
            <input name="startTime" type="time" className="input" defaultValue="12:00" />
          </label>
          <label>
            <span className="label">Until</span>
            <input name="endTime" type="time" className="input" defaultValue="23:59" />
          </label>
        </div>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Mark off"}
      </button>
    </form>
  );
}
