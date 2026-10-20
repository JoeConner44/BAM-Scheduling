import { describe, expect, it } from "vitest";
import { DEFAULT_WEATHER_RULE } from "../weather/rules";
import { planSchedule, type PlanEmployee, type PlanInput, type PlanJob } from "./plan";

// Mon 2026-10-26 … Fri 2026-10-30
const MON = "2026-10-26", TUE = "2026-10-27", WED = "2026-10-28", FRI = "2026-10-30";
const ATHENS = { lat: 33.9519, lng: -83.3576 };
const WINDER = { lat: 33.9926, lng: -83.7202 };

const emp = (id: string, skills: string[] = [], over: Partial<PlanEmployee> = {}): PlanEmployee => ({
  id, name: id, active: true, skillIds: skills, workDays: [1, 2, 3, 4, 5], normalStartMin: 420, normalEndMin: 1050, timeOff: [], ...over,
});

const job = (id: string, over: Partial<PlanJob> = {}): PlanJob => ({
  id, label: `${id} — Athens`, city: "Athens", locationId: "athens", jobTypeId: null, ...ATHENS,
  hoursNeeded: 3, crewSize: 2, requiredSkills: [], requiredEquipment: [{ type: "TRUCK", typeLabel: "Truck", quantity: 1 }],
  requestedDate: TUE, earliestDate: null, dueDate: null, priorityRank: 2, weatherSensitive: true, previousDays: [], ...over,
});

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  firstDay: MON, lastDay: FRI, workdayStartMin: 420, workdayEndMin: 1050, workSaturdays: false,
  employees: [emp("john", ["layout"]), emp("david"), emp("chris")],
  equipment: [{ id: "truck1", name: "Truck #1", type: "TRUCK", active: true, status: "AVAILABLE", downtime: [] }],
  jobs: [], fixed: [], weatherHours: {}, weatherRules: { default: DEFAULT_WEATHER_RULE, byJobType: {} }, ...over,
});

const rainyHours = (day: string, fromHour: number) =>
  Array.from({ length: 24 }, (_, hour) => ({ day, hour, tempF: 65, precipChance: hour >= fromHour ? 80 : 0, windMph: 5 }));

