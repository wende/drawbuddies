/**
 * DrawBuddies wire protocol: the shape/player data model, the client/server
 * message types, and the validators that keep untrusted client input in bounds.
 *
 * Shared by the Durable Object (src/room.ts) and the Worker entry (src/index.ts).
 */

// A single drawable shape. `geom`/`options` are opaque to the server — they are
// produced and consumed by the client's rough.js renderer.
export interface Shape {
  id: string;
  type: string;
  geom: unknown;
  options: unknown;
}

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  moving: boolean;
  facing: 1 | -1;
  avatar: Shape[];
}

export interface SocketAttachment {
  connectionId: string;
  playerId?: string;
  // The room code this socket joined; lets webSocketClose report presence
  // to the registry without access to the original request URL.
  code?: string;
}

// Client -> Server messages
export interface AddMessage {
  type: 'add';
  shape: Shape;
}
export interface UpdateMessage {
  type: 'update';
  shape: Shape;
}
export interface RemoveMessage {
  type: 'remove';
  id: string;
}
export interface ReplaceMessage {
  type: 'replace';
  shapes: Shape[];
}
export interface ClearMessage {
  type: 'clear';
}
export interface PlayerSetMessage {
  type: 'player-set';
  player: PlayerState;
}
export interface PlayerMoveMessage {
  type: 'player-move';
  id: string;
  x: number;
  y: number;
  moving: boolean;
  facing: 1 | -1;
}

// Server -> Client messages
export interface SyncMessage {
  type: 'sync';
  shapes: Shape[];
  players: PlayerState[];
  count: number;
}
export interface CountMessage {
  type: 'count';
  count: number;
}
export interface PlayerRemoveMessage {
  type: 'player-remove';
  id: string;
}

export type ClientMessage =
  | AddMessage
  | UpdateMessage
  | RemoveMessage
  | ReplaceMessage
  | ClearMessage
  | PlayerSetMessage
  | PlayerMoveMessage;
export type ServerMessage =
  | SyncMessage
  | AddMessage
  | UpdateMessage
  | RemoveMessage
  | ReplaceMessage
  | ClearMessage
  | CountMessage
  | PlayerSetMessage
  | PlayerMoveMessage
  | PlayerRemoveMessage;

// Shape types the renderer understands. Anything else is rejected.
const SHAPE_TYPES = new Set([
  'smart',
  'curve',
  'line',
  'rectangle',
  'ellipse',
  'path',
  'text',
  // Imagined drawings: one shape whose geom.children hold ordinary shapes.
  'group',
]);

// Guard rails to keep a room within free-tier limits.
export const MAX_SHAPES = 5000;
export const MAX_AVATAR_SHAPES = 250;
export const MAX_PLAYER_COORD = 1_000_000;

// ===== Rooms =====

// Ambiguity-free alphabet: no 0/O, 1/I/L. Six characters → ~1.07e9 codes.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 6;
export const ROOM_TITLE_MAX = 60;
export const DEFAULT_ROOM_TITLE = 'Untitled room';
// How long an empty public room stays listed before it is pruned (24h).
export const ROOM_LIST_TTL_MS = 24 * 60 * 60 * 1000;

// A public room as tracked by the RoomRegistry DO and sent to the lobby.
export interface RegistryRoom {
  code: string;
  title: string;
  count: number;
  createdAt: number;
  lastSeenAt: number;
}

/**
 * Generate a random room code from the ambiguity-free alphabet. `rng` is
 * injectable so tests can make it deterministic.
 */
export function generateRoomCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** True only for a string of exactly ROOM_CODE_LEN chars from the alphabet. */
export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LEN) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Drop ASCII control characters (0x00–0x1F and 0x7F) from a string. */
function stripControl(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

/** Trim, strip control chars, clamp length; fall back to a default title. */
export function sanitizeRoomTitle(title: unknown): string {
  const raw = typeof title === 'string' ? title : '';
  const cleaned = stripControl(raw).trim().slice(0, ROOM_TITLE_MAX);
  return cleaned || DEFAULT_ROOM_TITLE;
}

/**
 * Partition rooms into those still worth listing and those to prune. A room is
 * expired when it is empty and hasn't been seen within the TTL.
 */
export function filterActiveRooms(
  rooms: RegistryRoom[],
  now: number,
  ttlMs: number = ROOM_LIST_TTL_MS
): { active: RegistryRoom[]; expired: string[] } {
  const active: RegistryRoom[] = [];
  const expired: string[] = [];
  for (const room of rooms) {
    if (room.count <= 0 && now - room.lastSeenAt > ttlMs) {
      expired.push(room.code);
    } else {
      active.push(room);
    }
  }
  return { active, expired };
}

/**
 * Validate an incoming shape. Returns a normalized shape or null if invalid.
 * Keeps geom/options opaque but bounds their serialized size.
 */
export function sanitizeShape(shape: unknown): Shape | null {
  if (!shape || typeof shape !== 'object') return null;
  const s = shape as Record<string, unknown>;

  if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 128) return null;
  if (typeof s.type !== 'string' || !SHAPE_TYPES.has(s.type)) return null;
  if (!s.geom || typeof s.geom !== 'object') return null;
  if (!s.options || typeof s.options !== 'object') return null;

  return { id: s.id, type: s.type, geom: s.geom, options: s.options };
}

export function sanitizePlayerMove(message: unknown): PlayerMoveMessage | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  if (typeof m.id !== 'string' || m.id.length === 0 || m.id.length > 128) return null;

  const x = Number(m.x);
  const y = Number(m.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > MAX_PLAYER_COORD || Math.abs(y) > MAX_PLAYER_COORD) return null;

  return {
    type: 'player-move',
    id: m.id,
    x,
    y,
    moving: Boolean(m.moving),
    facing: m.facing === -1 ? -1 : 1,
  };
}

export function sanitizePlayer(player: unknown): PlayerState | null {
  if (!player || typeof player !== 'object') return null;
  const p = player as Record<string, unknown>;
  const move = sanitizePlayerMove({
    type: 'player-move',
    id: p.id,
    x: p.x,
    y: p.y,
    moving: p.moving,
    facing: p.facing,
  });
  if (!move) return null;
  if (!Array.isArray(p.avatar)) return null;

  const avatar = p.avatar
    .map((shape) => sanitizeShape(shape))
    .filter((shape): shape is Shape => shape !== null)
    .slice(0, MAX_AVATAR_SHAPES);

  return {
    id: move.id,
    x: move.x,
    y: move.y,
    moving: move.moving,
    facing: move.facing,
    avatar,
  };
}

/**
 * Environment bindings type.
 */
export interface Env {
  CANVAS_ROOM: DurableObjectNamespace;
  ROOM_REGISTRY: DurableObjectNamespace;
  ASSETS: Fetcher;
  // "Imagine" LLM credentials. API keys are Worker secrets; model ids are plain
  // vars with sensible defaults. Provider is auto-detected from whichever key is
  // set; IMAGINE_PROVIDER ("zai" | "minimax") forces a choice when both exist.
  IMAGINE_PROVIDER?: string;
  ZAI_API_KEY?: string;
  ZAI_MODEL?: string;
  MINIMAX_API_KEY?: string;
  MINIMAX_MODEL?: string;
}
