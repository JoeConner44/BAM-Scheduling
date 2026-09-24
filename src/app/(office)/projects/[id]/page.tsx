import Link from "next/link";
import clsx from "clsx";
import { notFound } from "next/navigation";
import { addProjectNote, changeProjectStatus, deleteProject, uploadProjectPhoto } from "@/app/actions/projects";
import { ConfirmButton } from "@/components/ConfirmButton";
import { OFFICE, requireUser } from "@/lib/auth";
import { projectInclude, remainingHours, toCard } from "@/lib/data";
import { db } from "@/lib/db";
import {
  CONDITION_REASON_ICON,
  CONDITION_REASON_LABEL,
  EQUIPMENT_TYPE_ICON,
  EQUIPMENT_TYPE_LABEL,
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
  WEATHER_SENSITIVITY_LABEL,
} from "@/lib/labels";
import { dateToDay, fmtDay, fmtHours, fmtRange, fmtTimestamp, maybeDay, today } from "@/lib/time";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const user = await requireUser(OFFICE);
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id }, include: projectInclude });
  if (!project) notFound();

  const [blocks, notes, photos, reports, history, audit] = await Promise.all([
    db.scheduleBlock.findMany({
      where: { projectId: id },
      include: { assignments: { include: { employee: true } }, equipmentAssignments: { include: { equipment: true } } },
      orderBy: [{ day: "asc" }, { startMin: "asc" }],
    }),
    db.projectNote.findMany({ where: { projectId: id }, include: { author: true }, orderBy: { at: "desc" } }),
    db.projectPhoto.findMany({ where: { projectId: id }, include: { uploadedBy: true }, orderBy: { takenAt: "desc" } }),
    db.conditionReport.findMany({ where: { projectId: id }, include: { reportedBy: true }, orderBy: { at: "desc" } }),
    db.projectStatusHistory.findMany({ where: { projectId: id }, include: { changedBy: true }, orderBy: { at: "desc" } }),
    db.auditLog.findMany({
      where: { OR: [{ entityId: id }, { entityId: { in: project.blocks.map((b) => b.id) } }, { summary: { contains: `${project.name} — ${project.city}` } }] },
      include: { actor: true },
      orderBy: { at: "desc" },
      take: 30,
    }),
  ]);
  const card = toCard(project);
  const t = today();
  const address = [project.street, project.city, `${project.state} ${project.zip ?? ""}`.trim()].filter(Boolean).join(", ");
  const mapsUrl = project.lat && project.lng ? `https://maps.google.com/?q=${project.lat},${project.lng}` : `https://maps.google.com/?q=${encodeURIComponent(address)}`;

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:p-6">
      <Link href="/todo" className="text-sm font-semibold text-blue-700">
        ← TO DO
      </Link>

      {/* Header */}
      <div className="card flex flex-wrap items-start justify-between gap-3 border-l-8 p-4" style={{ borderLeftColor: { CRITICAL: "#dc2626", HIGH: "#f97316", NORMAL: "#60a5fa", LOW: "#cbd5e1" }[project.priority] }}>
        <div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-slate-500">{project.code}</span>
            <span className={clsx("chip", PRIORITY_BADGE[project.priority])}>{PRIORITY_LABEL[project.priority]} priority</span>
            <span className={clsx("chip", PROJECT_STATUS_COLOR[project.status])}>{PROJECT_STATUS_LABEL[project.status]}</span>
            {project.jobType && <span className="chip bg-slate-100 text-slate-700">{project.jobType.name}</span>}
          </div>
          <h1 className="mt-1 text-2xl font-bold">
            {project.name} <span className="font-normal text-slate-500">— {project.city}</span>
          </h1>
          <div className="text-sm text-slate-600">{project.customer.name}</div>
          <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">
            📍 {address}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/board${card.blocks[0] ? `?date=${card.blocks[0].day}` : ""}`} className="btn-primary">
            📅 {card.unscheduledHours > 0 ? "Schedule it" : "See on board"}
          </Link>
          <Link href={`/projects/${id}/edit`} className="btn-secondary">
            ✏️ Edit
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Key facts */}
          <section className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Fact label="Estimate" value={fmtHours(project.estTotalHours)} />
            <Fact label="Actual so far" value={fmtHours(project.actualHours)} />
            <Fact label="Remaining" value={fmtHours(remainingHours(project))} strong />
            <Fact label="Still to schedule" value={fmtHours(card.unscheduledHours)} strong={card.unscheduledHours > 0} />
            <div className="col-span-2 sm:col-span-4">
              <div className="flex justify-between text-xs font-semibold">
                <span>{project.percentComplete}% complete</span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-emerald-500" style={{ width: `${project.percentComplete}%` }} />
              </div>
            </div>
            <Fact label="Deadline" value={project.deadline ? fmtDay(dateToDay(project.deadline)) : "—"} warn={!!project.deadline && dateToDay(project.deadline) < t} />
            <Fact label="Inspection" value={project.inspectionDate ? fmtDay(dateToDay(project.inspectionDate)) : "—"} />
            <Fact label="Earliest" value={maybeDay(project.earliestDate) ? fmtDay(maybeDay(project.earliestDate)!) : "—"} />
            <Fact label="Preferred" value={maybeDay(project.preferredDate) ? fmtDay(maybeDay(project.preferredDate)!) : "—"} />
            <Fact label="People needed" value={String(project.estCrewSize)} />
            <Fact label="Weather" value={WEATHER_SENSITIVITY_LABEL[project.weatherSensitivity]} />
            <Fact label="Surface" value={project.surfaceReady ? "✅ Ready" : "❌ Not ready"} warn={!project.surfaceReady} />
            <Fact label="Customer" value={project.customerReady ? "✅ Ready" : "❌ Not ready"} warn={!project.customerReady} />
            <div className="col-span-2">
              <div className="label">Required skills</div>
              <div className="text-sm">{project.requiredSkills.map((r) => `${r.skill.name}${r.minCount > 1 ? ` ×${r.minCount}` : ""}`).join(", ") || "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="label">Required equipment</div>
              <div className="text-sm">
                {project.requiredEquipment.map((r) => `${EQUIPMENT_TYPE_ICON[r.type]} ${EQUIPMENT_TYPE_LABEL[r.type]}${r.quantity > 1 ? ` ×${r.quantity}` : ""}`).join(", ") || "—"}
              </div>
            </div>
            {project.scope && (
              <div className="col-span-2 sm:col-span-4">
                <div className="label">Scope</div>
                <p className="text-sm">{project.scope}</p>
              </div>
            )}
            {project.notes && (
              <div className="col-span-2 sm:col-span-4">
                <div className="label">Office notes</div>
                <p className="text-sm">{project.notes}</p>
              </div>
            )}
          </section>

          {/* Schedule */}
          <section className="card p-4">
            <h2 className="mb-2 font-bold">📅 Schedule</h2>
            {!blocks.length && <p className="text-sm text-slate-500">Not on the schedule yet. Drag it onto the board from the TO DO list.</p>}
            <ul className="divide-y divide-slate-100">
              {blocks.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link href={`/board?view=day&date=${dateToDay(b.day)}`} className="w-52 font-semibold hover:underline">
                    {fmtDay(dateToDay(b.day))} · {fmtRange(b.startMin, b.endMin)}
                  </Link>
                  <span className={clsx("chip", b.state === "COMMITTED" ? "bg-blue-600 text-white" : "tentative border border-sky-500 bg-sky-50 text-sky-800")}>
                    {b.state === "COMMITTED" ? "Committed" : "Tentative"}
                  </span>
                  {b.progress !== "PLANNED" && <span className="chip bg-slate-800 text-white">{b.progress.replace("_", " ").toLowerCase()}</span>}
                  <span className="flex flex-wrap gap-1">
                    {b.assignments.map((a) => (
                      <span key={a.id} className="chip text-white" style={{ background: a.employee.color }}>
                        {a.employee.name}
                      </span>
                    ))}
                    {b.equipmentAssignments.map((a) => (
                      <span key={a.id} className="chip bg-slate-100 text-slate-700">
                        {EQUIPMENT_TYPE_ICON[a.equipment.type]} {a.equipment.unitCode}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Field reports */}
          {reports.length > 0 && (
            <section className="card p-4">
              <h2 className="mb-2 font-bold">🚧 Field condition reports</h2>
              <ul className="space-y-2">
                {reports.map((r) => (
                  <li key={r.id} className={clsx("rounded-lg border-l-4 p-3 text-sm", r.canProceed ? "border-amber-500 bg-amber-50" : "border-red-600 bg-red-50")}>
                    <div className="font-bold">
                      {CONDITION_REASON_ICON[r.reason]} {CONDITION_REASON_LABEL[r.reason]}
                      {!r.canProceed && " — could not continue"}
                    </div>
                    <div className="text-slate-700">
                      {r.percentComplete !== null && `${r.percentComplete}% complete. `}
                      {r.hoursWorked !== null && `${r.hoursWorked} hrs worked. `}
                      {r.remainingHours !== null && `About ${r.remainingHours} hrs remaining.`}
                    </div>
                    {r.note && <div className="mt-1 italic">“{r.note}”</div>}
                    <div className="mt-1 text-xs text-slate-500">
                      {r.reportedBy?.name} · {fmtTimestamp(r.at)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Notes */}
          <section className="card p-4">
            <h2 className="mb-2 font-bold">📝 Notes</h2>
            <form action={addProjectNote} className="mb-3 flex gap-2">
              <input type="hidden" name="projectId" value={id} />
              <input name="body" className="input" placeholder="Add a note…" required />
              <button className="btn-primary">Add</button>
            </form>
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-slate-50 p-2.5 text-sm">
                  <div>{n.body}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {n.author?.name ?? "System"} · {fmtTimestamp(n.at)}
                    {n.kind !== "NOTE" && ` · ${n.kind.replace("_", " ").toLowerCase()}`}
                  </div>
                </li>
              ))}
              {!notes.length && <li className="text-sm text-slate-500">No notes yet.</li>}
            </ul>
          </section>

          {/* Photos */}
          <section className="card p-4">
            <h2 className="mb-2 font-bold">📷 Photos</h2>
            <form action={uploadProjectPhoto} className="mb-3 flex flex-wrap gap-2">
              <input type="hidden" name="projectId" value={id} />
              <input type="file" name="photo" accept="image/*" multiple required className="text-sm" />
              <input name="caption" className="input max-w-xs" placeholder="Caption (optional)" />
              <button className="btn-secondary">Upload</button>
            </form>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {photos.map((p) => (
                <a key={p.id} href={`/api/photos/${p.fileKey}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/photos/${p.fileKey}`} alt={p.caption ?? "Project photo"} className="aspect-square w-full object-cover" />
                  <div className="p-1.5 text-xs text-slate-600">
                    {p.caption ?? ""} <span className="text-slate-400">· {p.uploadedBy?.name} · {fmtTimestamp(p.takenAt)}</span>
                  </div>
                </a>
              ))}
              {!photos.length && <p className="col-span-full text-sm text-slate-500">No photos yet.</p>}
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 font-bold">Status</h2>
            <form action={changeProjectStatus} className="space-y-2">
              <input type="hidden" name="projectId" value={id} />
              <select name="status" defaultValue={project.status} className="input">
                {Object.entries(PROJECT_STATUS_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input name="reason" className="input" placeholder="Reason (optional)" />
              <button className="btn-secondary w-full">Update status</button>
            </form>
          </section>

          <section className="card p-4 text-sm">
            <h2 className="mb-2 font-bold">Contact</h2>
            <div className="font-semibold">{project.contactName ?? "—"}</div>
            {project.contactPhone && (
              <a href={`tel:${project.contactPhone}`} className="block text-blue-700">
                📞 {project.contactPhone}
              </a>
            )}
            {project.contactEmail && (
              <a href={`mailto:${project.contactEmail}`} className="block text-blue-700">
                ✉️ {project.contactEmail}
              </a>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-bold">Status history</h2>
            <ul className="space-y-1.5 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <span className={clsx("chip", PROJECT_STATUS_COLOR[h.toStatus])}>{PROJECT_STATUS_LABEL[h.toStatus]}</span>
                  <div className="text-xs text-slate-500">
                    {fmtTimestamp(h.at)} · {h.changedBy?.name ?? "System"}
                    {h.reason && ` · ${h.reason}`}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-bold">Change history</h2>
            <ul className="space-y-2 text-sm">
              {audit.map((a) => (
                <li key={a.id} className="border-l-2 border-slate-300 pl-2">
                  <div>{a.summary}</div>
                  <div className="text-xs text-slate-500">
                    {fmtTimestamp(a.at)} · {a.actor?.name ?? "System"}
                    {a.reason && <span className="font-semibold text-slate-700"> · Reason: {a.reason}</span>}
                  </div>
                </li>
              ))}
              {!audit.length && <li className="text-slate-500">No changes recorded yet.</li>}
            </ul>
          </section>

          {user.role === "OWNER" && (
            <form action={deleteProject} className="card p-4">
              <input type="hidden" name="projectId" value={id} />
              <p className="mb-2 text-xs text-slate-500">Prefer setting the status to Cancelled — it keeps the history. Deleting removes everything.</p>
              <ConfirmButton className="btn-secondary w-full text-red-700" message={`Delete ${project.name} — ${project.city} and all of its history? This can't be undone.`}>
                Delete project
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

function Fact({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx("text-sm", strong && "text-base font-bold", warn && "font-bold text-red-700")}>{value}</div>
    </div>
  );
}
