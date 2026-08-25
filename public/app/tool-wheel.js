// Mobile Move toggle + long-press radial tool picker.
// A short tap flips walk mode. Holding (or dragging off the button) opens a
// pizza-slice menu of the toolbar tools; releasing on a slice selects it.

import { modeSwitchEl, state } from "./state.js";
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
let pointerId = null;
let startPoint = { x: 0, y: 0 };
let longPressTimer = null;
let wheelOpen = false;
let hoverTool = null;
let layout = null;
let openedThisGesture = false;

export function selectTool(toolName) {
  if (!toolName) return;

  state.currentTool = toolName;
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

function computeLayout() {
  const rect = modeSwitchEl.getBoundingClientRect();
  const viewW = window.visualViewport?.width ?? window.innerWidth;
  const viewH = window.visualViewport?.height ?? window.innerHeight;
  const btnX = rect.left + rect.width / 2;
  const btnY = rect.top + rect.height / 2;
  const cx = clamp(btnX, OUTER_RADIUS + VIEW_PAD, viewW - OUTER_RADIUS - VIEW_PAD);
  const cy = clamp(btnY, OUTER_RADIUS + VIEW_PAD, viewH - OUTER_RADIUS - VIEW_PAD);
  return { cx, cy, inner: INNER_RADIUS, outer: OUTER_RADIUS, btnX, btnY, viewW, viewH };
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

function renderWheel() {
  const el = ensureWheel();
  if (!layout) return;

  const { cx, cy, inner, outer } = layout;
  const sliceAngle = TOOL_SWEEP / TOOL_WHEEL_ITEMS.length;
  const parts = [];

  parts.push(
    `<svg class="tool-wheel-svg" width="${layout.viewW}" height="${layout.viewH}" viewBox="0 0 ${layout.viewW} ${layout.viewH}" data-cx="${cx.toFixed(1)}" data-cy="${cy.toFixed(1)}">`
  );

  TOOL_WHEEL_ITEMS.forEach((item, index) => {
    const a0 = TOOL_START + index * sliceAngle;
    const a1 = a0 + sliceAngle;
    const mid = a0 + sliceAngle / 2;
    const label = polar(cx, cy, LABEL_RADIUS, mid);
    const active = item.tool === state.currentTool;
    const hovered = hoverTool === item.tool;
    const cls = ["tool-wheel-slice"];
    if (active) cls.push("is-current");
    if (hovered) cls.push("is-hover");
    parts.push(
      `<path class="${cls.join(" ")}" data-tool="${item.tool}" d="${donutSlicePath(cx, cy, inner, outer, a0, a1)}"></path>`
    );
    parts.push(
      `<text class="tool-wheel-label${hovered ? " is-hover" : ""}" data-tool="${item.tool}" x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${item.label}</text>`
    );
  });

  const hub = hoverTool
    ? TOOL_WHEEL_ITEMS.find((item) => item.tool === hoverTool)?.label || "Move"
    : "Tools";
  parts.push(`<circle class="tool-wheel-hub" cx="${cx}" cy="${cy}" r="${inner - 2}"></circle>`);
  parts.push(
    `<text class="tool-wheel-hub-label" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle">${hub}</text>`
  );
  parts.push("</svg>");
  el.innerHTML = parts.join("");
}

function openWheel() {
  if (wheelOpen) return;
  layout = computeLayout();
  hoverTool = null;
  wheelOpen = true;
  openedThisGesture = true;
  const el = ensureWheel();
  el.hidden = false;
  document.body.classList.add("tool-wheel-open");
  modeSwitchEl.setAttribute("aria-expanded", "true");
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

function finishGesture(event) {
  const opened = openedThisGesture;
  const picked = hoverTool;
  const id = pointerId;
  pointerId = null;
  openedThisGesture = false;
  clearLongPress();

  if (id !== null) {
    try {
      modeSwitchEl.releasePointerCapture(id);
    } catch {
      // Capture may already be released.
    }
  }

  closeWheel();

  if (opened) {
    if (picked) {
      selectTool(picked);
      setInputMode("draw");
    }
    return;
  }

  if (event && Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) < OPEN_DRAG_PX) {
    toggleWalkMode();
  }
}

function onPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  pointerId = event.pointerId;
  startPoint = { x: event.clientX, y: event.clientY };
  openedThisGesture = false;
  hoverTool = null;
  modeSwitchEl.setPointerCapture(event.pointerId);
  clearLongPress();
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openWheel();
  }, LONG_PRESS_MS);
}

function onPointerMove(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  const dx = event.clientX - startPoint.x;
  const dy = event.clientY - startPoint.y;
  if (!wheelOpen && Math.hypot(dx, dy) >= OPEN_DRAG_PX) {
    clearLongPress();
    openWheel();
  }
  if (!wheelOpen) return;
  const next = toolAtPointer(event.clientX, event.clientY);
  const nextTool = next ? next.tool : null;
  if (nextTool === hoverTool) return;
  hoverTool = nextTool;
  renderWheel();
}

function onPointerUp(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  event.preventDefault();
  finishGesture(event);
}

function onPointerCancel(event) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  pointerId = null;
  openedThisGesture = false;
  clearLongPress();
  closeWheel();
}

export function bindModeToggle() {
  if (!modeSwitchEl) return;
  modeSwitchEl.addEventListener("pointerdown", onPointerDown);
  modeSwitchEl.addEventListener("pointermove", onPointerMove);
  modeSwitchEl.addEventListener("pointerup", onPointerUp);
  modeSwitchEl.addEventListener("pointercancel", onPointerCancel);
  modeSwitchEl.addEventListener("contextmenu", (event) => event.preventDefault());
  modeSwitchEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  window.addEventListener("resize", () => {
    if (wheelOpen) closeWheel();
  });
}
