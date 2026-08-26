import { bakeSprite, stats } from "../../app/rough-skin.js";
import { framePanel, skinnedButton, skinnedChip } from "./primitives.js";

const TOOLS = ["Draw", "Imagine", "Select", "Move", "Scale", "Rotate", "Text"];
const AVATAR_TOOLS = ["Draw", "Select", "Move", "Scale", "Rotate", "Text"];

const ROOMS = [
  { title: "lobby", count: 3 },
  { title: "doodle-den", count: 2 },
  { title: "quiet-studio", count: 1 }
];

function syncRange(input, output) {
  const paint = () => {
    output.textContent = Number(input.value).toFixed(1);
  };
  input.addEventListener("input", paint);
  paint();
}

function makeToolRow(ctx, labels, { prefix, compact = true }) {
  const row = document.createElement("div");
  row.className = "hud-board-tools";
  labels.forEach((label, i) => {
    const btn = skinnedButton(ctx, {
      label,
      prefix,
      index: i,
      w: compact ? 86 : 108,
      h: 34,
      picked: i === 0,
      disabled: label === "Imagine"
    });
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      for (const other of row.querySelectorAll(".hud-btn")) other.classList.remove("is-picked");
      btn.classList.add("is-picked");
    });
    row.append(btn);
  });
  return row;
}

function makeHint(ctx) {
  const hint = document.createElement("div");
  hint.className = "hud-board-hint";
  hint.textContent =
    "Select creates a group from a rectangle. Move, Scale, and Rotate transform one shape or the current selection. Text adds Excalifont labels.";
  framePanel(hint, ctx, ctx.variant(0), { size: 88, slice: 18 });
  return hint;
}

function makePresence(ctx) {
  const chip = document.createElement("div");
  chip.className = "hud-board-presence";
  const dot = document.createElement("span");
  dot.className = "hud-board-dot is-live";
  const label = document.createElement("span");
  label.textContent = "2 people here";
  chip.append(dot, label);
  framePanel(chip, ctx, ctx.variant(1), { size: 72, slice: 16 });
  return chip;
}

function makeMoveHint(ctx) {
  const tip = document.createElement("div");
  tip.className = "hud-board-move";
  tip.textContent = "WASD to move";
  framePanel(tip, ctx, ctx.variant(2), { size: 64, slice: 14 });
  return tip;
}

function makeToolbar(ctx) {
  const bar = document.createElement("div");
  bar.className = "hud-board-toolbar";
  framePanel(bar, ctx, ctx.variant(0), { size: 120, slice: 24 });

  const tools = makeToolRow(ctx, TOOLS, { prefix: "board-tool" });

  const colorGroup = document.createElement("div");
  colorGroup.className = "hud-board-group";
  const colorLabel = document.createElement("label");
  colorLabel.className = "hud-board-label";
  colorLabel.textContent = "Color";
  const color = document.createElement("input");
  color.type = "color";
  color.value = "#241f18";
  colorLabel.append(color);
  colorGroup.append(colorLabel);

  const styleGroup = document.createElement("div");
  styleGroup.className = "hud-board-group hud-board-sliders";
  for (const [name, min, max, step, value] of [
    ["Rough", 0, 4, 0.1, 1.5],
    ["Bow", 0, 10, 0.1, 1.0],
    ["Width", 1, 14, 0.5, 2]
  ]) {
    const label = document.createElement("label");
    label.className = "hud-board-label";
    const title = document.createElement("span");
    title.textContent = name;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement("span");
    out.className = "hud-board-value";
    syncRange(input, out);
    label.append(title, input, out);
    styleGroup.append(label);
  }

  const history = document.createElement("div");
  history.className = "hud-board-group";
  for (const [label, i] of [
    ["Undo", 0],
    ["Redo", 1],
    ["Clear", 2]
  ]) {
    history.append(
      skinnedButton(ctx, {
        label,
        prefix: "board-hist",
        index: i,
        w: 72,
        h: 34
      })
    );
  }

  bar.append(tools, colorGroup, styleGroup, history);
  return bar;
}

