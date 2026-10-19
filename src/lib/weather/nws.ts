// National Weather Service (api.weather.gov): free hourly forecasts for any US point, ~7 days out.
// No API key; NWS asks for a User-Agent that identifies the app.

import { COMPANY_TIME_ZONE, type Day } from "../time";
import type { WeatherHourData } from "./rules";

const USER_AGENT = process.env.WEATHER_USER_AGENT || "BAM-Scheduling (pavement striping scheduler)";

interface NwsPeriod {
  startTime: string;
  temperature: number;
  temperatureUnit: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
  windSpeed?: string | null;
  shortForecast?: string | null;
}

const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMPANY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Turn an ISO timestamp into the company's local day and hour. */
export function toLocalDayHour(iso: string): { day: Day; hour: number } {
  const parts = Object.fromEntries(localParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** "10 mph" → 10, "5 to 15 mph" → 15 */
export function parseWindMph(text: string | null | undefined): number {
  const nums = (text ?? "").match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : 0;
}

export function parseHourlyPeriods(periods: NwsPeriod[]): WeatherHourData[] {
  return periods.map((p) => {
    const { day, hour } = toLocalDayHour(p.startTime);
    const tempF = p.temperatureUnit === "C" ? Math.round((p.temperature * 9) / 5 + 32) : Math.round(p.temperature);
    return {
      day,
      hour,
      tempF,
      precipChance: Math.round(p.probabilityOfPrecipitation?.value ?? 0),
      windMph: parseWindMph(p.windSpeed),
      summary: p.shortForecast ?? null,
    };
  });
}

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Weather service returned ${res.status} for ${url}`);
  return res.json();
}

export async function fetchHourlyForecast(lat: number, lng: number): Promise<WeatherHourData[]> {
  const point = await getJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`);
  const url: string | undefined = point?.properties?.forecastHourly;
  if (!url) throw new Error("Weather service has no hourly forecast for this location.");
  const data = await getJson(url);
  return parseHourlyPeriods(data?.properties?.periods ?? []);
}
