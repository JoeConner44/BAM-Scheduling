import type { ProjectCardData } from "@/lib/data";
import type { Finding } from "@/lib/engine/types";
import type { Day } from "@/lib/time";

export interface BoardBlock {
  id: string;
  projectId: string;
  name: string;
  city: string;
  locationId: string | null;
  label: string;
  priority: string;
  projectStatus: string;
  day: Day;
  startMin: number;
  endMin: number;
  state: "TENTATIVE" | "COMMITTED";
  progress: string;
  employeeIds: string[];
  equipmentIds: string[];
  estCrewSize: number;
}

export interface BoardTimeOff {
  startMin: number | null;
  endMin: number | null;
  type: string;
  note: string | null;
}

export interface BoardEmployee {
  id: string;
  name: string;
  color: string;
  position: string | null;
  skills: string[];
  active: boolean;
  workDays: number[];
  normalStartMin: number;
  normalEndMin: number;
  /** Time off by day. */
  off: Record<Day, BoardTimeOff[]>;
}

export interface BoardEquipment {
  id: string;
  name: string;
  unitCode: string;
  type: string;
  color: string;
  status: string;
  maintenanceNote: string | null;
  /** Maintenance windows by day (reason). */
  down: Record<Day, string>;
}

export interface BoardWeather {
  locationId: string;
  city: string;
  precipChance: number;
  summary: string | null;
}

export interface BoardData {
  today: Day;
  view: "week" | "day";
  anchor: Day;
  days: Day[];
  blocks: BoardBlock[];
  employees: BoardEmployee[];
  equipment: BoardEquipment[];
  todo: ProjectCardData[];
  findings: Record<string, Finding[]>;
  weather: Record<Day, BoardWeather[]>;
  cities: string[];
}
