// 1x1 transparent PNG pixel
const PIXEL = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0));

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Known email proxy/prefetch bot patterns
const BOT_PATTERNS = [
  /Yahoo! Slurp/i,
  /Outlook-iOS/i,
  /Microsoft Outlook/i,
  /ms-office/i,
  /BCLinked/i,             // Barracuda link protection
  /Safelinks/i,            // Outlook SafeLinks
  /YahooMailProxy/i,
  /Thunderbird/i,
];

const DEDUP_WINDOW_MS = 5000; // 5 second dedup window

function formatTime(isoString) {
  return new Date(isoString).toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
}

function checkAuth(request, env) {
  if (!env.DASHBOARD_PASSWORD) return true; // no password set, allow access
  
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;
  
  const base64 = authHeader.slice(6);
  const decoded = atob(base64);
  const [, password] = decoded.split(':');
  
  return password === env.DASHBOARD_PASSWORD;
}

function requireAuth() {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Mail Tracker Dashboard"',
    },
  });
}

function servePixel() {
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // GET /t/:id — track pixel open
    if (url.pathname.startsWith('/t/')) {
      const id = url.pathname.split('/t/')[1];
      if (!id) return new Response('Missing id', { status: 400 });

      const existing = await env.TRACKER.get(id, 'json');
      if (!existing) return servePixel(); // unknown pixel, just serve image

      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const country = request.headers.get('cf-ipcountry') || 'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const now = new Date().toISOString();

      // --- Filter 1: Sender IP exclusion ---
      // If opener's IP matches the IP that created the pixel, skip tracking
      if (existing.senderIp && existing.senderIp === ip) {
        existing.skipped = (existing.skipped || 0) + 1;
        existing.filteredEvents = existing.filteredEvents || [];
        existing.filteredEvents.push({ time: now, ip, reason: 'sender_ip' });
        if (existing.filteredEvents.length > 20) {
          existing.filteredEvents = existing.filteredEvents.slice(-20);
        }
        await env.TRACKER.put(id, JSON.stringify(existing));
        return servePixel();
      }

      // --- Filter 2: Bot/proxy detection ---
      if (isBot(userAgent)) {
        existing.skipped = (existing.skipped || 0) + 1;
        existing.filteredEvents = existing.filteredEvents || [];
        existing.filteredEvents.push({ time: now, ip, userAgent, reason: 'bot_proxy' });
        if (existing.filteredEvents.length > 20) {
          existing.filteredEvents = existing.filteredEvents.slice(-20);
        }
        await env.TRACKER.put(id, JSON.stringify(existing));
        return servePixel();
      }

      // --- Filter 3: Dedup window (same IP within 5s) ---
      const lastEvent = existing.events.length > 0
        ? existing.events[existing.events.length - 1]
        : null;
      if (lastEvent && lastEvent.ip === ip) {
        const lastTime = new Date(lastEvent.time).getTime();
        const nowTime = new Date(now).getTime();
        if (nowTime - lastTime < DEDUP_WINDOW_MS) {
          return servePixel(); // silently skip, don't even log
        }
      }

      // --- Genuine open: record it ---
      existing.opens += 1;
      existing.events.push({ time: now, ip, country, userAgent });

      // Keep only last 100 events
      if (existing.events.length > 100) {
        existing.events = existing.events.slice(-100);
      }

      await env.TRACKER.put(id, JSON.stringify(existing));
      return servePixel();
    }

    // GET /s/:id — stats for a tracking pixel
    if (url.pathname.startsWith('/s/')) {
      if (!checkAuth(request, env)) return requireAuth();
      
      const id = url.pathname.split('/s/')[1];
      if (!id) return new Response('Missing id', { status: 400 });

      const data = await env.TRACKER.get(id, 'json');
      if (!data) return new Response('Tracker not found', { status: 404 });

      // Check if JSON is requested via Accept header or ?format=json
      const acceptsJson = request.headers.get('accept')?.includes('application/json');
      const formatJson = url.searchParams.get('format') === 'json';
      
      if (acceptsJson || formatJson) {
        const { senderIp, ...safeData } = data;
        return json({
          ...safeData,
          recipient: data.recipient || null,
          hasSenderProtection: !!senderIp,
        });
      }

      // Serve HTML dashboard
      const events = data.events || [];
      const filteredEvents = data.filteredEvents || [];
      const recipient = data.recipient || id;
      
      const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Tracker: ${recipient}</title>
<style>
  body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #0a0a0a; color: #e0e0e0; }
  h1 { font-size: 1.4rem; margin-bottom: 8px; }
  .subtitle { color: #888; margin-bottom: 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .stat { background: #111; padding: 16px; border-radius: 8px; text-align: center; }
  .stat-value { font-size: 1.8rem; font-weight: bold; color: #34d399; }
  .stat-label { color: #888; font-size: 0.85rem; margin-top: 4px; }
  .section { margin-bottom: 32px; }
  .section h2 { font-size: 1.1rem; margin-bottom: 12px; color: #888; }
  .event { background: #111; padding: 12px 16px; border-radius: 6px; margin-bottom: 8px; }
  .event-time { font-weight: bold; color: #60a5fa; }
  .event-details { color: #ccc; font-size: 0.9rem; margin-top: 4px; }
  .filtered { background: #1a1a1a; border-left: 3px solid #f59e0b; }
  .back-btn { display: inline-block; margin-bottom: 20px; padding: 8px 16px; background: #374151; color: white; text-decoration: none; border-radius: 6px; font-size: 0.9rem; }
  .back-btn:hover { background: #4b5563; }
  .protection { color: #34d399; font-size: 0.85rem; }
</style></head>
<body>
  <a href="/" class="back-btn">← Back to Dashboard</a>
  <h1>${recipient}</h1>
  <div class="subtitle">Tracker ID: ${id}</div>
  
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${data.opens || 0}</div>
      <div class="stat-label">Real Opens</div>
    </div>
    <div class="stat">
      <div class="stat-value">${data.skipped || 0}</div>
      <div class="stat-label">Filtered</div>
    </div>
    <div class="stat">
      <div class="stat-value">${events.length}</div>
      <div class="stat-label">Total Events</div>
    </div>
  </div>

  ${data.senderIp ? '<div class="protection">&check; Sender Protection Active</div>' : ''}

  <div class="section">
    <h2>Recent Opens</h2>
    ${events.length === 0 ? '<p style="color:#666;">No opens yet</p>' : ''}
    <div id="events"></div>
  </div>

  ${filteredEvents.length > 0 ? `
  <div class="section">
    <h2>Filtered Events</h2>
    <div id="filtered"></div>
  </div>
  ` : ''}

  <script>
    function formatTime(isoString) {
      return new Date(isoString).toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }

    const events = ${JSON.stringify(events)};
    const filtered = ${JSON.stringify(filteredEvents)};
    
    const eventsDiv = document.getElementById('events');
    events.slice(-20).reverse().forEach(e => {
      const div = document.createElement('div');
      div.className = 'event';
      div.innerHTML = \`
        <div class="event-time">\${formatTime(e.time)}</div>
        <div class="event-details">\${e.country} &bull; \${e.ip}</div>
      \`;
      eventsDiv.appendChild(div);
    });

    const filteredDiv = document.getElementById('filtered');
    if (filteredDiv) {
      filtered.slice(-10).reverse().forEach(e => {
        const div = document.createElement('div');
        div.className = 'event filtered';
        const reason = e.reason === 'sender_ip' ? 'Your own open' : 'Bot/Proxy detected';
        div.innerHTML = \`
          <div class="event-time">\${formatTime(e.time)} &bull; \${reason}</div>
          <div class="event-details">\${e.ip}</div>
        \`;
        filteredDiv.appendChild(div);
      });
    }
  </script>
</body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    // GET/POST /new — create a new tracking pixel ID
    // GET ?to=email@example.com — optional recipient for per-email tracking
    // POST with JSON body: { to, subject, bodyPreview }
    // Stores the creator's IP so their own opens are filtered out
    if (url.pathname === '/new') {
      if (!checkAuth(request, env)) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="Mail Tracker Dashboard"',
            ...CORS_HEADERS,
          },
        });
      }
      
      const id = crypto.randomUUID().slice(0, 8);
      const senderIp = request.headers.get('cf-connecting-ip') || 'unknown';
      
      let recipient = null;
      let subject = '';
      let bodyPreview = '';
      let messageId = '';
      
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          recipient = body.to || null;
          subject = body.subject || '';
          bodyPreview = body.bodyPreview || '';
          messageId = body.messageId || '';
        } catch (e) {
          return json({ error: 'Invalid JSON body' }, 400);
        }
      } else {
        recipient = url.searchParams.get('to') || null;
      }

      // Validate email format
      if (recipient && !recipient.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        return json({ error: 'Invalid email format' }, 400);
      }

      // Limit string lengths
      if (subject.length > 500 || bodyPreview.length > 1000) {
        return json({ error: 'Input too long' }, 400);
      }

      await env.TRACKER.put(id, JSON.stringify({
        opens: 0,
        events: [],
        filteredEvents: [],
        skipped: 0,
        senderIp,
        recipient,
        subject,
        bodyPreview,
        messageId,
        createdAt: new Date().toISOString(),
      }));

      const base = url.origin;
      return json({
        id,
        pixel: `${base}/t/${id}`,
        html: `<img src="${base}/t/${id}" width="1" height="1" style="display:none" />`,
        stats: `${base}/s/${id}`,
        recipient,
        subject,
        bodyPreview,
      });
    }

    // GET /list — JSON API for extension
    if (url.pathname === '/list') {
      if (!checkAuth(request, env)) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="Mail Tracker Dashboard"',
            ...CORS_HEADERS,
          },
        });
      }
      
      const list = await env.TRACKER.list();
      const results = [];
      for (const key of list.keys) {
        const data = await env.TRACKER.get(key.name, 'json');
        results.push({
          id: key.name,
          opens: data?.opens || 0,
          skipped: data?.skipped || 0,
          recipient: data?.recipient || null,
          subject: data?.subject || '',
          bodyPreview: data?.bodyPreview || '',
          messageId: data?.messageId || '',
          lastOpen: data?.events?.length ? data.events[data.events.length - 1].time : null,
        });
      }
      return json(results);
    }

    // DELETE /d/:id — delete a tracking pixel
    if (url.pathname.startsWith('/d/') && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const id = url.pathname.split('/d/')[1];
      if (!id) return json({ error: 'Missing id' }, 400);
      await env.TRACKER.delete(id);
      return json({ deleted: id });
    }

    // GET / — simple dashboard listing all tracked pixels
    if (url.pathname === '/') {
      if (!checkAuth(request, env)) return requireAuth();
      const list = await env.TRACKER.list();
      const results = [];

      for (const key of list.keys) {
        const data = await env.TRACKER.get(key.name, 'json');
        results.push({
          id: key.name,
          email: data?.recipient || key.name,
          subject: data?.subject || '',
          bodyPreview: data?.bodyPreview || '',
          opens: data?.opens || 0,
          lastOpen: data?.events?.length ? data.events[data.events.length - 1].time : 'never',
          createdAt: data?.createdAt || null,
        });
      }

      // Sort by createdAt (newest first)
      results.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const html = `<!DOCTYPE html>
<html><head><title>Mail Tracker</title>
<style>
  body { font-family: system-ui; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #0a0a0a; color: #e0e0e0; }
  h1 { font-size: 1.4rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #222; }
  th { color: #888; font-size: 0.85rem; text-transform: uppercase; }
  a { color: #60a5fa; text-decoration: none; }
  .opens { font-weight: bold; color: #34d399; }
  .subject { font-weight: 500; color: #e0e0e0; }
  .preview { color: #888; font-size: 0.85rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btn { display: inline-block; margin-top: 16px; padding: 8px 16px; background: #1d4ed8; color: white; border-radius: 6px; cursor: pointer; border: none; font-size: 0.9rem; }
  .btn:hover { background: #2563eb; }
</style></head>
<body>
  <h1>Mail Tracker</h1>
  <button class="btn" onclick="createNew()">+ New Tracker</button>
  <table>
    <tr><th>Email</th><th>Subject</th><th>Created</th><th>Opens</th><th>Last Open</th><th>Details</th></tr>
  </table>
  ${results.length === 0 ? '<p style="color:#666;margin-top:20px;">No tracked emails yet. Click "+ New Tracker" to create one.</p>' : ''}
  <script>
    const data = ${JSON.stringify(results)};
    const tbody = document.querySelector('table');
    
    function formatTime(isoString) {
      return new Date(isoString).toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
    
    data.forEach(r => {
      const row = tbody.insertRow();
      row.innerHTML = \`
        <td>\${r.email}</td>
        <td>
          <div class="subject">\${r.subject || 'No subject'}</div>
          <div class="preview">\${r.bodyPreview || ''}</div>
        </td>
        <td>\${r.createdAt ? formatTime(r.createdAt) : 'unknown'}</td>
        <td class="opens">\${r.opens}</td>
        <td>\${r.lastOpen !== 'never' ? formatTime(r.lastOpen) : 'never'}</td>
        <td><a href="/s/\${r.id}">view</a></td>
      \`;
    });

    async function createNew() {
      const res = await fetch('/new');
      const data = await res.json();
      alert('New tracker created!\\n\\nHTML to paste in email:\\n' + data.html + '\\n\\nStats: ' + data.stats);
      location.reload();
    }
  </script>
</body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
