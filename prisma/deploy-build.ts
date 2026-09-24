// `npm run vercel-build`: the hosted build. Finds the database connection (whatever the host
// named it), applies migrations, loads sample data into an empty database, then builds the app.
import { execSync } from "node:child_process";
import { resolveDatabaseEnv } from "../src/lib/db-env";

const { ok } = resolveDatabaseEnv();
if (!ok) {
  console.error(
    "\n✖ No database connected.\n" +
      "  In Vercel: open this project → Storage → Create Database → Neon (Postgres) → Connect,\n" +
      "  then Deployments → ⋯ → Redeploy. See docs/DEPLOY.md.\n",
  );
  process.exit(1);
}

for (const cmd of ["prisma generate", "prisma migrate deploy", "tsx prisma/seed-if-empty.ts", "next build"]) {
  console.log(`\n▶ ${cmd}`);
  execSync(`npx ${cmd}`, { stdio: "inherit", env: process.env });
}
