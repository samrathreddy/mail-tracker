export const PIXEL = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0));

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const BOT_PATTERNS = [
  /Yahoo! Slurp/i,
  /Outlook-iOS/i,
  /Microsoft Outlook/i,
  /ms-office/i,
  /BCLinked/i,
  /Safelinks/i,
  /YahooMailProxy/i,
  /Thunderbird/i,
];

export const DEDUP_WINDOW_MS = 5000;

export const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%236366f1'/><path d='M20 35c0-3 2-5 5-5h50c3 0 5 2 5 5v30c0 3-2 5-5 5H25c-3 0-5-2-5-5V35z' fill='none' stroke='white' stroke-width='5'/><path d='M22 33l28 22 28-22' fill='none' stroke='white' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/><circle cx='75' cy='28' r='12' fill='%2334d399'/><text x='75' y='33' text-anchor='middle' fill='white' font-size='16' font-weight='bold'>1</text></svg>";

export const LOGO_SVG = '<svg width="22" height="22" viewBox="0 0 100 100" style="flex-shrink:0"><rect width="100" height="100" rx="20" fill="#6366f1"/><path d="M20 35c0-3 2-5 5-5h50c3 0 5 2 5 5v30c0 3-2 5-5 5H25c-3 0-5-2-5-5V35z" fill="none" stroke="white" stroke-width="5"/><path d="M22 33l28 22 28-22" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="75" cy="28" r="12" fill="#34d399"/></svg>';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
}

export function checkAuth(request, env) {
  if (!env.DASHBOARD_PASSWORD) return true;
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;
  const base64 = authHeader.slice(6);
  const decoded = atob(base64);
  const [, password] = decoded.split(':');
  return password === env.DASHBOARD_PASSWORD;
}

export function requireAuth() {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mail Tracker"' },
  });
}

export function requireAuthCors() {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Mail Tracker"',
      ...CORS_HEADERS,
    },
  });
}

export function servePixel() {
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  });
}

export function html(content) {
  return new Response(content, { headers: { 'Content-Type': 'text/html' } });
}

export function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
