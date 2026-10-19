"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, OFFICE } from "@/lib/auth";
import { db } from "@/lib/db";
import { replan } from "@/lib/planner/run";
import { DEFAULT_SCHEDULING, writeJson, type SchedulingSettings } from "@/lib/settings";
import { parseHHMM } from "@/lib/time";
import type { WeatherRule } from "@/lib/weather/rules";

const int = (f: FormData, k: string, min: number, max: number): number | null => {
  const v = f.get(k);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
};

/** Weather limits: the default row plus optional overrides per type of work (blank = use default). */
export async function saveWeatherLimits(form: FormData) {
  const user = await authorize(OFFICE);
  const def: WeatherRule = {
    minTempF: int(form, "default_minTempF", -20, 120) ?? 50,
    maxRainChance: int(form, "default_maxRainChance", 0, 100) ?? 40,
    dryHoursAfter: int(form, "default_dryHoursAfter", 0, 72) ?? 4,
    maxWindMph: int(form, "default_maxWindMph", 0, 100) ?? 25,
  };
  await writeJson("weather.default", def);
  for (const t of await db.jobType.findMany()) {
    await db.jobType.update({
      where: { id: t.id },
      data: {
        minTempF: int(form, `${t.id}_minTempF`, -20, 120),
        maxRainChance: int(form, `${t.id}_maxRainChance`, 0, 100),
        dryHoursAfter: int(form, `${t.id}_dryHoursAfter`, 0, 72),
        maxWindMph: int(form, `${t.id}_maxWindMph`, 0, 100),
      },
    });
  }
  await db.auditLog.create({ data: { actorId: user.id, entityType: "Settings", entityId: "weather", action: "UPDATE", summary: `Weather limits changed (default: ${def.minTempF}°F, ${def.maxRainChance}% rain, ${def.dryHoursAfter} dry hrs, ${def.maxWindMph} mph)` } });
  await replan("weather limits changed", user.id);
  revalidatePath("/", "layout");
  redirect("/settings?saved=weather");
}

export async function saveSchedulingSettings(form: FormData) {
  const user = await authorize(OFFICE);
  const start = parseHHMM(String(form.get("workdayStart") ?? "")) ?? DEFAULT_SCHEDULING.workdayStartMin;
  const end = parseHHMM(String(form.get("workdayEnd") ?? "")) ?? DEFAULT_SCHEDULING.workdayEndMin;
  const settings: SchedulingSettings = {
    workdayStartMin: Math.min(start, end - 60),
    workdayEndMin: Math.max(end, start + 60),
    lockDays: int(form, "lockDays", 0, 10) ?? DEFAULT_SCHEDULING.lockDays,
    horizonDays: (int(form, "horizonWeeks", 1, 12) ?? 5) * 7,
    workSaturdays: form.get("workSaturdays") === "on",
  };
  await writeJson("scheduling", settings);
  await db.auditLog.create({ data: { actorId: user.id, entityType: "Settings", entityId: "scheduling", action: "UPDATE", summary: "Scheduling settings changed" } });
  await replan("scheduling settings changed", user.id);
  revalidatePath("/", "layout");
  redirect("/settings?saved=scheduling");
}
