import { bakeSprite, nineSlice, stats } from "../../app/rough-skin.js";
import { applySlice } from "./primitives.js";

const SLICE = 28;
const TILE = 96;

export default {
  id: "windows",
  title: "Resizable windows",
  tier: "Tier 3 — 9-slice vs debounced re-bake",
  note:
    "Rough geometry does not survive naive stretching. 9-slice keeps corners intact and tiles " +
    "the edges. The other window re-bakes at size (debounced, quantized to 4px). Solid fill is " +
    "preferred for panels; an outline-only 9-slice sits beside it for comparison.",
  render(root, ctx) {
    const row = document.createElement("div");
    row.className = "hud-row hud-row--wide";

    const sliceStart = stats.generations;
    const solid = nineSlice(
      TILE,
      SLICE,
      { ...ctx.opts, fill: ctx.panelFill, fillStyle: "solid" },
      ctx.variant(0)
    );
    const outline = nineSlice(TILE, SLICE, { ...ctx.opts, fill: "none" }, ctx.variant(2));
    const sliceCalls = stats.generations - sliceStart;

    const solidCol = document.createElement("div");
    solidCol.className = "hud-col hud-col--grow";
    const solidPanel = document.createElement("div");
    solidPanel.className = "hud-window hud-window--slice";
    solidPanel.innerHTML =
      "<h3>9-slice · solid</h3><p>Corners stay put; edges stretch. One sprite, no resize listener. Theme-aware fill.</p>";
    applySlice(solidPanel, solid.image, solid.slice);
    solidCol.append(solidPanel, ctx.caption(`${sliceCalls} rough calls for both 9-slices. Stretch is free.`));

    const outlineCol = document.createElement("div");
    outlineCol.className = "hud-col hud-col--grow";
    const outlinePanel = document.createElement("div");
    outlinePanel.className = "hud-window hud-window--slice";
    outlinePanel.innerHTML =
      "<h3>9-slice · outline</h3><p>Same approach with fill: none — the lab's original look. Useful when the paper already shows through.</p>";
    applySlice(outlinePanel, outline.image, outline.slice);
    outlineCol.append(outlinePanel, ctx.caption("Outline-only. Still one bake, still free to resize."));

    const regenCol = document.createElement("div");
    regenCol.className = "hud-col hud-col--grow";
    const regenPanel = document.createElement("div");
    regenPanel.className = "hud-window";
    regenPanel.innerHTML =
      "<h3>Debounced re-bake</h3><p>Geometry regenerates at a 4px-quantized size after 120ms of quiet. Seed is pinned.</p>";

    const regenCaption = ctx.caption("0 re-bakes so far");
    let rebakes = 0;
    const seed = ctx.variant(1);

    const paint = () => {
      const box = regenPanel.getBoundingClientRect();
      const w = Math.max(180, Math.round(box.width / 4) * 4);
      const h = Math.max(120, Math.round(box.height / 4) * 4);
      regenPanel.style.backgroundImage = bakeSprite(
        "rectangle",
        w,
        h,
        { ...ctx.opts, fill: ctx.panelFill, fillStyle: "solid" },
        seed
      );
      rebakes += 1;
      const plural = rebakes === 1 ? "re-bake" : "re-bakes";
      regenCaption.textContent = `${rebakes} ${plural} at ${w}×${h} (4px grid, 120ms). Seed pinned.`;
    };

    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(paint, 120);
    });
    ro.observe(regenPanel);
    ctx.onTeardown(() => {
      clearTimeout(timer);
      ro.disconnect();
    });
    paint();

    regenCol.append(regenPanel, regenCaption);

    row.append(solidCol, outlineCol, regenCol);
    root.append(row);
  }
};
