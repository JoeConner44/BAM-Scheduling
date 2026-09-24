// `npm run db:seed` — replace everything with the fictional sample data (spec §26).
import { PrismaClient } from "@prisma/client";
import { loadSampleData } from "./sample-data";

const db = new PrismaClient();

loadSampleData(db)
  .then((msg) => console.log(msg))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
