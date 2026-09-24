"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, clearSession, setSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isLiveMode } from "@/lib/settings";
import { loadSampleData } from "../../../prisma/sample-data";
import { DEFAULT_JOB_TYPES, DEFAULT_SKILLS, wipeAllData } from "../../../prisma/wipe";

/** Sample-data tools are only offered until the company switches to real data. */
export const demoToolsAllowed = async () => process.env.ALLOW_DEMO_RESET !== "false" && !(await isLiveMode());

/** Owner only: wipe everything and reload the sample data with dates relative to today. */
export async function resetSampleData() {
  await authorize(["OWNER"]);
  if (!(await demoToolsAllowed())) throw new Error("Resetting is turned off on this site.");
  await loadSampleData(db);
  await clearSession(); // every user is recreated, so everyone signs in again
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Owner only, one time: delete all sample data and start with an empty company.
 * Keeps a starter list of skills and job types, creates the owner's own login,
 * and switches the site to live mode (which hides both sample-data buttons for good).
 */
export async function startWithRealData(form: FormData) {
  await authorize(["OWNER"]);
  if (!(await demoToolsAllowed())) throw new Error("This site is already using real data.");
  const name = String(form.get("ownerName") ?? "").trim();
  if (!name) throw new Error("Enter your name.");

  await wipeAllData(db);
  const owner = await db.$transaction(async (tx) => {
    await tx.skill.createMany({ data: DEFAULT_SKILLS.map((n) => ({ name: n })) });
    await tx.jobType.createMany({ data: DEFAULT_JOB_TYPES.map((n) => ({ name: n })) });
    const u = await tx.user.create({ data: { name, role: "OWNER" } });
    await tx.appSetting.create({ data: { key: "mode", value: "live" } });
    await tx.auditLog.create({ data: { actorId: u.id, entityType: "System", entityId: "mode", action: "GO_LIVE", summary: "Sample data removed — started using real data" } });
    return u;
  });
  await setSession(owner.id);
  revalidatePath("/", "layout");
  redirect("/employees?welcome=1");
}
