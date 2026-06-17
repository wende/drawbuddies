// Entry point: wires DOM controls, the toolbar, keyboard shortcuts, and canvas
// pointer events to the feature modules, then runs the initial load/connect.

import { canvas, controls, state } from "./state.js";
import { clearSelection, load } from "./shapes.js";
import { redraw, resize } from "./render.js";
import { clearAll, redo, undo, updateHistoryButtons } from "./history.js";
import { loadPlayerState, net } from "./net.js";
import {
  cancelPointer,
  finishPointer,
  handleMovementKey,
  onPointerDown,
  onPointerMove,
  updateMovementHint
} from "./input.js";
import { avatarEditor } from "./avatar-editor.js";

function refreshControlLabels() {
  controls.roughnessValue.textContent = Number(controls.roughness.value).toFixed(1);
  controls.bowingValue.textContent = Number(controls.bowing.value).toFixed(1);
  controls.strokeWidthValue.textContent = Number(controls.strokeWidth.value).toFixed(1);
}

document.querySelectorAll(".tool").forEach((button) => {
  button.addEventListener("click", () => {
    state.currentTool = button.dataset.tool;
    if (state.currentTool === "smart") {
      clearSelection();
    }
    document.body.classList.toggle("hand-mode", state.currentTool === "hand");
    document.body.classList.toggle("text-mode", state.currentTool === "text");
    document.body.classList.toggle("select-mode", state.currentTool === "select");
    document.body.classList.toggle("scale-mode", state.currentTool === "scale");
    document.body.classList.toggle("rotate-mode", state.currentTool === "rotate");

    document.querySelectorAll(".tool").forEach((b) => {
      b.classList.toggle("active", b === button);
    });

    redraw();
  });
});

[
  controls.roughness,
  controls.bowing,
  controls.strokeWidth
].forEach((input) => {
  input.addEventListener("input", refreshControlLabels);
  input.addEventListener("change", refreshControlLabels);
});

controls.undoBtn.addEventListener("click", undo);
controls.redoBtn.addEventListener("click", redo);
controls.clearBtn.addEventListener("click", clearAll);
controls.avatarBtn.addEventListener("click", () => avatarEditor.open());

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (handleMovementKey(event, true)) return;

  if (avatarEditor.isOpen() && key === "escape") {
    event.preventDefault();
    avatarEditor.close();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey) {
    event.preventDefault();
    if (avatarEditor.isOpen()) avatarEditor.undo();
    else undo();
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    (key === "y" || (key === "z" && event.shiftKey))
  ) {
    event.preventDefault();
    if (avatarEditor.isOpen()) avatarEditor.redo();
    else redo();
  }
});
document.addEventListener("keyup", (event) => {
  handleMovementKey(event, false);
});

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", cancelPointer);
canvas.addEventListener("lostpointercapture", () => {
  if (state.activeDrag) {
    state.activeDrag = null;
    document.body.classList.remove("dragging-shape");
    redraw();
  }
});

window.addEventListener("resize", resize);

if (document.fonts && document.fonts.load) {
  document.fonts.load("28px Excalifont")
    .then(() => redraw())
    .catch(() => console.warn('Excalifont failed to load; browser fallback will be used.'));
}

refreshControlLabels();
load();
loadPlayerState();
updateMovementHint();
updateHistoryButtons();
resize();
net.connect();
