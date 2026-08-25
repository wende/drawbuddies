import { bakeSprite, nineSlice, stats } from "../../app/rough-skin.js";

const SLICE = 28;
const TILE = 96;

function applyNineSlice(el, image, slice) {
  el.style.borderImageSource = image;
  el.style.borderImageSlice = `${slice} fill`;
  el.style.borderImageWidth = `${slice}px`;
  el.style.borderImageRepeat = "stretch";
  el.style.borderWidth = `${slice}px`;
}

export default {
  id: "windows",
  title: "Resizable windows",
  tier: "Tier 3 — 9-slice vs debounced re-bake",
  note:
    "Rough geometry does not survive naive stretching. 9-slice keeps corners intact and tiles " +
    "the edges. The other window re-bakes at its real size, debounced, which is the fallback " +
    "when 9-slice reads wrong. Panels use fillStyle: solid — hachure on a large surface is hundreds of segments.",
  render(root, ctx) {
    const row = document.createElement("div");
    row.className = "hud-row hud-row--wide";

    const sliceStart = stats.generations;
    const sliced = nineSlice(
      TILE,
      SLICE,
      { ...ctx.opts, fill: ctx.panelFill, fillStyle: "solid" },
      ctx.variant(0)
    );
    const sliceCalls = stats.generations - sliceStart;

    const sliceCol = document.createElement("div");
    sliceCol.className = "hud-col hud-col--grow";
    const slicePanel = document.createElement("div");
    slicePanel.className = "hud-window hud-window--slice";
    slicePanel.innerHTML = "<h3>9-slice</h3><p>Drag the corner. Corners stay put; edges stretch. One sprite, no resize listener.</p>";
    applyNineSlice(slicePanel, sliced.image, sliced.slice);
    sliceCol.append(slicePanel, ctx.caption(`${sliceCalls} rough call. Stretch is free.`));

    const regenCol = document.createElement("div");
    regenCol.className = "hud-col hud-col--grow";
    const regenPanel = document.createElement("div");
    regenPanel.className = "hud-window";
    regenPanel.innerHTML = "<h3>Debounced re-bake</h3><p>Drag the corner. Geometry is regenerated at the real pixel size after 140ms of quiet.</p>";

    const regenCaption = ctx.caption("0 re-bakes so far");
    let rebakes = 0;
    const seed = ctx.variant(1);

    const paint = () => {
      const w = Math.max(180, regenPanel.clientWidth);
      const h = Math.max(120, regenPanel.clientHeight);
      regenPanel.style.backgroundImage = bakeSprite(
        "rectangle",
        w,
        h,
        { ...ctx.opts, fill: ctx.panelFill, fillStyle: "solid" },
        seed
      );
      rebakes += 1;
      regenCaption.textContent = `${rebakes} re-bakes at ${w}×${h}. Seed is pinned — resize does not re-roll the wobble.`;
    };

    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(paint, 140);
    });
    ro.observe(regenPanel);
    ctx.onTeardown(() => {
      clearTimeout(timer);
      ro.disconnect();
    });
    paint();

    regenCol.append(regenPanel, regenCaption);

    row.append(sliceCol, regenCol);
    root.append(row);
  }
};
