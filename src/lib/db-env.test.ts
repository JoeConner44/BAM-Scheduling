import { describe, expect, it } from "vitest";
import { resolveDatabaseEnv } from "./db-env";

const PG = "postgresql://u:p@host/db";
const PG_DIRECT = "postgresql://u:p@direct/db";

describe("resolveDatabaseEnv", () => {
  it("uses Neon's custom-prefix names", () => {
    const env: Record<string, string | undefined> = { STORAGE_URL: PG, STORAGE_URL_UNPOOLED: PG_DIRECT };
    expect(resolveDatabaseEnv(env).ok).toBe(true);
    expect(env.DATABASE_URL).toBe(PG);
    expect(env.DATABASE_URL_UNPOOLED).toBe(PG_DIRECT);
  });
  it("finds any <PREFIX>_URL pair", () => {
    const env: Record<string, string | undefined> = { BAM_URL: PG, BAM_URL_UNPOOLED: PG_DIRECT, NEXT_PUBLIC_SITE_URL: "https://x" };
    resolveDatabaseEnv(env);
    expect(env.DATABASE_URL).toBe(PG);
    expect(env.DATABASE_URL_UNPOOLED).toBe(PG_DIRECT);
  });
  it("falls back to the pooled URL for migrations and leaves explicit settings alone", () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: PG };
    resolveDatabaseEnv(env);
    expect(env.DATABASE_URL_UNPOOLED).toBe(PG);
  });
  it("reports when nothing is connected", () => {
    expect(resolveDatabaseEnv({ HOME_URL: "https://example.com" }).ok).toBe(false);
  });
});
