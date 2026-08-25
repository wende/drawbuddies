# DrawBuddies — UI Architecture (rough.js: canvas or DOM?)

Design research for building a **full game-style UI** on top of the existing
rough.js board: inventory grids, progress/cooldown bars, text input, panels,
tooltips, menus. The question this document answers is which renderer the UI
layer should use — the `<canvas>` we already draw the world on, or DOM.

**Decision: DOM, skinned with rough.js in SVG mode. Canvas is reserved for
world-space UI only.**

---

## The rule: split by coordinate space, not by aesthetics

The dividing line is not "which looks more hand-drawn" — rough.js renders
identically to either target. It is **which coordinate space the element lives
in**.

| Lives in | Examples | Renderer |
| --- | --- | --- |
| **Screen space** — fixed to the viewport, unaffected by camera | toolbar, inventory grid, progress bars, dialogs, menus, tooltips, text input, HUD counters | **DOM + `rough.svg()`** |
| **World space** — pans and zooms with the board | speech bubbles, name tags, remote cursors, selection handles, avatar decorations, the hand-tool trash can | **canvas + `rough.canvas()`** |

The codebase already follows this split. `public/app/render.js` draws all
world-space content through `state.rc` (`rough.canvas(canvas)`), while the
toolbar, hint bar, and avatar overlay in `public/index.html` are DOM. The avatar
editor is the clearest precedent: a **DOM overlay** that wraps its **own rough
canvas** for the world-ish drawing surface, and reaches for a real `<textarea>`
the moment it needs text entry (`public/app/avatar-editor.js:441`).

Nothing structural needs to change. What changes is that the DOM half gets a
rough skin instead of plain CSS borders.

---

## Why DOM, specifically at game-UI scale

The three features that motivated the question are the three things canvas is
worst at.

### Inventory grid → you would be writing a layout engine

CSS Grid expresses a responsive inventory in one declaration. On canvas you own,
from scratch: grid flow and reflow, a scroll container with clipping and
momentum, drag-and-drop hit regions, tooltips that flip near viewport edges,
focus order, and a hover/active state machine. This is the cost nobody budgets
for, and it dwarfs the rendering work.

### Text input → non-negotiable DOM

Caret placement, selection, IME composition, mobile soft keyboards, clipboard,
per-field undo, RTL. Every serious canvas UI ends up positioning a hidden
`<input>` off-screen and mirroring it — which means paying canvas's costs *and*
keeping DOM's. Excalidraw does this; so does the avatar editor already.

### Progress bars → the cost is regeneration, not the renderer

What makes a hand-drawn bar expensive is calling rough on every frame, and the
fix (clip a pre-generated fill — see below) is identical on canvas and in DOM.
DOM loses nothing here.

---

## Architecture: pre-render, never regenerate

> **Superseded approach.** An early sketch of this design skinned each element
> individually — a `ResizeObserver` per widget calling `rough.svg()` on every
> layout change. That is fine for a dozen chrome elements and **wrong at game-UI
> scale**: a 60-slot inventory would issue 60 generation calls per resize.

Rough's cost is **generation**, not drawing. So generate once and reuse. Three
tiers, chosen by widget type:

### Tier 1 — Fixed-size and repeated → bake to a data-URI

Inventory slots, hotbar cells, buttons, badges. Serialize a generated SVG once
and use it as a CSS `background-image`. **Zero added DOM nodes per widget**, and
the browser decodes each sprite a single time.

```js
const NS = "http://www.w3.org/2000/svg";

function bakeSprite(w, h, opts, seed) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.append(rough.svg(svg).rectangle(2, 2, w - 4, h - 4, { ...opts, seed }));
  const markup = new XMLSerializer().serializeToString(svg);
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

// 4 seed variants so a 60-slot grid does not look rubber-stamped
const SLOT = Array.from({ length: 4 }, (_, i) => bakeSprite(64, 64, SLOT_OPTS, 1000 + i));
```

Assign by `index % 4`. Sixty slots cost **four** rough calls and **no** extra
DOM.

> **Found while building the lab:** a Tier 1 sprite **cannot be recoloured by
> CSS**. A data-URI is an isolated document, so `currentColor` and
> `var(--token)` inside it have no host to resolve against — `currentColor`
> falls back to black and custom properties resolve to nothing. Every colour a
> Tier 1 sprite uses has to be baked in at generation time, which means one
> sprite per colour. That is fine when the colour set is small and fixed (four
> bar colours, three rarity tiers); the moment colour is genuinely dynamic, the
> widget belongs in Tier 2. This is the real dividing line between the tiers, not
> just "does it need hover styling".

### Tier 2 — Needs CSS-driven state → shared `<defs>` + `<use>`

Anything whose colour changes on hover, selection, disabled, or item rarity. One
hidden `<svg>` holds the generated geometry as `<g id="slot-0">` … `<g
id="slot-3">`; each widget inlines `<svg><use href="#slot-2"/></svg>`.

Set the generated paths to `stroke="currentColor"` and `fill="var(--slot-fill)"`
so every state change is a pure CSS repaint. Geometry is never regenerated, so
the wobble never shivers.

### Tier 3 — Arbitrarily resizable → 9-slice

Panels, dialogs, tooltips. Rough geometry does not survive naive stretching —
which is precisely the problem 9-slice was invented for. Bake corner and edge
tiles, then use `border-image` with an SVG data-URI and a correct
`border-image-slice`: corners stay intact, edges tile. Debounced regeneration is
the fallback for the few panels where 9-slice reads wrong.

Whether stretched rough edges actually *look* right is a judgement call, not
something to settle on paper, so both approaches sit side by side and resizable
in the widget lab (`public/lab/`, "Resizable panels") with their costs displayed.
Drag both and pick.

