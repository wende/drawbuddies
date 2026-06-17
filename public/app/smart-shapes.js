// Smart-shape recognition: turn a freehand stroke into a clean line, rectangle,
// ellipse, or smooth curve when the gesture clearly intends one.

import { newSeed } from "./state.js";
import {
  angleDelta,
  closedness,
  curveRenderablePoints,
  distancePointToLine,
  douglasPeucker,
  pathLength,
  pointBounds,
  resamplePoints,
  round1,
  roundPoint,
  simplifyPoints
} from "./geometry.js";
import { buildDrawable } from "./shapes.js";

export function recognizeLine(points, bounds) {
  const length = pathLength(points);
  const start = points[0];
  const end = points[points.length - 1];
  const direct = Math.hypot(end[0] - start[0], end[1] - start[1]);

  if (direct < 12 || length < 12) return null;

  const straightness = direct / length;
  let maxDistance = 0;
  let totalDistance = 0;

  for (const point of points) {
    const distance = distancePointToLine(point, start, end);
    maxDistance = Math.max(maxDistance, distance);
    totalDistance += distance;
  }

  const meanDistance = totalDistance / points.length;
  const tolerance = Math.max(4.5, direct * 0.028);

  if (straightness >= 0.95 && maxDistance <= tolerance * 1.8 && meanDistance <= tolerance * 0.85) {
    return {
      type: "line",
      geom: {
        x1: round1(start[0]),
        y1: round1(start[1]),
        x2: round1(end[0]),
        y2: round1(end[1])
      }
    };
  }

  return null;
}

function cornerEvidence(points) {
  if (!points || points.length < 5) return 0;

  const simplified = douglasPeucker(points, 4);
  if (simplified.length < 4) return 0;

  let corners = 0;

  for (let i = 1; i < simplified.length - 1; i++) {
    const prev = simplified[i - 1];
    const curr = simplified[i];
    const next = simplified[i + 1];

    const a1 = Math.atan2(curr[1] - prev[1], curr[0] - prev[0]);
    const a2 = Math.atan2(next[1] - curr[1], next[0] - curr[0]);

    let delta = Math.abs(a2 - a1);
    while (delta > Math.PI) delta = Math.abs(delta - Math.PI * 2);

    if (delta > 0.72 && delta < 2.45) {
      corners++;
    }
  }

  return corners;
}

function rectangleStraightEdgeEvidence(points, bounds) {
  const { minX, minY, maxX, maxY, width, height } = bounds;
  const minSide = Math.max(1, Math.min(width, height));
  const edgeTolerance = Math.max(6, minSide * 0.10);

  let totalLength = 0;
  let axisAlignedLength = 0;

  const sideLengths = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0
  };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const mx = (prev[0] + curr[0]) / 2;
    const my = (prev[1] + curr[1]) / 2;
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const length = Math.hypot(dx, dy);
    if (length < 2) continue;

    totalLength += length;

    const angle = Math.abs(Math.atan2(dy, dx));
    const horizontalish =
      angleDelta(angle, 0) < 0.22 || angleDelta(angle, Math.PI) < 0.22;
    const verticalish = angleDelta(angle, Math.PI / 2) < 0.22;

    if (horizontalish || verticalish) {
      axisAlignedLength += length;
    }

    if (Math.abs(mx - minX) <= edgeTolerance && verticalish) sideLengths.left += length;
    if (Math.abs(mx - maxX) <= edgeTolerance && verticalish) sideLengths.right += length;
    if (Math.abs(my - minY) <= edgeTolerance && horizontalish) sideLengths.top += length;
    if (Math.abs(my - maxY) <= edgeTolerance && horizontalish) sideLengths.bottom += length;
  }

  const requiredHorizontal = Math.max(8, width * 0.24);
  const requiredVertical = Math.max(8, height * 0.24);
  const sidesWithStraightRuns = [
    sideLengths.left >= requiredVertical,
    sideLengths.right >= requiredVertical,
    sideLengths.top >= requiredHorizontal,
    sideLengths.bottom >= requiredHorizontal
  ].filter(Boolean).length;

  return {
    axisRatio: totalLength ? axisAlignedLength / totalLength : 0,
    sidesWithStraightRuns
  };
}

