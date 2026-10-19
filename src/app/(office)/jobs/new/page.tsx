import Link from "next/link";
import { AcceptJobForm } from "@/components/AcceptJobForm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayToDate, fmtDay, fmtTimestamp, maybeDay, today } from "@/lib/time";
import { workOrderReadingEnabled } from "@/lib/workorder";

export const metadata = { title: "Accept a job · BAM Scheduling" };

export default async function AcceptJobPage({ searchParams }: PageProps<"/jobs/new">) {
  await requireUser(["OWNER", "DISPATCHER", "ESTIMATOR"]);
  const sp = await searchParams;
  const [jobTypes, locations, customers, recent, accepted] = await Promise.all([
    db.jobType.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: { city: "asc" } }),
    db.customer.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.project.findMany({ where: { acceptedAt: { not: null } }, orderBy: { acceptedAt: "desc" }, take: 8, include: { blocks: { where: { progress: { in: ["PLANNED", "ACTIVE", "PAUSED"] }, day: { gte: dayToDate(today()) } }, orderBy: { day: "asc" }, take: 1 } } }),
    typeof sp.accepted === "string" ? db.project.findUnique({ where: { id: sp.accepted } }) : null,
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">✅ Accept a job</h1>
        <p className="text-sm text-slate-500">When a customer accepts a quote, upload the work order here. The scheduler and the app take it from there.</p>
      </div>

      {accepted && (
        <div className="card border-l-8 border-emerald-500 p-4">
          <div className="font-bold">
            {accepted.name} — {accepted.city} is accepted.
          </div>
          <div className="text-sm text-slate-600">
            {accepted.requestedDate
              ? `The app is scheduling it around ${fmtDay(maybeDay(accepted.requestedDate)!)}.`
              : "The scheduler will enter the customer's requested date, then the app schedules it."}
          </div>
        </div>
      )}

      <AcceptJobForm
        jobTypes={jobTypes.map((j) => j.name)}
        cities={locations.map((l) => l.city)}
        customers={customers.map((c) => c.name)}
        readingEnabled={workOrderReadingEnabled()}
      />

      <section className="card p-4">
        <h2 className="mb-2 font-bold">Recently accepted</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {recent.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <Link href={`/projects/${p.id}`} className="font-semibold hover:underline">
                {p.name} <span className="font-normal text-slate-500">— {p.city}</span>
              </Link>
              <span className="text-slate-500">
                {p.status === "COMPLETE"
                  ? "Done"
                  : p.status.startsWith("WAITING")
                    ? "On hold"
                    : p.blocks[0]
                      ? `Scheduled ${fmtDay(maybeDay(p.blocks[0].day)!)}`
                      : p.requestedDate
                        ? "Being scheduled"
                        : "Waiting for requested date"} · accepted {fmtTimestamp(p.acceptedAt!)}
              </span>
            </li>
          ))}
          {!recent.length && <li className="text-slate-500">Nothing yet.</li>}
        </ul>
      </section>
    </main>
  );
}
