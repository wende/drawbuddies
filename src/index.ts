/**
 * DrawBuddies - Cloudflare Worker + Durable Object
 * A collaborative rough.js drawing board with live sync, presence, and persistence.
 *
 * State is a list of vector shapes. Each shape is client-authored with a globally
 * unique id and synced to all peers in the same room.
 */

// A single drawable shape. `geom`/`options` are opaque to the server — they are
// produced and consumed by the client's rough.js renderer.
interface Shape {
  id: string;
  type: string;
  geom: unknown;
  options: unknown;
}

interface PlayerState {
  id: string;
  x: number;
  y: number;
  moving: boolean;
  facing: 1 | -1;
  avatar: Shape[];
}

interface SocketAttachment {
  connectionId: string;
  playerId?: string;
}

// Client -> Server messages
interface AddMessage {
  type: 'add';
  shape: Shape;
}
interface UpdateMessage {
  type: 'update';
  shape: Shape;
}
interface RemoveMessage {
  type: 'remove';
  id: string;
}
interface ReplaceMessage {
  type: 'replace';
  shapes: Shape[];
}
interface ClearMessage {
  type: 'clear';
}
interface PlayerSetMessage {
  type: 'player-set';
  player: PlayerState;
}
interface PlayerMoveMessage {
  type: 'player-move';
  id: string;
  x: number;
  y: number;
  moving: boolean;
  facing: 1 | -1;
}

// Server -> Client messages
interface SyncMessage {
  type: 'sync';
  shapes: Shape[];
  players: PlayerState[];
  count: number;
}
interface CountMessage {
  type: 'count';
  count: number;
}
interface PlayerRemoveMessage {
  type: 'player-remove';
  id: string;
}

type ClientMessage =
  | AddMessage
  | UpdateMessage
  | RemoveMessage
  | ReplaceMessage
  | ClearMessage
  | PlayerSetMessage
  | PlayerMoveMessage;
type ServerMessage =
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
const MAX_SHAPES = 5000;
const MAX_AVATAR_SHAPES = 250;
const MAX_PLAYER_COORD = 1_000_000;

// --- "Imagine" feature: LLM -> SVG generation ---------------------------------

// Both providers speak the OpenAI-style chat-completions shape (messages, model,
// temperature, max_tokens; reply in choices[0].message.content), so the request
// and parsing are shared — only the URL, key, model and a couple of tweaks differ.
const MINIMAX_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';

// Z.ai (Zhipu GLM) Coding Plan, OpenAI-compatible endpoint.
const ZAI_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const DEFAULT_ZAI_MODEL = 'glm-4.6';

const IMAGINE_TIMEOUT_MS = 45_000;
const MAX_PROMPT_LENGTH = 500;
const MAX_SVG_BYTES = 100_000;
const IMAGINE_MAX_TOKENS = 16_000;

// Steer the model toward a single, self-contained SVG built from the simple
// primitives the client's SVG->rough.js converter understands.
const IMAGINE_SYSTEM_PROMPT = `You are an SVG illustrator for a hand-drawn collaborative whiteboard.
Respond with a SINGLE self-contained <svg> element and nothing else — no prose, no markdown, no code fences.
Rules:
- Use only these elements: path, line, rect, circle, ellipse, polyline, polygon.
- Use a viewBox of "0 0 512 512". Do not set width/height attributes.
- Draw with stroked outlines (stroke, stroke-width). Fills are optional and may be ignored.
- Do NOT use the transform attribute. Bake every position and rotation directly into the coordinates.
- Do NOT use: <text>, <image>, <use>, <defs>, gradients, filters, masks, clip-paths, CSS <style>, or inline style attributes.
- Keep paths simple (M/L/C/Q/Z commands). Aim for a clean line drawing, not a photo.`;

// Lightweight per-IP throttle. Module-scope state lives per isolate, so this is a
// best-effort guard against runaway cost, not a global rate limiter.
const IMAGINE_WINDOW_MS = 60_000;
const IMAGINE_MAX_PER_WINDOW = 10;
const imagineHits = new Map<string, number[]>();

