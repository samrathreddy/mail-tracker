# Smart Scheduling & Thread Intelligence Implementation Plan

**Progress (2026-03-26):** Tasks 1–5 are implemented in the repo. `pnpm lint` passes with zero ESLint errors (no project test runner). `src/gmail-api.js` supports optional `Cc` on scheduled sends. Remaining operator-only steps: set `HUBSPOT_ACCESS_TOKEN`, run `pnpm run deploy`, and run the manual QA checklist in Task 6.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HubSpot-powered recipient timezone lookup, timezone-optimized email scheduling, smart send time learning from open data, and a thread intelligence sidebar in Gmail.

**Architecture:** A new `src/hubspot.js` module handles HubSpot CRM lookup, TLD timezone inference, and optimal send time calculation. New `/recipient/info` and `/scheduled` API routes serve the extension. The cron handler gains scheduled email sending. The Gmail extension's sequence selector dropdown adds scheduling options and a new thread intelligence icon appears on tracked sent emails.

**Tech Stack:** Cloudflare Workers (V8), HubSpot CRM REST API (static auth), vanilla JS, Chrome Extension MV3

**Spec:** `docs/superpowers/specs/2026-03-26-smart-scheduling-intelligence-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/hubspot.js` | HubSpot CRM lookup, TLD timezone map, optimal send time calculation, recipient info aggregation |

### Existing files to modify

| File | Changes |
|------|---------|
| `src/index.js` | Add `/recipient/info`, `/scheduled` routes, import hubspot module |
| `src/cron.js` | Add `sendDueScheduledEmails` function, call it from `handleCron` |
| `extension/gmail.js` | Schedule send UI in dropdown, thread intelligence sidebar, recipient timezone display |

---

## Task 1: HubSpot Integration Module

**Files:**
- Create: `src/hubspot.js`

- [x] **Step 1: Create `src/hubspot.js`**

Create the module with three exports:

**`lookupRecipient(env, email)`** — queries HubSpot CRM:
- `GET https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email&properties=city,state,country,hs_timezone,firstname,lastname,jobtitle,company`
- Header: `Authorization: Bearer ${env.HUBSPOT_ACCESS_TOKEN}`
- Returns `{ timezone, city, state, country, firstName, lastName, jobTitle, company, source: 'hubspot' }` on 200
- Returns `null` on 404 or any error (never blocks on HubSpot failures)

**`inferTimezoneFromTLD(email)`** — maps email domain TLD to timezone:
- Extract TLD from email domain (e.g., `alice@acme.co.uk` → `co.uk`)
- Look up in TLD_TIMEZONES map (embedded dictionary with ~35 entries covering major country TLDs)
- Returns `{ timezone, source: 'tld' }` or `null`

**`getOptimalSendTime(env, email, timezone)`** — cascading open-time analysis:
- Level 1: Per-recipient — scan all trackers for this email, collect open timestamps, bucket by hour in recipient's timezone. Needs ≥3 opens.
- Level 2: Per-domain — scan all trackers for anyone at same domain. Needs ≥5 opens.
- Level 3: Global — all open events across all trackers, bucketed by hour in recipient's timezone.
- Fallback: returns `{ hour: 9, confidence: 'default', source: 'default', sampleSize: 0 }`
- Each level: convert event timestamps to recipient's local hour using `Intl.DateTimeFormat`, find the hour with the most opens.
- Returns `{ hour, confidence, source, sampleSize }`

**`getRecipientInfo(env, email, defaultTimezone)`** — the main aggregation function called by the API route:
1. Check KV cache `recipient-info:{email}` — return if found
2. Search trackers for open history timezone (`request.cf.timezone` from events)
3. Call `lookupRecipient()` for HubSpot data
4. Call `inferTimezoneFromTLD()` as fallback
5. Default to `defaultTimezone`
6. Call `getOptimalSendTime()` with the resolved timezone
7. Merge all data, cache in KV with 7-day TTL (`expirationTtl: 604800`)
8. Return the merged result

