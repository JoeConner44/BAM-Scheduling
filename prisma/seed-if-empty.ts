// Runs on every deploy: loads the sample data only if the database has no users yet,
// so a fresh hosted database is ready to click through and real data is never touched.
import { PrismaClient } from "@prisma/client";
import { loadSampleData } from "./sample-data";

const db = new PrismaClient();

async function run() {
  const users = await db.user.count();
  if (users > 0) {
    console.log(`Database already has ${users} users — leaving data alone.`);
    return;
  }
  console.log(await loadSampleData(db));
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
