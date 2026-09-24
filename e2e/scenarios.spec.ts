// The first real-world test (spec §26), run against the sample data in prisma/seed.ts.
// Today is pinned to Thu 2026-09-24.
import { expect, test } from "@playwright/test";
import { D0, D1, D2, D4, block, drag, expectNoDialog, jobsCell, login, personCell, reseed, unitCell, waitForSaved } from "./helpers";

test.beforeEach(async ({ page }) => {
  reseed();
  await login(page, "Pat Owner");
});

test("moving a project to another day", async ({ page }) => {
  await page.goto("/board");
  await drag(page, block(jobsCell(page, D0), "Chick-fil-A — Athens"), jobsCell(page, D4));
  await waitForSaved(page);
  await expectNoDialog(page);
  await expect(block(jobsCell(page, D4), "Chick-fil-A — Athens")).toBeVisible();
  await expect(block(jobsCell(page, D0), "Chick-fil-A — Athens")).toHaveCount(0);
  // People and equipment move with it.
  await expect(personCell(page, "David", D4)).toContainText("Chick-fil-A");
  await expect(unitCell(page, "Striping Truck #2", D4)).toContainText("Chick-fil-A");

  await page.goto("/activity");
  await expect(page.getByText("Moved Chick-fil-A — Athens from Thu 9/24")).toBeVisible();
});

test("assigning an employee by dropping the job on them", async ({ page }) => {
  await page.goto("/board");
  await drag(page, block(jobsCell(page, D0), "Publix — Athens"), personCell(page, "Luis", D0));
  await waitForSaved(page);
  await expectNoDialog(page);
  await expect(personCell(page, "Luis", D0)).toContainText("Publix");
});

test("employee conflict: cancel, then override with a reason", async ({ page }) => {
  await page.goto("/board");
  const quiktrip = block(jobsCell(page, D2), "QuikTrip — Lawrenceville");

  await drag(page, quiktrip, personCell(page, "Jason", D2));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("EMPLOYEE CONFLICT");
  await expect(dialog).toContainText("Jason is already assigned to Maple Creek Middle School — Lawrenceville, 7:00 AM–3:00 PM");
  await expect(dialog).toContainText("This assignment: QuikTrip — Lawrenceville, 1:00 PM–4:00 PM");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expectNoDialog(page);
  await expect(personCell(page, "Jason", D2)).not.toContainText("QuikTrip");

  await drag(page, quiktrip, personCell(page, "Jason", D2));
  await dialog.getByRole("button", { name: "Customer deadline" }).click();
  await dialog.getByRole("button", { name: "Assign anyway" }).click();
  await waitForSaved(page);
  await expect(personCell(page, "Jason", D2)).toContainText("⚠️");
  await expect(personCell(page, "Jason", D2)).toContainText("QuikTrip");

  await page.goto("/activity?filter=overrides");
  await expect(page.getByText(/Assigned Jason to QuikTrip — Lawrenceville/)).toBeVisible();
  await expect(page.getByText("Customer deadline")).toBeVisible();
});

test("equipment conflict is never created silently", async ({ page }) => {
  await page.goto("/board");
  await drag(page, block(jobsCell(page, D1), "Home Depot — Winder"), unitCell(page, "Striping Truck #2", D1));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("EQUIPMENT CONFLICT");
  await expect(dialog).toContainText("Striping Truck #2 is already assigned to");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(unitCell(page, "Striping Truck #2", D1)).not.toContainText("Home Depot");
});

test("moving a project after a conflict clears the conflict", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#conflicts")).toContainText("Striping Truck #1 is already assigned to");

  await page.goto("/board");
  await expect(unitCell(page, "Striping Truck #1", D2)).toContainText("⚠️");
  await drag(page, block(jobsCell(page, D2), "QuikTrip — Lawrenceville"), jobsCell(page, D4));
  await waitForSaved(page);
  await expectNoDialog(page);
  await expect(unitCell(page, "Striping Truck #1", D2)).not.toContainText("⚠️");

  await page.goto("/");
  await expect(page.locator("#conflicts")).toContainText("No conflicts in the next two weeks");
});

test("marking someone off flags their jobs", async ({ page }) => {
  await page.goto("/employees");
  await page.getByRole("link", { name: /^Jo\s*John/ }).click();
  await page.locator('select[name="type"]').selectOption("SICK");
  await page.getByRole("button", { name: "Mark off" }).click();
  await expect(page.getByText("Saved. This affects 2 scheduled job(s):")).toBeVisible();
  await expect(page.getByText(/Kroger — Athens, Thu 9\/24/)).toBeVisible();

  await page.goto("/board");
  await expect(personCell(page, "John", D0)).toContainText("sick");
  await expect(personCell(page, "John", D0).getByText("⚠️")).toHaveCount(2);

  await page.goto("/");
  await expect(page.locator("#risk")).toContainText("Workforce problem: John");
});

