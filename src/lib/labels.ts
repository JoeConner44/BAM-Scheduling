// Display names and colors for enum values. Kept in one place so every screen matches.

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  TO_DO: "To do",
  READY: "Ready",
  TENTATIVE: "Tentative",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  DELAYED: "Delayed",
  PARTIALLY_COMPLETE: "Partially complete",
  COMPLETE: "Complete",
  WAITING_ON_CUSTOMER: "Waiting on customer",
  WAITING_ON_CONSTRUCTION: "Waiting on construction",
  WEATHER_DELAY: "Weather delay",
  CANCELLED: "Cancelled",
};

export const PROJECT_STATUS_COLOR: Record<string, string> = {
  TO_DO: "bg-slate-100 text-slate-700",
  READY: "bg-emerald-100 text-emerald-800",
  TENTATIVE: "bg-sky-100 text-sky-800",
  SCHEDULED: "bg-blue-600 text-white",
  IN_PROGRESS: "bg-violet-600 text-white",
  DELAYED: "bg-orange-100 text-orange-800",
  PARTIALLY_COMPLETE: "bg-amber-100 text-amber-800",
  COMPLETE: "bg-green-600 text-white",
  WAITING_ON_CUSTOMER: "bg-yellow-100 text-yellow-800",
  WAITING_ON_CONSTRUCTION: "bg-yellow-100 text-yellow-800",
  WEATHER_DELAY: "bg-cyan-100 text-cyan-800",
  CANCELLED: "bg-slate-200 text-slate-500 line-through",
};

/** Statuses that keep a project on the TO DO board. */
export const OPEN_STATUSES = [
  "TO_DO",
  "READY",
  "TENTATIVE",
  "SCHEDULED",
  "IN_PROGRESS",
  "DELAYED",
  "PARTIALLY_COMPLETE",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_CONSTRUCTION",
  "WEATHER_DELAY",
] as const;

export const PRIORITY_LABEL: Record<string, string> = { CRITICAL: "Critical", HIGH: "High", NORMAL: "Normal", LOW: "Low" };
export const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
export const PRIORITY_STRIPE: Record<string, string> = {
  CRITICAL: "border-l-red-600",
  HIGH: "border-l-orange-500",
  NORMAL: "border-l-blue-400",
  LOW: "border-l-slate-300",
};
export const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-100 text-orange-800",
  NORMAL: "bg-blue-50 text-blue-700",
  LOW: "bg-slate-100 text-slate-600",
};

export const WEATHER_SENSITIVITY_LABEL: Record<string, string> = { NONE: "Not weather sensitive", LOW: "Some weather sensitivity", HIGH: "Very weather sensitive" };

export const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  ASSIGNED: "Assigned",
  OFF: "Off",
  SICK: "Sick",
  VACATION: "Vacation",
  UNAVAILABLE: "Unavailable",
  PARTIAL_DAY: "Partial day",
  DELAYED: "Delayed",
};

export const EMPLOYEE_STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  ASSIGNED: "bg-blue-100 text-blue-800",
  OFF: "bg-slate-200 text-slate-700",
  SICK: "bg-red-100 text-red-800",
  VACATION: "bg-purple-100 text-purple-800",
  UNAVAILABLE: "bg-slate-200 text-slate-700",
  PARTIAL_DAY: "bg-amber-100 text-amber-800",
  DELAYED: "bg-orange-100 text-orange-800",
};

export const TIME_OFF_LABEL: Record<string, string> = { OFF: "Off", SICK: "Sick", VACATION: "Vacation", UNAVAILABLE: "Unavailable" };

export const EQUIPMENT_TYPE_LABEL: Record<string, string> = {
  STRIPING_TRUCK: "Striping truck",
  TRAILER: "Trailer",
  THERMO_MACHINE: "Thermoplastic machine",
  ARROW_BOARD: "Arrow board",
  LAYOUT: "Layout equipment",
  SPECIALTY: "Specialty equipment",
  OTHER: "Other",
};

export const EQUIPMENT_TYPE_ICON: Record<string, string> = {
  STRIPING_TRUCK: "🚚",
  TRAILER: "🛻",
  THERMO_MACHINE: "🔥",
  ARROW_BOARD: "⚠️",
  LAYOUT: "📐",
  SPECIALTY: "🧰",
  OTHER: "🔧",
};

export const EQUIPMENT_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  ASSIGNED: "Assigned",
  MAINTENANCE: "Maintenance",
  OUT_OF_SERVICE: "Out of service",
};

export const EQUIPMENT_STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  ASSIGNED: "bg-blue-100 text-blue-800",
  MAINTENANCE: "bg-amber-100 text-amber-800",
  OUT_OF_SERVICE: "bg-red-100 text-red-800",
};

export const CONDITION_REASON_LABEL: Record<string, string> = {
  CARS_NOT_MOVED: "Cars not moved",
  CONSTRUCTION_INCOMPLETE: "Construction not finished",
  SURFACE_NOT_READY: "Surface not ready",
  LAYOUT_DIFFERENT: "Layout is different",
  SCOPE_CHANGED: "Customer changed the scope",
  EXTRA_PREP: "Extra prep needed",
  LARGER_THAN_ESTIMATED: "Job is bigger than estimated",
  ACCESS_BLOCKED: "Access blocked",
  EQUIPMENT_PROBLEM: "Equipment problem",
  WEATHER_CHANGED: "Weather changed",
  OTHER: "Something else",
};

export const CONDITION_REASON_ICON: Record<string, string> = {
  CARS_NOT_MOVED: "🚗",
  CONSTRUCTION_INCOMPLETE: "🏗️",
  SURFACE_NOT_READY: "🧱",
  LAYOUT_DIFFERENT: "📐",
  SCOPE_CHANGED: "📝",
  EXTRA_PREP: "🧹",
  LARGER_THAN_ESTIMATED: "📏",
  ACCESS_BLOCKED: "⛔",
  EQUIPMENT_PROBLEM: "🔧",
  WEATHER_CHANGED: "🌧️",
  OTHER: "❓",
};

export const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", DISPATCHER: "Dispatcher", FIELD: "Field" };

export const OVERRIDE_REASONS = ["Customer deadline", "Inspection coming up", "Urgent customer call", "Weather", "Another job delayed", "Equipment change"];

export function enumOptions(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
