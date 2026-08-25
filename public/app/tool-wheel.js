// Walk toggle (yin-yang) + long-press radial tool picker.
// Hold still anywhere on the canvas (or on the toggle) to open a pizza-slice
// menu of drawing tools. A short tap on the toggle flips walk mode. Moving
// before the long-press delay starts the current canvas tool as usual.

import { canvas, modeSwitchEl, state } from "./state.js";
import { clearSelection } from "./shapes.js";
import { redraw } from "./render.js";
import { setInputMode } from "./input.js";

export const TOOL_WHEEL_ITEMS = [
  { tool: "smart", label: "Draw" },
  { tool: "imagine", label: "Imagine" },
  { tool: "select", label: "Select" },
  { tool: "hand", label: "Move" },
  { tool: "scale", label: "Scale" },
  { tool: "rotate", label: "Rotate" },
  { tool: "text", label: "Text" }
];

const LONG_PRESS_MS = 420;
const OPEN_DRAG_PX = 18;
const OUTER_RADIUS = 118;
const INNER_RADIUS = 36;
const LABEL_RADIUS = 78;
const VIEW_PAD = 20;
const TOOL_SWEEP = -Math.PI * 2;
const TOOL_START = -Math.PI / 2;

let wheelEl = null;
let canvasHandlers = null;
let pointerId = null;
let startPoint = { x: 0, y: 0 };
let longPressTimer = null;
let wheelOpen = false;
let hoverTool = null;
let layout = null;
let openedThisGesture = false;
let source = null;
let toolStarted = false;
let downSnapshot = null;

export function selectTool(toolName) {
  if (!toolName) return;

  state.currentTool = toolName;
  document.body.dataset.tool = toolName;
  if (toolName === "smart") clearSelection();

  document.body.classList.toggle("hand-mode", toolName === "hand");
  document.body.classList.toggle("text-mode", toolName === "text");
  document.body.classList.toggle("select-mode", toolName === "select");
  document.body.classList.toggle("scale-mode", toolName === "scale");
  document.body.classList.toggle("rotate-mode", toolName === "rotate");

  document.querySelectorAll(".tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === toolName);
  });

  redraw();
}

export function toggleWalkMode() {
  setInputMode(state.inputMode === "move" ? "draw" : "move");
}

function snapshotPointer(event) {
  return {
    pointerId: event.pointerId,
    button: event.button,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerType: event.pointerType || "mouse",
    preventDefault() {},
    getCoalescedEvents: typeof event.getCoalescedEvents === "function"
      ? () => event.getCoalescedEvents()
      : undefined
  };
}

function ensureWheel() {
  if (wheelEl) return wheelEl;
  wheelEl = document.createElement("div");
  wheelEl.id = "toolWheel";
  wheelEl.className = "tool-wheel";
  wheelEl.hidden = true;
  wheelEl.setAttribute("role", "menu");
  wheelEl.setAttribute("aria-label", "Drawing tools");
  document.body.append(wheelEl);
  return wheelEl;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle) {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

function sweepT(angle, start, sweep) {
  let rel = normalizeAngle(angle - start);
  if (sweep < 0 && rel > 0) rel -= Math.PI * 2;
  if (sweep > 0 && rel < 0) rel += Math.PI * 2;
  return rel / sweep;
}

function sliceIndexAt(angle) {
  let t = sweepT(angle, TOOL_START, TOOL_SWEEP);
  if (t < 0) t += 1;
  if (t >= 1) t -= 1;
  if (t < 0 || t >= 1) return -1;
  return Math.min(TOOL_WHEEL_ITEMS.length - 1, Math.floor(t * TOOL_WHEEL_ITEMS.length));
}

function polar(cx, cy, radius, angle) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  };
}

function donutSlicePath(cx, cy, inner, outer, a0, a1) {
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  const outer0 = polar(cx, cy, outer, a0);
  const outer1 = polar(cx, cy, outer, a1);
  const inner1 = polar(cx, cy, inner, a1);
  const inner0 = polar(cx, cy, inner, a0);
  return [
    `M ${outer0.x.toFixed(2)} ${outer0.y.toFixed(2)}`,
    `A ${outer} ${outer} 0 ${large} ${sweep} ${outer1.x.toFixed(2)} ${outer1.y.toFixed(2)}`,
    `L ${inner1.x.toFixed(2)} ${inner1.y.toFixed(2)}`,
    `A ${inner} ${inner} 0 ${large} ${sweep ? 0 : 1} ${inner0.x.toFixed(2)} ${inner0.y.toFixed(2)}`,
    "Z"
  ].join(" ");
}

