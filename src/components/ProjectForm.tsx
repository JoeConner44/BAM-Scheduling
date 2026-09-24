"use client";

import { useActionState } from "react";
import { saveProject, type FormState } from "@/app/actions/projects";
import { EQUIPMENT_TYPE_ICON, EQUIPMENT_TYPE_LABEL, PRIORITY_LABEL, PROJECT_STATUS_LABEL, WEATHER_SENSITIVITY_LABEL } from "@/lib/labels";

export interface ProjectFormValues {
  id?: string;
  customer: string;
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: string;
  lng: string;
  jobType: string;
  scope: string;
  estTotalHours: string;
  estCrewSize: string;
  earliestDate: string;
  preferredDate: string;
  deadline: string;
  inspectionDate: string;
  priority: string;
  weatherSensitivity: string;
  surfaceReady: boolean;
  customerReady: boolean;
  status: string;
  notes: string;
  percentComplete: string;
  actualHours: string;
  remainingHoursOverride: string;
  skills: Record<string, number>;
  equipment: Record<string, number>;
}

export function ProjectForm({
  values,
  skills,
  jobTypes,
  customers,
  cities,
}: {
  values: ProjectFormValues;
  skills: { id: string; name: string }[];
  jobTypes: string[];
  customers: string[];
  cities: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProject, undefined);
  const v = values;

  return (
    <form action={action} className="space-y-5">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {state?.error && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{state.error}</div>}

      <Section title="Customer & contact">
        <Field label="Customer *" className="sm:col-span-2">
          <input name="customer" className="input" defaultValue={v.customer} list="customers" required />
          <datalist id="customers">
            {customers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Project name *" className="sm:col-span-2">
          <input name="name" className="input" defaultValue={v.name} required placeholder="e.g. Kroger" />
        </Field>
        <Field label="Project manager / contact">
          <input name="contactName" className="input" defaultValue={v.contactName} />
        </Field>
        <Field label="Phone">
          <input name="contactPhone" type="tel" className="input" defaultValue={v.contactPhone} />
        </Field>
        <Field label="Email" className="sm:col-span-2">
          <input name="contactEmail" type="email" className="input" defaultValue={v.contactEmail} />
        </Field>
      </Section>

      <Section title="Location" hint="New cities are added to the location filters automatically.">
        <Field label="Street address" className="sm:col-span-4">
          <input name="street" className="input" defaultValue={v.street} />
        </Field>
        <Field label="City *" className="sm:col-span-2">
          <input name="city" className="input" defaultValue={v.city} list="cities" required />
          <datalist id="cities">
            {cities.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="State">
          <input name="state" className="input" defaultValue={v.state || "GA"} maxLength={2} />
        </Field>
        <Field label="ZIP">
          <input name="zip" className="input" defaultValue={v.zip} inputMode="numeric" />
        </Field>
        <Field label="Latitude (optional)">
          <input name="lat" className="input" defaultValue={v.lat} inputMode="decimal" placeholder="33.95" />
        </Field>
        <Field label="Longitude (optional)">
          <input name="lng" className="input" defaultValue={v.lng} inputMode="decimal" placeholder="-83.36" />
        </Field>
        <p className="text-xs text-slate-500 sm:col-span-2 sm:self-end">GPS is used for travel-time checks. Without it we use the city center. Address lookup comes in a later phase.</p>
      </Section>

      <Section title="Work">
        <Field label="Job type" className="sm:col-span-2">
          <input name="jobType" className="input" defaultValue={v.jobType} list="jobtypes" />
          <datalist id="jobtypes">
            {jobTypes.map((j) => (
              <option key={j} value={j} />
            ))}
          </datalist>
        </Field>
        <Field label="Estimated total hours *">
          <input name="estTotalHours" type="number" step="0.25" min="0.25" className="input" defaultValue={v.estTotalHours} required />
        </Field>
        <Field label="People needed">
          <input name="estCrewSize" type="number" min="1" max="12" className="input" defaultValue={v.estCrewSize || "2"} />
        </Field>
        <Field label="Scope" className="sm:col-span-4">
          <textarea name="scope" className="input" rows={2} defaultValue={v.scope} />
        </Field>
        <Field label="Required skills" className="sm:col-span-2">
          <div className="grid grid-cols-2 gap-1.5">
            {skills.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="skills" value={s.id} defaultChecked={s.id in v.skills} />
                <span className="flex-1">{s.name}</span>
                <input name={`skillCount_${s.id}`} type="number" min="1" max="9" className="w-12 rounded border border-slate-300 px-1 text-sm" defaultValue={v.skills[s.id] ?? 1} title="How many people with this skill" />
              </label>
            ))}
          </div>
        </Field>
        <Field label="Required equipment (how many)" className="sm:col-span-2">
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(EQUIPMENT_TYPE_LABEL).map(([type, label]) => (
              <label key={type} className="flex items-center gap-1.5 text-sm">
                <input name={`equip_${type}`} type="number" min="0" max="9" className="w-12 rounded border border-slate-300 px-1 text-sm" defaultValue={v.equipment[type] ?? 0} />
                <span>
                  {EQUIPMENT_TYPE_ICON[type]} {label}
                </span>
              </label>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Dates & priority">
        <Field label="Earliest possible date">
          <input name="earliestDate" type="date" className="input" defaultValue={v.earliestDate} />
        </Field>
        <Field label="Preferred date">
          <input name="preferredDate" type="date" className="input" defaultValue={v.preferredDate} />
        </Field>
        <Field label="Deadline">
          <input name="deadline" type="date" className="input" defaultValue={v.deadline} />
        </Field>
        <Field label="Inspection date">
          <input name="inspectionDate" type="date" className="input" defaultValue={v.inspectionDate} />
        </Field>
        <Field label="Priority">
          <select name="priority" className="input" defaultValue={v.priority || "NORMAL"}>
            {Object.entries(PRIORITY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weather sensitivity">
          <select name="weatherSensitivity" className="input" defaultValue={v.weatherSensitivity || "LOW"}>
            {Object.entries(WEATHER_SENSITIVITY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" className="input" defaultValue={v.status || "TO_DO"}>
            {Object.entries(PROJECT_STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-col justify-end gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="surfaceReady" defaultChecked={v.surfaceReady} /> Surface ready
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="customerReady" defaultChecked={v.customerReady} /> Customer ready
          </label>
        </div>
      </Section>

      <Section title="Progress" hint="Usually updated by the field crew. Leave remaining blank to use estimate − actual.">
        <Field label="% complete">
          <input name="percentComplete" type="number" min="0" max="100" className="input" defaultValue={v.percentComplete || "0"} />
        </Field>
        <Field label="Actual hours worked">
          <input name="actualHours" type="number" step="0.25" min="0" className="input" defaultValue={v.actualHours || "0"} />
        </Field>
        <Field label="Estimated remaining hours">
          <input name="remainingHoursOverride" type="number" step="0.25" min="0" className="input" defaultValue={v.remainingHoursOverride} />
        </Field>
        <Field label="Notes" className="sm:col-span-4">
          <textarea name="notes" className="input" rows={2} defaultValue={v.notes} />
        </Field>
      </Section>

      <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-slate-100/95 py-3">
        <button className="btn-primary px-6 py-3 text-base" disabled={pending}>
          {pending ? "Saving…" : v.id ? "Save changes" : "Add project"}
        </button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="card p-4">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-4">{children}</div>
    </fieldset>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
