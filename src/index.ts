/**
 * DrawBuddies - Cloudflare Worker entry point.
 * A collaborative rough.js drawing board with live sync, presence, and persistence.
 *
 * - GET/POST /imagine  -> stateless LLM SVG generation (src/imagine.ts)
 * - POST/GET /api/rooms -> create a room / list public rooms (src/registry.ts)
 * - GET /r/:code       -> serve the SPA for a room deep link
 * - WebSocket /ws      -> per-room CanvasRoom Durable Object (src/room.ts)
 * - everything else    -> static assets from ./public
 *
 * The wire protocol and data model live in src/protocol.ts.
 */

import { handleImagine } from './imagine';
import {
  Env,
  generateRoomCode,
  isValidRoomCode,
  sanitizeRoomTitle,
} from './protocol';
import { CanvasRoom } from './room';
import { RoomRegistry, registryStub } from './registry';

// Wrangler resolves the Durable Object classes from the main module's exports.
export { CanvasRoom, RoomRegistry };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/imagine') {
      return handleImagine(request, env);
    }

    if (url.pathname === '/api/rooms') {
      return handleRooms(request, env);
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket' || url.pathname === '/ws') {
      const roomName = url.searchParams.get('room') || 'main';
      const id = env.CANVAS_ROOM.idFromName(roomName);
      const stub = env.CANVAS_ROOM.get(id);
      return stub.fetch(request);
    }

    // Room deep links (/r/CODE) are client-routed: serve the SPA shell and let
    // the browser read the code from the path. Assets are referenced absolutely.
    if (url.pathname.startsWith('/r/')) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * Room API:
 *   GET  /api/rooms                 -> { rooms: RegistryRoom[] } (public, active)
 *   POST /api/rooms { public, title } -> { code, url }
 */
async function handleRooms(request: Request, env: Env): Promise<Response> {
  const registry = registryStub(env.ROOM_REGISTRY);

  if (request.method === 'GET') {
    return registry.fetch('https://registry/list');
  }

  if (request.method === 'POST') {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }

    const isPublic = Boolean(body?.public);
    const title = sanitizeRoomTitle(body?.title);

    // Generate a code. Private rooms skip the registry entirely; public rooms
    // register (retrying on the rare collision).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode();
      if (!isValidRoomCode(code)) continue;

      if (!isPublic) {
        return json({ code, url: `/r/${code}` });
      }

      const res = await registry.fetch('https://registry/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, title }),
      });
      const result = (await res.json()) as { ok?: boolean; collision?: boolean };
      if (result.ok) {
        return json({ code, url: `/r/${code}` });
      }
      if (!result.collision) break;
    }

    return json({ error: 'could-not-allocate-code' }, 503);
  }

  return new Response('Method not allowed', { status: 405 });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
