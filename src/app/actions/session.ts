"use server";

import { redirect } from "next/navigation";
import { clearSession, setSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function signInAs(formData: FormData) {
  const id = String(formData.get("userId") ?? "");
  const user = await db.user.findUnique({ where: { id } });
  if (!user || !user.active) redirect("/login");
  await setSession(user.id);
  redirect(user.role === "FIELD" ? "/field" : "/");
}

export async function signOut() {
  await clearSession();
  redirect("/login");
}
