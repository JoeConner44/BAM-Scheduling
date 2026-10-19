"use client";

import { useActionState, useState, useTransition } from "react";
import clsx from "clsx";
import { acceptJob, extractWorkOrder, type AcceptState } from "@/app/actions/jobs";
import { EQUIPMENT_TYPE_ICON, EQUIPMENT_TYPE_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import type { WorkOrderFields } from "@/lib/workorder";

type Material = { name: string; quantity: string; unit: string };

const EMPTY: WorkOrderFields = {
  workOrderNumber: null, customer: null, jobName: null, contactName: null, contactPhone: null, contactEmail: null,
  street: null, city: null, state: "GA", zip: null, jobType: null, scope: null, materials: [], estimatedHours: null,
  crewSize: null, equipmentNeeded: ["STRIPING_TRUCK"], deadline: null, requestedDate: null, notes: null,
};

/**
 * Accept a job in two steps: (1) upload the work order and the app reads it,
 * (2) check the details, add hours and crew size if the work order doesn't say, and accept.
 */
export function AcceptJobForm({ jobTypes, cities, customers, readingEnabled }: { jobTypes: string[]; cities: string[]; customers: string[]; readingEnabled: boolean }) {
  const [reading, startReading] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [fields, setFields] = useState<WorkOrderFields | null>(null);
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [version, setVersion] = useState(0); // remounts the form with new defaults after reading
  const [state, submit, accepting] = useActionState<AcceptState, FormData>(acceptJob, undefined);

  const read = (form: FormData) =>
    startReading(async () => {
      const r = await extractWorkOrder(form);
      setFileKey(r.fileKey ?? null);
      const f = r.ok ? r.fields : EMPTY;
      setFields(f);
      setMaterials(f.materials.map((m) => ({ name: m.name, quantity: m.quantity?.toString() ?? "", unit: m.unit ?? "" })));
      setVersion((v) => v + 1);
      setNotice(
        r.ok
          ? { tone: "ok", text: "✅ Read the work order. Check every field before accepting." }
          : { tone: "warn", text: r.error },
      );
    });

  const v = fields ?? EMPTY;
  const showForm = fields !== null;

  return (
    <div className="space-y-4">
      <form action={read} className="card space-y-3 p-4">
        <h2 className="font-bold">1. Upload the work order</h2>
        <p className="text-sm text-slate-600">
          {readingEnabled
            ? "PDF or a photo of the paper work order. The app reads the job name, address, materials and dates for you."
            : "Attach the PDF or a photo of the work order. (Automatic reading is not switched on yet, so you'll type the details in step 2.)"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" name="workOrder" accept="application/pdf,image/jpeg,image/png,image/webp" required className="text-sm" />
          <button className="btn-primary" disabled={reading}>
            {reading ? "Reading…" : readingEnabled ? "Read work order" : "Attach"}
          </button>
          {!showForm && (
            <button type="button" className="btn-secondary" onClick={() => (setFields(EMPTY), setVersion((x) => x + 1))}>
              No work order — type it in
            </button>
          )}
        </div>
        {reading && <p className="text-sm text-slate-500">Reading the work order. This takes about 10–30 seconds…</p>}
        {notice && <p className={clsx("rounded-lg p-2 text-sm font-semibold", notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>{notice.text}</p>}
      </form>

      {showForm && (
        <form key={version} action={submit} className="card space-y-4 p-4">
          <h2 className="font-bold">2. Check the details and accept</h2>
          {state?.error && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{state.error}</div>}
          {fileKey && <input type="hidden" name="workOrderFileKey" value={fileKey} />}

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Job name *" className="sm:col-span-2">
              <input name="name" className="input" defaultValue={v.jobName ?? ""} required placeholder="e.g. Kroger" />
            </Field>
            <Field label="Customer *" className="sm:col-span-2">
              <input name="customer" className="input" list="customers" defaultValue={v.customer ?? v.jobName ?? ""} required />
              <datalist id="customers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Work order #">
              <input name="workOrderNumber" className="input" defaultValue={v.workOrderNumber ?? ""} />
            </Field>
            <Field label="Job type">
              <input name="jobType" className="input" list="jobtypes" defaultValue={v.jobType ?? ""} />
              <datalist id="jobtypes">{jobTypes.map((j) => <option key={j} value={j} />)}</datalist>
            </Field>
            <Field label="Estimated hours *">
              <input name="estTotalHours" type="number" step="0.25" min="0.25" className="input" defaultValue={v.estimatedHours ?? ""} required />
            </Field>
            <Field label="People needed">
              <input name="estCrewSize" type="number" min="1" max="12" className="input" defaultValue={v.crewSize ?? 2} />
            </Field>

            <Field label="Job site street" className="sm:col-span-4">
              <input name="street" className="input" defaultValue={v.street ?? ""} />
            </Field>
            <Field label="City *" className="sm:col-span-2">
              <input name="city" className="input" list="cities" defaultValue={v.city ?? ""} required />
              <datalist id="cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="State">
              <input name="state" className="input" maxLength={2} defaultValue={v.state ?? "GA"} />
            </Field>
            <Field label="ZIP">
              <input name="zip" className="input" defaultValue={v.zip ?? ""} />
            </Field>

            <Field label="Contact">
              <input name="contactName" className="input" defaultValue={v.contactName ?? ""} />
            </Field>
            <Field label="Phone">
              <input name="contactPhone" className="input" defaultValue={v.contactPhone ?? ""} />
            </Field>
            <Field label="Email" className="sm:col-span-2">
              <input name="contactEmail" className="input" defaultValue={v.contactEmail ?? ""} />
            </Field>

            <Field label="Scope of work" className="sm:col-span-4">
              <textarea name="scope" rows={2} className="input" defaultValue={v.scope ?? ""} />
            </Field>
          </div>

          <div>
            <div className="label">Materials</div>
            <div className="space-y-1.5">
              {materials.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-1.5">
                  <input name="materialName" className="input" value={m.name} onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="White traffic paint" />
                  <input name="materialQty" className="input" inputMode="decimal" value={m.quantity} onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} placeholder="Qty" />
                  <input name="materialUnit" className="input" value={m.unit} onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} placeholder="gal" />
                  <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setMaterials(materials.filter((_, j) => j !== i))} aria-label="Remove material">
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="mt-1.5 text-sm font-semibold text-blue-700" onClick={() => setMaterials([...materials, { name: "", quantity: "", unit: "" }])}>
              + Add material
            </button>
          </div>

          <div>
            <div className="label">Equipment needed</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {Object.entries(EQUIPMENT_TYPE_LABEL).map(([type, label]) => (
                <label key={type} className="flex items-center gap-1.5 text-sm">
                  <input name={`equip_${type}`} type="number" min="0" max="9" className="w-12 rounded border border-slate-300 px-1" defaultValue={v.equipmentNeeded.filter((t) => t === type).length || 0} />
                  {EQUIPMENT_TYPE_ICON[type]} {label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Must be done by">
              <input name="deadline" type="date" className="input" defaultValue={v.deadline ?? ""} />
            </Field>
            <Field label="Customer's requested date (if known)">
              <input name="requestedDate" type="date" className="input" defaultValue={v.requestedDate ?? ""} />
            </Field>
            <Field label="Priority">
              <select name="priority" className="input" defaultValue="NORMAL">
                {Object.entries(PRIORITY_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Weather matters?">
              <select name="weatherSensitivity" className="input" defaultValue="HIGH">
                <option value="HIGH">Yes — check weather</option>
                <option value="NONE">No (e.g. garage, indoor)</option>
              </select>
            </Field>
            <Field label="Notes for the scheduler" className="sm:col-span-4">
              <textarea name="notes" rows={2} className="input" defaultValue={v.notes ?? ""} />
            </Field>
          </div>

          <button className="btn-primary w-full py-3 text-base" disabled={accepting}>
            {accepting ? "Accepting…" : "✅ Accept job — send to scheduling"}
          </button>
        </form>
      )}
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
