import clsx from "clsx";
import { demoResetAllowed, resetSampleData } from "@/app/actions/demo";
import { ConfirmButton } from "@/components/ConfirmButton";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/labels";
import { COMPANY_TIME_ZONE, fmtTimestamp } from "@/lib/time";
import type { Finding } from "@/lib/engine/types";

export const metadata = { title: "Activity · BAM Scheduling" };

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const user = await requireUser(OFFICE);
  const sp = await searchParams;
  const canReset = user.role === "OWNER" && (await demoResetAllowed());
  const onlyOverrides = sp.filter === "overrides";
  const [entries, overrides] = await Promise.all([
    db.auditLog.findMany({ include: { actor: true }, orderBy: { at: "desc" }, take: 200, where: onlyOverrides ? { summary: { contains: "(override)" } } : undefined }),
    db.schedulingOverride.findMany({ include: { actor: true }, orderBy: { at: "desc" }, take: 50 }),
  ]);
  const overrideByTime = new Map(overrides.map((o) => [`${o.actorId}:${Math.floor(o.at.getTime() / 2000)}`, o]));

  // Group by calendar day for readability.
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const day = e.at.toLocaleDateString("en-US", { timeZone: COMPANY_TIME_ZONE, weekday: "long", month: "long", day: "numeric" });
    groups.set(day, [...(groups.get(day) ?? []), e]);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">🕘 Activity log</h1>
          <p className="text-sm text-slate-500">Every schedule change, who made it, and why. Overrides are highlighted.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-200 p-0.5 text-sm font-semibold">
          <a href="/activity" className={clsx("rounded-md px-3 py-1.5", !onlyOverrides && "bg-white shadow")}>
            All
          </a>
          <a href="/activity?filter=overrides" className={clsx("rounded-md px-3 py-1.5", onlyOverrides && "bg-white shadow")}>
            Overrides only
          </a>
        </div>
      </div>
      {canReset && (
        <form action={resetSampleData} className="card flex flex-wrap items-center justify-between gap-2 border-dashed p-3 text-sm">
          <span className="text-slate-600">Demo site: reload the fictional sample data with dates starting today. This erases every change.</span>
          <ConfirmButton className="btn-secondary text-red-700" message="Erase everything and reload the sample data? Everyone will need to sign in again.">
            ↺ Reset sample data
          </ConfirmButton>
        </form>
      )}
      {[...groups.entries()].map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{day}</h2>
          <ul className="card divide-y divide-slate-100">
            {list.map((e) => {
              const isOverride = e.summary.includes("(override)");
              const ov = isOverride ? overrideByTime.get(`${e.actorId}:${Math.floor(e.at.getTime() / 2000)}`) : undefined;
              const findings = (ov?.findings ?? []) as unknown as Finding[];
              return (
                <li key={e.id} className={clsx("p-3", isOverride && "bg-amber-50")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold">
                      {isOverride && "⚠️ "}
                      {e.summary.replace(" (override)", "")}
                    </div>
                    <div className="text-xs text-slate-500">{fmtTimestamp(e.at)}</div>
                  </div>
                  <div className="text-sm text-slate-600">
                    {e.actor ? `${e.actor.name} (${ROLE_LABEL[e.actor.role]})` : "System"}
                    {e.reason && (
                      <>
                        {" "}
                        · Reason: <b>{e.reason}</b>
                      </>
                    )}
                  </div>
                  {isOverride && findings.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-amber-900">
                      {findings.map((f) => (
                        <li key={f.key}>
                          <b>{f.title}:</b> {f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!entries.length && <p className="card p-6 text-center text-slate-500">Nothing recorded yet.</p>}
    </main>
  );
}
