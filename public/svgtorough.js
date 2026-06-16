/**
 * SVG -> DrawBuddies shape converter.
 *
 * Loaded before the main client script. Assigns window.svgToShapes, which the
 * Imagine flow calls to turn LLM-generated SVG into canvas shapes.
 *
 * Supported SVG elements:
 * - rect, circle, ellipse, line, polyline, polygon, path
 * - nested svg / g groups for style inheritance
 *
 * Not handled:
 * - transforms
 * - text, images, masks, clip paths, filters
 */
(() => {
  "use strict";

  if (!window.rough) {
    return;
  }

  const roughRef = window.rough;

  function newSeed() {
    return typeof roughRef.newSeed === "function"
      ? roughRef.newSeed()
      : Math.floor(Math.random() * 2147483647);
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function roundPoint(point) {
    return [round1(point[0]), round1(point[1])];
  }

  function normalizeColor(value) {
    if (!value) return null;

    const trimmed = String(value).trim();
    if (!trimmed || trimmed.toLowerCase() === "none") {
      return null;
    }

    return trimmed;
  }

  function parseInlineStyle(styleAttr) {
    const inline = {};

    for (const part of String(styleAttr || "").split(";")) {
      const [rawKey, rawValue] = part.split(":");
      if (!rawKey || !rawValue) continue;
      inline[rawKey.trim()] = rawValue.trim();
    }

    return inline;
  }

  function parseSvgStyle(node, inherited = {}) {
    const inline = parseInlineStyle(node.getAttribute("style"));

    const pick = (name, fallback = null) => {
      const attr = node.getAttribute(name);
      if (attr !== null && attr !== "") return attr;
      if (inline[name] !== undefined) return inline[name];
      if (inherited[name] !== undefined) return inherited[name];
      return fallback;
    };

    const stroke = normalizeColor(pick("stroke", "#000"));
    const fill = normalizeColor(pick("fill", null));

    const rawStrokeWidth = Number(pick("stroke-width", 1));
    const strokeWidth = Math.max(0.5, Number.isFinite(rawStrokeWidth) ? rawStrokeWidth : 1);

    return { stroke, fill, strokeWidth };
  }

  function readNumber(node, name, fallback = 0) {
    const value = node.getAttribute(name);
    const parsed = value === null ? NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseLength(value) {
    if (!value) return null;
    const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
  }

  function pointsFromString(raw) {
    const numbers =
      String(raw || "")
        .match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
        ?.map(Number)
        .filter(Number.isFinite) || [];

    const points = [];
    for (let i = 0; i < numbers.length - 1; i += 2) {
      points.push([numbers[i], numbers[i + 1]]);
    }
    return points;
  }

  function pointsToPathD(points, closed = false) {
    if (!points.length) return "";

    const parts = [`M ${round1(points[0][0])} ${round1(points[0][1])}`];
    for (let i = 1; i < points.length; i++) {
      parts.push(`L ${round1(points[i][0])} ${round1(points[i][1])}`);
    }
    if (closed) parts.push("Z");
    return parts.join(" ");
  }

  function withElementSeed(element) {
    return {
      ...element,
      roughSeed: Number.isFinite(element.roughSeed) ? element.roughSeed : newSeed()
    };
  }

  function parseSvgElements(node, inheritedStyle = {}) {
    const tag = node.nodeName.toLowerCase();
    const style = parseSvgStyle(node, inheritedStyle);
    const out = [];

    if (tag === "svg" || tag === "g") {
      for (const child of Array.from(node.children)) {
        out.push(...parseSvgElements(child, style));
      }
      return out;
    }

    if (tag === "rect") {
      out.push(
        withElementSeed({
          type: "rect",
          x: readNumber(node, "x"),
          y: readNumber(node, "y"),
          width: readNumber(node, "width"),
          height: readNumber(node, "height"),
          style
        })
      );
      return out;
    }

    if (tag === "circle") {
      const r = readNumber(node, "r");
      out.push(
        withElementSeed({
          type: "ellipse",
          cx: readNumber(node, "cx"),
          cy: readNumber(node, "cy"),
          width: r * 2,
          height: r * 2,
          style
        })
      );
      return out;
    }

    if (tag === "ellipse") {
      out.push(
        withElementSeed({
          type: "ellipse",
          cx: readNumber(node, "cx"),
          cy: readNumber(node, "cy"),
          width: readNumber(node, "rx") * 2,
          height: readNumber(node, "ry") * 2,
          style
        })
      );
      return out;
    }

    if (tag === "line") {
      out.push(
        withElementSeed({
          type: "line",
          x1: readNumber(node, "x1"),
          y1: readNumber(node, "y1"),
          x2: readNumber(node, "x2"),
          y2: readNumber(node, "y2"),
          style
        })
      );
      return out;
    }

    if (tag === "polyline") {
      out.push(
        withElementSeed({
          type: "polyline",
          points: pointsFromString(node.getAttribute("points")),
          style
        })
      );
      return out;
    }

    if (tag === "polygon") {
      out.push(
        withElementSeed({
          type: "polygon",
          points: pointsFromString(node.getAttribute("points")),
          style
        })
      );
      return out;
    }

    if (tag === "path") {
      const d = node.getAttribute("d");
      if (d) {
        out.push(
          withElementSeed({
            type: "path",
            d,
            style
          })
        );
      }
      return out;
    }

    return out;
  }

  function sanitizeImportedSvg(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const parserError = doc.querySelector("parsererror");
    const svg = doc.documentElement;

    if (parserError || !svg || svg.nodeName.toLowerCase() !== "svg") {
      throw new Error("The selected file is not a readable SVG.");
    }

    doc.querySelectorAll("script, foreignObject").forEach((node) => {
      node.remove();
    });

    return new XMLSerializer().serializeToString(svg);
  }

  function extractSvgInfo(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;

    if (!svg || svg.nodeName.toLowerCase() !== "svg") {
      throw new Error("File is not a valid SVG.");
    }

    let width = parseLength(svg.getAttribute("width"));
    let height = parseLength(svg.getAttribute("height"));

    if ((!width || !height) && svg.getAttribute("viewBox")) {
      const parts = svg
        .getAttribute("viewBox")
        .trim()
        .split(/[\s,]+/)
        .map(Number);

      if (parts.length === 4 && parts.every(Number.isFinite)) {
        width = width || parts[2];
        height = height || parts[3];
      }
    }

    return {
      width: width || 512,
      height: height || 512,
      elements: parseSvgElements(svg, {})
    };
  }

  function elementOptions(element, defaults) {
    const style = element.style || {};
    const fill = style.fill || null;

    return {
      stroke: style.stroke || defaults.stroke || "#222222",
      fill,
      fillStyle: fill ? "hachure" : undefined,
      roughness: defaults.roughness ?? 1.5,
      bowing: defaults.bowing ?? 1,
      strokeWidth: style.strokeWidth || defaults.strokeWidth || 2,
      seed: element.roughSeed ?? defaults.seed ?? newSeed()
    };
  }

  function elementToShape(element, defaults) {
    const options = elementOptions(element, defaults);

    if (element.type === "rect") {
      return {
        type: "rectangle",
        geom: {
          x1: round1(element.x),
          y1: round1(element.y),
          x2: round1(element.x + element.width),
          y2: round1(element.y + element.height)
        },
        options
      };
    }

    if (element.type === "ellipse") {
      return {
        type: "ellipse",
        geom: {
          x1: round1(element.cx - element.width / 2),
          y1: round1(element.cy - element.height / 2),
          x2: round1(element.cx + element.width / 2),
          y2: round1(element.cy + element.height / 2)
        },
        options
      };
    }

    if (element.type === "line") {
      return {
        type: "line",
        geom: {
          x1: round1(element.x1),
          y1: round1(element.y1),
          x2: round1(element.x2),
          y2: round1(element.y2)
        },
        options
      };
    }

    if (element.type === "polyline") {
      if (element.points.length < 2) return null;
      return {
        type: "path",
        geom: { d: pointsToPathD(element.points), ox: 0, oy: 0 },
        options
      };
    }

    if (element.type === "polygon") {
      if (element.points.length < 2) return null;
      return {
        type: "path",
        geom: { d: pointsToPathD(element.points, true), ox: 0, oy: 0 },
        options
      };
    }

    if (element.type === "path") {
      return {
        type: "path",
        geom: { d: element.d, ox: 0, oy: 0 },
        options
      };
    }

    return null;
  }

  // Turn SVG markup into DrawBuddies shape payloads ({ type, geom, options }).
  function svgToShapes(svgText, defaults = {}) {
    const cleanSvg = sanitizeImportedSvg(svgText);
    const info = extractSvgInfo(cleanSvg);

    return info.elements
      .map((element) => elementToShape(element, defaults))
      .filter(Boolean);
  }

  window.svgToShapes = svgToShapes;
})();
