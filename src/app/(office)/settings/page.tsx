import { saveSchedulingSettings, saveWeatherLimits } from "@/app/actions/settings";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDefaultWeatherRule, getSchedulingSettings } from "@/lib/settings";
import { toHHMM } from "@/lib/time";

export const metadata = { title: "Settings · BAM Scheduling" };

const COLUMNS = [
  { key: "minTempF", label: "Coldest °F", hint: "No work below this temperature" },
  { key: "maxRainChance", label: "Max rain %", hint: "Rain chance that counts as rain" },
  { key: "dryHoursAfter", label: "Dry hours after", hint: "Must stay dry this long after the work (cure time)" },
  { key: "maxWindMph", label: "Max wind mph", hint: "Too windy to spray above this" },
] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await requireUser(OFFICE);
  const saved = (await searchParams).saved;
  const [def, types, sched] = await Promise.all([getDefaultWeatherRule(), db.jobType.findMany({ orderBy: { name: "asc" } }), getSchedulingSettings()]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-3 sm:p-6">
      <h1 className="text-2xl font-bold">⚙️ Settings</h1>
      {saved && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">
          ✅ Saved. The app re-planned the schedule with the new {saved === "weather" ? "weather limits" : "settings"}.
        </div>
      )}

      <form action={saveWeatherLimits} className="card space-y-3 p-4">
        <div>
          <h2 className="text-lg font-bold">🌦️ Weather limits</h2>
          <p className="text-sm text-slate-500">
            The app won&apos;t schedule weather-sensitive work outside these limits, and alerts you when the forecast turns bad for a job that&apos;s locked in.
            Leave a box blank on a type of work to use the default.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1 pr-2">Type of work</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-1 py-1" title={c.hint}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="py-2 pr-2">Default (all work)</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-1">
                    <input name={`default_${c.key}`} type="number" className="input w-24" defaultValue={def[c.key]} required aria-label={`Default ${c.label}`} />
                  </td>
                ))}
              </tr>
              {types.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="py-2 pr-2">{t.name}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-1">
                      <input name={`${t.id}_${c.key}`} type="number" className="input w-24" defaultValue={t[c.key] ?? ""} placeholder={String(def[c.key])} aria-label={`${t.name} ${c.label}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="text-xs text-slate-500">
          {COLUMNS.map((c) => (
            <li key={c.key}>
              <b>{c.label}:</b> {c.hint}
            </li>
          ))}
        </ul>
        <button className="btn-primary">Save weather limits</button>
      </form>

      <form action={saveSchedulingSettings} className="card space-y-3 p-4">
        <div>
          <h2 className="text-lg font-bold">🤖 Auto-scheduling</h2>
          <p className="text-sm text-slate-500">
            The app places every accepted job with a requested date, and re-plans after every change. It never moves work that someone placed by hand, locked or confirmed.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <label>
            <span className="label">Workday starts</span>
            <input type="time" name="workdayStart" className="input" defaultValue={toHHMM(sched.workdayStartMin)} />
          </label>
          <label>
            <span className="label">Workday ends</span>
            <input type="time" name="workdayEnd" className="input" defaultValue={toHHMM(sched.workdayEndMin)} />
          </label>
          <label>
            <span className="label">Days frozen ahead</span>
            <input type="number" name="lockDays" min={0} max={10} className="input" defaultValue={sched.lockDays} />
            <span className="text-xs text-slate-500">Today plus this many work days won&apos;t be moved by the app.</span>
          </label>
          <label>
            <span className="label">Plan ahead (weeks)</span>
            <input type="number" name="horizonWeeks" min={1} max={12} className="input" defaultValue={Math.round(sched.horizonDays / 7)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="workSaturdays" defaultChecked={sched.workSaturdays} /> Schedule work on Saturdays
        </label>
        <button className="btn-primary">Save scheduling settings</button>
      </form>
    </main>
  );
}
