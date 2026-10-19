// Weather limits and the check against an hourly forecast. Pure code, shared by the
// conflict engine, the auto-scheduler and the alerts.

import { addDays, fmtDay, fmtMin, type Day } from "../time";

export interface WeatherRule {
  /** Coldest temperature allowed while working. */
  minTempF: number;
  /** Highest chance of rain allowed during the work and the dry period after it. */
  maxRainChance: number;
  /** Hours after the work that must stay dry (cure time). */
  dryHoursAfter: number;
  maxWindMph: number;
}

export const DEFAULT_WEATHER_RULE: WeatherRule = { minTempF: 50, maxRainChance: 40, dryHoursAfter: 4, maxWindMph: 25 };

export interface WeatherRules {
  default: WeatherRule;
  byJobType: Record<string, Partial<WeatherRule>>;
}

export function ruleFor(rules: WeatherRules, jobTypeId: string | null | undefined): WeatherRule {
  const own = jobTypeId ? rules.byJobType[jobTypeId] : undefined;
  return { ...rules.default, ...Object.fromEntries(Object.entries(own ?? {}).filter(([, v]) => v !== null && v !== undefined)) };
}

export interface WeatherHourData {
  day: Day;
  hour: number; // 0–23 local time
  tempF: number;
  precipChance: number;
  windMph: number;
  summary?: string | null;
}

export type WeatherProblemKind = "RAIN" | "COLD" | "WIND";

export interface WeatherProblem {
  kind: WeatherProblemKind;
  day: Day;
  hour: number;
  value: number;
  limit: number;
  message: string;
}

export interface WeatherCheck {
  /** False when the forecast doesn't reach this far out yet. */
  known: boolean;
  problems: WeatherProblem[];
}

const key = (day: Day, hour: number) => `${day}#${hour}`;

export function indexHours(hours: WeatherHourData[]) {
  return new Map(hours.map((h) => [key(h.day, h.hour), h]));
}

/**
 * Check a work window (day + minutes) against hourly weather:
 * cold or windy while working, or rain while working or during the dry period afterwards.
 */
export function checkWindow(index: Map<string, WeatherHourData>, day: Day, startMin: number, endMin: number, rule: WeatherRule): WeatherCheck {
  const work: WeatherHourData[] = [];
  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.max(firstHour, Math.ceil(endMin / 60) - 1);
  for (let h = firstHour; h <= lastHour; h++) {
    const d = h >= 24 ? addDays(day, 1) : day;
    const w = index.get(key(d, h % 24));
    if (w) work.push(w);
  }
  const expected = lastHour - firstHour + 1;
  if (work.length < Math.ceil(expected / 2)) return { known: false, problems: [] };

  const after: WeatherHourData[] = [];
  for (let i = 0; i < rule.dryHoursAfter; i++) {
    const h = lastHour + 1 + i;
    const w = index.get(key(addDays(day, Math.floor(h / 24)), h % 24));
    if (w) after.push(w);
  }

  const problems: WeatherProblem[] = [];
  const at = (w: WeatherHourData) => `${w.day === day ? "" : `${fmtDay(w.day)} `}${fmtMin(w.hour * 60)}`;

  const coldest = work.reduce((a, b) => (b.tempF < a.tempF ? b : a));
  if (coldest.tempF < rule.minTempF) {
    problems.push({
      kind: "COLD",
      day: coldest.day,
      hour: coldest.hour,
      value: coldest.tempF,
      limit: rule.minTempF,
      message: `${coldest.tempF}°F at ${at(coldest)} (limit ${rule.minTempF}°F)`,
    });
  }

  const wettest = [...work, ...after].reduce((a, b) => (b.precipChance > a.precipChance ? b : a));
  if (wettest.precipChance >= rule.maxRainChance) {
    const during = work.includes(wettest);
    problems.push({
      kind: "RAIN",
      day: wettest.day,
      hour: wettest.hour,
      value: wettest.precipChance,
      limit: rule.maxRainChance,
      message: `${wettest.precipChance}% rain at ${at(wettest)}${during ? "" : `, within ${rule.dryHoursAfter} hrs after the work`} (limit ${rule.maxRainChance}%)`,
    });
  }

  const windiest = work.reduce((a, b) => (b.windMph > a.windMph ? b : a));
  if (windiest.windMph > rule.maxWindMph) {
    problems.push({
      kind: "WIND",
      day: windiest.day,
      hour: windiest.hour,
      value: windiest.windMph,
      limit: rule.maxWindMph,
      message: `wind ${windiest.windMph} mph at ${at(windiest)} (limit ${rule.maxWindMph} mph)`,
    });
  }

  return { known: true, problems };
}
