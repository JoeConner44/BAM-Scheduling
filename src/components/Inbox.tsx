import Link from "next/link";
import clsx from "clsx";
import { dismissAlert, replanFromInbox, setRequestedDate } from "@/app/actions/jobs";
import { openAlerts, type PlanChange } from "@/lib/alerts";
import { db } from "@/lib/db";
import { describeSlots } from "@/lib/planner/run";
import { fmtTimestamp, today } from "@/lib/time";

/** The scheduler's to-do list: new jobs needing a date, problems to look at, and what the app changed. */
export async function Inbox() {
  const [needsDate, alerts, runs, lastWeather] = await Promise.all([
    db.project.findMany({
      where: { acceptedAt: { not: null }, requestedDate: null, status: { notIn: ["COMPLETE", "CANCELLED"] } },
      orderBy: { acceptedAt: "asc" },
      include: { materials: true },
    }),
    openAlerts(),
    db.planRun.findMany({ orderBy: { at: "desc" }, take: 4 }),
    db.location.findFirst({ where: { weatherFetchedAt: { not: null } }, orderBy: { weatherFetchedAt: "desc" } }),
  ]);
  const problems = alerts.filter((a) => a.kind !== "NEW_JOB");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">📥 Inbox</h1>
          <p className="text-sm text-slate-500">
            The app builds and adjusts the schedule. You give it requested dates and handle what it can&apos;t.
            {lastWeather?.weatherFetchedAt && ` Weather updated ${fmtTimestamp(lastWeather.weatherFetchedAt)}.`}
          </p>
        </div>
        <form action={replanFromInbox}>
          <button className="btn-secondary">↻ Re-plan now</button>
        </form>
      </div>

      {needsDate.length > 0 && (
        <div className="card border-l-8 border-blue-500 p-4">
          <h2 className="mb-2 font-bold">🆕 New jobs: enter the customer&apos;s requested date</h2>
          <ul className="divide-y divide-slate-100">
            {needsDate.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link href={`/projects/${p.id}`} className="font-semibold hover:underline">
                    {p.name} <span className="font-normal text-slate-500">— {p.city}</span>
                  </Link>
                  <div className="text-xs text-slate-500">
                    {p.estTotalHours} hrs · {p.estCrewSize} people{p.materials.length ? ` · ${p.materials.map((m) => m.name).join(", ")}` : ""}
                  </div>
                </div>
                <form action={setRequestedDate} className="flex items-center gap-2">
                  <input type="hidden" name="projectId" value={p.id} />
                  <input type="date" name="requestedDate" className="input w-auto" min={today()} required aria-label={`Requested date for ${p.name}`} />
                  <button className="btn-primary">Schedule it</button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4">
        <h2 className="mb-2 font-bold">Needs your attention</h2>
        {!problems.length && <p className="text-sm text-slate-500">Nothing right now. The schedule fits the people, equipment and weather. 👍</p>}
        <ul className="space-y-2">
          {problems.map((a) => (
            <li
              key={a.id}
              className={clsx(
                "flex flex-wrap items-start justify-between gap-2 rounded-lg border-l-4 p-3 text-sm",
                a.severity === "conflict" ? "border-red-600 bg-red-50" : a.severity === "warning" ? "border-amber-500 bg-amber-50" : "border-sky-500 bg-sky-50",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold">{a.title}</div>
                <div className="text-slate-700">{a.message}</div>
                <div className="mt-1 flex gap-3 text-xs font-semibold">
                  {a.dayText && (
                    <Link href={`/board?view=day&date=${a.dayText}`} className="text-blue-700 hover:underline">
                      Open that day →
                    </Link>
                  )}
                  {a.projectId && a.kind === "MISSING_INFO" && (
                    <Link href={`/projects/${a.projectId}/edit`} className="text-blue-700 hover:underline">
                      Fill it in →
                    </Link>
                  )}
                  {a.projectId && a.kind !== "MISSING_INFO" && (
                    <Link href={`/projects/${a.projectId}`} className="text-blue-700 hover:underline">
                      Open job →
                    </Link>
                  )}
                </div>
              </div>
              <form action={dismissAlert}>
                <input type="hidden" name="alertId" value={a.id} />
                <button className="text-xs text-slate-500 hover:text-slate-900" title="Hide this alert">
                  Dismiss
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>

      {runs.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 font-bold">🤖 What the app changed</h2>
          <ul className="space-y-3 text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {fmtTimestamp(r.at)} · after {r.trigger}
                </div>
                <ul className="mt-1 space-y-1">
                  {(r.changes as unknown as PlanChange[]).map((c) => (
                    <li key={c.projectId}>
                      <Link href={`/projects/${c.projectId}`} className="font-semibold hover:underline">
                        {c.label}
                      </Link>
                      :{" "}
                      {c.from.length && c.to.length && describeSlots(c.from) === describeSlots(c.to) ? (
                        <>
                          {describeSlots(c.to)}: <b>crew or equipment changed</b>
                        </>
                      ) : c.from.length && c.to.length ? (
                        <>
                          {describeSlots(c.from)} → <b>{describeSlots(c.to)}</b>
                        </>
                      ) : c.to.length ? (
                        <>
                          scheduled <b>{describeSlots(c.to)}</b>
                        </>
                      ) : (
                        <>taken off {describeSlots(c.from)}</>
                      )}
                      {c.why.length > 0 && <span className="text-slate-500"> ({c.why.join("; ")})</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