The tracker scanning for open history and optimal send time requires iterating `env.TRACKER.list()` and checking events. Use the same `listAllKeys` pagination pattern from `cron.js` if needed.

- [x] **Step 2: Verify module loads**

Run: `node -e "import('./src/hubspot.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'lookupRecipient', 'inferTimezoneFromTLD', 'getOptimalSendTime', 'getRecipientInfo' ]`

- [x] **Step 3: Commit**

```bash
git add src/hubspot.js
git commit -m "feat: add HubSpot integration module with timezone lookup and smart send time"
```

---

## Task 2: Recipient Info & Scheduled Email API Routes

**Files:**
- Modify: `src/index.js`

- [x] **Step 1: Add import and routes**

Add import at top of `src/index.js`:
```javascript
import { getRecipientInfo } from './hubspot.js';
```

Add these routes before the analytics routes:

**`GET /recipient/info?email=x`** — recipient timezone + enrichment lookup:
```javascript
if (url.pathname === '/recipient/info' && request.method === 'GET') {
  if (!checkAuth(request, env)) return requireAuthCors();
  const email = url.searchParams.get('email');
  if (!email) return json({ error: 'email parameter required' }, 400);
  const defaultTz = url.searchParams.get('defaultTimezone') || 'America/New_York';
  const info = await getRecipientInfo(env, email, defaultTz);
  return json(info);
}
```

**`POST /scheduled`** — create a scheduled email:
```javascript
if (url.pathname === '/scheduled' && request.method === 'POST') {
  if (!checkAuth(request, env)) return requireAuthCors();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body.to || !body.subject || !body.body || !body.scheduledAt) {
    return json({ error: 'to, subject, body, and scheduledAt are required' }, 400);
  }
  const id = `sched:${crypto.randomUUID().slice(0, 8)}`;
  const scheduled = {
    id, to: body.to, cc: body.cc || '', bcc: body.bcc || '',
    subject: body.subject, body: body.body,
    scheduledAt: body.scheduledAt,
    recipientTimezone: body.recipientTimezone || null,
    timezoneSource: body.timezoneSource || null,
    trackerId: body.trackerId || null,
    sequenceId: body.sequenceId || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await env.SEQUENCES.put(id, JSON.stringify(scheduled));
  return json(scheduled, 201);
}
```

**`GET /scheduled`** — list scheduled emails:
```javascript
if (url.pathname === '/scheduled' && request.method === 'GET') {
  if (!checkAuth(request, env)) return requireAuthCors();
  const keys = await env.SEQUENCES.list({ prefix: 'sched:' });
  const items = await Promise.all(keys.keys.map(k => env.SEQUENCES.get(k.name, 'json')));
  return json(items.filter(Boolean));
}
```

**`DELETE /scheduled/:id`** — cancel a scheduled email:
```javascript
if (url.pathname.match(/^\/scheduled\/sched:[a-f0-9]+$/) && request.method === 'DELETE') {
  if (!checkAuth(request, env)) return requireAuthCors();
  const id = url.pathname.split('/scheduled/')[1];
  const existing = await env.SEQUENCES.get(id, 'json');
  if (!existing) return json({ error: 'Not found' }, 404);
  if (existing.status === 'sent') return json({ error: 'Already sent' }, 400);
  await env.SEQUENCES.delete(id);
  return json({ deleted: id });
}
```

