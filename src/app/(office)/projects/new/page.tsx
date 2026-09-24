import Link from "next/link";
import { ProjectForm } from "@/components/ProjectForm";
import { OFFICE, requireUser } from "@/lib/auth";
import { emptyProjectValues, projectFormLookups } from "@/lib/projectForm";

export const metadata = { title: "New project · BAM Scheduling" };

export default async function NewProjectPage() {
  await requireUser(OFFICE);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <Link href="/todo" className="text-sm font-semibold text-blue-700">
        ← TO DO
      </Link>
      <h1 className="text-2xl font-bold">New project</h1>
      <ProjectForm values={emptyProjectValues()} {...await projectFormLookups()} />
    </main>
  );
}
