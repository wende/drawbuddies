// Global object gallery: a screen-space inventory of named drawings that
// persists across rooms (localStorage). Drag world shapes in to save them,
// drag a slot back onto the canvas to stamp a copy, and edit items in a
// dedicated overlay similar to the avatar editor.
//
// Thumbnails are a fixed slot size. Stamped copies keep the saved world size
// and can be resized afterward with the Scale tool (they land as one group).

import {
  controls,
  GALLERY_FRAME,
  GALLERY_SLOT,
  GALLERY_STORAGE_KEY,
  newId,
  newSeed,
  rough,
  state,
  storeJson,
  storedJson
} from "./state.js";
import {
  clone,
  mergeBoxBounds,
  screenToWorld
} from "./geometry.js";
import {
  buildDrawable,
  currentOptions,
  groupBounds,
  groupChildren,
  groupScale,
  hydrateShape,
  hydrateShapeList,
  save,
  serializeShape,
  shapeBounds,
  shapeZRank
} from "./shapes.js";
import { scaleGeom, translateGeom } from "./transforms.js";
import { recordHistory } from "./history.js";
import { net } from "./net.js";
import { drawShapeOn, redraw } from "./render.js";

const MAX_GALLERY_ITEMS = 80;
const MAX_ITEM_SHAPES = 250;
const NAME_MAX = 40;
const SLOT_PAD = 10;
const FRAME_PAD = 28;

const panel = document.getElementById("galleryPanel");
const gridEl = document.getElementById("galleryGrid");
const emptyEl = document.getElementById("galleryEmpty");
const ghostEl = document.getElementById("galleryGhost");
const ghostCanvas = document.getElementById("galleryGhostCanvas");

let items = [];
let editorApi = null;
let panelOpen = false;
let dropArmed = false;

function defaultName() {
  const used = new Set(items.map((item) => item.name));
  if (!used.has("Object")) return "Object";
  let n = 2;
  while (used.has(`Object ${n}`)) n += 1;
  return `Object ${n}`;
}

function sanitizeName(value, fallback = "Object") {
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return name || fallback;
}

function shapeListBounds(shapes) {
  return mergeBoxBounds((shapes || []).map(shapeBounds));
}

function flattenGroup(group) {
  const ox = (group.geom && group.geom.ox) || 0;
  const oy = (group.geom && group.geom.oy) || 0;
  const scale = groupScale(group.geom);
  const origin = { x: 0, y: 0 };
  return groupChildren(group).map((child) => {
    const shape = hydrateShape({
      id: newId(),
      type: child.type,
      geom: clone(child.geom),
      options: clone(child.options || currentOptions(newSeed()))
    });
    if (scale !== 1) {
      shape.geom = scaleGeom(shape, shape.geom, origin, scale);
    }
    if (ox || oy) {
      shape.geom = translateGeom(shape.geom, ox, oy);
    }
    shape.drawable = null;
    return serializeShape(shape);
  });
}

export function collectGalleryShapes(shapes) {
  const out = [];
  for (const shape of shapes || []) {
    if (!shape) continue;
    if (shape.type === "group") {
      out.push(...flattenGroup(shape));
    } else {
      out.push(clone(serializeShape(shape)));
    }
  }
  return out.slice(0, MAX_ITEM_SHAPES);
}

export function fitShapesIntoFrame(shapes, frame = GALLERY_FRAME, padding = FRAME_PAD) {
  const hydrated = hydrateShapeList(shapes.map((shape) => clone(serializeShape(shape))));
  const ext = shapeListBounds(hydrated);
  if (!ext) return hydrated;

  const width = Math.max(1, ext.maxX - ext.minX);
  const height = Math.max(1, ext.maxY - ext.minY);
  const scale = Math.min(
    (frame.width - padding * 2) / width,
    (frame.height - padding * 2) / height
  );
  const center = {
    x: (ext.minX + ext.maxX) / 2,
    y: (ext.minY + ext.maxY) / 2
  };
  const target = { x: frame.width / 2, y: frame.height / 2 };

  for (const shape of hydrated) {
    if (scale !== 1) {
      shape.geom = scaleGeom(shape, shape.geom, center, scale);
    }
    shape.geom = translateGeom(shape.geom, target.x - center.x, target.y - center.y);
    shape.drawable = buildDrawable(shape);
  }
  return hydrated;
}

