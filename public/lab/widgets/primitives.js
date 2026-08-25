import { nineSlice, registerSprite, skin } from "../../app/rough-skin.js";

export function applySlice(el, image, slice) {
  el.style.borderImageSource = image;
  el.style.borderImageSlice = `${slice} fill`;
  el.style.borderImageWidth = `${slice}px`;
  el.style.borderImageRepeat = "stretch";
  el.style.borderWidth = `${slice}px`;
  el.style.borderStyle = "solid";
  el.style.borderColor = "transparent";
}

export function framePanel(el, ctx, seed, { size = 96, slice = 22 } = {}) {
  const tiled = nineSlice(
    size,
    slice,
    { ...ctx.opts, fill: ctx.panelFill, fillStyle: "solid" },
    seed
  );
  applySlice(el, tiled.image, tiled.slice);
  return tiled;
}

export function bindPress(btn) {
  const down = () => btn.classList.add("is-pressed");
  const up = () => btn.classList.remove("is-pressed");
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("pointercancel", up);
}

export function skinnedButton(ctx, {
  label,
  prefix,
  index = 0,
  w = 108,
  h = 34,
  className = "hud-btn hud-btn--compact",
  picked = false,
  disabled = false
}) {
  const seed = ctx.variant(index);
  const id = ctx.key(`${prefix}-${index % ctx.seeds.length}`);
  registerSprite(id, "rectangle", w, h, ctx.opts, seed);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.style.width = `${w}px`;
  btn.style.height = `${h}px`;
  if (picked) btn.classList.add("is-picked");
  if (disabled) btn.disabled = true;
  skin(btn, { id, w, h, options: ctx.opts, seed });
  bindPress(btn);
  return btn;
}

export function skinnedChip(ctx, { label, prefix, index = 0, w = 96, h = 32 }) {
  return skinnedButton(ctx, {
    label,
    prefix,
    index,
    w,
    h,
    className: "hud-btn hud-btn--chip"
  });
}
