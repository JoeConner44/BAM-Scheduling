import { describe, expect, it } from "vitest";
import { checkBlock, introducedFindings, withBlock, DEFAULT_SETTINGS } from "./conflicts";
import type { EBlock, EProject, Snapshot } from "./types";

// Athens and Winder are ~17 miles apart.
const ATHENS = { lat: 33.9519, lng: -83.3576 };
const WINDER = { lat: 33.9926, lng: -83.7202 };

function project(id: string, over: Partial<EProject> = {}): EProject {
  return {
    id,
    label: `${id} — Athens`,
    city: "Athens",
    locationId: "loc-athens",
    ...ATHENS,
    deadline: null,
    inspectionDate: null,
    earliestDate: null,
    surfaceReady: true,
    customerReady: true,
    status: "READY",
    weatherSensitivity: "HIGH",
    estCrewSize: 2,
    requiredSkills: [],
    requiredEquipment: [],
    ...over,
  };
}

function block(id: string, projectId: string, startMin: number, endMin: number, over: Partial<EBlock> = {}): EBlock {
  return { id, projectId, day: "2026-09-28", startMin, endMin, state: "TENTATIVE", progress: "PLANNED", employeeIds: [], equipmentIds: [], ...over };
}

function snapshot(blocks: EBlock[], projects: EProject[] = [project("kroger"), project("publix")]): Snapshot {
  return {
    blocks,
    projects: Object.fromEntries(projects.map((p) => [p.id, p])),
    employees: {
      john: { id: "john", name: "John", active: true, normalStartMin: 420, normalEndMin: 1050, workDays: [1, 2, 3, 4, 5], skillIds: ["layout"], timeOff: [] },
      david: {
        id: "david",
        name: "David",
        active: true,
        normalStartMin: 420,
        normalEndMin: 1050,
        workDays: [1, 2, 3, 4, 5],
        skillIds: [],
        timeOff: [{ startDay: "2026-09-29", endDay: "2026-10-01", startMin: null, endMin: null, type: "VACATION" }],
      },
      chris: {
        id: "chris",
        name: "Chris",
        active: true,
        normalStartMin: 420,
        normalEndMin: 1050,
        workDays: [1, 2, 3, 4, 5],
        skillIds: [],
        timeOff: [{ startDay: "2026-09-28", endDay: "2026-09-28", startMin: 720, endMin: 1440, type: "OFF" }],
      },
    },
    equipment: {
      truck1: { id: "truck1", name: "Truck #1", type: "STRIPING_TRUCK", status: "AVAILABLE", active: true, maintenanceNote: null, downtime: [] },
      truck3: {
        id: "truck3",
        name: "Truck #3",
        type: "STRIPING_TRUCK",
        status: "AVAILABLE",
        active: true,
        maintenanceNote: null,
        downtime: [{ startDay: "2026-09-30", endDay: "2026-09-30", reason: "Brakes" }],
      },
      trailer2: { id: "trailer2", name: "Trailer #2", type: "TRAILER", status: "OUT_OF_SERVICE", active: true, maintenanceNote: "Flat tire", downtime: [] },
    },
    forecasts: [{ locationId: "loc-athens", day: "2026-09-29", precipChance: 70, summary: "Showers" }],
    settings: { today: "2026-09-24", ...DEFAULT_SETTINGS },
  };
}

const codes = (fs: { code: string }[]) => fs.map((f) => f.code).sort();