function makePaperArt(ctx) {
  const art = document.createElement("div");
  art.className = "hud-board-art";
  // A few baked Tier-1 doodles so the "canvas" reads as a board, not empty paper.
  const doodles = [
    { shape: "ellipse", w: 120, h: 80, left: "12%", top: "18%", seed: 0 },
    { shape: "rectangle", w: 160, h: 100, left: "58%", top: "22%", seed: 1 },
    { shape: "line", w: 180, h: 40, left: "28%", top: "58%", seed: 2 }
  ];
  for (const doodle of doodles) {
    const el = document.createElement("div");
    el.className = "hud-board-doodle";
    el.style.width = `${doodle.w}px`;
    el.style.height = `${doodle.h}px`;
    el.style.left = doodle.left;
    el.style.top = doodle.top;
    el.style.backgroundImage = bakeSprite(
      doodle.shape,
      doodle.w,
      doodle.h,
      { ...ctx.opts, fill: "transparent" },
      ctx.variant(doodle.seed)
    );
    art.append(el);
  }
  return art;
}

function makeAvatarOverlay(ctx) {
  const overlay = document.createElement("div");
  overlay.className = "hud-board-overlay";
  overlay.hidden = true;

  const dialog = document.createElement("div");
  dialog.className = "hud-board-dialog hud-board-dialog--avatar";
  framePanel(dialog, ctx, ctx.variant(1), { size: 128, slice: 28 });

  const stage = document.createElement("div");
  stage.className = "hud-board-avatar-stage";
  framePanel(stage, ctx, ctx.variant(2), { size: 96, slice: 20 });
  const placeholder = document.createElement("p");
  placeholder.className = "hud-board-avatar-placeholder";
  placeholder.textContent = "Avatar canvas lives here — world-space drawing stays on a real <canvas>.";
  stage.append(placeholder);

  const panel = document.createElement("div");
  panel.className = "hud-board-avatar-panel";
  const title = document.createElement("h3");
  title.textContent = "Avatar";
  panel.append(title);
  panel.append(makeToolRow(ctx, AVATAR_TOOLS, { prefix: "avatar-tool" }));

  const hist = document.createElement("div");
  hist.className = "hud-board-group";
  hist.append(
    skinnedButton(ctx, { label: "Undo", prefix: "avatar-hist", index: 0, w: 72, h: 32 }),
    skinnedButton(ctx, { label: "Redo", prefix: "avatar-hist", index: 1, w: 72, h: 32 })
  );
  panel.append(hist);

  const actions = document.createElement("div");
  actions.className = "hud-board-dialog-actions";
  for (const [label, i, primary] of [
    ["Play", 0, false],
    ["Clear", 1, false],
    ["Cancel", 2, false],
    ["Okay", 3, true]
  ]) {
    const btn = skinnedButton(ctx, {
      label,
      prefix: "avatar-act",
      index: i,
      w: primary ? 96 : 78,
      h: 34,
      picked: primary
    });
    if (label === "Cancel" || label === "Okay") btn.dataset.action = "close";
    actions.append(btn);
  }
  panel.append(actions);

  dialog.append(stage, panel);
  overlay.append(dialog);
  return overlay;
}

function makeRoomsOverlay(ctx) {
  const overlay = document.createElement("div");
  overlay.className = "hud-board-overlay";
  overlay.hidden = true;

  const dialog = document.createElement("div");
  dialog.className = "hud-board-dialog hud-board-dialog--rooms";
  framePanel(dialog, ctx, ctx.variant(3), { size: 112, slice: 24 });

  const title = document.createElement("h3");
  title.textContent = "Rooms";
  dialog.append(title);

  const listHead = document.createElement("h4");
  listHead.className = "hud-board-kicker";
  listHead.textContent = "Public rooms";
  dialog.append(listHead);

  const list = document.createElement("div");
  list.className = "hud-board-room-list";
  ROOMS.forEach((room, i) => {
    const item = skinnedButton(ctx, {
      label: `${room.title}  ·  ${room.count}`,
      prefix: "room-item",
      index: i,
      w: 280,
      h: 38,
      className: "hud-btn hud-btn--room"
    });
    item.style.width = "100%";
    list.append(item);
  });
  dialog.append(list);

  const createHead = document.createElement("h4");
  createHead.className = "hud-board-kicker";
  createHead.textContent = "Create";
  dialog.append(createHead);

  const createRow = document.createElement("div");
  createRow.className = "hud-board-form-row";
  const titleField = document.createElement("label");
  titleField.className = "hud-board-field";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Room title (public only)";
  titleInput.maxLength = 60;
  titleField.append(titleInput);
  framePanel(titleField, ctx, ctx.variant(0), { size: 72, slice: 14 });
  createRow.append(
    titleField,
    skinnedButton(ctx, { label: "Create", prefix: "room-create", index: 0, w: 88, h: 34, picked: true })
  );
  dialog.append(createRow);

  const joinHead = document.createElement("h4");
  joinHead.className = "hud-board-kicker";
  joinHead.textContent = "Join by code";
  dialog.append(joinHead);

  const joinRow = document.createElement("div");
  joinRow.className = "hud-board-form-row";
  const codeField = document.createElement("label");
  codeField.className = "hud-board-field";
  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.placeholder = "e.g. ABC234";
  codeInput.maxLength = 6;
  codeField.append(codeInput);
  framePanel(codeField, ctx, ctx.variant(1), { size: 72, slice: 14 });
  joinRow.append(
    codeField,
    skinnedButton(ctx, { label: "Go", prefix: "room-join", index: 0, w: 64, h: 34 })
  );
  dialog.append(joinRow);

  const footer = document.createElement("div");
  footer.className = "hud-board-dialog-actions";
  const lobbyBtn = skinnedButton(ctx, { label: "← Lobby", prefix: "room-foot", index: 0, w: 96, h: 34 });
  lobbyBtn.dataset.action = "close";
  const closeBtn = skinnedButton(ctx, { label: "Close", prefix: "room-foot", index: 1, w: 80, h: 34 });
  closeBtn.dataset.action = "close";
  footer.append(lobbyBtn, closeBtn);
  dialog.append(footer);

  overlay.append(dialog);
  return overlay;
}

