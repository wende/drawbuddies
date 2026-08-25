import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Vitest owns `tests/unit/**/*.test.ts`; Playwright only picks up `*.spec.ts`.
  testMatch: "**/*.spec.ts",
  testIgnore: "**/unit/**",
  use: {
    baseURL: "http://localhost:14321",
  },
  webServer: {
    command: "python3 -m http.server 14321 --bind 127.0.0.1 --directory public",
    port: 14321,
    reuseExistingServer: true,
  },
});