function fitDrawTransform(shapes, size, padding) {
  const ext = shapeListBounds(shapes);
  if (!ext) return { scale: 1, ox: 0, oy: 0 };
  const width = Math.max(1, ext.maxX - ext.minX);
  const height = Math.max(1, ext.maxY - ext.minY);
  const scale = Math.min((size - padding * 2) / width, (size - padding * 2) / height);
  const cx = (ext.minX + ext.maxX) / 2;
  const cy = (ext.minY + ext.maxY) / 2;
  return {
    scale,
    ox: size / 2 - cx * scale,
    oy: size / 2 - cy * scale
  };
}

export function paintShapesToCanvas(canvas, shapes, size = GALLERY_SLOT) {
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const context = canvas.getContext("2d", { alpha: false });
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#fbfdff";
  context.fillRect(0, 0, size, size);

  const list = hydrateShapeList(shapes);
  if (!list.length) return;

  const rcInst = rough.canvas(canvas);
  const fit = fitDrawTransform(list, size, SLOT_PAD);
  context.save();
  context.translate(fit.ox, fit.oy);
  context.scale(fit.scale, fit.scale);
  const ordered = list
    .map((shape, index) => ({ shape, index, rank: shapeZRank(shape) }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index));
  for (const entry of ordered) {
    drawShapeOn(context, rcInst, buildDrawable, entry.shape);
  }
  context.restore();
}

function persist() {
  storeJson(GALLERY_STORAGE_KEY, {
    version: 1,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      shapes: item.shapes,
      placeWidth: item.placeWidth,
      placeHeight: item.placeHeight,
      updatedAt: item.updatedAt
    }))
  });
}

function loadItems() {
  const stored = storedJson(GALLERY_STORAGE_KEY, null);
  const list = stored && Array.isArray(stored.items) ? stored.items : Array.isArray(stored) ? stored : [];
  items = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const shapes = collectGalleryShapes(hydrateShapeList(raw.shapes));
    if (!shapes.length) continue;
    const ext = shapeListBounds(hydrateShapeList(shapes));
    items.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
      name: sanitizeName(raw.name),
      shapes,
      placeWidth: Math.max(24, Number(raw.placeWidth) || (ext ? ext.maxX - ext.minX : 120)),
      placeHeight: Math.max(24, Number(raw.placeHeight) || (ext ? ext.maxY - ext.minY : 120)),
      updatedAt: Number(raw.updatedAt) || Date.now()
    });
    if (items.length >= MAX_GALLERY_ITEMS) break;
  }
}

export function galleryItems() {
  return items.slice();
}

function findItem(id) {
  return items.find((item) => item.id === id) || null;
}

export function upsertGalleryItem(item) {
  const shapes = collectGalleryShapes(item.shapes);
  if (!shapes.length) return null;

  const ext = shapeListBounds(hydrateShapeList(shapes));
  const next = {
    id: typeof item.id === "string" && item.id ? item.id : newId(),
    name: sanitizeName(item.name, defaultName()),
    shapes,
    placeWidth: Math.max(24, Number(item.placeWidth) || (ext ? ext.maxX - ext.minX : 120)),
    placeHeight: Math.max(24, Number(item.placeHeight) || (ext ? ext.maxY - ext.minY : 120)),
    updatedAt: Date.now()
  };

  const index = items.findIndex((entry) => entry.id === next.id);
  if (index >= 0) items[index] = next;
  else {
    if (items.length >= MAX_GALLERY_ITEMS) items.shift();
    items.push(next);
  }
  persist();
  renderGrid();
  return next;
}

export function removeGalleryItem(id) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return false;
  items.splice(index, 1);
  persist();
  renderGrid();
  return true;
}

function worldSizeOf(shapes) {
  const ext = shapeListBounds(hydrateShapeList(shapes));
  if (!ext) return { width: 120, height: 120 };
  return {
    width: Math.max(24, ext.maxX - ext.minX),
    height: Math.max(24, ext.maxY - ext.minY)
  };
}

