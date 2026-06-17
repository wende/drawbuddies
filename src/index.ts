/**
 * DrawBuddies - Cloudflare Worker entry point.
 * A collaborative rough.js drawing board with live sync, presence, and persistence.
 *
 * - GET/POST /imagine -> stateless LLM SVG generation (src/imagine.ts)
 * - WebSocket /ws      -> per-room CanvasRoom Durable Object (src/room.ts)
 * - everything else    -> static assets from ./public
 *
 * The wire protocol and data model live in src/protocol.ts.
 */

import { handleImagine } from './imagine';
import type { Env } from './protocol';
import { CanvasRoom } from './room';

// Wrangler resolves the Durable Object class from the main module's exports.
export { CanvasRoom };

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
