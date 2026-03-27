# Drip Sequencing & Follow-up Automation — Design Spec

## Overview

Auto-drip follow-up sequencing for mail-tracker. Users write a manual first email in Gmail, select a follow-up sequence (reusable template or one-off), and follow-up emails are sent automatically on a schedule via the Gmail API. Follow-ups thread naturally in Gmail, come from the user's real address, and fire on schedule even with the browser closed.

## Architecture Decision

**Approach B: Modular Worker with new KV namespace.** New modules added to the existing Worker (`src/sequences.js`, `src/gmail-api.js`, etc.) with a second KV namespace (`SEQUENCES`) for sequence and template data. Single Worker deployment, single `wrangler.toml`. Follows existing project conventions.

## Data Model

All sequence data stored in the `SEQUENCES` KV namespace with prefixed keys.

### Sequence Templates (`tmpl:` prefix)

```json
{
  "id": "tmpl:abc12345",
  "name": "Sales Follow-up",
  "steps": [
    {
      "delayDays": 2,
      "subject": "Re: {{subject}}",
      "body": "<p>Hi {{firstName}},</p><p>Just following up...</p>",
      "stopOn": ["reply"]
    },
    {
      "delayDays": 5,
      "subject": "Re: {{subject}}",
      "body": "<p>{{firstName}}, wanted to bump this...</p>",
      "stopOn": ["reply", "open"]
    }
  ],
  "timezone": "America/New_York",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### Active Sequences (`seq:` prefix)

```json
{
  "id": "seq:xyz78901",
  "templateId": "tmpl:abc12345",
  "trackerId": "a1b2c3d4",
  "recipient": "bob@example.com",
  "threadId": "gmail-thread-id",
  "originalMessageId": "gmail-message-id",
  "timezone": "America/New_York",
  "currentStep": 0,
  "status": "active",
  "steps": [
    {
      "delayDays": 2,
      "subject": "Re: {{subject}}",
      "body": "<p>Hi {{firstName}},</p>...",
      "stopOn": ["reply"],
      "scheduledAt": "ISO-8601",
      "sentAt": null,
      "sentMessageId": null,
      "status": "pending",
      "retryCount": 0,
      "failedReason": null
    }
  ],
  "variables": {
    "firstName": "Bob",
    "subject": "Partnership Opportunity",
    "originalBody": "Hi Bob, I wanted to reach out about..."
  },
  "stoppedAt": null,
  "stoppedReason": null,
  "createdAt": "ISO-8601"
}
```

Steps are denormalized (copied from template at creation time) so editing a template does not affect in-flight sequences.

**`delayDays` semantics:** Always relative to the original email send time, not the previous step. So if step 1 has `delayDays: 2` and step 2 has `delayDays: 5`, step 1 fires 2 days after the original email and step 2 fires 5 days after the original email.

### Gmail OAuth Tokens (`oauth:tokens`)

```json
{
  "access_token": "ya29...",
  "refresh_token": "1//...",
  "expires_at": 1711382400000,
  "email": "you@gmail.com"
}
```

### Sequence Analytics (`analytics:` prefix)

Per-template aggregate stats, updated after each send/open/reply event:

```json
{
  "templateId": "tmpl:abc12345",
  "totalSequences": 50,
  "completedSequences": 30,
  "stoppedSequences": 12,
  "steps": [
    { "sent": 50, "opened": 35, "replied": 20, "openRate": 0.70, "replyRate": 0.40 },
    { "sent": 30, "opened": 18, "replied": 8, "openRate": 0.60, "replyRate": 0.27 }
  ],
  "updatedAt": "ISO-8601"
}
```

### Auxiliary Keys

- `oauth:state:{nonce}` — CSRF nonce for OAuth flow (TTL 10 minutes)
- `cron:lock` — cron overlap prevention (TTL 5 minutes)
- `cron:lastReplyCheck` — timestamp of last reply-check run
- `cron:lastProcessedKey` — cursor for batched cron processing
- `tracker-seq:{trackerId}` — reverse index mapping tracker to active sequence ID

## New Source Files

```
src/
├── sequences.js      # Sequence lifecycle: create, advance, stop, status
├── templates.js      # Template CRUD
├── gmail-api.js      # OAuth token management, send email, check thread replies
├── cron.js           # Cron handler: send due follow-ups, check for replies
├── variables.js      # Variable substitution engine
└── views/
    ├── sequences.js  # Sequence management page
    ├── templates.js  # Template management page
    └── analytics.js  # Per-template performance dashboard
```

Existing files modified: `index.js` (router), `shared.js` (new KV binding), `notifications.js` (sequence events), `views/dashboard.js` (sequence badges), `views/detail.js` (sequence section).

## API Routes

### Template Management

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/templates` | GET | Yes | List all sequence templates |
| `/templates` | POST | Yes | Create template `{ name, steps[], timezone }` |
| `/templates/:id` | GET | Yes | Get single template |
| `/templates/:id` | PUT | Yes | Update template |
| `/templates/:id` | DELETE | Yes | Delete template (analytics entries retained for historical data) |

