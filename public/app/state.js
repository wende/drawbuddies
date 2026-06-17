// Shared application state, DOM handles, constants, and tiny utilities.
//
// Everything that more than one module needs to read or mutate lives here. The
// `state` object holds the cross-module *mutable* values (reassigned at runtime);
// values used by a single module stay local to that module. rough.js is read off
// `window` (loaded by a plain <script> before the module entry point).

if (!window.rough) {
  document.body.innerHTML =
    '<p style="margin:2rem;font:16px system-ui">rough.js failed to load. Check your network connection.</p>';
  throw new Error("rough.js failed to load");
}

export const rough = window.rough;

export const STORAGE_KEY = "drawbuddies:v2";
export const PLAYER_STATE_KEY = "drawbuddies:player:v1";
export const AVATAR_STORAGE_KEY = "drawbuddies:avatar:v1";
export const MOVE_HINT_KEY = "drawbuddies:movement-hint:v1";

export const AVATAR_FRAME = { width: 260, height: 360 };
export const AVATAR_DISPLAY_HEIGHT = 132;
export const PLAYER_SPEED = 220;

export const canvas = document.getElementById("canvas");
export const ctx = canvas.getContext("2d", { alpha: false });

export const controls = {
  strokeColor: document.getElementById("strokeColor"),
  roughness: document.getElementById("roughness"),
  roughnessValue: document.getElementById("roughnessValue"),
  bowing: document.getElementById("bowing"),
  bowingValue: document.getElementById("bowingValue"),
  strokeWidth: document.getElementById("strokeWidth"),
  strokeWidthValue: document.getElementById("strokeWidthValue"),
  avatarBtn: document.getElementById("avatarBtn"),
  undoBtn: document.getElementById("undoBtn"),
  redoBtn: document.getElementById("redoBtn"),
  clearBtn: document.getElementById("clearBtn")
};

export const statusDot = document.getElementById("statusDot");
export const presenceEl = document.getElementById("presence");
export const moveHintEl = document.getElementById("moveHint");

export const gen = rough.generator();

// ===== Globally-unique ids =====
// Shape/player ids must be unique across all clients so concurrent authors never
// collide. Integer counters would; UUID-ish strings won't.
export const PLAYER_ID =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const CLIENT_ID =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : PLAYER_ID.slice(0, 8);

let idCounter = 0;

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${CLIENT_ID}-${Date.now().toString(36)}-${idCounter++}`;
}

export function newSeed() {
  return typeof rough.newSeed === "function"
    ? rough.newSeed()
    : Math.floor(Math.random() * 2147483647);
}

export function storedJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function storeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Drawing still works without persistence.
  }
}

// Cross-module mutable state. Single-module mutable values live in their module.
export const state = {
  rc: rough.canvas(canvas),
  dpr: 1,
  viewWidth: 0,
  viewHeight: 0,
  currentTool: "smart",
  activeDrag: null,
  selectedIds: [],
  avatarAnimationStart: 0,
  shapes: [],
  historyStack: [],
  redoStack: [],
  remotePlayers: new Map(),
  pressedMovementKeys: new Set(),
  localPlayer: {
    id: PLAYER_ID,
    x: 0,
    y: 0,
    moving: false,
    facing: 1,
    avatar: []
  }
};
