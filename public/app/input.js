// Input + tool dispatch: pointer handling for every tool (smart draw, select,
// hand/move, scale, rotate, text, imagine), WASD movement, and the movement hint.
// This is the orchestration layer that wires tools to the model and the network.

import {
  canvas,
  MOVE_HINT_KEY,
  moveHintEl,
  newSeed,
  PLAYER_SPEED,
  state,
  storeJson,
  storedJson
} from "./state.js";
import {
  boxCenter,
  boxContainsBox,
  clone,
  isOverBounds,
  normalizedBox,
  pointerAngle,
  pointerDistance,
  round1,
  screenToWorld,
  worldToScreen
} from "./geometry.js";
import {
  buildDrawable,
  clearSelection,
  currentOptions,
  hitTestShape,
  isMeaningful,
  makeShape,
  orderedShapes,
  save,
  selectedShapes,
  selectionBounds,
  serializeShape,
  shapeBounds
} from "./shapes.js";
import {
  applyTransformFromOriginal,
  isTransformTool,
  transformFromDrag,
  transformMoved,
  translateGeom
} from "./transforms.js";
import { smartShapeFromStroke } from "./smart-shapes.js";
import { tryApplySmartFill } from "./smart-fill.js";
import { recordHistory } from "./history.js";
import { net, persistPlayerState } from "./net.js";
import { redraw } from "./render.js";
import { openImaginePrompt } from "./imagine.js";
import { openTextEditor } from "./text-editor.js";
import { avatarEditor } from "./avatar-editor.js";

let movementFrameId = null;
let lastMoveTimestamp = 0;
let lastPlayerBroadcast = 0;
let lastBroadcastMoving = false;

// ===== Movement (WASD) + hint =====

export function isEditableTarget(target) {
  if (!target || target === document.body) return false;
  const tag = target.tagName ? target.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export function updateMovementHint() {
  const seen = storedJson(MOVE_HINT_KEY, false);
  moveHintEl.classList.toggle("hidden", Boolean(seen));
}

function hideMovementHint() {
  if (storedJson(MOVE_HINT_KEY, false)) return;
  storeJson(MOVE_HINT_KEY, true);
  updateMovementHint();
}

function movementVector() {
  const left = state.pressedMovementKeys.has("a");
  const right = state.pressedMovementKeys.has("d");
  const up = state.pressedMovementKeys.has("w");
  const down = state.pressedMovementKeys.has("s");
  let dx = (right ? 1 : 0) - (left ? 1 : 0);
  let dy = (down ? 1 : 0) - (up ? 1 : 0);
  const length = Math.hypot(dx, dy);
  if (length > 0) {
    dx /= length;
    dy /= length;
  }
  return { dx, dy, moving: length > 0 };
}

function broadcastPlayerMove(force = false) {
  const now = performance.now();
  if (!force && now - lastPlayerBroadcast < 50 && state.localPlayer.moving === lastBroadcastMoving) {
    return;
  }
  lastPlayerBroadcast = now;
  lastBroadcastMoving = state.localPlayer.moving;
  persistPlayerState();
  net.sendPlayerMove();
}

function updateMovement(timestamp) {
  movementFrameId = null;
  if (!lastMoveTimestamp) lastMoveTimestamp = timestamp;

  const dt = Math.min(0.05, Math.max(0, (timestamp - lastMoveTimestamp) / 1000));
  lastMoveTimestamp = timestamp;
  const vector = movementVector();
  const wasMoving = state.localPlayer.moving;
  state.localPlayer.moving = vector.moving;

  if (vector.moving) {
    if (vector.dx < 0) {
      state.localPlayer.facing = -1;
    } else if (vector.dx > 0) {
      state.localPlayer.facing = 1;
    }
    state.localPlayer.x = round1(state.localPlayer.x + vector.dx * PLAYER_SPEED * dt);
    state.localPlayer.y = round1(state.localPlayer.y + vector.dy * PLAYER_SPEED * dt);
    hideMovementHint();
    broadcastPlayerMove();
    redraw();
    movementFrameId = requestAnimationFrame(updateMovement);
    return;
  }

  lastMoveTimestamp = 0;
  state.avatarAnimationStart = 0;
  if (wasMoving) {
    broadcastPlayerMove(true);
    redraw();
  }
}

function scheduleMovement() {
  if (movementFrameId === null) {
    movementFrameId = requestAnimationFrame(updateMovement);
  }
}

export function handleMovementKey(event, isDown) {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (avatarEditor.isOpen()) return false;
  if (isEditableTarget(event.target)) return false;

  const key = event.key.toLowerCase();
  if (!["w", "a", "s", "d"].includes(key)) return false;

  event.preventDefault();
  if (isDown) {
    state.pressedMovementKeys.add(key);
    scheduleMovement();
  } else {
    state.pressedMovementKeys.delete(key);
    scheduleMovement();
  }
  return true;
}

// ===== Pointer helpers =====

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  });
}

