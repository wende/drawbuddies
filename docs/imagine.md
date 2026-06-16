# DrawBuddies — "Imagine" (text → drawing)

The **Imagine** feature lets a user type a prompt and have an LLM generate an SVG
that is converted into native rough.js shapes and dropped onto the canvas. The
LLM call happens **server-side** in the Worker so the API key never reaches the
browser; the generated shapes flow through the existing `add` sync path, so
peers receive them with no new multiplayer code.

## User flow

1. Pick the **Imagine** tool (in the toolbar, immediately right of **Draw**).
2. Click anywhere on the canvas. An inline prompt box opens **at the click
   point**.
3. Type a description and press **Enter** (Escape, or blurring while empty,
   cancels).
4. A hand-drawn, **spinning rough.js arc** appears at that spot as a placeholder.
   Generation runs in the background — the user can switch tools and keep
   drawing, or pan with WASD, while it works. Several imaginings can be in flight
   at once, each tracking its own spot.
5. When the SVG arrives, the placeholder is replaced by the generated drawing,
   **centered on the original click point**, as a single `group` shape (so it
   moves / scales / rotates / deletes / undoes as one object).
6. On failure (network, timeout, empty result) a brief toast appears at the spot
   and clears after ~2.6s; nothing is added.

## Server — `src/index.ts`

- **`POST /imagine`** — a stateless route in the Worker `fetch` handler (it does
  not touch the Durable Object). Guards: `POST` + JSON only, non-empty `prompt`
  capped at `MAX_PROMPT_LENGTH` (500). Returns `{ svg }` on success.
- **Provider abstraction** — both Minimax and Z.ai are OpenAI-compatible chat
  completions, so `resolveProvider(env)` returns a single `LlmProvider`
  (`{ name, url, apiKey, model, disableThinking? }`) and the request/parse code is
  shared. Selection is automatic by whichever key is set, overridable with
  `IMAGINE_PROVIDER=zai|minimax`:
  - **Z.ai GLM Coding Plan** — `https://api.z.ai/api/coding/paas/v4/chat/completions`,
    model `glm-4.6`, `thinking: { type: "disabled" }` to skip slow reasoning.
  - **Minimax M3** — `https://api.minimax.io/v1/text/chatcompletion_v2`, model
    `MiniMax-M3` (a reasoning model; reply may arrive in `reasoning_content`).
- The call is wrapped in an `AbortController` (`IMAGINE_TIMEOUT_MS = 45s`),
  `max_tokens: IMAGINE_MAX_TOKENS`. The SVG is extracted from the reply (code
  fences stripped, `<svg>…</svg>` substring), and bounded by `MAX_SVG_BYTES`
  (100 KB). Upstream errors/timeouts return `502`/`504`; a missing key returns
  `503` — none leak the key or raw upstream body.
- **System prompt** instructs the model to return a single self-contained `<svg>`
  using only converter-friendly primitives
  (`path`/`line`/`rect`/`circle`/`ellipse`/`polyline`/`polygon`), a sane
  `viewBox`, and — importantly — **no `transform` attribute** (positions and
  rotations must be baked into coordinates, since the converter does not handle
  transforms).
- `'group'` is on the `SHAPE_TYPES` allow-list. `sanitizeShape` treats `geom` as
  opaque JSON, so a group's nested `children` persist and broadcast with no
  further server changes.

### Config & secrets

- `wrangler.jsonc` `vars`: `ZAI_MODEL` (`glm-4.6`), `MINIMAX_MODEL` (`MiniMax-M3`)
  — non-secret model ids only.
- API keys are **secrets**, never committed:
  - Production: `npx wrangler secret put ZAI_API_KEY` (and/or `MINIMAX_API_KEY`).
  - Local dev: put them in `.dev.vars` (gitignored). `wrangler dev` reads this
    **only at startup** — restart the dev server after adding a key.

## Converter — `public/svgtorough.js`

A standalone module that assigns `window.svgToShapes(svgText)` and returns an
array of `{ type, geom, options }` payloads. It sanitizes the SVG (drops
`script`/`foreignObject`), walks `svg`/`g` for style inheritance, and maps
elements to shapes: `rect`→`rectangle`, `circle`/`ellipse`→`ellipse`,
`line`→`line`, `polyline`/`polygon`→`path`, `path`→`path`. Transforms, text,
images, masks, clips and filters are not handled.

## Client — `public/index.html`

### The `group` shape type

Imagined drawings are stored as **one `group` shape** whose `geom.children` hold
ordinary shapes, plus a group transform `geom = { ox, oy, scale, children }`.
A child point `p` maps to world space as `scale·p + (ox, oy)`; rotation is
applied at draw time around the group center. This one type is integrated across
the client:

- `buildDrawable` builds a rough drawable per child; `drawShapeOn` translates by
  `(ox, oy)` then `context.scale(scale, scale)` so the whole drawing (including
  stroke widths) renders as a unit.
- `groupBounds` multiplies child bounds by `scale` and offset, feeding
  hit-testing, the selection overlay, `shapeBaseBounds`, and rotation pivot.
- `translateGeom` shifts `ox`/`oy`; `scaleGeom` scales about the drag pivot
  (`newScale = scale·factor`, with `ox`/`oy` adjusted so the pinned handle stays
  put); `canStoreRotation` includes `group`, so rotate-as-a-unit works for free.
- `groupScale` defaults a missing/invalid scale to `1`, so older groups remain
  movable/scalable.

### Imagine tool, prompt, and async placeholder

- The **Imagine** toolbar button is a `data-tool="imagine"` tool; selecting it
  uses the canvas crosshair cursor like the other tools.
- `onPointerDown` branches on `currentTool === "imagine"` and calls
  `openImaginePrompt(point)`, which floats an inline `<input>` at the click point
  (screen-projected, clamped to the viewport). Enter → submit, Escape/empty-blur
  → cancel.
- `startImagine(prompt, point)` pushes a `pending` entry (world `x`/`y` + a stable
  rough `seed`) to `pendingImagines` and **returns immediately** — the fetch runs
  in the background. A `requestAnimationFrame` loop (`imagineTick`) runs only
  while imaginings are pending and redraws `drawImagineSpinners`, a rough.js arc
  that spins in place (drawn in world space inside the camera transform, so it
  pans with the canvas). The loop self-stops when none remain.
- On success the placeholder is removed and `addImaginedShapes(shapes, point)`
  bundles the converter output into a `group`, centers it on the click point
  (`centerShapesAt` / `shapesBoundingBox`; `viewCenter` is the fallback), records
  one undo entry, inserts it, and sends a single `add`. On failure
  `flashImagineError` shows a transient `.imagine-toast`.

## Multiplayer & undo

No DO/server changes are needed for sync: each imagined group is one `add`,
persisted and broadcast by the existing handler, and counts as **one** shape
toward `MAX_SHAPES`. The insert records a single history entry, so one ⌘Z removes
the whole imported drawing.
