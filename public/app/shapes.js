// Shape model: options, z-order, text, building rough.js drawables, bounds,
// hit-testing, selection, serialization/hydration, and localStorage persistence.

import {
  controls,
  ctx,
  gen,
  newId,
  newSeed,
  state,
  STORAGE_KEY
} from "./state.js";
import {
  boxCenter,
  canStoreRotation,
  clampNumber,
  clone,
  curveRenderablePoints,
  distancePointToLine,
  distanceToPolyline,
  expandedBoxContains,
  freehandRenderablePoints,
  mergeBoxBounds,
  normalizedBox,
  pointBounds,
  pathLength,
  rotatedBoxBounds,
  rotatePointObject,
  round1,
  roundPoint,
  shapeRotation
} from "./geometry.js";

export function currentOptions(seed = newSeed()) {
  return {
    stroke: controls.strokeColor.value,
    fill: null,
    fillStyle: "hachure",
    roughness: clampNumber(controls.roughness.value, 1.5),
    bowing: clampNumber(controls.bowing.value, 1),
    strokeWidth: clampNumber(controls.strokeWidth.value, 2),
    seed
  };
}

export function roughOptions(options, type) {
  const out = {
    stroke: options.stroke || "#222222",
    roughness: clampNumber(options.roughness, 1.5),
    bowing: clampNumber(options.bowing, 1),
    strokeWidth: clampNumber(options.strokeWidth, 2),
    seed: clampNumber(options.seed, 1)
  };

  if ((type === "rectangle" || type === "ellipse" || type === "path") && options.fill) {
    out.fill = options.fill;
    out.fillStyle = options.fillStyle || "hachure";
  }

  return out;
}

export function avatarOption(seed, stroke = "#222222", fill = null, fillStyle = "hachure") {
  return {
    stroke,
    fill,
    fillStyle,
    roughness: 1.35,
    bowing: 1,
    strokeWidth: 2.2,
    seed
  };
}

export function defaultAvatarData() {
  return [
    {
      id: "default-head",
      type: "ellipse",
      geom: { x1: 101, y1: 34, x2: 159, y2: 92 },
      options: avatarOption(1301, "#222222", "#f4d7b6", "solid")
    },
    {
      id: "default-body",
      type: "rectangle",
      geom: { x1: 89, y1: 102, x2: 171, y2: 222 },
      options: avatarOption(1302, "#222222", "#a6d8ff", "hachure")
    },
    {
      id: "default-left-arm",
      type: "line",
      geom: { x1: 91, y1: 130, x2: 55, y2: 188 },
      options: avatarOption(1303)
    },
    {
      id: "default-right-arm",
      type: "line",
      geom: { x1: 169, y1: 130, x2: 205, y2: 188 },
      options: avatarOption(1304)
    },
    {
      id: "default-left-leg",
      type: "rectangle",
      geom: { x1: 91, y1: 238, x2: 121, y2: 328 },
      options: avatarOption(1305, "#222222", "#f7f2e8", "hachure")
    },
    {
      id: "default-right-leg",
      type: "rectangle",
      geom: { x1: 139, y1: 238, x2: 169, y2: 328 },
      options: avatarOption(1306, "#222222", "#f7f2e8", "hachure")
    }
  ];
}

export function shapeZRank(shape) {
  if (!shape || !shape.options || !shape.options.fill) {
    return shape && shape.type === "text" ? 5 : 4;
  }

  const style = shape.options.fillStyle;

  if (style === "solid") return 0;
  if (style === "zigzag" || style === "dots") return 1;
  if (style === "cross-hatch") return 2;
  if (style === "hachure") return 3;

  return 1;
}

