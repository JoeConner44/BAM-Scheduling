import "server-only";
import { db } from "./db";
import { DEFAULT_WEATHER_RULE, type WeatherRule, type WeatherRules } from "./weather/rules";

/** True once the owner has switched from sample data to real data. */
export async function isLiveMode() {
  const row = await db.appSetting.findUnique({ where: { key: "mode" } });
  return row?.value === "live";
}

export interface SchedulingSettings {
  /** Earliest start / latest finish the auto-scheduler uses (minutes after midnight). */
  workdayStartMin: number;
  workdayEndMin: number;
  /** Today plus this many work days are frozen: the auto-scheduler won't move jobs there (it alerts instead). */
  lockDays: number;
  /** How far ahead the auto-scheduler plans, in calendar days. */
  horizonDays: number;
  workSaturdays: boolean;
  /** How many work days before or after the requested date the app may move a job to even out the workload. */
  spreadDays: number;
}

export const DEFAULT_SCHEDULING: SchedulingSettings = {
  workdayStartMin: 7 * 60,
  workdayEndMin: 17 * 60 + 30,
  lockDays: 1,
  horizonDays: 35,
  workSaturdays: false,
  spreadDays: 10,
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const row = await db.appSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return { ...fallback, ...JSON.parse(row.value) };
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown) {
  const text = JSON.stringify(value);
  await db.appSetting.upsert({ where: { key }, update: { value: text }, create: { key, value: text } });
}

export const getSchedulingSettings = () => readJson<SchedulingSettings>("scheduling", DEFAULT_SCHEDULING);
export const getDefaultWeatherRule = () => readJson<WeatherRule>("weather.default", DEFAULT_WEATHER_RULE);

export async function getWeatherRules(): Promise<WeatherRules> {
  const [def, types] = await Promise.all([getDefaultWeatherRule(), db.jobType.findMany()]);
  return {
    default: def,
    byJobType: Object.fromEntries(
      types.map((t) => [
        t.id,
        Object.fromEntries(
          Object.entries({ minTempF: t.minTempF, maxRainChance: t.maxRainChance, dryHoursAfter: t.dryHoursAfter, maxWindMph: t.maxWindMph }).filter(([, v]) => v !== null),
        ),
      ]),
    ),
  };
}
