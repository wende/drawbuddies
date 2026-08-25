# AGENTS.md

## Cursor Cloud specific instructions

DrawBuddies is a Cloudflare Workers app: a rough.js collaborative drawing canvas
(`public/`) plus a `CanvasRoom`/`RoomRegistry` Durable Object multiplayer layer
(`src/`). Standard commands live in `package.json` scripts and the README's
"Develop & deploy" section — use those; notes below are only the non-obvious bits.

- **Run the full app:** `npm run dev` (wrangler dev) serves the client + runs the
  Durable Objects and SQLite storage locally on `http://localhost:8787`. It is
  fully local (Miniflare/workerd) and needs no Cloudflare account or login. This is
  the only way to exercise multiplayer sync, presence, `/ws`, and `/api/rooms`.
- **Two separate test runners, by design (they must not overlap):**
  - `npm run test:unit` — vitest, Worker/source unit tests in `tests/unit/**`.
  - `npm test` — Playwright, browser specs in `tests/*.spec.ts`.
- **Playwright e2e only tests the client canvas, not the Worker.** Its `webServer`
  serves `public/` with a plain `python3 -m http.server` on port 14321, so under
  those tests `/ws` and `/api/rooms` return 404 — that is expected. `python3` is
  required for this server. Server/multiplayer behavior is covered by vitest and by
  running `npm run dev`.
- **"Imagine" (LLM → SVG) is optional and off by default.** `POST /imagine` returns
  `503 {"error":"Imagine is not configured"}` unless `ZAI_API_KEY` or
  `MINIMAX_API_KEY` is set in the environment. A 503 here is expected, not a bug.
- **Type check:** `npm run check` (`tsc --noEmit`).
