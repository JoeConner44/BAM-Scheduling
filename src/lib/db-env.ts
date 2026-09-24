// Hosting providers name the Postgres connection differently (DATABASE_URL, POSTGRES_URL,
// STORAGE_URL, or a custom prefix picked when connecting Neon in Vercel). Prisma expects
// DATABASE_URL and DATABASE_URL_UNPOOLED, so fill those in from whatever is present.

const POOLED = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "STORAGE_URL"];
const DIRECT = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "STORAGE_URL_UNPOOLED", "DATABASE_URL_NON_POOLING"];

const isPostgres = (v: string | undefined): v is string => !!v && /^postgres(ql)?:\/\//.test(v);

export function resolveDatabaseEnv(env: Record<string, string | undefined> = process.env) {
  const pick = (names: string[]) => names.map((n) => env[n]).find(isPostgres);
  // Any other "<PREFIX>_URL" / "<PREFIX>_URL_UNPOOLED" pair holding a Postgres URL.
  const keys = Object.keys(env).sort();
  const anyPooled = keys.filter((k) => /_URL$/.test(k)).map((k) => env[k]).find(isPostgres);
  const anyDirect = keys.filter((k) => /_URL_(UNPOOLED|NON_POOLING)$/.test(k)).map((k) => env[k]).find(isPostgres);

  const pooled = pick(POOLED) ?? anyPooled;
  const direct = pick(DIRECT) ?? anyDirect ?? pooled;
  if (pooled && !isPostgres(env.DATABASE_URL)) env.DATABASE_URL = pooled;
  if (direct && !isPostgres(env.DATABASE_URL_UNPOOLED)) env.DATABASE_URL_UNPOOLED = direct;
  return { ok: !!pooled, pooled, direct };
}
