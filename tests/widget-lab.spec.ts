import { expect, Page, test } from "@playwright/test";

const SECTIONS = ["board", "actions", "bag", "vitals", "windows", "compose", "float"];

async function openLab(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/lab/", { waitUntil: "load" });
  await page.waitForSelector("#sections .hud-section");
  return errors;
}

test("loads widgets from /lab without a trailing slash", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/lab", { waitUntil: "load" });
  await page.waitForSelector("#sections .hud-section");
  await expect(page.locator("#sec-actions")).toBeVisible();
  await expect(page.locator(".hud-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("still boots when /lab is served without redirecting to a slash", async ({ page, request }) => {
  const html = await (await request.get("/lab/")).text();
  await page.route((url) => url.pathname === "/lab", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: html });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/lab", { waitUntil: "load" });
  await page.waitForSelector("#sections .hud-section");
  await expect(page.locator("#sec-bag .hud-bag .hud-slot")).toHaveCount(60);
});

test("lab HTML pins the module to /lab/ even without a trailing slash", async ({ request }) => {
  const html = await (await request.get("/lab/")).text();
  expect(html).toContain('<base href="/lab/"');
  expect(html).toContain('src="/lab/hud.js"');
});

test("renders every registered widget without errors", async ({ page }) => {
  const errors = await openLab(page);

  for (const id of SECTIONS) {
    await expect(page.locator(`#sec-${id}`)).toBeVisible();
  }
  await expect(page.locator(".hud-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The load-bearing claim of docs/ui-architecture.md: a large repeated grid must
// cost a fixed number of rough calls, not one per widget.
test("loot bag generates one sprite per seed, not per slot", async ({ page }) => {
  await openLab(page);

  const slots = await page.locator(".hud-bag .hud-slot").count();
  expect(slots).toBe(60);
  await expect(page.locator(".hud-bag svg")).toHaveCount(0);

  const metric = await page.locator("#sec-bag .hud-metric").textContent();
  expect(metric).toContain("60 slots");
  expect(metric).toMatch(/\b4 rough calls\b/);
  expect(metric).toContain("0 added SVG nodes");
});

test("changing roughness re-renders and keeps generation count bounded", async ({ page }) => {
  await openLab(page);

  const sprite = page.locator("#sec-actions use").first();
  const before = await sprite.getAttribute("href");

  await page.locator("#roughness").fill("3");
  await page.locator("#roughness").dispatchEvent("input");

  await expect.poll(() => sprite.getAttribute("href")).not.toBe(before);

  const generations = Number((await page.locator("#readout").textContent())?.match(/^(\d+) generations/)?.[1]);
  expect(generations).toBeGreaterThan(0);
  expect(generations).toBeLessThan(140);
});

test("vital bar fill is clipped rather than resized", async ({ page }) => {
  await openLab(page);

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
  await openLab(page);

  const framed = page.locator("#sec-compose .hud-field input[type='text']");
  await framed.fill("Scribbleton");
  await expect(framed).toBeFocused();
  await expect(framed).toHaveValue("Scribbleton");

  await expect(page.locator("#sec-compose input[type='search']")).toHaveCount(1);
  await expect(page.locator("#sec-compose textarea")).toHaveCount(2);
});

test("action buttons share registered geometry via use", async ({ page }) => {
  await openLab(page);

  const uses = page.locator("#sec-actions use");
  await expect(uses.first()).toBeVisible();
  const hrefs = await uses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThanOrEqual(6);
  expect(new Set(hrefs).size).toBeLessThan(hrefs.length);
});

test("press option rows and static state matrix are present", async ({ page }) => {
  await openLab(page);

  await expect(page.locator("#sec-actions .hud-press-option")).toHaveCount(3);
  await expect(page.locator("#sec-actions .hud-btn--stamp")).toHaveCount(3);
  await expect(page.locator("#sec-actions .hud-btn--dent")).toHaveCount(3);
  await expect(page.locator("#sec-actions .hud-btn--hatch")).toHaveCount(3);
  await expect(page.locator("#sec-actions .hud-btn.is-hot")).toHaveCount(1);
  await expect(page.locator("#sec-actions .hud-btn.is-pressed")).toHaveCount(1);
});

test("button press keeps a transparent host background", async ({ page }) => {
  await openLab(page);

  const btn = page.locator("#sec-actions .hud-toolbar .hud-btn").filter({ hasText: "Draw" }).first();
  await btn.dispatchEvent("pointerdown");
  await btn.evaluate((el) => el.classList.add("is-pressed"));

  const bg = await btn.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, image: style.backgroundImage };
  });
  expect(bg.background).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  expect(bg.image === "none" || bg.image.includes("data:image/svg")).toBeTruthy();

  await btn.dispatchEvent("pointerup");
  await btn.evaluate((el) => el.classList.remove("is-pressed"));

  const after = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
});

test("board shell mirrors main chrome and swaps overlays", async ({ page }) => {
  await openLab(page);

  const board = page.locator("#sec-board .hud-board");
  await expect(board).toBeVisible();
  await expect(board.locator(".hud-board-hint")).toBeVisible();
  await expect(board.locator(".hud-board-presence")).toContainText("people here");
  await expect(board.locator(".hud-board-toolbar .hud-btn")).toHaveCount(10);
  await expect(board.locator('.hud-board-toolbar input[type="range"]')).toHaveCount(3);

  await page.locator('#sec-board .hud-board-modes .hud-btn[data-mode="avatar"]').click();
  await expect(board.locator(".hud-board-dialog--avatar")).toBeVisible();
  await expect(board.locator(".hud-board-chrome")).toBeHidden();

  await page.locator('#sec-board .hud-board-modes .hud-btn[data-mode="rooms"]').click();
  await expect(board.locator(".hud-board-dialog--rooms")).toBeVisible();
  await board.locator(".hud-board-dialog--rooms input[type='text']").first().fill("sketch-club");
  await expect(board.locator(".hud-board-dialog--rooms input[type='text']").first()).toHaveValue("sketch-club");
  await expect(board.locator('.hud-board-dialog--rooms [data-action="close"]')).toHaveCount(2);

  await board.locator('.hud-board-dialog--rooms [data-action="close"]').last().click();
  await expect(board.locator(".hud-board-toolbar")).toBeVisible();

  await page.locator('#sec-board .hud-board-modes .hud-btn[data-mode="board"]').click();
  await expect(board.locator(".hud-board-toolbar")).toBeVisible();
});

test("vitals include a linear cooldown bar and animate control", async ({ page }) => {
  await openLab(page);
  await expect(page.locator("#sec-vitals .hud-meter")).toHaveCount(5);
  await expect(page.locator("#sec-vitals .hud-pulse")).toHaveText("Animate");
  await expect(page.locator("#sec-windows .hud-window--slice")).toHaveCount(2);
});
