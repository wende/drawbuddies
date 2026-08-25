import { expect, Page, test } from "@playwright/test";

type Point = [number, number];

async function openMobileCanvas(page: Page) {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "load" });
  await page.waitForSelector("#canvas");
}

async function playerPoint(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:player:v1") || "{}";
    return JSON.parse(raw) as { x?: number; y?: number };
  });
}

async function storedShapeCount(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:v2") || "[]";
    return (JSON.parse(raw) as unknown[]).length;
  });
}

async function drawStroke(page: Page, points: Point[]) {
  const [first, ...rest] = points;
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(point[0], point[1], { steps: 8 });
  }
  await page.mouse.up();
}

test.describe("mobile tap-to-move", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test("shows a move/draw switch and walks to a tap in Move mode", async ({ page }) => {
    await openMobileCanvas(page);

    const modeSwitch = page.locator("#modeSwitch");
    await expect(modeSwitch).toBeVisible();
    await expect(page.locator("#moveHint .move-hint-mobile")).toBeVisible();

    const start = await playerPoint(page);
    expect(start.x).toBeGreaterThan(0);

    await page.locator("#modeSwitch [data-input-mode='move']").click();
    await expect(page.locator("#modeSwitch [data-input-mode='move']")).toHaveClass(/active/);
    await expect(page.locator("body")).toHaveClass(/player-move-mode/);

    await page.mouse.click(310, 360);

    await expect
      .poll(async () => (await playerPoint(page)).x ?? 0)
      .toBeGreaterThan((start.x ?? 0) + 40);

    await expect.poll(async () => storedShapeCount(page)).toBe(0);
  });

  test("Draw mode still sketches and does not walk the player", async ({ page }) => {
    await openMobileCanvas(page);

    await expect(page.locator("#modeSwitch [data-input-mode='draw']")).toHaveClass(/active/);

    const start = await playerPoint(page);

    await drawStroke(page, [
      [80, 180],
      [240, 180],
    ]);

    await expect.poll(async () => storedShapeCount(page)).toBe(1);

    const after = await playerPoint(page);
    expect(Math.abs((after.x ?? 0) - (start.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((after.y ?? 0) - (start.y ?? 0))).toBeLessThan(2);
  });

  test("switching back to Draw lets the current tool draw again", async ({ page }) => {
    await openMobileCanvas(page);

    await page.locator("#modeSwitch [data-input-mode='move']").click();
    await page.mouse.click(300, 300);
    await page.locator("#modeSwitch [data-input-mode='draw']").click();
    await expect(page.locator("body")).not.toHaveClass(/player-move-mode/);

    await drawStroke(page, [
      [70, 160],
      [220, 160],
    ]);

    await expect.poll(async () => storedShapeCount(page)).toBe(1);
  });
});

test.describe("desktop chrome", () => {
  test.use({
    viewport: { width: 900, height: 700 },
  });

  test("hides the move/draw switch on a desktop viewport", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("#modeSwitch")).toBeHidden();
    await expect(page.locator("#moveHint .move-hint-desktop")).toBeVisible();
  });
});
