# Smart Scheduling & Thread Intelligence — Design Spec

## Overview

Four interconnected features built on a shared HubSpot integration foundation: recipient timezone lookup, email scheduling with timezone optimization, smart send time learning, and a thread intelligence sidebar in Gmail.

## Feature 1: HubSpot Integration Module

### New file: `src/hubspot.js`

**`lookupRecipient(env, email)`** — queries HubSpot CRM for contact data.

```
1. GET https://api.hubapi.com/crm/v3/objects/contacts/{email}?idProperty=email&properties=city,state,country,hs_timezone,firstname,lastname,jobtitle,company
   Header: Authorization: Bearer {env.HUBSPOT_ACCESS_TOKEN}
2. If 200: return { timezone: hs_timezone, city, state, country, firstName, lastName, jobTitle, company, source: 'hubspot' }
3. If 404: return null
4. If error: return null (don't block on failures)
```

Uses HubSpot Static Auth (single account, bearer token). No OAuth flow needed.

**Secret:** `HUBSPOT_ACCESS_TOKEN` via `wrangler secret put`

### New API route: `GET /recipient/info?email=x`

Called by the extension at compose time. Runs the full lookup chain:

1. **KV cache** — check `recipient-info:{email}` (7-day TTL via KV expiration)
2. **Open history** — search all trackers for this email, extract timezone from the most recent open event's `request.cf.timezone`
3. **HubSpot CRM** — call `lookupRecipient()` for timezone + contact enrichment
4. **Domain TLD inference** — map country-code TLDs to timezones (`.co.uk` -> `Europe/London`, `.de` -> `Europe/Berlin`, `.jp` -> `Asia/Tokyo`, `.com.au` -> `Australia/Sydney`, `.in` -> `Asia/Kolkata`, `.fr` -> `Europe/Paris`, `.br` -> `America/Sao_Paulo`)
5. **Default** — fall back to the user's configured timezone (from the sequence or browser)

Returns:
```json
{
  "timezone": "America/New_York",
  "city": "New York",
  "state": "New York",
  "country": "US",
  "firstName": "Alice",
  "lastName": "Smith",
  "company": "Acme Corp",
  "jobTitle": "VP Engineering",
  "source": "hubspot",
  "optimalSendTime": { "hour": 10, "confidence": "medium", "source": "domain", "sampleSize": 8 }
}
```

**Caching:** Result cached at `recipient-info:{email}` with 7-day TTL to avoid hitting HubSpot rate limits (5 req/sec). Cache is per-email, invalidated on TTL expiry.

### TLD Timezone Map

Embedded in `hubspot.js` as a simple object:
```javascript
const TLD_TIMEZONES = {
  'co.uk': 'Europe/London', 'org.uk': 'Europe/London', 'uk': 'Europe/London',
  'de': 'Europe/Berlin', 'fr': 'Europe/Paris', 'es': 'Europe/Madrid',
  'it': 'Europe/Rome', 'nl': 'Europe/Amsterdam', 'be': 'Europe/Brussels',
  'at': 'Europe/Vienna', 'ch': 'Europe/Zurich', 'se': 'Europe/Stockholm',
  'no': 'Europe/Oslo', 'dk': 'Europe/Copenhagen', 'fi': 'Europe/Helsinki',
  'pl': 'Europe/Warsaw', 'pt': 'Europe/Lisbon', 'ie': 'Europe/Dublin',
  'jp': 'Asia/Tokyo', 'kr': 'Asia/Seoul', 'cn': 'Asia/Shanghai',
  'in': 'Asia/Kolkata', 'sg': 'Asia/Singapore', 'hk': 'Asia/Hong_Kong',
  'tw': 'Asia/Taipei', 'th': 'Asia/Bangkok', 'my': 'Asia/Kuala_Lumpur',
  'au': 'Australia/Sydney', 'com.au': 'Australia/Sydney', 'nz': 'Pacific/Auckland',
  'br': 'America/Sao_Paulo', 'mx': 'America/Mexico_City', 'ar': 'America/Argentina/Buenos_Aires',
  'ca': 'America/Toronto', 'za': 'Africa/Johannesburg', 'il': 'Asia/Jerusalem',
  'ae': 'Asia/Dubai', 'ru': 'Europe/Moscow', 'tr': 'Europe/Istanbul',
};
```