function rectangleCornerTurnEvidence(points, bounds) {
  const { minX, minY, maxX, maxY, width, height } = bounds;
  const samples = resamplePoints(points, 80);
  const diag = Math.hypot(width, height) || 1;
  const cornerTolerance = Math.max(8, Math.min(width, height) * 0.22);
  const cornerTurns = [0, 0, 0, 0];
  let totalTurn = 0;

  if (samples.length < 5) {
    return { cornerTurnRatio: 0, cornersWithTurn: 0, cornerTurnTotal: 0, totalTurn: 0 };
  }

  const loop = samples.slice();
  const first = loop[0];
  const last = loop[loop.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= diag * 0.08) {
    loop.pop();
  }

  function nearestCornerIndex(point) {
    const nearLeft = Math.abs(point[0] - minX) <= cornerTolerance;
    const nearRight = Math.abs(point[0] - maxX) <= cornerTolerance;
    const nearTop = Math.abs(point[1] - minY) <= cornerTolerance;
    const nearBottom = Math.abs(point[1] - maxY) <= cornerTolerance;

    if (nearLeft && nearTop) return 0;
    if (nearRight && nearTop) return 1;
    if (nearRight && nearBottom) return 2;
    if (nearLeft && nearBottom) return 3;
    return -1;
  }

  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const curr = loop[i];
    const next = loop[(i + 1) % loop.length];
    const inLength = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    const outLength = Math.hypot(next[0] - curr[0], next[1] - curr[1]);

    if (inLength < 2 || outLength < 2) continue;

    const a1 = Math.atan2(curr[1] - prev[1], curr[0] - prev[0]);
    const a2 = Math.atan2(next[1] - curr[1], next[0] - curr[0]);
    const turn = angleDelta(a2, a1);
    const cornerIndex = nearestCornerIndex(curr);

    totalTurn += turn;
    if (cornerIndex >= 0) {
      cornerTurns[cornerIndex] += turn;
    }
  }

  const cornerTurnTotal = cornerTurns.reduce((sum, turn) => sum + turn, 0);
  const cornersWithTurn = cornerTurns.filter((turn) => turn >= 0.42).length;

  return {
    cornerTurnRatio: totalTurn ? cornerTurnTotal / totalTurn : 0,
    cornersWithTurn,
    cornerTurnTotal,
    totalTurn
  };
}

function hasStrongRectangleStructure(points, bounds) {
  const corners = rectangleCornerTurnEvidence(points, bounds);
  const straightEvidence = rectangleStraightEdgeEvidence(points, bounds);

  return (
    corners.cornersWithTurn >= 3 &&
    corners.cornerTurnRatio >= 0.44 &&
    corners.cornerTurnTotal >= 2.2 &&
    straightEvidence.axisRatio >= 0.45 &&
    straightEvidence.sidesWithStraightRuns >= 3
  );
}

function rectangleClosureAdjustedPoints(points) {
  if (!points || points.length < 4) return points || [];

  const first = points[0];
  const bounds = pointBounds(points);
  const diag = Math.hypot(bounds.width, bounds.height) || 1;
  const maxLookback = Math.max(3, Math.floor(points.length * 0.35));
  const firstIndex = Math.max(1, points.length - maxLookback);

  for (let i = points.length - 1; i >= firstIndex; i--) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const segmentLengthSquared = dx * dx + dy * dy;

    if (segmentLengthSquared <= 1) continue;

    const t = ((first[0] - prev[0]) * dx + (first[1] - prev[1]) * dy) / segmentLengthSquared;
    if (t <= 0.04 || t >= 1.08) continue;

    const closest = [
      prev[0] + dx * t,
      prev[1] + dy * t
    ];
    const closeToStart = Math.hypot(closest[0] - first[0], closest[1] - first[1]);

    if (closeToStart <= Math.max(9, diag * 0.10)) {
      return points.slice(0, i).concat([first]);
    }
  }

  return points;
}