export default {
  id: "board",
  title: "Board shell",
  tier: "Composed screen-space HUD",
  note:
    "Full counterpart of the main DrawBuddies chrome, rebuilt from the primitives above: " +
    "Tier 3 frames for hint / toolbar / dialogs, Tier 2 pressed-dent buttons, real text fields, " +
    "and native range inputs. The paper doodles are Tier 1 sprites standing in for world-space canvas content.",
  render(root, ctx) {
    const before = stats.generations;

    const stage = document.createElement("div");
    stage.className = "hud-board";
    stage.append(makePaperArt(ctx));

    const chrome = document.createElement("div");
    chrome.className = "hud-board-chrome";
    chrome.append(makeHint(ctx));

    const top = document.createElement("div");
    top.className = "hud-board-top";
    top.append(makePresence(ctx));
    const roomsBtn = skinnedChip(ctx, { label: "Rooms ▾", prefix: "board-top", index: 0, w: 100, h: 32 });
    const avatarBtn = skinnedChip(ctx, { label: "Avatar", prefix: "board-top", index: 1, w: 88, h: 32 });
    top.append(roomsBtn, avatarBtn);
    chrome.append(top);

    chrome.append(makeMoveHint(ctx));
    chrome.append(makeToolbar(ctx));
    stage.append(chrome);

    const avatarOverlay = makeAvatarOverlay(ctx);
    const roomsOverlay = makeRoomsOverlay(ctx);
    stage.append(avatarOverlay, roomsOverlay);

    const modes = document.createElement("div");
    modes.className = "hud-board-modes";
    const modeDefs = [
      { id: "board", label: "Board chrome", overlay: null },
      { id: "avatar", label: "Avatar editor", overlay: avatarOverlay },
      { id: "rooms", label: "Rooms", overlay: roomsOverlay }
    ];
    const modeButtons = [];
    const show = (id) => {
      for (const def of modeDefs) {
        if (def.overlay) def.overlay.hidden = def.id !== id;
      }
      for (const btn of modeButtons) {
        btn.classList.toggle("is-picked", btn.dataset.mode === id);
      }
      chrome.hidden = id !== "board";
    };
    modeDefs.forEach((def, i) => {
      const btn = skinnedButton(ctx, {
        label: def.label,
        prefix: "board-mode",
        index: i,
        w: 140,
        h: 34,
        picked: i === 0
      });
      btn.dataset.mode = def.id;
      btn.addEventListener("click", () => show(def.id));
      modeButtons.push(btn);
      modes.append(btn);
    });
    roomsBtn.addEventListener("click", () => show("rooms"));
    avatarBtn.addEventListener("click", () => show("avatar"));
    for (const close of roomsOverlay.querySelectorAll('[data-action="close"]')) {
      close.addEventListener("click", () => show("board"));
    }
    for (const close of avatarOverlay.querySelectorAll('[data-action="close"]')) {
      close.addEventListener("click", () => show("board"));
    }

    root.append(stage, modes);
    show("board");

    const calls = stats.generations - before;
    root.append(
      ctx.metric(
        `Board shell · ${calls} rough calls on open · overlays swap without regenerating board chrome`
      )
    );
  }
};
