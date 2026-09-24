import Link from "next/link";
import clsx from "clsx";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EQUIPMENT_STATUS_COLOR, EQUIPMENT_STATUS_LABEL, EQUIPMENT_TYPE_ICON, EQUIPMENT_TYPE_LABEL } from "@/lib/labels";
import { addDays, dateToDay, dayOfWeek, dayRange, dayToDate, fmtDay, fmtMinShort, fmtRange, today } from "@/lib/time";

export const metadata = { title: "Equipment · BAM Scheduling" };

export default async function EquipmentPage() {
  await requireUser(OFFICE);
  const t = today();
  const days = dayRange(t, 7).filter((d) => dayOfWeek(d) !== 0);
  const units = await db.equipment.findMany({
    include: {
      currentLocation: true,
      downtime: { where: { endDay: { gte: dayToDate(t) } } },
      assignments: {
        where: { block: { day: { gte: dayToDate(t), lte: dayToDate(addDays(t, 7)) } } },
        include: { block: { include: { project: true } } },
      },
    },
    orderBy: [{ active: "desc" }, { type: "asc" }, { unitCode: "asc" }],
  });

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">🚚 Equipment</h1>
          <p className="text-sm text-slate-500">Every truck, trailer and machine is its own resource and can only be in one place at a time.</p>
        </div>
        <Link href="/equipment/new" className="btn-primary">
          + Add equipment
        </Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {units.map((e) => {
          const downOn = (d: string) => e.downtime.find((x) => dateToDay(x.startDay) <= d && dateToDay(x.endDay) >= d);
          const jobsOn = (d: string) => e.assignments.filter((a) => dateToDay(a.block.day) === d).sort((a, b) => a.block.startMin - b.block.startMin);
          const now = jobsOn(t).find((a) => a.block.progress !== "DONE");
          const status = e.status !== "AVAILABLE" && e.status !== "ASSIGNED" ? e.status : downOn(t) ? "MAINTENANCE" : now ? "ASSIGNED" : "AVAILABLE";
          return (
            <div key={e.id} className={clsx("card p-4", !e.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/equipment/${e.id}`} className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg text-2xl" style={{ background: e.color + "22", border: `2px solid ${e.color}` }}>
                    {EQUIPMENT_TYPE_ICON[e.type]}
                  </span>
                  <div>
                    <div className="text-lg font-bold hover:underline">{e.name}</div>
                    <div className="text-sm text-slate-500">
                      {e.unitCode} · {EQUIPMENT_TYPE_LABEL[e.type]} {e.currentLocation && `· ${e.currentLocation.city}`}
                    </div>
                  </div>
                </Link>
                <span className={clsx("chip", EQUIPMENT_STATUS_COLOR[status])}>{EQUIPMENT_STATUS_LABEL[status]}</span>
              </div>
              {e.maintenanceNote && <div className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">🔧 {e.maintenanceNote}</div>}
              {now && (
                <div className="mt-2 text-sm">
                  Today: <b>{now.block.project.name}</b> — {now.block.project.city}, {fmtRange(now.block.startMin, now.block.endMin)}
                </div>
              )}
              <div className="mt-3 grid grid-cols-6 gap-1">
                {days.map((d) => {
                  const down = downOn(d);
                  const jobs = jobsOn(d);
                  return (
                    <div key={d} className={clsx("min-h-14 rounded border p-1 text-[10px] leading-tight", d === t ? "border-yellow-400 bg-yellow-50" : "border-slate-200")}>
                      <div className="font-bold text-slate-600">{fmtDay(d)}</div>
                      {down && <div className="rounded bg-red-700 px-1 font-semibold text-white">🔧 {down.reason ?? "shop"}</div>}
                      {jobs.map((a) => (
                        <div key={a.id} className={clsx("truncate", a.block.state === "COMMITTED" ? "text-blue-800" : "italic text-sky-700")}>
                          {fmtMinShort(a.block.startMin)} {a.block.project.name}
                        </div>
                      ))}
                      {!down && !jobs.length && <div className="text-emerald-700">free</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
