# DrawBuddies — Multiplayer Conversion

This document summarizes the change that replaced the demo pixel canvas with a
collaborative rough.js drawing board, while keeping the original Cloudflare
Durable Object multiplayer architecture.

## Goal

Take the standalone rough.js drawing playground and make it the app's canvas,
synced live across everyone in a room — reusing the same multiplayer model the
pixel demo used.

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

- The pixel-grid UI was replaced entirely with the rough.js canvas: Smart / Select
  / Hand / Text tools, shape recognition, smart fills, PNG/SVG export, and undo.
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
- On connect, the server's `sync` replaces local state and the current player list.
  `localStorage` is kept only as a fast-paint cache for instant first render.
- Added a connection/presence status chip in the top-right corner.

## Player presence and movement (added)

The canvas is now an **infinite world** shared by moving player characters.

### Camera / coordinate system

Every draw call is preceded by `ctx.translate(-camera.x, -camera.y)` so shapes
render at their world coordinates. `screenToWorld` / `worldToScreen` helpers keep
pointer events and DOM-positioned elements (text editor, avatar overlay) consistent.

The local player is always centered on-screen. `PLAYER_SPEED = 220 px/s` with
delta-time clamped to 50 ms keeps movement smooth and prevents teleporting after
a tab is backgrounded.

### WASD movement

- `keydown` / `keyup` feed a `pressedMovementKeys` Set; `movementVector()` derives
  a normalized direction and a `moving` boolean from it.
- A `requestAnimationFrame` loop (`updateMovement`) ticks while any key is held,
  advances `localPlayer.{x,y}`, and stops itself when all keys are released.
- The "WASD to move" hint appears on first load and is dismissed permanently
  (via `localStorage`) the first time the player actually moves.
- Movement keys are suppressed when the avatar editor overlay is open or when
  focus is inside an input/textarea.

### Player avatars

- Each player has an `avatar`: a list of rough.js shapes drawn inside a fixed
  260 × 360 frame. A procedural stick-figure is the default.
- **Avatar editor** — the "Avatar" button opens a modal with a mini rough.js canvas
  (same Smart / Select / Hand / Text tools, same stroke controls). "Play" previews
  the walk animation in-editor; "Okay" commits the drawing to `localPlayer.avatar`,
  persists it to `localStorage`, and broadcasts a `player-set` to the room.
- **Walk animation** — shapes whose bounding-box center falls in the `body`,
  `leftLeg`, or `rightLeg` guide zones get a per-frame canvas transform (translate
  + rotate) so the body bobs and legs stride. Right leg is 180° out of phase with
  the left. `avatarAnimationStart` resets to zero each time the player stops so the
  cycle restarts cleanly.
- Each remote player is drawn at `worldToScreen(player.{x,y})` and culled when
  off-screen. The local player is always drawn at the viewport center.

### New protocol messages

| Direction | Message | Payload | Purpose |
|-----------|---------|---------|---------|
| C→S | `player-set` | `{ player: PlayerState }` | Full avatar + position on join or avatar change |
| C→S | `player-move` | `{ id, x, y, moving }` | Lightweight position update, throttled to ≤ 20 Hz |
| S→C | `player-set` | `{ player: PlayerState }` | Relay full state from another client |
| S→C | `player-move` | `{ id, x, y, moving }` | Relay position-only update |
| S→C | `player-remove` | `{ id }` | Player disconnected |

The `sync` message now also includes `players: PlayerState[]` so late-joining
clients see everyone already in the room without waiting for a `player-set`.

### Server — `src/index.ts` additions

- New `players` SQLite table (`id TEXT PRIMARY KEY`, `connection_id TEXT`, `data TEXT`).
- `SocketAttachment` (`{ connectionId, playerId? }`) is stored via the Hibernation
  API's `serializeAttachment` / `deserializeAttachment`. This ties a live WebSocket
  to the player it registered, so the `webSocketClose` handler can delete the right
  row and broadcast `player-remove`.
- `sanitizePlayer` / `sanitizePlayerMove` — validate player id (string, 1–128 chars),
  coordinates (finite, |x|/|y| ≤ 1 000 000), avatar shapes (re-run through
  `sanitizeShape`, capped at `MAX_AVATAR_SHAPES = 250`).
- `mergePlayerMove` looks up the existing avatar when only a position update arrives,
  so the avatar is not lost on every move tick.
- Player rows survive reconnects — a second `player-set` with the same id overwrites
  the previous row. The `connection_id` column lets a future GC clean up stale rows
  left by crashed clients.

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
5. **Movement** — press WASD; your avatar walks across the shared world. The camera
   follows you. Open a second tab and watch your character appear to the other player.
6. **Avatar editor** — click "Avatar", draw a character in the modal, press "Play"
   to preview the walk cycle, then "Okay" to apply. The new avatar broadcasts to
   other connected clients immediately.
7. **Player cleanup** — close one tab; the other tab's player disappears.

## Files

- `src/index.ts` — Worker entry point + `CanvasRoom` Durable Object (shapes + players).
- `public/index.html` — collaborative rough.js drawing client with avatar system.
