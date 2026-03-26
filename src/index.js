import { CORS_HEADERS, DEDUP_WINDOW_MS, json, isBot, checkAuth, requireAuth, requireAuthCors, servePixel, html, esc } from './shared.js';
import { sendWebhookNotifications } from './notifications.js';
import { renderDetail } from './views/detail.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSequencesPage } from './views/sequences-page.js';
import { renderTemplatesPage } from './views/templates-page.js';
import { renderAnalyticsPage } from './views/analytics-page.js';
import { renderActivityPage } from './views/activity-page.js';
import { renderSettingsPage } from './views/settings-page.js';
import { renderTemplateEditor } from './views/template-editor.js';
import { validateTemplate, listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate } from './templates.js';
import { validateSequence, createSequence, listSequences, getSequence, stopSequence, skipStep, checkOpenStopCondition } from './sequences.js';
import { getOAuthUrl, handleOAuthCallback, getOAuthStatus, disconnectOAuth } from './gmail-api.js';
import { handleCron, recordOpenForAnalytics } from './cron.js';

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

      // Check if this open should stop an active sequence
      if (env.SEQUENCES) {
        await checkOpenStopCondition(env, id);
        await recordOpenForAnalytics(env, id);
      }

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

      let sequenceInfo = null;
      if (env.SEQUENCES) {
        const seqId = await env.SEQUENCES.get(`tracker-seq:${id}`);
        if (seqId) {
          sequenceInfo = await env.SEQUENCES.get(seqId, 'json');
        }
      }

      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;

      return html(renderDetail(id, data, sequenceInfo, oauthConnected));
    }

    // GET/POST /new — create a new tracking pixel
    if (url.pathname === '/new') {
      if (!checkAuth(request, env)) return requireAuthCors();

      const id = crypto.randomUUID().slice(0, 8);
      const senderIp = request.headers.get('cf-connecting-ip') || 'unknown';

      let recipient, subject, bodyPreview, messageId;

      if (request.method === 'POST') {
        try {
          const body = await request.json();
          recipient = body.to || null;
          subject = body.subject || '';
          bodyPreview = body.bodyPreview || '';
          messageId = body.messageId || '';
        } catch (_e) {
          return json({ error: 'Invalid JSON body' }, 400);
        }
      } else {
        recipient = url.searchParams.get('to') || null;
        subject = '';
        bodyPreview = '';
        messageId = '';
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
      if (env.SEQUENCES) {
        const seqId = await env.SEQUENCES.get(`tracker-seq:${id}`);
        if (seqId) {
          await env.SEQUENCES.delete(`tracker-seq:${id}`);
        }
      }
      return json({ deleted: id });
    }

    // GET / — dashboard
    if (url.pathname === '/') {
      if (!checkAuth(request, env)) return requireAuth();

      const list = await env.TRACKER.list();
      const results = [];
      const now = Date.now();
      const sparkline = [0, 0, 0, 0, 0, 0, 0];

      for (const key of list.keys) {
        const data = await env.TRACKER.get(key.name, 'json');
        const result = {
          id: key.name, email: data?.recipient || key.name,
          subject: data?.subject || '', bodyPreview: data?.bodyPreview || '',
          opens: data?.opens || 0,
          lastOpen: data?.events?.length ? data.events[data.events.length - 1].time : 'never',
          createdAt: data?.createdAt || null,
          sequenceProgress: null,
        };

        // Aggregate event timestamps into sparkline (last 7 days)
        if (data?.events) {
          for (const evt of data.events) {
            const eventTime = new Date(evt.time).getTime();
            const dayIndex = 6 - Math.floor((now - eventTime) / 86400000);
            if (dayIndex >= 0 && dayIndex <= 6) {
              sparkline[dayIndex]++;
            }
          }
        }

        if (env.SEQUENCES) {
          const seqId = await env.SEQUENCES.get(`tracker-seq:${key.name}`);
          if (seqId) {
            const seq = await env.SEQUENCES.get(seqId, 'json');
            if (seq) {
              result.sequenceProgress = seq.status === 'completed'
                ? 'Sequence complete'
                : seq.status === 'active'
                  ? `Step ${seq.currentStep + 1}/${seq.steps.length}`
                  : seq.status === 'stopped' ? 'Stopped' : null;
            }
          }
        }
        results.push(result);
      }

      results.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const totalOpens = results.reduce((s, r) => s + r.opens, 0);
      const activeCount = results.filter(r => r.opens > 0).length;

      // Sequence stats
      let sequences = { active: 0, completed: 0, stopped: 0, total: 0 };
      let oauthConnected = false;
      if (env.SEQUENCES) {
        const seqKeys = await env.SEQUENCES.list({ prefix: 'seq:' });
        for (const k of seqKeys.keys) {
          const seq = await env.SEQUENCES.get(k.name, 'json');
          if (seq) {
            sequences.total++;
            if (seq.status === 'active') sequences.active++;
            else if (seq.status === 'completed') sequences.completed++;
            else if (seq.status === 'stopped') sequences.stopped++;
          }
        }
        const tokens = await env.SEQUENCES.get('oauth:tokens');
        oauthConnected = !!tokens;
      }

      return html(renderDashboard({
        results, totalOpens, activeCount, sparkline,
        totalTrackers: results.length, sequences, oauthConnected,
      }));
    }

    // GET /settings — settings page
    if (url.pathname === '/settings' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const trackerKeys = await env.TRACKER.list();
      let templateCount = 0, sequenceCount = 0, oauthEmail = null, oauthError = null;
      let oauthConnected = false;
      if (env.SEQUENCES) {
        const tmplKeys = await env.SEQUENCES.list({ prefix: 'tmpl:' });
        templateCount = tmplKeys.keys.length;
        const seqKeys = await env.SEQUENCES.list({ prefix: 'seq:' });
        sequenceCount = seqKeys.keys.length;
        const tokens = await env.SEQUENCES.get('oauth:tokens', 'json');
        oauthConnected = !!tokens;
        oauthEmail = tokens?.email || null;
        const err = await env.SEQUENCES.get('oauth:error', 'json');
        oauthError = err;
      }
      return html(renderSettingsPage({
        oauthConnected, oauthEmail, oauthError,
        sequenceCount, templateCount, trackerCount: trackerKeys.keys.length,
      }));
    }

    // === HTML VIEW ROUTES (must come before JSON API routes) ===

    if (url.pathname === '/sequences' && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
      if (!checkAuth(request, env)) return requireAuth();
      const sequences = await listSequences(env);
      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;
      return html(renderSequencesPage(sequences, oauthConnected));
    }

    if (url.pathname === '/templates/new' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;
      return html(renderTemplateEditor(null, oauthConnected));
    }

    if (url.pathname.match(/^\/templates\/tmpl:[a-f0-9]+\/edit$/) && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const id = url.pathname.match(/^\/templates\/(tmpl:[a-f0-9]+)\/edit$/)[1];
      const tmpl = await getTemplate(env, id);
      if (!tmpl) return new Response('Template not found', { status: 404 });
      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;
      return html(renderTemplateEditor(tmpl, oauthConnected));
    }

    if (url.pathname === '/templates' && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
      if (!checkAuth(request, env)) return requireAuth();
      const templates = await listTemplates(env);
      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;
      return html(renderTemplatesPage(templates, oauthConnected));
    }

    if (url.pathname === '/analytics' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const analyticsKeys = await env.SEQUENCES.list({ prefix: 'analytics:' });
      const analyticsData = await Promise.all(analyticsKeys.keys.map(k => env.SEQUENCES.get(k.name, 'json')));
      const templates = await listTemplates(env);
      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;
      const dailyKeys = await env.SEQUENCES.list({ prefix: 'analytics-daily:' });
      const dailyDataMap = {};
      for (const k of dailyKeys.keys) {
        const d = await env.SEQUENCES.get(k.name, 'json');
        if (d) dailyDataMap[d.templateId] = d.days;
      }
      return html(renderAnalyticsPage(analyticsData.filter(Boolean), templates, oauthConnected, dailyDataMap));
    }

    // GET /activity — activity feed page
    if (url.pathname === '/activity' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();

      const offset = parseInt(url.searchParams.get('offset') || '0');
      const allEvents = [];

      // Collect events from trackers
      const trackerList = await env.TRACKER.list();
      for (const key of trackerList.keys) {
        const data = await env.TRACKER.get(key.name, 'json');
        if (!data) continue;

        const recipient = data.recipient || key.name;
        const subject = data.subject || 'Untitled';

        // Open events
        if (data.events) {
          for (const evt of data.events) {
            allEvents.push({
              type: 'open',
              time: evt.time,
              description: `<strong>${esc(recipient)}</strong> opened <em>${esc(subject)}</em>`,
            });
          }
        }

        // Filtered events
        if (data.filteredEvents) {
          for (const evt of data.filteredEvents) {
            allEvents.push({
              type: 'filtered',
              time: evt.time,
              description: `Open from <strong>${esc(recipient)}</strong> filtered — <em>${esc(evt.reason || 'unknown')}</em>`,
            });
          }
        }

        // Tracker created
        if (data.createdAt) {
          allEvents.push({
            type: 'tracker_created',
            time: data.createdAt,
            description: `Tracker created for <strong>${esc(recipient)}</strong> — <em>${esc(subject)}</em>`,
          });
        }
      }

      // Collect events from sequences
      if (env.SEQUENCES) {
        const seqKeys = await env.SEQUENCES.list({ prefix: 'seq:' });
        for (const k of seqKeys.keys) {
          const seq = await env.SEQUENCES.get(k.name, 'json');
          if (!seq) continue;

          const seqRecipient = seq.recipient || k.name;

          // Steps with sentAt
          if (seq.steps) {
            for (const step of seq.steps) {
              if (step.sentAt) {
                allEvents.push({
                  type: 'follow_up_sent',
                  time: step.sentAt,
                  description: `Follow-up sent to <strong>${esc(seqRecipient)}</strong> — <em>${esc(step.subject || 'Step')}</em>`,
                });
              }
            }
          }

          // Stopped sequences
          if (seq.status === 'stopped' && seq.stoppedAt) {
            allEvents.push({
              type: 'sequence_stopped',
              time: seq.stoppedAt,
              description: `Sequence stopped for <strong>${esc(seqRecipient)}</strong> — <em>${esc(seq.stopReason || 'manual')}</em>`,
            });
          }

          // Completed sequences
          if (seq.status === 'completed' && seq.completedAt) {
            allEvents.push({
              type: 'sequence_completed',
              time: seq.completedAt,
              description: `Sequence completed for <strong>${esc(seqRecipient)}</strong>`,
            });
          }
        }
      }

      // Sort by time descending and paginate
      allEvents.sort((a, b) => new Date(b.time) - new Date(a.time));
      const totalCount = allEvents.length;
      const pageEvents = allEvents.slice(offset, offset + 50);

      // Compute relative timeAgo
      const now = Date.now();
      const eventsWithTimeAgo = pageEvents.map(evt => {
        const diff = now - new Date(evt.time).getTime();
        const mins = Math.floor(diff / 60000);
        let timeAgo;
        if (mins < 1) timeAgo = 'just now';
        else if (mins < 60) timeAgo = mins + 'm ago';
        else {
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) timeAgo = hrs + 'h ago';
          else {
            const days = Math.floor(hrs / 24);
            if (days < 30) timeAgo = days + 'd ago';
            else timeAgo = new Date(evt.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
        }
        return { type: evt.type, description: evt.description, timeAgo };
      });

      // Check OAuth status
      let oauthConnected = false;
      if (env.SEQUENCES) {
        const tokens = await env.SEQUENCES.get('oauth:tokens');
        oauthConnected = !!tokens;
      }

      return html(renderActivityPage(eventsWithTimeAgo, totalCount, offset, oauthConnected));
    }

    // === TEMPLATE ROUTES ===

    if (url.pathname === '/templates' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuthCors();
      const templates = await listTemplates(env);
      return json(templates);
    }

    if (url.pathname === '/templates' && request.method === 'POST') {
      if (!checkAuth(request, env)) return requireAuthCors();
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
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
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim().length === 0) return json({ error: 'Name is required' }, 400);
        if (body.name.length > 100) return json({ error: 'Name must be 100 chars or less' }, 400);
      }
      if (body.timezone !== undefined) {
        try { Intl.DateTimeFormat(undefined, { timeZone: body.timezone }); }
        catch { return json({ error: 'Invalid timezone' }, 400); }
      }
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
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
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

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  },
};
