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

  // Re-activate any sequences that were paused due to OAuth issues
  const seqKeys = await env.SEQUENCES.list({ prefix: 'seq:' });
  for (const key of seqKeys.keys) {
    const seq = await env.SEQUENCES.get(key.name, 'json');
    if (seq && seq.status === 'paused') {
      seq.status = 'active';
      await env.SEQUENCES.put(key.name, JSON.stringify(seq));
    }
  }

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
 * Strip \r and \n from a header value to prevent header injection.
 */
function sanitizeHeader(value) {
  return String(value).replace(/[\r\n]/g, '');
}

/**
 * Build an RFC 2822 MIME message and base64url encode it.
 */
function buildMimeMessage({ to, subject, body, from, bcc, inReplyTo, references }) {
  const lines = [];

  if (from) {
    lines.push(`From: ${sanitizeHeader(from)}`);
  }

  lines.push(
    `To: ${sanitizeHeader(to)}`,
  );

  if (bcc) {
    lines.push(`Bcc: ${sanitizeHeader(bcc)}`);
  }

  lines.push(
    `Subject: ${sanitizeHeader(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
  );

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${sanitizeHeader(inReplyTo)}`);
    lines.push(`References: ${sanitizeHeader(references || inReplyTo)}`);
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
export async function sendFollowUp(env, { to, subject, body, threadId, inReplyTo, bcc }) {
  const { token, error } = await getAccessToken(env);
  if (error) return { error, status: 401 };

  // Read the authenticated user's email for the From header
  const tokenData = await env.SEQUENCES.get('oauth:tokens', 'json');
  const fromEmail = tokenData?.email || null;

  const raw = buildMimeMessage({
    to,
    subject,
    body,
    from: fromEmail,
    bcc: bcc || null,
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
