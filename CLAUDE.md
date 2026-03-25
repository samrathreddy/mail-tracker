# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Email open tracking service: 1x1 transparent PNG pixel embedded in emails, Cloudflare Worker records opens. Chrome extension auto-injects pixels in Gmail.

## Commands

- `pnpm dev` — local dev server at http://localhost:8787
- `pnpm run deploy` — deploy to Cloudflare (**must** use `pnpm run deploy`, not `pnpm deploy`)

No test framework, no linter, no build step.

## Architecture

**Backend** (`src/`): Cloudflare Worker, vanilla JS, no Node.js APIs available.

- `index.js` — Worker entry point, request router, all API handlers
- `shared.js` — Constants (PIXEL, CORS_HEADERS, BOT_PATTERNS), helpers (`json()`, `esc()`, `checkAuth()`), pixel serving
- `notifications.js` — Slack/Discord webhook dispatch
- `views/dashboard.js` — HTML generation for GET / (main listing)
- `views/detail.js` — HTML generation for GET /s/:id (individual tracker)

**Extension** (`extension/`): Chrome Manifest V3, vanilla JS.

- `gmail.js` — Content script injected into Gmail; hooks Send button to auto-inject tracking pixels (one per recipient)
- `background.js` — Service worker; polls worker for new opens, fires Chrome notifications
- `popup.js` / `popup.html` — Extension popup UI

**Storage**: Cloudflare KV (binding name `TRACKER`). Each tracker keyed by 8-char UUID. Config in `wrangler.toml` (gitignored; `wrangler.example.toml` is the template).

## Key Patterns

**Open filtering pipeline** (in `index.js`, `/t/:id` handler): Three filters run in order before counting an open:
1. Sender IP match → skip
2. Bot/proxy user-agent regex (`BOT_PATTERNS` in `shared.js`) → skip
3. Same-IP dedup within 5 seconds → skip

Filtered hits go to `filteredEvents` (capped at 20); real opens go to `events` (capped at 100).

**Auth**: HTTP Basic using `DASHBOARD_PASSWORD` env var. `/t/:id` is always unauthenticated (must be, so email clients can load the pixel).

**Notifications**: `sendWebhookNotifications()` dispatches to Slack/Discord webhooks after a real open is recorded. Webhook URLs come from `SLACK_WEBHOOK_URL` / `DISCORD_WEBHOOK_URL` secrets.

## Code Conventions

- No frameworks, no build tools, no npm runtime deps — vanilla JS only
- Views generate HTML strings server-side; all timezone-dependent computations (hourly chart, calendar heatmap) happen **client-side** in embedded `<script>` tags
- Escape dynamic data in HTML templates with `esc()` from `shared.js` — never use raw string interpolation for user data
- Use DOM APIs (`createElement`, `textContent`) in extension code — never `innerHTML` with dynamic data
- All API responses include CORS headers (for extension compatibility)
- Dark theme with zinc/indigo/emerald palette across dashboard and extension
- Inline SVG for favicon and logo — no external asset dependencies

## API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/` | GET | Yes | Web dashboard |
| `/t/:id` | GET | No | Tracking pixel endpoint |
| `/s/:id` | GET | Yes | Tracker detail (HTML) or stats (JSON with `?format=json`) |
| `/new` | GET/POST | Yes | Create pixel. POST body: `{ to, subject, bodyPreview, messageId }` |
| `/list` | GET | Yes | List all pixels as JSON |
| `/d/:id` | GET | Yes | Delete pixel |

## Storage Schema

KV value per tracker (key = 8-char UUID):
```json
{
  "opens": 5, "skipped": 2,
  "senderIp": "...", "recipient": "...", "subject": "...",
  "bodyPreview": "...", "messageId": "...", "createdAt": "ISO-8601",
  "events": [{ "time": "ISO-8601", "ip": "...", "country": "US", "userAgent": "..." }],
  "filteredEvents": [{ "time": "ISO-8601", "ip": "...", "reason": "sender_ip|bot_proxy" }]
}
```
