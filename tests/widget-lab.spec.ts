import { expect, Page, test } from "@playwright/test";

const SECTIONS = ["buttons", "inventory", "bars", "panels", "inputs"];

async function openLab(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/lab/", { waitUntil: "load" });
  await page.waitForSelector("#sections .lab-section");
  return errors;
}

test("renders every registered element without errors", async ({ page }) => {
  const errors = await openLab(page);

  for (const id of SECTIONS) {
    await expect(page.locator(`#sec-${id}`)).toBeVisible();
  }
  await expect(page.locator(".lab-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The load-bearing claim of docs/ui-architecture.md: a large repeated grid must
// cost a fixed number of rough calls, not one per widget. If someone reintroduces
// per-element generation, this is what catches it.
test("inventory grid generates one sprite per seed, not per slot", async ({ page }) => {
  await openLab(page);

  const slots = await page.locator(".inv-slot").count();
  expect(slots).toBe(48);

  const metric = await page.locator("#sec-inventory .lab-metric").textContent();
  expect(metric).toContain("48 slots");
  expect(metric).toMatch(/\b4 rough calls\b/);
  expect(metric).toContain("0 added SVG nodes");
});

test("changing roughness re-renders and keeps generation count bounded", async ({ page }) => {
  await openLab(page);

  const sprite = page.locator("#sec-buttons use").first();
  const before = await sprite.getAttribute("href");

  await page.locator("#roughness").fill("3");
  await page.locator("#roughness").dispatchEvent("input");

  // Sprite ids carry the render revision, so this is a deterministic signal that
  // a re-render happened — unlike the timing-dependent stats readout.
  await expect.poll(() => sprite.getAttribute("href")).not.toBe(before);

  const generations = Number((await page.locator("#readout").textContent())?.match(/^(\d+) generations/)?.[1]);
  // Buttons (1 + N variants) + inventory (N) + bars (2) + panels (1 + resize) +
  // inputs (2). Comfortably under 30 at the default 4-variant pool.
  expect(generations).toBeGreaterThan(0);
  expect(generations).toBeLessThan(30);
});

test("progress bar fill is clipped rather than resized", async ({ page }) => {
  await openLab(page);

  const fill = page.locator("#sec-bars .bar-fill").first();
  const track = await page.locator("#sec-bars .bar").first().boundingBox();
  const width = track?.width ?? 0;

  // The fill element spans the full track; only the clip moves.
  const box = await fill.boundingBox();
  expect(box?.width).toBeCloseTo(width, 0);

  // The first bar sits at 72%, so the right-hand inset must resolve to ~28%.
  // Asserting the resolved value is what catches a fill clipped to nothing —
  // e.g. --pct set on a parent it cannot inherit from, leaving it at 0%.
  const clip = await fill.evaluate((el) => getComputedStyle(el).clipPath);
  const inset = Number(clip.match(/inset\(\s*\S+\s+([\d.]+)%/)?.[1]);
  expect(inset).toBeCloseTo(28, 0);
});

test("text fields are real focusable form controls", async ({ page }) => {
  await openLab(page);

  const input = page.locator("#sec-inputs input[type='text']");
  await input.fill("Scribbleton");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Scribbleton");

  await expect(page.locator("#sec-inputs textarea")).toHaveCount(1);
});
