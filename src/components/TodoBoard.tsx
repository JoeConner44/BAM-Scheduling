"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ProjectCard } from "@/components/ProjectCard";
import type { ProjectCardData } from "@/lib/data";
import { EQUIPMENT_TYPE_LABEL, OPEN_STATUSES, PRIORITY_LABEL, PRIORITY_RANK, PROJECT_STATUS_LABEL, WEATHER_SENSITIVITY_LABEL } from "@/lib/labels";
import { daysBetween, type Day } from "@/lib/time";

const WINDOWS = [
  { value: "", label: "Any time" },
  { value: "overdue", label: "Overdue" },
  { value: "3", label: "Within 3 days" },
  { value: "7", label: "Within 7 days" },
  { value: "14", label: "Within 14 days" },
  { value: "none", label: "No date" },
];

const DURATIONS = [
  { value: "", label: "Any length" },
  { value: "0-2", label: "Up to 2 hrs" },
  { value: "2-4", label: "2–4 hrs" },
  { value: "4-8", label: "4–8 hrs" },
  { value: "8-999", label: "More than 8 hrs" },
];

const SORTS = {
  priority: "Priority",
  deadline: "Deadline",
  inspection: "Inspection",
  hours: "Hours remaining",
  city: "Location",
};

function inWindow(day: Day | null, win: string, today: Day) {
  if (!win) return true;
  if (win === "none") return !day;
  if (!day) return false;
  const d = daysBetween(today, day);
  return win === "overdue" ? d < 0 : d >= 0 && d <= Number(win);
}

