/**
 * Durable Object: CanvasRoom
 * Manages the shape list and player presence for a single room.
 * Uses the WebSocket Hibernation API and SQLite-backed storage.
 */

import {
  ClientMessage,
  CountMessage,
  MAX_SHAPES,
  PlayerMoveMessage,
  PlayerState,
  sanitizePlayer,
  sanitizePlayerMove,
  sanitizeShape,
  ServerMessage,
  Shape,
  SocketAttachment,
  SyncMessage,
} from './protocol';

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
        const shape = sanitizeShape(data.shape);
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
          .map((s) => sanitizeShape(s))
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
        const player = sanitizePlayer(data.player);
        if (!player) return;
        const attachment = this.getSocketAttachment(ws);
        this.setSocketAttachment(ws, { ...attachment, playerId: player.id });
        this.upsertPlayer(player, attachment.connectionId);
        this.broadcastExcept(ws, { type: 'player-set', player });
        return;
      }

      case 'player-move': {
        const move = sanitizePlayerMove(data);
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
        const player = sanitizePlayer(JSON.parse(row.data));
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
        return sanitizePlayer(JSON.parse(row.data));
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