test("field crew completes only part of a project", async ({ page }) => {
  await login(page, "John");
  await expect(page).toHaveURL(/\/field/);
  await page.getByRole("button", { name: "▶ START JOB" }).click();
  await expect(page.getByText("● Working")).toBeVisible();

  await page.getByRole("button", { name: "✅ MARK COMPLETE" }).click();
  await page.getByRole("button", { name: "⏸ No, some work is left" }).click();
  await page.locator('input[name="percentComplete"]').fill("60");
  await page.locator('input[name="hoursWorked"]').fill("3");
  await page.locator('input[name="remainingHours"]').fill("2");
  await page.getByRole("button", { name: "Save partial" }).click();
  await expect(page.getByText("Saved. The rest goes back on the TO DO list.")).toBeVisible();

  await login(page, "Dana Dispatcher");
  await page.goto("/todo");
  const card = page.locator("a", { hasText: "Kroger" });
  await expect(card).toContainText("60% complete");
  await expect(card).toContainText("2 hrs remaining");
  await expect(card).toContainText("Partially complete");
});

test("adding an urgent project and forcing it onto a full day", async ({ page }) => {
  await page.goto("/projects/new");
  await page.locator('input[name="customer"]').fill("Walmart Monroe");
  await page.locator('input[name="name"]').fill("Walmart Supercenter");
  await page.locator('input[name="city"]').fill("Monroe");
  await page.locator('input[name="estTotalHours"]').fill("3");
  await page.locator('input[name="deadline"]').fill(D1);
  await page.locator('select[name="priority"]').selectOption("CRITICAL");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByText("Critical priority", { exact: true })).toBeVisible();

  // New city shows up as a location automatically.
  await page.goto("/todo");
  await expect(page.getByRole("heading", { name: /Monroe/ })).toBeVisible();

  // Drop it on John at 9:00 today, while he's on Kroger.
  await page.goto(`/board?view=day&date=${D0}`);
  const card = page.locator('[data-drag="project"][data-label="Walmart Supercenter — Monroe"]');
  const row = personCell(page, "John", D0);
  await drag(page, card, row, { x: (9 * 60 - 6 * 60) * 1.6 + 4, y: 20 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("EMPLOYEE CONFLICT");
  await expect(dialog).toContainText("John is already assigned to Kroger — Athens");
  await dialog.getByRole("button", { name: "Urgent customer call" }).click();
  await dialog.getByRole("button", { name: "Schedule anyway" }).click();
  await expect(page.getByText("Change saved. Override recorded.")).toBeVisible();
  await expect(row).toContainText("Walmart Supercenter");

  await page.goto("/activity?filter=overrides");
  await expect(page.getByText(/Scheduled Walmart Supercenter — Monroe on Thu 9\/24 9:00 AM/)).toBeVisible();
  await expect(page.getByText("Urgent customer call")).toBeVisible();
});

test("changing the schedule because of weather", async ({ page }) => {
  await page.goto("/weather");
  const input = page.getByLabel("Rain chance Athens Fri 9/25");
  await input.fill("80");
  await input.locator("xpath=ancestor::form").getByRole("button", { name: "Save" }).click();
  await expect(input).toHaveValue("80");

  await page.goto("/");
  const weather = page.locator("#weather");
  await expect(weather).toContainText("Oconee Hills Baptist Church — Athens · Fri 9/25");

  // Nothing moved by itself; the dispatcher decides to move the church lot to Wednesday.
  await page.goto("/board");
  await expect(page.getByText("80% Athens")).toBeVisible();
  await drag(page, block(jobsCell(page, D1), "Oconee Hills Baptist Church — Athens"), jobsCell(page, D4));
  await waitForSaved(page);
  await expectNoDialog(page);
  await expect(block(jobsCell(page, D4), "Oconee Hills Baptist Church — Athens")).toBeVisible();

  await page.goto("/");
  await expect(weather).not.toContainText("Oconee Hills Baptist Church — Athens · Fri 9/25");
});

test("field employees cannot see the office schedule", async ({ page }) => {
  await login(page, "Chris");
  await page.goto("/board");
  await expect(page).toHaveURL(/\/field/);
});