function imagineRateLimited(ip: string): boolean {
  const now = Date.now();
  if (imagineHits.size > 1000) {
    for (const [key, times] of imagineHits.entries()) {
      const active = times.filter((t) => now - t < IMAGINE_WINDOW_MS);
      if (active.length === 0) {
        imagineHits.delete(key);
      } else if (active.length !== times.length) {
        imagineHits.set(key, active);
      }
    }
  }
  const recent = (imagineHits.get(ip) || []).filter((t) => now - t < IMAGINE_WINDOW_MS);
  if (recent.length === 0) {
    imagineHits.delete(ip);
  }
  if (recent.length >= IMAGINE_MAX_PER_WINDOW) {
    imagineHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  imagineHits.set(ip, recent);
  return false;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Pull a single <svg>...</svg> out of the model's reply, tolerating code fences
// or stray prose. Returns null if no SVG is present or it is too large.
function extractSvg(content: string): string | null {
  const match = content.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) return null;
  const svg = match[0];
  if (new TextEncoder().encode(svg).length > MAX_SVG_BYTES) return null;
  return svg;
}

interface LlmProvider {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  // GLM ships with "thinking" on by default, which is slow; turn it off so the
  // model emits the SVG directly. Ignored by providers that don't use the flag.
  disableThinking?: boolean;
}

// Pick the LLM provider. An explicit IMAGINE_PROVIDER wins; otherwise auto-detect
// from whichever API key is set (Z.ai preferred). Returns null if none configured.
function resolveProvider(env: Env): LlmProvider | null {
  const zai: LlmProvider | null = env.ZAI_API_KEY
    ? {
        name: 'zai',
        url: ZAI_URL,
        apiKey: env.ZAI_API_KEY,
        model: env.ZAI_MODEL || DEFAULT_ZAI_MODEL,
        disableThinking: true,
      }
    : null;
  const minimax: LlmProvider | null = env.MINIMAX_API_KEY
    ? {
        name: 'minimax',
        url: MINIMAX_URL,
        apiKey: env.MINIMAX_API_KEY,
        model: env.MINIMAX_MODEL || DEFAULT_MINIMAX_MODEL,
      }
    : null;

  switch ((env.IMAGINE_PROVIDER || '').toLowerCase()) {
    case 'zai':
      return zai;
    case 'minimax':
      return minimax;
    default:
      return zai || minimax;
  }
}

/**
 * Handle POST /imagine — proxy a prompt to the configured LLM (Z.ai or Minimax)
 * and return the generated SVG. Stateless: does not touch the Durable Object.
 * Keeps the API key server-side.
 */
async function handleImagine(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  const provider = resolveProvider(env);
  if (!provider) {
    return jsonResponse({ error: 'Imagine is not configured' }, 503);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (imagineRateLimited(ip)) {
    return jsonResponse({ error: 'Too many requests, slow down' }, 429);
  }

  let prompt: unknown;
  try {
    ({ prompt } = (await request.json()) as { prompt?: unknown });
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return jsonResponse({ error: 'A non-empty prompt is required' }, 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return jsonResponse({ error: 'Prompt is too long' }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGINE_TIMEOUT_MS);

  // Reasoning-capable models (M3, GLM) spend tokens thinking before the SVG, so
  // keep max_tokens generous or the answer gets truncated mid-tag.
  const body: Record<string, unknown> = {
    model: provider.model,
    temperature: 0.7,
    max_tokens: IMAGINE_MAX_TOKENS,
    messages: [
      { role: 'system', content: IMAGINE_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  };
  if (provider.disableThinking) {
    body.thinking = { type: 'disabled' };
  }

  try {
    const upstream = await fetch(provider.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return jsonResponse({ error: 'Upstream model error' }, 502);
    }

    const result = (await upstream.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[];
    };
    const message = result.choices?.[0]?.message;
    // Final answer lives in content; reasoning models occasionally leave the
    // SVG in reasoning_content, so fall back to it before giving up.
    const content = message?.content || message?.reasoning_content;
    if (typeof content !== 'string') {
      return jsonResponse({ error: 'Empty model response' }, 502);
    }

    const svg = extractSvg(content);
    if (!svg) {
      return jsonResponse({ error: 'Model did not return a usable SVG' }, 502);
    }

    return jsonResponse({ svg });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return jsonResponse({ error: 'Model request timed out' }, 504);
    }
    return jsonResponse({ error: 'Failed to reach the model' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Durable Object: CanvasRoom
 * Manages the shape list for a single room.
 * Uses WebSocket Hibernation API and SQLite-backed storage.
 */
export class CanvasRoom implements DurableObject {
  private sql: SqlStorage;

  constructor(private state: DurableObjectState) {
    this.sql = state.storage.sql;
    // `ord` preserves insertion order so the client's z-stacking stays stable.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS shapes (
        id TEXT PRIMARY KEY,
        ord INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `);
  }

  /**
   * Fetch handler — called by the Worker when a request is routed to this DO.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }

      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];

      // Accept the WebSocket using the Hibernation API.
      this.state.acceptWebSocket(server);
      this.setSocketAttachment(server, { connectionId: crypto.randomUUID() });

      // Remove player records whose connection is no longer active (e.g. after
      // a DO restart or abnormal disconnect where webSocketClose couldn't clean up).
      this.cleanupStalePlayers(server);

      // Send full state sync immediately.
      const syncMsg: SyncMessage = {
        type: 'sync',
        shapes: this.getAllShapes(),
        players: this.getAllPlayers(),
        count: this.state.getWebSockets().length,
      };
      server.send(JSON.stringify(syncMsg));

      // Tell everyone about the new presence count.
      this.broadcastCount();

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * WebSocket message handler — applies a mutation, persists it, and relays it
   * to every other connected client. Hibernation-safe (no in-memory state).
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let data: ClientMessage;
    try {
      data = JSON.parse(message as string) as ClientMessage;
    } catch {
      return; // Ignore malformed JSON.
    }

    switch (data.type) {
      case 'add':
      case 'update': {
        const shape = this.sanitizeShape(data.shape);
        if (!shape) return;
        if (data.type === 'add' && this.shapeCount() >= MAX_SHAPES) return;
        this.upsertShape(shape);
        this.broadcastExcept(ws, { type: data.type, shape });
        return;
      }

      case 'remove': {
        if (typeof data.id !== 'string') return;
        this.sql.exec(`DELETE FROM shapes WHERE id = ?`, data.id);
        this.broadcastExcept(ws, { type: 'remove', id: data.id });
        return;
      }

      case 'replace': {
        if (!Array.isArray(data.shapes)) return;
        const shapes = data.shapes
          .map((s) => this.sanitizeShape(s))
          .filter((s): s is Shape => s !== null)
          .slice(0, MAX_SHAPES);
        this.replaceAll(shapes);
        this.broadcastExcept(ws, { type: 'replace', shapes });
        return;
      }

      case 'clear': {
        this.sql.exec(`DELETE FROM shapes`);
        this.broadcastExcept(ws, { type: 'clear' });
        return;
      }

      case 'player-set': {
        const player = this.sanitizePlayer(data.player);
        if (!player) return;
        const attachment = this.getSocketAttachment(ws);
        this.setSocketAttachment(ws, { ...attachment, playerId: player.id });
        this.upsertPlayer(player, attachment.connectionId);
        this.broadcastExcept(ws, { type: 'player-set', player });
        return;
      }

      case 'player-move': {
        const move = this.sanitizePlayerMove(data);
        if (!move) return;
        const attachment = this.getSocketAttachment(ws);
        this.setSocketAttachment(ws, { ...attachment, playerId: move.id });
        const player = this.mergePlayerMove(move);
        this.upsertPlayer(player, attachment.connectionId);
        this.broadcastExcept(ws, move);
        return;
      }
    }
  }

  /**
   * WebSocket close handler — refresh presence for everyone still connected.
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = this.getSocketAttachment(ws);
    if (attachment.playerId) {
      this.sql.exec(
        `DELETE FROM players WHERE id = ? AND connection_id = ?`,
        attachment.playerId,
        attachment.connectionId
      );
      this.broadcastAll({ type: 'player-remove', id: attachment.playerId });
    }
    this.broadcastCount();
  }

  /**
   * Validate an incoming shape. Returns a normalized shape or null if invalid.
   * Keeps geom/options opaque but bounds their serialized size.
   */
  private sanitizeShape(shape: unknown): Shape | null {
    if (!shape || typeof shape !== 'object') return null;
    const s = shape as Record<string, unknown>;

    if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 128) return null;
    if (typeof s.type !== 'string' || !SHAPE_TYPES.has(s.type)) return null;
    if (!s.geom || typeof s.geom !== 'object') return null;
    if (!s.options || typeof s.options !== 'object') return null;

    return { id: s.id, type: s.type, geom: s.geom, options: s.options };
  }

  private sanitizePlayer(player: unknown): PlayerState | null {
    if (!player || typeof player !== 'object') return null;
    const p = player as Record<string, unknown>;
    const move = this.sanitizePlayerMove({
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
      .map((shape) => this.sanitizeShape(shape))
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

  private sanitizePlayerMove(message: unknown): PlayerMoveMessage | null {
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

  private shapeCount(): number {
    const cursor = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM shapes`);
    for (const row of cursor) return row.n;
    return 0;
  }

  /**
   * Insert a new shape (at the end of the z-order) or update an existing one
   * in place (preserving its position in the z-order).
   */
  private upsertShape(shape: Shape): void {
    const data = JSON.stringify({
      id: shape.id,
      type: shape.type,
      geom: shape.geom,
      options: shape.options,
    });

    const updated = this.sql.exec(
      `UPDATE shapes SET data = ? WHERE id = ?`,
      data,
      shape.id
    ).rowsWritten;

    if (!updated) {
      let nextOrd = 0;
      const cursor = this.sql.exec<{ ord: number }>(
        `SELECT COALESCE(MAX(ord), 0) + 1 AS ord FROM shapes`
      );
      for (const row of cursor) nextOrd = row.ord;
      this.sql.exec(`INSERT INTO shapes (id, ord, data) VALUES (?, ?, ?)`, shape.id, nextOrd, data);
    }
  }

  /**
   * Replace the entire shape list (used for undo). Order follows the array.
   */
  private replaceAll(shapes: Shape[]): void {
    this.sql.exec(`DELETE FROM shapes`);
    shapes.forEach((shape, index) => {
      const data = JSON.stringify({
        id: shape.id,
        type: shape.type,
        geom: shape.geom,
        options: shape.options,
      });
      this.sql.exec(`INSERT OR REPLACE INTO shapes (id, ord, data) VALUES (?, ?, ?)`, shape.id, index, data);
    });
  }

  /**
   * Read every shape from SQLite in insertion order.
   */
  private getAllShapes(): Shape[] {
    const shapes: Shape[] = [];
    const cursor = this.sql.exec<{ data: string }>(`SELECT data FROM shapes ORDER BY ord ASC`);
    for (const row of cursor) {
      try {
        shapes.push(JSON.parse(row.data) as Shape);
      } catch {
        // Skip corrupt rows.
      }
    }
    return shapes;
  }

  private cleanupStalePlayers(newSocket: WebSocket): void {
    const activeIds = new Set<string>();
    for (const ws of this.state.getWebSockets()) {
      const att = this.getSocketAttachment(ws);
      activeIds.add(att.connectionId);
    }

    const stale: string[] = [];
    const cursor = this.sql.exec<{ id: string; connection_id: string }>(
      `SELECT id, connection_id FROM players`
    );
    for (const row of cursor) {
      if (!activeIds.has(row.connection_id)) {
        stale.push(row.id);
      }
    }

    for (const id of stale) {
      this.sql.exec(`DELETE FROM players WHERE id = ?`, id);
      this.broadcastExcept(newSocket, { type: 'player-remove', id });
    }
  }

  private getAllPlayers(): PlayerState[] {
    const players: PlayerState[] = [];
    const cursor = this.sql.exec<{ data: string }>(`SELECT data FROM players ORDER BY id ASC`);
    for (const row of cursor) {
      try {
        const player = this.sanitizePlayer(JSON.parse(row.data));
        if (player) players.push(player);
      } catch {
        // Skip corrupt rows.
      }
    }
    return players;
  }

  private getPlayer(id: string): PlayerState | null {
    const cursor = this.sql.exec<{ data: string }>(`SELECT data FROM players WHERE id = ?`, id);
    for (const row of cursor) {
      try {
        return this.sanitizePlayer(JSON.parse(row.data));
      } catch {
        return null;
      }
    }
    return null;
  }

  private mergePlayerMove(move: PlayerMoveMessage): PlayerState {
    const existing = this.getPlayer(move.id);
    return {
      id: move.id,
      x: move.x,
      y: move.y,
      moving: move.moving,
      facing: move.facing,
      avatar: existing?.avatar || [],
    };
  }

  private upsertPlayer(player: PlayerState, connectionId: string): void {
    const data = JSON.stringify(player);
    this.sql.exec(
      `
        INSERT INTO players (id, connection_id, data)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          connection_id = excluded.connection_id,
          data = excluded.data
      `,
      player.id,
      connectionId,
      data
    );
  }

  private getSocketAttachment(ws: WebSocket): SocketAttachment {
    const fallback = { connectionId: crypto.randomUUID() };
    const api = ws as WebSocket & {
      deserializeAttachment?: () => SocketAttachment | undefined;
    };
    return api.deserializeAttachment?.() || fallback;
  }

  private setSocketAttachment(ws: WebSocket, attachment: SocketAttachment): void {
    const api = ws as WebSocket & {
      serializeAttachment?: (value: SocketAttachment) => void;
    };
    api.serializeAttachment?.(attachment);
  }

  private broadcastAll(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(json);
      } catch {
        // Socket may be closing; ignore.
      }
    }
  }

  /**
   * Broadcast a message to every connected WebSocket except the sender.
   */
  private broadcastExcept(sender: WebSocket, msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === sender) continue;
      try {
        ws.send(json);
      } catch {
        // Socket may be closing; ignore.
      }
    }
  }

  /**
   * Broadcast the current connection count to all clients.
   */
  private broadcastCount(): void {
    const count = this.state.getWebSockets().length;
    const msg: CountMessage = { type: 'count', count };
    const json = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(json);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Worker entry point.
 * Serves static assets for regular HTTP requests.
 * Routes WebSocket upgrade requests to the appropriate CanvasRoom Durable Object.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/imagine') {
      return handleImagine(request, env);
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket' || url.pathname === '/ws') {
      const roomName = url.searchParams.get('room') || 'main';
      const id = env.CANVAS_ROOM.idFromName(roomName);
      const stub = env.CANVAS_ROOM.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * Environment bindings type.
 */
interface Env {
  CANVAS_ROOM: DurableObjectNamespace;
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