export function orderedShapeEntries() {
  return state.shapes
    .map((shape, index) => ({ shape, index, rank: shapeZRank(shape) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    });
}

export function orderedShapes() {
  return orderedShapeEntries().map((entry) => entry.shape);
}

// ===== Selection =====

export function clearSelection() {
  state.selectedIds = [];
}

export function selectedShapes() {
  const idSet = new Set(state.selectedIds);
  return orderedShapes().filter((shape) => idSet.has(shape.id));
}

export function selectionBounds() {
  const ext = mergeBoxBounds(selectedShapes().map(shapeBounds));
  if (!ext) return null;

  return {
    x: ext.minX,
    y: ext.minY,
    width: Math.max(0, ext.maxX - ext.minX),
    height: Math.max(0, ext.maxY - ext.minY)
  };
}

// ===== Text =====

export function textLines(shape) {
  return String(shape.geom.text || "").split(/\r?\n/);
}

export function textFont(shape) {
  const size = shape.geom.fontSize || 28;
  return `${size}px Excalifont, cursive`;
}

export function textBounds(shape) {
  const size = shape.geom.fontSize || 28;
  const lines = textLines(shape);

  ctx.save();
  ctx.font = textFont(shape);
  const width = Math.max(1, ...lines.map((line) => ctx.measureText(line || " ").width));
  ctx.restore();

  return {
    x: shape.geom.x,
    y: shape.geom.y,
    width,
    height: Math.max(size, lines.length * size * 1.15)
  };
}

function seededOffset(seed, index) {
  let value = Math.imul((seed || 1) + index * 374761393, 668265263);
  value = (value ^ (value >>> 13)) >>> 0;
  return ((value % 1000) / 1000 - 0.5) * 0.7;
}

export function drawTextShape(context, shape) {
  const size = shape.geom.fontSize || 28;
  const lines = textLines(shape);

  context.save();
  context.font = textFont(shape);
  context.textBaseline = "top";
  context.fillStyle = shape.options.stroke || "#222222";
  context.strokeStyle = shape.options.stroke || "#222222";
  context.lineWidth = Math.max(0.35, (shape.options.strokeWidth || 2) * 0.08);

  for (let i = 0; i < lines.length; i++) {
    const y = shape.geom.y + i * size * 1.15;
    const line = lines[i] || " ";

    context.globalAlpha = 0.92;
    context.fillText(line, shape.geom.x, y);

    context.globalAlpha = 0.24;
    context.strokeText(
      line,
      shape.geom.x + seededOffset(shape.options.seed, i * 2),
      y + seededOffset(shape.options.seed, i * 2 + 1)
    );
  }

  context.restore();
}

export function makeShape(type, start, end, points, options) {
  if (type === "smart") {
    return {
      id: newId(),
      type,
      geom: { points: points.map(roundPoint) },
      options: { ...options },
      drawable: null
    };
  }

  return {
    id: newId(),
    type,
    geom: {
      x1: round1(start.x),
      y1: round1(start.y),
      x2: round1(end.x),
      y2: round1(end.y)
    },
    options: { ...options },
    drawable: null
  };
}

// rough.js curve config for the two freehand shape types. Roughness and bowing
// are capped so long strokes stay legible; the rest is constant per type.
const CURVE_RENDER = { maxRoughness: 0.85, maxBowing: 0.7, curveFitting: 0.82, curveTightness: 0.18 };
const SMART_RENDER = { maxRoughness: 0.9, maxBowing: 0.8, curveFitting: 0.85, curveTightness: 0.15 };

function curveOpts(opts, cfg) {
  return {
    ...opts,
    fill: undefined,
    fillStyle: undefined,
    roughness: Math.min(opts.roughness, cfg.maxRoughness),
    bowing: Math.min(opts.bowing, cfg.maxBowing),
    curveFitting: cfg.curveFitting,
    curveTightness: cfg.curveTightness
  };
}

// Build a rough.js shape with `factory` — the rough generator (canvas) or
// rough.svg (export); both share the rectangle/ellipse/line/curve API. Text is
// handled by the callers; every other type routes through here so the canvas
// and SVG renderers can never drift apart.
export function buildRoughShape(factory, shape) {
  const opts = roughOptions(shape.options, shape.type);

  if (shape.type === "rectangle") {
    const box = normalizedBox(shape.geom);
    return factory.rectangle(box.x, box.y, box.width, box.height, opts);
  }

  if (shape.type === "ellipse") {
    const box = normalizedBox(shape.geom);
    return factory.ellipse(
      box.x + box.width / 2,
      box.y + box.height / 2,
      box.width,
      box.height,
      opts
    );
  }

  if (shape.type === "line") {
    const g = shape.geom;
    return factory.line(g.x1, g.y1, g.x2, g.y2, opts);
  }

  if (shape.type === "curve") {
    const points = curveRenderablePoints(shape.geom.points);
    if (points.length < 2) return null;
    return factory.curve(points, curveOpts(opts, CURVE_RENDER));
  }

  if (shape.type === "smart") {
    const points = freehandRenderablePoints(shape.geom.points);
    if (points.length < 2) return null;
    return factory.curve(points, curveOpts(opts, SMART_RENDER));
  }

  if (shape.type === "path") {
    if (!shape.geom || typeof shape.geom.d !== "string" || !shape.geom.d.trim()) {
      return null;
    }
    return factory.path(shape.geom.d, opts);
  }

  return null;
}

export function buildDrawable(shape) {
  if (shape.type === "group") {
    return groupChildren(shape)
      .map((child) => buildRoughShape(gen, child))
      .filter(Boolean);
  }
  return shape.type === "text" ? null : buildRoughShape(gen, shape);
}

// Imagined drawings are stored as one "group" shape whose geom.children are
// ordinary shapes ({ type, geom, options }) drawn at a shared ox/oy offset.
export function groupChildren(shape) {
  return shape.geom && Array.isArray(shape.geom.children) ? shape.geom.children : [];
}

// A child point p maps to world space as scale*p + (ox, oy).
export function groupScale(geom) {
  const s = geom && Number(geom.scale);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

export function groupBounds(shape) {
  const ext = mergeBoxBounds(groupChildren(shape).map(shapeBaseBounds));
  const ox = (shape.geom && shape.geom.ox) || 0;
  const oy = (shape.geom && shape.geom.oy) || 0;
  const scale = groupScale(shape.geom);
  if (!ext) return { x: ox, y: oy, width: 0, height: 0 };
  return {
    x: ext.minX * scale + ox,
    y: ext.minY * scale + oy,
    width: (ext.maxX - ext.minX) * scale,
    height: (ext.maxY - ext.minY) * scale
  };
}

export function isMeaningful(shape) {
  if (!shape) return false;

  if (shape.type === "group") {
    return groupChildren(shape).length > 0;
  }

  if (shape.type === "text") {
    return Boolean(shape.geom && String(shape.geom.text || "").trim());
  }

  if (shape.type === "path") {
    return Boolean(shape.geom && typeof shape.geom.d === "string" && shape.geom.d.trim());
  }

  if (shape.type === "select-box") {
    const g = shape.geom;
    return Math.abs(g.x2 - g.x1) > 4 && Math.abs(g.y2 - g.y1) > 4;
  }

  if (shape.type === "smart" || shape.type === "curve") {
    return shape.geom.points.length > 1 && pathLength(shape.geom.points) > 3;
  }

  const g = shape.geom;
  const dx = g.x2 - g.x1;
  const dy = g.y2 - g.y1;

  if (shape.type === "line") {
    return Math.hypot(dx, dy) > 3;
  }

  return Math.abs(dx) > 3 && Math.abs(dy) > 3;
}

export function pointInShapeLocalSpace(shape, point) {
  const rotation = shapeRotation(shape);
  if (!rotation || !canStoreRotation(shape)) return point;
  return rotatePointObject(point, boxCenter(shapeBaseBounds(shape)), -rotation);
}

// ===== Bounds =====

let helperSvg = null;
let helperPath = null;

export function measurePathBounds(d, ox = 0, oy = 0) {
  if (!helperSvg) {
    const ns = "http://www.w3.org/2000/svg";
    helperSvg = document.createElementNS(ns, "svg");
    helperSvg.style.position = "absolute";
    helperSvg.style.width = "0";
    helperSvg.style.height = "0";
    helperSvg.style.overflow = "hidden";
    helperSvg.style.pointerEvents = "none";
    helperPath = document.createElementNS(ns, "path");
    helperSvg.appendChild(helperPath);
    document.body.appendChild(helperSvg);
  }
  helperPath.setAttribute("d", d);
  let box = { x: 0, y: 0, width: 0, height: 0 };
  try {
    box = helperPath.getBBox();
  } catch (err) {
    console.warn("Failed to measure path bounds:", err);
  }
  return {
    x: round1(box.x + ox),
    y: round1(box.y + oy),
    width: Math.max(0, round1(box.width)),
    height: Math.max(0, round1(box.height))
  };
}

export function shapeBaseBounds(shape) {
  if (shape.type === "group") {
    return groupBounds(shape);
  }

  if (shape.type === "text") {
    return textBounds(shape);
  }

  if (shape.type === "path" && shape.geom && typeof shape.geom.d === "string") {
    if (!shape._pathBounds || shape._pathBoundsD !== shape.geom.d) {
      shape._pathBounds = measurePathBounds(shape.geom.d, 0, 0);
      shape._pathBoundsD = shape.geom.d;
    }
    return {
      x: round1(shape._pathBounds.x + (shape.geom.ox || 0)),
      y: round1(shape._pathBounds.y + (shape.geom.oy || 0)),
      width: shape._pathBounds.width,
      height: shape._pathBounds.height
    };
  }

  if (shape.geom.points) {
    const bounds = pointBounds(shape.geom.points);
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.width,
      height: bounds.height
    };
  }

  return normalizedBox(shape.geom);
}

export function shapeBounds(shape) {
  const box = shapeBaseBounds(shape);
  return canStoreRotation(shape) ? rotatedBoxBounds(box, shapeRotation(shape)) : box;
}

// ===== Hit testing =====

export function pointInShapeForDragging(shape, point) {
  const padding = Math.max(8, (shape.options.strokeWidth || 2) * 3);
  const localPoint = pointInShapeLocalSpace(shape, point);

  if (shape.type === "group") {
    return expandedBoxContains(groupBounds(shape), localPoint, padding);
  }

  if (shape.type === "text") {
    return expandedBoxContains(textBounds(shape), localPoint, 6);
  }

  if (shape.type === "rectangle") {
    const box = normalizedBox(shape.geom);
    if (!expandedBoxContains(box, localPoint, padding)) return false;

    if (shape.options.fill) return true;

    const edgeDistance = Math.min(
      Math.abs(localPoint.x - box.x),
      Math.abs(localPoint.x - (box.x + box.width)),
      Math.abs(localPoint.y - box.y),
      Math.abs(localPoint.y - (box.y + box.height))
    );

    return edgeDistance <= padding;
  }

  if (shape.type === "ellipse") {
    const box = normalizedBox(shape.geom);
    const rx = Math.max(1, box.width / 2);
    const ry = Math.max(1, box.height / 2);
    const cx = box.x + rx;
    const cy = box.y + ry;
    const nx = (localPoint.x - cx) / rx;
    const ny = (localPoint.y - cy) / ry;
    const radius = Math.sqrt(nx * nx + ny * ny);

    if (shape.options.fill && radius <= 1.08) return true;

    const tolerance = padding / Math.max(1, Math.min(rx, ry));
    return Math.abs(radius - 1) <= tolerance;
  }

  if (shape.type === "path") {
    return expandedBoxContains(shapeBaseBounds(shape), localPoint, padding);
  }

  if (shape.type === "line") {
    const g = shape.geom;
    return distancePointToLine(
      [point.x, point.y],
      [g.x1, g.y1],
      [g.x2, g.y2]
    ) <= padding;
  }

  if (shape.geom.points) {
    const box = shapeBounds(shape);
    if (!expandedBoxContains(box, point, padding)) return false;
    return distanceToPolyline(point, shape.geom.points) <= padding;
  }

  return false;
}

export function hitTestShape(point) {
  const entries = orderedShapeEntries();

  for (let i = entries.length - 1; i >= 0; i--) {
    const { shape, index } = entries[i];
    if (pointInShapeForDragging(shape, point)) {
      return { shape, index };
    }
  }

  return null;
}

// ===== Serialization / hydration / persistence =====

// Strip the cached `drawable` (and any transient fields) before sending
// a shape over the wire or to localStorage.
export function serializeShape(shape) {
  return {
    id: shape.id,
    type: shape.type,
    geom: shape.geom,
    options: shape.options
  };
}

export function save() {
  try {
    const serializable = state.shapes.map(serializeShape);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Drawing still works without persistence.
  }
}

export function cloneShapeData(shape) {
  return clone(serializeShape(shape));
}

export function hydrateShape(shapeData) {
  const shape = {
    id: typeof shapeData.id === "string" && shapeData.id ? shapeData.id : newId(),
    type: shapeData.type,
    geom: shapeData.geom,
    options: shapeData.options || currentOptions(newSeed()),
    drawable: null
  };

  shape.drawable = buildDrawable(shape);
  return shape;
}

// Turn raw shape data (from storage, the network, or a history snapshot) into
// hydrated, drawable shapes, dropping anything malformed or insignificant.
export function hydrateShapeList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || !item.type || !item.geom || !item.options) continue;
    const shape = hydrateShape(item);
    if (isMeaningful(shape)) out.push(shape);
  }
  return out;
}

export function hydrateAvatarShapeList(list) {
  const source = Array.isArray(list) && list.length ? list : defaultAvatarData();
  return hydrateShapeList(source).slice(0, 250);
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    state.shapes.push(...hydrateShapeList(JSON.parse(raw)));
    state.historyStack.length = 0;
  } catch {
    // Corrupt saved data should not break the canvas.
  }
}