function computeLayout(originX, originY) {
  const viewW = window.visualViewport?.width ?? window.innerWidth;
  const viewH = window.visualViewport?.height ?? window.innerHeight;
  const cx = clamp(originX, OUTER_RADIUS + VIEW_PAD, viewW - OUTER_RADIUS - VIEW_PAD);
  const cy = clamp(originY, OUTER_RADIUS + VIEW_PAD, viewH - OUTER_RADIUS - VIEW_PAD);
  return { cx, cy, inner: INNER_RADIUS, outer: OUTER_RADIUS, viewW, viewH };
}

function toolAtPointer(clientX, clientY) {
  if (!layout) return null;
  const dx = clientX - layout.cx;
  const dy = clientY - layout.cy;
  const dist = Math.hypot(dx, dy);
  if (dist < layout.inner || dist > layout.outer + 28) return null;
  const index = sliceIndexAt(Math.atan2(dy, dx));
  if (index < 0) return null;
  return TOOL_WHEEL_ITEMS[index];
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
}

function renderWheel() {
  const el = ensureWheel();
  if (!layout) return;

  const { cx, cy, inner, outer } = layout;
  const sliceAngle = TOOL_SWEEP / TOOL_WHEEL_ITEMS.length;
  const svg = svgEl("svg", {
    class: "tool-wheel-svg",
    width: layout.viewW,
    height: layout.viewH,
    viewBox: `0 0 ${layout.viewW} ${layout.viewH}`,
    "data-cx": cx.toFixed(1),
    "data-cy": cy.toFixed(1)
  });

  TOOL_WHEEL_ITEMS.forEach((item, index) => {
    const a0 = TOOL_START + index * sliceAngle;
    const a1 = a0 + sliceAngle;
    const mid = a0 + sliceAngle / 2;
    const label = polar(cx, cy, LABEL_RADIUS, mid);
    const hovered = hoverTool === item.tool;
    const sliceClass = ["tool-wheel-slice"];
    if (item.tool === state.currentTool) sliceClass.push("is-current");
    if (hovered) sliceClass.push("is-hover");
    svg.append(
      svgEl("path", {
        class: sliceClass.join(" "),
        "data-tool": item.tool,
        d: donutSlicePath(cx, cy, inner, outer, a0, a1)
      }),
      svgEl(
        "text",
        {
          class: `tool-wheel-label${hovered ? " is-hover" : ""}`,
          "data-tool": item.tool,
          x: label.x.toFixed(1),
          y: label.y.toFixed(1),
          "text-anchor": "middle",
          "dominant-baseline": "middle"
        },
        item.label
      )
    );
  });

  const hub = hoverTool
    ? TOOL_WHEEL_ITEMS.find((item) => item.tool === hoverTool)?.label || "Tools"
    : "Tools";
  svg.append(
    svgEl("circle", {
      class: "tool-wheel-hub",
      cx,
      cy,
      r: inner - 2
    }),
    svgEl(
      "text",
      {
        class: "tool-wheel-hub-label",
        x: cx,
        y: cy,
        "text-anchor": "middle",
        "dominant-baseline": "middle"
      },
      hub
    )
  );
  el.replaceChildren(svg);
}

function openWheel() {
  if (wheelOpen || toolStarted) return;
  layout = computeLayout(startPoint.x, startPoint.y);
  hoverTool = null;
  wheelOpen = true;
  openedThisGesture = true;
  const el = ensureWheel();
  el.hidden = false;
  document.body.classList.add("tool-wheel-open");
  modeSwitchEl?.setAttribute("aria-expanded", "true");
  renderWheel();
  if (typeof navigator.vibrate === "function") navigator.vibrate(12);
}

function closeWheel() {
  wheelOpen = false;
  hoverTool = null;
  layout = null;
  if (wheelEl) wheelEl.hidden = true;
  document.body.classList.remove("tool-wheel-open");
  modeSwitchEl?.setAttribute("aria-expanded", "false");
}

function clearLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function releaseCaptures(id) {
  if (id === null) return;
  for (const el of [canvas, modeSwitchEl]) {
    if (!el) continue;
    try {
      el.releasePointerCapture(id);
    } catch {
      // Capture may already be released.
    }
  }
}

function startToolIfNeeded() {
  if (toolStarted || !downSnapshot || !canvasHandlers) return;
  toolStarted = true;
  canvasHandlers.onDown(downSnapshot);
}

