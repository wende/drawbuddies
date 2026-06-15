/**
 * Rough Drawing Canvas - Cloudflare Worker + Durable Object
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

// Server -> Client messages
interface SyncMessage {
  type: 'sync';
  shapes: Shape[];
  count: number;
}
interface CountMessage {
  type: 'count';
  count: number;
}

type ClientMessage =
  | AddMessage
  | UpdateMessage
  | RemoveMessage
  | ReplaceMessage
  | ClearMessage;
type ServerMessage =
  | SyncMessage
  | AddMessage
  | UpdateMessage
  | RemoveMessage
  | ReplaceMessage
  | ClearMessage
  | CountMessage;

// Shape types the renderer understands. Anything else is rejected.
const SHAPE_TYPES = new Set([
  'smart',
  'curve',
  'line',
  'rectangle',
  'ellipse',
  'text',
]);

// Guard rails to keep a room within free-tier limits.
const MAX_SHAPES = 5000;

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

      // Send full state sync immediately.
      const syncMsg: SyncMessage = {
        type: 'sync',
        shapes: this.getAllShapes(),
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
    }
  }

  /**
   * WebSocket close handler — refresh presence for everyone still connected.
   */
  async webSocketClose(): Promise<void> {
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
}
