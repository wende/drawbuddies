import { registerSprite, skin } from "../../app/rough-skin.js";

const LABELS = ["Draw", "Select", "Hand", "Text", "Imagine"];

export default {
  id: "actions",
  title: "Action buttons",
  tier: "Tier 2 — shared <defs> + <use>",
  note:
    "Hover, press, selected, and disabled are paint-only. Geometry is registered once " +
    "per seed variant; every button is a <use> of that sprite. State never re-rolls the wobble.",
  render(root, ctx) {
    const row = document.createElement("div");
    row.className = "hud-toolbar";

    LABELS.forEach((label, i) => {
      const id = ctx.key(`btn-${i % ctx.seeds.length}`);
      registerSprite(id, "rectangle", 148, 42, ctx.opts, ctx.variant(i));

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hud-btn";
      btn.textContent = label;
      if (i === 0) btn.classList.add("is-picked");
      if (label === "Imagine") btn.disabled = true;
      skin(btn, { id, w: 148, h: 42, options: ctx.opts, seed: ctx.variant(i) });
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        for (const other of row.querySelectorAll(".hud-btn")) other.classList.remove("is-picked");
        btn.classList.add("is-picked");
      });
      row.append(btn);
    });

    root.append(row);
    root.append(ctx.caption("Selected tool keeps the same seed; only --skin-fill and color change."));

    const live = document.createElement("h3");
    live.className = "hud-subhead";
    live.textContent = "Optional alive-sketch shimmer";
    root.append(live);

    const shimmer = document.createElement("button");
    shimmer.type = "button";
    shimmer.className = "hud-btn";
    shimmer.textContent = "Sketch";
    const frameIds = ctx.seeds.slice(0, 3).map((seed, i) => {
      const id = ctx.key(`shimmer-${i}`);
      registerSprite(id, "rectangle", 148, 42, ctx.opts, seed);
      return id;
    });
    skin(shimmer, { id: frameIds[0], w: 148, h: 42, options: ctx.opts, seed: ctx.seeds[0] });
    root.append(shimmer);

    if (!ctx.reducedMotion && frameIds.length > 1) {
      let frame = 0;
      const use = shimmer.querySelector("use");
      const timer = setInterval(() => {
        frame = (frame + 1) % frameIds.length;
        use.setAttribute("href", `#${frameIds[frame]}`);
      }, 140);
      ctx.onTeardown(() => clearInterval(timer));
      root.append(ctx.caption("3 pre-baked seeds at ~7fps. Gated by prefers-reduced-motion. Never regenerate per frame."));
    } else {
      root.append(ctx.caption("Shimmer skipped (prefers-reduced-motion). Sprite stays on a single pinned seed."));
    }
  }
};
