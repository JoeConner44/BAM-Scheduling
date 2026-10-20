import Link from "next/link";
import { CalendarImport } from "@/components/CalendarImport";
import { OFFICE, requireUser } from "@/lib/auth";

export const metadata = { title: "Import from Google Calendar · BAM Scheduling" };

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  await requireUser(OFFICE);
  const sp = await searchParams;
  const n = (k: string) => (typeof sp[k] === "string" ? Number(sp[k]) || 0 : null);
  const created = n("created");
  const updated = n("updated") ?? 0;
  const blocks = n("blocks") ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">📆 Import from Google Calendar</h1>
        <p className="text-sm text-slate-500">Bring the jobs you already have on Google Calendar into the app. Nothing changes in Google Calendar.</p>
      </div>

      {created !== null && (
        <div className="card border-l-8 border-emerald-500 p-4" role="status">
          {blocks ? (
            <>
              <div className="font-bold">
                ✅ Imported {created} new job{created === 1 ? "" : "s"}
                {updated ? `, added days to ${updated} existing job${updated === 1 ? "" : "s"}` : ""} — {blocks} day{blocks === 1 ? "" : "s"} on the schedule.
              </div>
              <div className="text-sm text-slate-600">
                They&apos;re locked in where they were on the calendar. The app will warn you about weather or double-booking. See them on the{" "}
                <Link href="/board" className="font-semibold underline">
                  Schedule
                </Link>
                .
              </div>
            </>
          ) : (
            <div className="font-bold">Nothing new to import. Those calendar events are already in the app.</div>
          )}
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
          Only events from today on are imported. Events with the same title become one job with several days. If a calendar or event mentions a person by the name
          they have on the People page, they&apos;re put on that day&apos;s crew. Importing the same file again won&apos;t create duplicates. If an event is just a job name, that&apos;s fine: the Inbox will remind you to add the address, type of work and crew.
        </p>
      </section>

      <CalendarImport />
    </main>
  );
}
