import "server-only";
import type { Prisma, ProjectStatus } from "@prisma/client";

/** Statuses the scheduler manages automatically. Anything else (in progress, delayed,
 * waiting on customer, …) was set by a person or the field crew and is left alone. */
const AUTO_STATUSES: ProjectStatus[] = ["TO_DO", "READY", "TENTATIVE", "SCHEDULED"];

/** Keep TO DO / READY / TENTATIVE / SCHEDULED in step with the project's open blocks. */
export async function syncProjectStatus(tx: Prisma.TransactionClient, projectId: string, actorId: string | null) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    include: { blocks: { where: { progress: { not: "DONE" } } } },
  });
  if (!project || !AUTO_STATUSES.includes(project.status)) return;
  const next: ProjectStatus = project.blocks.some((b) => b.state === "COMMITTED")
    ? "SCHEDULED"
    : project.blocks.length
      ? "TENTATIVE"
      : project.surfaceReady && project.customerReady
        ? "READY"
        : "TO_DO";
  if (next !== project.status) await setProjectStatus(tx, projectId, project.status, next, actorId, "Schedule changed");
}

export async function setProjectStatus(
  tx: Prisma.TransactionClient,
  projectId: string,
  from: ProjectStatus | null,
  to: ProjectStatus,
  actorId: string | null,
  reason?: string | null,
) {
  await tx.project.update({ where: { id: projectId }, data: { status: to } });
  await tx.projectStatusHistory.create({ data: { projectId, fromStatus: from, toStatus: to, changedById: actorId, reason: reason || null } });
}
