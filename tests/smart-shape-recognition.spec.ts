import { expect, Page, test } from "@playwright/test";

type Point = [number, number];

async function openCleanCanvas(page: Page) {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/", { waitUntil: "load" });
  await page.waitForSelector("#canvas");
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

async function storedShapeTypes(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:v2") || "[]";
    return JSON.parse(raw).map((shape: { type: string }) => shape.type);
  });
}

function imperfectCircle(cx: number, cy: number, rx: number, ry: number): Point[] {
  const points: Point[] = [];

  for (let i = 0; i <= 40; i++) {
    const theta = (Math.PI * 2 * i) / 40;
    const wobble = Math.sin(i * 1.7) * 2.5;
    points.push([
      cx + Math.cos(theta) * (rx + wobble),
      cy + Math.sin(theta) * (ry - wobble)
    ]);
  }

  return points;
}

test("smart draw recognizes an imperfect square as a rectangle", async ({ page }) => {
  await openCleanCanvas(page);

  await drawStroke(page, [
    [220, 205],
    [302, 200],
    [309, 209],
    [305, 286],
    [296, 294],
    [218, 289],
    [210, 278],
    [214, 211],
    [220, 205]
  ]);

  await expect.poll(() => storedShapeTypes(page)).toEqual(["rectangle"]);
});

test("smart draw recognizes an imperfect rectangle as a rectangle", async ({ page }) => {
  await openCleanCanvas(page);

  await drawStroke(page, [
    [395, 215],
    [565, 209],
    [575, 221],
    [570, 312],
    [558, 320],
    [390, 316],
    [382, 304],
    [386, 224],
    [395, 215]
  ]);

  await expect.poll(() => storedShapeTypes(page)).toEqual(["rectangle"]);
});

test("smart draw recognizes a square when the closing side is too short", async ({ page }) => {
  await openCleanCanvas(page);

  await drawStroke(page, [
    [210, 205],
    [302, 202],
    [309, 212],
    [306, 294],
    [296, 304],
    [211, 299],
    [204, 288],
    [207, 243]
  ]);

  await expect.poll(() => storedShapeTypes(page)).toEqual(["rectangle"]);
});

test("smart draw recognizes a square when the closing side overshoots", async ({ page }) => {
  await openCleanCanvas(page);

  await drawStroke(page, [
    [220, 215],
    [305, 211],
    [314, 220],
    [311, 300],
    [299, 309],
    [218, 304],
    [210, 292],
    [214, 220],
    [217, 185]
  ]);

  await expect.poll(() => storedShapeTypes(page)).toEqual(["rectangle"]);
});

test("smart draw keeps a circle as an ellipse", async ({ page }) => {
  await openCleanCanvas(page);

  await drawStroke(page, imperfectCircle(330, 430, 58, 55));

  await expect.poll(() => storedShapeTypes(page)).toEqual(["ellipse"]);
});
