import { expect, Page, test } from "@playwright/test";

type ShapeData = {
  id: string;
  type: string;
  geom: Record<string, unknown>;
  options: Record<string, unknown>;
};

type GalleryStore = {
  version: number;
  items: Array<{
    id: string;
    name: string;
    shapes: ShapeData[];
    placeWidth: number;
    placeHeight: number;
    updatedAt: number;
  }>;
};

const RECTANGLE: ShapeData = {
  id: "gallery-source-rect",
  type: "rectangle",
  geom: { x1: 200, y1: 200, x2: 300, y2: 260 },
  options: {
    stroke: "#222222",
    fill: "#ffe08a",
    fillStyle: "solid",
    roughness: 1.5,
    bowing: 1,
    strokeWidth: 2,
    seed: 123
  }
};

const RECTANGLE_TWO: ShapeData = {
  id: "gallery-source-rect-2",
  type: "rectangle",
  geom: { x1: 120, y1: 400, x2: 200, y2: 460 },
  options: {
    stroke: "#222222",
    fill: "#cde8ff",
    fillStyle: "solid",
    roughness: 1.5,
    bowing: 1,
    strokeWidth: 2,
    seed: 124
  }
};

const GALLERY_ITEM_SHAPES: ShapeData[] = [
  {
    id: "saved-rect",
    type: "rectangle",
    geom: { x1: 90, y1: 90, x2: 230, y2: 230 },
    options: {
      stroke: "#222222",
      fill: "#ffe08a",
      fillStyle: "solid",
      roughness: 1.5,
      bowing: 1,
      strokeWidth: 2,
      seed: 99
    }
  }
];

function galleryStore(name = "Star"): GalleryStore {
  return {
    version: 1,
    items: [
      {
        id: "gallery-star",
        name,
        shapes: GALLERY_ITEM_SHAPES,
        placeWidth: 80,
        placeHeight: 80,
        updatedAt: 1
      }
    ]
  };
}

async function openCanvas(page: Page, extra?: { shapes?: ShapeData[]; gallery?: GalleryStore }) {
  await page.addInitScript(({ shapes, gallery }) => {
    localStorage.clear();
    if (shapes) localStorage.setItem("drawbuddies:v2", JSON.stringify(shapes));
    if (gallery) localStorage.setItem("drawbuddies:gallery:v1", JSON.stringify(gallery));
  }, { shapes: extra?.shapes ?? null, gallery: extra?.gallery ?? null });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/", { waitUntil: "load" });
  await page.waitForSelector("#canvas");
}

async function openGallery(page: Page) {
  await page.click("#galleryBtn");
  await expect(page.locator("#galleryPanel")).toHaveClass(/is-open/);
  await expect
    .poll(async () => (await page.locator("#galleryPanel").boundingBox())?.x ?? 9999)
    .toBeLessThan(720);
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 12 });
  await page.mouse.up();
}

async function readGallery(page: Page): Promise<GalleryStore["items"]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:gallery:v1") || "{\"items\":[]}";
    const parsed = JSON.parse(raw) as GalleryStore | GalleryStore["items"];
    return Array.isArray(parsed) ? parsed : parsed.items || [];
  });
}

async function storedWorldShapes(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("drawbuddies:v2") || "[]";
    return JSON.parse(raw) as ShapeData[];
  });
}

test("hand-tool drags show a grabbing cursor on the canvas", async ({ page }) => {
  await openCanvas(page, { shapes: [RECTANGLE] });
  await page.click('button[data-tool="hand"]');

  await page.mouse.move(250, 230);
  await page.mouse.down();
  await page.mouse.move(270, 250, { steps: 8 });

  await expect(page.locator("body")).toHaveClass(/dragging-shape/);
  await expect(page.locator("#canvas")).toHaveCSS("cursor", "grabbing");

  await page.mouse.up();
  await expect(page.locator("body")).not.toHaveClass(/dragging-shape/);
});

test("cancelling a gallery drop does not consume an extra undo", async ({ page }) => {
  await openCanvas(page, { shapes: [RECTANGLE, RECTANGLE_TWO] });
  await openGallery(page);

  await page.click('button[data-tool="hand"]');
  const panel = page.locator("#galleryPanel");
  const box = await panel.boundingBox();
  if (!box) throw new Error("gallery panel not visible");

  await drag(page, [250, 230], [box.x + box.width / 2, box.y + 80]);
  await expect(page.locator("#galleryEditorOverlay")).toBeVisible();

  await page.click("#galleryCancelBtn");
  await expect(page.locator("#galleryEditorOverlay")).toBeHidden();
  await expect.poll(async () => (await storedWorldShapes(page)).length).toBe(2);

  await page.click("#undoBtn");
  await expect.poll(async () => (await storedWorldShapes(page)).length).toBe(2);
});

async function galleryEditorPoint(page: Page, point: [number, number]) {
  const box = await page.locator("#galleryEditorCanvas").boundingBox();
  if (!box) throw new Error("gallery editor canvas not visible");
  return [
    box.x + (point[0] / 320) * box.width,
    box.y + (point[1] / 320) * box.height
  ] as [number, number];
}

