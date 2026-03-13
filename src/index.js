import { CORS_HEADERS, DEDUP_WINDOW_MS, json, isBot, checkAuth, requireAuth, requireAuthCors, servePixel, html } from './shared.js';
import { sendWebhookNotifications } from './notifications.js';
import { renderDetail } from './views/detail.js';
import { renderDashboard } from './views/dashboard.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // GET /t/:id — track pixel open
    if (url.pathname.startsWith('/t/')) {
      const id = url.pathname.split('/t/')[1];
      if (!id) return new Response('Missing id', { status: 400 });

      const existing = await env.TRACKER.get(id, 'json');
      if (!existing) return servePixel();

      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const country = request.headers.get('cf-ipcountry') || 'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const now = new Date().toISOString();

      // Filter 1: Sender IP exclusion
      if (existing.senderIp && existing.senderIp === ip) {
        existing.skipped = (existing.skipped || 0) + 1;
        existing.filteredEvents = existing.filteredEvents || [];
        existing.filteredEvents.push({ time: now, ip, reason: 'sender_ip' });
        if (existing.filteredEvents.length > 20) existing.filteredEvents = existing.filteredEvents.slice(-20);
        await env.TRACKER.put(id, JSON.stringify(existing));
        return servePixel();
      }

      // Filter 2: Bot/proxy detection
      if (isBot(userAgent)) {
        existing.skipped = (existing.skipped || 0) + 1;
        existing.filteredEvents = existing.filteredEvents || [];
        existing.filteredEvents.push({ time: now, ip, userAgent, reason: 'bot_proxy' });
        if (existing.filteredEvents.length > 20) existing.filteredEvents = existing.filteredEvents.slice(-20);
        await env.TRACKER.put(id, JSON.stringify(existing));
        return servePixel();
      }

      // Filter 3: Dedup window (same IP within 5s)
      const lastEvent = existing.events.length > 0 ? existing.events[existing.events.length - 1] : null;
      if (lastEvent && lastEvent.ip === ip) {
        const lastTime = new Date(lastEvent.time).getTime();
        if (new Date(now).getTime() - lastTime < DEDUP_WINDOW_MS) return servePixel();
      }

      // Genuine open
      existing.opens += 1;
      existing.events.push({ time: now, ip, country, userAgent });
      if (existing.events.length > 100) existing.events = existing.events.slice(-100);
      await env.TRACKER.put(id, JSON.stringify(existing));

      // Send webhook notifications
      const timeStr = new Date(now).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      const timezone = new Date(now).toLocaleString('en-US', { timeZoneName: 'short' }).split(' ').pop();

      await sendWebhookNotifications(env, {
        recipient: existing.recipient,
        subject: existing.subject,
        opens: existing.opens,
        country, ip,
        time: `${timeStr} (${timezone})`
      });

      return servePixel();
    }

    // GET /s/:id — stats for a tracking pixel
    if (url.pathname.startsWith('/s/')) {
      if (!checkAuth(request, env)) return requireAuth();

      const id = url.pathname.split('/s/')[1];
      if (!id) return new Response('Missing id', { status: 400 });

      const data = await env.TRACKER.get(id, 'json');
      if (!data) return new Response('Tracker not found', { status: 404 });

      const acceptsJson = request.headers.get('accept')?.includes('application/json');
      const formatJson = url.searchParams.get('format') === 'json';

      if (acceptsJson || formatJson) {
        const { senderIp, ...safeData } = data;
        return json({ ...safeData, recipient: data.recipient || null, hasSenderProtection: !!senderIp });
      }

      return html(renderDetail(id, data));
    }

    // GET/POST /new — create a new tracking pixel
    if (url.pathname === '/new') {
      if (!checkAuth(request, env)) return requireAuthCors();

      const id = crypto.randomUUID().slice(0, 8);
      const senderIp = request.headers.get('cf-connecting-ip') || 'unknown';

      let recipient = null, subject = '', bodyPreview = '', messageId = '';

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

      if (recipient && !recipient.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return json({ error: 'Invalid email format' }, 400);
      if (subject.length > 500 || bodyPreview.length > 1000) return json({ error: 'Input too long' }, 400);

      await env.TRACKER.put(id, JSON.stringify({
        opens: 0, events: [], filteredEvents: [], skipped: 0,
        senderIp, recipient, subject, bodyPreview, messageId,
        createdAt: new Date().toISOString(),
      }));

      const base = url.origin;
      return json({
        id, pixel: `${base}/t/${id}`,
        html: `<img src="${base}/t/${id}" width="1" height="1" style="display:none" />`,
        stats: `${base}/s/${id}`, recipient, subject, bodyPreview,
      });
    }

    // GET /list — JSON API for extension
    if (url.pathname === '/list') {
      if (!checkAuth(request, env)) return requireAuthCors();

      const list = await env.TRACKER.list();
      const results = [];
      for (const key of list.keys) {
        const data = await env.TRACKER.get(key.name, 'json');
        results.push({
          id: key.name, opens: data?.opens || 0, skipped: data?.skipped || 0,
          recipient: data?.recipient || null, subject: data?.subject || '',
          bodyPreview: data?.bodyPreview || '', messageId: data?.messageId || '',
          lastOpen: data?.events?.length ? data.events[data.events.length - 1].time : null,
        });
      }
      return json(results);
    }

    // GET /d/:id — delete a tracking pixel
    if (url.pathname.startsWith('/d/') && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const id = url.pathname.split('/d/')[1];
      if (!id) return json({ error: 'Missing id' }, 400);
      await env.TRACKER.delete(id);
      return json({ deleted: id });
    }

    // GET / — dashboard
    if (url.pathname === '/') {
      if (!checkAuth(request, env)) return requireAuth();

      const list = await env.TRACKER.list();
      const results = [];
      for (const key of list.keys) {
        const data = await env.TRACKER.get(key.name, 'json');
        results.push({
          id: key.name, email: data?.recipient || key.name,
          subject: data?.subject || '', bodyPreview: data?.bodyPreview || '',
          opens: data?.opens || 0,
          lastOpen: data?.events?.length ? data.events[data.events.length - 1].time : 'never',
          createdAt: data?.createdAt || null,
        });
      }

      results.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const totalOpens = results.reduce((s, r) => s + r.opens, 0);
      const activeCount = results.filter(r => r.opens > 0).length;

      return html(renderDashboard(results, totalOpens, activeCount));
    }

    return new Response('Not found', { status: 404 });
  },
};