export function stampGalleryItem(item, worldPoint) {
  const children = collectGalleryShapes(item.shapes);
  if (!children.length) return null;

  const group = {
    id: newId(),
    type: "group",
    geom: { ox: 0, oy: 0, scale: 1, children },
    options: currentOptions(newSeed()),
    drawable: null
  };

  const box = groupBounds(group);
  const targetW = Math.max(24, Number(item.placeWidth) || box.width || 120);
  const targetH = Math.max(24, Number(item.placeHeight) || box.height || 120);
  const factor = Math.min(
    targetW / Math.max(1, box.width),
    targetH / Math.max(1, box.height)
  );
  if (Math.abs(factor - 1) > 0.001) {
    group.geom = scaleGeom(group, group.geom, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, factor);
  }

  const placed = groupBounds(group);
  group.geom = translateGeom(
    group.geom,
    worldPoint.x - (placed.x + placed.width / 2),
    worldPoint.y - (placed.y + placed.height / 2)
  );
  group.drawable = buildDrawable(group);

  recordHistory();
  state.shapes.push(group);
  state.selectedIds = [group.id];
  net.send({ type: "add", shape: serializeShape(group) });
  save();
  redraw();
  return group;
}

function panelRect() {
  return panel.getBoundingClientRect();
}

function isPanelVisible() {
  return panelOpen || dropArmed;
}

export function galleryHitTest(clientX, clientY) {
  if (!isPanelVisible()) return false;
  const rect = panelRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function syncPanelClass() {
  panel.classList.toggle("is-open", panelOpen);
  panel.classList.toggle("is-armed", dropArmed);
  controls.galleryBtn.classList.toggle("active", panelOpen);
  controls.galleryBtn.setAttribute("aria-expanded", panelOpen ? "true" : "false");
}

export function openGalleryPanel() {
  panelOpen = true;
  syncPanelClass();
}

export function closeGalleryPanel() {
  panelOpen = false;
  syncPanelClass();
}

export function toggleGalleryPanel() {
  if (panelOpen) closeGalleryPanel();
  else openGalleryPanel();
}

export function isGalleryPanelOpen() {
  return panelOpen;
}

export function setGalleryReceptive(on, clientX, clientY) {
  dropArmed = Boolean(on);
  const hovering = dropArmed && galleryHitTest(clientX, clientY);
  panel.classList.toggle("is-drop-target", hovering);
  syncPanelClass();
  return hovering;
}

export function bindGalleryEditor(api) {
  editorApi = api;
}

export function isGalleryEditorOpen() {
  return Boolean(editorApi && editorApi.isOpen && editorApi.isOpen());
}

export function captureToGallery(shapes, { discardMoveHistory = false } = {}) {
  const collected = collectGalleryShapes(shapes);
  if (!collected.length) return false;
  const size = worldSizeOf(collected);
  openGalleryPanel();
  editorApi?.open({
    item: null,
    name: defaultName(),
    shapes: collected,
    placeWidth: size.width,
    placeHeight: size.height,
    discardMoveHistory
  });
  return true;
}

function restoreWorldShapes(drag) {
  const originalById = new Map(drag.originalGeoms.map((entry) => [entry.id, entry.geom]));
  for (const shape of drag.dragShapes) {
    const originalGeom = originalById.get(shape.id);
    if (!originalGeom) continue;
    shape.geom = clone(originalGeom);
    shape.drawable = buildDrawable(shape);
  }
}

export function dropWorldShapesOnGallery(drag) {
  restoreWorldShapes(drag);
  captureToGallery(drag.dragShapes, { discardMoveHistory: Boolean(drag.historyRecorded) });
  redraw();
}

function overCanvas(clientX, clientY) {
  const over = document.elementFromPoint(clientX, clientY);
  if (!over) return false;
  if (over === document.getElementById("canvas") || over.id === "canvas") return true;
  return over.closest && over.closest("#canvas");
}

function stampFromPointer(item, event) {
  const canvas = document.getElementById("canvas");
  const rect = canvas.getBoundingClientRect();
  const world = screenToWorld({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  });
  stampGalleryItem(item, world);
}

function hideGhost() {
  ghostEl.hidden = true;
}

function moveGhost(clientX, clientY) {
  ghostEl.hidden = false;
  const half = GALLERY_SLOT / 2;
  ghostEl.style.transform = `translate3d(${Math.round(clientX - half)}px, ${Math.round(clientY - half)}px, 0)`;
}

function bindSlot(entry, item) {
  const slot = entry.querySelector(".gallery-slot");
  const editBtn = entry.querySelector(".gallery-item-edit");
  const removeBtn = entry.querySelector(".gallery-item-remove");
  let pointer = null;

  const startGhost = () => {
    paintShapesToCanvas(ghostCanvas, item.shapes);
    document.body.classList.add("dragging-gallery");
  };

  const stopGhost = () => {
    pointer = null;
    hideGhost();
    document.body.classList.remove("dragging-gallery");
  };

  slot.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    slot.setPointerCapture(event.pointerId);
    pointer = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    };
  });

  slot.addEventListener("pointermove", (event) => {
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (!pointer.dragging && Math.hypot(dx, dy) > 8) {
      pointer.dragging = true;
      startGhost();
    }
    if (pointer.dragging) {
      event.preventDefault();
      moveGhost(event.clientX, event.clientY);
    }
  });

  const finish = (event, cancelled) => {
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const wasDragging = pointer.dragging;
    try {
      slot.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    stopGhost();
    if (cancelled) return;
    if (wasDragging) {
      if (overCanvas(event.clientX, event.clientY) && !galleryHitTest(event.clientX, event.clientY)) {
        stampFromPointer(item, event);
      }
      return;
    }
    editorApi?.open({ item });
  };

  slot.addEventListener("pointerup", (event) => finish(event, false));
  slot.addEventListener("pointercancel", (event) => finish(event, true));

  editBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    editorApi?.open({ item });
  });
  removeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    removeGalleryItem(item.id);
  });
}

