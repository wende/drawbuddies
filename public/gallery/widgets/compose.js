import { framePanel } from "./primitives.js";

export default {
  id: "compose",
  title: "Prompt & notes",
  tier: "Real <input> / <textarea> in a Tier 3 frame",
  note:
    "Never draw UI text to canvas. Caret, selection, IME, mobile keyboards, and clipboard " +
    "only exist on real form controls. The rough look is a 9-slice frame around Excalifont text.",
  render(root, ctx) {
    const list = document.createElement("div");
    list.className = "hud-fields";

    const nameField = document.createElement("label");
    nameField.className = "hud-field";
    const nameLabel = document.createElement("span");
    nameLabel.textContent = "Display name";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "display-name";
    input.placeholder = "Scribbleton";
    input.autocomplete = "off";
    nameField.append(nameLabel, input);
    framePanel(nameField, ctx, ctx.variant(0), { size: 96, slice: 24 });

    const noteField = document.createElement("label");
    noteField.className = "hud-field";
    const noteLabel = document.createElement("span");
    noteLabel.textContent = "Room note";
    const area = document.createElement("textarea");
    area.name = "room-note";
    area.rows = 4;
    area.placeholder = "Leave a message for whoever joins next…";
    noteField.append(noteLabel, area);
    framePanel(noteField, ctx, ctx.variant(1), { size: 96, slice: 24 });

    list.append(nameField, noteField);
    root.append(list);
  }
};