function rectangleClosureIsAcceptable(points, bounds) {
  const closeRatio = closedness(points, bounds);
  if (closeRatio <= 0.30) return true;
  if (closeRatio > 0.46 || points.length < 3) return false;

  const { minX, minY, maxX, maxY, width, height } = bounds;
  const minSide = Math.max(1, Math.min(width, height));
  const edgeTolerance = Math.max(8, minSide * 0.12);
  const first = points[0];
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last[0] - prev[0];
  const dy = last[1] - prev[1];
  const angle = Math.abs(Math.atan2(dy, dx));
  const horizontalish = angleDelta(angle, 0) < 0.28 || angleDelta(angle, Math.PI) < 0.28;
  const verticalish = angleDelta(angle, Math.PI / 2) < 0.28;

  const sameLeft = Math.abs(first[0] - minX) <= edgeTolerance && Math.abs(last[0] - minX) <= edgeTolerance;
  const sameRight = Math.abs(first[0] - maxX) <= edgeTolerance && Math.abs(last[0] - maxX) <= edgeTolerance;
  const sameTop = Math.abs(first[1] - minY) <= edgeTolerance && Math.abs(last[1] - minY) <= edgeTolerance;
  const sameBottom = Math.abs(first[1] - maxY) <= edgeTolerance && Math.abs(last[1] - maxY) <= edgeTolerance;

  return ((sameLeft || sameRight) && verticalish) || ((sameTop || sameBottom) && horizontalish);
}

function recognizeRectangle(points, bounds) {
  const { minX, minY, maxX, maxY, width, height } = bounds;
  const minSide = Math.min(width, height);
  const diag = Math.hypot(width, height);

  if (minSide < 22 || !rectangleClosureIsAcceptable(points, bounds)) return null;

  const samples = resamplePoints(points, 80);
  const edgeTolerance = Math.max(6, minSide * 0.09);
  let nearEdge = 0;
  let totalEdgeDistance = 0;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  let cornerHits = 0;

  for (const point of samples) {
    const [x, y] = point;
    const distances = {
      left: Math.abs(x - minX),
      right: Math.abs(x - maxX),
      top: Math.abs(y - minY),
      bottom: Math.abs(y - maxY)
    };

    const nearest = Math.min(distances.left, distances.right, distances.top, distances.bottom);
    totalEdgeDistance += nearest;

    if (nearest <= edgeTolerance) nearEdge++;
    if (distances.left <= edgeTolerance) left++;
    if (distances.right <= edgeTolerance) right++;
    if (distances.top <= edgeTolerance) top++;
    if (distances.bottom <= edgeTolerance) bottom++;

    const nearHorizontalEdge = distances.top <= edgeTolerance || distances.bottom <= edgeTolerance;
    const nearVerticalEdge = distances.left <= edgeTolerance || distances.right <= edgeTolerance;
    if (nearHorizontalEdge && nearVerticalEdge) cornerHits++;
  }

  const nearRatio = nearEdge / samples.length;
  const meanEdgeDistance = totalEdgeDistance / samples.length;
  const perimeter = Math.max(1, width * 2 + height * 2);
  const horizontalSideMinCount = Math.max(2, samples.length * (width / perimeter) * 0.35);
  const verticalSideMinCount = Math.max(2, samples.length * (height / perimeter) * 0.35);
  const allSidesCovered =
    left >= verticalSideMinCount &&
    right >= verticalSideMinCount &&
    top >= horizontalSideMinCount &&
    bottom >= horizontalSideMinCount;

  const straightEvidence = rectangleStraightEdgeEvidence(points, bounds);
  const cornerTurns = rectangleCornerTurnEvidence(points, bounds);
  const enoughCorners =
    (
      cornerTurns.cornersWithTurn >= 3 &&
      cornerTurns.cornerTurnRatio >= 0.44 &&
      cornerTurns.cornerTurnTotal >= 2.2
    ) ||
    (cornerHits >= 3 && cornerEvidence(points) >= 3);
  const compactEnough = meanEdgeDistance <= Math.max(5.5, minSide * 0.075);
  const hasStraightEdges =
    straightEvidence.axisRatio >= 0.45 &&
    straightEvidence.sidesWithStraightRuns >= 3;

  if (
    nearRatio >= 0.68 &&
    allSidesCovered &&
    enoughCorners &&
    compactEnough &&
    hasStraightEdges &&
    diag >= 32
  ) {
    return {
      type: "rectangle",
      geom: {
        x1: round1(minX),
        y1: round1(minY),
        x2: round1(maxX),
        y2: round1(maxY)
      }
    };
  }

  return null;
}

