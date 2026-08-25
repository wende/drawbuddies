// Rough.js skin layer for screen-space DOM UI.
//
// The cost of rough.js is *generation*, not drawing, so nothing here is
// generated more than once per (shape, size, seed, options) tuple. Three tiers,
// matching docs/ui-architecture.md:
//
//   Tier 1  bakeSprite()    -> a data-URI for `background-image`. Zero added DOM
//                              nodes. For fixed-size, repeated, static widgets.
//   Tier 2  registerSprite() -> geometry in a shared <defs>, referenced by
//           useSprite()        <use>. Paths are rewritten to `currentColor` /
//                              `var(--skin-fill)` so hover/active/disabled are a
//                              pure CSS repaint and the wobble never re-rolls.
//   Tier 3  nineSlice()     -> a `border-image` sprite for resizable panels.
//
// Deliberately standalone: it reads `window.rough` rather than importing
// state.js, so the widget lab can load it without the app's canvas being present.

const NS = "http://www.w3.org/2000/svg";

export const stats = { generations: 0, cacheHits: 0, ms: 0 };

export function resetStats() {
  stats.generations = 0;
  stats.cacheHits = 0;
  stats.ms = 0;
}

const cache = new Map();

function rough() {
  if (!window.rough) throw new Error("rough.js is not loaded");
  return window.rough;
}

// Rough's wobble overshoots the nominal box by roughly `roughness` in each
// direction, and half a stroke on top. Inset by that much or the sprite clips.
function padFor(options) {
  const roughness = options.roughness ?? 1;
  const strokeWidth = options.strokeWidth ?? 1;
  return Math.ceil(roughness * 2 + strokeWidth * 1.5 + 1);
}

function keyOf(shape, w, h, options, seed) {
  return `${shape}|${w}x${h}|${seed}|${JSON.stringify(options)}`;
}

function generate(shape, w, h, options, seed) {
  const started = performance.now();

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  const rc = rough().svg(svg);
  const pad = padFor(options);
  const opts = { ...options, seed };

  let node;
  if (shape === "ellipse") {
    node = rc.ellipse(w / 2, h / 2, w - pad * 2, h - pad * 2, opts);
  } else if (shape === "line") {
    node = rc.line(pad, h / 2, w - pad, h / 2, opts);
  } else {
    node = rc.rectangle(pad, pad, w - pad * 2, h - pad * 2, opts);
  }
  svg.append(node);

  stats.generations += 1;
  stats.ms += performance.now() - started;
  return svg;
}

/**
 * Tier 1 — bake to a data-URI usable as `background-image`.
 * Returns a ready-to-assign `url("data:image/svg+xml,…")` string.
 */
export function bakeSprite(shape, w, h, options = {}, seed = 1) {
  const key = `css|${keyOf(shape, w, h, options, seed)}`;
  const hit = cache.get(key);
  if (hit) {
    stats.cacheHits += 1;
    return hit;
  }

  const svg = generate(shape, w, h, options, seed);
  const markup = new XMLSerializer().serializeToString(svg);
  const css = `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
  cache.set(key, css);
  return css;
}

// Swap rough's baked-in colors for CSS-drivable ones, so a state change is a
// repaint rather than a regeneration.
function themeable(node) {
  for (const path of node.querySelectorAll("path")) {
    const stroke = path.getAttribute("stroke");
    const fill = path.getAttribute("fill");
    if (stroke && stroke !== "none") path.setAttribute("stroke", "currentColor");
    if (fill && fill !== "none") path.setAttribute("fill", "var(--skin-fill, transparent)");
  }
  return node;
}

let defsHost = null;

function ensureDefsHost() {
  if (defsHost) return defsHost;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  const defs = document.createElementNS(NS, "defs");
  svg.append(defs);
  document.body.append(svg);
  defsHost = defs;
  return defs;
}

/**
 * Tier 2 — register geometry once in a shared <defs> under `id`.
 * Idempotent: registering the same id twice generates nothing the second time.
 */
export function registerSprite(id, shape, w, h, options = {}, seed = 1) {
  const defs = ensureDefsHost();
  if (defs.querySelector(`#${CSS.escape(id)}`)) {
    stats.cacheHits += 1;
    return id;
  }

  const generated = generate(shape, w, h, options, seed);
  const group = generated.firstElementChild;
  group.id = id;
  defs.append(themeable(group));
  return id;
}

/** Tier 2 — an inline <svg> that references a registered sprite. */
export function useSprite(id, w, h) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("skin-svg");

  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

/**
 * Tier 2 convenience — skin an element in place. The element keeps all layout,
 * text, and interaction; the sprite sits behind it as an inert overlay.
 */
export function skin(el, { id, shape = "rectangle", w = 120, h = 40, options = {}, seed = 1 }) {
  registerSprite(id, shape, w, h, options, seed);
  el.querySelector(":scope > .skin-svg")?.remove();
  el.prepend(useSprite(id, w, h));
  el.classList.add("skinned");
  return el;
}

/**
 * Drop all cached geometry. Only needed by the widget lab, which re-renders
 * everything whenever the global rough options change. Real UI never calls this.
 */
export function clearSprites() {
  cache.clear();
  if (defsHost) defsHost.replaceChildren();
}

/**
 * Tier 3 — a sprite sized for use as `border-image`, plus the slice value.
 * Corners stay intact while the edges stretch, which is the standard answer to
 * "rough geometry does not survive being stretched".
 */
export function nineSlice(size, slice, options = {}, seed = 1) {
  return { image: bakeSprite("rectangle", size, size, options, seed), slice };
}
