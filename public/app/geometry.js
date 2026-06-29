// Pure geometry, point-array processing, and viewport/camera transforms.
// No DOM and no app behavior — just math used across the drawing engine.

import { AVATAR_FRAME, state } from "./state.js";

export function clampNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Round to one decimal — keeps geometry compact on the wire and in storage.
export function round1(n) {
  return Math.round(n * 10) / 10;
}

export function roundPoint(point) {
  return [round1(point[0]), round1(point[1])];
}

// Deep clone plain shape data (geom/options are JSON-safe).
export function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function boxCenter(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

export function pointInsideBox(point, box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

export function boxContainsBox(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function boxCorners(box) {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height }
  ];
}

export function boundsFromPoints(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

// Combine a list of {x,y,width,height} boxes into their overall extent,
// returning { minX, minY, maxX, maxY } — or null when the list is empty.
export function mergeBoxBounds(boxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function normalizedBox(geom) {
  const x = Math.min(geom.x1, geom.x2);
  const y = Math.min(geom.y1, geom.y2);
  const width = Math.abs(geom.x2 - geom.x1);
  const height = Math.abs(geom.y2 - geom.y1);
  return { x, y, width, height };
}

export function normalizeRotation(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return Math.abs(value) < 0.0001 ? 0 : value;
}

export function shapeRotation(shape) {
  return shape && shape.geom ? clampNumber(shape.geom.rotation, 0) : 0;
}

export function canStoreRotation(shape) {
  return (
    shape.type === "rectangle" ||
    shape.type === "ellipse" ||
    shape.type === "text" ||
    shape.type === "group"
  );
}

export function rotatePointObject(point, center, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

export function scalePointObject(point, center, factor) {
  return {
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor
  };
}

export function rotatedBoxBounds(box, angle) {
  if (!angle) return box;
  const center = boxCenter(box);
  return boundsFromPoints(boxCorners(box).map((point) => rotatePointObject(point, center, angle)));
}

export function expandedBoxContains(box, point, padding = 8) {
  return (
    point.x >= box.x - padding &&
    point.x <= box.x + box.width + padding &&
    point.y >= box.y - padding &&
    point.y <= box.y + box.height + padding
  );
}

export function isOverBounds(point, bounds) {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

export function pointerDistance(point, center) {
  return Math.hypot(point.x - center.x, point.y - center.y);
}

export function pointerAngle(point, center) {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

export function angleDelta(a, b) {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

export function distancePointToLine(point, start, end) {
  const px = point[0];
  const py = point[1];
  const x1 = start[0];
  const y1 = start[1];
  const x2 = end[0];
  const y2 = end[1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (!lengthSquared) return Math.hypot(px - x1, py - y1);

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function distanceToPolyline(point, points) {
  if (!points || points.length < 2) return Infinity;

  const tuple = [point.x, point.y];
  let best = Infinity;

  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distancePointToLine(tuple, points[i - 1], points[i]));
  }

  return best;
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

export function simplifyPoints(points, minDistance = 2.5) {
  if (!points || points.length <= 2) return points || [];

  const out = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const curr = points[i];

    if (Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) >= minDistance) {
      out.push(curr);
    }
  }

  out.push(points[points.length - 1]);
  return out;
}

export function smoothPoints(points, strength = 0.45) {
  if (!points || points.length <= 2) return points || [];

  const out = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    out.push([
      curr[0] * (1 - strength) + ((prev[0] + next[0]) / 2) * strength,
      curr[1] * (1 - strength) + ((prev[1] + next[1]) / 2) * strength
    ]);
  }

  out.push(points[points.length - 1]);
  return out;
}

export function smoothPointsRepeated(points, strength = 0.24, iterations = 1) {
  let out = points || [];
  for (let i = 0; i < iterations; i++) {
    out = smoothPoints(out, strength);
  }
  return out;
}

export function freehandRenderablePoints(points) {
  return smoothPoints(simplifyPoints(points, 2.5), 0.45);
}

export function douglasPeucker(points, epsilon = 6) {
  if (!points || points.length <= 2) return points || [];

  let maxDistance = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = distancePointToLine(points[i], first, last);
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }

  if (maxDistance > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

export function resamplePoints(points, targetCount = 34) {
  if (!points || points.length <= 2) return points || [];

  const total = pathLength(points);
  if (total <= 0) return points;

  const count = Math.max(2, Math.min(targetCount, Math.ceil(total / 9)));
  const spacing = total / (count - 1);
  const out = [points[0]];

  let accumulated = 0;
  let nextDistance = spacing;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segment = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    if (segment === 0) continue;

    while (accumulated + segment >= nextDistance && out.length < count - 1) {
      const t = (nextDistance - accumulated) / segment;
      out.push([
        prev[0] + (curr[0] - prev[0]) * t,
        prev[1] + (curr[1] - prev[1]) * t
      ]);
      nextDistance += spacing;
    }

    accumulated += segment;
  }

  out.push(points[points.length - 1]);
  return out;
}

export function curveRenderablePoints(points) {
  const simplified = simplifyPoints(points, 2.2);
  const reduced = douglasPeucker(simplified, 2.2);
  const resampled = resamplePoints(reduced, 34);
  return smoothPointsRepeated(resampled, 0.24, 1);
}

export function pointBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function closedness(points, bounds) {
  if (points.length < 2) return Infinity;
  const first = points[0];
  const last = points[points.length - 1];
  const diag = Math.hypot(bounds.width, bounds.height) || 1;
  return Math.hypot(last[0] - first[0], last[1] - first[1]) / diag;
}

// ===== Camera / viewport =====

export function cameraOffset() {
  return {
    x: state.localPlayer.x - state.viewWidth / 2,
    y: state.localPlayer.y - state.viewHeight / 2
  };
}

export function screenToWorld(point) {
  const camera = cameraOffset();
  return {
    x: point.x + camera.x,
    y: point.y + camera.y
  };
}

export function worldToScreen(point) {
  const camera = cameraOffset();
  return {
    x: point.x - camera.x,
    y: point.y - camera.y
  };
}

export function avatarGuide() {
  const x = 20;
  const y = 20;
  const width = AVATAR_FRAME.width - 40;
  const height = AVATAR_FRAME.height - 40;
  const bodyHeight = height * (2 / 3);
  const legHeight = height - bodyHeight;
  const legWidth = width / 2;

  return {
    outer: { x, y, width, height },
    body: { x, y, width, height: bodyHeight },
    leftLeg: { x, y: y + bodyHeight, width: legWidth, height: legHeight },
    rightLeg: { x: x + legWidth, y: y + bodyHeight, width: legWidth, height: legHeight }
  };
}

export function avatarSwivelTransform(moving) {
  if (!moving) return { bob: 0, swivel: 0 };

  if (!state.avatarAnimationStart) state.avatarAnimationStart = performance.now();
  const t = (performance.now() - state.avatarAnimationStart) / 1000;
  const phase = t * 1.65 * Math.PI * 2;

  return {
    bob: -Math.abs(Math.sin(phase)) * 5,
    swivel: Math.sin(phase) * 0.12 + Math.sin(phase * 2.7) * 0.012
  };
}
