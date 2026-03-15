# Contributing to Mail Tracker

Thanks for your interest in contributing! This project is simple by design — no frameworks, no build tools, just vanilla JS on Cloudflare Workers.

## Getting Started

1. Fork the repo and clone it locally
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Set up a KV namespace (see README for details)
4. Start the dev server:
   ```bash
   pnpm dev
   ```
5. Load the `extension/` folder as an unpacked Chrome extension

## Project Structure

```
src/
├── index.js          # Worker entry — router & API handlers
├── shared.js         # Constants, helpers, auth, pixel serving
├── notifications.js  # Slack/Discord webhook dispatch
└── views/
    ├── dashboard.js  # Main listing page (GET /)
    └── detail.js     # Individual tracker page (GET /s/:id)
extension/
├── manifest.json     # Chrome Extension (Manifest V3)
├── popup.html/js     # Extension popup UI
├── background.js     # Service worker — polling & notifications
└── gmail.js          # Content script — auto-injects pixel on Send
```

## Code Conventions

- **No frameworks or build tools** — vanilla JS everywhere
- **No `innerHTML` with dynamic data** — use `esc()` from `shared.js` for server-injected strings
- **Dark theme** — zinc/indigo/emerald palette across dashboard and extension
- **Client-side timezone handling** — all time-dependent computations happen in the browser
- Keep modules focused: router in `index.js`, HTML in `views/`, reusable bits in `shared.js`

## How to Contribute

### Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser/OS info if relevant

### Suggesting Features

Open an issue describing the use case. Keep in mind the project philosophy: simple, self-hosted, no external dependencies.

### Submitting Code

1. Create a branch from `main`
2. Make your changes — keep them focused and minimal
3. Test locally with `pnpm dev`
4. Test the Chrome extension if your change affects it
5. Open a PR with a clear description of what and why

### Good First Contributions

Look for issues labeled **`good first issue`** — these are scoped, well-defined tasks ideal for new contributors. Some areas that are always welcome:

- Improving bot detection patterns (new email proxy user-agents)
- Adding support for more notification platforms
- UI/UX improvements to the dashboard or extension
- Documentation improvements
- Bug fixes

## Runtime Constraints

This runs on **Cloudflare Workers (V8 isolate)** — no Node.js APIs available. Keep this in mind:
- No `fs`, `path`, `crypto` (use Web Crypto API instead), etc.
- No npm runtime dependencies — everything is vanilla
- CPU time limit of 10ms per request on the free tier

## Questions?

Open an issue or start a discussion — happy to help!
