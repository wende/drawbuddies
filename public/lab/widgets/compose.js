import { bakeSprite } from "../../app/rough-skin.js";
import { framePanel } from "./primitives.js";

const FIELD_W = 300;
const FIELD_H = 42;

export default {
  id: "compose",
  title: "Prompt & notes",
  tier: "Real <input> / <textarea> — Tier 3 frame or Tier 1 on the control",
  note:
    "Never draw UI text to canvas. Caret, selection, IME, mobile keyboards, and clipboard " +
    "only exist on real form controls. Two framing approaches sit side by side.",
  render(root, ctx) {
    root.append(ctx.subhead("Tier 3 — 9-slice frame around the field"));
    const framed = document.createElement("div");
    framed.className = "hud-fields";

    const nameField = document.createElement("label");
    nameField.className = "hud-field";
    const nameLabel = document.createElement("span");
    nameLabel.textContent = "Display name";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "display-name";
    input.placeholder = "Scribbleton";
    input.value = "Wobblesworth";
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

    framed.append(nameField, noteField);
    root.append(framed);

    root.append(ctx.subhead("Tier 1 — baked sprite on the control itself"));
    const frame = bakeSprite("rectangle", FIELD_W, FIELD_H, { ...ctx.opts, fill: "none" }, ctx.variant(0));
    const areaFrame = bakeSprite("rectangle", FIELD_W, 96, { ...ctx.opts, fill: "none" }, ctx.variant(1));

    const baked = document.createElement("div");
    baked.className = "hud-fields hud-fields--baked";

    const player = document.createElement("label");
    player.className = "hud-baked-field";
    player.innerHTML = "<span>Player name</span>";
    const playerInput = document.createElement("input");
    playerInput.type = "text";
    playerInput.placeholder = "Type here…";
    playerInput.value = "Wobblesworth";
    playerInput.style.backgroundImage = frame;
    playerInput.style.width = `${FIELD_W}px`;
    playerInput.style.height = `${FIELD_H}px`;
    player.append(playerInput);

    const search = document.createElement("label");
    search.className = "hud-baked-field";
    search.innerHTML = "<span>Search inventory</span>";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "🔍 filter…";
    searchInput.style.backgroundImage = frame;
    searchInput.style.width = `${FIELD_W}px`;
    searchInput.style.height = `${FIELD_H}px`;
    search.append(searchInput);

    const notes = document.createElement("label");
    notes.className = "hud-baked-field";
    notes.innerHTML = "<span>Notes</span>";
    const notesArea = document.createElement("textarea");
    notesArea.rows = 3;
    notesArea.placeholder = "Multi-line, resizable, spellchecked…";
    notesArea.style.backgroundImage = areaFrame;
    notesArea.style.width = `${FIELD_W}px`;
    notesArea.style.height = "96px";
    notes.append(notesArea);

    baked.append(player, search, notes);
    root.append(baked);
    root.append(ctx.metric("2 rough calls for the Tier 1 pair · all interaction handled natively"));
  }
};
