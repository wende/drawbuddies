import { expect, Page, test } from "@playwright/test";

const SECTIONS = ["actions", "bag", "vitals", "windows", "compose", "float"];

async function openGallery(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/gallery/", { waitUntil: "load" });
  await page.waitForSelector("#sections .hud-section");
  return errors;
}

test("renders every HUD widget without errors", async ({ page }) => {
  const errors = await openGallery(page);

  for (const id of SECTIONS) {
    await expect(page.locator(`#sec-${id}`)).toBeVisible();
  }
  await expect(page.locator(".hud-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("loot bag generates one sprite per seed, not per slot", async ({ page }) => {
  await openGallery(page);

  const slots = await page.locator(".hud-bag .hud-slot").count();
  expect(slots).toBe(60);
  await expect(page.locator(".hud-bag svg")).toHaveCount(0);

  const metric = await page.locator("#sec-bag .hud-metric").textContent();
  expect(metric).toContain("60 slots");
  expect(metric).toMatch(/\b4 rough calls\b/);
  expect(metric).toContain("0 added SVG nodes");
});

test("changing roughness re-renders and keeps generation count bounded", async ({ page }) => {
  await openGallery(page);

  const sprite = page.locator("#sec-actions use").first();
  const before = await sprite.getAttribute("href");

  await page.locator("#roughness").fill("3");
  await page.locator("#roughness").dispatchEvent("input");

  await expect.poll(() => sprite.getAttribute("href")).not.toBe(before);

  const generations = Number((await page.locator("#readout").textContent())?.match(/^(\d+) generations/)?.[1]);
  expect(generations).toBeGreaterThan(0);
  expect(generations).toBeLessThan(45);
});

test("vital bar fill is clipped rather than resized", async ({ page }) => {
  await openGallery(page);

  const fill = page.locator("#sec-vitals .hud-bar-fill").first();
  const track = await page.locator("#sec-vitals .hud-bar").first().boundingBox();
  const width = track?.width ?? 0;

  const box = await fill.boundingBox();
  expect(box?.width).toBeCloseTo(width, 0);

  const clip = await fill.evaluate((el) => getComputedStyle(el).clipPath);
  const inset = Number(clip.match(/inset\(\s*\S+\s+([\d.]+)%/)?.[1]);
  expect(inset).toBeCloseTo(35, 0);
});

test("compose fields are real focusable form controls", async ({ page }) => {
  await openGallery(page);

  const input = page.locator("#sec-compose input[type='text']");
  await input.fill("Scribbleton");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Scribbleton");

  await expect(page.locator("#sec-compose textarea")).toHaveCount(1);
});

test("action buttons share registered geometry via use", async ({ page }) => {
  await openGallery(page);

  const uses = page.locator("#sec-actions use");
  await expect(uses).toHaveCount(6);
  const hrefs = await uses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(new Set(hrefs).size).toBeLessThan(hrefs.length);
});
