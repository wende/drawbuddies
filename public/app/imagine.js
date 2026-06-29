// "Imagine" tool: prompt -> server LLM -> SVG -> svgtorough.js -> shapes.
//
// Generation runs in the background (a spinning placeholder is drawn in world
// space) so the user can keep drawing/moving while one or more imaginings are in
// flight. Each finished imagining becomes a single "group" shape.

import { ctx, newId, newSeed, state } from "./state.js";
import { cameraOffset, mergeBoxBounds, worldToScreen } from "./geometry.js";
import { buildDrawable, currentOptions, save, serializeShape, shapeBounds } from "./shapes.js";
import { translateGeom } from "./transforms.js";
import { recordHistory } from "./history.js";
import { net } from "./net.js";
import { redraw } from "./render.js";
import { previewShape } from "./input.js";

// LLM SVGs use a 512×512 viewBox with no client-side dimension cap; scale
// down so imports don't dominate the canvas (users can scale up afterward).
const IMAGINE_DEFAULT_SCALE = 0.5;

// In-flight imaginings, shared with render.js so the spinner draws each frame.
export const pendingImagines = [];
let imagineFrameId = null;
let imaginePromptEl = null;

// Boundary to public/svgtorough.js. Must return an array of shapes shaped
// like { type, geom, options? } (id/options are filled in if omitted).
function svgToShapes(svg) {
  if (typeof window.svgToShapes === "function") {
    return window.svgToShapes(svg);
  }
  throw new Error("SVG converter failed to load");
}

// Combined bounding box of a list of shapes in world coords (or null).
function shapesBoundingBox(list) {
  return mergeBoxBounds(list.map(shapeBounds));
}

// Translate a batch so its combined bounding box centers on `target` (world).
// Reuses translateGeom so every geom form (incl. path ox/oy) shifts correctly.
function centerShapesAt(list, target) {
  const box = shapesBoundingBox(list);
  if (!box) return;
  const dx = target.x - (box.minX + box.maxX) / 2;
  const dy = target.y - (box.minY + box.maxY) / 2;
  for (const shape of list) shape.geom = translateGeom(shape.geom, dx, dy);
}

function viewCenter() {
  const cam = cameraOffset();
  return { x: cam.x + state.viewWidth / 2, y: cam.y + state.viewHeight / 2 };
}

// Bundle the converter's shapes into a single "group" so the whole imagined
// drawing behaves as one object (select/move/delete/undo as a unit), then
// center it in view, insert it, and sync to peers — all as one undo step.
function addImaginedShapes(incoming, target) {
  const children = (incoming || [])
    .filter((s) => s && s.geom && typeof s.type === "string")
    .map((s) => ({
      type: s.type,
      geom: s.geom,
      options: s.options || currentOptions(newSeed())
    }))
    .slice(0, 500);
  if (!children.length) return 0;

  const group = {
    id: newId(),
    type: "group",
    geom: { ox: 0, oy: 0, scale: IMAGINE_DEFAULT_SCALE, children },
    options: currentOptions(newSeed()),
    drawable: null
  };

  centerShapesAt([group], target || viewCenter());

  recordHistory();
  group.drawable = buildDrawable(group);
  state.shapes.push(group);
  net.send({ type: "add", shape: serializeShape(group) });
  save();
  redraw();
  return children.length;
}

// --- Inline prompt (opens where the user clicked in "Imagine" mode) -------

export function closeImaginePrompt() {
  if (imaginePromptEl) {
    imaginePromptEl.remove();
    imaginePromptEl = null;
  }
}

export function openImaginePrompt(point) {
  closeImaginePrompt();

  const wrap = document.createElement("div");
  wrap.className = "imagine-prompt";
  const screen = worldToScreen(point);
  const left = Math.max(12, Math.min(screen.x, state.viewWidth - 360));
  const top = Math.max(12, Math.min(screen.y, state.viewHeight - 60));
  wrap.style.left = `${Math.round(left)}px`;
  wrap.style.top = `${Math.round(top)}px`;
  wrap.style.bottom = "auto";
  wrap.style.transform = "none";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Describe something to draw…";
  input.maxLength = 500;
  wrap.append(input);
  document.body.appendChild(wrap);
  imaginePromptEl = wrap;

  const submit = () => {
    const prompt = input.value.trim();
    if (!prompt) return;
    closeImaginePrompt();
    startImagine(prompt, point);
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeImaginePrompt();
    }
  });
  input.addEventListener("blur", () => {
    if (!input.value.trim()) closeImaginePrompt();
  });

  requestAnimationFrame(() => input.focus());
}

// --- Async generation: spinning placeholder anchored in world space -------

function imagineTick() {
  imagineFrameId = null;
  if (!pendingImagines.length) return;
  redraw(previewShape());
  imagineFrameId = requestAnimationFrame(imagineTick);
}

function ensureImagineLoop() {
  if (imagineFrameId === null && pendingImagines.length) {
    imagineFrameId = requestAnimationFrame(imagineTick);
  }
}

function stopImagineLoopIfIdle() {
  if (!pendingImagines.length && imagineFrameId !== null) {
    cancelAnimationFrame(imagineFrameId);
    imagineFrameId = null;
  }
}

function removePending(id) {
  const idx = pendingImagines.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  pendingImagines.splice(idx, 1);
  return true;
}

// A hand-drawn rough.js arc that spins in place while generating.
export function drawImagineSpinners(now) {
  const r = 26;
  const angle = (now / 600) % (Math.PI * 2);
  for (const pending of pendingImagines) {
    ctx.save();
    ctx.translate(pending.x, pending.y);
    ctx.rotate(angle);
    state.rc.arc(0, 0, r * 2, r * 2, -Math.PI / 2, Math.PI, false, {
      stroke: "#7a5cff",
      strokeWidth: 3,
      roughness: 1.8,
      bowing: 2,
      seed: pending.seed
    });
    ctx.restore();
  }
}

function flashImagineError(point, message) {
  const screen = worldToScreen(point);
  const toast = document.createElement("div");
  toast.className = "imagine-toast";
  toast.textContent = message;
  toast.style.left = `${Math.round(Math.max(12, Math.min(screen.x, state.viewWidth - 200)))}px`;
  toast.style.top = `${Math.round(Math.max(12, Math.min(screen.y, state.viewHeight - 40)))}px`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

export function startImagine(prompt, point) {
  const pending = {
    id: newId(),
    x: point.x,
    y: point.y,
    seed: newSeed()
  };
  pendingImagines.push(pending);
  ensureImagineLoop();
  redraw();

  fetchImagineSvg(prompt)
    .then((svg) => {
      if (!removePending(pending.id)) return; // already cancelled
      const count = addImaginedShapes(svgToShapes(svg), { x: pending.x, y: pending.y });
      if (!count) flashImagineError(pending, "Nothing to draw from that");
    })
    .catch((err) => {
      if (!removePending(pending.id)) return;
      flashImagineError(pending, (err && err.message) || "Imagine failed");
    })
    .finally(() => {
      stopImagineLoopIfIdle();
      redraw();
    });
}

async function fetchImagineSvg(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);

  let res;
  try {
    res = await fetch("/imagine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal
    });
  } catch (err) {
    throw new Error(err && err.name === "AbortError" ? "Timed out" : "Network error");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let msg = "Request failed";
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }

  const { svg } = await res.json();
  if (!svg) throw new Error("No SVG returned");
  return svg;
}
