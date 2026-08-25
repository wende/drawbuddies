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

async function pressMoveToggle(page: Page, holdMs = 0) {
  const box = await page.locator("#modeSwitch").boundingBox();
  if (!box) throw new Error("Walk switch not found");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (holdMs) await page.waitForTimeout(holdMs);
  return { x, y };
}

test.describe("mobile tap-to-move", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test("shows a yin-yang walk switch and walks to a tap when it is on", async ({ page }) => {
    await openMobileCanvas(page);

    const modeSwitch = page.locator("#modeSwitch");
    await expect(modeSwitch).toBeVisible();
    await expect(modeSwitch.locator(".mode-switch-yin")).toBeVisible();
    await expect(page.locator("#moveHint .move-hint-mobile")).toBeVisible();
    await expect(page.locator('.toolbar .group[aria-label="Tools"]')).toBeHidden();

    const start = await playerPoint(page);
    expect(start.x).toBeGreaterThan(0);

    await modeSwitch.click();
    await expect(modeSwitch).toHaveClass(/active/);
    await expect(modeSwitch).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveClass(/player-move-mode/);

    await page.mouse.click(310, 360);

    await expect
      .poll(async () => (await playerPoint(page)).x ?? 0)
      .toBeGreaterThan((start.x ?? 0) + 40);

    await expect.poll(async () => storedShapeCount(page)).toBe(0);
  });

  test("Draw mode still sketches and does not walk the player", async ({ page }) => {
    await openMobileCanvas(page);

    await expect(page.locator("#modeSwitch")).not.toHaveClass(/active/);

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

  test("toggling walk off lets the current tool draw again", async ({ page }) => {
    await openMobileCanvas(page);

    await page.locator("#modeSwitch").click();
    await page.mouse.click(300, 300);
    await page.locator("#modeSwitch").click();
    await expect(page.locator("body")).not.toHaveClass(/player-move-mode/);

    await drawStroke(page, [
      [70, 160],
      [220, 160],
    ]);

    await expect.poll(async () => storedShapeCount(page)).toBe(1);
  });

  test("long-pressing the canvas opens a pizza-slice tool wheel", async ({ page }) => {
    await openMobileCanvas(page);

    await page.mouse.move(200, 300);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await expect(page.locator("#toolWheel")).toBeVisible();
    await expect(page.locator("#toolWheel [data-tool='smart']").first()).toBeVisible();
    await expect(page.locator("#toolWheel [data-tool='imagine']").first()).toBeVisible();
    await expect(page.locator("#toolWheel [data-tool='select']").first()).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("#toolWheel")).toBeHidden();
    await expect(page.locator("body")).not.toHaveClass(/player-move-mode/);
  });

  test("long-pressing the walk switch still opens the tool wheel", async ({ page }) => {
    await openMobileCanvas(page);

    await pressMoveToggle(page, 500);
    await expect(page.locator("#toolWheel")).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("#toolWheel")).toBeHidden();
  });

  test("dragging to a pizza slice selects that tool", async ({ page }) => {
    await openMobileCanvas(page);

    await page.mouse.move(200, 300);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await expect(page.locator("#toolWheel")).toBeVisible();

    const label = page.locator("#toolWheel text.tool-wheel-label[data-tool='imagine']");
    const box = await label.boundingBox();
    if (!box) throw new Error("Imagine slice label missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator("#toolWheel")).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute("data-tool", "imagine");
    await expect(page.locator("body")).not.toHaveClass(/player-move-mode/);
  });
});

test.describe("desktop chrome", () => {
  test.use({
    viewport: { width: 900, height: 700 },
  });

  test("hides the walk switch on a desktop viewport", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("#modeSwitch")).toBeHidden();
    await expect(page.locator("#moveHint .move-hint-desktop")).toBeVisible();
    await expect(page.locator('.toolbar .group[aria-label="Tools"]')).toBeVisible();
    await expect(page.locator('button.tool[data-tool="imagine"]')).toBeVisible();
  });
});
