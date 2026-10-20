// The auto-scheduler. Pure code: given the people, equipment, weather, locked work and the
// jobs that need time, it builds the best schedule it can and explains each choice.
//
// How it decides, job by job (most urgent first):
//   • only work days inside the planning window, never before the job's earliest date;
//   • only time windows where the weather fits this type of work (when the forecast reaches);
//   • a full crew that is free, working, not off, has the required skills, and can drive there
//     from wherever they were before (and on to wherever they go next);
//   • the required equipment, free and not in the shop;
//   • then it scores each workable day: first the least busy day (fewest hours already
//     booked) within `spreadDays` work days of the customer's requested date, then the one
//     closest to that date; never after the deadline unless nothing else works, a bonus for
//     crews already working nearby, and a small preference for keeping the day it picked
//     last time (so the schedule doesn't churn).
// Big jobs are split across several days, keeping the same crew when it can.

import { estimateTravelMinutes } from "../geo";
import { addDays, dayOfWeek, daysBetween, fmtDay, type Day } from "../time";
import type { ETimeOff } from "../engine/types";
import { checkWindow, indexHours, ruleFor, type WeatherHourData, type WeatherRules } from "../weather/rules";

export interface PlanEmployee {
  id: string;
  name: string;
  active: boolean;
  skillIds: string[];
  workDays: number[];
  normalStartMin: number;
  normalEndMin: number;
  timeOff: ETimeOff[];
}

export interface PlanEquipment {
  id: string;
  name: string;
  type: string;
  active: boolean;
  status: string;
  downtime: { startDay: Day; endDay: Day }[];
}

export interface PlanJob {
  id: string;
  label: string;
  city: string;
  locationId: string | null;
  jobTypeId: string | null;
  lat: number | null;
  lng: number | null;
  /** Hours still to place (remaining work minus work already locked on the schedule). */
  hoursNeeded: number;
  crewSize: number;
  requiredSkills: { skillId: string; skillName: string; minCount: number }[];
  requiredEquipment: { type: string; typeLabel: string; quantity: number }[];
  requestedDate: Day;
  earliestDate: Day | null;
  /** Earlier of deadline and inspection date. */
  dueDate: Day | null;
  priorityRank: number; // 0 = critical
  weatherSensitive: boolean;
  /** Days the previous plan used for this job (stability). */
  previousDays: Day[];
}

export interface PlanBusyBlock {
  projectId: string;
  day: Day;
  startMin: number;
  endMin: number;
  employeeIds: string[];
  equipmentIds: string[];
  city: string;
  lat: number | null;
  lng: number | null;
}

export interface PlanInput {
  /** First and last day the planner may place work on. */
  firstDay: Day;
  lastDay: Day;
  workdayStartMin: number;
  workdayEndMin: number;
  workSaturdays: boolean;
  /** How many work days either side of the requested date a job may move to even out the workload. */
  spreadDays?: number;
  travel?: { averageMph: number; roadFactor: number; minimumMinutes: number };
  employees: PlanEmployee[];
  equipment: PlanEquipment[];
  jobs: PlanJob[];
  /** Work that can't move: locked, confirmed, started, or inside the frozen days. */
  fixed: PlanBusyBlock[];
  weatherHours: Record<string, WeatherHourData[]>;
  weatherRules: WeatherRules;
}

export interface PlannedBlock {
  projectId: string;
  day: Day;
  startMin: number;
  endMin: number;
  employeeIds: string[];
  equipmentIds: string[];
  why: string[];
  late: boolean;
}

export interface Unplaced {
  projectId: string;
  label: string;
  hoursLeft: number;
  reason: string;
}

export interface PlanResult {
  blocks: PlannedBlock[];
  unplaced: Unplaced[];
}

const STEP = 30;
const DEFAULT_SPREAD_DAYS = 10;
const DEFAULT_TRAVEL = { averageMph: 40, roadFactor: 1.3, minimumMinutes: 10 };

type FailReason = "weather" | "people" | "skills" | "equipment" | "time";

const FAIL_TEXT: Record<FailReason, string> = {
  weather: "the weather doesn't fit on any open day",
  people: "not enough people are free",
  skills: "nobody free has the required skills",
  equipment: "the required equipment isn't free",
  time: "there's no open time slot long enough",
};

export function workDaysBetween(first: Day, last: Day, saturdays: boolean): Day[] {
  const out: Day[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    if ((dow >= 1 && dow <= 5) || (saturdays && dow === 6)) out.push(d);
  }
  return out;
}