test("closing the gallery editor discards an in-flight text field", async ({ page }) => {
  await openCanvas(page);
  await openGallery(page);
  await page.click(".gallery-slot-add");
  await expect(page.locator("#galleryEditorOverlay")).toBeVisible();

  await page.click('button[data-gallery-tool="text"]');
  const [x, y] = await galleryEditorPoint(page, [160, 160]);
  await page.mouse.click(x, y);
  const editor = page.locator("textarea.avatar-text-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Hidden label");

  await page.click("#galleryCancelBtn");
  await expect(page.locator("#galleryEditorOverlay")).toBeHidden();
  await expect(page.locator("textarea.avatar-text-editor")).toHaveCount(0);

  await page.click(".gallery-slot-add");
  await expect(page.locator("#galleryEditorOverlay")).toBeVisible();
  await expect(page.locator("#galleryOkayBtn")).toBeDisabled();
  await expect(page.locator("textarea.avatar-text-editor")).toHaveCount(0);
});

test("gallery panel opens from the top bar", async ({ page }) => {
  await openCanvas(page);
  await expect(page.locator("#galleryPanel")).not.toHaveClass(/is-open/);
  await openGallery(page);
  await expect(page.locator("#galleryEmpty")).toBeVisible();
  await expect(page.locator(".gallery-slot-add")).toHaveCount(1);
});

test("dragging a world shape into the gallery opens the editor and saves a named item", async ({ page }) => {
  await openCanvas(page, { shapes: [RECTANGLE] });
  await openGallery(page);

  await page.click('button[data-tool="hand"]');
  const panel = page.locator("#galleryPanel");
  const box = await panel.boundingBox();
  if (!box) throw new Error("gallery panel not visible");

  await drag(page, [250, 230], [box.x + box.width / 2, box.y + 80]);

  await expect(page.locator("#galleryEditorOverlay")).toBeVisible();
  await page.fill("#galleryItemName", "House");
  await page.click("#galleryOkayBtn");
  await expect(page.locator("#galleryEditorOverlay")).toBeHidden();

  await expect.poll(async () => (await readGallery(page)).map((item) => item.name)).toEqual(["House"]);
  await expect(page.locator(".gallery-item-name")).toHaveText("House");
  const thumb = page.locator(".gallery-item .gallery-slot");
  await expect(thumb).toHaveCount(1);
  const thumbBox = await thumb.boundingBox();
  expect(thumbBox?.width).toBeGreaterThanOrEqual(86);
  expect(thumbBox?.height).toBeGreaterThanOrEqual(86);
  expect(thumbBox?.width).toBeLessThanOrEqual(92);
  expect(thumbBox?.height).toBeLessThanOrEqual(92);

  // Saving copies into the gallery; the original world shape stays put.
  await expect.poll(async () => (await storedWorldShapes(page)).length).toBe(1);
});

test("clicking a gallery item opens the editor so it can be renamed or removed", async ({ page }) => {
  await openCanvas(page, { gallery: galleryStore("Lantern") });
  await openGallery(page);
  await page.click(".gallery-item .gallery-slot");

  await expect(page.locator("#galleryEditorOverlay")).toBeVisible();
  await expect(page.locator("#galleryEditorTitle")).toHaveText("Edit object");
  await expect(page.locator("#galleryItemName")).toHaveValue("Lantern");
  await expect(page.locator("#galleryDeleteBtn")).toBeVisible();

  await page.fill("#galleryItemName", "Lamp");
  await page.click("#galleryOkayBtn");
  await expect.poll(async () => (await readGallery(page))[0]?.name).toBe("Lamp");

  await page.click(".gallery-item-remove");
  await expect.poll(async () => (await readGallery(page)).length).toBe(0);
  await expect(page.locator("#galleryEmpty")).toBeVisible();
});

test("dragging a gallery item into the world stamps a group that can be scaled", async ({ page }) => {
  await openCanvas(page, { gallery: galleryStore("Box") });
  await openGallery(page);

  const slot = page.locator(".gallery-item .gallery-slot");
  const slotBox = await slot.boundingBox();
  if (!slotBox) throw new Error("gallery slot not visible");

  await drag(
    page,
    [slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2],
    [300, 280]
  );

  await expect.poll(async () => (await storedWorldShapes(page)).map((shape) => shape.type)).toEqual(["group"]);
  const before = await storedWorldShapes(page);
  const group = before[0];
  expect(group.geom).toMatchObject({ children: expect.any(Array) });
  expect((group.geom.children as unknown[]).length).toBe(1);
  const beforeScale = Number((group.geom as { scale?: number }).scale || 1);

  await page.click('button[data-tool="scale"]');
  await drag(page, [300, 280], [380, 280]);

  await expect.poll(async () => {
    const shapes = await storedWorldShapes(page);
    return Math.abs(Number((shapes[0]?.geom as { scale?: number }).scale || 1) - beforeScale);
  }).toBeGreaterThan(0.05);
});