describe("employee conflicts", () => {
  it("flags the same person on overlapping blocks", () => {
    const a = block("a", "kroger", 480, 720, { employeeIds: ["john"] });
    const b = block("b", "publix", 600, 780, { employeeIds: ["john"] });
    const f = checkBlock(b, snapshot([a, b])).filter((x) => x.code === "EMPLOYEE_OVERLAP");
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("conflict");
    expect(f[0].message).toContain("John is already assigned to kroger — Athens, 8:00 AM–12:00 PM");
    expect(f[0].message).toContain("10:00 AM–1:00 PM");
  });

  it("allows back-to-back blocks the same day (multiple projects per day)", () => {
    const a = block("a", "kroger", 480, 660, { employeeIds: ["john"] });
    const b = block("b", "publix", 690, 780, { employeeIds: ["john"] });
    expect(codes(checkBlock(b, snapshot([a, b])).filter((f) => f.severity !== "info"))).toEqual([]);
  });

  it("ignores overlaps on different days", () => {
    const a = block("a", "kroger", 480, 720, { employeeIds: ["john"] });
    const b = block("b", "publix", 480, 720, { employeeIds: ["john"], day: "2026-09-30" });
    expect(checkBlock(b, snapshot([a, b])).some((f) => f.code === "EMPLOYEE_OVERLAP")).toBe(false);
  });

  it("ignores finished blocks", () => {
    const a = block("a", "kroger", 480, 720, { employeeIds: ["john"], progress: "DONE" });
    const b = block("b", "publix", 600, 780, { employeeIds: ["john"] });
    expect(checkBlock(b, snapshot([a, b])).some((f) => f.code === "EMPLOYEE_OVERLAP")).toBe(false);
  });

  it("flags full-day and partial-day time off", () => {
    const vac = block("v", "kroger", 480, 600, { employeeIds: ["david"], day: "2026-09-30" });
    expect(checkBlock(vac, snapshot([vac])).find((f) => f.code === "EMPLOYEE_TIME_OFF")?.message).toBe("David is vacation on Wed 9/30.");

    const morning = block("m", "kroger", 480, 690, { employeeIds: ["chris"] });
    const afternoon = block("p", "publix", 780, 900, { employeeIds: ["chris"] });
    const snap = snapshot([morning, afternoon]);
    expect(checkBlock(morning, snap).some((f) => f.code === "EMPLOYEE_TIME_OFF")).toBe(false);
    expect(checkBlock(afternoon, snap).some((f) => f.code === "EMPLOYEE_TIME_OFF")).toBe(true);
  });

  it("warns on non-work days and long days", () => {
    const sat = block("s", "kroger", 480, 600, { employeeIds: ["john"], day: "2026-10-03" });
    expect(checkBlock(sat, snapshot([sat])).find((f) => f.code === "EMPLOYEE_OUTSIDE_HOURS")?.title).toBe("Not a normal work day");

    const a = block("a", "kroger", 420, 780, { employeeIds: ["john"] });
    const b = block("b", "publix", 780, 1050, { employeeIds: ["john"] });
    expect(checkBlock(b, snapshot([a, b])).some((f) => f.code === "EMPLOYEE_OVERLOADED")).toBe(true);
  });
});

describe("equipment conflicts", () => {
  it("flags the same truck on overlapping blocks", () => {
    const a = block("a", "kroger", 480, 660, { equipmentIds: ["truck1"] });
    const b = block("b", "publix", 600, 780, { equipmentIds: ["truck1"] });
    const f = checkBlock(b, snapshot([a, b])).find((x) => x.code === "EQUIPMENT_OVERLAP");
    expect(f?.severity).toBe("conflict");
    expect(f?.message).toContain("Truck #1 is already assigned to kroger — Athens");
  });

  it("flags out-of-service equipment and dated maintenance", () => {
    const oos = block("o", "kroger", 480, 600, { equipmentIds: ["trailer2"] });
    expect(checkBlock(oos, snapshot([oos])).find((f) => f.code === "EQUIPMENT_UNAVAILABLE")?.message).toBe("Trailer #2 is out of service (Flat tire).");

    const wed = block("w", "kroger", 480, 600, { equipmentIds: ["truck3"], day: "2026-09-30" });
    const thu = block("t", "kroger", 480, 600, { equipmentIds: ["truck3"], day: "2026-10-01" });
    const snap = snapshot([wed, thu]);
    expect(checkBlock(wed, snap).some((f) => f.code === "EQUIPMENT_UNAVAILABLE")).toBe(true);
    expect(checkBlock(thu, snap).some((f) => f.code === "EQUIPMENT_UNAVAILABLE")).toBe(false);
  });
});

