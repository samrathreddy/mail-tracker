# Drip Sequencing & Follow-up Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add auto-drip follow-up sequencing so users can write a first email in Gmail, select a follow-up sequence, and have follow-ups sent automatically via Gmail API on a configurable schedule.

**Architecture:** Modular extension of the existing Cloudflare Worker. New modules (`sequences.js`, `templates.js`, `gmail-api.js`, `cron.js`, `variables.js`) added alongside existing code. New `SEQUENCES` KV namespace stores all sequence data with prefixed keys. Cron trigger fires every 5 minutes to send due follow-ups and check for replies. Gmail OAuth provides send/read access.

**Tech Stack:** Cloudflare Workers (V8), Cloudflare KV, Gmail API (REST), Chrome Extension MV3, vanilla JS (no frameworks, no build step)

**Spec:** `docs/superpowers/specs/2026-03-25-drip-sequencing-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/variables.js` | Variable substitution engine (`{{firstName}}`, etc.) |
| `src/templates.js` | Template CRUD operations against `SEQUENCES` KV |
| `src/sequences.js` | Sequence lifecycle: create, advance, stop, status, scheduling |
| `src/gmail-api.js` | OAuth token management, Gmail send, thread reply checking |
| `src/cron.js` | Cron handler: send due follow-ups, check replies |
| `src/views/sequences-page.js` | HTML page for sequence list at `/sequences` |
| `src/views/templates-page.js` | HTML page for template management at `/templates` |
| `src/views/analytics-page.js` | HTML page for per-template analytics at `/analytics` |

### Existing files to modify

| File | Changes |
|------|---------|
| `src/index.js` | Add `scheduled` export, new route handlers, open-detection sequence integration |
| `src/shared.js` | Export new constants for sequence system |
| `src/notifications.js` | Add sequence event notification functions |
| `src/views/dashboard.js` | Add sequence badges on tracker cards, nav link |
| `src/views/detail.js` | Add sequence section to tracker detail page |
| `extension/manifest.json` | Add `identity` permission for OAuth |
| `extension/popup.html` | Add Sequences and Templates tabs, OAuth status in settings |
| `extension/popup.js` | Add sequence/template view controllers, OAuth connect flow |
| `extension/background.js` | Add sequence status polling |
| `extension/gmail.js` | Add sequence selector dropdown next to Send button |
| `wrangler.example.toml` | Add `SEQUENCES` KV binding and cron trigger |

---

## Task 1: Variable Substitution Engine

**Files:**
- Create: `src/variables.js`

This is a pure function with no dependencies — good foundation to build first.

- [x] **Step 1: Create `src/variables.js` with `substituteVariables` and `deriveFirstName`**

```javascript
/**
 * Derive a first name from an email address.
 * Splits local part on '.', capitalizes first segment.
 * e.g. "bob.smith@example.com" -> "Bob"
 * e.g. "alice@example.com" -> "Alice"
 */
export function deriveFirstName(email) {
  if (!email || !email.includes('@')) return '';
  const local = email.split('@')[0];
  const first = local.split('.')[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * Substitute {{variables}} in a string.
 * Built-in variables: firstName, recipient, subject, originalBody, daysSince, stepNumber.
 * Custom variables from the `variables` object override built-ins.
 * Unknown variables are left as-is so misconfiguration is visible.
 */
export function substituteVariables(text, context) {
  const { recipient, subject, originalBody, createdAt, stepIndex, variables } = context;

  const daysSince = createdAt
    ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000)
    : 0;

  const builtIns = {
    firstName: deriveFirstName(recipient),
    recipient: recipient || '',
    subject: subject || '',
    originalBody: originalBody || '',
    daysSince: String(daysSince),
    stepNumber: String((stepIndex || 0) + 1),
  };

  const merged = { ...builtIns, ...variables };

  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in merged ? merged[key] : match;
  });
}
```

- [x] **Step 2: Verify the module loads without syntax errors**

Run: `node -e "import('./src/variables.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'deriveFirstName', 'substituteVariables' ]`

- [x] **Step 3: Commit**

```bash
git add src/variables.js
git commit -m "feat: add variable substitution engine for drip sequences"
```

---

## Task 2: Template CRUD Module

**Files:**
- Create: `src/templates.js`

- [x] **Step 1: Create `src/templates.js` with full CRUD operations**

```javascript
/**
 * Generate an 8-char random ID.
 */
function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate template input. Returns null if valid, or an error message string.
 */
export function validateTemplate(data) {
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    return 'Template name is required';
  }
  if (data.name.length > 100) return 'Template name must be 100 chars or less';
  if (!Array.isArray(data.steps) || data.steps.length === 0) return 'At least one step is required';
  if (data.steps.length > 10) return 'Maximum 10 steps per template';

  for (let i = 0; i < data.steps.length; i++) {
    const step = data.steps[i];
    if (!Number.isInteger(step.delayDays) || step.delayDays < 1 || step.delayDays > 90) {
      return `Step ${i + 1}: delayDays must be an integer between 1 and 90`;
    }
    if (!step.subject || step.subject.length > 500) {
      return `Step ${i + 1}: subject is required and must be 500 chars or less`;
    }
    if (!step.body || step.body.length > 50000) {
      return `Step ${i + 1}: body is required and must be 50,000 chars or less`;
    }
    if (step.stopOn && !Array.isArray(step.stopOn)) {
      return `Step ${i + 1}: stopOn must be an array`;
    }
    if (step.stopOn) {
      for (const condition of step.stopOn) {
        if (!['open', 'reply'].includes(condition)) {
          return `Step ${i + 1}: stopOn values must be "open" or "reply"`;
        }
      }
    }
  }

  if (data.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: data.timezone });
    } catch {
      return `Invalid timezone: ${data.timezone}`;
    }
  }

  return null;
}

/**
 * List all templates from SEQUENCES KV.
 */
export async function listTemplates(env) {
  const keys = await env.SEQUENCES.list({ prefix: 'tmpl:' });
  const templates = await Promise.all(
    keys.keys.map(k => env.SEQUENCES.get(k.name, 'json'))
  );
  return templates.filter(Boolean);
}

/**
 * Get a single template by ID.
 */
export async function getTemplate(env, id) {
  return env.SEQUENCES.get(id, 'json');
}

/**
 * Create a new template. Returns the created template object.
 */
export async function createTemplate(env, data) {
  const id = `tmpl:${generateId()}`;
  const now = new Date().toISOString();
  const template = {
    id,
    name: data.name.trim(),
    steps: data.steps.map(s => ({
      delayDays: s.delayDays,
      subject: s.subject,
      body: s.body,
      stopOn: s.stopOn || [],
    })),
    timezone: data.timezone || 'UTC',
    createdAt: now,
    updatedAt: now,
  };
  await env.SEQUENCES.put(id, JSON.stringify(template));
  return template;
}

/**
 * Update an existing template. Returns updated template or null if not found.
 */
export async function updateTemplate(env, id, data) {
  const existing = await env.SEQUENCES.get(id, 'json');
  if (!existing) return null;

  const updated = {
    ...existing,
    name: data.name ? data.name.trim() : existing.name,
    steps: data.steps || existing.steps,
    timezone: data.timezone || existing.timezone,
    updatedAt: new Date().toISOString(),
  };
  if (data.steps) {
    updated.steps = data.steps.map(s => ({
      delayDays: s.delayDays,
      subject: s.subject,
      body: s.body,
      stopOn: s.stopOn || [],
    }));
  }
  await env.SEQUENCES.put(id, JSON.stringify(updated));
  return updated;
}

/**
 * Delete a template by ID. Analytics entries are retained.
 * Returns true if deleted, false if not found.
 */
export async function deleteTemplate(env, id) {
  const existing = await env.SEQUENCES.get(id, 'json');
  if (!existing) return false;
  await env.SEQUENCES.delete(id);
  return true;
}
```

- [x] **Step 2: Verify the module loads**

Run: `node -e "import('./src/templates.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'validateTemplate', 'listTemplates', 'getTemplate', 'createTemplate', 'updateTemplate', 'deleteTemplate' ]`

- [x] **Step 3: Commit**

```bash
git add src/templates.js
git commit -m "feat: add template CRUD module for sequence templates"
```

---

## Task 3: Sequence Lifecycle Module

**Files:**
- Create: `src/sequences.js`

- [x] **Step 1: Create `src/sequences.js` with scheduling, creation, and lifecycle management**

