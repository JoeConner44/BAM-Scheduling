"use client";

import { useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { addFieldNote, addFieldPhoto, completeJob, pauseJob, reportConditions, startJob, type FieldResult } from "@/app/actions/field";
import { CONDITION_REASON_ICON, CONDITION_REASON_LABEL, EQUIPMENT_TYPE_ICON } from "@/lib/labels";

export interface FieldJob {
  id: string;
  projectId: string;
  name: string;
  city: string;
  address: string;
  mapsUrl: string;
  timeRange: string;
  state: string;
  progress: string;
  coworkers: { name: string; phone: string | null; color: string }[];
  equipment: { name: string; unitCode: string; type: string }[];
  scope: string | null;
  officeNotes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  percentComplete: number;
  remainingHours: number;
  plannedHours: number;
  startedAt: string | null;
  actualHours: number | null;
}

type Sheet = null | "conditions" | "complete" | "note";

const BIG = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-lg font-bold shadow-sm active:scale-[0.98] disabled:opacity-50";

/** Hours on this visit so far — a starting point the crew can adjust. */
function suggestedHours(job: FieldJob) {
  if (job.actualHours !== null) return job.actualHours;
  if (!job.startedAt) return job.plannedHours;
  const h = (Date.now() - new Date(job.startedAt).getTime()) / 3_600_000;
  return Math.max(0.25, Math.round(h * 4) / 4);
}

export function FieldJobCard({ job, expanded: initiallyExpanded }: { job: FieldJob; expanded: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const done = job.progress === "DONE" || job.progress === "CANNOT_PROCEED";
  const run = (fn: () => Promise<FieldResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setFlash(r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: r.error });
      if (r.ok) after?.();
      setTimeout(() => setFlash(null), 4000);
    });

  const statusChip =
    job.progress === "ACTIVE"
      ? { text: "● Working", cls: "bg-violet-600 text-white" }
      : job.progress === "PAUSED"
        ? { text: "⏸ Paused", cls: "bg-amber-400 text-slate-900" }
        : job.progress === "DONE"
          ? { text: "✅ Done", cls: "bg-green-600 text-white" }
          : job.progress === "CANNOT_PROCEED"
            ? { text: "🚧 Stopped", cls: "bg-orange-500 text-white" }
            : job.state === "TENTATIVE"
              ? { text: "Tentative", cls: "bg-sky-100 text-sky-800" }
              : { text: "Scheduled", cls: "bg-blue-100 text-blue-800" };

  return (
    <article className={clsx("overflow-hidden rounded-2xl bg-white shadow-md", job.progress === "ACTIVE" && "ring-4 ring-violet-500")}>
      <button className="w-full p-4 text-left" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-2xl font-bold leading-tight">{job.name}</div>
            <div className="text-lg text-slate-600">{job.city}</div>
          </div>
          <span className={clsx("shrink-0 rounded-full px-3 py-1 text-sm font-bold", statusChip.cls)}>{statusChip.text}</span>
        </div>
        <div className="mt-1 text-xl font-semibold">🕗 {job.timeRange}</div>
      </button>

      {expanded && (
        <div className="space-y-4 px-4 pb-4">
          <a href={job.mapsUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-xl bg-blue-50 p-3 text-blue-900">
            <span>
              <span className="block text-xs font-bold uppercase text-blue-700">Address</span>
              <span className="text-base font-semibold">📍 {job.address}</span>
            </span>
            <span className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">Directions ➜</span>
          </a>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">Working with</div>
              {job.coworkers.length ? (
                <ul className="mt-1 space-y-1">
                  {job.coworkers.map((c) => (
                    <li key={c.name}>
                      <a href={c.phone ? `tel:${c.phone}` : undefined} className="flex items-center gap-2 text-lg font-semibold">
                        <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                        {c.name}
                        {c.phone && <span className="text-sm">📞</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-slate-500">Just you</div>
              )}
            </div>
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">Equipment</div>
              <ul className="mt-1 space-y-1">
                {job.equipment.map((e) => (
                  <li key={e.unitCode} className="text-lg font-semibold">
                    {EQUIPMENT_TYPE_ICON[e.type]} {e.name}
                  </li>
                ))}
                {!job.equipment.length && <li className="text-slate-500">None assigned</li>}
              </ul>
            </div>
          </div>

          {(job.scope || job.officeNotes) && (
            <div className="rounded-xl bg-slate-50 p-3 text-base">
              {job.scope && <p>{job.scope}</p>}
              {job.officeNotes && <p className="mt-1 font-semibold text-amber-800">📌 {job.officeNotes}</p>}
              {job.contactName && (
                <p className="mt-1 text-sm">
                  On-site contact: {job.contactName}{" "}
                  {job.contactPhone && (
                    <a className="font-semibold text-blue-700" href={`tel:${job.contactPhone}`}>
                      {job.contactPhone}
                    </a>
                  )}
                </p>
              )}
            </div>
          )}

          {job.percentComplete > 0 && (
            <div>
              <div className="flex justify-between text-sm font-semibold">
                <span>{job.percentComplete}% complete</span>
                <span>about {job.remainingHours} hrs left</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-emerald-500" style={{ width: `${job.percentComplete}%` }} />
              </div>
            </div>
          )}

          {flash && (
            <div className={clsx("rounded-xl p-3 text-center text-lg font-semibold", flash.tone === "ok" ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-800")} role="status">
              {flash.text}
            </div>
          )}

          {!done && (
            <div className="space-y-3">
              {job.progress === "ACTIVE" ? (
                <button className={clsx(BIG, "bg-amber-400 text-slate-900")} disabled={pending} onClick={() => run(() => pauseJob(job.id))}>
                  ⏸ PAUSE
                </button>
              ) : (
                <button className={clsx(BIG, "bg-emerald-600 py-5 text-xl text-white")} disabled={pending} onClick={() => run(() => startJob(job.id))}>
                  ▶ {job.progress === "PAUSED" ? "RESUME JOB" : "START JOB"}
                </button>
              )}
              <button className={clsx(BIG, "bg-orange-500 py-5 text-xl text-white")} disabled={pending} onClick={() => setSheet("conditions")}>
                🚧 JOB CONDITIONS CHANGED
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button className={clsx(BIG, "bg-slate-800 text-white")} disabled={pending} onClick={() => photoRef.current?.click()}>
                  📷 ADD PHOTO
                </button>
                <button className={clsx(BIG, "bg-slate-800 text-white")} disabled={pending} onClick={() => setSheet("note")}>
                  📝 ADD NOTE
                </button>
              </div>
              <button className={clsx(BIG, "bg-blue-600 py-5 text-xl text-white")} disabled={pending} onClick={() => setSheet("complete")}>
                ✅ MARK COMPLETE
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files?.length) return;
                  const fd = new FormData();
                  fd.set("blockId", job.id);
                  for (const f of Array.from(files)) fd.append("photo", f);
                  e.target.value = "";
                  run(() => addFieldPhoto(fd));
                }}
              />
            </div>
          )}
          {pending && <div className="text-center text-sm text-slate-500">Sending…</div>}
        </div>
      )}

      {sheet === "conditions" && <ConditionsSheet job={job} onClose={() => setSheet(null)} onSubmit={(fd) => run(() => reportConditions(fd), () => setSheet(null))} pending={pending} />}
      {sheet === "complete" && <CompleteSheet job={job} onClose={() => setSheet(null)} onSubmit={(fd) => run(() => completeJob(fd), () => setSheet(null))} pending={pending} />}
      {sheet === "note" && <NoteSheet job={job} onClose={() => setSheet(null)} onSubmit={(fd) => run(() => addFieldNote(fd), () => setSheet(null))} pending={pending} />}
    </article>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-lg" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stepper({ name, label, value, onChange, step = 0.5 }: { name: string; label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <div className="mb-1 text-sm font-bold uppercase text-slate-500">{label}</div>
      <div className="flex items-center gap-2">
        <button type="button" className="h-14 w-14 rounded-xl bg-slate-200 text-2xl font-bold" onClick={() => onChange(Math.max(0, value - step))}>
          −
        </button>
        <input
          name={name}
          type="number"
          inputMode="decimal"
          step="0.25"
          min="0"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-14 w-full rounded-xl border-2 border-slate-300 text-center text-2xl font-bold"
        />
        <button type="button" className="h-14 w-14 rounded-xl bg-slate-200 text-2xl font-bold" onClick={() => onChange(value + step)}>
          +
        </button>
      </div>
    </div>
  );
}

function Percent({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-end justify-between">
        <span className="text-sm font-bold uppercase text-slate-500">How much is done?</span>
        <span className="text-3xl font-bold">{value}%</span>
      </div>
      <input name="percentComplete" type="range" min={0} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-10 w-full accent-blue-600" />
    </div>
  );
}

function ConditionsSheet({ job, onClose, onSubmit, pending }: { job: FieldJob; onClose: () => void; onSubmit: (fd: FormData) => void; pending: boolean }) {
  const [reason, setReason] = useState<string | null>(null);
  const [percent, setPercent] = useState(job.percentComplete);
  const [hours, setHours] = useState(suggestedHours(job));
  const [remaining, setRemaining] = useState(job.remainingHours);
  const [canProceed, setCanProceed] = useState<"yes" | "no">("yes");

  return (
    <Sheet title="🚧 Job conditions changed" onClose={onClose}>
      {!reason ? (
        <>
          <p className="mb-3 text-slate-600">What happened?</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(CONDITION_REASON_LABEL).map(([k, label]) => (
              <button key={k} onClick={() => setReason(k)} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-slate-200 p-2 text-center font-semibold active:bg-orange-50">
                <span className="text-3xl">{CONDITION_REASON_ICON[k]}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
        >
          <input type="hidden" name="blockId" value={job.id} />
          <input type="hidden" name="reason" value={reason} />
          <input type="hidden" name="canProceed" value={canProceed} />
          <button type="button" onClick={() => setReason(null)} className="flex w-full items-center gap-2 rounded-2xl bg-orange-100 p-3 text-left text-lg font-bold text-orange-900">
            {CONDITION_REASON_ICON[reason]} {CONDITION_REASON_LABEL[reason]} <span className="ml-auto text-sm font-normal">change</span>
          </button>
          <Percent value={percent} onChange={setPercent} />
          <Stepper name="hoursWorked" label="Hours worked on this visit" value={hours} onChange={setHours} />
          <Stepper name="remainingHours" label="About how many hours are left?" value={remaining} onChange={setRemaining} />
          <div>
            <div className="mb-1 text-sm font-bold uppercase text-slate-500">Can you keep working?</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setCanProceed("yes")} className={clsx("rounded-2xl border-2 p-4 text-lg font-bold", canProceed === "yes" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300")}>
                👍 Yes
              </button>
              <button type="button" onClick={() => setCanProceed("no")} className={clsx("rounded-2xl border-2 p-4 text-lg font-bold", canProceed === "no" ? "border-red-600 bg-red-600 text-white" : "border-slate-300")}>
                🛑 No, we have to stop
              </button>
            </div>
          </div>
          <textarea name="note" rows={3} className="w-full rounded-xl border-2 border-slate-300 p-3 text-lg" placeholder="What's going on? (optional)" />
          <label className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-4 text-lg font-semibold">
            📷 Add photos
            <input type="file" name="photo" accept="image/*" capture="environment" multiple className="max-w-40 text-sm" />
          </label>
          <button className={clsx(BIG, "bg-orange-500 py-5 text-xl text-white")} disabled={pending}>
            {pending ? "Sending…" : "Send to office"}
          </button>
        </form>
      )}
    </Sheet>
  );
}

function CompleteSheet({ job, onClose, onSubmit, pending }: { job: FieldJob; onClose: () => void; onSubmit: (fd: FormData) => void; pending: boolean }) {
  const [allDone, setAllDone] = useState<"yes" | "no" | null>(null);
  const [percent, setPercent] = useState(Math.max(job.percentComplete, 50));
  const [hours, setHours] = useState(suggestedHours(job));
  const [remaining, setRemaining] = useState(Math.max(0.5, Math.round((job.remainingHours - hours) * 2) / 2));

  return (
    <Sheet title="✅ Mark complete" onClose={onClose}>
      {!allDone ? (
        <div className="space-y-3">
          <p className="text-lg">Is the whole job finished?</p>
          <button className={clsx(BIG, "bg-green-600 py-6 text-xl text-white")} onClick={() => setAllDone("yes")}>
            ✅ Yes, all done
          </button>
          <button className={clsx(BIG, "bg-amber-400 py-6 text-xl text-slate-900")} onClick={() => setAllDone("no")}>
            ⏸ No, some work is left
          </button>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
        >
          <input type="hidden" name="blockId" value={job.id} />
          <input type="hidden" name="allDone" value={allDone} />
          {allDone === "no" && <Percent value={percent} onChange={setPercent} />}
          <Stepper name="hoursWorked" label="Hours worked on this visit" value={hours} onChange={setHours} />
          {allDone === "no" && <Stepper name="remainingHours" label="About how many hours are left?" value={remaining} onChange={setRemaining} />}
          {allDone === "no" && (
            <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
              Example: “{percent}% complete. Need about {remaining} more hours.” The rest goes back on the office TO DO list.
            </p>
          )}
          <textarea name="note" rows={2} className="w-full rounded-xl border-2 border-slate-300 p-3 text-lg" placeholder="Anything the office should know? (optional)" />
          <button className={clsx(BIG, allDone === "yes" ? "bg-green-600" : "bg-amber-500", "py-5 text-xl text-white")} disabled={pending}>
            {pending ? "Saving…" : allDone === "yes" ? "Finish job" : "Save partial"}
          </button>
          <button type="button" className="w-full py-2 text-slate-500" onClick={() => setAllDone(null)}>
            ← Back
          </button>
        </form>
      )}
    </Sheet>
  );
}

function NoteSheet({ job, onClose, onSubmit, pending }: { job: FieldJob; onClose: () => void; onSubmit: (fd: FormData) => void; pending: boolean }) {
  const [kind, setKind] = useState<"NOTE" | "DELAY">("NOTE");
  return (
    <Sheet title="📝 Add a note" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <input type="hidden" name="blockId" value={job.id} />
        <input type="hidden" name="kind" value={kind} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setKind("NOTE")} className={clsx("rounded-2xl border-2 p-3 text-lg font-bold", kind === "NOTE" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300")}>
            📝 Note
          </button>
          <button type="button" onClick={() => setKind("DELAY")} className={clsx("rounded-2xl border-2 p-3 text-lg font-bold", kind === "DELAY" ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300")}>
            ⏱ Running late
          </button>
        </div>
        <textarea name="body" rows={4} required autoFocus className="w-full rounded-xl border-2 border-slate-300 p-3 text-lg" placeholder={kind === "DELAY" ? "How late, and why?" : "Type your note…"} />
        <button className={clsx(BIG, "bg-blue-600 text-white")} disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </Sheet>
  );
}
