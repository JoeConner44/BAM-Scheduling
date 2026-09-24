"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/projects";
import { saveEquipment } from "@/app/actions/resources";
import { EQUIPMENT_STATUS_LABEL, EQUIPMENT_TYPE_LABEL } from "@/lib/labels";

export interface EquipmentFormValues {
  id?: string;
  name: string;
  unitCode: string;
  type: string;
  status: string;
  maintenanceNote: string;
  locationId: string;
  color: string;
  active: boolean;
}

export function EquipmentForm({ values: v, locations }: { values: EquipmentFormValues; locations: { id: string; city: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEquipment, undefined);
  return (
    <form action={action} className="card space-y-4 p-4">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {state?.error && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{state.error}</div>}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="sm:col-span-2">
          <span className="label">Name *</span>
          <input name="name" className="input" defaultValue={v.name} required placeholder="Striping Truck #4" />
        </label>
        <label>
          <span className="label">Equipment ID *</span>
          <input name="unitCode" className="input" defaultValue={v.unitCode} required placeholder="TRK-4" />
        </label>
        <label>
          <span className="label">Color on board</span>
          <input name="color" type="color" className="h-10 w-full rounded-lg border border-slate-300" defaultValue={v.color} />
        </label>
        <label>
          <span className="label">Type *</span>
          <select name="type" className="input" defaultValue={v.type}>
            {Object.entries(EQUIPMENT_TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Status</span>
          <select name="status" className="input" defaultValue={v.status}>
            {["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"].map((k) => (
              <option key={k} value={k}>
                {EQUIPMENT_STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Location / yard</span>
          <select name="locationId" className="input" defaultValue={v.locationId}>
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.city}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Active</span>
          <select name="active" className="input" defaultValue={v.active ? "on" : "off"}>
            <option value="on">Active</option>
            <option value="off">Retired / sold</option>
          </select>
        </label>
        <label className="sm:col-span-4">
          <span className="label">Maintenance note</span>
          <input name="maintenanceNote" className="input" defaultValue={v.maintenanceNote} placeholder="e.g. Broken axle — parts ordered" />
        </label>
      </div>
      <p className="text-xs text-slate-500">&quot;Assigned&quot; comes from the schedule automatically. Maintenance / out of service flags every job this unit is on from today forward.</p>
      <button className="btn-primary px-6" disabled={pending}>
        {pending ? "Saving…" : v.id ? "Save" : "Add equipment"}
      </button>
    </form>
  );
}