## Feature 2: Email Scheduling with Timezone Optimization

### Extension UI (gmail.js)

The sequence selector dropdown (paper airplane + clock icon) gains a new section at the top:

**Schedule Send section:**
- **"Optimize for recipient"** — shows detected timezone (e.g., "US Eastern via HubSpot") with an estimated send time (e.g., "10am ET Tuesday"). One click to confirm. The time comes from the smart send time optimizer (Feature 3).
- **"Pick date & time"** — manual date picker, time picker, timezone selector dropdown
- **"Send now"** — existing behavior, sends immediately
- Divider
- Existing template selection and one-off builder below

**Timezone display:** When the schedule panel opens, the extension calls `GET /recipient/info?email=x`. The panel shows:
- "alice@acme.com — US Eastern (HubSpot)" with green indicator
- Or "alice@acme.com — US Pacific (inferred from .co.uk)" with yellow indicator
- Or "alice@acme.com — Your timezone (default)" with gray indicator

User can override timezone before confirming.

### Scheduled Email Flow

When "Optimize" or "Pick time" is chosen:
1. gmail.js intercepts Send as usual, creates tracker pixel
2. Instead of letting Gmail send, it captures the full email content (to, cc, bcc, subject, body HTML)
3. POSTs to new `POST /scheduled` endpoint on the Worker
4. Prevents the actual Gmail send (removes the compose window)
5. Shows toast: "Scheduled for 10:00 AM ET, Tue Mar 27"

### New KV prefix: `scheduled:{id}`

```json
{
  "id": "sched:abc123",
  "to": "alice@acme.com",
  "cc": "",
  "bcc": "244685237@bcc.na2.hubspot.com",
  "subject": "Partnership proposal",
  "body": "<html>full email body with tracking pixel</html>",
  "scheduledAt": "2026-03-27T14:00:00Z",
  "recipientTimezone": "America/New_York",
  "timezoneSource": "hubspot",
  "trackerId": "a1b2c3d4",
  "sequenceId": "seq:xyz789",
  "status": "pending",
  "createdAt": "2026-03-26T..."
}
```

### New API routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/scheduled` | POST | Yes | Create a scheduled email |
| `/scheduled` | GET | Yes | List scheduled emails (filterable by status) |
| `/scheduled/:id` | DELETE | Yes | Cancel a scheduled email |

### Cron addition

The existing 5-minute cron handler also checks `scheduled:*` keys for due emails (`scheduledAt <= now` and `status === 'pending'`). Sends via Gmail API with full headers (To, Cc, Bcc, Subject, Body, In-Reply-To if threading). Updates status to `sent` with `sentAt` timestamp.

### Smart time selection for "Optimize"

Uses `getOptimalSendTime()` from Feature 3 to pick the hour. Then:
- Find the next occurrence of that hour in the recipient's timezone on a business day
- If it's currently before that hour today (and today is a weekday), schedule for today
- If it's past that hour today, schedule for next business day
- Skip weekends

## Feature 3: Smart Send Time Optimization

### New function: `getOptimalSendTime(env, email, timezone)`

Located in `src/hubspot.js` (alongside the other recipient intelligence).

**Cascading lookup:**

**Level 1 — Per-recipient** (confidence: high):
- Search all trackers for this specific email
- Collect all open event timestamps
- Convert to recipient's local timezone
- Bucket by hour-of-day (0-23)
- Find the hour with the most opens
- Requires at least 3 opens to be meaningful