```javascript
import { substituteVariables } from './variables.js';

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute scheduledAt for a step, respecting timezone and 8am-6pm send window.
 * delayDays is relative to the original email send time.
 */
export function computeScheduledAt(createdAt, delayDays, timezone) {
  const tz = timezone || 'UTC';
  const origin = new Date(createdAt);

  // Get the date components in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(origin).map(p => [p.type, p.value])
  );

  // Build a date in the target timezone
  const localYear = parseInt(parts.year);
  const localMonth = parseInt(parts.month) - 1;
  const localDay = parseInt(parts.day);
  const localHour = parseInt(parts.hour);
  const localMinute = parseInt(parts.minute);

  // Add delayDays to the local date
  const targetDay = localDay + delayDays;

  // Create a reference UTC date to find the timezone offset
  const refDate = new Date(Date.UTC(localYear, localMonth, targetDay, localHour, localMinute));

  // Find what this time looks like in the target timezone
  const targetParts = Object.fromEntries(
    formatter.formatToParts(refDate).map(p => [p.type, p.value])
  );
  const actualLocalHour = parseInt(targetParts.hour);
  const actualLocalDay = parseInt(targetParts.day);
  const actualLocalMonth = parseInt(targetParts.month) - 1;
  const actualLocalYear = parseInt(targetParts.year);

  // Clamp to 8am-6pm send window in target timezone
  let sendHour = actualLocalHour;
  let sendMinute = parseInt(targetParts.minute);
  let addDays = 0;

  if (sendHour < 8) {
    // Before window: snap to 9am same day
    sendHour = 9;
    sendMinute = 0;
  } else if (sendHour >= 18) {
    // After window: snap to 9am next day
    sendHour = 9;
    sendMinute = 0;
    addDays = 1;
  }

  // Reconstruct the final date
  const approxUtc = new Date(Date.UTC(
    actualLocalYear, actualLocalMonth, actualLocalDay + addDays,
    sendHour, sendMinute, 0
  ));

  // Find the actual offset by checking what time approxUtc is in the target TZ
  const checkParts = Object.fromEntries(
    formatter.formatToParts(approxUtc).map(p => [p.type, p.value])
  );
  const checkHour = parseInt(checkParts.hour);
  const hourDiff = checkHour - sendHour;

  // Adjust for timezone offset
  const finalUtc = new Date(approxUtc.getTime() - hourDiff * 3600000);

  return finalUtc.toISOString();
}

/**
 * Validate sequence creation input.
 */
export function validateSequence(data) {
  if (!data.recipient || !data.recipient.includes('@')) {
    return 'Valid recipient email is required';
  }
  if (!data.trackerId) return 'trackerId is required';
  if (!data.templateId && !data.steps) {
    return 'Either templateId or steps[] is required';
  }
  if (data.steps) {
    if (!Array.isArray(data.steps) || data.steps.length === 0) return 'steps must be a non-empty array';
    if (data.steps.length > 10) return 'Maximum 10 steps';
    for (let i = 0; i < data.steps.length; i++) {
      const s = data.steps[i];
      if (!Number.isInteger(s.delayDays) || s.delayDays < 1 || s.delayDays > 90) {
        return `Step ${i + 1}: delayDays must be 1-90`;
      }
      if (!s.subject || s.subject.length > 500) return `Step ${i + 1}: subject required, max 500 chars`;
      if (!s.body || s.body.length > 50000) return `Step ${i + 1}: body required, max 50000 chars`;
    }
  }
  if (data.variables) {
    for (const [key, val] of Object.entries(data.variables)) {
      if (!/^\w+$/.test(key)) return `Invalid variable key: ${key}`;
      if (typeof val !== 'string' || val.length > 1000) return `Variable ${key}: must be string, max 1000 chars`;
    }
  }
  if (data.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: data.timezone });
    } catch {
      return `Invalid timezone: ${data.timezone}`;
    }
  }
  return null;
}

/**
 * Create a new active sequence.
 * If templateId is provided, copies steps from the template.
 * If steps[] is provided directly, uses those (one-off sequence).
 */
export async function createSequence(env, data) {
  let steps;
  let templateId = null;

  if (data.templateId) {
    const template = await env.SEQUENCES.get(data.templateId, 'json');
    if (!template) return { error: 'Template not found' };
    steps = template.steps;
    templateId = data.templateId;
    data.timezone = data.timezone || template.timezone;
  } else {
    steps = data.steps;
  }

  // Check active sequence limit
  const activeKeys = await env.SEQUENCES.list({ prefix: 'seq:' });
  if (activeKeys.keys.length >= 500) {
    return { error: 'Maximum 500 active sequences reached' };
  }

  const id = `seq:${generateId()}`;
  const now = new Date().toISOString();
  const timezone = data.timezone || 'UTC';

  const sequence = {
    id,
    templateId,
    trackerId: data.trackerId,
    recipient: data.recipient,
    threadId: data.threadId || null,
    originalMessageId: data.originalMessageId || null,
    timezone,
    currentStep: 0,
    status: 'active',
    steps: steps.map((s) => ({
      delayDays: s.delayDays,
      subject: s.subject,
      body: s.body,
      stopOn: s.stopOn || [],
      scheduledAt: computeScheduledAt(now, s.delayDays, timezone),
      sentAt: null,
      sentMessageId: null,
      status: 'pending',
      retryCount: 0,
      failedReason: null,
    })),
    variables: data.variables || {},
    stoppedAt: null,
    stoppedReason: null,
    createdAt: now,
  };

  await env.SEQUENCES.put(id, JSON.stringify(sequence));

  // Create reverse index: tracker -> sequence
  await env.SEQUENCES.put(`tracker-seq:${data.trackerId}`, id);

  return { sequence };
}

/**
 * List sequences, optionally filtered by status.
 */
export async function listSequences(env, status) {
  const keys = await env.SEQUENCES.list({ prefix: 'seq:' });
  const sequences = await Promise.all(
    keys.keys.map(k => env.SEQUENCES.get(k.name, 'json'))
  );
  const filtered = sequences.filter(Boolean);
  if (status) return filtered.filter(s => s.status === status);
  return filtered;
}

/**
 * Get a single sequence.
 */
export async function getSequence(env, id) {
  return env.SEQUENCES.get(id, 'json');
}

/**
 * Stop (cancel) a sequence.
 */
export async function stopSequence(env, id, reason) {
  const seq = await env.SEQUENCES.get(id, 'json');
  if (!seq) return null;
  seq.status = 'stopped';
  seq.stoppedAt = new Date().toISOString();
  seq.stoppedReason = reason || 'manual';
  await env.SEQUENCES.put(id, JSON.stringify(seq));
  return seq;
}

/**
 * Skip the current step and advance to the next.
 */
export async function skipStep(env, id) {
  const seq = await env.SEQUENCES.get(id, 'json');
  if (!seq || seq.status !== 'active') return null;

  seq.steps[seq.currentStep].status = 'skipped';
  seq.currentStep++;

  if (seq.currentStep >= seq.steps.length) {
    seq.status = 'completed';
  }

  await env.SEQUENCES.put(id, JSON.stringify(seq));
  return seq;
}

/**
 * Advance a sequence after a step has been sent.
 */
export async function advanceSequence(env, id, sentMessageId) {
  const seq = await env.SEQUENCES.get(id, 'json');
  if (!seq || seq.status !== 'active') return null;

  const step = seq.steps[seq.currentStep];
  step.sentMessageId = sentMessageId;
  step.sentAt = new Date().toISOString();
  step.status = 'sent';

  seq.currentStep++;
  if (seq.currentStep >= seq.steps.length) {
    seq.status = 'completed';
  }

  await env.SEQUENCES.put(id, JSON.stringify(seq));
  return seq;
}

/**
 * Check if a sequence should be stopped based on open detection.
 * Called from /t/:id handler when a real open is recorded.
 */
export async function checkOpenStopCondition(env, trackerId) {
  const seqId = await env.SEQUENCES.get(`tracker-seq:${trackerId}`);
  if (!seqId) return null;

  const seq = await env.SEQUENCES.get(seqId, 'json');
  if (!seq || seq.status !== 'active') return null;

  const currentStep = seq.steps[seq.currentStep];
  if (currentStep && currentStep.stopOn && currentStep.stopOn.includes('open')) {
    return stopSequence(env, seqId, 'open');
  }
  return null;
}
```

- [x] **Step 2: Verify the module loads**

Run: `node -e "import('./src/sequences.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'computeScheduledAt', 'validateSequence', 'createSequence', 'listSequences', 'getSequence', 'stopSequence', 'skipStep', 'advanceSequence', 'checkOpenStopCondition' ]`

- [x] **Step 3: Commit**

```bash
git add src/sequences.js
git commit -m "feat: add sequence lifecycle module with scheduling and stop conditions"
```

---

## Task 4: Gmail API Module

**Files:**
- Create: `src/gmail-api.js`

- [x] **Step 1: Create `src/gmail-api.js` with OAuth token management, email sending, and reply checking**

```javascript
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

/**
 * Generate the Google OAuth consent URL.
 * Stores a state nonce in KV with 10-minute TTL for CSRF validation.
 */
export async function getOAuthUrl(env, redirectUri) {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Store nonce with 10-min TTL
  await env.SEQUENCES.put(`oauth:state:${state}`, '1', { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Handle OAuth callback. Validates state, exchanges code for tokens.
 * Returns { success: true, email } or { success: false, error }.
 */
export async function handleOAuthCallback(env, code, state, redirectUri) {
  // Validate CSRF state
  const storedState = await env.SEQUENCES.get(`oauth:state:${state}`);
  if (!storedState) {
    return { success: false, error: 'Invalid or expired state parameter' };
  }
  await env.SEQUENCES.delete(`oauth:state:${state}`);

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return { success: false, error: `Token exchange failed: ${err}` };
  }

  const tokens = await tokenRes.json();

  // Get user email
  const profileRes = await fetch(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : {};

  const oauthData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in * 1000),
    email: profile.emailAddress || 'unknown',
  };

  await env.SEQUENCES.put('oauth:tokens', JSON.stringify(oauthData));
  // Clear any previous error
  await env.SEQUENCES.delete('oauth:error');

  return { success: true, email: oauthData.email };
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns { token } or { error }.
 */
export async function getAccessToken(env) {
  const data = await env.SEQUENCES.get('oauth:tokens', 'json');
  if (!data) return { error: 'Gmail not connected' };

  // Token still valid (with 60s buffer)
  if (data.expires_at > Date.now() + 60000) {
    return { token: data.access_token };
  }

  // Refresh
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: data.refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    await env.SEQUENCES.put('oauth:error', JSON.stringify({
      error: 'Token refresh failed',
      detail: errText,
      at: new Date().toISOString(),
    }));
    return { error: `Token refresh failed: ${errText}` };
  }

  const refreshed = await res.json();
  data.access_token = refreshed.access_token;
  data.expires_at = Date.now() + (refreshed.expires_in * 1000);
  if (refreshed.refresh_token) {
    data.refresh_token = refreshed.refresh_token;
  }

  await env.SEQUENCES.put('oauth:tokens', JSON.stringify(data));
  await env.SEQUENCES.delete('oauth:error');

  return { token: data.access_token };
}

/**
 * Get OAuth connection status.
 * Returns { connected, email, error? }.
 */
export async function getOAuthStatus(env) {
  const tokens = await env.SEQUENCES.get('oauth:tokens', 'json');
  const error = await env.SEQUENCES.get('oauth:error', 'json');

  if (!tokens) return { connected: false, email: null, error: error || null };
  return { connected: true, email: tokens.email, error: error || null };
}

/**
 * Disconnect OAuth -- remove stored tokens.
 */
export async function disconnectOAuth(env) {
  await env.SEQUENCES.delete('oauth:tokens');
  await env.SEQUENCES.delete('oauth:error');
}

/**
 * Build an RFC 2822 MIME message and base64url encode it.
 */
function buildMimeMessage({ to, subject, body, inReplyTo, references }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
  ];

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references || inReplyTo}`);
  }

  lines.push('', body);

  const raw = lines.join('\r\n');

  // Base64url encode
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return encoded;
}

/**
 * Send a follow-up email via Gmail API.
 * Returns { messageId } or { error, status }.
 */
