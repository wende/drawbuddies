// PNG and SVG export. The SVG path reuses buildRoughShape via rough.svg so the
// exported drawing matches the canvas exactly.

import { canvas, rough, state } from "./state.js";
import { boxCenter, cameraOffset, canStoreRotation, shapeRotation } from "./geometry.js";
import { buildRoughShape, orderedShapes, shapeBaseBounds, textLines } from "./shapes.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportPNG() {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "drawbuddies.png");
  }, "image/png");
}

function makeSvgTextNode(shape) {
  const ns = "http://www.w3.org/2000/svg";
  const text = document.createElementNS(ns, "text");
  const size = shape.geom.fontSize || 28;

  text.setAttribute("x", String(shape.geom.x));
  text.setAttribute("y", String(shape.geom.y));
  text.setAttribute("fill", shape.options.stroke || "#222222");
  text.setAttribute("font-family", "Excalifont, cursive");
  text.setAttribute("font-size", String(size));
  text.setAttribute("dominant-baseline", "text-before-edge");

  const lines = textLines(shape);
  for (let i = 0; i < lines.length; i++) {
    const tspan = document.createElementNS(ns, "tspan");
    tspan.setAttribute("x", String(shape.geom.x));
    tspan.setAttribute("dy", i === 0 ? "0" : String(size * 1.15));
    tspan.textContent = lines[i] || " ";
    text.appendChild(tspan);
  }

  return text;
}

function applySvgRotation(node, shape) {
  const rotation = shapeRotation(shape);
  if (!node || !rotation || !canStoreRotation(shape)) return node;
  const center = boxCenter(shapeBaseBounds(shape));
  node.setAttribute(
    "transform",
    `rotate(${(rotation * 180) / Math.PI} ${center.x} ${center.y})`
  );
  return node;
}

function makeSvgNode(rsvg, shape) {
  const ns = "http://www.w3.org/2000/svg";
  let node = shape.type === "text" ? makeSvgTextNode(shape) : buildRoughShape(rsvg, shape);

  if (node && shape.type === "path" && (shape.geom.ox || shape.geom.oy)) {
    const group = document.createElementNS(ns, "g");
    group.setAttribute(
      "transform",
      `translate(${shape.geom.ox || 0} ${shape.geom.oy || 0})`
    );
    group.appendChild(node);
    node = group;
  }

  return applySvgRotation(node, shape);
}

export function exportSVG() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const camera = cameraOffset();
  svg.setAttribute("xmlns", ns);
  svg.setAttribute("width", String(state.viewWidth));
  svg.setAttribute("height", String(state.viewHeight));
  svg.setAttribute("viewBox", `${camera.x} ${camera.y} ${state.viewWidth} ${state.viewHeight}`);

  const defs = document.createElementNS(ns, "defs");
  const style = document.createElementNS(ns, "style");
  style.textContent = "@font-face { font-family: 'Excalifont'; src: url('https://excalidraw.nyc3.cdn.digitaloceanspaces.com/fonts/Excalifont-Regular.woff2') format('woff2'); }";
  defs.appendChild(style);
  svg.appendChild(defs);

  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("x", String(camera.x));
  bg.setAttribute("y", String(camera.y));
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#fbfdff");
  svg.appendChild(bg);

  const rsvg = rough.svg(svg);

  for (const shape of orderedShapes()) {
    const node = makeSvgNode(rsvg, shape);
    if (node) svg.appendChild(node);
  }

  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], {
    type: "image/svg+xml;charset=utf-8"
  });

  downloadBlob(blob, "drawbuddies.svg");
}
