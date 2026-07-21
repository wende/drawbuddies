import { expect, Page, test } from "@playwright/test";

/**
 * Rooms browser UI. The Playwright web server is a static file server (no
 * Worker), so the room API is mocked with page.route. We verify the panel
 * renders the public list, and that creating / joining a room navigates to the
 * right /r/CODE deep link. The real create→list→sync flow is exercised
 * manually against `wrangler dev` (see the plan's verification section).
 */

const PUBLIC_ROOMS = [
  { code: "ABC234", title: "Team standup", count: 3, createdAt: 0, lastSeenAt: 0 },
  { code: "XYZ789", title: "Doodles", count: 1, createdAt: 0, lastSeenAt: 0 },
];

async function mockRoomApi(page: Page, createUrl = "/r/NEW234") {
  await page.route("**/api/rooms", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: "NEW234", url: createUrl }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rooms: PUBLIC_ROOMS }),
    });
  });
}

async function openLobby(page: Page) {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/", { waitUntil: "load" });
  await page.waitForSelector("#canvas");
  await page.click("#roomsBtn");
  await expect(page.locator("#roomsOverlay")).toBeVisible();
}

test("lists public rooms with their player counts", async ({ page }) => {
  await mockRoomApi(page);
  await openLobby(page);

  const items = page.locator("#roomsList .room-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Team standup");
  await expect(items.nth(0)).toContainText("3 people");
  await expect(items.nth(1)).toContainText("Doodles");
  await expect(items.nth(1)).toContainText("1 person");
});

test("clicking a public room navigates to its /r/CODE deep link", async ({ page }) => {
  await mockRoomApi(page);
  await openLobby(page);

  await page.locator("#roomsList .room-item").first().click();
  await page.waitForURL(/\/r\/ABC234$/);
});

test("creating a room navigates to the returned url", async ({ page }) => {
  await mockRoomApi(page, "/r/NEW234");
  await openLobby(page);

  await page.fill("#roomTitle", "My room");
  await page.click("#roomCreateBtn");
  await page.waitForURL(/\/r\/NEW234$/);
});

test("entering a valid code navigates; an invalid code shows an error", async ({ page }) => {
  await mockRoomApi(page);
  await openLobby(page);

  // Invalid code: error shown, no navigation.
  await page.fill("#roomCodeInput", "xx");
  await page.click("#roomJoinBtn");
  await expect(page.locator("#roomError")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");

  // Valid code: navigates to the deep link (lowercase is normalized).
  await page.fill("#roomCodeInput", "abc234");
  await page.click("#roomJoinBtn");
  await page.waitForURL(/\/r\/ABC234$/);
});
