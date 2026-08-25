import { bakeSprite, stats } from "../../app/rough-skin.js";

// Tier 1. The whole thesis of docs/ui-architecture.md is that a large grid must
// cost a handful of rough calls, not one per slot. The counter under the grid is
// the proof: bump SLOT_COUNT to 240 and the generation count must not move.
const SLOT = 64;
const SLOT_COUNT = 48;

const ITEMS = ["🪓", "🗝", "🍎", "🧪", "📜", "💎", "🪶", "🕯", "🧭", "🪙"];

export default {
  id: "inventory",
  title: "Inventory grid",
  tier: "Tier 1 — baked data-URI sprites",
  note: "48 slots from 4 generated sprites and zero extra DOM nodes.",

  render(root, ctx) {
    const before = stats.generations;

    const sprites = ctx.seeds.map((seed) =>
      bakeSprite("rectangle", SLOT, SLOT, { ...ctx.opts, fill: "none" }, seed)
    );

    const grid = document.createElement("div");
    grid.className = "inv-grid";
    grid.style.setProperty("--slot", `${SLOT}px`);

    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const slot = document.createElement("button");
      slot.className = "inv-slot";
      slot.style.backgroundImage = sprites[i % sprites.length];
      slot.setAttribute("aria-label", `Slot ${i + 1}`);

      if (i % 3 === 0) {
        const item = document.createElement("span");
        item.className = "inv-item";
        item.textContent = ITEMS[i % ITEMS.length];
        slot.append(item);

        const count = document.createElement("span");
        count.className = "inv-count";
        count.textContent = String(((i * 7) % 63) + 1);
        slot.append(count);
      }

      if (i === 4) slot.classList.add("is-selected");
      if (i === 9) slot.classList.add("is-locked");

      slot.addEventListener("click", () => {
        grid.querySelector(".is-selected")?.classList.remove("is-selected");
        slot.classList.add("is-selected");
      });

      grid.append(slot);
    }

    root.append(grid);
    root.append(
      ctx.metric(
        `${SLOT_COUNT} slots · ${stats.generations - before} rough calls · ` +
          `${grid.querySelectorAll("svg").length} added SVG nodes`
      )
    );
  }
};
