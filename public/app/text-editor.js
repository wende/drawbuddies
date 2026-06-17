// Floating text editor: a <textarea> positioned in world space that commits a
// "text" shape on Enter/blur. autosizeTextEditor is shared with the avatar editor.

import { newId, newSeed, state } from "./state.js";
import { round1, worldToScreen } from "./geometry.js";
import { currentOptions, save, serializeShape } from "./shapes.js";
import { recordHistory } from "./history.js";
import { net } from "./net.js";
import { redraw } from "./render.js";

export function autosizeTextEditor(editor) {
  editor.style.height = "auto";
  editor.style.width = "auto";
  editor.style.height = Math.max(42, editor.scrollHeight + 2) + "px";
  editor.style.width = Math.max(160, editor.scrollWidth + 18) + "px";
}

export function openTextEditor(point) {
  const editor = document.createElement("textarea");
  editor.className = "text-editor";
  editor.spellcheck = false;
  editor.placeholder = "Text";
  const screen = worldToScreen(point);
  editor.style.left = `${Math.round(screen.x)}px`;
  editor.style.top = `${Math.round(screen.y)}px`;
  document.body.appendChild(editor);

  const commit = () => {
    if (!editor.parentNode) return;

    const text = editor.value.trimEnd();
    editor.remove();

    if (!text.trim()) {
      redraw();
      return;
    }

    const shape = {
      id: newId(),
      type: "text",
      geom: {
        x: round1(point.x),
        y: round1(point.y),
        text,
        fontSize: 28
      },
      options: currentOptions(newSeed()),
      drawable: null
    };

    recordHistory();
    state.shapes.push(shape);
    save();
    net.send({ type: "add", shape: serializeShape(shape) });
    redraw();
  };

  const cancel = () => {
    if (!editor.parentNode) return;
    editor.remove();
    redraw();
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
