// Avatar editor: a self-contained modal with its own canvas, tools, history, and
// animation preview. On commit it writes the avatar to the local player and
// broadcasts it. Reuses the shared drawing engine (build/draw/transform helpers).

import {
  AVATAR_FRAME,
  AVATAR_STORAGE_KEY,
  newId,
  newSeed,
  rough,
  state,
  storeJson
} from "./state.js";
import {
  avatarGuide,
  avatarSwivelTransform,
  boxCenter,
  boxContainsBox,
  clampNumber,
  clone,
  isOverBounds,
  mergeBoxBounds,
  normalizedBox,
  pointerAngle,
  pointerDistance,
  round1,
  roundPoint,
  simplifyPoints
} from "./geometry.js";
import {
  buildRoughShape,
  cloneShapeData,
  hydrateAvatarShapeList,
  hydrateShapeList,
  isMeaningful,
  pointInShapeForDragging,
  serializeShape,
  shapeBounds,
  shapeZRank
} from "./shapes.js";
import { drawPuppetGuide, drawShapeOn, drawTrashCan } from "./render.js";
import { drawTextShape } from "./shapes.js";
import {
  applyTransformFromOriginal,
  isTransformTool,
  transformFromDrag,
  transformMoved,
  translateGeom
} from "./transforms.js";
import { chooseSmartFillStyle, fillStrokeLooksIntentional, shapeContainsPoint } from "./smart-fill.js";
import { smartShapeFromStroke } from "./smart-shapes.js";
import { autosizeTextEditor } from "./text-editor.js";
import { net } from "./net.js";
import { redraw } from "./render.js";

