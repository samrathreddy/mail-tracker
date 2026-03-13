# Mail Tracker - Project Guide

## Overview

Email open tracking service. Embeds a 1x1 transparent PNG pixel in emails — when the recipient opens the email, the pixel fires a request that records the open. Built with a Cloudflare Worker backend and Chrome extension frontend.

## Architecture

```
mail-tracker/
├── src/
│   ├── index.js            # Worker entry — router & API handlers
│   ├── shared.js           # Constants, helpers, auth, pixel serving
│   ├── notifications.js    # Slack/Discord webhook dispatch
│   └── views/
│       ├── dashboard.js    # Main listing page (GET /)
│       └── detail.js       # Individual tracker page (GET /s/:id)
├── extension/              # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── background.js       # Service worker — polling & notifications
│   ├── gmail.js            # Content script — auto-injects pixel on Send
│   └── icons/
├── wrangler.toml           # Cloudflare Workers config (KV binding)
└── package.json
```

## Tech Stack

- **Runtime**: Cloudflare Workers (V8 isolate, no Node.js APIs)
- **Storage**: Cloudflare KV (bound as `TRACKER`)
- **Frontend**: Chrome Extension (Manifest V3), vanilla JS
- **Package manager**: pnpm
- **No frameworks, no build step, no npm runtime deps**

## Commands

- `pnpm dev` — local dev server at http://localhost:8787
- `pnpm run deploy` — deploy to Cloudflare (note: `pnpm run deploy`, not `pnpm deploy`)

## API Endpoints

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/` | GET | Yes | Web dashboard — lists all trackers |
| `/t/:id` | GET | No | Serve tracking pixel & record open |
| `/s/:id` | GET | Yes | Tracker detail page (HTML) or stats (JSON with `?format=json`) |
| `/new` | GET/POST | Yes | Create new pixel. POST accepts `{ to, subject, bodyPreview, messageId }` |
| `/list` | GET | Yes | List all pixels as JSON (used by extension) |
| `/d/:id` | GET | Yes | Delete a pixel |

Auth uses HTTP Basic with `DASHBOARD_PASSWORD` env var. If unset, all routes are open.

## Storage Schema

Each pixel in KV (key = 8-char UUID):
```json
{
  "opens": 5,
  "skipped": 2,
  "senderIp": "...",
  "recipient": "user@example.com",
  "subject": "...",
  "bodyPreview": "...",
  "messageId": "...",
  "createdAt": "ISO-8601",
  "events": [
    { "time": "ISO-8601", "ip": "...", "country": "US", "userAgent": "..." }
  ],
  "filteredEvents": [
    { "time": "ISO-8601", "ip": "...", "reason": "sender_ip|bot_proxy" }
  ]
}
```
- `events` capped at 100, `filteredEvents` capped at 20

## Open Filtering Pipeline

Three filters run before recording an open:
1. **Sender IP** — skips if opener IP matches creator IP
2. **Bot detection** — regex patterns for known email proxies (Outlook SafeLinks, Yahoo, etc.)
3. **Dedup window** — ignores same-IP opens within 5 seconds

## Code Conventions

### General
- No frameworks or build tools — vanilla JS everywhere
- Keep modules focused: router logic in `index.js`, HTML generation in `views/`, reusable bits in `shared.js`
- All timezone-dependent computations (hourly chart, calendar heatmap) happen **client-side** so they match the viewer's local time
- Webhook notifications are dispatched in `notifications.js`

### Security
- Use DOM APIs (`createElement`, `textContent`) — never `innerHTML` with dynamic data
- Escape all server-injected strings in HTML templates with `esc()` from `shared.js`
- All API responses include CORS headers for extension compatibility
- Validate inputs at API boundaries (email format, string length limits)

### UI
- Dark theme (zinc/indigo/emerald palette) across dashboard and extension
- Inline SVG favicon and logo — no external asset dependencies
- Dashboard features: search/filter, card-based list, create modal
- Detail page features: stats grid, calendar heatmap, peak hours grid, event timeline with tabs

### Extension
- Gmail content script (`gmail.js`) hooks Send button to auto-inject tracking pixels
- Per-recipient tracking: each recipient gets their own pixel ID
- Background service worker polls for new opens

## Setup

1. Cloudflare account with Workers + KV enabled
2. Set KV namespace ID in `wrangler.toml`
3. `pnpm install` then `pnpm run deploy`
4. Optionally set `DASHBOARD_PASSWORD` secret: `npx wrangler secret put DASHBOARD_PASSWORD`
5. Optionally set `SLACK_WEBHOOK_URL` / `DISCORD_WEBHOOK_URL` for notifications
6. Load `extension/` as unpacked extension in Chrome