describe("planSchedule", () => {
  it("books the requested date with a full crew and a truck", () => {
    const r = planSchedule(base({ jobs: [job("kroger")] }));
    expect(r.unplaced).toEqual([]);
    expect(r.blocks).toHaveLength(1);
    const b = r.blocks[0];
    expect([b.day, b.startMin, b.endMin]).toEqual([TUE, 420, 600]);
    expect(b.employeeIds).toHaveLength(2);
    expect(b.equipmentIds).toEqual(["truck1"]);
    expect(b.why[0]).toBe("customer's requested date");
  });

  it("moves off a rainy requested date to the nearest dry day", () => {
    const r = planSchedule(base({ jobs: [job("kroger")], weatherHours: { athens: [...rainyHours(TUE, 0), ...rainyHours(WED, 99)] } }));
    expect(r.blocks[0].day).toBe(WED);
    expect(r.blocks[0].why).toContain("weather fits");
  });

  it("works around rain later in the day when the job is short enough", () => {
    // Rain from 3 PM; a 3-hour job + 4 dry hours fits if it starts by 8 AM.
    const r = planSchedule(base({ jobs: [job("kroger")], weatherHours: { athens: rainyHours(TUE, 15) } }));
    expect([r.blocks[0].day, r.blocks[0].startMin]).toEqual([TUE, 420]);
  });

  it("never double-books people or the truck", () => {
    const r = planSchedule(base({ jobs: [job("a", { hoursNeeded: 4 }), job("b", { hoursNeeded: 4 })] }));
    const [a, b] = r.blocks;
    const sameDayOverlap = a.day === b.day && a.startMin < b.endMin && b.startMin < a.endMin;
    expect(sameDayOverlap && a.equipmentIds.some((id) => b.equipmentIds.includes(id))).toBe(false);
  });

  it("respects locked work, time off, skills and drive time", () => {
    const r = planSchedule(
      base({
        spreadDays: 0, // stay on the requested date so the constraints are what's tested
        employees: [emp("john", ["layout"], { timeOff: [{ startDay: TUE, endDay: TUE, startMin: null, endMin: null, type: "SICK" }] }), emp("david"), emp("chris"), emp("jason", ["layout"])],
        jobs: [job("walmart", { ...WINDER, city: "Winder", locationId: "winder", requiredSkills: [{ skillId: "layout", skillName: "Layout", minCount: 1 }] })],
        fixed: [{ projectId: "x", day: TUE, startMin: 420, endMin: 600, employeeIds: ["jason"], equipmentIds: ["truck1"], city: "Athens", ...ATHENS }],
      }),
    );
    const b = r.blocks[0];
    expect(b.day).toBe(TUE);
    expect(b.employeeIds).toContain("jason"); // John (the other Layout person) is sick
    expect(b.employeeIds).not.toContain("john");
    expect(b.startMin).toBeGreaterThanOrEqual(600 + 30); // after the Athens job plus ~30 min drive
  });

  it("splits a big job across days and keeps the same crew", () => {
    const r = planSchedule(base({ jobs: [job("school", { hoursNeeded: 14 })] }));
    expect(r.blocks.map((b) => b.day)).toEqual([TUE, WED]);
    expect(r.blocks[0].employeeIds).toEqual(r.blocks[1].employeeIds);
    expect(r.blocks.reduce((s, b) => s + b.endMin - b.startMin, 0)).toBe(14 * 60);
  });

  it("puts the most urgent job first and reports what can't fit", () => {
    const r = planSchedule(
      base({
        employees: [emp("john"), emp("david")],
        jobs: [job("later", { requestedDate: TUE, hoursNeeded: 9 }), job("urgent", { requestedDate: TUE, dueDate: TUE, hoursNeeded: 9, priorityRank: 0 })],
        firstDay: TUE,
        lastDay: TUE,
      }),
    );
    expect(r.blocks.map((b) => b.projectId)).toEqual(["urgent"]);
    expect(r.unplaced[0]).toMatchObject({ projectId: "later" });
    expect(r.unplaced[0].reason).toContain("not enough people are free");
  });

  it("goes past the due date only as a last resort, and says so", () => {
    const r = planSchedule(base({ jobs: [job("k", { requestedDate: MON, dueDate: MON })], weatherHours: { athens: rainyHours(MON, 0) } }));
    expect(r.blocks[0].day).toBe(TUE);
    expect(r.blocks[0].late).toBe(true);
    expect(r.blocks[0].why).toContain("after the due date (Mon 10/26)");
  });

  it("spreads jobs onto the least busy days near their requested date", () => {
    const fullDay = { hoursNeeded: 10.5 };
    const crews = [emp("a"), emp("b"), emp("c"), emp("d"), emp("e"), emp("f")];
    const trucks = ["t1", "t2", "t3"].map((id) => ({ id, name: id, type: "TRUCK", active: true, status: "AVAILABLE", downtime: [] }));
    const r = planSchedule(base({ employees: crews, equipment: trucks, jobs: ["a", "b", "c"].map((id) => job(id, fullDay)) }));
    // All three asked for Tuesday; one keeps it and the others go to the nearest empty days.
    expect(r.blocks.map((b) => b.day).sort()).toEqual([MON, TUE, WED]);
    expect(r.blocks.find((b) => b.day === TUE)!.why).toContain("nothing else booked that day");
  });

  it("only moves a job as far as the spread setting allows", () => {
    const busyTue = { projectId: "x", day: TUE, startMin: 420, endMin: 1050, employeeIds: ["chris"], equipmentIds: [], city: "Athens", ...ATHENS };
    expect(planSchedule(base({ jobs: [job("kroger")], fixed: [busyTue] })).blocks[0].day).not.toBe(TUE);
    expect(planSchedule(base({ spreadDays: 0, jobs: [job("kroger")], fixed: [busyTue] })).blocks[0].day).toBe(TUE);
  });

  it("leaves jobs requested far beyond the planning window for later", () => {
    const r = planSchedule(base({ jobs: [job("later", { requestedDate: "2027-01-15" })] }));
    expect(r.blocks).toEqual([]);
    expect(r.unplaced).toEqual([]);
  });
});
