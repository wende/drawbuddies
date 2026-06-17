// Geometry transforms (translate / scale / rotate) for every shape form, plus
// the helpers that derive a transform from a pointer drag. Shared by the main
// canvas (input.js) and the avatar editor.

import {
  boxCenter,
  canStoreRotation,
  normalizeRotation,
  pointerAngle,
  pointerDistance,
  rotatePointObject,
  round1,
  scalePointObject,
  shapeRotation
} from "./geometry.js";
import { groupScale, shapeBaseBounds } from "./shapes.js";

export function translateGeom(geom, dx, dy) {
  if (Array.isArray(geom.children)) {
    return {
      ...geom,
      ox: round1((geom.ox || 0) + dx),
      oy: round1((geom.oy || 0) + dy)
    };
  }

  if (geom.points) {
    return {
      points: geom.points.map((point) => [
        round1(point[0] + dx),
        round1(point[1] + dy)
      ])
    };
  }

  if (typeof geom.d === "string") {
    return {
      ...geom,
      ox: round1((geom.ox || 0) + dx),
      oy: round1((geom.oy || 0) + dy)
    };
  }

  if (Object.prototype.hasOwnProperty.call(geom, "text")) {
    return {
      ...geom,
      x: round1(geom.x + dx),
      y: round1(geom.y + dy)
    };
  }

  return {
    x1: round1(geom.x1 + dx),
    y1: round1(geom.y1 + dy),
    x2: round1(geom.x2 + dx),
    y2: round1(geom.y2 + dy)
  };
}

export function scaleGeom(shape, geom, center, factor) {
  // Scale the whole group about the pivot: T'(p) = factor*(T(p) - center) + center,
  // where T(p) = scale*p + (ox, oy). So scale and offset compose cleanly.
  if (Array.isArray(geom.children)) {
    const nextScale = groupScale(geom) * factor;
    return {
      ...geom,
      scale: Math.round(nextScale * 1e4) / 1e4,
      ox: round1((geom.ox || 0) * factor + center.x * (1 - factor)),
      oy: round1((geom.oy || 0) * factor + center.y * (1 - factor))
    };
  }

  if (geom.points) {
    return {
      ...geom,
      points: geom.points.map((point) => {
        const scaled = scalePointObject({ x: point[0], y: point[1] }, center, factor);
        return [round1(scaled.x), round1(scaled.y)];
      })
    };
  }

  if (Object.prototype.hasOwnProperty.call(geom, "text")) {
    const scaledAnchor = scalePointObject({ x: geom.x, y: geom.y }, center, factor);
    return {
      ...geom,
      x: round1(scaledAnchor.x),
      y: round1(scaledAnchor.y),
      fontSize: Math.max(4, round1((geom.fontSize || 28) * factor))
    };
  }

  const p1 = scalePointObject({ x: geom.x1, y: geom.y1 }, center, factor);
  const p2 = scalePointObject({ x: geom.x2, y: geom.y2 }, center, factor);
  return {
    ...geom,
    x1: round1(p1.x),
    y1: round1(p1.y),
    x2: round1(p2.x),
    y2: round1(p2.y)
  };
}

export function rotateGeom(shape, geom, center, angle) {
  if (geom.points) {
    return {
      ...geom,
      points: geom.points.map((point) => {
        const rotated = rotatePointObject({ x: point[0], y: point[1] }, center, angle);
        return [round1(rotated.x), round1(rotated.y)];
      })
    };
  }

  if (canStoreRotation(shape)) {
    const source = { ...shape, geom };
    const beforeCenter = boxCenter(shapeBaseBounds(source));
    const afterCenter = rotatePointObject(beforeCenter, center, angle);
    return {
      ...translateGeom(geom, afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y),
      rotation: normalizeRotation(shapeRotation(source) + angle)
    };
  }

  const p1 = rotatePointObject({ x: geom.x1, y: geom.y1 }, center, angle);
  const p2 = rotatePointObject({ x: geom.x2, y: geom.y2 }, center, angle);
  return {
    ...geom,
    x1: round1(p1.x),
    y1: round1(p1.y),
    x2: round1(p2.x),
    y2: round1(p2.y)
  };
}

export function applyTransformFromOriginal(shape, originalGeom, transform) {
  if (transform.type === "scale") {
    shape.geom = scaleGeom(shape, originalGeom, transform.center, transform.factor);
  } else {
    shape.geom = rotateGeom(shape, originalGeom, transform.center, transform.angle);
  }
}

export function isTransformTool(tool) {
  return tool === "scale" || tool === "rotate";
}

export function transformFromDrag(drag, point) {
  if (drag.tool === "scale") {
    return {
      type: "scale",
      center: drag.center,
      factor: Math.max(0.05, pointerDistance(point, drag.center) / drag.startDistance)
    };
  }

  return {
    type: "rotate",
    center: drag.center,
    angle: normalizeRotation(pointerAngle(point, drag.center) - drag.startAngle)
  };
}

export function transformMoved(transform) {
  if (transform.type === "scale") return Math.abs(transform.factor - 1) > 0.015;
  return Math.abs(transform.angle) > 0.01;
}
