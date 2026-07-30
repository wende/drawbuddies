/**
 * Durable Object: RoomRegistry
 * A single well-known instance (idFromName('registry')) that tracks PUBLIC
 * rooms so the lobby can list them with live player counts.
 *
 * Private rooms are never registered: heartbeats for an unknown code are
 * ignored, so no row is ever created for them.
 *
 * Endpoints (internal fetch, JSON):
 *   POST /register  { code, title }  -> create/refresh a public room row
 *   POST /heartbeat { code, count }  -> update count + last_seen for a known room
 *   GET  /list                       -> active public rooms (prunes expired)
 */

import {
  filterActiveRooms,
  isValidRoomCode,
  RegistryRoom,
  ROOM_LIST_TTL_MS,
  sanitizeRoomTitle,
} from './protocol';

const REGISTRY_NAME = 'registry';

export class RoomRegistry implements DurableObject {
  private sql: SqlStorage;

  constructor(private state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/register') {
      return this.handleRegister(request);
    }
    if (request.method === 'POST' && url.pathname === '/heartbeat') {
      return this.handleHeartbeat(request);
    }
    if (request.method === 'GET' && url.pathname === '/list') {
      return this.handleList();
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleRegister(request: Request): Promise<Response> {
    const body = await this.readJson(request);
    const code = body?.code;
    if (!isValidRoomCode(code)) {
      return json({ ok: false, error: 'invalid-code' }, 400);
    }

    // Collision: the code already names a different live/known public room.
    if (this.getRoom(code)) {
      return json({ ok: false, collision: true });
    }

    const title = sanitizeRoomTitle(body?.title);
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO rooms (code, title, count, created_at, last_seen_at) VALUES (?, ?, 0, ?, ?)`,
      code,
      title,
      now,
      now
    );
    return json({ ok: true, code, title });
  }

  private async handleHeartbeat(request: Request): Promise<Response> {
    const body = await this.readJson(request);
    const code = body?.code;
    const count = Math.max(0, Math.trunc(Number(body?.count)) || 0);
    if (typeof code !== 'string') return json({ ok: false });

    // Only update rooms we already know about (public). Unknown => ignore.
    const updated = this.sql.exec(
      `UPDATE rooms SET count = ?, last_seen_at = ? WHERE code = ?`,
      count,
      Date.now(),
      code
    ).rowsWritten;

    return json({ ok: updated > 0 });
  }

  private handleList(): Response {
    const all = this.getAllRooms();
    const { active, expired } = filterActiveRooms(all, Date.now(), ROOM_LIST_TTL_MS);
    for (const code of expired) {
      this.sql.exec(`DELETE FROM rooms WHERE code = ?`, code);
    }
    // Busiest first, then alphabetical by title for stable ordering.
    active.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    return json({ rooms: active });
  }

  private getRoom(code: string): RegistryRoom | null {
    const cursor = this.sql.exec<RegistryRoomRow>(`SELECT * FROM rooms WHERE code = ?`, code);
    for (const row of cursor) return rowToRoom(row);
    return null;
  }

  private getAllRooms(): RegistryRoom[] {
    const rooms: RegistryRoom[] = [];
    const cursor = this.sql.exec<RegistryRoomRow>(`SELECT * FROM rooms`);
    for (const row of cursor) rooms.push(rowToRoom(row));
    return rooms;
  }

  private async readJson(request: Request): Promise<Record<string, unknown> | null> {
    try {
      return (await request.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

type RegistryRoomRow = {
  code: string;
  title: string;
  count: number;
  created_at: number;
  last_seen_at: number;
};

function rowToRoom(row: RegistryRoomRow): RegistryRoom {
  return {
    code: row.code,
    title: row.title,
    count: row.count,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Resolve the single shared registry stub from any binding. */
export function registryStub(namespace: DurableObjectNamespace): DurableObjectStub {
  return namespace.get(namespace.idFromName(REGISTRY_NAME));
}
