# Mail Tracker

A lightweight email open tracking service built with Cloudflare Workers + a Chrome extension.

When you send an email from Gmail, the extension automatically injects an invisible 1x1 tracking pixel per recipient. When they open the email, you get a notification with their name, open count, location, and device.

## How It Works

```
You send email in Gmail → extension auto-injects invisible pixel per recipient
    → recipient opens email → pixel loads → worker logs IP, country, device, time
    → extension polls worker → Chrome notification: "bob@test.com opened your email"
```

---

## Full Installation Guide

### Prerequisites

| Requirement | How to check | How to install |
|-------------|-------------|----------------|
| **Node.js** v18+ | `node -v` | [nodejs.org](https://nodejs.org/) |
| **pnpm** | `pnpm -v` | `npm install -g pnpm` |
| **Cloudflare account** | — | [Sign up free](https://dash.cloudflare.com/sign-up) |
| **Chrome browser** | — | [chrome.google.com](https://www.google.com/chrome/) |

---

### Part 1: Deploy the Backend (Cloudflare Worker)

#### Step 1 — Clone and install

```bash
cd ~/mail-tracker
pnpm install
```

You should see wrangler installed in `node_modules/`.

#### Step 2 — Log in to Cloudflare

```bash
pnpm exec wrangler login
```

This opens your browser. Log in to your Cloudflare account and authorize Wrangler.

To verify it worked:
```bash
pnpm exec wrangler whoami
```
You should see your account name and ID.

#### Step 3 — Create a KV namespace

KV is Cloudflare's key-value database. The worker uses it to store tracking data.

```bash
pnpm exec wrangler kv namespace create "TRACKER"
```

You'll see output like:
```
⛅️ wrangler
{ binding = "TRACKER", id = "abc123def456..." }
```

**Copy that `id` value.** You'll need it in the next step.

#### Step 4 — Configure wrangler.toml

Copy the example config and paste your KV namespace ID:

```bash
cp wrangler.example.toml wrangler.toml
```

Then open `wrangler.toml` and replace the placeholder `id`:

```toml
name = "mail-tracker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "TRACKER"
id = "abc123def456..."   # ← paste YOUR id here
```

> Note: `wrangler.toml` is gitignored since it contains your KV namespace ID. The repo ships `wrangler.example.toml` as a template.

#### Step 5 — Test locally (optional)

```bash
pnpm dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser. You should see the Mail Tracker dashboard. Press `Ctrl+C` to stop.

#### Step 6 — Deploy to Cloudflare

```bash
pnpm deploy
```

Output will show your live URL:
```
Published mail-tracker (1.2s)
  https://mail-tracker.YOUR-SUBDOMAIN.workers.dev
```

**Save this URL** — you'll enter it in the extension settings.

#### Step 7 — Set Dashboard Password (Recommended)

Protect your tracking data with a password:

```bash
pnpm exec wrangler secret put DASHBOARD_PASSWORD
```

When prompted, enter a secure password. This password will be required to:
- Access the web dashboard
- Use the Chrome extension
- View tracking stats

**Important:** The tracking pixel endpoint (`/t/:id`) remains open so emails can load properly.

To verify: open `https://mail-tracker.YOUR-SUBDOMAIN.workers.dev` in your browser. You should be prompted for a password. Enter any username (it's ignored) and the password you just set.

---

### Part 2: Install the Chrome Extension

#### Step 1 — Open Chrome extensions page

Navigate to:
```
chrome://extensions
```

#### Step 2 — Enable Developer Mode

Toggle **Developer mode** ON (top-right corner of the page).

#### Step 3 — Load the extension

1. Click **Load unpacked**
2. Navigate to and select the `extension/` folder inside your project:
   ```
   ~/mail-tracker/extension/
   ```
3. The extension should appear in your extensions list

#### Step 4 — Pin the extension

Click the **puzzle piece icon** (Extensions) in Chrome's toolbar, then click the **pin icon** next to "Mail Tracker" so it's always visible.

#### Step 5 — Connect to your Worker

1. Click the **Mail Tracker icon** in the toolbar
2. You'll see the Settings screen asking for a server URL
3. Enter your Worker URL from Part 1:
   ```
   https://mail-tracker.YOUR-SUBDOMAIN.workers.dev
   ```
4. If you set a password in Part 1, Step 7, enter it in the **Dashboard password** field
5. Click **Save & Connect**
6. If it says "Connected!" — you're done!

**Note:** If you didn't set a password, leave the password field empty.

---

### Part 3: Usage

#### Automatic Gmail Tracking (default: ON)

Just use Gmail normally:

1. Open [Gmail](https://mail.google.com) and compose an email
2. Write your email and click **Send**
3. The extension automatically:
   - Reads the To/CC/BCC recipients
   - Creates a tracking pixel for each recipient
   - Injects the invisible pixel into the email body
   - Lets the email send normally
4. When a recipient opens the email, you'll get a Chrome notification:
   > "bob@example.com opened your email"

You can click the extension icon anytime to see:
- All tracked emails with recipient names
- Open counts and timestamps
- Detailed event logs (IP, country, device)

#### Manual Tracker Creation

For non-Gmail use (other email clients, websites, etc.):

1. Click the extension icon
2. Click **+ Manual**
3. Click a tracker to see its detail view
4. Click the **HTML Snippet** or **Tracking URL** box to copy it
5. Paste into your email HTML or webpage

#### Toggle Auto-Tracking

1. Click the extension icon
2. Click the **gear icon** (Settings)
3. Toggle **Auto-track Gmail** on or off

#### Tracking Protection

Your own opens are automatically filtered:
- **Sender IP exclusion** — when you create a tracker, your IP is stored. If you open your own email, it's not counted.
- **Bot filtering** — Gmail Image Proxy, Outlook SafeLinks, Yahoo proxy, and other email prefetchers are detected and excluded.
- **Dedup window** — duplicate loads within 5 seconds (preview panes, double-loads) are ignored.

In the extension, you'll see:
- **Real Opens** — genuine recipient opens only
- **Filtered** — count of blocked hits (your own opens + bots)
- **Sender Protection** — shows "Active" per tracker

---

## API Reference

All endpoints return JSON except `/` (HTML dashboard) and `/t/:id` (serves PNG image).

### Authentication

If you set `DASHBOARD_PASSWORD`, all endpoints except `/t/:id` require HTTP Basic Authentication:

```bash
# Example with curl
curl -u :your-password https://mail-tracker.YOUR-SUBDOMAIN.workers.dev/list
```

The username is ignored (can be empty). Only the password matters.

**Note:** The tracking pixel endpoint (`/t/:id`) is always open so emails can load the image.

### Endpoints

| Endpoint | Auth Required | Description |
|----------|:-------------:|-------------|
| `GET /` | ✓ | Web dashboard with all pixels |
| `GET /new` | ✓ | Create a new tracker. Returns `{ id, pixel, html, stats }` |
| `GET /new?to=email` | ✓ | Create tracker for a specific recipient |
| `GET /t/:id` | ✗ | Tracking endpoint — serves 1x1 PNG and records the open |
| `GET /s/:id` | ✓ | Stats for a tracker — returns `{ opens, events[], recipient, skipped, filteredEvents[], hasSenderProtection }` |
| `GET /list` | ✓ | List all pixels — returns `[{ id, opens, skipped, recipient, lastOpen }]` |
| `GET /d/:id` | ✓ | Delete a tracker — returns `{ deleted: id }` |

---

## Project Structure

```
mail-tracker/
├── src/
│   └── index.js          # Cloudflare Worker (entire backend)
├── extension/
│   ├── manifest.json      # Chrome extension manifest (v3)
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic
│   ├── background.js      # Service worker (polling & notifications)
│   ├── gmail.js           # Content script (auto-inject pixel on Gmail Send)
│   └── icons/             # Extension icons (16/48/128px)
├── wrangler.toml          # Cloudflare Workers config
├── CLAUDE.md              # AI assistant project guide
├── package.json
├── pnpm-lock.yaml
└── .gitignore
```

## Pricing & Cost Breakdown

This project runs on Cloudflare's **free tier**. For most users, you'll never pay a cent.

### Free Tier Limits

| Resource | Free Limit | Resets |
|----------|-----------|--------|
| **Worker requests** | 100,000 / day | Daily (UTC midnight) |
| **CPU time** | 10ms / request | Per request |
| **KV reads** | 100,000 / day | Daily |
| **KV writes** | 1,000 / day | Daily |
| **KV deletes** | 1,000 / day | Daily |
| **KV list operations** | 1,000 / day | Daily |
| **KV storage** | 1 GB total | — |

### What Our App Uses Per Action

| Action | Worker Requests | KV Reads | KV Writes |
|--------|:-:|:-:|:-:|
| **Send email** (create tracker) | 1 | 0 | 1 |
| **Recipient opens email** | 1 | 1 | 1 |
| **Extension polls /list** (every 60s) | 1 | N (one per tracker) | 0 |
| **View tracker stats** | 1 | 1 | 0 |
| **Delete tracker** | 1 | 0 | 0 (1 delete) |
| **Load web dashboard** | 1 | N (one per tracker) | 0 |

### Real-World Cost Estimates

**Scenario 1: Personal use (free)**
- Send ~20 tracked emails/day
- ~50 opens/day
- Extension polling: ~1,440 requests/day (once per minute)
- **Total: ~1,510 requests/day, ~70 KV writes/day**
- Well within free tier. **Cost: $0/month**

**Scenario 2: Heavy personal use (free)**
- Send ~100 tracked emails/day
- ~500 opens/day
- 200 pixels stored, extension polling reads ~200 keys per poll
- **Total: ~290,000 KV reads/day, ~600 KV writes/day**
- Still within free tier. **Cost: $0/month**

**Scenario 3: Team / power user (paid plan needed)**
- Send ~1,000+ tracked emails/day
- ~5,000+ opens/day
- Would exceed the 1,000 KV writes/day free limit
- Paid plan: **$5/month base** includes 1M KV writes/month and 10M reads/month
- That covers ~33,000 emails/day and ~330,000 opens/day
- **Cost: $5/month** (covers almost any individual or small team)

### Paid Plan Overage Rates (if you exceed included)

| Resource | Included (Paid) | Overage Cost |
|----------|-----------------|-------------|
| Worker requests | 10M / month | +$0.30 / million |
| KV reads | 10M / month | +$0.50 / million |
| KV writes | 1M / month | +$5.00 / million |
| KV deletes | 1M / month | +$5.00 / million |
| KV list ops | 1M / month | +$5.00 / million |
| KV storage | 1 GB | +$0.50 / GB-month |

### Storage Estimate

Each tracker uses ~0.5–2 KB of KV storage (depending on number of events stored, max 100 events per tracker).

| Emails tracked | Approximate storage |
|:-:|:-:|
| 100 | ~100 KB |
| 1,000 | ~1 MB |
| 10,000 | ~10 MB |
| 100,000 | ~100 MB |

You'd need to track **500,000+ trackers** to approach the 1 GB free storage limit.

### TL;DR

| Usage Level | Monthly Cost |
|------------|:--:|
| Personal (up to ~100 emails/day) | **Free** |
| Heavy personal (up to ~1,000 emails/day) | **Free** (close to limit) |
| Team / power user | **$5/month** |
| Enterprise scale | **$5 + overages** |

> Source: [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)

---

## Limitations

- **Images disabled** — if the recipient's email client blocks images by default, the pixel won't load (common in corporate Outlook)
- **Apple Mail Privacy Protection** (iOS 15+) — pre-fetches all images through Apple's proxy, so you see an open but with Apple's IP, not the recipient's real location
- **Gmail image caching** — Gmail sometimes caches images after the first load, so subsequent opens from the same person may not trigger
- **VPN/IP changes** — sender protection is IP-based, so if your IP changes between creating and viewing the email, self-opens might slip through
- **Gmail plain text mode** — if you toggle "Plain text mode" in Gmail's compose menu (three dots → Plain text mode), all HTML is stripped and tracking won't work. This is **off by default** — Gmail always sends HTML, so even a simple "hi" email will include the tracking pixel. Just don't switch to plain text mode.
- **Plain text emails (other clients)** — if you use a non-Gmail client that sends plain text only, tracking won't work since the `<img>` tag gets stripped

## License

[AGPL-3.0](LICENSE)

Free to use, share, modify, and contribute. If you modify and deploy it as a service, you must release your source code under the same license.
