import { test, expect, Page } from "@playwright/test";

// Filter out errors injected by Playwright audit tooling / browser extensions.
function isOurError(msg: string) {
  return !msg.includes("node_modules") && !msg.includes(".vite");
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (isOurError(err.message)) errors.push(err.message);
  });
  return errors;
}

test("avatar renders without JS errors on page load", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/", { waitUntil: "load" });
  expect(errors).toEqual([]);
});

test("avatar animation does not throw when player moves", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/", { waitUntil: "load" });

  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await page.waitForTimeout(200);

  expect(errors).toEqual([]);
});

test("avatar flips when walking left and returns when walking right", async ({ page }) => {
  await page.addInitScript(() => {
    const originalScale = CanvasRenderingContext2D.prototype.scale;
    CanvasRenderingContext2D.prototype.scale = function (x: number, y: number) {
      (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls ||= [];
      (window as typeof window & { __avatarScaleCalls: number[] }).__avatarScaleCalls.push(x);
      return originalScale.call(this, x, y);
    };
  });

  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => {
    (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls = [];
  });

  await page.keyboard.down("a");
  await page.waitForTimeout(160);
  await page.keyboard.up("a");

  const leftScaleCalls = await page.evaluate(() => {
    return (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls || [];
  });
  expect(leftScaleCalls).toContain(-1);

  await page.evaluate(() => {
    (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls = [];
  });

  await page.keyboard.down("d");
  await page.waitForTimeout(160);
  await page.keyboard.up("d");

  const rightScaleCalls = await page.evaluate(() => {
    return (window as typeof window & { __avatarScaleCalls?: number[] }).__avatarScaleCalls || [];
  });
  expect(rightScaleCalls).toContain(1);
  expect(rightScaleCalls).not.toContain(-1);
});

test("avatar editor Play button does not throw", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/", { waitUntil: "load" });

  await page.click("#avatarBtn");
  await page.waitForTimeout(200);
  await page.click("#avatarPlayBtn");
  await page.waitForTimeout(400);

  expect(errors).toEqual([]);
});

async function drawAvatarStroke(page: Page) {
  const box = await page.locator("#avatarCanvas").boundingBox();
  if (!box) throw new Error("avatar canvas not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 40, y - 40);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x - 40 + i * 10, y - 40 + i * 10);
  }
  await page.mouse.up();
}

test("avatar editor undo/redo tracks drawing history", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/", { waitUntil: "load" });

  await page.click("#avatarBtn");
  await page.waitForTimeout(200);

  // No edits yet: undo and redo are both unavailable.
  await expect(page.locator("#avatarUndoBtn")).toBeDisabled();
  await expect(page.locator("#avatarRedoBtn")).toBeDisabled();

  await drawAvatarStroke(page);

  // Drawing a shape enables undo and leaves redo unavailable.
  await expect(page.locator("#avatarUndoBtn")).toBeEnabled();
  await expect(page.locator("#avatarRedoBtn")).toBeDisabled();

  await page.click("#avatarUndoBtn");

  // After undo: redo becomes available, undo exhausted.
  await expect(page.locator("#avatarUndoBtn")).toBeDisabled();
  await expect(page.locator("#avatarRedoBtn")).toBeEnabled();

  await page.click("#avatarRedoBtn");

  // After redo: undo available again, redo exhausted.
  await expect(page.locator("#avatarUndoBtn")).toBeEnabled();
  await expect(page.locator("#avatarRedoBtn")).toBeDisabled();

  expect(errors).toEqual([]);
});

test("avatar editor undo/redo respond to keyboard shortcuts", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });

  await page.click("#avatarBtn");
  await page.waitForTimeout(200);
  await drawAvatarStroke(page);
  await expect(page.locator("#avatarUndoBtn")).toBeEnabled();

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator("#avatarRedoBtn")).toBeEnabled();
  await expect(page.locator("#avatarUndoBtn")).toBeDisabled();

  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(page.locator("#avatarUndoBtn")).toBeEnabled();
  await expect(page.locator("#avatarRedoBtn")).toBeDisabled();
});

test("canvas has drawn content after load", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  await page.waitForSelector("#canvas");

  const hasContent = await page.evaluate(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const first = `${data[0]},${data[1]},${data[2]}`;
    for (let i = 4; i < Math.min(data.length, 4000); i += 4) {
      if (`${data[i]},${data[i + 1]},${data[i + 2]}` !== first) return true;
    }
    return false;
  });

  expect(hasContent).toBe(true);
});
