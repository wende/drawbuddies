// Pure URL helpers for rooms. No DOM access, so this module is importable by
// both the browser app (net.js) and the vitest unit tests.

// Mirror of src/protocol.ts ROOM_CODE_ALPHABET / ROOM_CODE_LEN. Kept in sync by
// hand (this module is plain browser JS and can't import the TS source).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LEN = 6;

/** True only for an uppercase string of the right length over the alphabet. */
export function isRoomCode(code) {
  if (typeof code !== "string" || code.length !== ROOM_CODE_LEN) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * Resolve the active room code from the current location.
 * Priority: /r/CODE path → ?room=CODE query → "main".
 * Codes are uppercased; anything malformed falls back to "main".
 */
export function parseRoomCode(pathname, search) {
  const pathMatch = /^\/r\/([^/]+)\/?$/.exec(pathname || "");
  if (pathMatch) {
    const code = pathMatch[1].toUpperCase();
    return isRoomCode(code) ? code : "main";
  }

  const room = new URLSearchParams(search || "").get("room");
  if (room) {
    const upper = room.toUpperCase();
    if (isRoomCode(upper)) return upper;
    return room; // allow legacy/named rooms like "main" via ?room=
  }

  return "main";
}

/** Normalize free-form user input into a valid code, or null if invalid. */
export function normalizeRoomCode(input) {
  const code = String(input || "").trim().toUpperCase();
  return isRoomCode(code) ? code : null;
}
