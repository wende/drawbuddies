// Smart fill: when a scribble lands inside a rectangle or ellipse and looks like
// a deliberate shading gesture, fill that shape (hachure / cross-hatch / zigzag /
// solid) instead of adding a new stroke.

import { controls, state } from "./state.js";
import { normalizedBox, pathLength, pointBounds, simplifyPoints } from "./geometry.js";
import { buildDrawable, pointInShapeLocalSpace, save, serializeShape } from "./shapes.js";
import { recordHistory } from "./history.js";
import { net } from "./net.js";
import { redraw } from "./render.js";

export function shapeContainsPoint(shape, point, padding = 8) {
  const localPoint = pointInShapeLocalSpace(shape, { x: point[0], y: point[1] });
  const testPoint = [localPoint.x, localPoint.y];

  if (shape.type === "rectangle") {
    const box = normalizedBox(shape.geom);
    return (
      testPoint[0] >= box.x - padding &&
      testPoint[0] <= box.x + box.width + padding &&
      testPoint[1] >= box.y - padding &&
      testPoint[1] <= box.y + box.height + padding
    );
  }

  if (shape.type === "ellipse") {
    const box = normalizedBox(shape.geom);
    const rx = Math.max(1, box.width / 2 + padding);
    const ry = Math.max(1, box.height / 2 + padding);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const nx = (testPoint[0] - cx) / rx;
    const ny = (testPoint[1] - cy) / ry;
    return nx * nx + ny * ny <= 1;
  }

  return false;
}

function targetShapeBounds(shape) {
  if (shape.type === "rectangle" || shape.type === "ellipse") {
    return normalizedBox(shape.geom);
  }
  return null;
}

function smartFillColor() {
  return controls.strokeColor.value;
}

function fillStrokeFeatures(points) {
  let segmentCount = 0;
  let turnCount = 0;
  let sharpTurns = 0;
  let alternations = 0;
  let prevAngle = null;
  let prevTurnSign = 0;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const segLength = Math.hypot(dx, dy);
    if (segLength < 2) continue;

    const angle = Math.atan2(dy, dx);

    if (prevAngle !== null) {
      let delta = angle - prevAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;

      const absTurn = Math.abs(delta);
      if (absTurn > 0.28) turnCount++;
      if (absTurn > 0.9 && absTurn < 2.5) sharpTurns++;

      const turnSign = delta > 0.18 ? 1 : delta < -0.18 ? -1 : 0;
      if (turnSign && prevTurnSign && turnSign !== prevTurnSign) {
        alternations++;
      }
      if (turnSign) {
        prevTurnSign = turnSign;
      }
    }

    prevAngle = angle;
    segmentCount++;
  }

  return {
    segmentCount,
    turnCount,
    sharpTurns,
    alternations
  };
}

function inferSmartFillStyle(points) {
  if (!points || points.length < 5) return null;

  const features = fillStrokeFeatures(points);
  if (features.segmentCount < 3) return null;

  const sharpRatio = features.sharpTurns / features.segmentCount;
  const alternationRatio = features.alternations / features.segmentCount;

  if (sharpRatio >= 0.24 && alternationRatio >= 0.12) {
    return "zigzag";
  }

  return "hachure";
}

export function chooseSmartFillStyle(target, points) {
  const inferred = inferSmartFillStyle(points);
  if (!inferred) return null;

  if (!target.options.fill) {
    return inferred;
  }

  if (target.options.fillStyle !== "cross-hatch" && target.options.fillStyle !== "solid") {
    return "cross-hatch";
  }

  return "solid";
}

export function fillStrokeLooksIntentional(points, targetShape) {
  if (!points || points.length < 10) return false;

  const targetBounds = targetShapeBounds(targetShape);
  if (!targetBounds) return false;

  const strokeBounds = pointBounds(points);
  const strokeLength = pathLength(points);
  const strokeDiag = Math.hypot(strokeBounds.width, strokeBounds.height);
  const targetDiag = Math.hypot(targetBounds.width, targetBounds.height) || 1;
  const widthRatio = strokeBounds.width / Math.max(1, targetBounds.width);
  const heightRatio = strokeBounds.height / Math.max(1, targetBounds.height);
  const density = strokeLength / Math.max(1, strokeDiag);
  const features = fillStrokeFeatures(points);

  if (strokeLength < Math.max(52, targetDiag * 0.55)) return false;
  if (strokeDiag < Math.max(20, targetDiag * 0.22)) return false;
  if (strokeDiag > targetDiag * 1.03) return false;

  if (widthRatio < 0.28 && heightRatio < 0.28) return false;
  if (widthRatio < 0.16 || heightRatio < 0.16) return false;

  if (density < 1.95) return false;
  if (features.segmentCount < 8) return false;
  if (features.turnCount < 4) return false;

  const isZigzagLike =
    features.sharpTurns >= 3 &&
    features.alternations >= 2;

  const isHachureLike =
    features.turnCount >= 6 &&
    density >= 2.25 &&
    (widthRatio >= 0.34 || heightRatio >= 0.34);

  return isZigzagLike || isHachureLike;
}

function findFillTargetForStroke(points) {
  let bestShape = null;
  let bestScore = 0;

  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const shape = state.shapes[i];
    if (shape.type !== "rectangle" && shape.type !== "ellipse") continue;

    let inside = 0;
    for (const point of points) {
      if (shapeContainsPoint(shape, point, 10)) {
        inside++;
      }
    }

    const ratio = inside / points.length;
    if (ratio > 0.92 && ratio > bestScore) {
      bestScore = ratio;
      bestShape = shape;
    }
  }

  return bestShape;
}

export function tryApplySmartFill(strokeShape) {
  const points = simplifyPoints(strokeShape.geom.points, 3.5);
  if (!points || points.length < 10) return false;

  const target = findFillTargetForStroke(points);
  if (!target) return false;

  if (!fillStrokeLooksIntentional(points, target)) return false;

  const fillStyle = chooseSmartFillStyle(target, points);
  if (!fillStyle) return false;

  recordHistory();
  target.options.fill = smartFillColor();
  target.options.fillStyle = fillStyle;
  target.drawable = buildDrawable(target);
  save();
  net.send({ type: "update", shape: serializeShape(target) });
  redraw();
  return true;
}
