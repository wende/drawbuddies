import { bakeSprite, nineSlice, stats } from "../../app/rough-skin.js";

// The open question from docs/ui-architecture.md: does 9-slice via border-image
// hold up for rough geometry, or do the stretched edges read wrong? Both
// approaches are here side by side and both are resizable — drag the bottom-right
// corner of each and compare. The counters show what each one costs.
const SLICE_SIZE = 120;
const SLICE_INSET = 38;

export default {
  id: "panels",
  title: "Resizable panels",
  tier: "Tier 3 — 9-slice vs. regenerate",
  note: "Drag the corner of each panel. Left keeps corners and stretches edges; right re-bakes geometry (debounced 120ms). Compare look and cost.",

  render(root, ctx) {
    const row = document.createElement("div");
    row.className = "lab-row lab-row--wide";

    // --- Left: 9-slice, generated exactly once ------------------------------
    const sliceBefore = stats.generations;
    const { image, slice } = nineSlice(
      SLICE_SIZE,
      SLICE_INSET,
      { ...ctx.opts, fill: "none" },
      ctx.variant(0)
    );

    const sliced = document.createElement("div");
    sliced.className = "panel panel--slice";
    sliced.style.borderImageSource = image;
    sliced.style.borderImageSlice = `${slice} fill`;
    sliced.style.borderImageWidth = `${slice}px`;
    sliced.innerHTML =
      "<h4>9-slice</h4><p>Corners are preserved, edges stretch. One generation, ever — resizing costs nothing.</p>";

    const sliceMetric = ctx.metric(`${stats.generations - sliceBefore} rough call · 0 on resize`);

    // --- Right: regenerate on resize, debounced -----------------------------
    const regen = document.createElement("div");
    regen.className = "panel panel--regen";
    regen.innerHTML =
      "<h4>Regenerate</h4><p>Geometry is re-baked at the new size. Truest strokes, but every resize pays for it.</p>";

    let regenCount = 0;
    const regenMetric = ctx.metric("0 rough calls on resize");

    const rebake = () => {
      const { width, height } = regen.getBoundingClientRect();
      // Quantise so a one-pixel drag does not re-roll the whole panel.
      const w = Math.max(120, Math.round(width / 4) * 4);
      const h = Math.max(80, Math.round(height / 4) * 4);
      regen.style.backgroundImage = bakeSprite(
        "rectangle",
        w,
        h,
        { ...ctx.opts, fill: "none" },
        ctx.variant(0)
      );
      regenCount += 1;
      const plural = regenCount === 1 ? "call" : "calls";
      regenMetric.textContent = `${regenCount} rough ${plural} on resize (quantised to 4px, debounced 120ms)`;
    };

    let debounce = null;
    const observer = new ResizeObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(rebake, 120);
    });
    observer.observe(regen);
    ctx.onTeardown(() => {
      observer.disconnect();
      clearTimeout(debounce);
    });

    const left = document.createElement("div");
    left.className = "lab-cell lab-cell--grow";
    left.append(sliced, sliceMetric);

    const right = document.createElement("div");
    right.className = "lab-cell lab-cell--grow";
    right.append(regen, regenMetric);

    row.append(left, right);
    root.append(row);
  }
};