function renderGrid() {
  gridEl.replaceChildren();
  emptyEl.hidden = items.length > 0;

  for (const item of items) {
    const entry = document.createElement("div");
    entry.className = "gallery-item";
    entry.dataset.galleryId = item.id;

    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "gallery-slot";
    slot.setAttribute("aria-label", `${item.name}. Drag into the world or click to edit.`);

    const canvas = document.createElement("canvas");
    canvas.width = GALLERY_SLOT;
    canvas.height = GALLERY_SLOT;
    canvas.className = "gallery-thumb";
    slot.append(canvas);

    const name = document.createElement("div");
    name.className = "gallery-item-name";
    name.textContent = item.name;
    name.title = item.name;

    const actions = document.createElement("div");
    actions.className = "gallery-item-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "gallery-item-edit";
    editBtn.textContent = "Edit";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "gallery-item-remove";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${item.name}`);

    actions.append(editBtn, removeBtn);
    entry.append(slot, name, actions);
    gridEl.append(entry);
    paintShapesToCanvas(canvas, item.shapes);
    bindSlot(entry, item);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "gallery-slot gallery-slot-add";
  add.setAttribute("aria-label", "Create a new gallery object");
  add.textContent = "+";
  add.addEventListener("click", () => {
    editorApi?.open({
      item: null,
      name: defaultName(),
      shapes: [],
      placeWidth: 160,
      placeHeight: 160
    });
  });
  gridEl.append(add);
}

document.getElementById("galleryCloseBtn").addEventListener("click", () => {
  closeGalleryPanel();
});

loadItems();
renderGrid();
syncPanelClass();

export const gallery = {
  items: galleryItems,
  upsert: upsertGalleryItem,
  remove: removeGalleryItem,
  stamp: stampGalleryItem,
  capture: captureToGallery,
  dropWorldShapes: dropWorldShapesOnGallery,
  hitTest: galleryHitTest,
  setReceptive: setGalleryReceptive,
  open: openGalleryPanel,
  close: closeGalleryPanel,
  toggle: toggleGalleryPanel,
  isOpen: isGalleryPanelOpen,
  bindEditor: bindGalleryEditor,
  defaultName
};
