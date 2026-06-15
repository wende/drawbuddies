/**
 * Pixel Canvas - Cloudflare Worker + Durable Object
 * A collaborative pixel canvas with live sync, presence, and persistence.
 */

// Message types sent between client and server
interface PixelUpdate {
  type: 'pixel';
  x: number;
  y: number;
  color: string;
}

interface SyncMessage {
  type: 'sync';
  pixels: Record<string, string>;
  count: number;
}

interface CountMessage {
  type: 'count';
  count: number;
}

interface ClearMessage {
  type: 'clear';
}

type ClientMessage = PixelUpdate | ClearMessage;
type ServerMessage = SyncMessage | PixelUpdate | CountMessage | ClearMessage;

// Color palette
const PALETTE = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
  '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080',
  '#FFC0CB', '#A52A2A', '#808080', '#FFD700', '#4B0082',
  '#00FF7F',
];

const GRID_SIZE = 32;

/**
 * Durable Object: CanvasRoom
 * Manages the canvas state for a single room.
 * Uses WebSocket Hibernation API and SQLite-backed storage.
 */
export class CanvasRoom implements DurableObject {
  private sql: SqlStorage;

  constructor(private state: DurableObjectState) {
    this.sql = state.storage.sql;
    // Ensure the pixels table exists
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pixels (
        key TEXT PRIMARY KEY,
        color TEXT NOT NULL
      )
    `);
  }

  /**
   * Fetch handler — called by the Worker when a request is routed to this DO.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }

      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];

      // Accept the WebSocket using Hibernation API
      this.state.acceptWebSocket(server);

      // Send full state sync immediately
      const pixels = this.getAllPixels();
      const count = this.state.getWebSockets().length;
      const syncMsg: SyncMessage = { type: 'sync', pixels, count };
      server.send(JSON.stringify(syncMsg));

      // Broadcast new count to all connected clients
      this.broadcastCount();

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * WebSocket message handler — called when a message is received from a client.
   * This is a hibernation-safe method (no in-memory state).
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string) as ClientMessage;

      if (data.type === 'pixel') {
        // Validate coordinates
        if (
          typeof data.x !== 'number' ||
          typeof data.y !== 'number' ||
          typeof data.color !== 'string' ||
          data.x < 0 || data.x >= GRID_SIZE ||
          data.y < 0 || data.y >= GRID_SIZE ||
          !PALETTE.includes(data.color)
        ) {
          return;
        }

        const key = `${data.x},${data.y}`;

        // Persist to SQLite BEFORE broadcasting
        this.sql.exec(
          `INSERT OR REPLACE INTO pixels (key, color) VALUES (?, ?)`,
          key,
          data.color
        );

        // Broadcast to all connected sockets (including sender for confirmation)
        const update: PixelUpdate = {
          type: 'pixel',
          x: data.x,
          y: data.y,
          color: data.color,
        };
        this.broadcast(update);
      } else if (data.type === 'clear') {
        // Clear all pixels
        this.sql.exec(`DELETE FROM pixels`);
        const clearMsg: ClearMessage = { type: 'clear' };
        this.broadcast(clearMsg);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  /**
   * WebSocket close handler — called when a WebSocket closes.
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Broadcast updated count
    this.broadcastCount();
  }

  /**
   * Retrieve all pixels from SQLite storage.
   * Reads from storage every time — no in-memory cache.
   */
  private getAllPixels(): Record<string, string> {
    const pixels: Record<string, string> = {};
    const cursor = this.sql.exec<{ key: string; color: string }>(
      `SELECT key, color FROM pixels`
    );
    for (const row of cursor) {
      pixels[row.key] = row.color;
    }
    return pixels;
  }

  /**
   * Broadcast a message to all connected WebSockets.
   */
  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(json);
      } catch {
        // Socket may be closing; ignore
      }
    }
  }

  /**
   * Broadcast the current connection count to all clients.
   */
  private broadcastCount(): void {
    const count = this.state.getWebSockets().length;
    const msg: CountMessage = { type: 'count', count };
    this.broadcast(msg);
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

    // WebSocket upgrades go to the Durable Object
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket' || url.pathname === '/ws') {
      const roomName = url.searchParams.get('room') || 'main';
      const id = env.CANVAS_ROOM.idFromName(roomName);
      const stub = env.CANVAS_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else: serve static assets from the ASSETS binding
    return env.ASSETS.fetch(request);
  },
};

/**
 * Environment bindings type.
 */
interface Env {
  CANVAS_ROOM: DurableObjectNamespace<CanvasRoom>;
  ASSETS: Fetcher;
}
