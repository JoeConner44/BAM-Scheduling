// Fictional sample data for the first test (spec §26). Dates are relative to today so the
// demo always looks current: "D0" is today (or the next weekday), D1 the next work day, etc.
//
// Built-in situations to find on the board:
//   • D0: three Athens jobs in one day (Kroger → Publix → Chick-fil-A), trucks shared.
//   • D1: John, Chris and Truck #2 finish in Athens at 11:00 and start in Winder at 11:00 → travel warning.
//   • D1–D3: Mike on vacation.  D3: Chris off at noon.  D4: Jason off.
//   • D2: Truck #1 double-booked (school job + QuikTrip) → equipment conflict.
//   • D2: Truck #3 in the shop.  Trailer #2 out of service.
//   • D2: 70% rain in Athens → the church lot (very weather sensitive) shows a weather risk.
//   • Barrow Regional is partially complete with 3 hours left to schedule.

import type { EquipmentType, Prisma, Priority, PrismaClient, ProjectStatus, WeatherSensitivity } from "@prisma/client";
import { addDays, dayOfWeek, dayToDate, today, workdayOffset, type Day } from "../src/lib/time";

/** Wipe everything and load the sample data. Used by `npm run db:seed`, the first deploy, and the owner's "reset sample data" button. */
export async function loadSampleData(db: PrismaClient): Promise<string> {
  const T = today();
  const D = (n: number) => dayToDate(workdayOffset(T, n));
  const prevWorkday = (day: Day): Day => {
    let d = addDays(day, -1);
    while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, -1);
    return d;
  };
  const h = (hh: number, mm = 0) => hh * 60 + mm;

  async function reset() {
    // Children first.
    await db.$transaction([
      db.auditLog.deleteMany(),
    db.storedFile.deleteMany(),
      db.schedulingOverride.deleteMany(),
      db.conditionReport.deleteMany(),
      db.projectPhoto.deleteMany(),
      db.projectNote.deleteMany(),
      db.projectStatusHistory.deleteMany(),
      db.equipmentAssignment.deleteMany(),
      db.assignment.deleteMany(),
      db.scheduleBlock.deleteMany(),
      db.projectRequiredEquipment.deleteMany(),
      db.projectRequiredSkill.deleteMany(),
      db.project.deleteMany(),
      db.jobType.deleteMany(),
      db.customer.deleteMany(),
      db.weatherForecast.deleteMany(),
      db.equipmentDowntime.deleteMany(),
      db.equipment.deleteMany(),
      db.timeOff.deleteMany(),
      db.availability.deleteMany(),
      db.employeeSkill.deleteMany(),
      db.user.deleteMany(),
      db.employee.deleteMany(),
      db.skill.deleteMany(),
      db.location.deleteMany(),
    ]);
  }

  async function main() {
    await reset();

    // ── Locations (normally created automatically from addresses) ──
    const loc = {
      athens: await db.location.create({ data: { city: "Athens", state: "GA", lat: 33.9519, lng: -83.3576 } }),
      winder: await db.location.create({ data: { city: "Winder", state: "GA", lat: 33.9926, lng: -83.7202 } }),
      lawrenceville: await db.location.create({ data: { city: "Lawrenceville", state: "GA", lat: 33.9562, lng: -83.988 } }),
    };

    // ── Skills ──
    const skillNames = ["Line Striping", "Layout", "Thermoplastic", "CDL Driver", "Sealcoating", "Traffic Control"] as const;
    const skill: Record<(typeof skillNames)[number], string> = {} as never;
    for (const name of skillNames) skill[name] = (await db.skill.create({ data: { name } })).id;

    // ── Employees (individual resources — no permanent crews) ──
    const people: { name: string; position: string; color: string; phone: string; skills: (typeof skillNames)[number][]; certs?: (typeof skillNames)[number][] }[] = [
      { name: "John", position: "Lead Striper", color: "#2563eb", phone: "706-555-0101", skills: ["Line Striping", "Layout", "CDL Driver"], certs: ["CDL Driver"] },
      { name: "Mike", position: "Thermo Operator", color: "#dc2626", phone: "706-555-0102", skills: ["Thermoplastic", "Line Striping", "CDL Driver"], certs: ["CDL Driver"] },
      { name: "David", position: "Striper", color: "#16a34a", phone: "706-555-0103", skills: ["Line Striping", "Sealcoating", "Thermoplastic"] },
      { name: "Jason", position: "Layout Tech", color: "#9333ea", phone: "706-555-0104", skills: ["Layout", "Traffic Control", "CDL Driver"], certs: ["CDL Driver"] },
      { name: "Chris", position: "Striper", color: "#ea580c", phone: "706-555-0105", skills: ["Line Striping", "Traffic Control"] },
      { name: "Luis", position: "Sealcoat Lead", color: "#0891b2", phone: "706-555-0106", skills: ["Sealcoating", "Thermoplastic", "Line Striping"] },
    ];
    const emp: Record<string, string> = {};
    for (const p of people) {
      const e = await db.employee.create({
        data: {
          name: p.name,
          position: p.position,
          color: p.color,
          phone: p.phone,
          normalStartMin: h(7),
          normalEndMin: h(17, 30),
          homeLocationId: loc.athens.id,
          skills: { create: p.skills.map((s) => ({ skillId: skill[s], isCertification: p.certs?.includes(s) ?? false })) },
        },
      });
      emp[p.name] = e.id;
    }

    // ── Users ──
    const owner = await db.user.create({ data: { name: "Pat Owner", email: "owner@bam.test", role: "OWNER" } });
    const dispatcher = await db.user.create({ data: { name: "Dana Dispatcher", email: "dispatch@bam.test", role: "DISPATCHER" } });
    for (const p of people) {
      await db.user.create({ data: { name: p.name, phone: p.phone, role: "FIELD", employeeId: emp[p.name] } });
    }

    // ── Time off ──
    await db.timeOff.createMany({
      data: [
        { employeeId: emp.Mike, startDay: D(1), endDay: D(3), type: "VACATION", note: "Beach trip", createdById: owner.id },
        { employeeId: emp.Chris, startDay: D(3), endDay: D(3), startMin: h(12), endMin: h(24), type: "OFF", note: "Doctor appointment — off at noon", createdById: dispatcher.id },
        { employeeId: emp.Jason, startDay: D(4), endDay: D(4), type: "OFF", note: "Personal day", createdById: dispatcher.id },
      ],
    });

    // ── Equipment (individual units) ──
    const equipment: { unitCode: string; name: string; type: EquipmentType; color: string; status?: "OUT_OF_SERVICE"; note?: string }[] = [
      { unitCode: "TRK-1", name: "Striping Truck #1", type: "STRIPING_TRUCK", color: "#1d4ed8" },
      { unitCode: "TRK-2", name: "Striping Truck #2", type: "STRIPING_TRUCK", color: "#0f766e" },
      { unitCode: "TRK-3", name: "Striping Truck #3", type: "STRIPING_TRUCK", color: "#7c3aed" },
      { unitCode: "TRL-1", name: "Trailer #1", type: "TRAILER", color: "#78716c" },
      { unitCode: "TRL-2", name: "Trailer #2", type: "TRAILER", color: "#a8a29e", status: "OUT_OF_SERVICE", note: "Broken axle" },
      { unitCode: "THM-1", name: "Thermoplastic Machine #1", type: "THERMO_MACHINE", color: "#b91c1c" },
      { unitCode: "ARB-1", name: "Arrow Board #1", type: "ARROW_BOARD", color: "#ca8a04" },
      { unitCode: "LAY-1", name: "Layout Kit #1", type: "LAYOUT", color: "#475569" },
    ];
    const eq: Record<string, string> = {};
    for (const e of equipment) {
      const row = await db.equipment.create({
        data: {
          unitCode: e.unitCode,
          name: e.name,
          type: e.type,
          color: e.color,
          status: e.status ?? "AVAILABLE",
          maintenanceNote: e.note,
          currentLocationId: loc.athens.id,
        },
      });
      eq[e.unitCode] = row.id;
    }
    await db.equipmentDowntime.create({ data: { equipmentId: eq["TRK-3"], startDay: D(2), endDay: D(2), reason: "Brake service" } });

    // ── Job types & customers ──
    const jobTypeNames = ["Parking lot restripe", "New layout", "Thermoplastic", "Sealcoating", "ADA / signage"];
    const jobType: Record<string, string> = {};
    for (const name of jobTypeNames) jobType[name] = (await db.jobType.create({ data: { name } })).id;

    const customer = async (name: string, contactName: string, phone: string, email: string) =>
      (await db.customer.create({ data: { name, contactName, phone, email } })).id;

    // ── Projects ──
    type Seed = {
      code: string;
      customer: string;
      name: string;
      street: string;
      zip: string;
      loc: keyof typeof loc;
      lat: number;
      lng: number;
      jobType: string;
      scope: string;
      hours: number;
      crew: number;
      priority: Priority;
      weather: WeatherSensitivity;
      status: ProjectStatus;
      deadline?: Date;
      inspection?: Date;
      earliest?: Date;
      preferred?: Date;
      surfaceReady?: boolean;
      customerReady?: boolean;
      skills?: [(typeof skillNames)[number], number][];
      equip?: [EquipmentType, number][];
      notes?: string;
      percent?: number;
      actual?: number;
      remaining?: number;
      contact: [string, string, string];
    };

    const projects: Seed[] = [
      {
        code: "P-1001", customer: "Kroger", name: "Kroger", street: "1720 Epps Bridge Pkwy", zip: "30606", loc: "athens", lat: 33.9234, lng: -83.4581,
        jobType: "Parking lot restripe", scope: "Restripe 220 stalls, 6 ADA stalls, fire lanes.", hours: 3, crew: 2, priority: "NORMAL", weather: "HIGH", status: "SCHEDULED",
        deadline: D(5), skills: [["Line Striping", 1]], equip: [["STRIPING_TRUCK", 1]], contact: ["Amy Reed", "706-555-0201", "areed@kroger.example"],
      },
      {
        code: "P-1002", customer: "Publix", name: "Publix", street: "1850 Epps Bridge Pkwy", zip: "30606", loc: "athens", lat: 33.9261, lng: -83.4524,
        jobType: "Parking lot restripe", scope: "Touch-up striping at front drive and pickup lanes.", hours: 1.5, crew: 2, priority: "HIGH", weather: "HIGH", status: "SCHEDULED",
        deadline: D(2), equip: [["STRIPING_TRUCK", 1]], contact: ["Tom Hale", "706-555-0202", "thale@publix.example"],
      },
      {
        code: "P-1003", customer: "Chick-fil-A", name: "Chick-fil-A", street: "3190 Atlanta Hwy", zip: "30606", loc: "athens", lat: 33.9336, lng: -83.4721,
        jobType: "Parking lot restripe", scope: "Drive-thru lane arrows and stop bars, 40 stalls.", hours: 2.5, crew: 2, priority: "NORMAL", weather: "HIGH", status: "SCHEDULED",
        equip: [["STRIPING_TRUCK", 1]], contact: ["Grace Kim", "706-555-0203", "gkim@cfa.example"],
      },
      {
        code: "P-1004", customer: "Walmart", name: "Walmart", street: "440 Atlanta Hwy NW", zip: "30680", loc: "winder", lat: 33.9853, lng: -83.7391,
        jobType: "Parking lot restripe", scope: "Full lot restripe, garden center lanes.", hours: 4, crew: 3, priority: "HIGH", weather: "HIGH", status: "SCHEDULED",
        deadline: D(3), inspection: D(4), skills: [["Layout", 1], ["Line Striping", 1]], equip: [["STRIPING_TRUCK", 1]], contact: ["Rick Ortiz", "770-555-0204", "rortiz@walmart.example"],
      },
      {
        code: "P-1005", customer: "Oconee Hills Baptist Church", name: "Oconee Hills Baptist Church", street: "2780 Hog Mountain Rd", zip: "30605", loc: "athens", lat: 33.9102, lng: -83.3389,
        jobType: "New layout", scope: "New lot layout after repave. 140 stalls.", hours: 5, crew: 2, priority: "LOW", weather: "HIGH", status: "TENTATIVE",
        skills: [["Layout", 1]], equip: [["STRIPING_TRUCK", 1]], contact: ["Pastor Bill Gray", "706-555-0205", "office@oconeehills.example"],
      },
      {
        code: "P-1006", customer: "Home Depot", name: "Home Depot", street: "207 Exchange Blvd", zip: "30680", loc: "winder", lat: 33.9948, lng: -83.7593,
        jobType: "Sealcoating", scope: "Sealcoat contractor lot (east side).", hours: 6, crew: 2, priority: "NORMAL", weather: "HIGH", status: "SCHEDULED",
        skills: [["Sealcoating", 2]], equip: [["TRAILER", 1], ["STRIPING_TRUCK", 1]], contact: ["Sandra Lee", "770-555-0206", "slee@homedepot.example"],
      },
      {
        code: "P-1007", customer: "Gwinnett County Schools", name: "Maple Creek Middle School", street: "455 Old Norcross Rd", zip: "30046", loc: "lawrenceville", lat: 33.9531, lng: -83.9912,
        jobType: "Thermoplastic", scope: "Thermoplastic crosswalks and school zone markings.", hours: 8, crew: 3, priority: "CRITICAL", weather: "LOW", status: "SCHEDULED",
        inspection: D(3), deadline: D(3), skills: [["Thermoplastic", 2]], equip: [["THERMO_MACHINE", 1], ["STRIPING_TRUCK", 1]],
        contact: ["Mark Bell", "678-555-0207", "mbell@gcps.example"], notes: "Must be done before county inspection. Work only while school is out of session hours.",
      },
      {
        code: "P-1008", customer: "QuikTrip", name: "QuikTrip", street: "1101 Buford Dr", zip: "30043", loc: "lawrenceville", lat: 33.9734, lng: -83.9794,
        jobType: "Parking lot restripe", scope: "Pump island and stall restripe.", hours: 3, crew: 2, priority: "NORMAL", weather: "HIGH", status: "TENTATIVE",
        equip: [["STRIPING_TRUCK", 1]], contact: ["Jen Park", "678-555-0208", "jpark@qt.example"],
      },
      {
        code: "P-1009", customer: "City of Lawrenceville", name: "Lawrenceville City Hall", street: "70 S Clayton St", zip: "30046", loc: "lawrenceville", lat: 33.9562, lng: -83.9880,
        jobType: "ADA / signage", scope: "Repaint 8 ADA stalls and install signage.", hours: 2, crew: 2, priority: "NORMAL", weather: "LOW", status: "WAITING_ON_CUSTOMER",
        customerReady: false, deadline: D(8), contact: ["Carl Dunn", "770-555-0209", "cdunn@lawrenceville.example"],
        notes: "City wants to confirm stall count before we start.",
      },
      {
        code: "P-1010", customer: "Barrow Regional Medical Center", name: "Barrow Regional Medical", street: "316 N Broad St", zip: "30680", loc: "winder", lat: 33.9981, lng: -83.7196,
        jobType: "Parking lot restripe", scope: "Restripe visitor + staff lots, ER lane markings.", hours: 8, crew: 2, priority: "HIGH", weather: "HIGH", status: "PARTIALLY_COMPLETE",
        deadline: D(6), skills: [["Line Striping", 1]], equip: [["STRIPING_TRUCK", 1]], percent: 60, actual: 5, remaining: 3,
        contact: ["Nina Shaw", "770-555-0210", "nshaw@barrowmed.example"],
      },
      {
        code: "P-1011", customer: "Sugarloaf Office Park", name: "Sugarloaf Office Park", street: "2300 Sugarloaf Pkwy", zip: "30045", loc: "lawrenceville", lat: 33.9721, lng: -84.0154,
        jobType: "Parking lot restripe", scope: "Restripe two lots, 180 stalls.", hours: 4, crew: 2, priority: "NORMAL", weather: "HIGH", status: "READY",
        preferred: D(4), equip: [["STRIPING_TRUCK", 1]], contact: ["Omar Ali", "770-555-0211", "oali@sugarloafop.example"],
      },
      {
        code: "P-1012", customer: "Athens-Clarke County", name: "New Library Annex", street: "2025 Baxter St", zip: "30606", loc: "athens", lat: 33.9474, lng: -83.4018,
        jobType: "New layout", scope: "Layout and stripe new lot once paving is finished.", hours: 5, crew: 2, priority: "NORMAL", weather: "HIGH", status: "WAITING_ON_CONSTRUCTION",
        surfaceReady: false, earliest: D(5), deadline: D(10), skills: [["Layout", 1]], equip: [["STRIPING_TRUCK", 1], ["LAYOUT", 1]],
        contact: ["Hector Ruiz", "706-555-0212", "hruiz@accgov.example"], notes: "Paving contractor expects to finish next week.",
      },
    ];

    const pid: Record<string, string> = {};
    for (const p of projects) {
      const row = await db.project.create({
        data: {
          code: p.code,
          customer: { connect: { id: await customer(p.customer, p.contact[0], p.contact[1], p.contact[2]) } },
          name: p.name,
          contactName: p.contact[0],
          contactPhone: p.contact[1],
          contactEmail: p.contact[2],
          street: p.street,
          city: loc[p.loc].city,
          state: "GA",
          zip: p.zip,
          lat: p.lat,
          lng: p.lng,
          location: { connect: { id: loc[p.loc].id } },
          jobType: { connect: { id: jobType[p.jobType] } },
          scope: p.scope,
          estTotalHours: p.hours,
          estCrewSize: p.crew,
          priority: p.priority,
          weatherSensitivity: p.weather,
          status: p.status,
          deadline: p.deadline,
          inspectionDate: p.inspection,
          earliestDate: p.earliest,
          preferredDate: p.preferred,
          surfaceReady: p.surfaceReady ?? true,
          customerReady: p.customerReady ?? true,
          notes: p.notes,
          percentComplete: p.percent ?? 0,
          actualHours: p.actual ?? 0,
          remainingHoursOverride: p.remaining ?? null,
          requiredSkills: { create: (p.skills ?? []).map(([s, n]) => ({ skillId: skill[s], minCount: n })) },
          requiredEquipment: { create: (p.equip ?? []).map(([type, quantity]) => ({ type, quantity })) },
          statusHistory: { create: { toStatus: p.status, changedById: dispatcher.id, reason: "Imported" } },
        },
      });
      pid[p.code] = row.id;
    }

    // ── Schedule blocks ──
    const block = async (
      code: string,
      day: Date,
      start: number,
      end: number,
      state: "TENTATIVE" | "COMMITTED",
      people: string[],
      units: string[],
      extra: Partial<Prisma.ScheduleBlockUncheckedCreateInput> = {},
    ) =>
      db.scheduleBlock.create({
        data: {
          projectId: pid[code],
          day,
          startMin: start,
          endMin: end,
          state,
          createdById: dispatcher.id,
          ...extra,
          assignments: { create: people.map((n, i) => ({ employeeId: emp[n], isLead: i === 0 })) },
          equipmentAssignments: { create: units.map((u) => ({ equipmentId: eq[u] })) },
        },
      });

    // D0 — three Athens jobs in one day.
    await block("P-1001", D(0), h(8), h(11), "COMMITTED", ["John", "David"], ["TRK-1"]);
    await block("P-1002", D(0), h(11, 30), h(13), "COMMITTED", ["John", "Chris"], ["TRK-1"]);
    await block("P-1003", D(0), h(13, 30), h(16), "COMMITTED", ["David", "Chris"], ["TRK-2"]);

    // D1 — Athens 8–11 then Winder at 11:00 with the same people/truck → travel warning.
    await block("P-1005", D(1), h(8), h(11), "TENTATIVE", ["John", "Chris"], ["TRK-2"]);
    const walmart = await block("P-1004", D(1), h(11), h(15), "COMMITTED", ["John", "Jason", "Chris"], ["TRK-2", "LAY-1"]);
    await block("P-1006", D(1), h(8), h(14), "COMMITTED", ["David", "Luis"], ["TRL-1", "TRK-3"]);

    // D2 — Truck #1 double-booked (school + QuikTrip); rain in Athens on the church lot.
    const school = await block("P-1007", D(2), h(7), h(15), "COMMITTED", ["Jason", "Luis", "David"], ["THM-1", "TRK-1", "ARB-1"]);
    const quiktrip = await block("P-1008", D(2), h(13), h(16), "TENTATIVE", ["John", "Chris"], ["TRK-1"]);
    await block("P-1005", D(2), h(8), h(10), "TENTATIVE", ["John", "Chris"], ["TRK-2"]);

    // Barrow Regional: last work day's visit got 60% done.
    const yesterday = dayToDate(prevWorkday(workdayOffset(T, 0)));
    const barrowBlock = await block("P-1010", yesterday, h(8), h(13), "COMMITTED", ["John", "Chris"], ["TRK-2"], {
      progress: "DONE",
      actualHours: 5,
      startedAt: new Date(yesterday.getTime() + h(8) * 60_000),
      completedAt: new Date(yesterday.getTime() + h(13) * 60_000),
    });
    await db.conditionReport.create({
      data: {
        projectId: pid["P-1010"],
        blockId: barrowBlock.id,
        reportedById: (await db.user.findFirstOrThrow({ where: { employeeId: emp.John } })).id,
        reason: "CARS_NOT_MOVED",
        percentComplete: 60,
        hoursWorked: 5,
        remainingHours: 3,
        canProceed: false,
        note: "Staff lot still full of cars after 1 PM. Visitor lot done. Need about 3 more hours early morning.",
      },
    });
    await db.projectNote.create({
      data: {
        projectId: pid["P-1010"],
        blockId: barrowBlock.id,
        kind: "CONDITION_REPORT",
        body: "🚧 Cars not moved — 60% complete, 5 hrs worked, about 3 hrs remaining. Staff lot still full after 1 PM.",
        authorId: (await db.user.findFirstOrThrow({ where: { employeeId: emp.John } })).id,
      },
    });

    // ── Weather (manual forecasts until the weather service is connected) ──
    const forecastRows: Prisma.WeatherForecastCreateManyInput[] = [];
    for (let i = 0; i < 10; i++) {
      const day = dayToDate(addDays(T, i));
      for (const l of Object.values(loc)) {
        let chance = [10, 15, 5, 20, 10, 0, 10, 15, 20, 5][i];
        let summary = chance < 15 ? "Sunny" : "Partly cloudy";
        if (day.getTime() === D(2).getTime()) {
          chance = l.city === "Athens" ? 70 : l.city === "Winder" ? 45 : 30;
          summary = "Afternoon thunderstorms";
        }
        forecastRows.push({ locationId: l.id, day, precipChance: chance, tempHighF: 78 - (i % 3), tempLowF: 58, windMph: 6, summary });
      }
    }
    await db.weatherForecast.createMany({ data: forecastRows });

    // ── A little history so the activity log isn't empty ──
    await db.auditLog.createMany({
      data: [
        {
          actorId: owner.id,
          entityType: "ScheduleBlock",
          entityId: walmart.id,
          action: "MOVE",
          summary: "Moved Walmart — Winder from Fri to " + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][D(1).getUTCDay()],
          reason: "Customer deadline",
          at: new Date(Date.now() - 1000 * 60 * 60 * 20),
        },
        {
          actorId: dispatcher.id,
          entityType: "ScheduleBlock",
          entityId: school.id,
          action: "ASSIGN_EQUIPMENT",
          summary: "Assigned Thermoplastic Machine #1 to Maple Creek Middle School — Lawrenceville",
          at: new Date(Date.now() - 1000 * 60 * 60 * 5),
        },
        {
          actorId: dispatcher.id,
          entityType: "ScheduleBlock",
          entityId: quiktrip.id,
          action: "CREATE",
          summary: "Penciled in QuikTrip — Lawrenceville (tentative)",
          at: new Date(Date.now() - 1000 * 60 * 60 * 2),
        },
      ],
    });

    return `Seeded sample data. Today = ${T}; D0 = ${workdayOffset(T, 0)}.`;
  }

  return main();
}