function pushStrokePoint(point) {
  if (!state.activeDrag || state.activeDrag.tool !== "smart") return;

  const last = state.activeDrag.points[state.activeDrag.points.length - 1];
  if (!last || Math.hypot(point.x - last[0], point.y - last[1]) >= 3.5) {
    state.activeDrag.points.push([point.x, point.y]);
  }
}

function transformDragForSelection(tool, pointerId, point) {
  let dragShapes = selectedShapes();

  if (!dragShapes.length) {
    const hit = hitTestShape(point);
    if (!hit) return null;
    state.selectedIds = [hit.shape.id];
    dragShapes = [hit.shape];
  }

  const bounds = selectionBounds();
  if (!bounds) return null;
  const center = boxCenter(bounds);

  return {
    pointerId,
    tool,
    start: point,
    current: point,
    center,
    startDistance: Math.max(8, pointerDistance(point, center)),
    startAngle: pointerAngle(point, center),
    dragShapes,
    originalGeoms: dragShapes.map((shape) => ({
      id: shape.id,
      geom: clone(shape.geom)
    })),
    moved: false,
    historyRecorded: false
  };
}

export function previewShape() {
  if (!state.activeDrag) return null;

  if (state.activeDrag.tool === "smart") {
    return makeShape(
      "smart",
      state.activeDrag.start,
      state.activeDrag.current,
      state.activeDrag.points,
      state.activeDrag.options
    );
  }

  if (state.activeDrag.tool === "select") {
    return {
      id: "select-box",
      type: "select-box",
      geom: {
        x1: round1(state.activeDrag.start.x),
        y1: round1(state.activeDrag.start.y),
        x2: round1(state.activeDrag.current.x),
        y2: round1(state.activeDrag.current.y)
      },
      options: {}
    };
  }

  return null;
}

function applySelectionBox(shape) {
  const box = normalizedBox(shape.geom);
  state.selectedIds = orderedShapes()
    .filter((item) => boxContainsBox(box, shapeBounds(item)))
    .map((item) => item.id);
}

// ===== Pointer event handlers =====

export function onPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;

  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);

  const point = canvasPoint(event);

  if (state.currentTool === "imagine") {
    openImaginePrompt(point);
    return;
  }

  if (state.currentTool === "text") {
    openTextEditor(point);
    return;
  }

  if (state.currentTool === "hand") {
    const hit = hitTestShape(point);

    if (!hit) {
      state.activeDrag = null;
      return;
    }

    const draggingSelection = state.selectedIds.includes(hit.shape.id) && state.selectedIds.length > 0;
    const dragShapes = draggingSelection
      ? state.shapes.filter((shape) => state.selectedIds.includes(shape.id))
      : [hit.shape];

    state.activeDrag = {
      pointerId: event.pointerId,
      tool: "hand",
      start: point,
      current: point,
      dragShapes,
      originalGeoms: dragShapes.map((shape) => ({
        id: shape.id,
        geom: clone(shape.geom)
      })),
      moved: false,
      historyRecorded: false
    };

    document.body.classList.add("dragging-shape");
    return;
  }

  if (isTransformTool(state.currentTool)) {
    state.activeDrag = transformDragForSelection(state.currentTool, event.pointerId, point);
    redraw();
    return;
  }

  if (state.currentTool === "select") {
    state.activeDrag = {
      pointerId: event.pointerId,
      tool: "select",
      start: point,
      current: point
    };
    redraw(previewShape());
    return;
  }

  const options = currentOptions(newSeed());

  state.activeDrag = {
    pointerId: event.pointerId,
    tool: "smart",
    start: point,
    current: point,
    options,
    points: [[point.x, point.y]]
  };

  redraw(previewShape());
}

