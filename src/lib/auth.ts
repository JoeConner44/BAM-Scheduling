import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "./db";

// Prototype sign-in: the user picks who they are on /login and we store a signed user id
// in a cookie. Phase 2 replaces the picker with password (office) and phone + PIN (field).

const COOKIE = "bam_session";
const SECRET = process.env.AUTH_SECRET ?? "dev-only-secret-change-me";

function sign(value: string) {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

export async function setSession(userId: string) {
  (await cookies()).set(COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  if (!id || !mac) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const user = await db.user.findUnique({ where: { id }, include: { employee: true } });
  return user?.active ? user : null;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/** For pages: redirect to /login (or the field screen) when the role isn't allowed. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(user.role === "FIELD" ? "/field" : "/");
  return user;
}

export const OFFICE: Role[] = ["OWNER", "DISPATCHER"];

export class NotAllowedError extends Error {}

/** For server actions: throw instead of redirecting. */
export async function authorize(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new NotAllowedError("Please sign in again.");
  if (roles && !roles.includes(user.role)) throw new NotAllowedError("You don't have permission to do that.");
  return user;
}
