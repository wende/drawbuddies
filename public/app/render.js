// Canvas rendering: shapes, avatars/players, selection overlays, the paper
// background, the hand-tool trash can, plus the main `redraw` composite and the
// `resize` that keeps the canvas matched to the viewport.

import {
  AVATAR_DISPLAY_HEIGHT,
  AVATAR_FRAME,
  canvas,
  ctx,
  PLAYER_ID,
  rough,
  state
} from "./state.js";
import {
  avatarSwivelTransform,
  boxCenter,
  cameraOffset,
  canStoreRotation,
  isOverBounds,
  normalizedBox,
  shapeRotation,
  worldToScreen
} from "./geometry.js";
import {
  buildDrawable,
  defaultAvatarData,
  drawTextShape,
  groupScale,
  hydrateAvatarShapeList,
  orderedShapes,
  selectionBounds,
  shapeBaseBounds,
  shapeZRank
} from "./shapes.js";
import { drawImagineSpinners, pendingImagines } from "./imagine.js";
import { initializePlayerPosition } from "./net.js";

export function drawPuppetGuide(context, guide) {
  context.save();
  context.lineWidth = 1.2;
  context.strokeStyle = "rgba(45, 83, 135, 0.18)";
  context.fillStyle = "rgba(45, 83, 135, 0.018)";
  context.setLineDash([8, 7]);

  for (const box of [guide.body, guide.leftLeg, guide.rightLeg]) {
    context.fillRect(box.x, box.y, box.width, box.height);
    context.strokeRect(box.x, box.y, box.width, box.height);
  }

  context.setLineDash([]);
  context.strokeStyle = "rgba(45, 83, 135, 0.10)";
  context.strokeRect(guide.outer.x, guide.outer.y, guide.outer.width, guide.outer.height);
  context.restore();
}

export function drawShapeOn(context, rcInst, buildDrawableForShape, shape) {
  const pathOffset =
    shape.type === "path"
      ? { x: shape.geom.ox || 0, y: shape.geom.oy || 0 }
      : null;

  const draw = () => {
    if (shape.type === "text") {
      drawTextShape(context, shape);
      return;
    }

    if (!shape.drawable) {
      shape.drawable = buildDrawableForShape(shape);
    }

    if (shape.type === "group") {
      const drawables = Array.isArray(shape.drawable) ? shape.drawable : [];
      const ox = shape.geom.ox || 0;
      const oy = shape.geom.oy || 0;
      const scale = groupScale(shape.geom);
      const transformed = ox || oy || scale !== 1;
      if (transformed) {
        context.save();
        context.translate(ox, oy);
        context.scale(scale, scale);
      }
      for (const drawable of drawables) rcInst.draw(drawable);
      if (transformed) context.restore();
      return;
    }

    if (shape.drawable) {
      if (pathOffset && (pathOffset.x || pathOffset.y)) {
        context.save();
        context.translate(pathOffset.x, pathOffset.y);
        rcInst.draw(shape.drawable);
        context.restore();
        return;
      }

      rcInst.draw(shape.drawable);
    }
  };

  const rotation = shapeRotation(shape);
  if (rotation && canStoreRotation(shape)) {
    const center = boxCenter(shapeBaseBounds(shape));
    context.save();
    context.translate(center.x, center.y);
    context.rotate(rotation);
    context.translate(-center.x, -center.y);
    draw();
    context.restore();
    return;
  }

  draw();
}

function drawShapeWithCurrentTransform(shape) {
  drawShapeOn(ctx, state.rc, buildDrawable, shape);
}

function avatarFacingScale(player) {
  return player && player.facing === -1 ? -1 : 1;
}

function drawAvatarAt(player, screenX, screenY, moving) {
  const avatar = player.avatar && player.avatar.length ? player.avatar : hydrateAvatarShapeList(defaultAvatarData());
  const scale = AVATAR_DISPLAY_HEIGHT / AVATAR_FRAME.height;
  const { bob, swivel } = avatarSwivelTransform(moving);

  ctx.save();
  ctx.translate(screenX, screenY + bob);
  ctx.rotate(swivel);
  ctx.scale(avatarFacingScale(player), 1);
  ctx.translate(-(AVATAR_FRAME.width * scale) / 2, -(AVATAR_FRAME.height * scale) / 2);
  ctx.scale(scale, scale);

  for (const shape of avatar.slice().sort((a, b) => shapeZRank(a) - shapeZRank(b))) {
    drawShapeWithCurrentTransform(shape);
  }

  ctx.restore();
}

function drawPlayers() {
  for (const player of state.remotePlayers.values()) {
    if (!player || player.id === PLAYER_ID) continue;
    const point = worldToScreen({ x: player.x, y: player.y });
    if (
      point.x < -AVATAR_DISPLAY_HEIGHT ||
      point.x > state.viewWidth + AVATAR_DISPLAY_HEIGHT ||
      point.y < -AVATAR_DISPLAY_HEIGHT ||
      point.y > state.viewHeight + AVATAR_DISPLAY_HEIGHT
    ) {
      continue;
    }
    drawAvatarAt(player, point.x, point.y, player.moving);
  }

  drawAvatarAt(state.localPlayer, state.viewWidth / 2, state.viewHeight / 2, state.localPlayer.moving);
}

function drawSelectionOverlay() {
  const box = selectionBounds();
  if (!box) return;

  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(47, 101, 255, 0.9)";
  ctx.fillStyle = "rgba(47, 101, 255, 0.08)";
  ctx.fillRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8);
  ctx.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8);
  ctx.restore();
}

