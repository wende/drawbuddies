# Pixel Canvas — Cloudflare Durable Objects Demo

A collaborative pixel canvas (r/place-style) demonstrating **live sync**, **presence**, and **persistence** using Cloudflare Workers + SQLite-backed Durable Objects with the WebSocket Hibernation API.

## What it demonstrates

| Property | How it's shown |
|----------|---------------|
| **Live sync** | Paint a pixel in one tab; it appears in all other tabs within ~1s |
| **Presence** | A "N people here" counter that rises/falls as tabs open and close |
| **Persistence** | Paint something, close all tabs, reopen hours later — your art is still there |

## Architecture

- **One Durable Object per room** — addressed via `?room=name` query param (defaults to `"main"`)
- **WebSocket Hibernation API** — `state.acceptWebSocket()` + `webSocketMessage`/`webSocketClose` handlers
- **SQLite-backed storage** — every pixel change is persisted to `state.storage.sql` before broadcasting
- **Authoritative state in storage** — no in-memory cache; state is read from SQLite on every connect
- **Full sync on connect** — new clients receive the entire canvas immediately
- **Free tier only** — no paid Cloudflare features used

## Deploy

### Option A: One-click deploy button (recommended)

1. Fork/push this repo to your own GitHub account
2. Go to [Cloudflare Dashboard > Workers & Pages](https://dash.cloudflare.com/)
3. Click **Create** > **Workers** > **Import from Git**
4. Select your repo and deploy

Or use the [deploy.workers.cloudflare.com](https://deploy.workers.cloudflare.com) flow — paste your GitHub repo URL there.

### Option B: CLI deploy (if you have Wrangler set up)

```bash
npx wrangler login
npx wrangler deploy
```

## Project structure

```
.
├── src/
│   └── index.ts          # Worker entry point + CanvasRoom Durable Object
├── public/
│   └── index.html        # Client-side pixel canvas UI
├── wrangler.jsonc        # Cloudflare configuration
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies
└── .github/workflows/
    └── deploy.yml        # Auto-deploy on push to main (via GitHub Actions)
```

## The one place to edit shared-state logic

All shared-state logic lives in **`src/index.ts`** inside the `CanvasRoom` class:

- **`fetch()`** — handles WebSocket upgrades, sends full sync on connect
- **`webSocketMessage()`** — applies mutations (paint/clear), persists to SQLite, broadcasts
- **`webSocketClose()`** — updates presence count
- **`getAllPixels()`** — reads the full canvas state from SQLite

Change the grid size, color palette, or message format there.

## How to test

After deploying, your app will be at `https://pixel-canvas-do.YOUR_SUBDOMAIN.workers.dev`.

1. **Realtime** — open two tabs side by side, paint in one, watch it appear in the other
2. **Persistence** — paint something, close ALL tabs, wait a few seconds, reopen: art is still there
3. **Presence** — the "people here" count changes as tabs open/close
4. **Rooms** — add `?room=myroom` to the URL for separate canvases

## Free-tier cost notes

- **Durable Objects** are included in the free Workers plan
- **SQLite storage** — ~5 GB free
- **WebSocket messages** — incoming messages are billed at a 20:1 ratio (20 messages = 1 request unit)
- A canvas with moderate usage fits comfortably within free limits