- [x] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [x] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: add recipient info and scheduled email API routes"
```

---

## Task 3: Scheduled Email Sending in Cron

**Files:**
- Modify: `src/cron.js`

- [x] **Step 1: Add `sendDueScheduledEmails` function and wire it into `handleCron`**

Import `sendFollowUp` is already imported. Add the new function after `maybeCheckReplies`:

```javascript
async function sendDueScheduledEmails(env) {
  const { error: authError } = await getAccessToken(env);
  if (authError) return; // Can't send without OAuth

  const allKeys = await listAllKeys(env.SEQUENCES, 'sched:');
  const now = Date.now();

  for (const key of allKeys) {
    const scheduled = await env.SEQUENCES.get(key.name, 'json');
    if (!scheduled || scheduled.status !== 'pending') continue;

    const scheduledTime = new Date(scheduled.scheduledAt).getTime();
    if (scheduledTime > now) continue;

    // Send via Gmail API
    const result = await sendFollowUp(env, {
      to: scheduled.to,
      subject: scheduled.subject,
      body: scheduled.body,
      threadId: null,
      inReplyTo: null,
      bcc: scheduled.bcc || null,
    });

    if (result.error) {
      console.error('Scheduled email send failed:', result.error);
      // Leave as pending, will retry next cycle
      continue;
    }

    // Mark as sent
    scheduled.status = 'sent';
    scheduled.sentAt = new Date().toISOString();
    scheduled.sentMessageId = result.messageId;
    await env.SEQUENCES.put(key.name, JSON.stringify(scheduled));
  }
}
```

In `handleCron`, add the call after `maybeCheckReplies`:
```javascript
await sendDueScheduledEmails(env);
```

- [x] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [x] **Step 3: Commit**

```bash
git add src/cron.js
git commit -m "feat: add scheduled email sending to cron handler"
```

---

## Task 4: Schedule Send UI in Gmail Extension

**Files:**
- Modify: `extension/gmail.js`

This is the largest task — adding the schedule send panel to the sequence selector dropdown.

- [x] **Step 1: Add schedule send section to the sequence selector dropdown**

In `injectSequenceSelector`, after the dropdown div is created but before the template options are added, insert the schedule send section:

**Schedule section at top of dropdown:**
1. Section header: "SCHEDULE SEND" (small label)
2. **"Optimize for recipient"** option — on click:
   - Calls `GET /recipient/info?email=<recipient>` (gets recipient from compose form)
   - Shows timezone + optimal time: "10 AM ET Tuesday (via HubSpot)"
   - One more click to confirm → captures email content, POSTs to `/scheduled`, prevents Gmail send, shows toast
3. **"Pick date & time"** option — on click:
   - Shows inline date input + time input + timezone select
   - Confirm button → same flow as optimize
4. **"Send now"** option — dismisses dropdown, lets normal send proceed
5. Divider line
6. Then existing template options below

**Recipient timezone fetch:**
When the dropdown opens and has recipients, call the API:
```javascript
var recipientEmails = getRecipients(composeForm);
if (recipientEmails.length > 0) {
  fetch(serverUrl + '/recipient/info?email=' + encodeURIComponent(recipientEmails[0]), { headers })
    .then(r => r.ok ? r.json() : null)
    .then(info => { /* update the optimize option with timezone + time */ });
}
```

**Send interception for scheduled emails:**
In `processCompose`, if a schedule time was selected (stored as `data-scheduled-at` on the dropdown button), instead of letting Gmail send:
1. Capture full email: to, cc, bcc (including HubSpot BCC), subject, body HTML
2. POST to `/scheduled` with `scheduledAt` and `recipientTimezone`
3. Close the compose window: `composeForm.querySelector('[aria-label*="Discard"]')?.click()` or similar
4. Show toast: "Scheduled for 10:00 AM ET, Tue Mar 27"
5. Return without calling the original send click

**Timezone display in optimize option:**
- Green dot + "US Eastern (HubSpot)" if source is 'hubspot'
- Yellow dot + "US Pacific (inferred)" if source is 'tld' or 'open_history'
- Gray dot + "Your timezone" if source is 'default'

All UI built with DOM APIs (createElement/textContent).

- [x] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [x] **Step 3: Commit**

```bash
git add extension/gmail.js
git commit -m "feat: add schedule send UI with timezone optimization to Gmail compose"
```

---

## Task 5: Thread Intelligence Sidebar

**Files:**
- Modify: `extension/gmail.js`

- [x] **Step 1: Add thread intelligence icon and sidebar panel**

**Icon injection:**
Add a new function `injectThreadIntelligence()` that runs periodically (via the existing `setInterval`):
- When in sent folder or viewing a thread, find email rows/headers for tracked emails
- For each tracked email (matched via `/list` data), inject a small blue ℹ icon
- Icon is 16x16, positioned near the checkmark indicators or reply/forward buttons
- Use `data-thread-intel` attribute to avoid duplicate injection

**Compact card (on icon click):**
Create `showThreadIntelCard(trackerData, recipientInfo, anchorEl)`:
- Floating panel ~300px wide, white background (Gmail light theme)
- Open count (large number)
- Last open: relative time + city, state, country
- Device: browser on OS (device type)
- Sequence status badge (if sequence exists)
- Recipient info: company, job title (from `/recipient/info` cache)
- "View full details" link

**Expanded view (on "View full details" click):**
Create `expandThreadIntelCard(panel, trackerData, recipientInfo)`:
- Panel grows to ~400px
- Full event timeline: each open as a row (time, location, device, ISP)
- Sequence step progress: visual dots
- Open by hour: mini bar chart (horizontal bars for each hour, proportional to count)
- "Open in dashboard" link → `serverUrl + '/s/' + trackerId`

**Data fetching:**
On icon click:
1. `GET /s/{trackerId}?format=json` → tracker stats + events
2. `GET /recipient/info?email=x` → HubSpot enrichment + optimal time
3. If tracker has a sequence: `GET /sequences/{seqId}` → step progress

All built with DOM APIs. Light theme styling matching the spam checker panel.

**Integration with existing sent folder code:**
The existing `addInboxReadIndicators()` already iterates sent email rows. Add the ℹ icon injection there, right after the ✓/✓✓ indicator.

- [x] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [x] **Step 3: Commit**

```bash
git add extension/gmail.js
git commit -m "feat: add thread intelligence sidebar with compact and expanded views"
```

---

## Task 6: Final Lint and Verification

**Files:**
- All modified files

- [x] **Step 1: Run lint**

Run: `pnpm lint`
Fix all errors.

- [ ] **Step 2: Set up HubSpot secret** *(operator / deployment environment)*

Run: `pnpm exec wrangler secret put HUBSPOT_ACCESS_TOKEN`
Enter your HubSpot Static Auth access token.

- [ ] **Step 3: Deploy and test** *(operator)*

Run: `pnpm run deploy`

Test:
- Visit `/recipient/info?email=someone@known-contact.com` — should return HubSpot data
- Create a scheduled email via the Gmail dropdown
- Verify it appears in `/scheduled` list
- Wait for cron to fire and send it
- Click ℹ icon on a tracked sent email — verify compact card shows data
- Expand to full view — verify timeline and sequence status

- [ ] **Step 4: Commit any fixes** *(optional after QA)*

```bash
git add -A
git commit -m "fix: final polish for smart scheduling and thread intelligence"
```

---

## Task Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | HubSpot module (CRM lookup, TLD inference, optimal send time) | `src/hubspot.js` |
| 2 | Recipient info + scheduled email API routes | `src/index.js` |
| 3 | Scheduled email sending in cron | `src/cron.js` |
| 4 | Schedule send UI in Gmail compose dropdown | `extension/gmail.js` |
| 5 | Thread intelligence sidebar | `extension/gmail.js` |
| 6 | Final lint and verification | All files |

**Dependencies:** Task 1 is the foundation. Tasks 2-3 depend on 1. Tasks 4-5 depend on 2. Task 6 is last. Tasks 4 and 5 both modify `extension/gmail.js` so should be done sequentially (4 before 5).