**Level 2 — Per-domain** (confidence: medium):
- If <3 per-recipient opens, extract domain from email
- Search all trackers for any recipient at the same domain
- Same bucketing logic
- Requires at least 5 opens across the domain

**Level 3 — Global** (confidence: low):
- If <5 domain opens, use ALL open events across all trackers
- Bucket by hour-of-day in the recipient's timezone
- Always has data once tracking has been running

**Fallback** (confidence: default):
- If zero open data, default to 9:00 AM in recipient's local timezone

**Returns:**
```json
{
  "hour": 10,
  "dayOfWeek": null,
  "confidence": "medium",
  "source": "domain",
  "sampleSize": 8
}
```

**Integration points:**
1. `GET /recipient/info` includes `optimalSendTime` in the response
2. "Optimize for recipient" in the schedule panel uses this hour
3. `computeScheduledAt` in sequence scheduling can optionally use this instead of the 9am default (future enhancement)
4. Analytics page shows "Best send times" data per template

### Performance

This scans tracker events at request time. For <500 trackers with <100 events each, this is fast enough. No pre-computation or indexing needed.

## Feature 4: Thread Intelligence Sidebar

### Icon injection

When viewing sent emails (in thread view or sent folder), the extension injects a small blue info icon (ℹ) next to tracked emails. The icon appears:
- In the sent folder list — next to the ✓/✓✓ checkmark indicators
- In thread view — in the email header area near reply/forward buttons
- Only for emails with a matching tracker (detected via `/list` data match on recipient + subject)

### Compact card (default on click)

Floating panel (~300px wide), white background, anchored near the icon:

- **Open count** — large number with "opens" label
- **Last open** — relative time + city, state, country (e.g., "2h ago -- San Francisco, CA")
- **Device** — parsed browser/OS/device (e.g., "Chrome on macOS (Desktop)")
- **Sequence status** — badge: "Step 2/3 -- Active" or "Complete" or "No sequence"
- **Recipient info** — from HubSpot/cache: company name, job title
- **"View full details"** link to expand

### Expanded view (click "View full details")

Panel expands to ~400px:

- **Full event timeline** — every open with timestamp, location, device, ISP
- **Sequence step progress** — visual dots with sent/pending/skipped states and dates
- **Open by hour** — mini horizontal bar chart showing which hours this recipient opens
- **"Open in dashboard"** link → opens `/s/{trackerId}` in new tab

### Styling

Light theme matching Gmail: white background (#fff), border (#dadce0), border-radius 12px, shadow. Same style as the spam checker panel.

### Data flow

1. Extension calls `GET /s/{trackerId}?format=json` for tracker + event data
2. Calls `GET /recipient/info?email=x` for HubSpot enrichment
3. Calls `GET /sequences/{seqId}` for sequence step progress (if sequence exists)
4. All rendered client-side with DOM APIs

## New Files

| File | Purpose |
|------|---------|
| `src/hubspot.js` | HubSpot CRM lookup, TLD timezone inference, optimal send time calculation |

## Modified Files

| File | Changes |
|------|---------|
| `src/index.js` | Add `/recipient/info`, `/scheduled` routes |
| `src/cron.js` | Add scheduled email sending to cron handler |
| `extension/gmail.js` | Schedule send UI in dropdown, thread intelligence sidebar injection + panels |

## Secrets

| Secret | Purpose |
|--------|---------|
| `HUBSPOT_ACCESS_TOKEN` | HubSpot Static Auth bearer token |

## Constraints

- No npm runtime deps — HubSpot is a single `fetch()` call with bearer token
- KV caching for HubSpot results (7-day TTL) to stay within rate limits
- Smart send time analysis runs inline (no background jobs) — acceptable for <500 trackers
- Thread intelligence panel uses DOM APIs only (no innerHTML with external data)
- Scheduled emails sent via Gmail API (same mechanism as follow-ups)
- Extension UI matches Gmail's light theme for the panels