function recognizeEllipse(points, bounds) {
  const { minX, minY, maxX, maxY, width, height } = bounds;
  const minSide = Math.min(width, height);

  if (minSide < 18 || closedness(points, bounds) > 0.44) return null;
  if (hasStrongRectangleStructure(points, bounds)) return null;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = width / 2 || 1;
  const ry = height / 2 || 1;

  let sumError = 0;
  let maxError = 0;
  let insideCenter = 0;
  const quadrants = [0, 0, 0, 0];

  for (const point of points) {
    const nx = (point[0] - cx) / rx;
    const ny = (point[1] - cy) / ry;
    const radius = Math.sqrt(nx * nx + ny * ny);
    const error = Math.abs(radius - 1);

    sumError += error;
    maxError = Math.max(maxError, error);

    if (radius < 0.68) insideCenter++;

    const q = nx >= 0
      ? (ny >= 0 ? 0 : 1)
      : (ny >= 0 ? 3 : 2);
    quadrants[q]++;
  }

  const meanError = sumError / points.length;
  const quadrantMin = Math.max(2, points.length * 0.08);
  const quadrantsCovered = quadrants.every((count) => count >= quadrantMin);
  const centerRatio = insideCenter / points.length;

  if (meanError <= 0.28 && maxError <= 0.78 && quadrantsCovered && centerRatio <= 0.26) {
    return {
      type: "ellipse",
      geom: {
        x1: round1(minX),
        y1: round1(minY),
        x2: round1(maxX),
        y2: round1(maxY)
      }
    };
  }

  return null;
}

function rectangleFitScore(points, bounds) {
  const { minX, minY, maxX, maxY, width, height } = bounds;
  const minSide = Math.max(1, Math.min(width, height));
  let total = 0;

  for (const point of points) {
    const [x, y] = point;
    total += Math.min(
      Math.abs(x - minX),
      Math.abs(x - maxX),
      Math.abs(y - minY),
      Math.abs(y - maxY)
    );
  }

  return total / points.length / minSide;
}

function ellipseFitScore(points, bounds) {
  const { minX, minY, width, height } = bounds;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const rx = width / 2 || 1;
  const ry = height / 2 || 1;

  let total = 0;
  let centerPenalty = 0;

  for (const point of points) {
    const nx = (point[0] - cx) / rx;
    const ny = (point[1] - cy) / ry;
    const radius = Math.sqrt(nx * nx + ny * ny);
    total += Math.abs(radius - 1);
    if (radius < 0.7) centerPenalty += 0.5;
  }

  return (total + centerPenalty) / points.length;
}

