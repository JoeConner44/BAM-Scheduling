import "server-only";
import type { AlertKind } from "@prisma/client";
import { loadSnapshot } from "./data";
import { db } from "./db";
import { checkAll, isLive } from "./engine/conflicts";
import { checkWindow, indexHours, ruleFor } from "./weather/rules";
import type { PlannedBlock, Unplaced } from "./planner/plan";
import { dateToDay, dayToDate, fmtDay, fmtRange, type Day } from "./time";

export interface PlanChange {
  projectId: string;
  label: string;
  from: { day: Day; startMin: number; endMin: number }[];
  to: { day: Day; startMin: number; endMin: number }[];
  why: string[];
}

interface Draft {
  key: string;
  kind: AlertKind;
  severity: "conflict" | "warning" | "info";
  title: string;
  message: string;
  projectId?: string;
  blockId?: string;
  day?: Day;
}

const WEATHER_KIND: Record<string, AlertKind> = { WEATHER: "WEATHER_RAIN", WEATHER_COLD: "WEATHER_COLD", WEATHER_WIND: "WEATHER_WIND" };
const WEATHER_ICON: Record<string, string> = { WEATHER: "🌧️", WEATHER_COLD: "🥶", WEATHER_WIND: "💨" };

/**
 * Recompute what the scheduler needs to look at. Problems that went away close themselves;
 * "moved because of weather" notices stay until dismissed.
 */
export async function refreshAlerts(ctx: {
  unplaced: Unplaced[];
  late: PlannedBlock[];
  changes: PlanChange[];
  planRunId: string | null;
  window: { today: Day; firstDay: Day; lastDay: Day };
}) {
  const { today, firstDay, lastDay } = ctx.window;
  const snap = await loadSnapshot(today, lastDay);
  const findings = checkAll(snap);
  const meta = new Map(
    (await db.scheduleBlock.findMany({ where: { day: { gte: dayToDate(today), lte: dayToDate(lastDay) } }, select: { id: true, auto: true, pinned: true, state: true } })).map((b) => [b.id, b]),
  );
  const drafts: Draft[] = [];

  for (const b of snap.blocks) {
    if (b.day < today || b.day > lastDay || !isLive(b)) continue;
    const label = snap.projects[b.projectId]?.label ?? "Job";
    const when = `${fmtDay(b.day)} ${fmtRange(b.startMin, b.endMin)}`;
    const m = meta.get(b.id);
    const locked = !m?.auto || m.pinned || m.state === "COMMITTED" || b.day < firstDay || b.progress !== "PLANNED";
    for (const f of findings[b.id] ?? []) {
      if (f.code in WEATHER_KIND) {
        drafts.push({
          key: `weather:${b.id}:${f.code}`,
          kind: WEATHER_KIND[f.code],
          severity: "warning",
          title: `${WEATHER_ICON[f.code]} ${f.title}: ${label}`,
          message: `${when}. ${f.message} ${
            locked
              ? "This job is locked in (placed by hand, confirmed, or too soon to move), so the app didn't move it. Move it or unlock it to let the app re-plan."
              : "No better day was available."
          }`,
          projectId: b.projectId,
          blockId: b.id,
          day: b.day,
        });
      } else if (f.severity === "conflict") {
        drafts.push({
          key: `conflict:${f.dedupeKey}`,
          kind: "CONFLICT",
          severity: "conflict",
          title: `⚠️ ${f.title}: ${label}`,
          message: `${when}. ${f.message}`,
          projectId: b.projectId,
          blockId: b.id,
          day: b.day,
        });
      }
    }
  }

  for (const u of ctx.unplaced) {
    drafts.push({
      key: `unplaced:${u.projectId}`,
      kind: "UNPLACED",
      severity: "conflict",
      title: `📅 Can't fit: ${u.label}`,
      message: `${u.hoursLeft.toFixed(1).replace(/\.0$/, "")} hrs couldn't be scheduled. ${u.reason}`,
      projectId: u.projectId,
    });
  }
  for (const b of ctx.late) {
    drafts.push({
      key: `late:${b.projectId}`,
      kind: "UNPLACED",
      severity: "conflict",
      title: `⏰ Past due: ${snap.projects[b.projectId]?.label ?? "Job"}`,
      message: `The best workable day is ${fmtDay(b.day)}, which is ${b.why.find((w) => w.startsWith("after the due date")) ?? "after the due date"}.`,
      projectId: b.projectId,
      day: b.day,
    });
  }

  // Newly accepted jobs waiting for the customer's requested date.
  const waiting = await db.project.findMany({
    where: { acceptedAt: { not: null }, requestedDate: null, status: { notIn: ["COMPLETE", "CANCELLED"] } },
    select: { id: true, name: true, city: true },
  });
  for (const p of waiting) {
    drafts.push({
      key: `newjob:${p.id}`,
      kind: "NEW_JOB",
      severity: "info",
      title: `🆕 New job: ${p.name} — ${p.city}`,
      message: "Accepted. Enter the customer's requested date and the app will schedule it.",
      projectId: p.id,
    });
  }

  // Moves the app made because the weather turned against the old day.
  if (ctx.planRunId) {
    const index = Object.fromEntries(Object.entries(snap.weatherHours ?? {}).map(([k, v]) => [k, indexHours(v)]));
    for (const c of ctx.changes) {
      if (!c.from.length || !c.to.length) continue;
      const p = snap.projects[c.projectId];
      const loc = p?.locationId ? index[p.locationId] : undefined;
      if (!p || !loc || !snap.weatherRules) continue;
      const rule = ruleFor(snap.weatherRules, p.jobTypeId);
      const problem = c.from.map((s) => checkWindow(loc, s.day, s.startMin, s.endMin, rule).problems[0]).find(Boolean);
      if (!problem) continue;
      drafts.push({
        key: `moved:${c.projectId}:${ctx.planRunId}`,
        kind: "MOVED",
        severity: "info",
        title: `↪️ Moved for weather: ${c.label}`,
        message: `${fmtDay(c.from[0].day)} → ${fmtDay(c.to[0].day)}. Old day: ${problem.message}.`,
        projectId: c.projectId,
        day: c.to[0].day,
      });
    }
  }

  const now = new Date();
  for (const d of drafts) {
    const data = {
      kind: d.kind,
      severity: d.severity,
      title: d.title,
      message: d.message,
      projectId: d.projectId ?? null,
      blockId: d.blockId ?? null,
      day: d.day ? dayToDate(d.day) : null,
    };
    await db.alert.upsert({ where: { key: d.key }, update: { ...data, resolvedAt: null }, create: { key: d.key, ...data } });
  }
  await db.alert.updateMany({
    where: { resolvedAt: null, key: { notIn: drafts.map((d) => d.key) }, NOT: { key: { startsWith: "moved:" } } },
    data: { resolvedAt: now },
  });
}

export async function openAlerts() {
  const rows = await db.alert.findMany({
    where: { resolvedAt: null, dismissedAt: null },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
  const rank = { conflict: 0, warning: 1, info: 2 } as Record<string, number>;
  return rows
    .map((a) => ({ ...a, dayText: a.day ? dateToDay(a.day) : null }))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || (a.dayText ?? "9999").localeCompare(b.dayText ?? "9999"));
}
