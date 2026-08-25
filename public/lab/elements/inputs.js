import { bakeSprite } from "../../app/rough-skin.js";

// Real form controls inside a rough frame. This is the panel that justifies the
// whole DOM decision: click into the field and you get caret, selection, IME,
// mobile keyboard, and clipboard for free. None of that survives a move to canvas.
const FIELD_W = 300;
const FIELD_H = 42;

export default {
  id: "inputs",
  title: "Text input",
  tier: "Native controls in a rough frame",
  note: "Real <input> and <textarea>. Type in them — selection, IME, and autofill all behave, which is the argument against canvas UI.",

  render(root, ctx) {
    const frame = bakeSprite("rectangle", FIELD_W, FIELD_H, { ...ctx.opts, fill: "none" }, ctx.variant(0));
    const areaFrame = bakeSprite("rectangle", FIELD_W, 96, { ...ctx.opts, fill: "none" }, ctx.variant(1));

    const form = document.createElement("div");
    form.className = "field-list";

    const nameField = document.createElement("label");
    nameField.className = "field";
    nameField.innerHTML = "<span>Player name</span>";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type here…";
    input.value = "Wobblesworth";
    input.style.backgroundImage = frame;
    input.style.width = `${FIELD_W}px`;
    input.style.height = `${FIELD_H}px`;
    nameField.append(input);

    const searchField = document.createElement("label");
    searchField.className = "field";
    searchField.innerHTML = "<span>Search inventory</span>";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "🔍 filter…";
    search.style.backgroundImage = frame;
    search.style.width = `${FIELD_W}px`;
    search.style.height = `${FIELD_H}px`;
    searchField.append(search);

    const noteField = document.createElement("label");
    noteField.className = "field";
    noteField.innerHTML = "<span>Notes</span>";
    const area = document.createElement("textarea");
    area.rows = 3;
    area.placeholder = "Multi-line, resizable, spellchecked…";
    area.style.backgroundImage = areaFrame;
    area.style.width = `${FIELD_W}px`;
    area.style.height = "96px";
    noteField.append(area);

    form.append(nameField, searchField, noteField);
    root.append(form);
    root.append(ctx.metric("2 rough calls · all interaction handled natively"));
  }
};