/** Every project that isn't finished, as cards, with filters. Nothing disappears just because it isn't scheduled. */
export function TodoBoard({ cards, today, initial }: { cards: ProjectCardData[]; today: Day; initial: { status: string; needs: boolean } }) {
  const [f, setF] = useState({
    q: "",
    city: "",
    priority: "",
    deadline: "",
    inspection: "",
    jobType: "",
    duration: "",
    crew: "",
    equipment: "",
    readiness: "",
    weather: "",
    status: initial.status,
    schedule: initial.needs ? "needs" : "",
  });
  const [sort, setSort] = useState<keyof typeof SORTS>("priority");
  const [grouped, setGrouped] = useState(true);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const cities = useMemo(() => [...new Set(cards.map((c) => c.city))].sort(), [cards]);
  const jobTypes = useMemo(() => [...new Set(cards.map((c) => c.jobType).filter(Boolean) as string[])].sort(), [cards]);

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const list = cards.filter((c) => {
      if (q && !`${c.name} ${c.customer} ${c.city} ${c.code} ${c.address}`.toLowerCase().includes(q)) return false;
      if (f.city && c.city !== f.city) return false;
      if (f.priority && c.priority !== f.priority) return false;
      if (!inWindow(c.deadline, f.deadline, today)) return false;
      if (!inWindow(c.inspectionDate, f.inspection, today)) return false;
      if (f.jobType && c.jobType !== f.jobType) return false;
      if (f.duration) {
        const [lo, hi] = f.duration.split("-").map(Number);
        if (c.remainingHours <= lo && lo > 0) return false;
        if (c.remainingHours > hi) return false;
      }
      if (f.crew && (f.crew === "4" ? c.estCrewSize < 4 : c.estCrewSize !== Number(f.crew))) return false;
      if (f.equipment && !c.requiredEquipment.some((r) => r.type === f.equipment)) return false;
      if (f.readiness === "ready" && !(c.surfaceReady && c.customerReady)) return false;
      if (f.readiness === "not" && c.surfaceReady && c.customerReady) return false;
      if (f.weather && c.weatherSensitivity !== f.weather) return false;
      if (f.status && c.status !== f.status) return false;
      if (f.schedule === "needs" && c.unscheduledHours <= 0) return false;
      if (f.schedule === "tentative" && !c.blocks.some((b) => b.state === "TENTATIVE")) return false;
      if (f.schedule === "committed" && !c.blocks.some((b) => b.state === "COMMITTED")) return false;
      return true;
    });
    const key = (d: Day | null) => d ?? "9999-99-99";
    return list.sort((a, b) => {
      switch (sort) {
        case "deadline":
          return key(a.deadline).localeCompare(key(b.deadline));
        case "inspection":
          return key(a.inspectionDate).localeCompare(key(b.inspectionDate));
        case "hours":
          return b.remainingHours - a.remainingHours;
        case "city":
          return a.city.localeCompare(b.city);
        default:
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || key(a.deadline).localeCompare(key(b.deadline));
      }
    });
  }, [cards, f, sort, today]);

  const groups = useMemo(() => {
    if (!grouped) return [["All projects", filtered] as const];
    const m = new Map<string, ProjectCardData[]>();
    for (const c of filtered) m.set(c.city, [...(m.get(c.city) ?? []), c]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered, grouped]);

  const active = Object.entries(f).filter(([, v]) => v).length;
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">🗂️ TO DO — every open project</h1>
          <p className="text-sm text-slate-500">
            {filtered.length} of {cards.length} projects · {filtered.reduce((s, c) => s + c.unscheduledHours, 0).toFixed(1)} hrs still to schedule
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/board" className="btn-primary">
            Schedule on the board →
          </Link>
        </div>
      </div>

      <section className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs flex-1" placeholder="Search name, customer, address…" value={f.q} onChange={set("q")} />
          <label className="flex items-center gap-2 text-sm">
            Sort by
            <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}>
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by location
          </label>
          {active > 0 && (
            <button
              className="ml-auto text-sm font-semibold text-blue-700"
              onClick={() => setF(Object.fromEntries(Object.keys(f).map((k) => [k, ""])) as typeof f)}
            >
              Clear {active} filter{active > 1 ? "s" : ""}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <FilterSelect label="Location" value={f.city} onChange={set("city")}>
            <option value="">All</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Priority" value={f.priority} onChange={set("priority")}>
            <option value="">All</option>
            {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Deadline" value={f.deadline} onChange={set("deadline")}>
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Inspection" value={f.inspection} onChange={set("inspection")}>
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Job type" value={f.jobType} onChange={set("jobType")}>
            <option value="">All</option>
            {jobTypes.map((j) => (
              <option key={j}>{j}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Hours remaining" value={f.duration} onChange={set("duration")}>
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="People needed" value={f.crew} onChange={set("crew")}>
            <option value="">Any</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4+</option>
          </FilterSelect>
          <FilterSelect label="Equipment needed" value={f.equipment} onChange={set("equipment")}>
            <option value="">Any</option>
            {Object.entries(EQUIPMENT_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Readiness" value={f.readiness} onChange={set("readiness")}>
            <option value="">Any</option>
            <option value="ready">Ready</option>
            <option value="not">Not ready</option>
          </FilterSelect>
          <FilterSelect label="Weather sensitivity" value={f.weather} onChange={set("weather")}>
            <option value="">Any</option>
            {Object.entries(WEATHER_SENSITIVITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={f.status} onChange={set("status")}>
            <option value="">Any</option>
            {OPEN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="On the schedule?" value={f.schedule} onChange={set("schedule")}>
            <option value="">Any</option>
            <option value="needs">Needs scheduling</option>
            <option value="tentative">Tentative</option>
            <option value="committed">Committed</option>
          </FilterSelect>
        </div>
      </section>

      {groups.map(([title, list]) => (
        <section key={title}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
            {grouped && "📍"} {title}
            <span className="rounded-full bg-slate-200 px-2 text-xs">{list.length}</span>
            {grouped && (
              <span className="text-xs font-normal normal-case text-slate-500">
                · {list.reduce((s, c) => s + c.unscheduledHours, 0).toFixed(1)} hrs to schedule
              </span>
            )}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((c) => (
              <Link key={c.id} href={`/projects/${c.id}`} className="block transition hover:-translate-y-0.5 hover:shadow-md">
                <ProjectCard card={c} today={today} />
              </Link>
            ))}
          </div>
        </section>
      ))}
      {!filtered.length && <p className="card p-6 text-center text-slate-500">No projects match these filters.</p>}
    </main>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <select className={clsx("input", value && "border-blue-500 bg-blue-50")} value={value} onChange={onChange}>
        {children}
      </select>
    </label>
  );
}
