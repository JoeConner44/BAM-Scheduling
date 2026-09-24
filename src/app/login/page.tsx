import { signInAs } from "@/app/actions/session";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const users = await db.user.findMany({ where: { active: true }, include: { employee: true }, orderBy: [{ role: "asc" }, { name: "asc" }] });
  const office = users.filter((u) => u.role !== "FIELD");
  const field = users.filter((u) => u.role === "FIELD");

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <div className="text-4xl">🛣️</div>
        <h1 className="mt-2 text-2xl font-bold">BAM Scheduling</h1>
        <p className="text-sm text-slate-500">Prototype sign-in: pick who you are.</p>
      </div>

      <section className="card p-4">
        <h2 className="label">Office</h2>
        <div className="grid gap-2">
          {office.map((u) => (
            <form key={u.id} action={signInAs}>
              <input type="hidden" name="userId" value={u.id} />
              <button className="btn-secondary w-full justify-between py-3 text-base">
                <span>{u.name}</span>
                <span className="chip bg-slate-100 text-slate-700">{ROLE_LABEL[u.role]}</span>
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="label">Field crew (phone view)</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {field.map((u) => (
            <form key={u.id} action={signInAs}>
              <input type="hidden" name="userId" value={u.id} />
              <button className="btn-secondary w-full py-3 text-base">
                <span className="h-3 w-3 rounded-full" style={{ background: u.employee?.color }} />
                {u.name}
              </button>
            </form>
          ))}
        </div>
      </section>

      <p className="text-center text-xs text-slate-400">Passwords (office) and phone + PIN (field) replace this picker in phase 2.</p>
    </main>
  );
}
