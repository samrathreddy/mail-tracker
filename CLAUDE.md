# Mail Tracker - Project Guide

## Overview

Tracking pixel service with a Cloudflare Worker backend and Chrome extension frontend.
Tracks email opens and page visits via a 1x1 transparent PNG pixel.

## Architecture

```
mail-tracker/
├── src/index.js          # Cloudflare Worker (backend) - single file, no framework
├── extension/            # Chrome Extension (Manifest V3)
│   ├── manifest.json     # Extension config
│   ├── popup.html        # Popup UI (dark theme)
│   ├── popup.js          # Popup logic (vanilla JS, no build step)
│   ├── background.js     # Service worker for polling & notifications
│   ├── gmail.js          # Content script — auto-injects pixel in Gmail on Send
│   └── icons/            # Extension icons (16/48/128px)
├── wrangler.toml         # Cloudflare Workers config
└── package.json          # Only dev dep: wrangler
```

## Tech Stack

- **Backend**: Cloudflare Workers + KV storage (no npm runtime deps)
- **Frontend**: Chrome Extension (Manifest V3), vanilla JS, no build tools
- **Package manager**: pnpm

## Commands

- `pnpm dev` — run worker locally (http://localhost:8787)
- `pnpm deploy` — deploy worker to Cloudflare

## Worker API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Web dashboard (HTML) |
| `/t/:id` | GET | Serve tracking pixel & record open |
| `/s/:id` | GET | Get stats for a pixel (JSON) |
| `/new?to=email` | GET | Create a new tracking pixel (optional recipient) |
| `/list` | GET | List all pixels (JSON, used by extension) |
| `/d/:id` | GET | Delete a pixel |

## Storage

Uses Cloudflare KV namespace bound as `TRACKER`. Each pixel is stored as:
```json
{
  "opens": 5,
  "events": [
    { "time": "ISO-8601", "ip": "...", "country": "US", "userAgent": "..." }
  ]
}
```
Events are capped at 100 per pixel to stay within KV size limits.

## Key Conventions

- No frameworks or build tools — keep it minimal
- Single-file worker, no splitting into modules
- Extension uses DOM APIs (createElement, textContent) — no innerHTML with dynamic data
- All API responses include CORS headers for extension compatibility
- Dark theme UI throughout (both dashboard and extension)
- Gmail content script (gmail.js) hooks Send button to auto-inject tracking pixels
- Per-recipient tracking: each recipient gets their own pixel ID
- Sender IP stored on creation to filter self-opens

## Setup Requirements

1. Cloudflare account with Workers enabled
2. KV namespace ID must be set in `wrangler.toml`
3. `pnpm` for package management
4. Chrome/Chromium for the extension
