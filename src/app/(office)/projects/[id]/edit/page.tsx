import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/ProjectForm";
import { OFFICE, requireUser } from "@/lib/auth";
import { projectInclude } from "@/lib/data";
import { db } from "@/lib/db";
import { projectFormLookups, projectValues } from "@/lib/projectForm";

export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  await requireUser(OFFICE);
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id }, include: projectInclude });
  if (!project) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-3 sm:p-6">
      <Link href={`/projects/${id}`} className="text-sm font-semibold text-blue-700">
        ← Back to project
      </Link>
      <h1 className="text-2xl font-bold">
        Edit {project.name} — {project.city}
      </h1>
      <ProjectForm values={projectValues(project)} {...await projectFormLookups()} />
    </main>
  );
}