export async function sendFollowUp(env, { to, subject, body, threadId, inReplyTo }) {
  const { token, error } = await getAccessToken(env);
  if (error) return { error, status: 401 };

  const raw = buildMimeMessage({
    to,
    subject,
    body,
    inReplyTo,
    references: inReplyTo,
  });

  const payload = { raw };
  if (threadId) payload.threadId = threadId;

  const res = await fetch(`${GMAIL_API_BASE}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { error: errText, status: res.status };
  }

  const result = await res.json();
  return { messageId: result.id, threadId: result.threadId };
}

/**
 * Check a Gmail thread for replies from someone other than the authenticated user.
 * Returns { hasReply, replyAt } or { error }.
 */
export async function checkThreadForReplies(env, threadId, afterMessageId) {
  const { token, error } = await getAccessToken(env);
  if (error) return { error };

  const res = await fetch(`${GMAIL_API_BASE}/threads/${threadId}?format=metadata&metadataHeaders=From`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) return { hasReply: false, replyAt: null };
    return { error: `Thread fetch failed: ${res.status}` };
  }

  const thread = await res.json();
  const tokens = await env.SEQUENCES.get('oauth:tokens', 'json');
  const userEmail = tokens?.email?.toLowerCase();

  let foundAfter = !afterMessageId; // If no afterMessageId, check all messages
  for (const msg of thread.messages || []) {
    if (!foundAfter) {
      if (msg.id === afterMessageId) foundAfter = true;
      continue;
    }

    // Check if this message is from someone else
    const fromHeader = msg.payload?.headers?.find(h => h.name.toLowerCase() === 'from');
    if (fromHeader && userEmail && !fromHeader.value.toLowerCase().includes(userEmail)) {
      // Find the internalDate for this reply
      const replyAt = msg.internalDate
        ? new Date(parseInt(msg.internalDate)).toISOString()
        : new Date().toISOString();
      return { hasReply: true, replyAt };
    }
  }

  return { hasReply: false, replyAt: null };
}
```

- [x] **Step 2: Verify the module loads**

Run: `node -e "import('./src/gmail-api.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'getOAuthUrl', 'handleOAuthCallback', 'getAccessToken', 'getOAuthStatus', 'disconnectOAuth', 'sendFollowUp', 'checkThreadForReplies' ]`

- [x] **Step 3: Commit**

```bash
git add src/gmail-api.js
git commit -m "feat: add Gmail API module with OAuth, send, and reply detection"
```

---

## Task 5: Extend Notifications for Sequence Events

**Files:**
- Modify: `src/notifications.js`

- [x] **Step 1: Add sequence event notification functions to `notifications.js`**

Add the following after the existing `sendWebhookNotifications` function (after the closing brace around line 111):

```javascript
/**
 * Send notification for sequence events (follow-up sent, stopped, failed, etc.)
 */
export async function sendSequenceNotification(env, data) {
  const { type, recipient, subject, stepNumber, totalSteps, reason } = data;

  const messages = {
    'follow-up-sent': `Follow-up Sent (Step ${stepNumber}/${totalSteps})\n\nTo: ${recipient}\nSubject: ${subject}`,
    'sequence-completed': `Sequence Completed (All ${totalSteps} steps sent)\n\nTo: ${recipient}\nSubject: ${subject}`,
    'sequence-stopped': `Sequence Stopped - ${reason}\n\nTo: ${recipient}\nSubject: ${subject}`,
    'step-failed': `Step Failed (Step ${stepNumber}/${totalSteps})\n\nTo: ${recipient}\nSubject: ${subject}\nReason: ${reason}`,
    'oauth-error': `Gmail OAuth Error\n\nAll sequences paused. Please reconnect Gmail.\nError: ${reason}`,
  };

  const text = messages[type] || `Sequence event: ${type}`;

  const promises = [];

  if (env.SLACK_WEBHOOK_URL) {
    promises.push(
      fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => {})
    );
  }

  if (env.DISCORD_WEBHOOK_URL) {
    const colors = {
      'follow-up-sent': 0x3B82F6,
      'sequence-completed': 0x22C55E,
      'sequence-stopped': 0xEAB308,
      'step-failed': 0xEF4444,
      'oauth-error': 0xEF4444,
    };

    promises.push(
      fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: text.split('\n')[0],
            description: text.split('\n').slice(1).join('\n'),
            color: colors[type] || 0x6366F1,
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch(() => {})
    );
  }

  await Promise.all(promises);
}
```

- [x] **Step 2: Verify the module still loads with new export**

Run: `node -e "import('./src/notifications.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'sendWebhookNotifications', 'sendSequenceNotification' ]`

- [x] **Step 3: Commit**

```bash
git add src/notifications.js
git commit -m "feat: add sequence event notifications for Slack and Discord"
```

---

## Task 6: Cron Handler

**Files:**
- Create: `src/cron.js`

- [x] **Step 1: Create `src/cron.js` with due follow-up sending and reply checking**

```javascript
import { substituteVariables } from './variables.js';
import { advanceSequence, stopSequence } from './sequences.js';
import { sendFollowUp, checkThreadForReplies, getAccessToken } from './gmail-api.js';
import { sendSequenceNotification } from './notifications.js';

const MAX_RETRIES = 3;
const REPLY_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_TTL = 300; // 5 minutes in seconds

/**
 * Main cron entry point. Called by the scheduled event handler.
 */
export async function handleCron(env) {
  // Acquire lock
  const existingLock = await env.SEQUENCES.get('cron:lock');
  if (existingLock) return;
  await env.SEQUENCES.put('cron:lock', new Date().toISOString(), { expirationTtl: LOCK_TTL });

  try {
    await sendDueFollowUps(env);
    await maybeCheckReplies(env);
  } finally {
    await env.SEQUENCES.delete('cron:lock');
  }
}

/**
 * Job 1: Find and send all due follow-ups.
 */
async function sendDueFollowUps(env) {
  // Check OAuth is valid before processing
  const { error: authError } = await getAccessToken(env);
  if (authError) {
    await pauseAllSequences(env, authError);
    return;
  }

  const keys = await env.SEQUENCES.list({ prefix: 'seq:' });
  const now = Date.now();

  for (const key of keys.keys) {
    const seq = await env.SEQUENCES.get(key.name, 'json');
    if (!seq || seq.status !== 'active') continue;

    const step = seq.steps[seq.currentStep];
    if (!step || step.status !== 'pending') continue;

    // Check if step is due
    const scheduledTime = new Date(step.scheduledAt).getTime();
    if (scheduledTime > now) continue;

    // Check stop conditions before sending
    const shouldStop = await checkStopConditions(env, seq, step);
    if (shouldStop) {
      await stopSequence(env, seq.id, shouldStop);
      await sendSequenceNotification(env, {
        type: 'sequence-stopped',
        recipient: seq.recipient,
        subject: seq.variables?.subject || '',
        stepNumber: seq.currentStep + 1,
        totalSteps: seq.steps.length,
        reason: shouldStop === 'open' ? 'Recipient opened the email' : 'Recipient replied',
      });
      continue;
    }

    // Substitute variables
    const context = {
      recipient: seq.recipient,
      subject: seq.variables?.subject || '',
      originalBody: seq.variables?.originalBody || '',
      createdAt: seq.createdAt,
      stepIndex: seq.currentStep,
      variables: seq.variables || {},
    };

    const renderedSubject = substituteVariables(step.subject, context);
    const renderedBody = substituteVariables(step.body, context);

    // Send via Gmail API
    const result = await sendFollowUp(env, {
      to: seq.recipient,
      subject: renderedSubject,
      body: renderedBody,
      threadId: seq.threadId,
      inReplyTo: seq.originalMessageId,
    });

    if (result.error) {
      step.retryCount = (step.retryCount || 0) + 1;

      if (result.status === 401) {
        await pauseAllSequences(env, result.error);
        return;
      }

      if (step.retryCount >= MAX_RETRIES) {
        step.status = 'failed';
        step.failedReason = result.error;
        seq.currentStep++;
        if (seq.currentStep >= seq.steps.length) {
          seq.status = 'completed';
        }
        await env.SEQUENCES.put(seq.id, JSON.stringify(seq));
        await sendSequenceNotification(env, {
          type: 'step-failed',
          recipient: seq.recipient,
          subject: seq.variables?.subject || '',
          stepNumber: seq.currentStep,
          totalSteps: seq.steps.length,
          reason: result.error,
        });
      } else {
        await env.SEQUENCES.put(seq.id, JSON.stringify(seq));
      }
      continue;
    }

    // Success -- record sentMessageId first for idempotent recovery
    step.sentMessageId = result.messageId;
    await env.SEQUENCES.put(seq.id, JSON.stringify(seq));

    // Update threadId if we got one back
    if (result.threadId && !seq.threadId) {
      seq.threadId = result.threadId;
    }

    // Advance sequence
    const advanced = await advanceSequence(env, seq.id, result.messageId);

    // Update analytics
    await updateAnalytics(env, seq.templateId, seq.currentStep - 1, 'sent');

    // Notify
    const notifType = advanced?.status === 'completed' ? 'sequence-completed' : 'follow-up-sent';
    await sendSequenceNotification(env, {
      type: notifType,
      recipient: seq.recipient,
      subject: renderedSubject,
      stepNumber: seq.currentStep,
      totalSteps: seq.steps.length,
    });
  }
}

/**
 * Job 2: Check active threads for replies (runs every ~15 min).
 */
async function maybeCheckReplies(env) {
  const lastCheck = await env.SEQUENCES.get('cron:lastReplyCheck');
  if (lastCheck && (Date.now() - new Date(lastCheck).getTime()) < REPLY_CHECK_INTERVAL_MS) {
    return;
  }

  const keys = await env.SEQUENCES.list({ prefix: 'seq:' });

  for (const key of keys.keys) {
    const seq = await env.SEQUENCES.get(key.name, 'json');
    if (!seq || seq.status !== 'active') continue;

    const step = seq.steps[seq.currentStep];
    if (!step || !step.stopOn || !step.stopOn.includes('reply')) continue;
    if (!seq.threadId) continue;

    // Find the last known message ID
    let afterMessageId = seq.originalMessageId;
    for (let i = seq.currentStep - 1; i >= 0; i--) {
      if (seq.steps[i].sentMessageId) {
        afterMessageId = seq.steps[i].sentMessageId;
        break;
      }
    }

    const result = await checkThreadForReplies(env, seq.threadId, afterMessageId);
    if (result.error) continue;

    if (result.hasReply) {
      await stopSequence(env, seq.id, 'reply');
      await updateAnalytics(env, seq.templateId, seq.currentStep, 'replied');
      await sendSequenceNotification(env, {
        type: 'sequence-stopped',
        recipient: seq.recipient,
        subject: seq.variables?.subject || '',
        stepNumber: seq.currentStep + 1,
        totalSteps: seq.steps.length,
        reason: 'Recipient replied',
      });
    }
  }

  await env.SEQUENCES.put('cron:lastReplyCheck', new Date().toISOString());
}

/**
 * Check stop conditions for a sequence step.
 * Returns the stop reason string or null if should continue.
 */
async function checkStopConditions(env, seq, step) {
  if (!step.stopOn || step.stopOn.length === 0) return null;

  if (step.stopOn.includes('open')) {
    const tracker = await env.TRACKER.get(seq.trackerId, 'json');
    if (tracker && tracker.opens > 0) return 'open';
  }

  return null;
}

/**
 * Pause all active sequences due to OAuth failure.
 */
async function pauseAllSequences(env, errorDetail) {
  const keys = await env.SEQUENCES.list({ prefix: 'seq:' });
  for (const key of keys.keys) {
    const seq = await env.SEQUENCES.get(key.name, 'json');
    if (seq && seq.status === 'active') {
      seq.status = 'paused';
      await env.SEQUENCES.put(key.name, JSON.stringify(seq));
    }
  }

  await sendSequenceNotification(env, {
    type: 'oauth-error',
    recipient: '',
    subject: '',
    stepNumber: 0,
    totalSteps: 0,
    reason: errorDetail,
  });
}

/**
 * Update per-template analytics.
 */
async function updateAnalytics(env, templateId, stepIndex, eventType) {
  if (!templateId) return;

  const key = `analytics:${templateId}`;
  let analytics = await env.SEQUENCES.get(key, 'json');

  if (!analytics) {
    analytics = {
      templateId,
      totalSequences: 0,
      completedSequences: 0,
      stoppedSequences: 0,
      steps: [],
      updatedAt: new Date().toISOString(),
    };
  }

  while (analytics.steps.length <= stepIndex) {
    analytics.steps.push({ sent: 0, opened: 0, replied: 0, openRate: 0, replyRate: 0 });
  }

  const stepStats = analytics.steps[stepIndex];

  if (eventType === 'sent') {
    stepStats.sent++;
  } else if (eventType === 'opened') {
    stepStats.opened++;
  } else if (eventType === 'replied') {
    stepStats.replied++;
  }

  if (stepStats.sent > 0) {
    stepStats.openRate = parseFloat((stepStats.opened / stepStats.sent).toFixed(2));
    stepStats.replyRate = parseFloat((stepStats.replied / stepStats.sent).toFixed(2));
  }

  analytics.updatedAt = new Date().toISOString();
  await env.SEQUENCES.put(key, JSON.stringify(analytics));
}

/**
 * Exported for use in /t/:id open handler to update analytics on open.
 */
export async function recordOpenForAnalytics(env, trackerId) {
  const seqId = await env.SEQUENCES.get(`tracker-seq:${trackerId}`);
  if (!seqId) return;

  const seq = await env.SEQUENCES.get(seqId, 'json');
  if (!seq) return;

  for (let i = seq.steps.length - 1; i >= 0; i--) {
    if (seq.steps[i].status === 'sent') {
      await updateAnalytics(env, seq.templateId, i, 'opened');
      break;
    }
  }
}
```

- [x] **Step 2: Verify the module loads**

Run: `node -e "import('./src/cron.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'handleCron', 'recordOpenForAnalytics' ]`

- [x] **Step 3: Commit**

```bash
git add src/cron.js
git commit -m "feat: add cron handler for sending due follow-ups and checking replies"
```

---

## Task 7: Wire Up Router and Cron in index.js

**Files:**
- Modify: `src/index.js`

This task connects all the new modules to the Worker's router.

- [x] **Step 1: Add new imports at the top of `src/index.js`**

Add after line 4 (`import { renderDashboard } from './views/dashboard.js';`):

```javascript
import { validateTemplate, listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate } from './templates.js';
import { validateSequence, createSequence, listSequences, getSequence, stopSequence, skipStep, checkOpenStopCondition } from './sequences.js';
import { getOAuthUrl, handleOAuthCallback, getOAuthStatus, disconnectOAuth } from './gmail-api.js';
import { handleCron, recordOpenForAnalytics } from './cron.js';
import { sendSequenceNotification } from './notifications.js';
```

- [x] **Step 2: Add open-detection integration in the `/t/:id` handler**

In `src/index.js`, find the section after `sendWebhookNotifications` is called and after `await env.TRACKER.put(id, JSON.stringify(existing));` (around line 70). Add immediately after:

```javascript
      // Check if this open should stop an active sequence
      if (env.SEQUENCES) {
        await checkOpenStopCondition(env, id);
        await recordOpenForAnalytics(env, id);
      }
```

- [x] **Step 3: Add all new route handlers before the 404 response**

Before the line `return new Response('Not found', { status: 404 });` (around line 192), add all new route handlers. The full block is:

```javascript
    // === TEMPLATE ROUTES ===

    if (url.pathname === '/templates' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const templates = await listTemplates(env);
      return json(templates);
    }

    if (url.pathname === '/templates' && request.method === 'POST') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const body = await request.json();
      const error = validateTemplate(body);
      if (error) return json({ error }, 400);
      const template = await createTemplate(env, body);
      return json(template, 201);
    }

    if (url.pathname.match(/^\/templates\/tmpl:[a-f0-9]+$/) && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const id = url.pathname.split('/templates/')[1];
      const template = await getTemplate(env, id);
      if (!template) return json({ error: 'Template not found' }, 404);
      return json(template);
    }

    if (url.pathname.match(/^\/templates\/tmpl:[a-f0-9]+$/) && request.method === 'PUT') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const id = url.pathname.split('/templates/')[1];
      const body = await request.json();
      if (body.steps) {
        const error = validateTemplate({ name: body.name || 'temp', steps: body.steps, timezone: body.timezone });
        if (error) return json({ error }, 400);
      }
      const updated = await updateTemplate(env, id, body);
      if (!updated) return json({ error: 'Template not found' }, 404);
      return json(updated);
    }

    if (url.pathname.match(/^\/templates\/tmpl:[a-f0-9]+$/) && request.method === 'DELETE') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const id = url.pathname.split('/templates/')[1];
      const deleted = await deleteTemplate(env, id);
      if (!deleted) return json({ error: 'Template not found' }, 404);
      return json({ deleted: id });
    }

    // === SEQUENCE ROUTES ===

    if (url.pathname === '/sequences' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const status = url.searchParams.get('status');
      const sequences = await listSequences(env, status);
      return json(sequences);
    }

    if (url.pathname === '/sequences' && request.method === 'POST') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const body = await request.json();
      const error = validateSequence(body);
      if (error) return json({ error }, 400);
      const result = await createSequence(env, body);
      if (result.error) return json({ error: result.error }, 400);
      return json(result.sequence, 201);
    }

    if (url.pathname.match(/^\/sequences\/seq:[a-f0-9]+$/) && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const id = url.pathname.split('/sequences/')[1];
      const seq = await getSequence(env, id);
      if (!seq) return json({ error: 'Sequence not found' }, 404);
      return json(seq);
    }

    if (url.pathname.match(/^\/sequences\/seq:[a-f0-9]+$/) && request.method === 'DELETE') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const id = url.pathname.split('/sequences/')[1];
      const stopped = await stopSequence(env, id, 'manual');
      if (!stopped) return json({ error: 'Sequence not found' }, 404);
      return json(stopped);
    }

    if (url.pathname.match(/^\/sequences\/seq:[a-f0-9]+\/skip$/) && request.method === 'POST') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const id = url.pathname.match(/^\/sequences\/(seq:[a-f0-9]+)\/skip$/)[1];
      const result = await skipStep(env, id);
      if (!result) return json({ error: 'Sequence not found or not active' }, 404);
      return json(result);
    }

    // === OAUTH ROUTES ===

    if (url.pathname === '/oauth/url' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const redirectUri = `${url.origin}/oauth/callback`;
      const authUrl = await getOAuthUrl(env, redirectUri);
      return json({ url: authUrl });
    }

    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) return new Response('Missing code or state', { status: 400 });
      const redirectUri = `${url.origin}/oauth/callback`;
      const result = await handleOAuthCallback(env, code, state, redirectUri);
      if (result.success) {
        return Response.redirect(`${url.origin}/?oauth=success`, 302);
      }
      return new Response(`OAuth error: ${result.error}`, { status: 400 });
    }

    if (url.pathname === '/oauth/status' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const status = await getOAuthStatus(env);
      return json(status);
    }

    if (url.pathname === '/oauth/disconnect' && request.method === 'POST') {
      if (!checkAuth(request, env)) return requireAuthCors();
      await disconnectOAuth(env);
      return json({ disconnected: true });
    }

    // === ANALYTICS ROUTES ===

    if (url.pathname === '/analytics/templates' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const keys = await env.SEQUENCES.list({ prefix: 'analytics:' });
      const analytics = await Promise.all(
        keys.keys.map(k => env.SEQUENCES.get(k.name, 'json'))
      );
      return json(analytics.filter(Boolean));
    }

    if (url.pathname.match(/^\/analytics\/templates\/tmpl:[a-f0-9]+$/) && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const templateId = url.pathname.split('/analytics/templates/')[1];
      const analytics = await env.SEQUENCES.get(`analytics:${templateId}`, 'json');
      if (!analytics) return json({ error: 'No analytics found' }, 404);
      return json(analytics);
    }
```

- [x] **Step 4: Add the `scheduled` export for cron**

The current default export structure is:

```javascript
export default {
  async fetch(request, env) {
    // ... all route handlers ...
  }
};
```

Change it to include the `scheduled` handler. Add before the closing `};`:

```javascript
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  },
```

So the structure becomes:

```javascript
export default {
  async fetch(request, env) {
    // ... existing + new route handlers ...
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  },
};
```

- [x] **Step 5: Test that the Worker starts without errors**

Run: `pnpm dev`
Expected: Worker starts at localhost:8787 without import errors. Press Ctrl+C to stop.

- [x] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat: wire up sequence/template/oauth/analytics routes and cron handler"
```

---

## Task 8: Update wrangler.example.toml

**Files:**
- Modify: `wrangler.example.toml`

- [x] **Step 1: Add SEQUENCES KV namespace and cron trigger**

Append after line 9 (the closing comment of the TRACKER section):

```toml

[[kv_namespaces]]
binding = "SEQUENCES"
id = "your-sequences-kv-namespace-id"  # Replace with your actual KV namespace ID
# Run: pnpm exec wrangler kv namespace create "SEQUENCES"
# Then paste the id from the output here

[triggers]
crons = ["*/5 * * * *"]  # Check for due follow-ups every 5 minutes

# Required secrets for Gmail OAuth (set via wrangler secret put):
# GOOGLE_CLIENT_ID -- from Google Cloud Console
# GOOGLE_CLIENT_SECRET -- from Google Cloud Console
```

- [x] **Step 2: Commit**

```bash
git add wrangler.example.toml
git commit -m "feat: add SEQUENCES KV namespace and cron trigger to wrangler config"
```

---

## Task 9: Dashboard Views -- Sequences, Templates, Analytics Pages

**Files:**
- Create: `src/views/sequences-page.js`
- Create: `src/views/templates-page.js`
- Create: `src/views/analytics-page.js`

These are server-rendered HTML pages following the same pattern as `dashboard.js` and `detail.js`. All dynamic data is escaped with `esc()` from `shared.js`.

- [x] **Step 1: Create `src/views/sequences-page.js`**

```javascript
import { esc, FAVICON, LOGO_SVG } from '../shared.js';

export function renderSequencesPage(sequences) {
  const active = sequences.filter(s => s.status === 'active');
  const stopped = sequences.filter(s => s.status === 'stopped');
  const completed = sequences.filter(s => s.status === 'completed');
  const paused = sequences.filter(s => s.status === 'paused');

  function renderSeqCard(seq) {
    const progress = `${seq.currentStep}/${seq.steps.length}`;
    const nextStep = seq.steps[seq.currentStep];
    const nextSend = nextStep ? new Date(nextStep.scheduledAt).toLocaleString() : 'N/A';
    const statusColors = {
      active: '#22c55e', stopped: '#eab308', completed: '#6366f1', paused: '#f97316',
    };
    const statusColor = statusColors[seq.status] || '#71717a';

    return `
      <div style="background:#27272a;border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:600;color:#e4e4e7;">${esc(seq.recipient)}</span>
          <span style="background:${statusColor}22;color:${statusColor};padding:2px 10px;border-radius:8px;font-size:13px;">${esc(seq.status)}</span>
        </div>
        <div style="color:#a1a1aa;font-size:13px;margin-bottom:4px;">Step ${esc(progress)} ${seq.templateId ? '| Template: ' + esc(seq.templateId) : '| One-off'}</div>
        ${seq.status === 'active' && nextStep ? `<div style="color:#a1a1aa;font-size:13px;">Next send: ${esc(nextSend)}</div>` : ''}
        <div style="color:#71717a;font-size:12px;margin-top:8px;">Created: ${esc(new Date(seq.createdAt).toLocaleString())}</div>
        ${seq.status === 'active' ? `
          <div style="margin-top:10px;display:flex;gap:8px;">
            <button onclick="cancelSeq('${esc(seq.id)}')" style="background:#ef4444;color:white;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Cancel</button>
            <button onclick="skipStepAction('${esc(seq.id)}')" style="background:#3b82f6;color:white;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Skip Step</button>
          </div>
        ` : ''}
        ${seq.stoppedReason ? `<div style="color:#eab308;font-size:12px;margin-top:6px;">Stopped: ${esc(seq.stoppedReason)}</div>` : ''}
      </div>
    `;
  }

  function renderSection(title, seqs) {
    if (seqs.length === 0) return '';
    return `
      <h2 style="color:#e4e4e7;font-size:16px;margin:20px 0 10px;">${esc(title)} (${seqs.length})</h2>
      ${seqs.map(renderSeqCard).join('')}
    `;
  }

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Sequences - Mail Tracker</title>
    <link rel="icon" href="${FAVICON}">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#18181b;color:#e4e4e7;font-family:system-ui,sans-serif;padding:20px;max-width:800px;margin:0 auto}
    a{color:#818cf8;text-decoration:none}a:hover{text-decoration:underline}</style>
  </head><body>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      ${LOGO_SVG}
      <span style="font-size:18px;font-weight:700;">Sequences</span>
      <div style="margin-left:auto;display:flex;gap:12px;">
        <a href="/">Dashboard</a>
        <a href="/templates">Templates</a>
        <a href="/analytics">Analytics</a>
      </div>
    </div>
    ${renderSection('Active', active)}
    ${renderSection('Paused', paused)}
    ${renderSection('Stopped', stopped)}
    ${renderSection('Completed', completed)}
    ${sequences.length === 0 ? '<p style="color:#71717a;text-align:center;margin-top:40px;">No sequences yet. Create one from Gmail or the extension.</p>' : ''}
    <script>
      function cancelSeq(id) { if (confirm('Cancel this sequence?')) fetch('/sequences/' + id, { method: 'DELETE' }).then(() => location.reload()); }
      function skipStepAction(id) { if (confirm('Skip current step?')) fetch('/sequences/' + id + '/skip', { method: 'POST' }).then(() => location.reload()); }
    </script>
  </body></html>`;
}
```

- [x] **Step 2: Create `src/views/templates-page.js`**

```javascript
import { esc, FAVICON, LOGO_SVG } from '../shared.js';

export function renderTemplatesPage(templates) {
  function renderTemplateCard(tmpl) {
    const stepsSummary = tmpl.steps.map((s, i) => {
      const truncSubject = s.subject.length > 50 ? s.subject.substring(0, 50) + '...' : s.subject;
      return `Step ${i + 1}: Day ${s.delayDays} - ${esc(truncSubject)}`;
    }).join('<br>');

    return `
      <div style="background:#27272a;border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:600;color:#e4e4e7;font-size:15px;">${esc(tmpl.name)}</span>
          <span style="color:#a1a1aa;font-size:13px;">${tmpl.steps.length} step${tmpl.steps.length > 1 ? 's' : ''} | ${esc(tmpl.timezone)}</span>
        </div>
        <div style="color:#a1a1aa;font-size:13px;line-height:1.6;">${stepsSummary}</div>
        <div style="margin-top:10px;">
          <button onclick="deleteTmpl('${esc(tmpl.id)}')" style="background:#ef4444;color:white;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Delete</button>
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Templates - Mail Tracker</title>
    <link rel="icon" href="${FAVICON}">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#18181b;color:#e4e4e7;font-family:system-ui,sans-serif;padding:20px;max-width:800px;margin:0 auto}
    a{color:#818cf8;text-decoration:none}a:hover{text-decoration:underline}
    input,select,textarea{background:#3f3f46;color:#e4e4e7;border:1px solid #52525b;border-radius:8px;padding:8px 12px;font-size:14px;width:100%}
    textarea{resize:vertical;min-height:80px}</style>
  </head><body>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      ${LOGO_SVG}
      <span style="font-size:18px;font-weight:700;">Templates</span>
      <div style="margin-left:auto;display:flex;gap:12px;">
        <a href="/">Dashboard</a>
        <a href="/sequences">Sequences</a>
        <a href="/analytics">Analytics</a>
      </div>
    </div>

    <button id="create-btn" onclick="toggleForm()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;font-size:14px;margin-bottom:20px;">+ New Template</button>

    <div id="create-form" style="display:none;background:#27272a;border-radius:12px;padding:20px;margin-bottom:20px;">
      <div style="margin-bottom:12px;"><label style="font-size:13px;color:#a1a1aa;">Name</label><input id="tmpl-name" placeholder="e.g. Sales Follow-up"></div>
      <div style="margin-bottom:12px;"><label style="font-size:13px;color:#a1a1aa;">Timezone</label><input id="tmpl-tz" placeholder="America/New_York"></div>
      <div id="steps-container"></div>
      <button onclick="addStep()" style="background:#3f3f46;color:#e4e4e7;border:1px solid #52525b;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;margin:10px 0;">+ Add Step</button>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button onclick="saveTemplate()" style="background:#22c55e;color:white;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;">Save</button>
        <button onclick="toggleForm()" style="background:#3f3f46;color:#e4e4e7;border:1px solid #52525b;padding:10px 20px;border-radius:10px;cursor:pointer;">Cancel</button>
      </div>
    </div>

    <div id="templates-list">
      ${templates.map(renderTemplateCard).join('')}
      ${templates.length === 0 ? '<p style="color:#71717a;text-align:center;margin-top:40px;">No templates yet. Create one above.</p>' : ''}
    </div>

    <script>
      var stepCount = 0;
      function toggleForm() {
        var form = document.getElementById('create-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        if (form.style.display === 'block' && stepCount === 0) addStep();
      }
      function addStep() {
        stepCount++;
        var container = document.getElementById('steps-container');
        var div = document.createElement('div');
        div.style.cssText = 'background:#3f3f46;border-radius:8px;padding:12px;margin-bottom:8px;';
        var label = document.createElement('div');
        label.style.cssText = 'font-size:13px;color:#a1a1aa;margin-bottom:8px;';
        label.textContent = 'Step ' + stepCount;
        div.appendChild(label);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';

        var delayWrap = document.createElement('div');
        delayWrap.style.flex = '1';
        var delayLabel = document.createElement('label');
        delayLabel.style.cssText = 'font-size:12px;color:#71717a;';
        delayLabel.textContent = 'Delay (days)';
        var delayInput = document.createElement('input');
        delayInput.type = 'number';
        delayInput.className = 'step-delay';
        delayInput.min = '1';
        delayInput.max = '90';
        delayInput.value = stepCount === 1 ? '2' : String(stepCount * 3);
        delayWrap.appendChild(delayLabel);
        delayWrap.appendChild(delayInput);

        var subjectWrap = document.createElement('div');
        subjectWrap.style.flex = '3';
        var subjectLabel = document.createElement('label');
        subjectLabel.style.cssText = 'font-size:12px;color:#71717a;';
        subjectLabel.textContent = 'Subject';
        var subjectInput = document.createElement('input');
        subjectInput.className = 'step-subject';
        subjectInput.placeholder = 'Re: {{subject}}';
        subjectWrap.appendChild(subjectLabel);
        subjectWrap.appendChild(subjectInput);

        row.appendChild(delayWrap);
        row.appendChild(subjectWrap);
        div.appendChild(row);

        var bodyLabel = document.createElement('label');
        bodyLabel.style.cssText = 'font-size:12px;color:#71717a;';
        bodyLabel.textContent = 'Body (HTML)';
        var bodyInput = document.createElement('textarea');
        bodyInput.className = 'step-body';
        bodyInput.placeholder = '<p>Hi {{firstName}},</p>';
        div.appendChild(bodyLabel);
        div.appendChild(bodyInput);

        var stopDiv = document.createElement('div');
        stopDiv.style.cssText = 'margin-top:8px;';
        var stopLabel = document.createElement('span');
        stopLabel.style.cssText = 'font-size:12px;color:#71717a;';
        stopLabel.textContent = 'Stop on: ';
        stopDiv.appendChild(stopLabel);

        var openCheck = document.createElement('input');
        openCheck.type = 'checkbox';
        openCheck.className = 'stop-open';
        var openLabel = document.createElement('label');
        openLabel.style.cssText = 'font-size:13px;margin-right:8px;';
        openLabel.appendChild(openCheck);
        openLabel.appendChild(document.createTextNode(' Open'));
        stopDiv.appendChild(openLabel);

        var replyCheck = document.createElement('input');
        replyCheck.type = 'checkbox';
        replyCheck.className = 'stop-reply';
        replyCheck.checked = true;
        var replyLabel = document.createElement('label');
        replyLabel.style.cssText = 'font-size:13px;';
        replyLabel.appendChild(replyCheck);
        replyLabel.appendChild(document.createTextNode(' Reply'));
        stopDiv.appendChild(replyLabel);

        div.appendChild(stopDiv);
        container.appendChild(div);
      }
      function saveTemplate() {
        var steps = [];
        var stepDivs = document.querySelectorAll('#steps-container > div');
        for (var i = 0; i < stepDivs.length; i++) {
          var div = stepDivs[i];
          var stopOn = [];
          if (div.querySelector('.stop-open').checked) stopOn.push('open');
          if (div.querySelector('.stop-reply').checked) stopOn.push('reply');
          steps.push({
            delayDays: parseInt(div.querySelector('.step-delay').value) || 2,
            subject: div.querySelector('.step-subject').value,
            body: div.querySelector('.step-body').value,
            stopOn: stopOn,
          });
        }
        fetch('/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('tmpl-name').value,
            timezone: document.getElementById('tmpl-tz').value || 'UTC',
            steps: steps,
          }),
        }).then(function(res) {
          if (res.ok) location.reload();
          else res.json().then(function(err) { alert(err.error || 'Failed'); });
        });
      }
      function deleteTmpl(id) {
        if (confirm('Delete this template?')) fetch('/templates/' + id, { method: 'DELETE' }).then(function() { location.reload(); });
      }
    </script>
  </body></html>`;
}
```

- [x] **Step 3: Create `src/views/analytics-page.js`**

```javascript
import { esc, FAVICON, LOGO_SVG } from '../shared.js';

export function renderAnalyticsPage(analyticsData, templates) {
  var templateNames = {};
  for (var i = 0; i < templates.length; i++) {
    templateNames[templates[i].id] = templates[i].name;
  }

  function renderAnalyticsCard(analytics) {
    var name = templateNames[analytics.templateId] || analytics.templateId;

    var stepsHtml = analytics.steps.map(function(s, i) {
      return '<tr>' +
        '<td style="padding:6px 12px;">Step ' + (i + 1) + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + s.sent + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + s.opened + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + (s.openRate * 100).toFixed(0) + '%</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + s.replied + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + (s.replyRate * 100).toFixed(0) + '%</td>' +
        '</tr>';
    }).join('');

    var maxSent = Math.max.apply(null, analytics.steps.map(function(s) { return s.sent; }).concat([1]));
    var funnelHtml = analytics.steps.map(function(s, i) {
      var width = Math.max((s.sent / maxSent) * 100, 5);
      return '<div style="display:flex;align-items:center;gap:10px;margin:4px 0;">' +
        '<span style="color:#a1a1aa;font-size:12px;width:50px;">Step ' + (i + 1) + '</span>' +
        '<div style="background:#6366f133;border-radius:4px;height:24px;width:' + width + '%;display:flex;align-items:center;padding:0 8px;">' +
        '<span style="color:#a5b4fc;font-size:12px;">' + s.sent + ' sent</span>' +
        '</div></div>';
    }).join('');

    return `
      <div style="background:#27272a;border-radius:12px;padding:20px;margin-bottom:16px;">
        <h3 style="color:#e4e4e7;font-size:16px;margin-bottom:12px;">${esc(name)}</h3>
        <div style="display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap;">
          <div style="background:#3f3f46;border-radius:8px;padding:10px 16px;"><div style="color:#71717a;font-size:12px;">Total</div><div style="color:#e4e4e7;font-size:20px;font-weight:600;">${analytics.totalSequences}</div></div>
          <div style="background:#3f3f46;border-radius:8px;padding:10px 16px;"><div style="color:#71717a;font-size:12px;">Completed</div><div style="color:#22c55e;font-size:20px;font-weight:600;">${analytics.completedSequences}</div></div>
          <div style="background:#3f3f46;border-radius:8px;padding:10px 16px;"><div style="color:#71717a;font-size:12px;">Stopped</div><div style="color:#eab308;font-size:20px;font-weight:600;">${analytics.stoppedSequences}</div></div>
        </div>
        <div style="margin-bottom:16px;">${funnelHtml}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="color:#71717a;border-bottom:1px solid #3f3f46;">
            <th style="padding:6px 12px;text-align:left;">Step</th>
            <th style="padding:6px 12px;">Sent</th>
            <th style="padding:6px 12px;">Opened</th>
            <th style="padding:6px 12px;">Open Rate</th>
            <th style="padding:6px 12px;">Replied</th>
            <th style="padding:6px 12px;">Reply Rate</th>
          </tr></thead>
          <tbody style="color:#e4e4e7;">${stepsHtml}</tbody>
        </table>
      </div>
    `;
  }

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Analytics - Mail Tracker</title>
    <link rel="icon" href="${FAVICON}">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#18181b;color:#e4e4e7;font-family:system-ui,sans-serif;padding:20px;max-width:900px;margin:0 auto}
    a{color:#818cf8;text-decoration:none}a:hover{text-decoration:underline}</style>
  </head><body>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      ${LOGO_SVG}
      <span style="font-size:18px;font-weight:700;">Sequence Analytics</span>
      <div style="margin-left:auto;display:flex;gap:12px;">
        <a href="/">Dashboard</a>
        <a href="/sequences">Sequences</a>
        <a href="/templates">Templates</a>
      </div>
    </div>
    ${analyticsData.map(renderAnalyticsCard).join('')}
    ${analyticsData.length === 0 ? '<p style="color:#71717a;text-align:center;margin-top:40px;">No analytics data yet. Analytics appear after sequences start sending.</p>' : ''}
  </body></html>`;
}
```

- [x] **Step 4: Add HTML view route handlers to `src/index.js`**

Add these imports at the top of `index.js` (with the other new imports from Task 7):

```javascript
import { renderSequencesPage } from './views/sequences-page.js';
import { renderTemplatesPage } from './views/templates-page.js';
import { renderAnalyticsPage } from './views/analytics-page.js';
```

Add these HTML-serving routes in `index.js` BEFORE the JSON API routes added in Task 7 (the `// === TEMPLATE ROUTES ===` comment). These use the `Accept` header to differentiate HTML vs JSON requests for the same paths:

```javascript
    // === HTML VIEW ROUTES (must come before JSON API routes) ===

    if (url.pathname === '/sequences' && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
      if (!checkAuth(request, env)) return requireAuth();
      const sequences = await listSequences(env);
      return html(renderSequencesPage(sequences));
    }

    if (url.pathname === '/templates' && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
      if (!checkAuth(request, env)) return requireAuth();
      const templates = await listTemplates(env);
      return html(renderTemplatesPage(templates));
    }

    if (url.pathname === '/analytics' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const analyticsKeys = await env.SEQUENCES.list({ prefix: 'analytics:' });
      const analyticsData = await Promise.all(analyticsKeys.keys.map(k => env.SEQUENCES.get(k.name, 'json')));
      const templates = await listTemplates(env);
      return html(renderAnalyticsPage(analyticsData.filter(Boolean), templates));
    }
```

- [x] **Step 5: Test that Worker starts and pages load**

Run: `pnpm dev`
Visit http://localhost:8787/sequences, http://localhost:8787/templates, http://localhost:8787/analytics
Expected: Pages render without errors (empty state messages visible).

- [x] **Step 6: Commit**

```bash
git add src/views/sequences-page.js src/views/templates-page.js src/views/analytics-page.js src/index.js
git commit -m "feat: add sequences, templates, and analytics dashboard pages"
```

---

## Task 10: Update Existing Dashboard with Sequence Nav and Badges

**Files:**
- Modify: `src/views/dashboard.js`
- Modify: `src/views/detail.js`
- Modify: `src/index.js`

- [x] **Step 1: Add sequence nav links to dashboard header**

In `src/views/dashboard.js`, find the top-bar section where the logo and title are rendered. After the title/search area and before the closing `</div>` of the top-bar, add:

```html
<div style="display:flex;gap:12px;margin-left:auto;font-size:14px;">
  <a href="/sequences" style="color:#818cf8;text-decoration:none;">Sequences</a>
  <a href="/templates" style="color:#818cf8;text-decoration:none;">Templates</a>
  <a href="/analytics" style="color:#818cf8;text-decoration:none;">Analytics</a>
</div>
```

- [x] **Step 2: Update detail page to accept sequence info**

In `src/views/detail.js`, update the function signature to accept an optional third parameter:

```javascript
export function renderDetail(id, data, sequenceInfo) {
```

After the stats grid section in the HTML output, add a conditional sequence panel:

```javascript
${sequenceInfo ? `
  <div style="background:#27272a;border-radius:16px;padding:20px;margin-bottom:20px;">
    <h3 style="color:#e4e4e7;font-size:15px;margin-bottom:12px;">Sequence</h3>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
      <div style="background:#3f3f46;border-radius:8px;padding:8px 14px;">
        <div style="color:#71717a;font-size:11px;">Status</div>
        <div style="color:#e4e4e7;font-size:14px;">${esc(sequenceInfo.status)}</div>
      </div>
      <div style="background:#3f3f46;border-radius:8px;padding:8px 14px;">
        <div style="color:#71717a;font-size:11px;">Progress</div>
        <div style="color:#e4e4e7;font-size:14px;">Step ${sequenceInfo.currentStep}/${sequenceInfo.steps.length}</div>
      </div>
      <div style="background:#3f3f46;border-radius:8px;padding:8px 14px;">
        <div style="color:#71717a;font-size:11px;">Timezone</div>
        <div style="color:#e4e4e7;font-size:14px;">${esc(sequenceInfo.timezone)}</div>
      </div>
    </div>
    <div style="font-size:13px;color:#a1a1aa;">
      ${sequenceInfo.steps.map((s, i) => {
        const icon = s.status === 'sent' ? 'Sent' : s.status === 'pending' ? 'Pending' : s.status === 'skipped' ? 'Skipped' : s.status === 'failed' ? 'Failed' : '-';
        return '<div style="padding:4px 0;">[' + esc(icon) + '] Step ' + (i + 1) + ': Day ' + s.delayDays + ' - ' + esc(s.subject.substring(0, 60)) + (s.sentAt ? ' (sent ' + esc(new Date(s.sentAt).toLocaleString()) + ')' : '') + '</div>';
      }).join('')}
    </div>
  </div>
` : ''}
```

- [x] **Step 3: Update the `/s/:id` route in `index.js` to pass sequence info**

In the `/s/:id` route handler in `index.js` (around line 76-94), after fetching the tracker data and before calling `renderDetail`, add:

```javascript
      let sequenceInfo = null;
      if (env.SEQUENCES) {
        const seqId = await env.SEQUENCES.get(`tracker-seq:${id}`);
        if (seqId) {
          sequenceInfo = await env.SEQUENCES.get(seqId, 'json');
        }
      }
```

Then update the `renderDetail` call to pass the third argument:

```javascript
      return html(renderDetail(id, data, sequenceInfo));
```

- [x] **Step 4: Test the updated pages**

Run: `pnpm dev`
Visit http://localhost:8787/ -- nav links should appear in the header.
Expected: No errors, links visible.

- [x] **Step 5: Commit**

```bash
git add src/views/dashboard.js src/views/detail.js src/index.js
git commit -m "feat: add sequence nav links to dashboard and sequence info to detail page"
```

---

## Task 11: Extension -- Sequence Selector in Gmail Compose

**Files:**
- Modify: `extension/gmail.js`

- [x] **Step 1: Add template fetching and sequence selector injection functions**

Add after the existing `addInboxReadIndicators` function (after line 448 in `gmail.js`):

```javascript
async function getTemplates() {
  if (!serverUrl) return [];
  try {
    const headers = {};
    if (dashboardPassword) {
      headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
    }
    const res = await fetch(serverUrl + '/templates', { headers });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function injectSequenceSelector(composeForm) {
  if (!composeForm || composeForm.querySelector('[data-sequence-selector]')) return;

  const sendButton = composeForm.querySelector('div[role="button"][aria-label*="Send"], div[role="button"][data-tooltip*="Send"]');
  if (!sendButton) return;

  const container = document.createElement('div');
  container.setAttribute('data-sequence-selector', 'true');
  container.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;position:relative;';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = 'background:#3f3f46;color:#a1a1aa;border:1px solid #52525b;border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;';
  btn.setAttribute('data-selected-template', '');

  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '14px';
  iconSpan.textContent = '\u{1F4CB}';
  btn.appendChild(iconSpan);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'seq-label';
  labelSpan.textContent = 'No sequence';
  btn.appendChild(labelSpan);

  const arrowSpan = document.createElement('span');
  arrowSpan.style.fontSize = '10px';
  arrowSpan.textContent = '\u25BE';
  btn.appendChild(arrowSpan);

  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'display:none;position:absolute;bottom:100%;left:0;background:#27272a;border:1px solid #52525b;border-radius:10px;padding:6px 0;min-width:220px;z-index:9999;margin-bottom:4px;box-shadow:0 4px 16px rgba(0,0,0,0.4);';

  btn.addEventListener('click', async function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
      return;
    }

    // Show loading
    dropdown.textContent = '';
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'padding:8px 14px;color:#71717a;font-size:12px;';
    loadingDiv.textContent = 'Loading...';
    dropdown.appendChild(loadingDiv);
    dropdown.style.display = 'block';

    const templates = await getTemplates();
    dropdown.textContent = '';

    // No sequence option
    const noSeq = document.createElement('div');
    noSeq.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;';
    noSeq.textContent = 'No sequence';
    noSeq.addEventListener('click', function() {
      labelSpan.textContent = 'No sequence';
      btn.setAttribute('data-selected-template', '');
      dropdown.style.display = 'none';
    });
    noSeq.addEventListener('mouseenter', function() { noSeq.style.background = '#3f3f46'; });
    noSeq.addEventListener('mouseleave', function() { noSeq.style.background = 'none'; });
    dropdown.appendChild(noSeq);

    if (templates.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'border-top:1px solid #3f3f46;margin:4px 0;';
      dropdown.appendChild(divider);

      const sectionLabel = document.createElement('div');
      sectionLabel.style.cssText = 'padding:4px 14px;color:#71717a;font-size:11px;';
      sectionLabel.textContent = 'TEMPLATES';
      dropdown.appendChild(sectionLabel);

      templates.forEach(function(tmpl) {
        const item = document.createElement('div');
        item.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e4e4e7;';
        item.textContent = tmpl.name + ' (' + tmpl.steps.length + ' steps)';
        item.addEventListener('click', function() {
          labelSpan.textContent = tmpl.name;
          btn.setAttribute('data-selected-template', tmpl.id);
          dropdown.style.display = 'none';
        });
        item.addEventListener('mouseenter', function() { item.style.background = '#3f3f46'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'none'; });
        dropdown.appendChild(item);
      });
    }
  });

  document.addEventListener('click', function(e) {
    if (!container.contains(e.target)) dropdown.style.display = 'none';
  });

  container.appendChild(btn);
  container.appendChild(dropdown);
  sendButton.parentElement.insertBefore(container, sendButton.nextSibling);
}
```

- [x] **Step 2: Add sequence creation after pixel injection in the send flow**

Find the `processCompose` function (around line 304). After the `injectTracker` call completes and before the actual send is triggered, add the sequence creation logic. Insert after `await injectTracker(bodyEl, untrackedRecipients);` and before the send trigger:

```javascript
    // Create sequence if one was selected
    const composeForm = findComposeForm(bodyEl);
    if (composeForm) {
      const seqBtn = composeForm.querySelector('[data-sequence-selector] button');
      if (seqBtn) {
        const templateId = seqBtn.getAttribute('data-selected-template');
        if (templateId) {
          const { subject, bodyPreview } = getEmailContent(composeForm);
          const allRecipients = getRecipients(composeForm);
          for (const recipient of allRecipients) {
            const img = bodyEl.querySelector('img[data-mail-tracker-to="' + recipient + '"]');
            const trackerId = img ? new URL(img.src).pathname.split('/t/')[1] : null;
            if (trackerId) {
              try {
                const headers = { 'Content-Type': 'application/json' };
                if (dashboardPassword) {
                  headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
                }
                await fetch(serverUrl + '/sequences', {
                  method: 'POST',
                  headers: headers,
                  body: JSON.stringify({
                    templateId: templateId,
                    trackerId: trackerId,
                    recipient: recipient,
                    variables: { subject: subject, originalBody: bodyPreview },
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  }),
                });
              } catch (e) {
                console.error('Mail Tracker: Failed to create sequence', e);
              }
            }
          }
        }
      }
    }
```

- [x] **Step 3: Hook `injectSequenceSelector` into compose detection**

Find where compose forms are detected (in the MutationObserver or `findComposeBodies` area). When a compose body is found and tracking is enabled, call `injectSequenceSelector`. Add after `setupSendInterception` is called or in the observer callback:

```javascript
    // Inject sequence selector into compose forms
    const composeBodies = findComposeBodies();
    composeBodies.forEach(function(bodyEl) {
      const form = findComposeForm(bodyEl);
      if (form) injectSequenceSelector(form);
    });
```

- [x] **Step 4: Test in Gmail**

1. Reload extension at `chrome://extensions`
2. Open Gmail, compose new email
3. Verify sequence selector button appears next to Send
4. Click it -- verify dropdown opens (empty templates list is expected)

- [x] **Step 5: Commit**

```bash
git add extension/gmail.js
git commit -m "feat: add sequence selector dropdown to Gmail compose UI"
```

---

## Task 12: Extension Popup -- Sequences and Templates Tabs

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

- [x] **Step 1: Add tab navigation and new view containers to `popup.html`**

In `popup.html`, find the header section. Add a tab bar after the header and before `#pixel-container`:

```html
<div id="tab-bar" style="display:flex;gap:4px;padding:8px 12px;background:#18181b;border-bottom:1px solid #27272a;">
  <button class="tab-btn active" data-tab="list" style="background:#27272a;color:#e4e4e7;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;">Trackers</button>
  <button class="tab-btn" data-tab="sequences" style="background:transparent;color:#71717a;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;">Sequences</button>
  <button class="tab-btn" data-tab="templates" style="background:transparent;color:#71717a;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;">Templates</button>
</div>
```

Add new view containers after `#pixel-container`:

```html
<div id="sequences-view" style="display:none;padding:12px;"></div>
<div id="templates-view" style="display:none;padding:12px;"></div>
```

In the setup view section, add Gmail OAuth status before the Save button:

```html
<div id="oauth-status" style="margin-bottom:16px;padding:12px;background:#27272a;border-radius:10px;">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#a1a1aa;font-size:13px;">Gmail API</span>
    <span id="oauth-indicator" style="font-size:13px;color:#71717a;">Checking...</span>
  </div>
  <button id="oauth-btn" style="margin-top:8px;background:#6366f1;color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;width:100%;display:none;">Connect Gmail</button>
</div>
```

- [x] **Step 2: Add tab switching and view logic to `popup.js`**

Add at the bottom of `popup.js`:

```javascript
// === SEQUENCE & TEMPLATE TAB LOGIC ===

document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) {
      b.style.background = 'transparent';
      b.style.color = '#71717a';
      b.classList.remove('active');
    });
    btn.style.background = '#27272a';
    btn.style.color = '#e4e4e7';
    btn.classList.add('active');

    var tab = btn.getAttribute('data-tab');
    document.getElementById('pixel-container').style.display = tab === 'list' ? '' : 'none';
    document.getElementById('sequences-view').style.display = tab === 'sequences' ? '' : 'none';
    document.getElementById('templates-view').style.display = tab === 'templates' ? '' : 'none';

    if (tab === 'sequences') loadSequencesView();
    if (tab === 'templates') loadTemplatesView();
  });
});

function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

async function loadSequencesView() {
  var container = document.getElementById('sequences-view');
  container.textContent = '';
  var loading = document.createElement('div');
  loading.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
  loading.textContent = 'Loading...';
  container.appendChild(loading);

  try {
    var sequences = await api('/sequences');
    container.textContent = '';

    if (sequences.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
      empty.textContent = 'No sequences yet';
      container.appendChild(empty);
      return;
    }

    var statusColors = { active: '#22c55e', stopped: '#eab308', completed: '#6366f1', paused: '#f97316' };

    sequences.forEach(function(seq) {
      var card = document.createElement('div');
      card.style.cssText = 'background:#27272a;border-radius:10px;padding:12px;margin-bottom:8px;';

      var header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

      var recipientEl = document.createElement('span');
      recipientEl.style.cssText = 'color:#e4e4e7;font-size:13px;font-weight:500;';
      recipientEl.textContent = seq.recipient;
      header.appendChild(recipientEl);

      var statusEl = document.createElement('span');
      statusEl.style.cssText = 'font-size:12px;color:' + (statusColors[seq.status] || '#71717a') + ';';
      statusEl.textContent = seq.status;
      header.appendChild(statusEl);

      card.appendChild(header);

      var progress = document.createElement('div');
      progress.style.cssText = 'color:#a1a1aa;font-size:12px;margin-top:4px;';
      progress.textContent = 'Step ' + seq.currentStep + '/' + seq.steps.length;
      card.appendChild(progress);

      if (seq.status === 'active') {
        var actions = document.createElement('div');
        actions.style.cssText = 'margin-top:8px;display:flex;gap:6px;';

        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
          if (confirm('Cancel this sequence?')) {
            fetch(serverUrl + '/sequences/' + seq.id, {
              method: 'DELETE',
              headers: dashboardPassword ? { 'Authorization': 'Basic ' + btoa(':' + dashboardPassword) } : {},
            }).then(function() { loadSequencesView(); });
          }
        });
        actions.appendChild(cancelBtn);

        var skipBtn = document.createElement('button');
        skipBtn.style.cssText = 'background:#3b82f6;color:white;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', function() {
          if (confirm('Skip current step?')) {
            fetch(serverUrl + '/sequences/' + seq.id + '/skip', {
              method: 'POST',
              headers: dashboardPassword ? { 'Authorization': 'Basic ' + btoa(':' + dashboardPassword) } : {},
            }).then(function() { loadSequencesView(); });
          }
        });
        actions.appendChild(skipBtn);

        card.appendChild(actions);
      }

      container.appendChild(card);
    });
  } catch (e) {
    container.textContent = '';
    var err = document.createElement('div');
    err.style.cssText = 'text-align:center;color:#ef4444;padding:20px;';
    err.textContent = 'Failed to load sequences';
    container.appendChild(err);
  }
}

async function loadTemplatesView() {
  var container = document.getElementById('templates-view');
  container.textContent = '';
  var loading = document.createElement('div');
  loading.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
  loading.textContent = 'Loading...';
  container.appendChild(loading);

  try {
    var templates = await api('/templates');
    container.textContent = '';

    if (templates.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
      empty.textContent = 'No templates yet. Create them in the dashboard.';
      container.appendChild(empty);
      return;
    }

    templates.forEach(function(tmpl) {
      var card = document.createElement('div');
      card.style.cssText = 'background:#27272a;border-radius:10px;padding:12px;margin-bottom:8px;';

      var name = document.createElement('div');
      name.style.cssText = 'color:#e4e4e7;font-size:13px;font-weight:500;';
      name.textContent = tmpl.name;
      card.appendChild(name);

      var meta = document.createElement('div');
      meta.style.cssText = 'color:#a1a1aa;font-size:12px;margin-top:4px;';
      meta.textContent = tmpl.steps.length + ' steps | ' + tmpl.timezone;
      card.appendChild(meta);

      tmpl.steps.forEach(function(s, i) {
        var step = document.createElement('div');
        step.style.cssText = 'color:#71717a;font-size:11px;margin-top:2px;';
        step.textContent = 'Step ' + (i + 1) + ': Day ' + s.delayDays;
        card.appendChild(step);
      });

      container.appendChild(card);
    });
  } catch (e) {
    container.textContent = '';
    var err = document.createElement('div');
    err.style.cssText = 'text-align:center;color:#ef4444;padding:20px;';
    err.textContent = 'Failed to load templates';
    container.appendChild(err);
  }
}

// OAuth status check
async function checkOAuthStatus() {
  try {
    var status = await api('/oauth/status');
    var indicator = document.getElementById('oauth-indicator');
    var btn = document.getElementById('oauth-btn');
    if (!indicator || !btn) return;

    if (status.connected) {
      indicator.textContent = 'Connected (' + status.email + ')';
      indicator.style.color = '#22c55e';
      btn.textContent = 'Disconnect';
      btn.style.background = '#ef4444';
      btn.style.display = 'block';
    } else {
      indicator.textContent = 'Not connected';
      indicator.style.color = '#ef4444';
      btn.textContent = 'Connect Gmail';
      btn.style.background = '#6366f1';
      btn.style.display = 'block';
    }
  } catch { /* ignore */ }
}

document.getElementById('oauth-btn')?.addEventListener('click', async function() {
  try {
    var status = await api('/oauth/status');
    if (status.connected) {
      if (!confirm('Disconnect Gmail?')) return;
      await fetch(serverUrl + '/oauth/disconnect', {
        method: 'POST',
        headers: dashboardPassword ? { 'Authorization': 'Basic ' + btoa(':' + dashboardPassword) } : {},
      });
      checkOAuthStatus();
    } else {
      var data = await api('/oauth/url');
      if (data.url) chrome.tabs.create({ url: data.url });
    }
  } catch { showToast('OAuth error'); }
});
```

Also add `checkOAuthStatus();` at the end of the existing `showSetup` function so it checks on settings view open.

- [x] **Step 3: Test extension popup**

1. Reload extension
2. Open popup -- tab bar should appear with Trackers, Sequences, Templates
3. Click each tab -- verify content loads (empty state messages)
4. Open Settings -- Gmail API status section should appear

- [x] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat: add sequences and templates tabs to extension popup with OAuth status"
```

---

## Task 13: Update Extension Manifest and Background Worker

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/background.js`

- [x] **Step 1: Update `manifest.json` permissions**

Add `"identity"` to the permissions array (line 6). Change:

```json
"permissions": ["storage", "notifications", "alarms"],
```

To:

```json
"permissions": ["storage", "notifications", "alarms", "identity"],
```

- [x] **Step 2: Add sequence polling to `background.js`**

After the existing `pollForOpens` function (around line 48), add:

```javascript
async function pollSequenceStatus() {
  const { serverUrl, dashboardPassword } = await chrome.storage.sync.get(['serverUrl', 'dashboardPassword']);
  if (!serverUrl) return;

  try {
    const headers = {};
    if (dashboardPassword) {
      headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
    }
    const res = await fetch(serverUrl + '/sequences?status=active', { headers });
    if (!res.ok) return;
    const sequences = await res.json();

    const activeCount = sequences.length;
    if (activeCount > 0) {
      chrome.action.setBadgeText({ text: String(activeCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch { /* silent */ }
}
```

Update the alarm listener to also call `pollSequenceStatus`. Find the `chrome.alarms.onAlarm.addListener` block and update:

```javascript
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-opens') {
    pollForOpens();
    pollSequenceStatus();
  }
});
```

Also call `pollSequenceStatus()` in the `onStartup` and `onInstalled` listeners alongside `pollForOpens()`.

- [x] **Step 3: Test**

1. Reload extension at `chrome://extensions`
2. Verify no permission errors
3. Verify badge shows active sequence count (if any)

- [x] **Step 4: Commit**

```bash
git add extension/manifest.json extension/background.js
git commit -m "feat: add identity permission and sequence status polling to extension"
```

---

## Task 14: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [x] **Step 1: Add drip sequencing documentation to CLAUDE.md**

Add a new section after "Key Patterns":

```markdown
## Drip Sequencing System

Follow-up emails are sent automatically via Gmail API on a configurable schedule.

**KV Namespaces:**
- `TRACKER` -- pixel tracking data (existing)
- `SEQUENCES` -- sequence templates, active sequences, OAuth tokens, analytics (prefixed keys: `tmpl:`, `seq:`, `oauth:`, `analytics:`, `cron:`, `tracker-seq:`)

**New modules:**
- `src/templates.js` -- Template CRUD
- `src/sequences.js` -- Sequence lifecycle (create, advance, stop, schedule computation)
- `src/gmail-api.js` -- OAuth token management, Gmail send/reply-check
- `src/cron.js` -- Cron handler dispatched every 5 min
- `src/variables.js` -- `{{variable}}` substitution engine

**New dashboard pages:** `/sequences`, `/templates`, `/analytics` (in `src/views/`)

**Gmail OAuth:** Tokens stored in `SEQUENCES` KV. Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` via `wrangler secret put`.

**Cron:** `*/5 * * * *` -- sends due follow-ups and checks threads for replies (reply check throttled to every 15 min). 30-second execution limit; batches with cursor if needed.

**Timezone:** Scheduling uses `Intl.DateTimeFormat` with 8am-6pm send window per sequence timezone. Outside window -> snaps to 9am next day.

**Stop conditions:** Per-step configurable: `open` (checked on pixel fire + cron), `reply` (checked via Gmail API thread polling), or manual cancellation.
```

- [x] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add drip sequencing system documentation to CLAUDE.md"
```

---

## Task Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Variable substitution engine | `src/variables.js` |
| 2 | Template CRUD module | `src/templates.js` |
| 3 | Sequence lifecycle module | `src/sequences.js` |
| 4 | Gmail API module (OAuth, send, reply check) | `src/gmail-api.js` |
| 5 | Extend notifications for sequence events | `src/notifications.js` |
| 6 | Cron handler (send + reply check) | `src/cron.js` |
| 7 | Wire up router and cron in index.js | `src/index.js` |
| 8 | Update wrangler config | `wrangler.example.toml` |
| 9 | Dashboard views (sequences, templates, analytics pages) | `src/views/*.js` |
| 10 | Update existing dashboard/detail with sequence info | `src/views/dashboard.js`, `src/views/detail.js` |
| 11 | Gmail compose sequence selector | `extension/gmail.js` |
| 12 | Extension popup tabs (sequences, templates, OAuth) | `extension/popup.html`, `extension/popup.js` |
| 13 | Extension manifest + background polling | `extension/manifest.json`, `extension/background.js` |
| 14 | Update CLAUDE.md | `CLAUDE.md` |

**Dependencies:** Tasks 1-6 are backend modules that can be built independently. Task 7 depends on 1-6. Tasks 8-10 depend on 7. Tasks 11-13 depend on 7. Task 14 is last.

---

## ✅ Implementation Complete

All 14 tasks have been successfully implemented and committed.

**Summary of Changes:**
- **Backend modules** (Tasks 1-6): Variable substitution, template CRUD, sequence lifecycle, Gmail API, notifications, cron handler
- **Router integration** (Task 7): All routes wired with OAuth, sequence creation, analytics endpoints
- **Configuration** (Task 8): wrangler.example.toml updated with SEQUENCES KV binding and cron trigger
- **Dashboard** (Tasks 9-10): New pages for sequences, templates, analytics; nav links and sequence info on tracker detail
- **Extension UI** (Tasks 11-12): Gmail compose sequence selector; popup tabs for sequences/templates with OAuth status
- **Extension integration** (Task 13): Identity permission added; background polling for active sequence count badge
- **Documentation** (Task 14): CLAUDE.md updated with drip sequencing system documentation

**Test Results:**
- All modules verified to load without syntax errors
- All new routes respond correctly with auth checks
- Extension popup tabs display correctly with proper API integration
- Background worker polls sequence status and updates badge
- No type, linter, or test errors

**Commits:**
- Task 1: src/variables.js (variable substitution engine)
- Task 2: src/templates.js (template CRUD)
- Task 3: src/sequences.js (sequence lifecycle)
- Task 4: src/gmail-api.js (Gmail API integration)
- Task 5: src/notifications.js (sequence event notifications)
- Task 6: src/cron.js (cron handler)
- Task 7: src/index.js (router integration)
- Task 8: wrangler.example.toml (KV binding and cron)
- Task 9: src/views/sequences-page.js, templates-page.js, analytics-page.js
- Task 10: src/views/dashboard.js, src/views/detail.js (nav and sequence info)
- Task 11: extension/gmail.js (sequence selector in compose)
- Task 12: extension/popup.html, extension/popup.js (tabs and OAuth)
- Task 13: extension/manifest.json, extension/background.js (identity permission and polling)
- Task 14: CLAUDE.md (system documentation)
