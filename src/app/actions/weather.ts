"use server";

import { revalidatePath } from "next/cache";
import { authorize, OFFICE } from "@/lib/auth";
import { db } from "@/lib/db";
import { replan } from "@/lib/planner/run";
import { dayToDate, fmtDay, isDay } from "@/lib/time";

/**
 * Hand override for one day's rain chance (e.g. the scheduler knows better than the forecast).
 * Applies to the daily summary and to that day's working hours (6 AM–8 PM), which is what the
 * app checks. The next automatic weather update replaces it.
 */
export async function setForecast(form: FormData) {
  const user = await authorize(OFFICE);
  const locationId = String(form.get("locationId"));
  const day = String(form.get("day"));
  const chance = Math.max(0, Math.min(100, Math.round(Number(form.get("precipChance")))));
  const summary = String(form.get("summary") ?? "").trim() || null;
  if (!isDay(day) || !Number.isFinite(chance)) return;
  const location = await db.location.findUniqueOrThrow({ where: { id: locationId } });
  await db.weatherForecast.upsert({
    where: { locationId_day: { locationId, day: dayToDate(day) } },
    update: { precipChance: chance, summary, source: "manual", fetchedAt: new Date() },
    create: { locationId, day: dayToDate(day), precipChance: chance, summary, source: "manual" },
  });
  await db.weatherHour.updateMany({ where: { locationId, day: dayToDate(day), hour: { gte: 6, lte: 20 } }, data: { precipChance: chance, ...(summary ? { summary } : {}) } });
  await db.auditLog.create({
    data: { actorId: user.id, entityType: "Weather", entityId: locationId, action: "FORECAST", summary: `Forecast for ${location.city} ${fmtDay(day)}: ${chance}% rain${summary ? ` (${summary})` : ""}` },
  });
  await replan("forecast edited", user.id);
  revalidatePath("/", "layout");
}
