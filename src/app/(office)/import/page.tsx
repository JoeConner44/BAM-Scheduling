import Link from "next/link";
import { removeImportedJobs } from "@/app/actions/import";
import { CalendarImport } from "@/components/CalendarImport";
import { ConfirmButton } from "@/components/ConfirmButton";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Import from Google Calendar · BAM Scheduling" };

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  await requireUser(OFFICE);
  const sp = await searchParams;
  const n = (k: string) => (typeof sp[k] === "string" ? Number(sp[k]) || 0 : null);
  const created = n("created");
  const booked = n("booked") ?? 0;
  const removed = n("removed");
  const kept = n("kept") ?? 0;
  const imported = await db.project.count({
    where: { OR: [{ externalRefs: { isEmpty: false } }, { blocks: { some: { externalRef: { not: null } } } }] },
  });

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">📆 Import from Google Calendar</h1>
        <p className="text-sm text-slate-500">Bring the jobs you already have on Google Calendar into the app. Nothing changes in Google Calendar.</p>
      </div>

      {created !== null && (
        <div className="card border-l-8 border-emerald-500 p-4" role="status">
          {created ? (
            <>
              <div className="font-bold">
                ✅ Imported {created} job{created === 1 ? "" : "s"}.
              </div>
              <div className="text-sm text-slate-600">
                The app put each one on the least busy day it could find in its window
                {booked ? ` (${booked} in the next few days were kept where the calendar had them, since crews already know)` : ""}. See them on the{" "}
                <Link href="/board" className="font-semibold underline">
                  Schedule
                </Link>
                . Anything it couldn&apos;t fit, or that&apos;s missing information, is in the{" "}
                <Link href="/" className="font-semibold underline">
                  Inbox
                </Link>
                .
              </div>
            </>
          ) : (
            <div className="font-bold">Nothing new to import. Those calendar events are already in the app.</div>
          )}
        </div>
      )}
      {removed !== null && (
        <div className="card border-l-8 border-sky-500 p-4" role="status">
          <div className="font-bold">
            Removed {removed} imported job{removed === 1 ? "" : "s"}.{kept ? ` Kept ${kept} that the crew has already started or reported on.` : ""}
          </div>
          <div className="text-sm text-slate-600">Upload the calendar again below to import it with the current rules.</div>
        </div>
      )}

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="font-bold">How to get the file from Google Calendar</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>
            On a computer, open{" "}
            <a href="https://calendar.google.com/calendar/r/settings/export" target="_blank" rel="noreferrer" className="font-semibold underline">
              Google Calendar → Settings → Import &amp; export
            </a>
            .
          </li>
          <li>
            Click <b>Export</b>. Google downloads a <b>.zip</b> file with all your calendars.
          </li>
          <li>Upload that .zip below (no need to unzip it). One calendar&apos;s .ics file works too.</li>
        </ol>
        <p className="text-slate-500">
          Every calendar entry is a one-day job unless its title or notes say otherwise (&ldquo;3 days&rdquo;). If an entry covers several days, the job can be done on
          any of them: the app picks the least busy one. Only entries from today on are imported, and importing the same file again won&apos;t create duplicates.
          If an entry mentions someone by the name they have on the People page, the job&apos;s crew size is set to match. If it&apos;s just a job name, that&apos;s
          fine: the Inbox will remind you to add the address and type of work.
        </p>
      </section>

      <CalendarImport />

      {imported > 0 && (
        <section className="card space-y-2 p-4 text-sm">
          <h2 className="font-bold">Start the import over</h2>
          <p className="text-slate-600">
            {imported} job{imported === 1 ? " is" : "s are"} in the app from an earlier import. Remove them to import the calendar again with the current rules. Jobs
            the crew has started or reported on are kept.
          </p>
          <form action={removeImportedJobs}>
            <ConfirmButton className="btn-secondary text-red-700" message={`Remove the ${imported} job(s) imported from Google Calendar? Jobs already started are kept.`}>
              Remove imported jobs
            </ConfirmButton>
          </form>
        </section>
      )}
    </main>
  );
}