export function onPointerMove(event) {
  if (!state.activeDrag || state.activeDrag.pointerId !== event.pointerId) return;

  event.preventDefault();

  if (state.activeDrag.tool === "hand") {
    const point = canvasPoint(event);
    const dx = point.x - state.activeDrag.start.x;
    const dy = point.y - state.activeDrag.start.y;

    if (!state.activeDrag.historyRecorded && Math.hypot(dx, dy) > 1.5) {
      recordHistory();
      state.activeDrag.historyRecorded = true;
    }

    state.activeDrag.current = point;
    state.activeDrag.moved = Math.hypot(dx, dy) > 1.5;

    const originalById = new Map(state.activeDrag.originalGeoms.map((item) => [item.id, item.geom]));
    for (const shape of state.activeDrag.dragShapes) {
      const originalGeom = originalById.get(shape.id);
      shape.geom = translateGeom(originalGeom, dx, dy);
      shape.drawable = buildDrawable(shape);
    }

    redraw();
    return;
  }

  if (isTransformTool(state.activeDrag.tool)) {
    const point = canvasPoint(event);
    const transform = transformFromDrag(state.activeDrag, point);

    if (!state.activeDrag.historyRecorded && transformMoved(transform)) {
      recordHistory();
      state.activeDrag.historyRecorded = true;
    }

    state.activeDrag.current = point;
    state.activeDrag.moved = transformMoved(transform);

    const originalById = new Map(state.activeDrag.originalGeoms.map((item) => [item.id, item.geom]));
    for (const shape of state.activeDrag.dragShapes) {
      const originalGeom = originalById.get(shape.id);
      applyTransformFromOriginal(shape, originalGeom, transform);
      shape.drawable = buildDrawable(shape);
    }

    redraw();
    return;
  }

  if (state.activeDrag.tool === "select") {
    state.activeDrag.current = canvasPoint(event);
    redraw(previewShape());
    return;
  }

  const events =
    typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [event];

  for (const e of events) {
    const point = canvasPoint(e);
    state.activeDrag.current = point;
    pushStrokePoint(point);
  }

  redraw(previewShape());
}

export function finishPointer(event) {
  if (!state.activeDrag || state.activeDrag.pointerId !== event.pointerId) return;

  event.preventDefault();

  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture may already be released.
  }

  if (state.activeDrag.tool === "hand") {
    const moved = state.activeDrag.moved;
    const dragShapes = state.activeDrag.dragShapes;
    const tw = 68, th = 78;
    const trashBounds = { x: 24, y: state.viewHeight - th - 88, width: tw, height: th };
    const screenCurrent = worldToScreen(state.activeDrag.current);
    const droppedOnTrash = moved && isOverBounds(screenCurrent, trashBounds);
    state.activeDrag = null;
    document.body.classList.remove("dragging-shape");
    if (droppedOnTrash) {
      for (const shape of dragShapes) {
        const idx = state.shapes.indexOf(shape);
        if (idx >= 0) state.shapes.splice(idx, 1);
        net.send({ type: "remove", id: shape.id });
      }
      state.selectedIds = state.selectedIds.filter((id) => !dragShapes.some((s) => s.id === id));
      save();
    } else if (moved) {
      save();
      for (const shape of dragShapes) {
        net.send({ type: "update", shape: serializeShape(shape) });
      }
    }
    redraw();
    return;
  }

  if (isTransformTool(state.activeDrag.tool)) {
    const moved = state.activeDrag.moved;
    const dragShapes = state.activeDrag.dragShapes;
    state.activeDrag = null;
    if (moved) {
      save();
      for (const shape of dragShapes) {
        net.send({ type: "update", shape: serializeShape(shape) });
      }
    }
    redraw();
    return;
  }

  if (state.activeDrag.tool === "select") {
    const shape = previewShape();
    state.activeDrag = null;
    if (shape && isMeaningful(shape)) {
      applySelectionBox(shape);
    } else {
      clearSelection();
    }
    redraw();
    return;
  }

  let shape = previewShape();
  state.activeDrag = null;

  if (shape && shape.type === "smart") {
    if (tryApplySmartFill(shape)) {
      return;
    }
    shape = smartShapeFromStroke(shape);
  }

  if (isMeaningful(shape)) {
    recordHistory();
    shape.drawable = shape.drawable || buildDrawable(shape);
    state.shapes.push(shape);
    save();
    net.send({ type: "add", shape: serializeShape(shape) });
  }

  redraw();
}

export function cancelPointer(event) {
  if (!state.activeDrag || state.activeDrag.pointerId !== event.pointerId) return;
  state.activeDrag = null;
  document.body.classList.remove("dragging-shape");
  redraw();
}
