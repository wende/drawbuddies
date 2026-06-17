// Undo / redo history. Snapshots are full shape lists; undo/redo also broadcast
// a `replace` so peers converge on the restored state.

import { controls, state } from "./state.js";
import { cloneShapeData, hydrateShapeList, save, serializeShape } from "./shapes.js";
import { net } from "./net.js";
import { redraw } from "./render.js";

function snapshotShapes() {
  return state.shapes.map(cloneShapeData);
}

export function restoreSnapshot(snapshot) {
  state.shapes.length = 0;
  state.shapes.push(...hydrateShapeList(snapshot));
  save();
  redraw();
}

export function recordHistory(clearRedo = true) {
  state.historyStack.push(snapshotShapes());
  if (state.historyStack.length > 100) {
    state.historyStack.shift();
  }
  if (clearRedo) {
    state.redoStack.length = 0;
  }
  updateHistoryButtons();
}

export function updateHistoryButtons() {
  controls.undoBtn.disabled = !state.historyStack.length && !state.shapes.length;
  controls.redoBtn.disabled = !state.redoStack.length;
}

export function undo() {
  if (!state.historyStack.length) {
    if (!state.shapes.length) return;
    state.redoStack.push(snapshotShapes());
    state.shapes.pop();
    save();
    net.send({ type: "replace", shapes: state.shapes.map(serializeShape) });
    redraw();
    updateHistoryButtons();
    return;
  }

  state.redoStack.push(snapshotShapes());
  const snapshot = state.historyStack.pop();
  restoreSnapshot(snapshot);
  net.send({ type: "replace", shapes: state.shapes.map(serializeShape) });
  updateHistoryButtons();
}

export function redo() {
  if (!state.redoStack.length) return;

  recordHistory(false);
  const snapshot = state.redoStack.pop();
  restoreSnapshot(snapshot);
  net.send({ type: "replace", shapes: state.shapes.map(serializeShape) });
  updateHistoryButtons();
}

export function clearAll() {
  if (!state.shapes.length) return;
  recordHistory();
  state.shapes.length = 0;
  save();
  net.send({ type: "clear" });
  redraw();
}
