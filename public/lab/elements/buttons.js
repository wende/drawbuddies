import { skin } from "../../app/rough-skin.js";

// Tier 2. The point of this panel is the *negative* result: hover, active, and
// disabled must change color only. If you ever see the outline redraw itself on
// hover, a seed is leaking or geometry is being regenerated.
const STATES = [
  { label: "Default", cls: "" },
  { label: "Hover", cls: "is-hover" },
  { label: "Active", cls: "is-active" },
  { label: "Disabled", cls: "is-disabled" },
  { label: "Selected", cls: "is-selected" }
];

export default {
  id: "buttons",
  title: "Buttons",
  tier: "Tier 2 — shared <defs> + <use>",
  note: "Every state below shares one generated outline. Hover them: the wobble must not move.",

  render(root, ctx) {
    const row = document.createElement("div");
    row.className = "lab-row";

    STATES.forEach((state, i) => {
      const cell = document.createElement("div");
      cell.className = "lab-cell";

      const button = document.createElement("button");
      button.className = `skin-btn ${state.cls}`;
      button.textContent = state.label;
      if (state.cls === "is-disabled") button.disabled = true;
      skin(button, {
        id: ctx.key("btn"),
        w: 132,
        h: 40,
        options: { ...ctx.opts, fill: "none" },
        seed: ctx.variant(0)
      });

      cell.append(button, ctx.caption(state.label));
      row.append(cell);
    });

    root.append(row);

    const seedRow = document.createElement("div");
    seedRow.className = "lab-row";
    ctx.seeds.forEach((seed, i) => {
      const cell = document.createElement("div");
      cell.className = "lab-cell";
      const button = document.createElement("button");
      button.className = "skin-btn";
      button.textContent = `Seed ${i + 1}`;
      skin(button, {
        id: ctx.key(`btn-v${i}`),
        w: 132,
        h: 40,
        options: { ...ctx.opts, fill: "none" },
        seed
      });
      cell.append(button, ctx.caption(`variant ${i + 1}`));
      seedRow.append(cell);
    });

    root.append(ctx.subhead("Seed pool — variants must look related, not identical"), seedRow);
  }
};