function beginWatch(event, nextSource, captureEl) {
  if (event.button !== undefined && event.button !== 0) return false;
  event.preventDefault();
  pointerId = event.pointerId;
  startPoint = { x: event.clientX, y: event.clientY };
  source = nextSource;
  openedThisGesture = false;
  toolStarted = false;
  hoverTool = null;
  downSnapshot = snapshotPointer(event);
  try {
    captureEl.setPointerCapture(event.pointerId);
  } catch {
    // Capture is best-effort.
  }
  clearLongPress();
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openWheel();
  }, LONG_PRESS_MS);
  return true;
}

function updateHover(event) {
  const next = toolAtPointer(event.clientX, event.clientY);
  const nextTool = next ? next.tool : null;
  if (nextTool === hoverTool) return;
  hoverTool = nextTool;
  renderWheel();
}

function finishGesture(event) {
  const opened = openedThisGesture;
  const picked = hoverTool;
  const id = pointerId;
  const from = source;
  const started = toolStarted;
  const origin = startPoint;
  pointerId = null;
  source = null;
  openedThisGesture = false;
  toolStarted = false;
  downSnapshot = null;
  clearLongPress();
  releaseCaptures(id);
  closeWheel();

  if (opened) {
    if (picked) {
      selectTool(picked);
      setInputMode("draw");
    }
    return;
  }

  if (started) {
    canvasHandlers?.onUp(event);
    return;
  }

  if (from === "toggle") {
    if (event && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < OPEN_DRAG_PX) {
      toggleWalkMode();
    }
  }
}

function onCanvasPointerDown(event) {
  beginWatch(event, "canvas", canvas);
}

function onCanvasPointerMove(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  if (wheelOpen) {
    event.preventDefault();
    updateHover(event);
    return;
  }
  const dist = Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y);
  if (dist >= OPEN_DRAG_PX) {
    clearLongPress();
    startToolIfNeeded();
  }
  if (toolStarted) canvasHandlers?.onMove(event);
}

function onCanvasPointerUp(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  event.preventDefault();
  if (!openedThisGesture && !toolStarted && source === "canvas") {
    startToolIfNeeded();
  }
  finishGesture(event);
}

function onCanvasPointerCancel(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  const started = toolStarted;
  const id = pointerId;
  pointerId = null;
  source = null;
  openedThisGesture = false;
  toolStarted = false;
  downSnapshot = null;
  clearLongPress();
  closeWheel();
  if (started) canvasHandlers?.onCancel(event);
  else releaseCaptures(id);
}

function onCanvasLostCapture(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  if (openedThisGesture) {
    finishGesture(event);
    return;
  }
  if (toolStarted) {
    pointerId = null;
    source = null;
    toolStarted = false;
    downSnapshot = null;
    canvasHandlers?.onLost(event);
    return;
  }
  onCanvasPointerCancel(event);
}

function onTogglePointerDown(event) {
  event.stopPropagation();
  beginWatch(event, "toggle", modeSwitchEl);
}

function onTogglePointerMove(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  const dist = Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y);
  if (!wheelOpen && dist >= OPEN_DRAG_PX) {
    clearLongPress();
    openWheel();
  }
  if (wheelOpen) updateHover(event);
}

function onTogglePointerUp(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  event.preventDefault();
  finishGesture(event);
}

function onTogglePointerCancel(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  pointerId = null;
  source = null;
  openedThisGesture = false;
  toolStarted = false;
  downSnapshot = null;
  clearLongPress();
  closeWheel();
}

export function bindPointerGestures(handlers) {
  canvasHandlers = handlers;
  document.body.dataset.tool = state.currentTool;
  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", onCanvasPointerCancel);
  canvas.addEventListener("lostpointercapture", onCanvasLostCapture);

  if (modeSwitchEl) {
    modeSwitchEl.addEventListener("pointerdown", onTogglePointerDown);
    modeSwitchEl.addEventListener("pointermove", onTogglePointerMove);
    modeSwitchEl.addEventListener("pointerup", onTogglePointerUp);
    modeSwitchEl.addEventListener("pointercancel", onTogglePointerCancel);
    modeSwitchEl.setAttribute("aria-controls", "toolWheel");
    modeSwitchEl.addEventListener("contextmenu", (event) => event.preventDefault());
    modeSwitchEl.addEventListener("click", (event) => {
      // Pointer tap/long-press is handled by onTogglePointerDown/Up.
      // Keyboard Enter/Space synthesizes a click with detail 0; let keydown
      // own that path so we do not double-toggle.
      if (event.detail > 0 || event.pointerType) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    modeSwitchEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleWalkMode();
    });
  }

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", () => {
    if (wheelOpen) closeWheel();
  });
}
