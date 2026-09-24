import Link from "next/link";
import clsx from "clsx";
import { notFound } from "next/navigation";
import { addDowntime, deleteDowntime } from "@/app/actions/resources";
import { EquipmentForm } from "@/components/EquipmentForm";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EQUIPMENT_TYPE_ICON } from "@/lib/labels";
import { dateToDay, dayToDate, fmtDay, fmtRange, today } from "@/lib/time";

export default async function EquipmentDetailPage({ params }: PageProps<"/equipment/[id]">) {
  await requireUser(OFFICE);
  const { id } = await params;
  const t = today();
  const [unit, locations] = await Promise.all([
    db.equipment.findUnique({
      where: { id },
      include: {
        downtime: { where: { endDay: { gte: dayToDate(t) } }, orderBy: { startDay: "asc" } },
        assignments: { where: { block: { day: { gte: dayToDate(t) } } }, include: { block: { include: { project: true } } } },
      },
    }),
    db.location.findMany({ orderBy: { city: "asc" } }),
  ]);
  if (!unit) notFound();
  const upcoming = unit.assignments.sort((a, b) => a.block.day.getTime() - b.block.day.getTime() || a.block.startMin - b.block.startMin);
  const down = unit.status === "MAINTENANCE" || unit.status === "OUT_OF_SERVICE";

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:p-6">
      <Link href="/equipment" className="text-sm font-semibold text-blue-700">
        ← Equipment
      </Link>
      <h1 className="text-2xl font-bold">
        {EQUIPMENT_TYPE_ICON[unit.type]} {unit.name} <span className="font-mono text-base font-normal text-slate-500">{unit.unitCode}</span>
      </h1>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EquipmentForm
            locations={locations}
            values={{
              id: unit.id,
              name: unit.name,
              unitCode: unit.unitCode,
              type: unit.type,
              status: unit.status === "ASSIGNED" ? "AVAILABLE" : unit.status,
              maintenanceNote: unit.maintenanceNote ?? "",
              locationId: unit.currentLocationId ?? "",
              color: unit.color,
              active: unit.active,
            }}
          />
        </div>
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 font-bold">🔧 Planned maintenance</h2>
            <form action={addDowntime} className="space-y-2">
              <input type="hidden" name="equipmentId" value={unit.id} />
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="label">From</span>
                  <input type="date" name="startDay" className="input" defaultValue={t} required />
                </label>
                <label>
                  <span className="label">To</span>
                  <input type="date" name="endDay" className="input" defaultValue={t} required />
                </label>
              </div>
              <input name="reason" className="input" placeholder="Reason (e.g. brake service)" />
              <button className="btn-secondary w-full">Add maintenance window</button>
            </form>
            <ul className="mt-3 space-y-1.5">
              {unit.downtime.map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
                  <span>
                    {fmtDay(dateToDay(d.startDay))}
                    {d.endDay.getTime() !== d.startDay.getTime() && `–${fmtDay(dateToDay(d.endDay))}`} · {d.reason}
                  </span>
                  <form action={deleteDowntime}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="text-xs text-slate-400 hover:text-red-600">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-bold">📅 Upcoming assignments</h2>
            {down && upcoming.length > 0 && (
              <div className="mb-2 rounded-lg border-l-4 border-red-600 bg-red-50 p-2 text-sm font-semibold text-red-800">
                ⚠️ This unit is {unit.status === "MAINTENANCE" ? "in maintenance" : "out of service"} but still assigned to {upcoming.length} job(s). They&apos;re flagged on the board.
              </div>
            )}
            <ul className="space-y-1 text-sm">
              {upcoming.map((a) => (
                <li key={a.id} className={clsx("flex justify-between gap-2", down && "text-red-800")}>
                  <Link href={`/projects/${a.block.projectId}`} className="font-semibold hover:underline">
                    {a.block.project.name} <span className="font-normal text-slate-500">{a.block.project.city}</span>
                  </Link>
                  <span className="shrink-0 text-xs">
                    {fmtDay(dateToDay(a.block.day))} {fmtRange(a.block.startMin, a.block.endMin)}
                  </span>
                </li>
              ))}
              {!upcoming.length && <li className="text-slate-500">Nothing scheduled.</li>}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
