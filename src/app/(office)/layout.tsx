import Link from "next/link";
import { signOut } from "@/app/actions/session";
import { NavLinks } from "@/components/NavLinks";
import { OFFICE, requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser(OFFICE);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 bg-slate-900 text-white shadow">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-bold">
            <span className="text-xl">🛣️</span>
            <span className="hidden sm:inline">BAM Scheduling</span>
          </Link>
          <NavLinks />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link href="/projects/new" className="btn bg-emerald-500 text-slate-950 hover:bg-emerald-400">
              + <span className="hidden md:inline">New project</span>
            </Link>
            <div className="hidden text-right text-xs leading-tight lg:block">
              <div className="font-semibold">{user.name}</div>
              <div className="text-slate-400">{ROLE_LABEL[user.role]}</div>
            </div>
            <Link href="/login" className="btn px-2 text-slate-300 hover:bg-slate-800" title="Switch user">
              ⇄
            </Link>
            <form action={signOut}>
              <button className="btn px-2 text-slate-300 hover:bg-slate-800" title="Sign out">
                ⏻
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
