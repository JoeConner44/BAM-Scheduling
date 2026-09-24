// First step of the hosted build: fail early with a plain-English message if no database is connected.
const missing = ["DATABASE_URL", "DATABASE_URL_UNPOOLED"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\n✖ No database connected (missing ${missing.join(", ")}).\n` +
      "  In Vercel: open this project → Storage → Create Database → Neon (Postgres) → Connect,\n" +
      "  then Deployments → ⋯ → Redeploy. See docs/DEPLOY.md.\n",
  );
  process.exit(1);
}
