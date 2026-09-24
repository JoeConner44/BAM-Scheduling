import { defineConfig } from "@playwright/test";

// End-to-end tests for the §26 real-world scenarios. They run against a separate
// database (bam_test) and pin "today" to a Thursday so dates are predictable.
export const TEST_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://bam:bam@localhost:5432/bam_test?schema=public",
  BAM_TODAY: "2026-09-24",
};
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1920, height: 1200 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    // Bring the test database schema up to date, load sample data, then start the app.
    command: `npx prisma migrate deploy && npx tsx prisma/seed.ts && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...TEST_ENV, NEXT_DIST_DIR: ".next-e2e" },
  },
});
