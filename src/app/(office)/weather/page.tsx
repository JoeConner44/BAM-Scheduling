import clsx from "clsx";
import { setForecast } from "@/app/actions/weather";
import { weatherIcon } from "@/components/board/WeatherBadge";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, dateToDay, dayRange, dayToDate, fmtDay, today } from "@/lib/time";

export const metadata = { title: "Weather · BAM Scheduling" };

export default async function WeatherPage() {
  await requireUser(OFFICE);
  const t = today();
  const days = dayRange(t, 10);
  const [locations, forecasts] = await Promise.all([
    db.location.findMany({ orderBy: { city: "asc" } }),
    db.weatherForecast.findMany({ where: { day: { gte: dayToDate(t), lte: dayToDate(addDays(t, 9)) } } }),
  ]);
  const get = (locationId: string, day: string) => forecasts.find((f) => f.locationId === locationId && dateToDay(f.day) === day);

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">🌦️ Weather by location</h1>
        <p className="text-sm text-slate-500">
          Chance of rain for each city where you have work. Weather-sensitive jobs on rainy days get a 🌧️ warning on the board. Nothing is moved automatically.
          For now forecasts are typed in here; the National Weather Service feed plugs in during a later phase.
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <th className="p-2">Location</th>
              {days.map((d) => (
                <th key={d} className={clsx("p-2 text-center", d === t && "bg-yellow-50")}>
                  {fmtDay(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 align-top">
                <td className="p-2 font-semibold">
                  {l.city}, {l.state}
                </td>
                {days.map((d) => {
                  const f = get(l.id, d);
                  const chance = f?.precipChance ?? 0;
                  return (
                    <td key={d} className={clsx("p-1", chance >= 50 && "bg-cyan-50")}>
                      <form action={setForecast} className="flex flex-col items-center gap-1">
                        <input type="hidden" name="locationId" value={l.id} />
                        <input type="hidden" name="day" value={d} />
                        <span className="text-xl" title={f?.summary ?? ""}>
                          {weatherIcon(chance)}
                        </span>
                        <input name="precipChance" type="number" min={0} max={100} step={5} defaultValue={chance} className="w-16 rounded border border-slate-300 px-1 text-center" aria-label={`Rain chance ${l.city} ${fmtDay(d)}`} />
                        <input name="summary" defaultValue={f?.summary ?? ""} className="w-20 rounded border border-slate-200 px-1 text-[11px]" placeholder="summary" />
                        <button className="text-[11px] font-semibold text-blue-700">Save</button>
                      </form>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
