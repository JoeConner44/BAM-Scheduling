import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";

// Photo storage. Photos are kept in the database so the app works on hosts without a
// writable disk (Vercel). Swap this module for S3-compatible storage (Cloudflare R2)
// when volume grows; callers only see the key.

const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" };
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const DOCUMENTS: Record<string, string> = { "application/pdf": "pdf" };

export async function savePhoto(file: File): Promise<string> {
  if (!ALLOWED[file.type]) throw new Error("Please upload a photo (JPG, PNG, WEBP or HEIC).");
  return saveFile(file);
}

/** Store a photo or a PDF (work orders). */
export async function saveFile(file: File): Promise<string> {
  const ext = ALLOWED[file.type] ?? DOCUMENTS[file.type];
  if (!ext) throw new Error("Unsupported file type.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("That photo is too large (15 MB max).");
  const key = `${randomUUID()}.${ext}`;
  await db.storedFile.create({ data: { key, contentType: file.type, size: file.size, data: Buffer.from(await file.arrayBuffer()) } });
  return key;
}

export async function readPhoto(key: string): Promise<{ body: Uint8Array; type: string } | null> {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|heic|gif|pdf)$/.test(key)) return null;
  const file = await db.storedFile.findUnique({ where: { key } });
  return file ? { body: new Uint8Array(file.data), type: file.contentType } : null;
}
