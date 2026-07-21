// Rooms browser: lists public rooms, creates new rooms, and joins by code.
// Navigation between rooms is a full page load to /r/CODE (or / for the lobby),
// which re-bootstraps the canvas + websocket cleanly.

import { parseRoomCode, normalizeRoomCode } from "./room-url.js";

const overlay = document.getElementById("roomsOverlay");
const listEl = document.getElementById("roomsList");
const titleInput = document.getElementById("roomTitle");
const publicInput = document.getElementById("roomPublic");
const createBtn = document.getElementById("roomCreateBtn");
const codeInput = document.getElementById("roomCodeInput");
const joinBtn = document.getElementById("roomJoinBtn");
const errorEl = document.getElementById("roomError");
const lobbyBtn = document.getElementById("roomsLobbyBtn");
const closeBtn = document.getElementById("roomsCloseBtn");

function navigate(path) {
  window.location.assign(path);
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function renderList(rooms) {
  listEl.replaceChildren();
  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "rooms-empty";
    empty.textContent = "No public rooms yet — create one!";
    listEl.append(empty);
    return;
  }

  const current = parseRoomCode(window.location.pathname, window.location.search);
  for (const room of rooms) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "room-item";
    item.disabled = room.code === current;

    const name = document.createElement("span");
    name.textContent = room.title;

    const count = document.createElement("span");
    count.className = "room-count";
    const n = Number(room.count) || 0;
    count.textContent = `${n} ${n === 1 ? "person" : "people"}`;

    item.append(name, count);
    item.addEventListener("click", () => navigate(`/r/${room.code}`));
    listEl.append(item);
  }
}

async function loadRooms() {
  listEl.replaceChildren(makeEmpty("Loading…"));
  try {
    const res = await fetch("/api/rooms", { headers: { accept: "application/json" } });
    const data = await res.json();
    renderList(Array.isArray(data.rooms) ? data.rooms : []);
  } catch {
    listEl.replaceChildren(makeEmpty("Couldn't load rooms."));
  }
}

function makeEmpty(text) {
  const el = document.createElement("div");
  el.className = "rooms-empty";
  el.textContent = text;
  return el;
}

async function createRoom() {
  createBtn.disabled = true;
  showError("");
  try {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        public: publicInput.checked,
        title: titleInput.value,
      }),
    });
    const data = await res.json();
    if (data && data.url) {
      navigate(data.url);
      return;
    }
    showError("Could not create room. Try again.");
  } catch {
    showError("Could not create room. Try again.");
  } finally {
    createBtn.disabled = false;
  }
}

function joinByCode() {
  const code = normalizeRoomCode(codeInput.value);
  if (!code) {
    showError("Codes are 6 characters (A–Z, 2–9).");
    return;
  }
  navigate(`/r/${code}`);
}

function openPanel() {
  overlay.hidden = false;
  showError("");
  loadRooms();
  codeInput.value = "";
  titleInput.value = "";
}

function closePanel() {
  overlay.hidden = true;
}

createBtn.addEventListener("click", createRoom);
joinBtn.addEventListener("click", joinByCode);
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinByCode();
});
lobbyBtn.addEventListener("click", () => navigate("/"));
closeBtn.addEventListener("click", closePanel);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closePanel();
});

export const rooms = { openPanel, closePanel };