function chooseClosedShapeCandidate(points, bounds, rectangle, ellipse) {
  const rectScore = rectangleFitScore(points, bounds);
  const ellScore = ellipseFitScore(points, bounds);
  const strongRectangleEvidence = hasStrongRectangleStructure(points, bounds);

  if (rectangle && !ellipse) {
    return rectangle;
  }

  if (ellipse && !rectangle) return ellipse;
  if (!rectangle && !ellipse) return null;

  if (!strongRectangleEvidence) return ellipse;
  if (rectScore < ellScore * 0.92) return rectangle;

  return ellipse;
}

export function recognizeSmartShape(points) {
  const simplified = simplifyPoints(points, 3.5);
  if (!simplified || simplified.length < 2 || pathLength(simplified) < 10) return null;

  const bounds = pointBounds(simplified);

  const line = recognizeLine(simplified, bounds);
  if (line) return line;

  const rectanglePoints = rectangleClosureAdjustedPoints(simplified);
  const rectangleBounds = pointBounds(rectanglePoints);
  const rectangle = recognizeRectangle(rectanglePoints, rectangleBounds);
  const ellipse = recognizeEllipse(simplified, bounds);
  const closedShape = chooseClosedShapeCandidate(rectanglePoints, rectangleBounds, rectangle, ellipse);
  if (closedShape) return closedShape;

  return null;
}

export function recognizeCurve(points) {
  const simplified = simplifyPoints(points, 3.5);
  if (!simplified || simplified.length < 4) return null;

  const bounds = pointBounds(simplified);
  const length = pathLength(simplified);
  const diag = Math.hypot(bounds.width, bounds.height) || 1;
  const direct = Math.hypot(
    simplified[simplified.length - 1][0] - simplified[0][0],
    simplified[simplified.length - 1][1] - simplified[0][1]
  );

  if (length < 34 || diag < 22) return null;
  if (closedness(simplified, bounds) < 0.24) return null;

  const directness = direct / length;
  if (directness < 0.34 || directness > 0.88) return null;

  let sharpTurns = 0;
  let directionChanges = 0;
  let totalAbsTurn = 0;
  let prevAngle = null;
  let prevTurnSign = 0;
  let segmentCount = 0;

  for (let i = 1; i < simplified.length; i++) {
    const dx = simplified[i][0] - simplified[i - 1][0];
    const dy = simplified[i][1] - simplified[i - 1][1];
    const segLength = Math.hypot(dx, dy);
    if (segLength < 2) continue;

    const angle = Math.atan2(dy, dx);

    if (prevAngle !== null) {
      let delta = angle - prevAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;

      totalAbsTurn += Math.abs(delta);

      if (Math.abs(delta) > 1.15) {
        sharpTurns++;
      }

      const sign = delta > 0.24 ? 1 : delta < -0.24 ? -1 : 0;
      if (sign && prevTurnSign && sign !== prevTurnSign) {
        directionChanges++;
      }
      if (sign) prevTurnSign = sign;
    }

    prevAngle = angle;
    segmentCount++;
  }

  if (segmentCount < 3) return null;

  const sharpTurnRatio = sharpTurns / segmentCount;
  const directionChangeRatio = directionChanges / segmentCount;
  const meanAbsTurn = totalAbsTurn / Math.max(1, segmentCount - 1);

  if (sharpTurnRatio > 0.16 || directionChangeRatio > 0.22 || meanAbsTurn > 0.82) return null;

  const pointsForCurve = curveRenderablePoints(simplified);
  if (pointsForCurve.length < 3) return null;

  return {
    type: "curve",
    geom: {
      points: pointsForCurve.map(roundPoint)
    }
  };
}

export function smartShapeFromStroke(strokeShape) {
  const recognized = recognizeSmartShape(strokeShape.geom.points) || recognizeCurve(strokeShape.geom.points);
  if (!recognized) return strokeShape;

  const shape = {
    id: strokeShape.id,
    type: recognized.type,
    geom: recognized.geom,
    options: {
      ...strokeShape.options,
      seed: newSeed()
    },
    drawable: null
  };

  shape.drawable = buildDrawable(shape);
  return shape;
}