function drawSelectMarquee(shape) {
  if (!shape || shape.type !== "select-box") return;
  const box = normalizedBox(shape.geom);

  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(47, 101, 255, 0.95)";
  ctx.fillStyle = "rgba(47, 101, 255, 0.07)";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

function drawBackground() {
  ctx.save();
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  const w = state.viewWidth;
  const h = state.viewHeight;
  const spacing = 28;
  const crossHalf = 3.2;
  const camera = cameraOffset();

  // Anchor the grid to world space so the paper scrolls with the camera.
  const startX = ((-camera.x % spacing) + spacing) % spacing;
  const startY = ((-camera.y % spacing) + spacing) % spacing;

  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(95, 145, 210, 0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = startY; y < h + spacing; y += spacing) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(95, 145, 210, 0.095)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = startY; y < h + spacing; y += spacing) {
    for (let x = startX; x < w + spacing; x += spacing) {
      ctx.moveTo(x - crossHalf, y + 0.5);
      ctx.lineTo(x + crossHalf, y + 0.5);
      ctx.moveTo(x + 0.5, y - crossHalf);
      ctx.lineTo(x + 0.5, y + crossHalf);
    }
  }
  ctx.stroke();

  // Margin line anchored to world x=44 so it scrolls horizontally.
  const marginScreenX = 44 - camera.x;
  if (marginScreenX >= 0 && marginScreenX <= w) {
    ctx.strokeStyle = "rgba(120, 155, 205, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginScreenX + 0.5, 0);
    ctx.lineTo(marginScreenX + 0.5, h);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.032;
  ctx.fillStyle = "#4b5b6d";
  const count = Math.floor((w * h) / 6500);
  let seed = 2166136261;

  for (let i = 0; i < count; i++) {
    seed ^= i + w;
    seed = Math.imul(seed, 16777619);
    const x = Math.abs(seed % Math.max(1, Math.floor(w)));

    seed ^= i + h;
    seed = Math.imul(seed, 16777619);
    const y = Math.abs(seed % Math.max(1, Math.floor(h)));

    const size = (seed & 3) === 0 ? 1.2 : 0.8;
    ctx.fillRect(x, y, size, size);
  }

  ctx.restore();
}

export function drawTrashCan(context, rcInst, x, y, w, h, isHover) {
  const stroke = isHover ? "#c0392b" : "rgba(55, 45, 38, 0.68)";
  const fill = isHover ? "rgba(192, 57, 43, 0.14)" : "rgba(55, 45, 38, 0.05)";
  const sw = Math.max(1.5, w * 0.026);
  const opts = { roughness: 1.7, bowing: 0.9, stroke, strokeWidth: sw, seed: 77 };
  const fillOpts = { ...opts, fill, fillStyle: "solid" };
  const lineOpts = { roughness: 1.3, stroke, strokeWidth: sw * 0.72, seed: 78 };

  context.save();
  context.globalAlpha = isHover ? 0.2 : 0.07;
  context.fillStyle = isHover ? "#c0392b" : "#3d3328";
  context.beginPath();
  context.arc(x + w / 2, y + h / 2 + h * 0.05, Math.max(w, h) * 0.76, 0, Math.PI * 2);
  context.fill();
  context.restore();

  // Handle arch (two angled lines)
  rcInst.line(x + w * 0.33, y + h * 0.14, x + w * 0.46, y + h * 0.02, opts);
  rcInst.line(x + w * 0.54, y + h * 0.02, x + w * 0.67, y + h * 0.14, opts);

  // Lid
  rcInst.rectangle(x - w * 0.06, y + h * 0.12, w * 1.12, h * 0.11, fillOpts);

  // Body
  rcInst.rectangle(x + w * 0.03, y + h * 0.23, w * 0.94, h * 0.77, fillOpts);

  // Vertical lines inside body
  rcInst.line(x + w * 0.28, y + h * 0.34, x + w * 0.27, y + h * 0.93, lineOpts);
  rcInst.line(x + w * 0.50, y + h * 0.34, x + w * 0.50, y + h * 0.93, lineOpts);
  rcInst.line(x + w * 0.72, y + h * 0.34, x + w * 0.73, y + h * 0.93, lineOpts);
}

export function redraw(preview = null) {
  drawBackground();

  const camera = cameraOffset();
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  for (const shape of orderedShapes()) {
    drawShapeWithCurrentTransform(shape);
  }

  drawSelectionOverlay();

  if (preview) {
    if (preview.type === "text") {
      drawTextShape(ctx, preview);
    } else if (preview.type === "select-box") {
      drawSelectMarquee(preview);
    } else {
      const previewDrawable = buildDrawable(preview);
      if (previewDrawable) {
        state.rc.draw(previewDrawable);
      }
    }
  }

  if (pendingImagines.length) {
    drawImagineSpinners(performance.now());
  }

  ctx.restore();
  drawPlayers();

  if (state.activeDrag && state.activeDrag.tool === "hand") {
    const tw = 68, th = 78;
    const tx = 24;
    const ty = state.viewHeight - th - 88;
    const screenCurrent = worldToScreen(state.activeDrag.current);
    const isHover = isOverBounds(screenCurrent, { x: tx, y: ty, width: tw, height: th });
    drawTrashCan(ctx, state.rc, tx, ty, tw, th, isHover);
  }
}

export function resize() {
  state.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 4));
  state.viewWidth = window.innerWidth;
  state.viewHeight = window.innerHeight;

  canvas.style.width = `${state.viewWidth}px`;
  canvas.style.height = `${state.viewHeight}px`;
  canvas.width = Math.round(state.viewWidth * state.dpr);
  canvas.height = Math.round(state.viewHeight * state.dpr);

  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.rc = rough.canvas(canvas);

  initializePlayerPosition();
  redraw();
}
