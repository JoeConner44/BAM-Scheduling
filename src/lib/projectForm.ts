import "server-only";
import type { ProjectFormValues } from "@/components/ProjectForm";
import { db } from "./db";
import type { ProjectWithRefs } from "./data";
import { maybeDay, today } from "./time";

export async function projectFormLookups() {
  const [skills, jobTypes, customers, locations] = await Promise.all([
    db.skill.findMany({ orderBy: { name: "asc" } }),
    db.jobType.findMany({ orderBy: { name: "asc" } }),
    db.customer.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.location.findMany({ orderBy: { city: "asc" } }),
  ]);
  return {
    skills: skills.map((s) => ({ id: s.id, name: s.name })),
    jobTypes: jobTypes.map((j) => j.name),
    customers: customers.map((c) => c.name),
    cities: locations.map((l) => l.city),
  };
}

export function emptyProjectValues(): ProjectFormValues {
  return {
    customer: "", name: "", contactName: "", contactPhone: "", contactEmail: "", street: "", city: "", state: "GA", zip: "", lat: "", lng: "",
    jobType: "", scope: "", estTotalHours: "", estCrewSize: "2", earliestDate: today(), preferredDate: "", deadline: "", inspectionDate: "",
    priority: "NORMAL", weatherSensitivity: "HIGH", surfaceReady: true, customerReady: true, status: "READY", notes: "", percentComplete: "0",
    actualHours: "0", remainingHoursOverride: "", skills: {}, equipment: { STRIPING_TRUCK: 1 },
  };
}

export function projectValues(p: ProjectWithRefs): ProjectFormValues {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    id: p.id,
    customer: p.customer.name,
    name: p.name,
    contactName: s(p.contactName),
    contactPhone: s(p.contactPhone),
    contactEmail: s(p.contactEmail),
    street: s(p.street),
    city: p.city,
    state: p.state,
    zip: s(p.zip),
    lat: s(p.lat),
    lng: s(p.lng),
    jobType: s(p.jobType?.name),
    scope: s(p.scope),
    estTotalHours: s(p.estTotalHours),
    estCrewSize: s(p.estCrewSize),
    earliestDate: s(maybeDay(p.earliestDate)),
    preferredDate: s(maybeDay(p.preferredDate)),
    deadline: s(maybeDay(p.deadline)),
    inspectionDate: s(maybeDay(p.inspectionDate)),
    priority: p.priority,
    weatherSensitivity: p.weatherSensitivity,
    surfaceReady: p.surfaceReady,
    customerReady: p.customerReady,
    status: p.status,
    notes: s(p.notes),
    percentComplete: s(p.percentComplete),
    actualHours: s(p.actualHours),
    remainingHoursOverride: s(p.remainingHoursOverride),
    skills: Object.fromEntries(p.requiredSkills.map((r) => [r.skillId, r.minCount])),
    equipment: Object.fromEntries(p.requiredEquipment.map((r) => [r.type, r.quantity])),
  };
}
