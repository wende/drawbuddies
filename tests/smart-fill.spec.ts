import { expect, Page, test } from "@playwright/test";

/**
 * Smart-fill gesture: scribbling inside an existing rectangle/ellipse with the
 * Smart tool applies a fill instead of adding a new stroke. The fill style is
 * inferred from the gesture (hachure vs zigzag), and a second scribble on the
 * same shape escalates the style (hachure -> cross-hatch -> solid). The
 * `fillStrokeLooksIntentional` guard is what prevents an accidental tap from
 * filling a shape by mistake.
 *
 * All tests seed the canvas via localStorage (mirrors the style in
 * transform-tools.spec.ts) and then drive a real Smart-tool gesture through
 * page.mouse so the actual pointerdown/move/up pipeline runs.
 */

type ShapeData = {
  id: string;
  type: string;
  geom: Record<string, number | string>;
  options: Record<string, number | string | null>;
};

const RECTANGLE: ShapeData = {
  id: "fill-target",
  type: "rectangle",
  geom: { x1: 200, y1: 200, x2: 400, y2: 350 },
  options: {
    stroke: "#222222",
    fill: null,
    fillStyle: "hachure",
    roughness: 1.5,
    bowing: 1,
    strokeWidth: 2,
    seed: 100
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

async function storedShapes(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:v2") || "[]";
    return JSON.parse(raw) as ShapeData[];
  });
}

async function storedRectangle(page: Page) {
  const shapes = await storedShapes(page);
  return shapes.find((s) => s.id === "fill-target");
}

// Back-and-forth horizontal passes inside the seeded rectangle — dense
// enough to read as deliberate shading. ~14 points, 6 transitions, diagonal
// 200px, total path ~1100px. Should reliably hit either hachure or zigzag
// in `inferSmartFillStyle` and `fillStrokeLooksIntentional` should accept
// it (density ~5.5, plenty of turns).
async function drawHachureScribble(page: Page) {
  const passes: [number, number][] = [
    [220, 220], [380, 220],
    [380, 240], [220, 240],
    [220, 260], [380, 260],
    [380, 280], [220, 280],
    [220, 300], [380, 300],
    [380, 320], [220, 320],
    [220, 340], [380, 340]
  ];
  await page.mouse.move(passes[0][0], passes[0][1]);
  await page.mouse.down();
  for (let i = 1; i < passes.length; i++) {
    await page.mouse.move(passes[i][0], passes[i][1], { steps: 6 });
  }
  await page.mouse.up();
}

test("scribble inside a rectangle applies a fill, no new shape is created", async ({ page }) => {
  await openWithShapes(page, [RECTANGLE]);

  await drawHachureScribble(page);

  // The fill lands on the target rectangle; the scribble itself is consumed
  // by the gesture and never becomes its own shape.
  await expect
    .poll(async () => (await storedRectangle(page))?.options.fill)
    .toBeTruthy();
  await expect.poll(async () => (await storedShapes(page)).length).toBe(1);

  const style = (await storedRectangle(page))?.options.fillStyle;
  expect(["hachure", "zigzag"]).toContain(style);
});

test("second scribble on an already-filled rectangle escalates to cross-hatch", async ({ page }) => {
  // Pre-seed with a hachure fill so the next gesture is unambiguously an
  // escalation, not the first fill.
  const seededRect: ShapeData = {
    ...RECTANGLE,
    options: { ...RECTANGLE.options, fill: "#222222", fillStyle: "hachure" }
  };
  await openWithShapes(page, [seededRect]);

  await drawHachureScribble(page);

  // Escalation ladder: hachure -> cross-hatch -> solid.
  // (See chooseSmartFillStyle in public/app/smart-fill.js.)
  await expect
    .poll(async () => (await storedRectangle(page))?.options.fillStyle)
    .toBe("cross-hatch");
});

test("a small stroke outside any shape is not mistakenly turned into a fill", async ({ page }) => {
  await openWithShapes(page, [RECTANGLE]);

  // A short straight line above and to the left of the rectangle. It is
  // meaningful (becomes a real shape) but fails the `fillStrokeLooksIntentional`
  // guard — too short, too few turns, wrong density — and there is no target
  // shape containing its points.
  await page.mouse.move(60, 80);
  await page.mouse.down();
  await page.mouse.move(140, 80, { steps: 5 });
  await page.mouse.up();

  // Wait long enough that any deferred fill application would have run.
  await page.waitForTimeout(200);

  // The rectangle's fill stays null.
  const rect = await storedRectangle(page);
  expect(rect?.options.fill).toBeFalsy();
  expect(rect?.options.fillStyle).toBe("hachure"); // unchanged from seed

  // A new shape was added (the stroke itself), so we know the gesture was
  // processed — the test isn't passing because the canvas ignored the input.
  const shapes = await storedShapes(page);
  expect(shapes.length).toBe(2);
  // The new shape is not the original rectangle.
  expect(shapes[1].id).not.toBe("fill-target");
});

test("a small tap *inside* a rectangle is also not enough to fill it (intentionality guard)", async ({ page }) => {
  // The README claims the guard `fillStrokeLooksIntentional` requires "the
  // scribble must be dense enough, large enough relative to the target, and
  // have enough turns." A tiny tap inside a rectangle must NOT count.
  await openWithShapes(page, [RECTANGLE]);

  // A short, straight, non-dense line inside the rectangle. Goes nowhere near
  // the density / turn count / path length of an intentional fill gesture.
  await page.mouse.move(220, 220);
  await page.mouse.down();
  await page.mouse.move(240, 220, { steps: 3 });
  await page.mouse.up();

  await page.waitForTimeout(200);

  const rect = await storedRectangle(page);
  expect(rect?.options.fill).toBeFalsy();
});
