import "server-only";
import { db } from "../db";
import { dayToDate, today } from "../time";
import { fetchHourlyForecast } from "./nws";
import type { WeatherHourData } from "./rules";

/** Forecasts older than this are refreshed. */
export const WEATHER_MAX_AGE_MINUTES = 180;

/**
 * Pull hourly forecasts from the National Weather Service for every location that has open
 * work. Stale-only unless `force`. Returns true when anything changed.
 */
export async function refreshWeather(opts: { force?: boolean } = {}) {
  const cutoff = new Date(Date.now() - WEATHER_MAX_AGE_MINUTES * 60_000);
  const locations = await db.location.findMany({
    where: {
      projects: { some: { status: { notIn: ["COMPLETE", "CANCELLED"] } } },
      ...(opts.force ? {} : { OR: [{ weatherFetchedAt: null }, { weatherFetchedAt: { lt: cutoff } }] }),
    },
    include: { projects: { where: { lat: { not: null } }, take: 1, select: { lat: true, lng: true } } },
  });

  const errors: string[] = [];
  let updated = 0;
  for (const loc of locations) {
    const lat = loc.lat ?? loc.projects[0]?.lat;
    const lng = loc.lng ?? loc.projects[0]?.lng;
    if (lat == null || lng == null) continue;
    try {
      const hours = await fetchHourlyForecast(lat, lng);
      await saveHours(loc.id, hours);
      await db.location.update({ where: { id: loc.id }, data: { weatherFetchedAt: new Date(), lat, lng } });
      updated++;
    } catch (e) {
      errors.push(`${loc.city}: ${(e as Error).message}`);
    }
  }
  return { updated, errors };
}

/** Store hourly data and keep the daily summary table (used by the board and dashboard) in step. */
export async function saveHours(locationId: string, hours: WeatherHourData[]) {
  const t = today();
  const future = hours.filter((h) => h.day >= t);
  const days = [...new Set(future.map((h) => h.day))];
  await db.$transaction([
    db.weatherHour.deleteMany({ where: { locationId, day: { gte: dayToDate(t) } } }),
    db.weatherHour.createMany({
      data: future.map((h) => ({ locationId, day: dayToDate(h.day), hour: h.hour, tempF: h.tempF, precipChance: h.precipChance, windMph: h.windMph, summary: h.summary ?? null })),
    }),
    ...days.map((day) => {
      const list = future.filter((h) => h.day === day);
      // Daytime (6 AM–8 PM) is what matters for most work.
      const daytime = list.filter((h) => h.hour >= 6 && h.hour <= 20);
      const pool = daytime.length ? daytime : list;
      const wettest = pool.reduce((a, b) => (b.precipChance > a.precipChance ? b : a));
      const data = {
        precipChance: wettest.precipChance,
        tempHighF: Math.max(...pool.map((h) => h.tempF)),
        tempLowF: Math.min(...pool.map((h) => h.tempF)),
        windMph: Math.max(...pool.map((h) => h.windMph)),
        summary: wettest.summary ?? null,
        source: "nws",
        fetchedAt: new Date(),
      };
      return db.weatherForecast.upsert({
        where: { locationId_day: { locationId, day: dayToDate(day) } },
        update: data,
        create: { locationId, day: dayToDate(day), ...data },
      });
    }),
  ]);
}

/** Refresh stale forecasts; if anything changed, re-plan so the schedule reacts to the new weather. */
export async function refreshWeatherAndReplan(opts: { force?: boolean } = {}) {
  const result = await refreshWeather(opts);
  if (result.updated > 0) {
    const { replan } = await import("../planner/run");
    await replan("new weather forecast");
  }
  return result;
}
