import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/session";
import { FieldJobCard, type FieldJob } from "@/components/field/FieldJobCard";
import { requireUser } from "@/lib/auth";
import { remainingHours } from "@/lib/data";
import { db } from "@/lib/db";
import { dayToDate, fmtDay, fmtDayLong, fmtRange, today, workdayOffset, dateToDay } from "@/lib/time";

export const metadata = { title: "Today · BAM Scheduling" };
export const dynamic = "force-dynamic";

/**
 * The field crew's phone screen. One screen, big buttons, no menus:
 * where am I going, who's with me, what am I taking, and what happened.
 */
export default async function FieldPage({ searchParams }: PageProps<"/field">) {
  const user = await requireUser();
  const sp = await searchParams;
  const office = user.role !== "FIELD";

  // Office users can preview any employee's phone screen.
  const employeeId = office ? (typeof sp.as === "string" ? sp.as : null) : user.employeeId;
  const employees = office ? await db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
  if (office && !employeeId) redirect(`/field?as=${employees[0]?.id ?? ""}`);
  if (!employeeId) return <p className="p-6">Your login isn&apos;t linked to an employee yet. Ask the office.</p>;

  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) redirect("/field");
  const t = today();
  const tomorrow = workdayOffset(t, workdayOffset(t, 0) === t ? 1 : 0);

  const blocks = await db.scheduleBlock.findMany({
    where: { day: { in: [dayToDate(t), dayToDate(tomorrow)] }, assignments: { some: { employeeId } } },
    include: {
      project: true,
      assignments: { include: { employee: true } },
      equipmentAssignments: { include: { equipment: true } },
    },
    orderBy: [{ day: "asc" }, { startMin: "asc" }],
  });
  const timeOff = await db.timeOff.findFirst({ where: { employeeId, startDay: { lte: dayToDate(t) }, endDay: { gte: dayToDate(t) } } });

  const toJob = (b: (typeof blocks)[number]): FieldJob => {
    const p = b.project;
    const address = [p.street, p.city, `${p.state} ${p.zip ?? ""}`.trim()].filter(Boolean).join(", ");
    return {
      id: b.id,
      projectId: p.id,
      name: p.name,
      city: p.city,
      address,
      mapsUrl: p.lat && p.lng ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`,
      timeRange: fmtRange(b.startMin, b.endMin),
      state: b.state,
      progress: b.progress,
      coworkers: b.assignments.filter((a) => a.employeeId !== employeeId).map((a) => ({ name: a.employee.name, phone: a.employee.phone, color: a.employee.color })),
      equipment: b.equipmentAssignments.map((a) => ({ name: a.equipment.name, unitCode: a.equipment.unitCode, type: a.equipment.type })),
      scope: p.scope,
      officeNotes: p.notes,
      contactName: p.contactName,
      contactPhone: p.contactPhone,
      percentComplete: p.percentComplete,
      remainingHours: remainingHours(p),
      plannedHours: (b.endMin - b.startMin) / 60,
      startedAt: b.startedAt?.toISOString() ?? null,
      actualHours: b.actualHours,
    };
  };
  const todays = blocks.filter((b) => dateToDay(b.day) === t).map(toJob);
  const next = blocks.filter((b) => dateToDay(b.day) === tomorrow);
  const currentId = todays.find((j) => j.progress === "ACTIVE" || j.progress === "PAUSED")?.id ?? todays.find((j) => j.progress === "PLANNED")?.id;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 bg-slate-900 px-4 py-3 text-white shadow">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400">Today</div>
            <div className="text-lg font-bold">{fmtDayLong(t)}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full font-bold" style={{ background: employee.color }}>
              {employee.name.slice(0, 2)}
            </span>
            {office ? (
              <Link href="/" className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold">
                Office
              </Link>
            ) : (
              <form action={signOut}>
                <button className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold">Sign out</button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 p-3 pb-16">
        {office && (
          <div className="rounded-xl bg-yellow-100 p-3 text-sm">
            <div className="font-semibold">Office preview — viewing as:</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {employees.map((e) => (
                <Link key={e.id} href={`/field?as=${e.id}`} className={`rounded-full px-3 py-1 font-semibold ${e.id === employeeId ? "bg-slate-900 text-white" : "bg-white"}`}>
                  {e.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        <h1 className="text-xl font-bold">Hi {employee.name} 👋</h1>

        {timeOff && (
          <div className="rounded-xl bg-slate-800 p-4 text-white">
            You&apos;re marked <b>{timeOff.type.toLowerCase()}</b> today
            {timeOff.startMin !== null && ` from ${fmtRange(timeOff.startMin, timeOff.endMin ?? 1440)}`}.
          </div>
        )}

        {!todays.length && <div className="rounded-xl bg-white p-6 text-center text-lg text-slate-600 shadow">No jobs assigned to you today.</div>}

        {todays.map((job) => (
          <FieldJobCard key={job.id} job={job} expanded={job.id === currentId || todays.length === 1} />
        ))}

        {next.length > 0 && (
          <section className="rounded-xl bg-white p-4 shadow">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Next: {fmtDay(tomorrow)}</h2>
            <ul className="space-y-2">
              {next.map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <span className="font-semibold">
                    {b.project.name} <span className="font-normal text-slate-500">— {b.project.city}</span>
                  </span>
                  <span className="shrink-0 text-sm">
                    {fmtRange(b.startMin, b.endMin)}
                    {b.state === "TENTATIVE" && <span className="ml-1 italic text-sky-700">(tentative)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