export function planSchedule(input: PlanInput): PlanResult {
  const travel = input.travel ?? DEFAULT_TRAVEL;
  const days = workDaysBetween(input.firstDay, input.lastDay, input.workSaturdays);
  const busy: PlanBusyBlock[] = [...input.fixed];
  const out: PlanResult = { blocks: [], unplaced: [] };
  const weatherIndex = Object.fromEntries(Object.entries(input.weatherHours).map(([k, v]) => [k, indexHours(v)]));

  const jobs = [...input.jobs].sort(
    (a, b) =>
      (a.dueDate ?? a.requestedDate).localeCompare(b.dueDate ?? b.requestedDate) ||
      a.priorityRank - b.priorityRank ||
      a.requestedDate.localeCompare(b.requestedDate) ||
      a.label.localeCompare(b.label),
  );

  const spread = input.spreadDays ?? DEFAULT_SPREAD_DAYS;
  const workdayGap = (a: Day, b: Day) => (a <= b ? 1 : -1) * (workDaysBetween(a < b ? a : b, a < b ? b : a, input.workSaturdays).length - 1);

  for (const job of jobs) {
    // Not yet within reach of the planning window: it waits until its dates come closer.
    if (days.length && workDaysBetween(input.lastDay, job.requestedDate, input.workSaturdays).length - 1 > spread) continue;
    let remaining = Math.max(0, Math.round((job.hoursNeeded * 60) / 15) * 15);
    let after: Day | null = null;
    let lastCrew: string[] = [];
    const failures = new Map<FailReason, number>();

    while (remaining > 0) {
      let best: { score: number; block: PlannedBlock } | null = null;

      for (const day of days) {
        if (after && day <= after) continue;
        if (job.earliestDate && day < job.earliestDate) continue;
        const attempt = tryDay(job, day, remaining, lastCrew);
        if ("fail" in attempt) {
          failures.set(attempt.fail, (failures.get(attempt.fail) ?? 0) + 1);
          continue;
        }
        if (!best || attempt.score < best.score) best = attempt;
      }

      if (!best) {
        const top = [...failures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "time";
        out.unplaced.push({
          projectId: job.id,
          label: job.label,
          hoursLeft: remaining / 60,
          reason: days.length ? `No workable day through ${fmtDay(input.lastDay)}: ${FAIL_TEXT[top]}.` : "No work days in the planning window.",
        });
        break;
      }

      out.blocks.push(best.block);
      busy.push({ ...best.block, city: job.city, lat: job.lat, lng: job.lng });
      remaining -= best.block.endMin - best.block.startMin;
      after = best.block.day;
      lastCrew = best.block.employeeIds;
    }
  }
  return out;

  // ── helpers (close over input/busy) ──

  function tryDay(job: PlanJob, day: Day, remaining: number, lastCrew: string[]): { score: number; block: PlannedBlock } | { fail: FailReason } {
    const dow = dayOfWeek(day);
    const length = Math.min(remaining, input.workdayEndMin - input.workdayStartMin);
    const rule = job.weatherSensitive ? ruleFor(input.weatherRules, job.jobTypeId) : null;
    const index = job.locationId ? weatherIndex[job.locationId] : undefined;
    let fail: FailReason = "time";
    let weatherKnownGood = false;

    for (let start = input.workdayStartMin; start + length <= input.workdayEndMin; start += STEP) {
      const end = start + length;

      if (rule && index) {
        const w = checkWindow(index, day, start, end, rule);
        if (w.known && w.problems.length) {
          fail = "weather";
          continue;
        }
        weatherKnownGood = w.known;
      }

      const crew = pickCrew(job, day, dow, start, end, lastCrew);
      if (!crew.ok) {
        fail = crew.fail;
        continue;
      }
      const units = pickEquipment(job, day, start, end, crew.ids);
      if (!units.ok) {
        fail = "equipment";
        continue;
      }

      // Score this day (lower is better).
      const why: string[] = [];
      const offset = daysBetween(job.requestedDate, day);
      const gap = Math.abs(workdayGap(job.requestedDate, day));
      // Even out the workload: hours already booked that day count most, then distance from the requested date.
      const booked = busy.filter((b) => b.day === day && b.projectId !== job.id).reduce((s, b) => s + b.endMin - b.startMin, 0) / 60;
      let score = booked * 10 + Math.abs(offset) * (offset < 0 ? 1.5 : 1) + Math.max(0, gap - spread) * 1000;
      if (offset === 0) why.push("customer's requested date");
      else why.push(`${Math.abs(offset)} day${Math.abs(offset) === 1 ? "" : "s"} ${offset < 0 ? "before" : "after"} the requested date`);
      why.push(booked ? `${Math.round(booked * 10) / 10} hrs of other work booked that day` : "nothing else booked that day");
      const late = !!job.dueDate && day > job.dueDate;
      if (late) {
        score += 100_000;
        why.push(`after the due date (${fmtDay(job.dueDate!)})`);
      }
      const nearby = busy.some(
        (b) => b.day === day && b.city === job.city && b.projectId !== job.id && (b.employeeIds.some((id) => crew.ids.includes(id)) || b.equipmentIds.some((id) => units.ids.includes(id))),
      );
      if (nearby) {
        score -= 6;
        why.push(`crew already working in ${job.city} that day`);
      }
      if (job.previousDays.includes(day)) score -= 4;
      if (weatherKnownGood) why.push("weather fits");
      score += start / 600; // earlier start breaks ties

      return {
        score,
        block: { projectId: job.id, day, startMin: start, endMin: end, employeeIds: crew.ids, equipmentIds: units.ids, why, late },
      };
    }
    return { fail };
  }

  /** Is this resource free for [start, end] on `day`, including drive time to and from its other work? */
  function free(resource: (b: PlanBusyBlock) => boolean, job: PlanJob, day: Day, start: number, end: number) {
    for (const b of busy) {
      if (b.day !== day || !resource(b)) continue;
      if (b.startMin < end && start < b.endMin) return false;
      const drive =
        b.lat !== null && b.lng !== null && job.lat !== null && job.lng !== null
          ? estimateTravelMinutes({ lat: b.lat, lng: b.lng }, { lat: job.lat, lng: job.lng }, travel)
          : 0;
      if (b.endMin <= start && start - b.endMin < drive) return false;
      if (b.startMin >= end && b.startMin - end < drive) return false;
    }
    return true;
  }

  function pickCrew(job: PlanJob, day: Day, dow: number, start: number, end: number, lastCrew: string[]): { ok: true; ids: string[] } | { ok: false; fail: FailReason } {
    const available = input.employees.filter(
      (e) =>
        e.active &&
        e.workDays.includes(dow) &&
        start >= e.normalStartMin &&
        end <= e.normalEndMin &&
        !e.timeOff.some(
          (o) => day >= o.startDay && day <= o.endDay && (o.startMin === null || o.endMin === null || (o.startMin < end && start < o.endMin)),
        ) &&
        free((b) => b.employeeIds.includes(e.id), job, day, start, end),
    );
    if (available.length < job.crewSize) return { ok: false, fail: "people" };

    const bookedMinutes = (id: string) => busy.filter((b) => b.day === day && b.employeeIds.includes(id)).reduce((s, b) => s + b.endMin - b.startMin, 0);
    const inCity = (id: string) => busy.some((b) => b.day === day && b.city === job.city && b.employeeIds.includes(id));
    const rank = (e: PlanEmployee) => (lastCrew.includes(e.id) ? 0 : 10) + (inCity(e.id) ? 0 : 5) + bookedMinutes(e.id) / 600;
    const ordered = [...available].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    const chosen: string[] = [];
    for (const req of job.requiredSkills) {
      const have = chosen.filter((id) => ordered.find((e) => e.id === id)!.skillIds.includes(req.skillId)).length;
      const extra = ordered.filter((e) => !chosen.includes(e.id) && e.skillIds.includes(req.skillId)).slice(0, Math.max(0, req.minCount - have));
      if (have + extra.length < req.minCount) return { ok: false, fail: "skills" };
      chosen.push(...extra.map((e) => e.id));
    }
    for (const e of ordered) {
      if (chosen.length >= job.crewSize) break;
      if (!chosen.includes(e.id)) chosen.push(e.id);
    }
    if (chosen.length < job.crewSize) return { ok: false, fail: "people" };
    return { ok: true, ids: chosen };
  }

  function pickEquipment(job: PlanJob, day: Day, start: number, end: number, crewIds: string[]): { ok: true; ids: string[] } | { ok: false } {
    const chosen: string[] = [];
    for (const req of job.requiredEquipment) {
      const units = input.equipment
        .filter(
          (u) =>
            u.type === req.type &&
            u.active &&
            u.status !== "MAINTENANCE" &&
            u.status !== "OUT_OF_SERVICE" &&
            !u.downtime.some((d) => day >= d.startDay && day <= d.endDay) &&
            free((b) => b.equipmentIds.includes(u.id), job, day, start, end),
        )
        // Prefer the truck that's already traveling with this crew today.
        .sort((a, b) => Number(!rides(a.id)) - Number(!rides(b.id)) || a.name.localeCompare(b.name));
      if (units.length < req.quantity) return { ok: false };
      chosen.push(...units.slice(0, req.quantity).map((u) => u.id));
    }
    return { ok: true, ids: chosen };

    function rides(unitId: string) {
      return busy.some((b) => b.day === day && b.equipmentIds.includes(unitId) && b.employeeIds.some((id) => crewIds.includes(id)));
    }
  }
}
