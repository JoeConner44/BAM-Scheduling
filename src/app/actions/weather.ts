"use server";

import { revalidatePath } from "next/cache";
import { authorize, OFFICE } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayToDate, fmtDay, isDay } from "@/lib/time";

/** Manual forecast entry (until the National Weather Service feed is connected). */
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
  await db.auditLog.create({
    data: { actorId: user.id, entityType: "Weather", entityId: locationId, action: "FORECAST", summary: `Forecast for ${location.city} ${fmtDay(day)}: ${chance}% rain${summary ? ` (${summary})` : ""}` },
  });
  revalidatePath("/", "layout");
}
