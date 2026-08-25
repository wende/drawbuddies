import { bakeSprite, stats } from "../../app/rough-skin.js";

const SLOT = 56;
const COLS = 10;
const ROWS = 6;
const TOTAL = COLS * ROWS;

const LOOT = [
  { glyph: "🔑", stack: 1 },
  { glyph: "📜", stack: 3 },
  { glyph: "🧪", stack: 12 },
  { glyph: "🪙", stack: 48 },
  { glyph: "🗡️", stack: 1 },
  { glyph: "🛡️", stack: 1 },
  { glyph: "🍎", stack: 7 },
  { glyph: "💎", stack: 2 },
  { glyph: "🕯️", stack: 5 },
  { glyph: "🧭", stack: 1 },
  { glyph: "🪶", stack: 9 },
  { glyph: "🔔", stack: 1 },
  { glyph: "🪵", stack: 16 },
  { glyph: "🧵", stack: 4 },
  { glyph: "🦴", stack: 6 }
];

function pack() {
  const cells = Array.from({ length: TOTAL }, () => null);
  LOOT.forEach((item, i) => {
    cells[i * 3] = { ...item };
  });
  cells[17] = { glyph: "🔒", stack: 1, locked: true };
  cells[18] = { glyph: "🔒", stack: 1, locked: true };
  return cells;
}

function paintSlot(slot, item, sprites, index) {
  slot.style.backgroundImage = sprites[index % sprites.length];
  slot.replaceChildren();
  slot.dataset.empty = item ? "0" : "1";
  slot.classList.toggle("is-locked", Boolean(item?.locked));
  if (!item) return;
  const glyph = document.createElement("span");
  glyph.className = "hud-glyph";
  glyph.textContent = item.glyph;
  slot.append(glyph);
  if (item.stack > 1) {
    const stack = document.createElement("span");
    stack.className = "hud-stack";
    stack.textContent = String(item.stack);
    slot.append(stack);
  }
}

function bindDrag(grid, cells, sprites, ctx) {
  let drag = null;

  const onMove = (event) => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true;
    drag.ghost.style.transform = `translate3d(${event.clientX - 14}px, ${event.clientY - 14}px, 0)`;
  };

  const onUp = (event) => {
    if (!drag) return;
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest(".hud-bag .hud-slot");
    const from = Number(drag.slot.dataset.index);
    const moved = drag.moved;
    drag.ghost.remove();
    drag.slot.classList.remove("is-source");
    if (moved && over && over !== drag.slot && !cells[Number(over.dataset.index)]?.locked && !cells[from]?.locked) {
      const to = Number(over.dataset.index);
      const swapped = cells[from];
      cells[from] = cells[to];
      cells[to] = swapped;
      paintSlot(drag.slot, cells[from], sprites, from);
      paintSlot(over, cells[to], sprites, to);
    }
    drag = null;
  };

  grid.addEventListener("pointerdown", (event) => {
    const slot = event.target.closest(".hud-slot");
    if (!slot || slot.dataset.empty === "1" || slot.classList.contains("is-locked")) return;
    const ghost = document.createElement("div");
    ghost.className = "hud-ghost";
    ghost.textContent = cells[Number(slot.dataset.index)].glyph;
    ghost.style.transform = `translate3d(${event.clientX - 14}px, ${event.clientY - 14}px, 0)`;
    document.body.append(ghost);
    slot.classList.add("is-source");
    drag = { slot, ghost, x: event.clientX, y: event.clientY, moved: false };
    slot.setPointerCapture(event.pointerId);
  });

  grid.addEventListener("pointermove", onMove);
  grid.addEventListener("pointerup", onUp);
  grid.addEventListener("pointercancel", onUp);
  ctx.onTeardown(() => {
    drag?.ghost.remove();
    drag = null;
  });
}

export default {
  id: "bag",
  title: "Loot bag",
  tier: "Tier 1 — baked data-URI sprites",
  note:
    "CSS Grid lays out the bag. Slot chrome is four baked sprites assigned by index % 4. " +
    "Sixty cells cost four rough calls and zero extra DOM nodes. Drag uses pointer events " +
    "and a single translate3d ghost — not the HTML5 drag-and-drop API.",
  render(root, ctx) {
    const before = stats.generations;
    const sprites = Array.from({ length: 4 }, (_, i) =>
      bakeSprite("rectangle", SLOT, SLOT, { ...ctx.opts, fill: "transparent" }, ctx.variant(i))
    );
    const calls = stats.generations - before;

    const cells = pack();
    const grid = document.createElement("div");
    grid.className = "hud-bag";
    grid.style.setProperty("--slot", `${SLOT}px`);

    cells.forEach((item, index) => {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "hud-slot";
      slot.dataset.index = String(index);
      paintSlot(slot, item, sprites, index);
      slot.addEventListener("click", () => {
        if (slot.classList.contains("is-locked")) return;
        for (const other of grid.querySelectorAll(".hud-slot")) other.classList.remove("is-picked");
        slot.classList.add("is-picked");
      });
      grid.append(slot);
    });

    bindDrag(grid, cells, sprites, ctx);
    root.append(grid);

    const hotLabel = ctx.subhead("Hotbar — same four sprites, ten more cells");
    root.append(hotLabel);

    const hot = document.createElement("div");
    hot.className = "hud-hotbar";
    const hotItems = [LOOT[4], LOOT[0], LOOT[2], null, LOOT[6], null, null, LOOT[7], null, LOOT[3]];
    hotItems.forEach((item, index) => {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "hud-slot hud-hot";
      slot.style.setProperty("--slot", `${SLOT}px`);
      paintSlot(slot, item, sprites, index);
      const key = document.createElement("span");
      key.className = "hud-key";
      key.textContent = index === 9 ? "0" : String(index + 1);
      slot.append(key);
      hot.append(slot);
    });
    root.append(hot);

    root.append(
      ctx.metric(`${TOTAL} slots · ${calls} rough calls · 0 added SVG nodes`)
    );
  }
};
