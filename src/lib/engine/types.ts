// Plain data the conflict engine works on. The engine never touches the database,
// so the same code runs in the browser (instant feedback) and on the server (final check).

import type { Day } from "../time";

/** conflict = red (double-booking, time off, past deadline) · warning = yellow · info = not fully staffed yet */
export type Severity = "conflict" | "warning" | "info";

export type FindingCode =
  | "EMPLOYEE_OVERLAP"
  | "EQUIPMENT_OVERLAP"
  | "EMPLOYEE_TIME_OFF"
  | "EMPLOYEE_INACTIVE"
  | "EMPLOYEE_OUTSIDE_HOURS"
  | "EMPLOYEE_OVERLOADED"
  | "EQUIPMENT_UNAVAILABLE"
  | "TRAVEL"
  | "PAST_DEADLINE"
  | "PAST_INSPECTION"
  | "INSPECTION_DAY"
  | "BEFORE_EARLIEST"
  | "NOT_READY"
  | "WEATHER"
  | "UNDERSTAFFED"
  | "MISSING_SKILL"
  | "MISSING_EQUIPMENT";

export interface Finding {
  /** Stable identity, used to tell which findings a change introduced. */
  key: string;
  /** Findings that describe the same problem from both sides share this. */
  dedupeKey: string;
  code: FindingCode;
  severity: Severity;
  title: string;
  message: string;
  /** Short name of what's affected, e.g. "John", "Truck #2", "Deadline Wed 9/30". */
  subject: string;
  blockId: string;
  employeeId?: string;
  equipmentId?: string;
  otherBlockId?: string;
}

export interface EBlock {
  id: string;
  projectId: string;
  day: Day;
  startMin: number;
  endMin: number;
  state: "TENTATIVE" | "COMMITTED";
  progress: "PLANNED" | "ACTIVE" | "PAUSED" | "DONE" | "CANNOT_PROCEED";
  employeeIds: string[];
  equipmentIds: string[];
}

export interface EProject {
  id: string;
  /** "Kroger — Athens" */
  label: string;
  city: string;
  locationId: string | null;
  lat: number | null;
  lng: number | null;
  deadline: Day | null;
  inspectionDate: Day | null;
  earliestDate: Day | null;
  surfaceReady: boolean;
  customerReady: boolean;
  status: string;
  weatherSensitivity: "NONE" | "LOW" | "HIGH";
  estCrewSize: number;
  requiredSkills: { skillId: string; skillName: string; minCount: number }[];
  requiredEquipment: { type: string; typeLabel: string; quantity: number }[];
}

export interface ETimeOff {
  startDay: Day;
  endDay: Day;
  startMin: number | null;
  endMin: number | null;
  type: string;
}

export interface EEmployee {
  id: string;
  name: string;
  active: boolean;
  normalStartMin: number;
  normalEndMin: number;
  workDays: number[];
  skillIds: string[];
  timeOff: ETimeOff[];
}

export interface EEquipment {
  id: string;
  name: string;
  type: string;
  status: "AVAILABLE" | "ASSIGNED" | "MAINTENANCE" | "OUT_OF_SERVICE";
  active: boolean;
  maintenanceNote: string | null;
  downtime: { startDay: Day; endDay: Day; reason: string | null }[];
}

export interface EForecast {
  locationId: string;
  day: Day;
  precipChance: number;
  summary: string | null;
}

export interface EngineSettings {
  today: Day;
  /** Warn when one person is booked more than this many minutes in a day. */
  maxDayMinutes: number;
  /** Rain chance (%) that triggers a weather warning, by project sensitivity. */
  weatherThreshold: { LOW: number; HIGH: number };
  travel: { averageMph: number; roadFactor: number; minimumMinutes: number };
}

export interface Snapshot {
  blocks: EBlock[];
  projects: Record<string, EProject>;
  employees: Record<string, EEmployee>;
  equipment: Record<string, EEquipment>;
  forecasts: EForecast[];
  settings: EngineSettings;
}
