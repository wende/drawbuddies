import { expect, Page, test } from "@playwright/test";

type ShapeData = {
  id: string;
  type: string;
  geom: Record<string, number | string>;
  options: Record<string, number | string | null>;
};

const RECTANGLE: ShapeData = {
  id: "transform-rect",
  type: "rectangle",
  geom: { x1: 200, y1: 200, x2: 300, y2: 260 },
  options: {
    stroke: "#222222",
    fill: null,
    fillStyle: "hachure",
    roughness: 1.5,
    bowing: 1,
    strokeWidth: 2,
    seed: 123
  }
};

async function openWithShapes(page: Page, shapes: ShapeData[]) {
  await page.addInitScript((seedShapes) => {
    localStorage.clear();
    localStorage.setItem("drawbuddies:v2", JSON.stringify(seedShapes));
  }, shapes);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/", { waitUntil: "load" });
  await page.waitForSelector("#canvas");
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 10 });
  await page.mouse.up();
}

async function selectMainRectangle(page: Page) {
  await page.click('button[data-tool="select"]');
  await drag(page, [190, 190], [310, 270]);
}

async function storedMainShape(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:v2") || "[]";
    return JSON.parse(raw)[0] as ShapeData;
  });
}

function rectangleWidth(shape: ShapeData) {
  return Math.abs(Number(shape.geom.x2) - Number(shape.geom.x1));
}

test("scale tool resizes the selected rectangle and participates in undo/redo", async ({ page }) => {
  await openWithShapes(page, [RECTANGLE]);
  await selectMainRectangle(page);

  await page.click('button[data-tool="scale"]');
  await drag(page, [310, 230], [370, 230]);

  await expect.poll(async () => rectangleWidth(await storedMainShape(page))).toBeGreaterThan(180);

  await page.click("#undoBtn");
  await expect.poll(async () => rectangleWidth(await storedMainShape(page))).toBe(100);

  await page.click("#redoBtn");
  await expect.poll(async () => rectangleWidth(await storedMainShape(page))).toBeGreaterThan(180);
});

test("rotate tool stores rectangle rotation without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await openWithShapes(page, [RECTANGLE]);
  await selectMainRectangle(page);

  await page.click('button[data-tool="rotate"]');
  await drag(page, [350, 230], [250, 330]);

  await expect.poll(async () => {
    const shape = await storedMainShape(page);
    return Math.abs(Number(shape.geom.rotation || 0));
  }).toBeGreaterThan(1);

  expect(errors).toEqual([]);
});

async function avatarPoint(page: Page, point: [number, number]) {
  const box = await page.locator("#avatarCanvas").boundingBox();
  if (!box) throw new Error("avatar canvas not visible");
  return [
    box.x + (point[0] / 260) * box.width,
    box.y + (point[1] / 360) * box.height
  ] as [number, number];
}

async function dragAvatar(page: Page, from: [number, number], to: [number, number]) {
  await drag(page, await avatarPoint(page, from), await avatarPoint(page, to));
}

test("avatar editor scale tool records local undo history", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/", { waitUntil: "load" });
  await page.click("#avatarBtn");
  await page.waitForSelector("#avatarCanvas");

  await expect(page.locator("#avatarUndoBtn")).toBeDisabled();

  await page.click('button[data-avatar-tool="select"]');
  await dragAvatar(page, [94, 30], [166, 102]);

  await page.click('button[data-avatar-tool="scale"]');
  await dragAvatar(page, [170, 64], [220, 64]);

  await expect(page.locator("#avatarUndoBtn")).toBeEnabled();
  await page.click("#avatarUndoBtn");
  await expect(page.locator("#avatarRedoBtn")).toBeEnabled();
});