### Sequence Management

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/sequences` | GET | Yes | List sequences (filterable `?status=active\|stopped\|completed`) |
| `/sequences` | POST | Yes | Create sequence `{ templateId?, trackerId, recipient, steps[]?, variables, timezone }` |
| `/sequences/:id` | GET | Yes | Get sequence with step statuses |
| `/sequences/:id` | DELETE | Yes | Cancel/stop a sequence |
| `/sequences/:id/skip` | POST | Yes | Skip current step, advance to next |

### OAuth

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/oauth/url` | GET | Yes | Generate Google OAuth consent URL |
| `/oauth/callback` | GET | No | OAuth redirect — exchanges code for tokens |
| `/oauth/status` | GET | Yes | Check OAuth connection status |
| `/oauth/disconnect` | POST | Yes | Remove stored tokens |

### Analytics

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/analytics/templates` | GET | Yes | List per-template performance stats |
| `/analytics/templates/:id` | GET | Yes | Step-by-step analytics for one template |

## Gmail OAuth Flow

### Prerequisites

Google Cloud project with Gmail API enabled and OAuth 2.0 client ID (Web application). Secrets stored via `wrangler secret put`:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Redirect URI: `https://<worker-url>/oauth/callback`

### Scopes

- `https://www.googleapis.com/auth/gmail.send` — send follow-ups
- `https://www.googleapis.com/auth/gmail.readonly` — check threads for replies

### Flow

1. User clicks "Connect Gmail" in dashboard or extension
2. `GET /oauth/url` returns Google consent URL with `state` nonce (stored in KV with 10-min TTL)
3. User grants permissions at Google
4. Google redirects to `GET /oauth/callback?code=XXX&state=YYY`
5. Worker validates `state` against stored nonce, exchanges `code` for tokens
6. Tokens stored in KV as `oauth:tokens`
7. User redirected to dashboard with success indicator

### Token Management

- Access tokens refreshed inline before Gmail API calls when `expires_at < now + 60s`
- Refresh via POST to `https://oauth2.googleapis.com/token`
- If refresh fails (token revoked): all active sequences set to `paused`, `oauth:error` key set in KV, webhook notification sent
- Dashboard and extension show warning when `oauth:error` exists

### Sending Follow-ups

Build RFC 2822 MIME message with `In-Reply-To` and `References` headers plus `threadId` to ensure follow-ups thread in the same Gmail conversation. Base64url encode, POST to Gmail API `messages/send` endpoint.

### Checking Replies

GET thread from Gmail API, look for messages after the last known message from a different sender. Returns `{ hasReply, replyAt }`.

## Cron Handler

### Configuration

```toml
[triggers]
crons = ["*/5 * * * *"]
```

`scheduled` event in `index.js` delegates to `cron.js`.

### Job 1: Send Due Follow-ups (every 5 min)

1. Acquire `cron:lock` (skip if locked)
2. List `seq:*` keys, resume from `cron:lastProcessedKey` if set
3. For each active sequence with a due step (`scheduledAt <= now`, `status === "pending"`):
   a. Check stop conditions — "open": look up tracker opens; "reply": check cached reply status
   b. If stopped: update sequence status, notify via webhook
   c. If not stopped: substitute variables, send via Gmail API, update step status, advance sequence, update analytics, notify via webhook
4. Release `cron:lock`

### Job 2: Check for Replies (every 15 min)

1. Check `cron:lastReplyCheck` — skip if < 15 min ago
2. For active sequences with `stopOn` including `"reply"`, call Gmail API to check thread
3. If reply found: stop sequence, update analytics, notify via webhook
4. Update `cron:lastReplyCheck`

### Batching

30-second execution limit on cron. If many sequences are due, process in batches using a `cron:lastProcessedKey` cursor. Next cron invocation picks up where the last left off.

### Retry Policy

Steps track `retryCount`. After 3 consecutive failures, step marked `failed` with error reason, sequence advances to next step (or completes).

## Sequence Lifecycle

```
        create
          |
          v
      [active] --- step sent ---> [active] (next step)
          |                            |
          |                            |
    stop condition met           last step sent
          |                            |
          v                            v
      [stopped]                  [completed]

    manual cancel from any state ---> [stopped]
    oauth failure ---> [paused] --- oauth fixed ---> [active]
```

### Open-detection Integration

When `/t/:id` records a real open, it checks the `tracker-seq:{trackerId}` reverse index. If an active sequence exists and the current step has `stopOn: ["open"]`, the sequence is stopped immediately (no need to wait for cron).

## Timezone Handling

### Send Window

`delayDays` is computed as calendar days in the sequence's timezone, clamped to an 8:00 AM – 6:00 PM send window:

1. Take original email send time, convert to sequence timezone
2. Add `delayDays` calendar days
3. If result falls outside 8am–6pm window, snap to 9:00 AM next eligible day
4. Convert to UTC, store as `scheduledAt`

Example: Email sent 11:00 PM ET Monday, step `delayDays: 1` → Tuesday 11 PM is outside window → snaps to Wednesday 9:00 AM ET.

### Implementation

