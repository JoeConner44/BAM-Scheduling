"use client";

import { useActionState, useState, useTransition } from "react";
import clsx from "clsx";
import { importCalendar, previewCalendar, type ImportState, type PreviewGroup, type PreviewResult } from "@/app/actions/import";
import { fmtDay } from "@/lib/time";

type Row = PreviewGroup & { include: boolean };

/** Upload the export, review the jobs the app found (untick anything that isn't a job), then import. */
export function CalendarImport() {
  const [reading, startReading] = useTransition();
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [state, submit, importing] = useActionState<ImportState, FormData>(importCalendar, undefined);

  const read = (form: FormData) =>
    startReading(async () => {
      const r = await previewCalendar(form);
      setResult(r);
      setRows(r.ok ? r.groups.map((g) => ({ ...g, include: !g.alreadyImported })) : []);
    });

  const edit = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const payload = JSON.stringify(
    chosen.map((r) => ({ name: r.name, customer: r.customer || r.name, street: r.street, city: r.city, state: r.state, zip: r.zip, notes: r.notes, days: r.days, firstDay: r.firstDay, lastDay: r.lastDay, slots: r.slots })),
  );

  return (
    <div className="space-y-4">
      <form action={read} className="card space-y-3 p-4">
        <h2 className="font-bold">1. Upload the calendar export</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" name="calendar" accept=".zip,.ics,text/calendar,application/zip" required className="text-sm" />
          <button className="btn-primary" disabled={reading}>
            {reading ? "Reading…" : "Read calendar"}
          </button>
        </div>
        {result && !result.ok && <p className="rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900">{result.error}</p>}
        {result?.ok && (
          <p className="text-sm text-slate-600">
            Read {result.calendars.length} calendar{result.calendars.length === 1 ? "" : "s"} ({result.calendars.map((c) => `${c.name}: ${c.events}`).join(", ")}) for the next
            12 months. Found {rows.length} possible job{rows.length === 1 ? "" : "s"}.
          </p>
        )}
      </form>

      {result?.ok && rows.length > 0 && (
        <form action={submit} className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">2. Untick anything that isn&apos;t a job, fix names and cities, then import</h2>
            <div className="flex gap-2 text-sm">
              <button type="button" className="btn-secondary" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true })))}>
                Tick all
              </button>
              <button type="button" className="btn-secondary" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false })))}>
                Untick all
              </button>
            </div>
          </div>
          {state?.error && <div className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{state.error}</div>}

          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              return (
                <li key={r.key} className={clsx("space-y-2 py-3", !r.include && "opacity-50")} data-testid="import-row">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1 h-5 w-5" checked={r.include} onChange={(e) => edit(r.key, { include: e.target.checked })} aria-label={`Import ${r.name}`} />
                    <span className="min-w-0">
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-sm text-slate-500">
                        {r.days} day{r.days === 1 ? "" : "s"} of work,{" "}
                        {r.lastDay > r.firstDay ? `any day ${fmtDay(r.firstDay)} – ${fmtDay(r.lastDay)}` : `around ${fmtDay(r.firstDay)}`}
                        {r.crew.length > 0 && ` · crew: ${r.crew.join(", ")}`}
                        {r.alreadyImported && <b className="text-emerald-700"> · already imported</b>}
                      </span>
                    </span>
                  </label>
                  {r.include && (
                    <div className="grid gap-2 pl-7 sm:grid-cols-6">
                      <Box label="Job name" className="sm:col-span-2">
                        <input className="input" value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} />
                      </Box>
                      <Box label="Customer" className="sm:col-span-2">
                        <input className="input" value={r.customer} onChange={(e) => edit(r.key, { customer: e.target.value })} />
                      </Box>
                      <Box label="Street" className="sm:col-span-2">
                        <input className="input" value={r.street} onChange={(e) => edit(r.key, { street: e.target.value })} placeholder="optional" />
                      </Box>
                      <Box label="City" className="sm:col-span-2">
                        <input className="input" value={r.city} onChange={(e) => edit(r.key, { city: e.target.value })} placeholder="add later if you don't know" />
                      </Box>
                      <Box label="State">
                        <input className="input" value={r.state} maxLength={2} onChange={(e) => edit(r.key, { state: e.target.value.toUpperCase() })} />
                      </Box>
                      <Box label="Days of work">
                        <input type="number" min={1} max={30} className="input" value={r.days} onChange={(e) => edit(r.key, { days: Math.max(1, Number(e.target.value) || 1) })} />
                      </Box>
                      <Box label="ZIP">
                        <input className="input" value={r.zip} onChange={(e) => edit(r.key, { zip: e.target.value })} />
                      </Box>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <input type="hidden" name="jobs" value={payload} />
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <button className="btn-primary" disabled={importing || !chosen.length}>
              {importing ? "Importing…" : `Import ${chosen.length} job${chosen.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </form>
      )}
      {result?.ok && rows.length === 0 && <p className="card p-4 text-sm text-slate-600">No upcoming events in that file.</p>}
    </div>
  );
}

function Box({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={clsx("block", className)}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}
