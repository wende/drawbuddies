// Multiplayer layer: the WebSocket connection to the room's Durable Object,
// remote-op appliers (shapes + players), and local player presence/persistence.
//
// We send granular ops (add/update/remove/replace/clear/player-*) and apply
// remote ops locally without re-broadcasting them.

import {
  AVATAR_STORAGE_KEY,
  PLAYER_ID,
  PLAYER_STATE_KEY,
  presenceEl,
  state,
  statusDot,
  storeJson,
  storedJson
} from "./state.js";
import { clampNumber, round1 } from "./geometry.js";
import {
  clearSelection,
  hydrateAvatarShapeList,
  hydrateShape,
  hydrateShapeList,
  isMeaningful,
  save,
  serializeShape
} from "./shapes.js";
import { redraw } from "./render.js";

let playerInitialized = false;

// ===== Local player presence =====

export function playerPayload(includeAvatar = true) {
  const payload = {
    id: state.localPlayer.id,
    x: round1(state.localPlayer.x),
    y: round1(state.localPlayer.y),
    moving: state.localPlayer.moving,
    facing: state.localPlayer.facing
  };

  if (includeAvatar) {
    payload.avatar = state.localPlayer.avatar.map(serializeShape);
  }

  return payload;
}

export function persistPlayerState() {
  storeJson(PLAYER_STATE_KEY, {
    x: round1(state.localPlayer.x),
    y: round1(state.localPlayer.y)
  });
}

export function loadPlayerState() {
  const storedPlayer = storedJson(PLAYER_STATE_KEY);
  if (storedPlayer && Number.isFinite(storedPlayer.x) && Number.isFinite(storedPlayer.y)) {
    state.localPlayer.x = storedPlayer.x;
    state.localPlayer.y = storedPlayer.y;
    playerInitialized = true;
  }

  state.localPlayer.avatar = hydrateAvatarShapeList(storedJson(AVATAR_STORAGE_KEY));
  storeJson(AVATAR_STORAGE_KEY, state.localPlayer.avatar.map(serializeShape));
}

export function initializePlayerPosition() {
  if (playerInitialized || !state.viewWidth || !state.viewHeight) return;
  state.localPlayer.x = state.viewWidth / 2;
  state.localPlayer.y = state.viewHeight / 2;
  playerInitialized = true;
  persistPlayerState();
}

// ===== Remote players =====

function applyRemotePlayerSet(playerData) {
  if (!playerData || typeof playerData.id !== "string" || playerData.id === PLAYER_ID) return;
  const avatar = hydrateAvatarShapeList(playerData.avatar);
  state.remotePlayers.set(playerData.id, {
    id: playerData.id,
    x: clampNumber(playerData.x, state.viewWidth / 2),
    y: clampNumber(playerData.y, state.viewHeight / 2),
    moving: Boolean(playerData.moving),
    facing: playerData.facing === -1 ? -1 : 1,
    avatar
  });
  redraw();
}

function applyRemotePlayerMove(move) {
  if (!move || typeof move.id !== "string" || move.id === PLAYER_ID) return;
  const existing = state.remotePlayers.get(move.id);
  if (!existing) return;
  existing.x = clampNumber(move.x, existing.x);
  existing.y = clampNumber(move.y, existing.y);
  existing.moving = Boolean(move.moving);
  if (move.facing === -1 || move.facing === 1) {
    existing.facing = move.facing;
  }
  redraw();
}

function applyRemotePlayers(players) {
  state.remotePlayers.clear();
  if (Array.isArray(players)) {
    for (const player of players) {
      applyRemotePlayerSet(player);
    }
  }
  redraw();
}

// ===== Remote shapes =====

// Persist locally and repaint after applying a remote op.
function commitLocal() {
  save();
  redraw();
}

// Apply an incoming add/update: replace the shape with this id, or append.
function applyRemoteUpsert(shapeData) {
  if (!shapeData || typeof shapeData.id !== "string") return;
  const shape = hydrateShape(shapeData);
  if (!isMeaningful(shape)) return;

  const index = state.shapes.findIndex((s) => s.id === shape.id);
  if (index >= 0) {
    state.shapes[index] = shape;
  } else {
    state.shapes.push(shape);
  }
  commitLocal();
}

function applyRemoteRemove(id) {
  if (typeof id !== "string") return;
  const index = state.shapes.findIndex((s) => s.id === id);
  if (index < 0) return;
  state.shapes.splice(index, 1);
  state.selectedIds = state.selectedIds.filter((sid) => sid !== id);
  commitLocal();
}

function applyRemoteReplace(list) {
  state.shapes.length = 0;
  state.shapes.push(...hydrateShapeList(list));
  clearSelection();
  commitLocal();
}

function applyRemoteClear() {
  state.shapes.length = 0;
  clearSelection();
  commitLocal();
}

// ===== WebSocket connection =====

export const net = (() => {
  const roomName = new URLSearchParams(window.location.search).get("room") || "main";
  let ws = null;
  let connected = false;
  let reconnectTimer = null;

  function setStatus(isConnected) {
    connected = isConnected;
    statusDot.classList.toggle("connected", isConnected);
    if (!isConnected) {
      presenceEl.textContent = "Reconnecting…";
    }
  }

  function setPresence(count) {
    presenceEl.textContent = `${count} ${count === 1 ? "person" : "people"} here`;
  }

  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomName)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus(true);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      sendPlayerSet();
    };

    ws.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data));
      } catch {
        // ignore malformed
      }
    };

    ws.onclose = () => {
      setStatus(false);
      reconnectTimer = setTimeout(connect, 1000);
    };

    ws.onerror = () => {
      // onclose handles reconnection
    };
  }

  function handle(msg) {
    switch (msg.type) {
      case "sync":
        applyRemoteReplace(msg.shapes);
        applyRemotePlayers(msg.players);
        setPresence(msg.count);
        break;
      case "count":
        setPresence(msg.count);
        break;
      case "add":
      case "update":
        applyRemoteUpsert(msg.shape);
        break;
      case "remove":
        applyRemoteRemove(msg.id);
        break;
      case "replace":
        applyRemoteReplace(msg.shapes);
        break;
      case "clear":
        applyRemoteClear();
        break;
      case "player-set":
        applyRemotePlayerSet(msg.player);
        break;
      case "player-move":
        applyRemotePlayerMove(msg);
        break;
      case "player-remove":
        if (typeof msg.id === "string") {
          state.remotePlayers.delete(msg.id);
          redraw();
        }
        break;
    }
  }

  function sendMessage(msg) {
    if (connected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  function sendPlayerSet() {
    sendMessage({ type: "player-set", player: playerPayload(true) });
  }

  return {
    connect,
    sendPlayerSet,
    sendPlayerMove() {
      sendMessage({
        type: "player-move",
        id: state.localPlayer.id,
        x: round1(state.localPlayer.x),
        y: round1(state.localPlayer.y),
        moving: state.localPlayer.moving,
        facing: state.localPlayer.facing
      });
    },
    send(msg) {
      sendMessage(msg);
    }
  };
})();
