import { execSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import { TEST_ENV } from "../playwright.config";

export const D0 = "2026-09-24"; // Thu (today)
export const D1 = "2026-09-25"; // Fri
export const D2 = "2026-09-28"; // Mon
export const D3 = "2026-09-29"; // Tue
export const D4 = "2026-09-30"; // Wed

export function reseed() {
  execSync("npx tsx prisma/seed.ts", { env: { ...process.env, ...TEST_ENV }, stdio: "pipe" });
}

export async function login(page: Page, who: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`^${who}\\b`) }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export const jobsCell = (page: Page, day: string) => page.locator(`[data-drop="day"][data-day="${day}"]`);
export const personCell = (page: Page, name: string, day: string) => page.locator(`[data-drop="employee"][data-day="${day}"][data-label="${name}"]`);
export const unitCell = (page: Page, name: string, day: string) => page.locator(`[data-drop="equipment"][data-day="${day}"][data-label="${name}"]`);
export const block = (scope: Locator, label: string) => scope.locator(`[data-drag="block"][data-label="${label}"]`);

/** Drag with real mouse events (dnd-kit needs movement past its activation distance). */
export async function drag(page: Page, from: Locator, to: Locator, target?: { x: number; y: number }) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const tx = b.x + (target?.x ?? b.width / 2);
  const ty = b.y + (target?.y ?? Math.min(b.height / 2, 20));
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(a.height / 2, 12));
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 12, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.mouse.up();
}

export async function expectNoDialog(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export async function waitForSaved(page: Page) {
  await expect(page.getByText("Saving…")).toHaveCount(0);
}
