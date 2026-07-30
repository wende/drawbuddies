import { expect, Page, test } from "@playwright/test";

// WASD movement should keep working no matter which toolbar control is focused
// (sliders, color pickers, tool buttons). It should *not* fire while the user
// is typing into a real text-entry field.

function installScaleSpy(page: Page) {
  return page.addInitScript(() => {
    const originalScale = CanvasRenderingContext2D.prototype.scale;
    CanvasRenderingContext2D.prototype.scale = function (x: number, y: number) {
      (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls ||= [];
      (window as typeof window & { __avatarScaleCalls: number[] }).__avatarScaleCalls.push(x);
      return originalScale.call(this, x, y);
    };
  });
}

async function readScales(page: Page): Promise<number[]> {
  return page.evaluate(
    () => ((window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls) || []
  );
}

test("WASD moves the player while a range slider has focus", async ({ page }) => {
  await installScaleSpy(page);
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => {
    (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls = [];
  });

  await page.locator("#roughness").focus();
  await expect(page.locator("#roughness")).toBeFocused();

  // Walk right while the slider has focus.
  await page.keyboard.down("d");
  await expect
    .poll(async () => readScales(page))
    .toContain(1);
  await page.keyboard.up("d");

  // Walk left while the slider still has focus.
  await page.evaluate(() => {
    (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls = [];
  });
  await page.keyboard.down("a");
  await expect
    .poll(async () => readScales(page))
    .toContain(-1);
  await page.keyboard.up("a");
});

test("WASD moves the player while a color picker has focus", async ({ page }) => {
  await installScaleSpy(page);
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => {
    (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls = [];
  });

  await page.locator("#strokeColor").focus();
  await expect(page.locator("#strokeColor")).toBeFocused();

  await page.keyboard.down("d");
  await expect
    .poll(async () => readScales(page))
    .toContain(1);
  await page.keyboard.up("d");
});

test("WASD moves the player while a tool button has focus", async ({ page }) => {
  await installScaleSpy(page);
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => {
    (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls = [];
  });

  // Activate the Move tool via the keyboard (it lives in the same toolbar),
  // then keep its focus and drive movement from there.
  const handButton = page.locator('button.tool[data-tool="hand"]');
  await handButton.focus();
  await expect(handButton).toBeFocused();

  await page.keyboard.down("d");
  await expect
    .poll(async () => readScales(page))
    .toContain(1);
  await page.keyboard.up("d");
});

test("WASD does not move the player while typing in a text input", async ({ page }) => {
  await installScaleSpy(page);
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => {
    (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls = [];
  });

  // Inject a plain text input, give it focus, and confirm WASD keypresses are
  // left alone (player should not animate, and the input should still receive
  // the character).
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "text";
    input.id = "test-text-input";
    document.body.appendChild(input);
    input.focus();
  });
  await expect(page.locator("#test-text-input")).toBeFocused();

  await page.keyboard.press("d");
  // Give the rAF loop a few frames in case the fix ever regressed.
  await page.waitForTimeout(200);

  const scales = await readScales(page);
  expect(scales).not.toContain(1);
  expect(scales).not.toContain(-1);

  const value = await page.locator("#test-text-input").inputValue();
  expect(value).toBe("d");
});
