import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "./db";

// Prototype sign-in: the user picks who they are on /login and we store a signed user id
// in a cookie. Phase 2 replaces the picker with password (office) and phone + PIN (field).

const COOKIE = "bam_session";
// AUTH_SECRET if set; otherwise derived from the database URL, which is always present and
// always secret, so a fresh deploy is safe without extra setup.
const SECRET = process.env.AUTH_SECRET || createHash("sha256").update(`bam-session:${process.env.DATABASE_URL ?? "dev"}`).digest("hex");

/** Optional shared access code for a public demo link (SITE_PASSWORD). */
export const siteCodeRequired = () => !!process.env.SITE_PASSWORD;

const SITE_COOKIE = "bam_site";
const siteToken = () => sign(`site:${process.env.SITE_PASSWORD ?? ""}`);

/** True when no code is configured, or this browser already entered it. */
export async function siteCodeRemembered() {
  if (!siteCodeRequired()) return true;
  return (await cookies()).get(SITE_COOKIE)?.value === siteToken();
}

export async function rememberSiteCode() {
  if (!siteCodeRequired()) return;
  (await cookies()).set(SITE_COOKIE, siteToken(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 });
}

export function siteCodeMatches(given: string) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return true;
  const a = createHash("sha256").update(given.trim()).digest();
  const b = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(a, b);
}

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
