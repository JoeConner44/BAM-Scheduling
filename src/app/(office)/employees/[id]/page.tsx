import Link from "next/link";
import clsx from "clsx";
import { notFound } from "next/navigation";
import { deleteTimeOff } from "@/app/actions/resources";
import { EmployeeForm, TimeOffForm } from "@/components/EmployeeForms";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { TIME_OFF_LABEL } from "@/lib/labels";
import { dateToDay, dayToDate, fmtDay, fmtRange, toHHMM, today } from "@/lib/time";

export default async function EmployeePage({ params }: PageProps<"/employees/[id]">) {
  await requireUser(OFFICE);
  const { id } = await params;
  const t = today();
  const [employee, skills] = await Promise.all([
    db.employee.findUnique({
      where: { id },
      include: {
        skills: true,
        timeOff: { where: { endDay: { gte: dayToDate(t) } }, orderBy: { startDay: "asc" } },
        assignments: {
          where: { block: { day: { gte: dayToDate(t) } } },
          include: { block: { include: { project: true } } },
        },
      },
    }),
    db.skill.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!employee) notFound();
  const upcoming = employee.assignments.sort((a, b) => a.block.day.getTime() - b.block.day.getTime() || a.block.startMin - b.block.startMin);

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:p-6">
      <Link href="/employees" className="text-sm font-semibold text-blue-700">
        ← People
      </Link>
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: employee.color }}>
          {employee.name.slice(0, 2)}
        </span>
        <h1 className="text-2xl font-bold">{employee.name}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EmployeeForm
            skills={skills}
            values={{
              id: employee.id,
              name: employee.name,
              phone: employee.phone ?? "",
              position: employee.position ?? "",
              color: employee.color,
              normalStart: toHHMM(employee.normalStartMin),
              normalEnd: toHHMM(employee.normalEndMin),
              workDays: employee.workDays,
              status: employee.status,
              active: employee.active,
              skills: Object.fromEntries(employee.skills.map((s) => [s.skillId, s.isCertification])),
            }}
          />
        </div>
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 font-bold">🏖️ Mark off / time off</h2>
            <TimeOffForm employeeId={employee.id} today={t} />
            <ul className="mt-3 space-y-1.5">
              {employee.timeOff.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                  <div>
                    <b>{TIME_OFF_LABEL[o.type]}</b> {fmtDay(dateToDay(o.startDay))}
                    {o.endDay.getTime() !== o.startDay.getTime() && `–${fmtDay(dateToDay(o.endDay))}`}
                    {o.startMin !== null && o.endMin !== null && ` · ${fmtRange(o.startMin, o.endMin)}`}
                    {o.note && <div className="text-xs text-slate-500">{o.note}</div>}
                  </div>
                  <form action={deleteTimeOff}>
                    <input type="hidden" name="id" value={o.id} />
                    <button className="text-xs text-slate-400 hover:text-red-600">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-bold">📅 Upcoming work</h2>
            <ul className="space-y-1 text-sm">
              {upcoming.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <Link href={`/projects/${a.block.projectId}`} className="font-semibold hover:underline">
                    {a.block.project.name} <span className="font-normal text-slate-500">{a.block.project.city}</span>
                  </Link>
                  <span className={clsx("shrink-0 text-xs", a.block.state === "TENTATIVE" && "italic text-sky-700")}>
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
