# Rough Drawing Canvas — Multiplayer Conversion

This document summarizes the change that replaced the demo pixel canvas with a
collaborative rough.js drawing board, while keeping the original Cloudflare
Durable Object multiplayer architecture.

## Goal

Take the standalone rough.js drawing playground
(`rough-drawing-playground-index.html`) and make it the app's canvas, synced live
across everyone in a room — reusing the same multiplayer model the pixel demo
used.

## Multiplayer architecture (unchanged in spirit)

The original pixel demo's model is preserved:

- **One Durable Object per room** — addressed via `?room=name` (defaults to `main`).
- **WebSocket Hibernation API** — `state.acceptWebSocket()` plus
  `webSocketMessage` / `webSocketClose` handlers.
- **SQLite-backed authoritative state** — every mutation is persisted before it is
  broadcast; no in-memory cache.
- **Full sync on connect** — a new client immediately receives the entire state.
- **Presence** — derived from the live WebSocket connection count.

What changed is the *unit of state*: **pixels → vector shapes**.

## Server — `src/index.ts`

- Storage is now a `shapes` table (`id TEXT`, `ord INTEGER`, `data TEXT`) instead
  of `pixels`. `ord` preserves insertion order so z-stacking stays stable across
  clients.
- Shape-oriented protocol:
  - Client → server: `add`, `update`, `remove`, `replace` (used for undo), `clear`.
  - Server → client: `sync`, `add`, `update`, `remove`, `replace`, `clear`, `count`.
- `add` / `update` upsert by id: `update` edits in place (keeps z-order), `add`
  appends at the end of the order.
- Validation: each shape must have a bounded string `id`, a `type` in the
  renderer's allow-list (`smart`, `curve`, `line`, `rectangle`, `ellipse`, `text`),
  and object `geom` / `options`. `geom`/`options` are otherwise opaque to the
  server. A room is capped at `MAX_SHAPES = 5000`.
- Mutations are broadcast to **everyone except the sender** (clients apply their
  own changes optimistically), and presence rides on connect/close as before.
- Minor type fix: dropped the unused generic on `DurableObjectNamespace<CanvasRoom>`
  in the `Env` interface — it never type-checked (missing the DO brand).

## Client — `public/index.html`

- The pixel-grid UI was replaced entirely with the rough.js canvas from
  `rough-drawing-playground-index.html`: Smart / Select / Hand / Text tools, shape
  recognition, smart fills, PNG/SVG export, and undo.
- **Globally-unique shape ids** via `crypto.randomUUID()` instead of the
  playground's per-client integer counter — otherwise two clients would each mint
  id `1` and collide.
- A `net` layer (WebSocket connect + auto-reconnect) is wired into every mutation
  site:
  - stroke committed → `add`
  - smart-fill applied → `update`
  - hand-drag finished → `update` (per moved shape)
  - text committed → `add`
  - undo → `replace` (full shape list)
  - clear → `clear`
- Incoming remote ops are applied to the local shape list **without**
  re-broadcasting, then the canvas redraws.
- On connect, the server's `sync` replaces local state. `localStorage` is kept only
  as a fast-paint cache for instant first render.
- Added a connection/presence status chip in the top-right corner.

## Verification

- `npm run check` (`tsc --noEmit`) passes.
- An end-to-end test ran 2–4 simultaneous WebSocket clients against
  `wrangler dev` and confirmed all of the following (11/11 assertions passed):
  - new client receives `sync` on connect, initially empty
  - presence count rises as clients join
  - an added shape reaches other clients, and the sender does **not** get an echo
  - `update` propagates
  - a late-joining client receives the persisted, updated shape via `sync`
    (persistence)
  - invalid shape types are rejected
  - `clear` propagates, and a client joining afterward sees an empty canvas

## Testing it manually

After `npm run dev` (or deploy):

1. **Live sync** — open two tabs; draw in one, watch it appear in the other.
2. **Persistence** — draw, close all tabs, reopen — the drawing is still there.
3. **Presence** — the "N people here" chip changes as tabs open/close.
4. **Rooms** — add `?room=yourname` to the URL for a separate canvas.

## Files

- `src/index.ts` — Worker entry point + `CanvasRoom` Durable Object (shape sync).
- `public/index.html` — collaborative rough.js drawing client.
- `rough-drawing-playground-index.html` — original standalone playground (kept as
  the source reference; not used by the app).