export const avatarEditor = (() => {
  const overlay = document.getElementById("avatarOverlay");
  const editorCanvas = document.getElementById("avatarCanvas");
  const editorCtx = editorCanvas.getContext("2d", { alpha: false });
  let editorRc = rough.canvas(editorCanvas);
  const editorGen = rough.generator();
  const editorShapes = [];
  const editorUndoStack = [];
  const editorRedoStack = [];
  let editorTool = "smart";
  let editorActiveDrag = null;
  let editorSelectedIds = [];
  let editorPlaying = false;
  let editorAnimationFrame = null;

  const editorControls = {
    strokeColor: document.getElementById("avatarStrokeColor"),
    roughness: document.getElementById("avatarRoughness"),
    roughnessValue: document.getElementById("avatarRoughnessValue"),
    bowing: document.getElementById("avatarBowing"),
    bowingValue: document.getElementById("avatarBowingValue"),
    strokeWidth: document.getElementById("avatarStrokeWidth"),
    strokeWidthValue: document.getElementById("avatarStrokeWidthValue"),
    undoBtn: document.getElementById("avatarUndoBtn"),
    redoBtn: document.getElementById("avatarRedoBtn"),
    playBtn: document.getElementById("avatarPlayBtn"),
    clearBtn: document.getElementById("avatarClearBtn"),
    cancelBtn: document.getElementById("avatarCancelBtn"),
    okayBtn: document.getElementById("avatarOkayBtn")
  };

  function editorOptions(seed = newSeed()) {
    return {
      stroke: editorControls.strokeColor.value,
      fill: null,
      fillStyle: "hachure",
      roughness: clampNumber(editorControls.roughness.value, 1.5),
      bowing: clampNumber(editorControls.bowing.value, 1),
      strokeWidth: clampNumber(editorControls.strokeWidth.value, 2),
      seed
    };
  }

  function buildEditorDrawable(shape) {
    return shape.type === "text" ? null : buildRoughShape(editorGen, shape);
  }

  function snapshotEditor() {
    return editorShapes.map(cloneShapeData);
  }

  function updateEditorHistoryButtons() {
    editorControls.undoBtn.disabled = !editorUndoStack.length;
    editorControls.redoBtn.disabled = !editorRedoStack.length;
  }

  // Record the state prior to a mutation. Pass an explicit snapshot when the
  // shapes have already been mutated (e.g. a drag captured at pointer down).
  function recordEditorHistory(snapshot = snapshotEditor()) {
    editorUndoStack.push(snapshot);
    if (editorUndoStack.length > 100) editorUndoStack.shift();
    editorRedoStack.length = 0;
    updateEditorHistoryButtons();
  }

  function restoreEditorSnapshot(snapshot) {
    editorShapes.length = 0;
    editorShapes.push(...hydrateShapeList(snapshot));
    const ids = new Set(editorShapes.map((shape) => shape.id));
    editorSelectedIds = editorSelectedIds.filter((id) => ids.has(id));
  }

  function undoEditor() {
    if (!editorUndoStack.length) return;
    stopPreview();
    editorRedoStack.push(snapshotEditor());
    restoreEditorSnapshot(editorUndoStack.pop());
    updateEditorHistoryButtons();
    drawEditor();
  }

  function redoEditor() {
    if (!editorRedoStack.length) return;
    stopPreview();
    editorUndoStack.push(snapshotEditor());
    restoreEditorSnapshot(editorRedoStack.pop());
    updateEditorHistoryButtons();
    drawEditor();
  }

  function editorOrderedShapes() {
    return editorShapes
      .map((shape, index) => ({ shape, index, rank: shapeZRank(shape) }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.index - b.index;
      })
      .map((entry) => entry.shape);
  }

  function editorPoint(event) {
    const rect = editorCanvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * AVATAR_FRAME.width,
      y: ((event.clientY - rect.top) / rect.height) * AVATAR_FRAME.height
    };
  }

  function editorPointToScreen(point) {
    const rect = editorCanvas.getBoundingClientRect();
    return {
      x: rect.left + (point.x / AVATAR_FRAME.width) * rect.width,
      y: rect.top + (point.y / AVATAR_FRAME.height) * rect.height
    };
  }

  function editorSelectedShapes() {
    const selected = new Set(editorSelectedIds);
    return editorOrderedShapes().filter((shape) => selected.has(shape.id));
  }

  function editorSelectionBounds() {
    const ext = mergeBoxBounds(editorSelectedShapes().map(shapeBounds));
    if (!ext) return null;

    return {
      x: ext.minX,
      y: ext.minY,
      width: ext.maxX - ext.minX,
      height: ext.maxY - ext.minY
    };
  }

  function drawEditorSelection() {
    const box = editorSelectionBounds();
    if (!box) return;

    editorCtx.save();
    editorCtx.setLineDash([8, 6]);
    editorCtx.lineWidth = 1.5;
    editorCtx.strokeStyle = "rgba(47, 101, 255, 0.9)";
    editorCtx.fillStyle = "rgba(47, 101, 255, 0.08)";
    editorCtx.fillRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8);
    editorCtx.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8);
    editorCtx.restore();
  }

  function drawEditorSelectMarquee(shape) {
    const box = normalizedBox(shape.geom);
    editorCtx.save();
    editorCtx.setLineDash([8, 6]);
    editorCtx.lineWidth = 1.5;
    editorCtx.strokeStyle = "rgba(47, 101, 255, 0.95)";
    editorCtx.fillStyle = "rgba(47, 101, 255, 0.07)";
    editorCtx.fillRect(box.x, box.y, box.width, box.height);
    editorCtx.strokeRect(box.x, box.y, box.width, box.height);
    editorCtx.restore();
  }

  function drawEditorText(shape) {
    drawTextShape(editorCtx, shape);
  }

  function drawEditorShape(shape) {
    drawShapeOn(editorCtx, editorRc, buildEditorDrawable, shape);
  }

  function drawEditorBackground() {
    editorCtx.save();
    editorCtx.fillStyle = "#fbfdff";
    editorCtx.fillRect(0, 0, AVATAR_FRAME.width, AVATAR_FRAME.height);
    editorCtx.strokeStyle = "rgba(95, 145, 210, 0.10)";
    editorCtx.lineWidth = 1;
    editorCtx.beginPath();
    for (let y = 28; y < AVATAR_FRAME.height; y += 28) {
      editorCtx.moveTo(0, y + 0.5);
      editorCtx.lineTo(AVATAR_FRAME.width, y + 0.5);
    }
    editorCtx.stroke();
    editorCtx.restore();
  }

  function drawEditor(previewShape = null) {
    drawEditorBackground();
    drawPuppetGuide(editorCtx, avatarGuide());

    const { bob, swivel } = avatarSwivelTransform(editorPlaying);
    const cx = AVATAR_FRAME.width / 2;
    const cy = AVATAR_FRAME.height / 2;
    editorCtx.save();
    editorCtx.translate(cx, cy + bob);
    editorCtx.rotate(swivel);
    editorCtx.translate(-cx, -cy);

    for (const shape of editorOrderedShapes()) {
      drawEditorShape(shape);
    }

    editorCtx.restore();

    drawEditorSelection();

    if (previewShape) {
      if (previewShape.type === "text") {
        drawEditorText(previewShape);
      } else if (previewShape.type === "select-box") {
        drawEditorSelectMarquee(previewShape);
      } else {
        const drawable = buildEditorDrawable(previewShape);
        if (drawable) editorRc.draw(drawable);
      }
    }

    if (editorActiveDrag && editorActiveDrag.tool === "hand") {
      const etw = 40, eth = 46;
      const etx = AVATAR_FRAME.width / 2 - etw / 2;
      const ety = AVATAR_FRAME.height - eth - 10;
      const isHover = isOverBounds(editorActiveDrag.current, { x: etx, y: ety, width: etw, height: eth });
      drawTrashCan(editorCtx, editorRc, etx, ety, etw, eth, isHover);
    }

    updateOkayState();
  }

  function resizeEditorCanvas() {
    const rect = editorCanvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 4));
    const scale = Math.max(1, rect.width / AVATAR_FRAME.width);
    editorCanvas.width = Math.round(AVATAR_FRAME.width * scale * ratio);
    editorCanvas.height = Math.round(AVATAR_FRAME.height * scale * ratio);
    editorCtx.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
    editorRc = rough.canvas(editorCanvas);
    drawEditor();
  }

  function makeEditorShape(type, start, end, points, options) {
    if (type === "smart") {
      return {
        id: newId(),
        type,
        geom: { points: points.map(roundPoint) },
        options: { ...options },
        drawable: null
      };
    }

    return {
      id: newId(),
      type,
      geom: {
        x1: round1(start.x),
        y1: round1(start.y),
        x2: round1(end.x),
        y2: round1(end.y)
      },
      options: { ...options },
      drawable: null
    };
  }

  function editorPreviewShape() {
    if (!editorActiveDrag) return null;

    if (editorActiveDrag.tool === "smart") {
      return makeEditorShape(
        "smart",
        editorActiveDrag.start,
        editorActiveDrag.current,
        editorActiveDrag.points,
        editorActiveDrag.options
      );
    }

    if (editorActiveDrag.tool === "select") {
      return {
        id: "avatar-select-box",
        type: "select-box",
        geom: {
          x1: round1(editorActiveDrag.start.x),
          y1: round1(editorActiveDrag.start.y),
          x2: round1(editorActiveDrag.current.x),
          y2: round1(editorActiveDrag.current.y)
        },
        options: {}
      };
    }

    return null;
  }

  function editorHitTest(point) {
    const entries = editorShapes
      .map((shape, index) => ({ shape, index, rank: shapeZRank(shape) }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.index - b.index;
      });

    for (let i = entries.length - 1; i >= 0; i--) {
      const { shape, index } = entries[i];
      if (pointInShapeForDragging(shape, point)) {
        return { shape, index };
      }
    }

    return null;
  }

  function applyEditorSelection(shape) {
    const box = normalizedBox(shape.geom);
    editorSelectedIds = editorOrderedShapes()
      .filter((item) => boxContainsBox(box, shapeBounds(item)))
      .map((item) => item.id);
  }

  function pushEditorStrokePoint(point) {
    if (!editorActiveDrag || editorActiveDrag.tool !== "smart") return;
    const last = editorActiveDrag.points[editorActiveDrag.points.length - 1];
    if (!last || Math.hypot(point.x - last[0], point.y - last[1]) >= 3.5) {
      editorActiveDrag.points.push([point.x, point.y]);
    }
  }

  function editorTransformDragForSelection(tool, pointerId, point) {
    let dragShapes = editorSelectedShapes();

    if (!dragShapes.length) {
      const hit = editorHitTest(point);
      if (!hit) return null;
      editorSelectedIds = [hit.shape.id];
      dragShapes = [hit.shape];
    }

    const bounds = editorSelectionBounds();
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
      originalGeoms: dragShapes.map((shape) => ({ id: shape.id, geom: clone(shape.geom) })),
      moved: false,
      preSnapshot: snapshotEditor()
    };
  }

  function tryApplyEditorFill(strokeShape) {
    const points = simplifyPoints(strokeShape.geom.points, 3.5);
    if (!points || points.length < 10) return false;

    let target = null;
    let bestScore = 0;
    for (let i = editorShapes.length - 1; i >= 0; i--) {
      const shape = editorShapes[i];
      if (shape.type !== "rectangle" && shape.type !== "ellipse") continue;
      let inside = 0;
      for (const point of points) {
        if (shapeContainsPoint(shape, point, 10)) inside++;
      }
      const ratio = inside / points.length;
      if (ratio > 0.92 && ratio > bestScore) {
        bestScore = ratio;
        target = shape;
      }
    }

    if (!target || !fillStrokeLooksIntentional(points, target)) return false;
    const fillStyle = chooseSmartFillStyle(target, points);
    if (!fillStyle) return false;

    recordEditorHistory();
    target.options.fill = editorControls.strokeColor.value;
    target.options.fillStyle = fillStyle;
    target.drawable = buildEditorDrawable(target);
    drawEditor();
    return true;
  }

  function openEditorText(point) {
    const editor = document.createElement("textarea");
    editor.className = "avatar-text-editor";
    editor.spellcheck = false;
    editor.placeholder = "Text";
    const screen = editorPointToScreen(point);
    editor.style.left = `${Math.round(screen.x)}px`;
    editor.style.top = `${Math.round(screen.y)}px`;
    document.body.appendChild(editor);

    const commit = () => {
      if (!editor.parentNode) return;
      const text = editor.value.trimEnd();
      editor.remove();
      if (!text.trim()) {
        drawEditor();
        return;
      }

      const shape = {
        id: newId(),
        type: "text",
        geom: {
          x: round1(point.x),
          y: round1(point.y),
          text,
          fontSize: 22
        },
        options: editorOptions(newSeed()),
        drawable: null
      };
      recordEditorHistory();
      editorShapes.push(shape);
      drawEditor();
    };

    const cancel = () => {
      if (!editor.parentNode) return;
      editor.remove();
      drawEditor();
    };

    editor.addEventListener("input", () => autosizeTextEditor(editor));
    editor.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commit();
      }
    });
    editor.addEventListener("blur", commit);

    requestAnimationFrame(() => {
      editor.focus();
      autosizeTextEditor(editor);
    });
  }

  function onEditorPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    editorCanvas.setPointerCapture(event.pointerId);
    const point = editorPoint(event);

    if (editorTool === "text") {
      openEditorText(point);
      return;
    }

    if (editorTool === "hand") {
      const hit = editorHitTest(point);
      if (!hit) return;
      const draggingSelection = editorSelectedIds.includes(hit.shape.id) && editorSelectedIds.length > 0;
      const dragShapes = draggingSelection
        ? editorShapes.filter((shape) => editorSelectedIds.includes(shape.id))
        : [hit.shape];

      editorActiveDrag = {
        pointerId: event.pointerId,
        tool: "hand",
        start: point,
        current: point,
        dragShapes,
        originalGeoms: dragShapes.map((shape) => ({ id: shape.id, geom: clone(shape.geom) })),
        moved: false,
        preSnapshot: snapshotEditor()
      };
      return;
    }

    if (isTransformTool(editorTool)) {
      editorActiveDrag = editorTransformDragForSelection(editorTool, event.pointerId, point);
      drawEditor();
      return;
    }

    if (editorTool === "select") {
      editorActiveDrag = {
        pointerId: event.pointerId,
        tool: "select",
        start: point,
        current: point
      };
      drawEditor(editorPreviewShape());
      return;
    }

    editorActiveDrag = {
      pointerId: event.pointerId,
      tool: "smart",
      start: point,
      current: point,
      options: editorOptions(newSeed()),
      points: [[point.x, point.y]]
    };
    drawEditor(editorPreviewShape());
  }

  function onEditorPointerMove(event) {
    if (!editorActiveDrag || editorActiveDrag.pointerId !== event.pointerId) return;
    event.preventDefault();

    if (editorActiveDrag.tool === "hand") {
      const point = editorPoint(event);
      const dx = point.x - editorActiveDrag.start.x;
      const dy = point.y - editorActiveDrag.start.y;
      editorActiveDrag.current = point;
      editorActiveDrag.moved = Math.hypot(dx, dy) > 1.5;

      const originalById = new Map(editorActiveDrag.originalGeoms.map((item) => [item.id, item.geom]));
      for (const shape of editorActiveDrag.dragShapes) {
        const originalGeom = originalById.get(shape.id);
        shape.geom = translateGeom(originalGeom, dx, dy);
        shape.drawable = buildEditorDrawable(shape);
      }
      drawEditor();
      return;
    }

    if (isTransformTool(editorActiveDrag.tool)) {
      const point = editorPoint(event);
      const transform = transformFromDrag(editorActiveDrag, point);
      editorActiveDrag.current = point;
      editorActiveDrag.moved = transformMoved(transform);

      const originalById = new Map(editorActiveDrag.originalGeoms.map((item) => [item.id, item.geom]));
      for (const shape of editorActiveDrag.dragShapes) {
        const originalGeom = originalById.get(shape.id);
        applyTransformFromOriginal(shape, originalGeom, transform);
        shape.drawable = buildEditorDrawable(shape);
      }
      drawEditor();
      return;
    }

    if (editorActiveDrag.tool === "select") {
      editorActiveDrag.current = editorPoint(event);
      drawEditor(editorPreviewShape());
      return;
    }

    const events =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [event];
    for (const e of events) {
      const point = editorPoint(e);
      editorActiveDrag.current = point;
      pushEditorStrokePoint(point);
    }
    drawEditor(editorPreviewShape());
  }

  function finishEditorPointer(event) {
    if (!editorActiveDrag || editorActiveDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    try {
      editorCanvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }

    if (editorActiveDrag.tool === "hand") {
      const dragShapes = editorActiveDrag.dragShapes;
      const moved = editorActiveDrag.moved;
      const preSnapshot = editorActiveDrag.preSnapshot;
      const etw = 40, eth = 46;
      const trashBounds = { x: AVATAR_FRAME.width / 2 - etw / 2, y: AVATAR_FRAME.height - eth - 10, width: etw, height: eth };
      const droppedOnTrash = moved && isOverBounds(editorActiveDrag.current, trashBounds);
      editorActiveDrag = null;
      if (moved || droppedOnTrash) {
        recordEditorHistory(preSnapshot);
      }
      if (droppedOnTrash) {
        for (const shape of dragShapes) {
          const idx = editorShapes.indexOf(shape);
          if (idx >= 0) editorShapes.splice(idx, 1);
        }
        editorSelectedIds = editorSelectedIds.filter((id) => !dragShapes.some((s) => s.id === id));
      }
      drawEditor();
      return;
    }

    if (isTransformTool(editorActiveDrag.tool)) {
      const moved = editorActiveDrag.moved;
      const preSnapshot = editorActiveDrag.preSnapshot;
      editorActiveDrag = null;
      if (moved) {
        recordEditorHistory(preSnapshot);
      }
      drawEditor();
      return;
    }

    if (editorActiveDrag.tool === "select") {
      const shape = editorPreviewShape();
      editorActiveDrag = null;
      if (shape && isMeaningful(shape)) {
        applyEditorSelection(shape);
      } else {
        editorSelectedIds = [];
      }
      drawEditor();
      return;
    }

    let shape = editorPreviewShape();
    editorActiveDrag = null;
    if (shape && shape.type === "smart") {
      if (tryApplyEditorFill(shape)) return;
      shape = smartShapeFromStroke(shape);
      shape.drawable = buildEditorDrawable(shape);
    }

    if (isMeaningful(shape)) {
      recordEditorHistory();
      editorShapes.push(shape);
    }
    drawEditor();
  }

  function cancelEditorPointer(event) {
    if (!editorActiveDrag || editorActiveDrag.pointerId !== event.pointerId) return;
    editorActiveDrag = null;
    drawEditor();
  }

  function updateControlLabels() {
    editorControls.roughnessValue.textContent = Number(editorControls.roughness.value).toFixed(1);
    editorControls.bowingValue.textContent = Number(editorControls.bowing.value).toFixed(1);
    editorControls.strokeWidthValue.textContent = Number(editorControls.strokeWidth.value).toFixed(1);
  }

  function updateOkayState() {
    editorControls.okayBtn.disabled = editorShapes.length === 0;
  }

  function stopPreview() {
    editorPlaying = false;
    state.avatarAnimationStart = 0;
    editorControls.playBtn.classList.remove("active");
    editorControls.playBtn.textContent = "Play";
    if (editorAnimationFrame !== null) {
      cancelAnimationFrame(editorAnimationFrame);
      editorAnimationFrame = null;
    }
  }

  function previewLoop() {
    if (!editorPlaying) return;
    drawEditor();
    editorAnimationFrame = requestAnimationFrame(previewLoop);
  }

  function togglePreview() {
    if (editorPlaying) {
      stopPreview();
      drawEditor();
      return;
    }

    editorPlaying = true;
    state.avatarAnimationStart = 0;
    editorControls.playBtn.classList.add("active");
    editorControls.playBtn.textContent = "Stop";
    editorAnimationFrame = requestAnimationFrame(previewLoop);
  }

  function clearDraft() {
    stopPreview();
    if (editorShapes.length) recordEditorHistory();
    editorShapes.length = 0;
    editorSelectedIds = [];
    drawEditor();
  }

  function close() {
    stopPreview();
    overlay.hidden = true;
    editorActiveDrag = null;
    state.pressedMovementKeys.clear();
  }

  function commit() {
    if (!editorShapes.length) return;
    state.localPlayer.avatar = hydrateAvatarShapeList(editorShapes.map(serializeShape));
    storeJson(AVATAR_STORAGE_KEY, state.localPlayer.avatar.map(serializeShape));
    net.sendPlayerSet();
    close();
    redraw();
  }

  function open() {
    stopPreview();
    editorShapes.length = 0;
    editorShapes.push(...hydrateAvatarShapeList(state.localPlayer.avatar.map(serializeShape)));
    editorSelectedIds = [];
    editorActiveDrag = null;
    editorUndoStack.length = 0;
    editorRedoStack.length = 0;
    overlay.hidden = false;
    updateControlLabels();
    updateEditorHistoryButtons();
    editorCanvas.classList.toggle("scale-mode", editorTool === "scale");
    editorCanvas.classList.toggle("rotate-mode", editorTool === "rotate");
    requestAnimationFrame(resizeEditorCanvas);
  }

  document.querySelectorAll(".avatar-tool").forEach((button) => {
    button.addEventListener("click", () => {
      editorTool = button.dataset.avatarTool;
      if (editorTool === "smart") {
        editorSelectedIds = [];
      }
      editorCanvas.classList.toggle("scale-mode", editorTool === "scale");
      editorCanvas.classList.toggle("rotate-mode", editorTool === "rotate");
      document.querySelectorAll(".avatar-tool").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      drawEditor();
    });
  });

  [
    editorControls.roughness,
    editorControls.bowing,
    editorControls.strokeWidth
  ].forEach((input) => {
    input.addEventListener("input", updateControlLabels);
    input.addEventListener("change", updateControlLabels);
  });

  editorControls.undoBtn.addEventListener("click", undoEditor);
  editorControls.redoBtn.addEventListener("click", redoEditor);
  editorControls.playBtn.addEventListener("click", togglePreview);
  editorControls.clearBtn.addEventListener("click", clearDraft);
  editorControls.cancelBtn.addEventListener("click", close);
  editorControls.okayBtn.addEventListener("click", commit);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  editorCanvas.addEventListener("pointerdown", onEditorPointerDown);
  editorCanvas.addEventListener("pointermove", onEditorPointerMove);
  editorCanvas.addEventListener("pointerup", finishEditorPointer);
  editorCanvas.addEventListener("pointercancel", cancelEditorPointer);
  window.addEventListener("resize", () => {
    if (!overlay.hidden) resizeEditorCanvas();
  });

  updateControlLabels();
  updateEditorHistoryButtons();
  return {
    open,
    close,
    undo: undoEditor,
    redo: redoEditor,
    isOpen() {
      return !overlay.hidden;
    }
  };
})();
