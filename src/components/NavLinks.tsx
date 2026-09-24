"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/todo", label: "TO DO", icon: "🗂️" },
  { href: "/board", label: "Schedule", icon: "📅" },
  { href: "/employees", label: "People", icon: "👷" },
  { href: "/equipment", label: "Equipment", icon: "🚚" },
  { href: "/weather", label: "Weather", icon: "🌦️" },
  { href: "/activity", label: "Activity", icon: "🕘" },
];

export function NavLinks() {
  const pathname = usePathname();
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
