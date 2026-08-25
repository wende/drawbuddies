// Entry point: wires DOM controls, the toolbar, keyboard shortcuts, and canvas
// pointer events to the feature modules, then runs the initial load/connect.

import { controls, TOUCH_UI_QUERY } from "./state.js";
import { load } from "./shapes.js";
import { redraw, resize } from "./render.js";
import { clearAll, redo, undo, updateHistoryButtons } from "./history.js";
import { loadPlayerState, net } from "./net.js";
import {
  cancelPointer,
  finishPointer,
  finishLostPointerCapture,
  handleMovementKey,
  onPointerDown,
  onPointerMove,
  syncInputModeUi,
  updateMovementHint
} from "./input.js";
import { avatarEditor } from "./avatar-editor.js";
import { rooms } from "./rooms.js";
import { bindPointerGestures, selectTool } from "./tool-wheel.js";

function refreshControlLabels() {
  controls.roughnessValue.textContent = Number(controls.roughness.value).toFixed(1);
  controls.bowingValue.textContent = Number(controls.bowing.value).toFixed(1);
  controls.strokeWidthValue.textContent = Number(controls.strokeWidth.value).toFixed(1);
}

document.querySelectorAll(".tool").forEach((button) => {
  button.addEventListener("click", () => {
    selectTool(button.dataset.tool);
  });
});

bindPointerGestures({
  onDown: onPointerDown,
  onMove: onPointerMove,
  onUp: finishPointer,
  onCancel: cancelPointer,
  onLost: finishLostPointerCapture
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
controls.roomsBtn.addEventListener("click", () => rooms.openPanel());

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

window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
if (typeof window.matchMedia === "function") {
  const touchUi = window.matchMedia(TOUCH_UI_QUERY);
  const onTouchUiChange = () => syncInputModeUi();
  if (typeof touchUi.addEventListener === "function") {
    touchUi.addEventListener("change", onTouchUiChange);
  } else if (typeof touchUi.addListener === "function") {
    touchUi.addListener(onTouchUiChange);
  }
}

if (document.fonts && document.fonts.load) {
  document.fonts.load("28px Excalifont")
    .then(() => redraw())
    .catch(() => console.warn('Excalifont failed to load; browser fallback will be used.'));
}

refreshControlLabels();
syncInputModeUi();
load();
loadPlayerState();
updateMovementHint();
updateHistoryButtons();
resize();
net.connect();
