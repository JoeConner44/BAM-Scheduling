"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const OFFICE_LINKS = [
  { href: "/", label: "Inbox", icon: "📥" },
  { href: "/board", label: "Schedule", icon: "📅" },
  { href: "/todo", label: "Jobs", icon: "🗂️" },
  { href: "/employees", label: "People", icon: "👷" },
  { href: "/equipment", label: "Equipment", icon: "🚚" },
  { href: "/weather", label: "Weather", icon: "🌦️" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/activity", label: "Activity", icon: "🕘" },
];

const ESTIMATOR_LINKS = [{ href: "/jobs/new", label: "Accept a job", icon: "✅" }];

/** Everyone sees only what their job needs. */
export function NavLinks({ role }: { role: string }) {
  const pathname = usePathname();
  const LINKS = role === "ESTIMATOR" ? ESTIMATOR_LINKS : OFFICE_LINKS.filter((l) => l.href !== "/activity" || role === "OWNER");
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium",
              active ? "bg-white text-slate-900" : "text-slate-300 hover:bg-slate-800 hover:text-white",
            )}
          >
            <span>{l.icon}</span>
            <span className="hidden md:inline">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
