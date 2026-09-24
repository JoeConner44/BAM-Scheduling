import Link from "next/link";
import clsx from "clsx";
import { FINDING_ICON } from "@/components/board/ConflictDialog";
import { weatherIcon } from "@/components/board/WeatherBadge";
import { OFFICE, requireUser } from "@/lib/auth";
import { loadSnapshot, openProjects, toCard } from "@/lib/data";
import { db } from "@/lib/db";
import { checkAll, isLive } from "@/lib/engine/conflicts";
import { EQUIPMENT_TYPE_ICON } from "@/lib/labels";
import { jobsAtRisk } from "@/lib/risk";
import { addDays, dateToDay, dayToDate, fmtDay, fmtDayLong, fmtRange, today } from "@/lib/time";

export const metadata = { title: "Dashboard · BAM Scheduling" };

export default async function Dashboard() {
  await requireUser(OFFICE);
  const t = today();
  const horizon = addDays(t, 14);

  const [snap, open, employees, equipment, todaysBlocks, forecasts] = await Promise.all([
    loadSnapshot(t, horizon),
    openProjects(),
    db.employee.findMany({ where: { active: true }, include: { timeOff: { where: { startDay: { lte: dayToDate(t) }, endDay: { gte: dayToDate(t) } } } }, orderBy: { name: "asc" } }),
    db.equipment.findMany({ where: { active: true }, include: { downtime: { where: { startDay: { lte: dayToDate(t) }, endDay: { gte: dayToDate(t) } } } }, orderBy: { unitCode: "asc" } }),
    db.scheduleBlock.findMany({
      where: { day: dayToDate(t) },
      include: { project: true, assignments: { include: { employee: true } }, equipmentAssignments: { include: { equipment: true } } },
      orderBy: { startMin: "asc" },
    }),
    db.weatherForecast.findMany({ where: { day: { gte: dayToDate(t), lte: dayToDate(addDays(t, 6)) } }, include: { location: true }, orderBy: { day: "asc" } }),
  ]);

  const upcoming = snap.blocks.filter((b) => b.day >= t && b.day <= horizon);
  const findings = checkAll(snap);
  const cards = open.map(toCard);
  const blockProject = Object.fromEntries(snap.blocks.map((b) => [b.id, b.projectId]));
  const risks = jobsAtRisk(
    cards,
    Object.fromEntries(upcoming.map((b) => [b.id, findings[b.id] ?? []])),
    blockProject,
    t,
  );

  const conflicts = upcoming.flatMap((b) => (findings[b.id] ?? []).filter((f) => f.severity === "conflict").map((f) => ({ f, b })));
  const dedupedConflicts = conflicts.filter((c, i) => conflicts.findIndex((x) => x.f.dedupeKey === c.f.dedupeKey) === i);
  const weatherRisks = upcoming.flatMap((b) => (findings[b.id] ?? []).filter((f) => f.code === "WEATHER").map((f) => ({ f, b })));

  const busyToday = new Set(todaysBlocks.filter(isLive).flatMap((b) => b.assignments.map((a) => a.employeeId)));
  const eqBusyToday = new Set(todaysBlocks.filter(isLive).flatMap((b) => b.equipmentAssignments.map((a) => a.equipmentId)));
  const off = employees.filter((e) => e.timeOff.length);
  const available = employees.filter((e) => !e.timeOff.some((o) => o.startMin === null) && !busyToday.has(e.id));
  const eqDown = equipment.filter((e) => e.status === "MAINTENANCE" || e.status === "OUT_OF_SERVICE" || e.downtime.length);
  const eqAvailable = equipment.filter((e) => !eqDown.includes(e) && !eqBusyToday.has(e.id));

  const committedToday = todaysBlocks.filter((b) => b.state === "COMMITTED");
  const tentativeToday = todaysBlocks.filter((b) => b.state === "TENTATIVE");
  const unassigned = cards.filter((c) => c.unscheduledHours > 0);
  const active = todaysBlocks.filter((b) => b.progress === "ACTIVE");
  const delayed = open.filter((p) => ["DELAYED", "WEATHER_DELAY"].includes(p.status));
  const projectLabel = (id: string) => snap.projects[id]?.label ?? "Project";

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-3 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Today · {fmtDayLong(t)}</h1>
          <p className="text-sm text-slate-500">What&apos;s happening, what&apos;s possible, and what&apos;s at risk.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/board?view=day" className="btn-secondary">
            📅 Today&apos;s board
          </Link>
          <Link href="/board" className="btn-primary">
            Open schedule →
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile href="/board?view=day" label="Scheduled today" value={committedToday.length} tone="blue" />
        <Tile href="/board?view=day" label="Tentative today" value={tentativeToday.length} tone="sky" />
        <Tile href="/todo?needs=1" label="Unassigned projects" value={unassigned.length} tone="rose" />
        <Tile href="/employees" label="Available people" value={available.length} sub={`of ${employees.length}`} tone="emerald" />
        <Tile href="/employees" label="People off" value={off.length} tone="slate" />
        <Tile href="/equipment" label="Equipment available" value={eqAvailable.length} sub={`${eqBusyToday.size} assigned · ${eqDown.length} down`} tone="emerald" />
        <Tile href="/board?view=day" label="Active jobs" value={active.length} tone="violet" />
        <Tile href="/todo?status=DELAYED" label="Delayed jobs" value={delayed.length} tone="orange" />
        <Tile href="#weather" label="Weather risks" value={weatherRisks.length} sub="next 2 weeks" tone="cyan" />
        <Tile href="#conflicts" label="Scheduling conflicts" value={dedupedConflicts.length} sub="next 2 weeks" tone={dedupedConflicts.length ? "red" : "emerald"} />
        <Tile href="#risk" label="Jobs at risk" value={risks.length} tone={risks.some((r) => r.level === "high") ? "red" : "amber"} />
        <Tile href="/todo" label="Open projects" value={cards.length} tone="slate" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's work */}
        <section className="card p-4 lg:col-span-2">
          <h2 className="mb-3 text-lg font-bold">Today&apos;s work</h2>
          {!todaysBlocks.length && <p className="text-sm text-slate-500">Nothing scheduled today.</p>}
          <ul className="divide-y divide-slate-100">
            {todaysBlocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-40 shrink-0 font-mono text-sm">{fmtRange(b.startMin, b.endMin)}</span>
                <Link href={`/projects/${b.projectId}`} className="min-w-40 flex-1 font-semibold hover:underline">
                  {b.project.name} <span className="font-normal text-slate-500">— {b.project.city}</span>
                </Link>
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
                <span
                  className={clsx(
                    "chip",
                    b.progress === "ACTIVE" ? "bg-violet-600 text-white" : b.progress === "DONE" ? "bg-green-600 text-white" : b.progress === "PAUSED" ? "bg-amber-100 text-amber-800" : b.progress === "CANNOT_PROCEED" ? "bg-orange-100 text-orange-800" : b.state === "COMMITTED" ? "bg-blue-100 text-blue-800" : "bg-sky-50 text-sky-800",
                  )}
                >
                  {b.progress === "PLANNED" ? (b.state === "COMMITTED" ? "Committed" : "Tentative") : b.progress.replace("_", " ").toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* People & equipment */}
        <section className="card space-y-3 p-4">
          <h2 className="text-lg font-bold">People &amp; equipment today</h2>
          <div>
            <div className="label">Available</div>
            <div className="flex flex-wrap gap-1">
              {available.map((e) => (
                <span key={e.id} className="chip text-white" style={{ background: e.color }}>
                  {e.name}
                </span>
              ))}
              {!available.length && <span className="text-sm text-slate-500">Everyone is assigned or off.</span>}
            </div>
          </div>
          <div>
            <div className="label">Off</div>
            <ul className="text-sm">
              {off.map((e) => (
                <li key={e.id}>
                  <b>{e.name}</b> — {e.timeOff.map((o) => `${o.type.toLowerCase()}${o.startMin !== null ? ` ${fmtRange(o.startMin, o.endMin!)}` : ""}`).join(", ")}
                </li>
              ))}
              {!off.length && <li className="text-slate-500">Nobody.</li>}
            </ul>
          </div>
          <div>
            <div className="label">Equipment down</div>
            <ul className="text-sm">
              {eqDown.map((e) => (
                <li key={e.id}>
                  {EQUIPMENT_TYPE_ICON[e.type]} <b>{e.name}</b> — {e.maintenanceNote ?? e.downtime[0]?.reason ?? e.status.replaceAll("_", " ").toLowerCase()}
                </li>
              ))}
              {!eqDown.length && <li className="text-slate-500">All equipment running.</li>}
            </ul>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section id="risk" className="card p-4">
          <h2 className="mb-3 text-lg font-bold">⚠️ Jobs at risk</h2>
          {!risks.length && <p className="text-sm text-slate-500">No jobs at risk right now.</p>}
          <ul className="space-y-2">
            {risks.map((r) => (
              <li key={r.projectId} className={clsx("rounded-lg border-l-4 p-3", r.level === "high" ? "border-red-600 bg-red-50" : "border-amber-500 bg-amber-50")}>
                <Link href={`/projects/${r.projectId}`} className="font-bold hover:underline">
                  {r.label}
                </Link>
                <ul className="mt-0.5 list-disc pl-5 text-sm text-slate-700">
                  {r.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section id="conflicts" className="card p-4">
          <h2 className="mb-3 text-lg font-bold">🔴 Scheduling conflicts</h2>
          {!dedupedConflicts.length && <p className="text-sm text-slate-500">No conflicts in the next two weeks. 👍</p>}
          <ul className="space-y-2">
            {dedupedConflicts.map(({ f, b }) => (
              <li key={f.key} className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm">
                <div className="font-bold">
                  {FINDING_ICON[f.code]} {f.title} · {fmtDay(b.day)}
                </div>
                <div className="text-slate-700">{f.message}</div>
                <Link href={`/board?view=day&date=${b.day}`} className="text-xs font-semibold text-blue-700 hover:underline">
                  Fix on the board →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section id="weather" className="card p-4">
        <h2 className="mb-3 text-lg font-bold">🌦️ Weather</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="py-1 pr-2">Location</th>
                  {Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((d) => (
                    <th key={d} className="px-1 py-1 text-center">
                      {fmtDay(d).split(" ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...new Set(forecasts.map((f) => f.location.city))].map((city) => (
                  <tr key={city} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2 font-semibold">{city}</td>
                    {Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((d) => {
                      const f = forecasts.find((x) => x.location.city === city && dateToDay(x.day) === d);
                      return (
                        <td key={d} className={clsx("px-1 py-1.5 text-center", f && f.precipChance >= 50 && "rounded bg-cyan-100 font-bold text-cyan-900")} title={f?.summary ?? ""}>
                          {f ? `${weatherIcon(f.precipChance)} ${f.precipChance}%` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <Link href="/weather" className="mt-2 inline-block text-xs font-semibold text-blue-700 hover:underline">
              Update forecasts →
            </Link>
          </div>
          <div>
            <div className="label">Affected jobs</div>
            {!weatherRisks.length && <p className="text-sm text-slate-500">No weather-sensitive jobs scheduled on rainy days.</p>}
            <ul className="space-y-2">
              {weatherRisks.map(({ f, b }) => (
                <li key={f.key} className="rounded-lg border-l-4 border-cyan-600 bg-cyan-50 p-2.5 text-sm">
                  <div className="font-bold">
                    🌧️ {projectLabel(b.projectId)} · {fmtDay(b.day)} {fmtRange(b.startMin, b.endMin)}
                  </div>
                  <div className="text-slate-700">{f.message}</div>
                  <Link href={`/board?date=${b.day}`} className="text-xs font-semibold text-blue-700 hover:underline">
                    Decide on the board →
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Weather never moves anything by itself. You decide what to move.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

const TONES: Record<string, string> = {
  blue: "border-blue-500",
  sky: "border-sky-400",
  rose: "border-rose-500",
  emerald: "border-emerald-500",
  slate: "border-slate-400",
  violet: "border-violet-500",
  orange: "border-orange-500",
  cyan: "border-cyan-500",
  red: "border-red-600 bg-red-50",
  amber: "border-amber-500",
};

function Tile({ href, label, value, sub, tone }: { href: string; label: string; value: number; sub?: string; tone: string }) {
  return (
    <Link href={href} className={clsx("card border-t-4 p-3 transition hover:shadow-md", TONES[tone])}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </Link>
  );
}