`computeScheduledAt(createdAt, delayDays, timezone)` in `sequences.js` uses `Intl.DateTimeFormat` for timezone conversion (available natively in Workers V8 runtime).

### Display

Sequence timestamps shown in the sequence's configured timezone (not viewer-local) so the user sees send times in the timezone they chose.

### Timezone Selector

Searchable dropdown of IANA timezone names from `Intl.supportedValuesOf('timeZone')`. Defaults to browser's detected timezone.

## Variable Substitution

### Built-in Variables

| Variable | Source |
|----------|--------|
| `{{firstName}}` | Provided explicitly, or derived: split email local part on `.`, capitalize first segment (e.g., `bob.smith@example.com` → `Bob`) |
| `{{recipient}}` | Full email address |
| `{{subject}}` | Original email subject |
| `{{originalBody}}` | Body preview from initial email |
| `{{daysSince}}` | Days since original email sent |
| `{{stepNumber}}` | Current step number (1-indexed) |

Custom variables passed at sequence creation in the `variables` object.

### Engine

Single regex pass in `variables.js`: `/\{\{(\w+)\}\}/g`. Unknown variables left as-is (not stripped) so misconfiguration is visible.

## Extension UI Changes

### Gmail Compose — Sequence Selector

Injected next to Send button:
```
[Send] [sequence-icon No sequence v]
```

Dropdown options: saved templates (with step count), "+ One-off follow-up..." option. Selecting a template updates the label. One-off option opens inline step builder below compose.

On Send: existing pixel creation flow + POST to `/sequences` if a sequence is selected.

### Extension Popup — New Tabs

**Sequences tab:** List active/recent sequences by status. Each shows recipient, template name, progress ("Step 2/3"), next send time. Expandable step timeline. Cancel and skip-step actions.

**Templates tab:** List saved templates with step count and usage stats. CRUD form: name, timezone selector, step builder (delay, subject, body, stop conditions), reorder.

### Extension Settings

New "Gmail Connected" indicator with Connect/Disconnect button. "Connect Gmail" opens `/oauth/url` in new tab.

## Dashboard Changes

**Main page:** Tracker cards with active sequences show badge ("Step 2/3" or "Sequence complete"). "Sequences" nav link.

**Tracker detail:** New "Sequence" section with template name, step progress timeline, cancel/skip buttons.

**New pages:**
- `/sequences` — sequence list with status filtering
- `/templates` — template management CRUD
- `/analytics` — per-template funnel chart, per-step stats table (sent, opened, open rate, replied, reply rate), overall totals

## Security

- Refresh token stored in KV (encrypted at rest by Cloudflare)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as Wrangler secrets
- OAuth `state` nonce validated on callback (CSRF prevention), stored with 10-min KV TTL
- Token refresh failure → pause all sequences, set `oauth:error`, notify via webhook
- `/oauth/callback` unauthenticated (Google redirects here) but validates `state` nonce

## Error Handling

### Gmail API Errors

| Error | Action |
|-------|--------|
| 401 Unauthorized | Refresh token, retry once, if still fails pause sequences + notify |
| 403 Rate limit | Leave step pending, retry next cron cycle |
| 400 Bad request | Mark step failed, log reason, advance to next step |
| 404 Thread not found | Mark step failed (thread deleted) |
| Network timeout / 5xx | Leave step pending, retry next cycle |

### Data Integrity

- Write `sentMessageId` to KV before advancing `currentStep` — enables idempotent recovery if cron crashes mid-send
- `cron:lock` key with 5-min TTL prevents overlapping cron runs
- Steps with `sentMessageId` but status still `pending` are recovered on next cron cycle

### Webhook Notifications for Sequence Events

- Follow-up sent successfully
- Sequence completed
- Sequence stopped (by open or reply)
- Step failed (after 3 retries)
- OAuth token expired/revoked

## Input Validation

- Template name: max 100 chars
- Step body: max 50,000 chars
- Step subject: max 500 chars
- `delayDays`: integer, 1–90
- Max steps per template/sequence: 10
- Max active sequences: 500
- Variable keys: `\w+` only, values max 1,000 chars
- Timezone: validated against `Intl.supportedValuesOf('timeZone')`

## Wrangler Config Changes

```toml
[[kv_namespaces]]
binding = "SEQUENCES"
id = "your-sequences-kv-namespace-id"

[triggers]
crons = ["*/5 * * * *"]
```

New secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## v1 Scope

- Gmail OAuth flow (extension consent → token stored in Worker KV)
- Cron trigger for checking due follow-ups and sending via Gmail API
- Sequence templates (CRUD on dashboard + selection in extension)
- One-off follow-ups at compose time
- Rich text with variable substitution
- Configurable stop conditions per step (open, reply, manual)
- Periodic thread monitoring for reply detection (~15 min)
- Sequence status visible in dashboard and extension
- Timezone-aware scheduling with 8am–6pm send window
- Per-template analytics with step-by-step open/reply rates

## Deferred to v2

- A/B testing follow-up variants
- Conditional branching (if opened → send X, if not → send Y)
- Bulk sequence assignment (apply to past emails)
- Customizable send windows per template
- Weekday-only sending option