describe("travel", () => {
  const projects = [project("kroger"), project("walmart", { label: "walmart — Winder", city: "Winder", locationId: "loc-winder", ...WINDER })];

  it("warns when there is no time to drive between cities", () => {
    const a = block("a", "kroger", 480, 660, { employeeIds: ["john", "chris"], equipmentIds: ["truck1"] });
    const b = block("b", "walmart", 660, 780, { employeeIds: ["john"], equipmentIds: ["truck1"] });
    const f = checkBlock(b, snapshot([a, b], projects)).filter((x) => x.code === "TRAVEL");
    expect(f).toHaveLength(1); // one warning per previous block, listing everyone affected
    expect(f[0].message).toMatch(/^John, Truck #1: kroger — Athens ends 11:00 AM/);
    expect(f[0].message).toContain("Athens → Winder");
    // The earlier block is not flagged; the warning lives on the block you travel to.
    expect(checkBlock(a, snapshot([a, b], projects)).some((x) => x.code === "TRAVEL")).toBe(false);
  });

  it("is satisfied by a large enough gap", () => {
    const a = block("a", "kroger", 480, 660, { employeeIds: ["john"] });
    const b = block("b", "walmart", 720, 840, { employeeIds: ["john"] });
    expect(checkBlock(b, snapshot([a, b], projects)).some((x) => x.code === "TRAVEL")).toBe(false);
  });
});

describe("dates, readiness, weather, staffing", () => {
  it("flags deadline and inspection problems", () => {
    const p = project("kroger", { deadline: "2026-09-29", inspectionDate: "2026-09-30", earliestDate: "2026-09-29" });
    const early = block("e", "kroger", 480, 600, { day: "2026-09-28" });
    const late = block("l", "kroger", 480, 600, { day: "2026-10-01" });
    const snap = snapshot([early, late], [p]);
    expect(codes(checkBlock(early, snap).filter((f) => f.severity !== "info"))).toEqual(["BEFORE_EARLIEST"]);
    expect(codes(checkBlock(late, snap).filter((f) => f.severity !== "info"))).toEqual(["PAST_DEADLINE", "PAST_INSPECTION"]);
  });

  it("warns about weather for sensitive jobs only", () => {
    const tue = block("t", "kroger", 480, 600, { day: "2026-09-29" });
    expect(checkBlock(tue, snapshot([tue])).find((f) => f.code === "WEATHER")?.message).toContain("70% chance of rain in Athens on Tue 9/29");
    const insensitive = snapshot([tue], [project("kroger", { weatherSensitivity: "NONE" })]);
    expect(checkBlock(tue, insensitive).some((f) => f.code === "WEATHER")).toBe(false);
  });

  it("reports staffing gaps as info", () => {
    const p = project("kroger", {
      estCrewSize: 2,
      requiredSkills: [{ skillId: "layout", skillName: "Layout", minCount: 1 }],
      requiredEquipment: [{ type: "STRIPING_TRUCK", typeLabel: "Striping truck", quantity: 1 }],
    });
    const b = block("b", "kroger", 480, 600, { employeeIds: ["david"] });
    const f = checkBlock(b, snapshot([b], [p]));
    expect(codes(f)).toEqual(["MISSING_EQUIPMENT", "MISSING_SKILL", "UNDERSTAFFED"]);
    expect(f.every((x) => x.severity === "info")).toBe(true);
  });
});

describe("introducedFindings", () => {
  it("reports only what a change adds, once per double-booking", () => {
    const a = block("a", "kroger", 480, 720, { employeeIds: ["john"] });
    const b = block("b", "publix", 780, 900, { employeeIds: ["john"] });
    const before = snapshot([a, b]);
    const after = withBlock(before, { ...b, startMin: 600, endMin: 780 });
    const added = introducedFindings(before, after);
    expect(added.map((f) => f.code)).toEqual(["EMPLOYEE_OVERLAP"]);
  });

  it("describes a double-booking from the changed block's side", () => {
    const school = block("a", "kroger", 420, 900, { employeeIds: ["john"] });
    const qt = block("b", "publix", 780, 960);
    const before = snapshot([school, qt]);
    const after = withBlock(before, { ...qt, employeeIds: ["john"] });
    const [f] = introducedFindings(before, after, "b").filter((x) => x.code === "EMPLOYEE_OVERLAP");
    expect(f.blockId).toBe("b");
    expect(f.message).toContain("John is already assigned to kroger — Athens, 7:00 AM–3:00 PM. This assignment: publix — Athens");
  });

  it("does not ask again about a pre-existing problem", () => {
    const a = block("a", "kroger", 480, 720, { employeeIds: ["john"] });
    const b = block("b", "publix", 600, 780, { employeeIds: ["john"] });
    const before = snapshot([a, b]);
    const after = withBlock(before, { ...b, employeeIds: ["john", "david"] });
    expect(introducedFindings(before, after)).toEqual([]);
  });

  it("never asks about staffing gaps", () => {
    const before = snapshot([]);
    const after = withBlock(before, block("n", "kroger", 480, 600));
    expect(introducedFindings(before, after)).toEqual([]);
  });
});
