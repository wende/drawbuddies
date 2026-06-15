# DrawBuddies — Collaborative Canvas

A real-time collaborative drawing board. Sketch with a hand-drawn (rough.js) look,
let the canvas recognize your shapes, and watch everything sync live to everyone
else in the room — powered by Cloudflare Workers + SQLite-backed Durable Objects
with the WebSocket Hibernation API.

The app is two largely independent layers:

1. **The drawing canvas** (`public/index.html`) — a self-contained rough.js
   sketching tool with shape recognition, smart fills, text, and export. It works
   on its own, even offline.
2. **The multiplayer layer** (`src/index.ts`) — a Durable Object that stores the
   shape list per room and relays every change to all connected clients.

The two meet at one seam: the canvas emits granular shape *operations*, the
Durable Object persists and fans them out, and remote operations are applied back
to the canvas without re-broadcasting.

---

## Part 1 — The drawing canvas

Everything here is client-side, in `public/index.html`. It renders with
[rough.js](https://roughjs.com/) onto a single full-window `<canvas>`, scaled for
high-DPI displays.

### The shape model

The whole drawing is an ordered array of shapes. Each shape is:

```js
{
  id,       // globally-unique string (crypto.randomUUID)
  type,     // "smart" | "curve" | "line" | "rectangle" | "ellipse" | "text"
  geom,     // geometry — points[] for freehand/curve, x1/y1/x2/y2 for boxes,
            //            {x, y, text, fontSize} for text
  options,  // stroke color, roughness, bowing, strokeWidth, seed, fill, fillStyle
  drawable  // cached rough.js drawable (rebuilt as needed, never persisted/sent)
}
```

`geom` and `options` are the only things that get persisted or sent over the wire;
`drawable` is a local render cache.

### Tools

The toolbar (bottom-center) has four tools:

- **Smart** — the default. You draw a freehand stroke and on release the canvas
  decides what you meant (see *Shape recognition* below). Also doubles as the
  smart-fill gesture.
- **Select** — drag a marquee; every shape fully inside it becomes the current
  selection. The selection is drawn with a dashed blue overlay.
- **Hand** — drag to move a shape. If you grab a shape that's part of the current
  selection, the entire selection moves together; otherwise just the shape under
  the cursor moves.
- **Text** — click to drop an editable text box. Uses the **Excalifont** hand-drawn
  font (loaded from a CDN, with a graceful fallback). `Enter` commits, `Shift+Enter`
  adds a newline, `Esc` cancels.

### Stroke style controls

- **Stroke** — color picker for the current shape.
- **Rough** (roughness, 0–4) — how scratchy/irregular the strokes are.
- **Bow** (bowing, 0–10) — how much straight lines bend.
- **Width** (1–14) — stroke thickness.

These apply to whatever you draw next; existing shapes keep the options they were
created with.

### Shape recognition (the "Smart" tool)

When you finish a Smart stroke, the raw points run through a recognition pipeline
(all heuristic, all local):

1. **Pre-processing** — points are simplified (distance threshold), reduced with
   Douglas–Peucker, and re-sampled so the analysis isn't biased by drawing speed.
2. **Line** — if the stroke is straight enough (direct-distance / path-length ratio
   plus max/mean deviation from the ideal line), it snaps to a straight line.
3. **Rectangle** — checks how tightly points hug an axis-aligned bounding box, that
   all four sides are covered, that there are ~3+ corners (corner-angle evidence),
   and that edges are axis-aligned straight runs.
4. **Ellipse** — checks the normalized radius error around the bounding-box center,
   that all four quadrants are covered, and that the middle isn't filled in.
5. **Ambiguity resolution** — when both rectangle and ellipse plausibly match,
   a scorer (`chooseClosedShapeCandidate`) compares fit scores and corner evidence
   to pick one.
6. **Curve** — if it's none of the above but is a smooth, gently-curving open arc
   (low sharp-turn ratio, few direction reversals), it becomes a smoothed rough.js
   curve.
7. **Fallback** — otherwise it's kept as the raw freehand `smart` stroke (smoothed).

The result: scribble a rough box and it cleans up into a crisp rectangle; draw an
arc and it becomes a tidy curve; doodle freely and it stays freehand.

### Smart fills

Still using the Smart tool, scribble *inside* an existing rectangle or ellipse and
the canvas interprets it as a fill gesture instead of a new shape:

- `findFillTargetForStroke` finds a rect/ellipse that contains ~92%+ of the stroke.
- `fillStrokeLooksIntentional` guards against accidents (the scribble must be dense
  enough, large enough relative to the target, and have enough turns).
- `inferSmartFillStyle` reads the gesture: zig-zaggy strokes → `zigzag` fill,
  back-and-forth shading → `hachure`.
- Scribbling again on an already-filled shape escalates the style
  (`hachure → cross-hatch → solid`).

The fill color is the current stroke color.

### Z-ordering

Shapes aren't drawn purely in creation order — `shapeZRank` layers them so fills
sit behind outlines and text sits on top:

```
solid fill (0) → zigzag/dots (1) → cross-hatch (2) → hachure (3)
              → unfilled strokes/outlines (4) → text (5)
```

Within the same rank, insertion order wins. This ranking is applied at render time
on every client, so stacking looks the same for everyone.

### Selection & moving

- **Select** builds a selection from a marquee (fully-contained shapes only).
- **Hand** moves the shape under the cursor, or the whole selection if you grab a
  selected shape. Geometry is translated live during the drag; the move is only
  committed (saved + synced) once you actually move past a small threshold.
- Hit-testing is type-aware: filled shapes are grabbable anywhere inside, unfilled
  ones only near their outline; lines and freehand use distance-to-polyline; text
  uses its measured bounding box.

### Undo, clear, history

- **Undo** (`Cmd/Ctrl+Z` or the button) pops a snapshot off a 100-deep history
  stack and restores it. If history is empty it just removes the last shape.
- **Clear** wipes the canvas (after recording history so it can be undone locally).

Undo and clear both broadcast (see below), so they reach everyone.

### Export

- **Export PNG** — rasterizes the current canvas via `canvas.toBlob`.
- **Export SVG** — re-renders every shape as vector SVG with `rough.svg`, including
  an embedded `@font-face` for the text font, on the same paper-colored background.

### Local persistence

The drawing is mirrored to `localStorage` (`drawbuddies:v2`) on every
change. This is **only a fast-paint cache** so the canvas isn't blank for the split
second before the server sync arrives — the server is the source of truth, and its
`sync` message replaces local state on connect.

---

## Part 2 — The multiplayer layer

All shared-state logic lives in `src/index.ts`, in the `CanvasRoom` Durable Object.
This is the only file to edit if you want to change how state is stored or synced.

### Core ideas

- **One Durable Object per room** — addressed via the `?room=name` query param
  (defaults to `"main"`). Each room is a fully isolated canvas.
- **WebSocket Hibernation API** — connections are accepted with
  `state.acceptWebSocket()`; messages arrive via `webSocketMessage` and
  disconnects via `webSocketClose`. The DO can hibernate between messages without
  dropping sockets, so idle rooms cost nothing.
- **SQLite-backed authoritative state** — every shape lives in a `shapes` table in
  `state.storage.sql`. There is **no in-memory cache**; state is read from SQLite
  on each connect. Every mutation is persisted *before* it's broadcast.
- **Full sync on connect** — a new client immediately receives the entire shape
  list plus the current presence count.
- **Presence** — derived purely from the live WebSocket connection count
  (`state.getWebSockets().length`), re-broadcast whenever someone joins or leaves.

### Storage schema

```sql
CREATE TABLE IF NOT EXISTS shapes (
  id   TEXT PRIMARY KEY,   -- the shape's globally-unique id
  ord  INTEGER NOT NULL,   -- insertion order, keeps z-stacking stable across clients
  data TEXT NOT NULL       -- JSON: { id, type, geom, options }
);
```

`ord` matters: when a shape is *updated*, its `ord` is preserved so it doesn't jump
in the stack; when *added*, it goes to the end (`MAX(ord)+1`); a full *replace*
re-assigns `ord` by array index.

### The protocol

**Client → server**

| Message | Meaning |
|---|---|
| `add`     | a new shape was created (`{ shape }`) |
| `update`  | an existing shape changed in place — moved, recolored, filled (`{ shape }`) |
| `remove`  | delete a shape by id (`{ id }`) |
| `replace` | replace the whole list (used by undo) (`{ shapes }`) |
| `clear`   | wipe the room |

**Server → client**

| Message | Meaning |
|---|---|
| `sync`    | full state on connect (`{ shapes, count }`) |
| `add` / `update` / `remove` / `replace` / `clear` | a relayed mutation from another client |
| `count`   | updated presence count (`{ count }`) |

`add`/`update` are an **upsert** by id: update edits the row in place (keeping its
z-order), add appends.

### Validation & limits

Every incoming shape passes through `sanitizeShape`:

- `id` must be a string, 1–128 chars.
- `type` must be in the renderer's allow-list
  (`smart`, `curve`, `line`, `rectangle`, `ellipse`, `text`).
- `geom` and `options` must be objects — but their *contents* are opaque to the
  server. The server never interprets geometry; it just stores and relays it.

A room is capped at `MAX_SHAPES = 5000`. Malformed JSON and unknown message types
are silently ignored.

### Broadcast model (optimistic, no echo)

Clients apply their own changes immediately (optimistic UI), so the server relays
each mutation to **everyone except the sender** (`broadcastExcept`). Presence
(`count`) goes to everyone. There's no server-side conflict resolution beyond
last-writer-wins per shape id — which is why globally-unique ids matter.

### Request routing (`src/index.ts` Worker entry)

- A request with an `Upgrade: websocket` header (or path `/ws`) is routed to the
  Durable Object for its room (`idFromName(roomName)`).
- Everything else is served as a static asset from `public/` via the `ASSETS`
  binding.

---

## Part 3 — How they connect

The client's `net` layer (an IIFE near the bottom of `public/index.html`):

- Opens a WebSocket to `/ws?room=...`, with **auto-reconnect** (retries every 1s on
  close) and a connection/presence status chip in the top-right corner.
- **Sends** an op at each mutation site:

  | User action | Message sent |
  |---|---|
  | Finish a stroke / recognized shape | `add` |
  | Commit text | `add` |
  | Smart-fill applied | `update` |
  | Finish moving shape(s) with Hand | `update` (one per moved shape) |
  | Undo | `replace` (the full shape list) |
  | Clear | `clear` |

- **Receives** ops via `handle()` and applies them through dedicated
  `applyRemote*` functions (`applyRemoteUpsert`, `applyRemoteRemove`,
  `applyRemoteReplace`, `applyRemoteClear`). These update the local shape list and
  redraw **without** sending anything back — so remote changes never echo.
- On `sync`, the server's shape list **replaces** local state and the presence
  count is shown.

Because ids are minted with `crypto.randomUUID()` per shape, two people drawing at
the same time never collide on an id, and updates/moves always target the right
shape on every client.

---

## Project structure

```
.
├── src/
│   └── index.ts          # Worker entry + CanvasRoom Durable Object (multiplayer)
├── public/
│   └── index.html        # The rough.js collaborative drawing client
├── docs/
│   └── rough-canvas-multiplayer.md   # design notes on the pixel→shape conversion
├── rough-drawing-playground-index.html  # original standalone playground (reference)
├── wrangler.jsonc        # Cloudflare config (DO binding, migration, assets)
├── tsconfig.json
└── package.json
```

## Develop & deploy

```bash
npm install
npm run dev      # wrangler dev — serves the client + runs the DO locally
npm run check    # tsc --noEmit — type-check the Worker
npm run deploy   # wrangler deploy
```

After deploying, the app is at `https://drawbuddies.YOUR_SUBDOMAIN.workers.dev`.

## How to test it

1. **Live sync** — open two tabs side by side; draw in one, watch it appear in the
   other within ~1s.
2. **Persistence** — draw something, close all tabs, reopen later — it's still
   there (state lives in SQLite, not memory).
3. **Presence** — the "N people here" chip rises and falls as tabs open and close.
4. **Rooms** — append `?room=yourname` to the URL for a separate, isolated canvas.
5. **Recognition** — with the Smart tool, scribble a rough box/circle/line and
   watch it snap; scribble inside a shape to fill it.

## Free-tier cost notes

- **Durable Objects** and **SQLite storage** are included in the free Workers plan.
- **WebSocket messages** are billed at a 20:1 ratio (20 messages = 1 request unit);
  optimistic-apply + broadcast-except-sender keeps message volume low.
- Typical collaborative use fits comfortably within free limits.
