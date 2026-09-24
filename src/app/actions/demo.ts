"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, clearSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadSampleData } from "../../../prisma/sample-data";

export const demoResetAllowed = async () => process.env.ALLOW_DEMO_RESET !== "false";

/** Owner only: wipe everything and reload the sample data with dates relative to today. */
export async function resetSampleData() {
  await authorize(["OWNER"]);
  if (!(await demoResetAllowed())) throw new Error("Resetting is turned off on this site.");
  await loadSampleData(db);
  await clearSession(); // every user is recreated, so everyone signs in again
  revalidatePath("/", "layout");
  redirect("/login");
}
