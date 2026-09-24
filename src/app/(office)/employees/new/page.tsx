import Link from "next/link";
import { EmployeeForm } from "@/components/EmployeeForms";
import { OFFICE, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function NewEmployeePage() {
  await requireUser(OFFICE);
  const skills = await db.skill.findMany({ orderBy: { name: "asc" } });
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <Link href="/employees" className="text-sm font-semibold text-blue-700">
        ← People
      </Link>
      <h1 className="text-2xl font-bold">Add a person</h1>
      <EmployeeForm
        skills={skills}
        values={{ name: "", phone: "", position: "", color: "#0ea5e9", normalStart: "07:00", normalEnd: "17:30", workDays: [1, 2, 3, 4, 5], status: "AVAILABLE", active: true, skills: {} }}
      />
    </main>
  );
}