---

## Per-widget recipes

### Progress and cooldown bars — clip, don't regenerate

Generate the track and a **full-width** fill once. Animate by clipping:

```css
@property --pct { syntax: '<percentage>'; inherits: false; initial-value: 0%; }

.bar-fill { clip-path: inset(0 calc(100% - var(--pct)) 0 0); transition: --pct 420ms ease; }
```

Registering `--pct` with `@property` is what makes the transition animate at all
— an unregistered custom property jumps rather than tweens.

> **Found while building the lab:** `inherits: false` means `--pct` must be set
> on **the element that owns the `clip-path`**, not its parent. Setting it on the
> wrapping `.bar` looks right, changes nothing, and silently leaves the fill
> clipped to the `0%` initial value — a bar that renders as an empty track with
> no error anywhere. Either set it on `.bar-fill` directly or declare
> `inherits: true`.

Paint-only, no layout, no rough calls, 60fps. Critically, the fill's wobble stays
**anchored** — the strokes do not crawl as the bar advances, which is what
per-frame regeneration looks like and it reads as a rendering bug. The same trick
with an SVG `<clipPath>` wedge gives radial cooldown sweeps.

### Inventory grid

CSS Grid for layout, Tier 1 sprites for slot chrome, `transform: translate3d()`
for the dragged item (one element, not a re-layout). Put `contain: layout paint`
on slots so hover does not recalc the tree. Avoid the HTML5 drag-and-drop API;
pointer events give better control and work on touch.

### Text input

A real `<input>` / `<textarea>` with Excalifont, sitting inside a Tier 3 rough
frame. Never draw UI text to canvas: it forfeits selection, IME, accessibility,
and font-fallback line breaking.

### Optional "alive sketch" shimmer

If the UI should visibly breathe, cycle **3 pre-baked seed variants at 6–8fps**.
Never regenerate per frame, and gate the whole effect behind
`prefers-reduced-motion`.

---

## Seeding rules

Two rules decide whether this reads as crafted or cheap:

1. **Pin the seed per widget.** Derive it from a stable id, never from render
   order or a fresh `rough.newSeed()` on each pass. Regenerating geometry on
   hover or resize makes the UI visibly shiver — this is the single largest
   quality difference, and it is why Excalidraw pins seeds.
2. **State changes never re-roll geometry.** Hover, active, and disabled change
   `stroke`, `stroke-width`, and fill on the *existing* paths via CSS. Same seed,
   different paint.

Two more that matter for performance and fidelity:

3. **`fillStyle: "solid"` on anything panel-sized.** Hachure on a 900px panel
   emits hundreds of segments. Reserve hachure for small accents — an active-tool
   badge, a rarity swatch.
4. **Never scale a rough SVG with a CSS transform.** Stroke weights distort.
   Re-bake at the target size, or set `vector-effect: non-scaling-stroke`.

---

## What DOM costs us

Stated plainly, so the trade is deliberate:

- **Coarse z-ordering.** Screen-space UI always composites above the world
  canvas; UI and world content cannot interleave. (World-space UI belongs on
  canvas anyway, so this is mostly a non-issue.)
- **Excluded from export.** The PNG/SVG export captures the canvas, so UI chrome
  never appears in it. This is usually a feature, occasionally a limitation.
- **Screen juice is more awkward.** Shake, hit-flash, and particle bursts behind
  panels fight the compositor more than they would on canvas.

Mitigations: animate only `transform`, `opacity`, and `clip-path`; apply
`contain: layout paint` to repeated widgets; keep per-frame writes off the
layout-triggering properties.

---

## When to switch to canvas

Concrete criteria, not taste:

- The UI must live **inside the camera transform** — diegetic panels pinned to
  the board, or UI other players can see. That is world-space by definition, so
  the coordinate-space rule already routes it to canvas.
- **Thousands** of simultaneously animating elements. An inventory grid is ~10²,
  not 10⁴.
- The UI must appear in exports or screen recordings.

None of these hold for the UI described here.

If canvas UI ever does become necessary, do not hand-roll it — use PixiJS plus a
layout library — and expect to keep a hidden DOM input for text regardless.

---

## Implementation notes for this codebase

- `rough.svg()` and `rough.generator()` are both available: `public/index.html:668`
  loads the **full** roughjs bundle from CDN, and `public/app/state.js` already
  re-exports `window.rough` plus a `rough.newSeed()` helper.
- `public/app/rough-skin.js` implements all three tiers: `bakeSprite()` with a
  cache keyed by `(shape, w, h, seed, opts)`, a `<defs>` registry behind
  `registerSprite()` / `useSprite()` / `skin()`, and `nineSlice()`. It reads
  `window.rough` directly rather than importing `state.js`, so it loads without
  the app's canvas being present.
- `public/lab/` is the widget lab: a static gallery for prototyping elements in
  isolation, with live rough controls and a generation-count readout. Adding an
  element is one module in `public/lab/elements/` plus one line in its
  `index.js`. It is deployed per-branch to Vercel via `vercel.json` and needs no
  Worker, so it runs anywhere static.
- `tests/widget-lab.spec.ts` locks the cost claims in: if anyone reintroduces
  per-element generation, the inventory-grid assertion fails.
- Existing CSS to strip once skinning lands: the `border`, `background`, and
  `border-radius` declarations on `.toolbar`, `button`, `.hint`, and the avatar
  overlay in `public/index.html`.
- Leave `input[type="range"]` on native CSS. Sliders are the fiddly case and the
  payoff is small.
- Highest-value first conversions: the avatar overlay and the toolbar.
