import { defineConfig } from "vitest/config";

// Unit tests for the Worker source — pure-TS, no browser, no workerd.
// Playwright owns `tests/**/*.spec.ts`; this config scopes vitest to `tests/unit`
// so the two runners don't fight over files.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
