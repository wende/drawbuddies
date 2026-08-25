import { registerSprite, skin } from "../../app/rough-skin.js";

const LABELS = ["Draw", "Select", "Hand", "Text", "Imagine"];
const DEMO = ["Draw", "Select", "Hand"];

const PRESS_OPTIONS = [
  {
    id: "stamp",
    title: "1. Ink stamp",
    className: "hud-btn--stamp",
    blurb: "Press fills solid ink and flips the label to paper. Loud, unmistakable."
  },
  {
    id: "dent",
    title: "2. Pressed dent",
    className: "hud-btn--dent",
    blurb: "Press drops the button 2px, darkens the wash, and accents the label. Familiar physical click."
  },
  {
    id: "hatch",
    title: "3. Hachure flash",
    className: "hud-btn--hatch",
    blurb: "Press swaps to a same-seed hachure sprite. Sketchiest option; selected stays a quiet wash."
  }
];

function bindPress(btn) {
  const down = () => btn.classList.add("is-pressed");
  const up = () => btn.classList.remove("is-pressed");
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("pointercancel", up);
}

function bindHatchSwap(btn, idleId, pressId) {
  const use = btn.querySelector("use");
  if (!use) return;
  const down = () => {
    btn.classList.add("is-pressed");
    use.setAttribute("href", `#${pressId}`);
  };
  const up = () => {
    btn.classList.remove("is-pressed");
    use.setAttribute("href", `#${idleId}`);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("pointercancel", up);
}

function makeToolbar(labels, { ctx, className, prefix, hatch = false, pickable = false }) {
  const row = document.createElement("div");
  row.className = "hud-toolbar";

  labels.forEach((label, i) => {
    const seed = ctx.variant(i);
    const idleId = ctx.key(`${prefix}-${i % ctx.seeds.length}`);
    registerSprite(idleId, "rectangle", 148, 42, ctx.opts, seed);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `hud-btn ${className}`.trim();
    btn.textContent = label;
    if (pickable && i === 0) btn.classList.add("is-picked");
    if (label === "Imagine") btn.disabled = true;
    skin(btn, { id: idleId, w: 148, h: 42, options: ctx.opts, seed });

    if (hatch) {
      const pressId = ctx.key(`${prefix}-hatch-${i % ctx.seeds.length}`);
      registerSprite(
        pressId,
        "rectangle",
        148,
        42,
        { ...ctx.opts, fill: ctx.ink, fillStyle: "hachure", fillWeight: 1.2, hachureGap: 4 },
        seed
      );
      bindHatchSwap(btn, idleId, pressId);
    } else {
      bindPress(btn);
    }

    if (pickable) {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        for (const other of row.querySelectorAll(".hud-btn")) other.classList.remove("is-picked");
        btn.classList.add("is-picked");
      });
    }

    row.append(btn);
  });

  return row;
}

export default {
  id: "actions",
  title: "Action buttons",
  tier: "Tier 2 — shared <defs> + <use>",
  note:
    "Hover, press, selected, and disabled are paint-only. Geometry is registered once " +
    "per seed variant; every button is a <use> of that sprite. State never re-rolls the wobble.",
  render(root, ctx) {
    root.append(
      makeToolbar(LABELS, {
        ctx,
        className: "",
        prefix: "btn",
        pickable: true
      })
    );
    root.append(ctx.caption("Baseline: press only darkens the wash. Easy to miss next to selected."));

    root.append(ctx.subhead("Press options — hold each row and compare"));

    const grid = document.createElement("div");
    grid.className = "hud-press-grid";

    for (const option of PRESS_OPTIONS) {
      const block = document.createElement("div");
      block.className = "hud-press-option";

      const title = document.createElement("strong");
      title.textContent = option.title;
      block.append(title);

      block.append(
        makeToolbar(DEMO, {
          ctx,
          className: option.className,
          prefix: `press-${option.id}`,
          hatch: option.id === "hatch",
          pickable: true
        })
      );
      block.append(ctx.caption(option.blurb));
      grid.append(block);
    }

    root.append(grid);

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
