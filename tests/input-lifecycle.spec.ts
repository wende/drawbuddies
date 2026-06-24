import { expect, Page, test } from "@playwright/test";

async function openCleanCanvas(page: Page) {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/", { waitUntil: "load" });
  await page.waitForSelector("#canvas");
}

async function storedShapes(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:v2") || "[]";
    return JSON.parse(raw) as Array<{
      type: string;
      geom: Record<string, number>;
    }>;
  });
}

async function startMeaningfulStroke(page: Page) {
  await page.mouse.move(180, 180);
  await page.mouse.down();
  await page.mouse.move(430, 180, { steps: 8 });
}

test("commits the pointerup position even when no final pointermove arrives", async ({ page }) => {
  await openCleanCanvas(page);

  await page.mouse.move(180, 180);
  await page.mouse.down();
  await page.dispatchEvent("#canvas", "pointerup", {
    pointerId: 1,
    button: 0,
    clientX: 430,
    clientY: 180
  });
  await page.mouse.up();

  await expect.poll(() => storedShapes(page)).toHaveLength(1);
  await expect(page.locator("#undoBtn")).toBeEnabled();
});

test("preserves a meaningful stroke when pointer capture is lost", async ({ page }) => {
  await openCleanCanvas(page);
  await startMeaningfulStroke(page);

  await page.dispatchEvent("#canvas", "lostpointercapture", {
    pointerId: 1,
    clientX: 430,
    clientY: 180
  });
  await page.mouse.up();

  await expect.poll(() => storedShapes(page)).toHaveLength(1);
  await expect(page.locator("#undoBtn")).toBeEnabled();
});

test("preserves a meaningful stroke when the pointer is cancelled", async ({ page }) => {
  await openCleanCanvas(page);
  await startMeaningfulStroke(page);

  await page.dispatchEvent("#canvas", "pointercancel", {
    pointerId: 1,
    clientX: 430,
    clientY: 180
  });
  await page.mouse.up();

  await expect.poll(() => storedShapes(page)).toHaveLength(1);
  await expect(page.locator("#undoBtn")).toBeEnabled();
});
