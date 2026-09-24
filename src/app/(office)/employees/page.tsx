import Link from "next/link";
import clsx from "clsx";
import { addOfficeUser, addSkill, markSickToday, setOfficeUserActive } from "@/app/actions/resources";
import { OFFICE, requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { db } from "@/lib/db";
import { EMPLOYEE_STATUS_COLOR, EMPLOYEE_STATUS_LABEL } from "@/lib/labels";
import { addDays, dateToDay, dayOfWeek, dayRange, dayToDate, fmtDay, fmtMinShort, fmtRange, today } from "@/lib/time";

export const metadata = { title: "People · BAM Scheduling" };

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const me = await requireUser(OFFICE);
  const welcome = (await searchParams).welcome === "1";
  const [officeUsers, skills] = await Promise.all([
    db.user.findMany({ where: { role: { in: ["OWNER", "DISPATCHER"] } }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.skill.findMany({ orderBy: { name: "asc" } }),
  ]);
  const t = today();
  const days = dayRange(t, 7).filter((d) => dayOfWeek(d) !== 0);
  const employees = await db.employee.findMany({
    include: {
      skills: { include: { skill: true } },
      timeOff: { where: { endDay: { gte: dayToDate(t) } } },
      assignments: {
        where: { block: { day: { gte: dayToDate(t), lte: dayToDate(addDays(t, 7)) } } },
        include: { block: { include: { project: true } } },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">👷 People</h1>
          <p className="text-sm text-slate-500">Everyone is an individual resource. There are no fixed crews.</p>
        </div>
        <Link href="/employees/new" className="btn-primary">
          + Add person
        </Link>
      </div>

      {welcome && (
        <section className="card border-l-8 border-emerald-500 p-4">
          <h2 className="text-lg font-bold">✅ Sample data removed. You&apos;re starting fresh.</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>
              <b>Add your crew</b> with <b>+ Add person</b>. Each person automatically gets a phone login.
            </li>
            <li>
              <b>Add office logins</b> (dispatchers) below.
            </li>
            <li>
              <b>Add equipment</b> on the <Link href="/equipment" className="font-semibold text-blue-700 underline">Equipment</Link> page (trucks, trailers, machines).
            </li>
            <li>
              <b>Add jobs</b> with <b>+ New project</b> (top right). Each new city becomes a location filter automatically.
            </li>
            <li>
              <b>Schedule</b> by dragging jobs onto the <Link href="/board" className="font-semibold text-blue-700 underline">Schedule</Link> board.
            </li>
          </ol>
        </section>
      )}

      {employees.length === 0 && <p className="card p-6 text-center text-slate-500">No people yet. Click <b>+ Add person</b> to add your first crew member.</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {employees.map((e) => {
          const offOn = (d: string) => e.timeOff.filter((o) => dateToDay(o.startDay) <= d && dateToDay(o.endDay) >= d);
          const jobsOn = (d: string) => e.assignments.filter((a) => dateToDay(a.block.day) === d).sort((a, b) => a.block.startMin - b.block.startMin);
          const offToday = offOn(t);
          const status = offToday.length
            ? offToday[0].startMin !== null
              ? "PARTIAL_DAY"
              : offToday[0].type === "OFF"
                ? "OFF"
                : offToday[0].type
            : jobsOn(t).length
              ? "ASSIGNED"
              : e.status === "ASSIGNED"
                ? "AVAILABLE"
                : e.status;
          return (
            <div key={e.id} className={clsx("card p-4", !e.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/employees/${e.id}`} className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: e.color }}>
                    {e.name.slice(0, 2)}
                  </span>
                  <div>
                    <div className="text-lg font-bold hover:underline">{e.name}</div>
                    <div className="text-sm text-slate-500">
                      {e.position} {e.phone && `· ${e.phone}`}
                    </div>
                  </div>
                </Link>
                <div className="flex flex-col items-end gap-1">
                  <span className={clsx("chip", EMPLOYEE_STATUS_COLOR[status])}>{EMPLOYEE_STATUS_LABEL[status]} today</span>
                  {!offToday.length && e.active && (
                    <form action={markSickToday}>
                      <input type="hidden" name="employeeId" value={e.id} />
                      <button className="text-xs font-semibold text-red-700 hover:underline">🤒 Mark sick today</button>
                    </form>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {e.skills.map((s) => (
                  <span key={s.skillId} className="chip bg-slate-100 text-slate-700">
                    {s.isCertification && "🎓 "}
                    {s.skill.name}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Normal hours {fmtRange(e.normalStartMin, e.normalEndMin)} · {e.workDays.map((d) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d]).join(" ")}
              </div>
              <div className="mt-3 grid grid-cols-6 gap-1">
                {days.map((d) => {
                  const off = offOn(d);
                  const jobs = jobsOn(d);
                  return (
                    <div key={d} className={clsx("min-h-14 rounded border p-1 text-[10px] leading-tight", d === t ? "border-yellow-400 bg-yellow-50" : "border-slate-200")}>
                      <div className="font-bold text-slate-600">{fmtDay(d)}</div>
                      {off.map((o) => (
                        <div key={o.id} className="rounded bg-slate-700 px-1 font-semibold uppercase text-white">
                          {o.startMin !== null ? `off ${fmtMinShort(o.startMin)}` : o.type.toLowerCase()}
                        </div>
                      ))}
                      {jobs.map((a) => (
                        <div key={a.id} className={clsx("truncate", a.block.state === "COMMITTED" ? "text-blue-800" : "text-sky-700 italic")}>
                          {fmtMinShort(a.block.startMin)} {a.block.project.name}
                        </div>
                      ))}
                      {!off.length && !jobs.length && <div className="text-emerald-700">free</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="font-bold">🔑 Office logins</h2>
          <p className="mb-2 text-xs text-slate-500">Owners and dispatchers who use the office screens. Crew members get their phone login when you add them above.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {officeUsers.map((u) => (
              <li key={u.id} className={clsx("flex items-center justify-between gap-2 py-1.5", !u.active && "opacity-50")}>
                <span>
                  <b>{u.name}</b> <span className="chip bg-slate-100 text-slate-700">{ROLE_LABEL[u.role]}</span>
                  {u.id === me.id && <span className="ml-1 text-xs text-slate-500">(you)</span>}
                </span>
                {me.role === "OWNER" && u.id !== me.id && (
                  <form action={setOfficeUserActive}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="active" value={u.active ? "" : "on"} />
                    <button className="text-xs font-semibold text-blue-700 hover:underline">{u.active ? "Turn off" : "Turn back on"}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {me.role === "OWNER" && (
            <form action={addOfficeUser} className="mt-3 flex flex-wrap gap-2">
              <input name="name" className="input max-w-xs flex-1" placeholder="Name" required />
              <select name="role" className="input w-auto" defaultValue="DISPATCHER">
                <option value="DISPATCHER">Dispatcher</option>
                <option value="OWNER">Owner</option>
              </select>
              <button className="btn-secondary">Add login</button>
            </form>
          )}
        </section>

        <section className="card p-4">
          <h2 className="font-bold">🎓 Skills &amp; certifications</h2>
          <p className="mb-2 text-xs text-slate-500">The list you pick from on each person and each project.</p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <span key={s.id} className="chip bg-slate-100 px-2.5 py-1 text-sm text-slate-700">
                {s.name}
              </span>
            ))}
          </div>
          <form action={addSkill} className="mt-3 flex gap-2">
            <input name="name" className="input max-w-xs flex-1" placeholder="New skill, e.g. Pressure Washing" required />
            <button className="btn-secondary">Add skill</button>
          </form>
        </section>
      </div>
    </main>
  );
}
