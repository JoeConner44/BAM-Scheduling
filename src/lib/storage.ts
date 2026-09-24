import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Photo storage. Development keeps files on local disk under ./uploads; production will
// swap this module for S3-compatible storage (Cloudflare R2) without touching callers.

const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR ?? "uploads");
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" };
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export async function savePhoto(file: File): Promise<string> {
  const ext = ALLOWED[file.type];
  if (!ext) throw new Error("Please upload a photo (JPG, PNG, WEBP or HEIC).");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("That photo is too large (15 MB max).");
  await mkdir(ROOT, { recursive: true });
  const key = `${randomUUID()}.${ext}`;
  await writeFile(path.join(/* turbopackIgnore: true */ ROOT, key), Buffer.from(await file.arrayBuffer()));
  return key;
}

export async function readPhoto(key: string): Promise<{ body: Buffer; type: string } | null> {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|heic|gif)$/.test(key)) return null;
  try {
    const body = await readFile(path.join(/* turbopackIgnore: true */ ROOT, key));
    const ext = key.split(".").pop()!;
    const type = Object.entries(ALLOWED).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
    return { body, type };
  } catch {
    return null;
  }
}
