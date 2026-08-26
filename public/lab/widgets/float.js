import { nineSlice, registerSprite, skin } from "../../app/rough-skin.js";
import { applySlice, bindPress, skinnedButton } from "./primitives.js";

function placeTip(stage, anchor, tip) {
  const stageBox = stage.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left = a.left - stageBox.left + a.width / 2 - t.width / 2;
  let top = a.top - stageBox.top - t.height - 10;
  if (top < 8) top = a.bottom - stageBox.top + 10;
  if (left < 8) left = 8;
  if (left + t.width > stageBox.width - 8) left = stageBox.width - t.width - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export default {
  id: "float",
  title: "Tooltip & menu",
  tier: "Tier 3 frames + Tier 2 menu rows",
  note:
    "Tooltips and menus live in screen space, so they are DOM. The tip flips when it would " +
    "clip the stage. Menu rows share registered geometry; hover is --skin-fill.",
  render(root, ctx) {
    const row = document.createElement("div");
    row.className = "hud-row";

    const stageCol = document.createElement("div");
    stageCol.className = "hud-col hud-col--grow";
    const stage = document.createElement("div");
    stage.className = "hud-stage";

    const { image, slice } = nineSlice(
      96,
      22,
      { ...ctx.opts, fill: ctx.panelFill, fillStyle: "solid" },
      ctx.variant(0)
    );
    applySlice(stage, image, slice);

    const anchorId = ctx.key("tip-anchor");
    registerSprite(anchorId, "rectangle", 160, 42, ctx.opts, ctx.variant(0));
    const anchor = document.createElement("button");
    anchor.type = "button";
    anchor.className = "hud-anchor";
    anchor.textContent = "Hover the relic";
    skin(anchor, { id: anchorId, w: 160, h: 42, options: ctx.opts, seed: ctx.variant(0) });
    bindPress(anchor);

    const tip = document.createElement("div");
    tip.className = "hud-tip";
    tip.hidden = true;
    tip.textContent = "A pocket relic. Bound to this room. The tip flips if it would leave the stage.";
    applySlice(tip, image, slice);

    const show = () => {
      tip.hidden = false;
      placeTip(stage, anchor, tip);
    };
    const hide = () => {
      tip.hidden = true;
    };
    anchor.addEventListener("pointerenter", show);
    anchor.addEventListener("pointerleave", hide);
    anchor.addEventListener("focus", show);
    anchor.addEventListener("blur", hide);

    stage.append(anchor, tip);
    stageCol.append(stage, ctx.caption("Pointer and keyboard both open the tip."));

    const menuCol = document.createElement("div");
    menuCol.className = "hud-col";
    const menu = document.createElement("div");
    menu.className = "hud-menu";
    const menuSlice = nineSlice(
      96,
      22,
      { ...ctx.opts, fill: ctx.panelFill, fillStyle: "solid" },
      ctx.variant(1)
    );
    applySlice(menu, menuSlice.image, menuSlice.slice);

    ["Invite buddy", "Rename room", "Export board"].forEach((label, i) => {
      menu.append(
        skinnedButton(ctx, {
          label,
          prefix: "menu",
          index: i,
          w: 180,
          h: 36,
          className: "hud-btn"
        })
      );
    });
    menuCol.append(menu, ctx.caption("A tiny action menu. Rows are <use>, not new geometry."));

    row.append(stageCol, menuCol);
    root.append(row);
  }
};
