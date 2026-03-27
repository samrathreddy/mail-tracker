/**
 * HubSpot CRM lookup, TLD timezone inference, optimal send time, recipient aggregation.
 */

const HUBSPOT_CONTACT_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';

/** ~35 entries: multi-part TLDs first (longest match wins in lookup). */
const TLD_TIMEZONES = {
  'co.uk': 'Europe/London',
  'org.uk': 'Europe/London',
  'com.au': 'Australia/Sydney',
  'com.br': 'America/Sao_Paulo',
  'co.jp': 'Asia/Tokyo',
  'co.nz': 'Pacific/Auckland',
  'co.in': 'Asia/Kolkata',
  uk: 'Europe/London',
  de: 'Europe/Berlin',
  fr: 'Europe/Paris',
  es: 'Europe/Madrid',
  it: 'Europe/Rome',
  nl: 'Europe/Amsterdam',
  be: 'Europe/Brussels',
  at: 'Europe/Vienna',
  ch: 'Europe/Zurich',
  se: 'Europe/Stockholm',
  no: 'Europe/Oslo',
  dk: 'Europe/Copenhagen',
  fi: 'Europe/Helsinki',
  pl: 'Europe/Warsaw',
  pt: 'Europe/Lisbon',
  ie: 'Europe/Dublin',
  jp: 'Asia/Tokyo',
  kr: 'Asia/Seoul',
  cn: 'Asia/Shanghai',
  in: 'Asia/Kolkata',
  sg: 'Asia/Singapore',
  hk: 'Asia/Hong_Kong',
  tw: 'Asia/Taipei',
  th: 'Asia/Bangkok',
  my: 'Asia/Kuala_Lumpur',
  au: 'Australia/Sydney',
  nz: 'Pacific/Auckland',
  br: 'America/Sao_Paulo',
  mx: 'America/Mexico_City',
  ar: 'America/Argentina/Buenos_Aires',
  ca: 'America/Toronto',
  za: 'Africa/Johannesburg',
  il: 'Asia/Jerusalem',
  ae: 'Asia/Dubai',
  ru: 'Europe/Moscow',
  tr: 'Europe/Istanbul',
};

const RECIPIENT_CACHE_TTL = 604800; // 7 days

async function listAllKeys(kv, prefix) {
  const allKeys = [];
  let cursor;
  let done = false;
  while (!done) {
    const result = prefix
      ? await kv.list({ prefix, cursor })
      : await kv.list({ cursor });
    allKeys.push(...result.keys);
    cursor = result.cursor;
    done = result.list_complete;
  }
  return allKeys;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function extractTldFromEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1);
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  // Try longest suffix: co.uk, com.au, then single TLD
  if (parts.length >= 3) {
    const two = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (TLD_TIMEZONES[two]) return two;
  }
  const one = parts[parts.length - 1];
  if (TLD_TIMEZONES[one]) return one;
  return null;
}

const HUBSPOT_TZ_ALIASES = {
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles',
  'US/Hawaii': 'Pacific/Honolulu',
  'US/Alaska': 'America/Anchorage',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'GMT': 'Etc/GMT',
  'UTC': 'UTC',
};

function isValidIanaTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function getLocalHour(isoString, timeZone) {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour');
  return h ? parseInt(h.value, 10) : 0;
}

function bucketHours(timestamps, timeZone) {
  const counts = new Array(24).fill(0);
  for (const t of timestamps) {
    const h = getLocalHour(t, timeZone);
    if (h >= 0 && h <= 23) counts[h]++;
  }
  let bestHour = 9;
  let bestCount = -1;
  for (let h = 0; h < 24; h++) {
    if (counts[h] > bestCount) {
      bestCount = counts[h];
      bestHour = h;
    }
  }
  return { bestHour, bestCount, total: timestamps.length };
}

/**
 * Query HubSpot CRM for contact by email.
 */
export async function lookupRecipient(env, email) {
  const token = env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return null;

  const addr = normalizeEmail(email);
  if (!addr) return null;

  const url = `${HUBSPOT_CONTACT_URL}/${encodeURIComponent(addr)}?idProperty=email&properties=city,state,country,hs_timezone,firstname,lastname,jobtitle,company`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data = await res.json();
    const props = data.properties || {};

    let tz = props.hs_timezone || props.hs_time_zone || '';
    tz = HUBSPOT_TZ_ALIASES[tz] || tz;
    let timezone = tz && isValidIanaTimezone(tz) ? tz : null;

    // If no hs_timezone, infer from country (+ city for large countries)
    if (!timezone && props.country) {
      timezone = inferTimezoneFromCountry(props.country, props.city, props.state);
    }

    return {
      timezone,
      city: props.city || null,
      state: props.state || null,
      country: props.country || null,
      firstName: props.firstname || null,
      lastName: props.lastname || null,
      jobTitle: props.jobtitle || null,
      company: props.company || null,
      source: 'hubspot',
    };
  } catch {
    return null;
  }
}

/**
 * Infer timezone from country name (+ city/state for large countries with multiple zones).
 */
function inferTimezoneFromCountry(country, city, state) {
  if (!country) return null;
  const c = country.toLowerCase().trim();
  const ci = (city || '').toLowerCase().trim();
  const st = (state || '').toLowerCase().trim();

  // Single-timezone countries
  const COUNTRY_TZ = {
    'india': 'Asia/Kolkata',
    'japan': 'Asia/Tokyo',
    'south korea': 'Asia/Seoul',
    'china': 'Asia/Shanghai',
    'singapore': 'Asia/Singapore',
    'hong kong': 'Asia/Hong_Kong',
    'taiwan': 'Asia/Taipei',
    'thailand': 'Asia/Bangkok',
    'vietnam': 'Asia/Ho_Chi_Minh',
    'malaysia': 'Asia/Kuala_Lumpur',
    'philippines': 'Asia/Manila',
    'indonesia': 'Asia/Jakarta',
    'israel': 'Asia/Jerusalem',
    'united arab emirates': 'Asia/Dubai',
    'saudi arabia': 'Asia/Riyadh',
    'turkey': 'Europe/Istanbul',
    'united kingdom': 'Europe/London',
    'uk': 'Europe/London',
    'ireland': 'Europe/Dublin',
    'germany': 'Europe/Berlin',
    'france': 'Europe/Paris',
    'spain': 'Europe/Madrid',
    'italy': 'Europe/Rome',
    'netherlands': 'Europe/Amsterdam',
    'belgium': 'Europe/Brussels',
    'switzerland': 'Europe/Zurich',
    'austria': 'Europe/Vienna',
    'sweden': 'Europe/Stockholm',
    'norway': 'Europe/Oslo',
    'denmark': 'Europe/Copenhagen',
    'finland': 'Europe/Helsinki',
    'poland': 'Europe/Warsaw',
    'portugal': 'Europe/Lisbon',
    'czech republic': 'Europe/Prague',
    'romania': 'Europe/Bucharest',
    'greece': 'Europe/Athens',
    'south africa': 'Africa/Johannesburg',
    'nigeria': 'Africa/Lagos',
    'kenya': 'Africa/Nairobi',
    'egypt': 'Africa/Cairo',
    'new zealand': 'Pacific/Auckland',
    'argentina': 'America/Argentina/Buenos_Aires',
    'chile': 'America/Santiago',
    'colombia': 'America/Bogota',
    'peru': 'America/Lima',
    'mexico': 'America/Mexico_City',
  };

  if (COUNTRY_TZ[c]) return COUNTRY_TZ[c];

  // Multi-timezone countries — use city/state to narrow down
  if (c === 'united states' || c === 'united states of america' || c === 'us' || c === 'usa') {
    const eastern = ['new york', 'boston', 'miami', 'atlanta', 'charlotte', 'philadelphia', 'washington', 'detroit', 'pittsburgh', 'orlando', 'tampa', 'jacksonville', 'raleigh', 'richmond', 'baltimore', 'columbus', 'indianapolis', 'cleveland', 'cincinnati', 'nashville'];
    const central = ['chicago', 'houston', 'dallas', 'austin', 'san antonio', 'memphis', 'milwaukee', 'kansas city', 'minneapolis', 'st. louis', 'new orleans', 'oklahoma city', 'omaha', 'des moines'];
    const mountain = ['denver', 'phoenix', 'salt lake city', 'albuquerque', 'tucson', 'boise', 'colorado springs'];
    const pacific = ['los angeles', 'san francisco', 'seattle', 'portland', 'san diego', 'san jose', 'sacramento', 'las vegas', 'oakland'];

    if (eastern.some(x => ci.includes(x) || st.includes(x))) return 'America/New_York';
    if (central.some(x => ci.includes(x) || st.includes(x))) return 'America/Chicago';
    if (mountain.some(x => ci.includes(x) || st.includes(x))) return 'America/Denver';
    if (pacific.some(x => ci.includes(x) || st.includes(x))) return 'America/Los_Angeles';

    // State-level fallbacks for US
    const stateMap = {
      'california': 'America/Los_Angeles', 'ca': 'America/Los_Angeles',
      'washington': 'America/Los_Angeles', 'wa': 'America/Los_Angeles',
      'oregon': 'America/Los_Angeles', 'or': 'America/Los_Angeles',
      'nevada': 'America/Los_Angeles', 'nv': 'America/Los_Angeles',
      'texas': 'America/Chicago', 'tx': 'America/Chicago',
      'illinois': 'America/Chicago', 'il': 'America/Chicago',
      'florida': 'America/New_York', 'fl': 'America/New_York',
      'new york': 'America/New_York', 'ny': 'America/New_York',
      'massachusetts': 'America/New_York', 'ma': 'America/New_York',
      'georgia': 'America/New_York', 'ga': 'America/New_York',
      'pennsylvania': 'America/New_York', 'pa': 'America/New_York',
      'ohio': 'America/New_York', 'oh': 'America/New_York',
      'michigan': 'America/New_York', 'mi': 'America/New_York',
      'virginia': 'America/New_York', 'va': 'America/New_York',
      'north carolina': 'America/New_York', 'nc': 'America/New_York',
      'colorado': 'America/Denver', 'co': 'America/Denver',
      'arizona': 'America/Denver', 'az': 'America/Denver',
      'minnesota': 'America/Chicago', 'mn': 'America/Chicago',
      'wisconsin': 'America/Chicago', 'wi': 'America/Chicago',
      'missouri': 'America/Chicago', 'mo': 'America/Chicago',
      'tennessee': 'America/Chicago', 'tn': 'America/Chicago',
    };
    if (stateMap[st]) return stateMap[st];

    return 'America/New_York'; // US default = Eastern
  }

  if (c === 'canada') {
    if (['toronto', 'ottawa', 'montreal', 'quebec'].some(x => ci.includes(x))) return 'America/Toronto';
    if (['vancouver', 'victoria'].some(x => ci.includes(x))) return 'America/Vancouver';
    if (['calgary', 'edmonton'].some(x => ci.includes(x))) return 'America/Edmonton';
    if (['winnipeg'].some(x => ci.includes(x))) return 'America/Winnipeg';
    return 'America/Toronto';
  }

  if (c === 'australia') {
    if (['sydney', 'melbourne', 'canberra', 'brisbane'].some(x => ci.includes(x))) return 'Australia/Sydney';
    if (['perth'].some(x => ci.includes(x))) return 'Australia/Perth';
    if (['adelaide'].some(x => ci.includes(x))) return 'Australia/Adelaide';
    return 'Australia/Sydney';
  }

  if (c === 'brazil' || c === 'brasil') {
    if (['sao paulo', 'rio de janeiro', 'brasilia'].some(x => ci.includes(x))) return 'America/Sao_Paulo';
    return 'America/Sao_Paulo';
  }

  if (c === 'russia' || c === 'russian federation') {
    if (['moscow', 'saint petersburg'].some(x => ci.includes(x))) return 'Europe/Moscow';
    return 'Europe/Moscow';
  }

  return null;
}

/**
 * Map email domain TLD to a likely IANA timezone.
 */
export function inferTimezoneFromTLD(email) {
  const tld = extractTldFromEmail(normalizeEmail(email));
  if (!tld) return null;
  const timezone = TLD_TIMEZONES[tld];
  if (!timezone) return null;
  return { timezone, source: 'tld' };
}

/**
 * Collect open timestamps from tracker objects for matching recipients / domain / all.
 */
function collectOpenTimestamps(trackers, mode, email, domain) {
  const norm = normalizeEmail(email);
  const timestamps = [];

  for (const t of trackers) {
    const rec = t.recipient ? normalizeEmail(t.recipient) : '';
    const events = t.events || [];

    if (mode === 'recipient') {
      if (rec !== norm) continue;
    } else if (mode === 'domain') {
      const recDomain = rec.includes('@') ? rec.split('@')[1] : '';
      if (!recDomain || recDomain !== domain) continue;
    }

    for (const ev of events) {
      if (ev.time) timestamps.push(ev.time);
    }
  }

  return timestamps;
}

async function loadAllTrackers(env) {
  if (!env.TRACKER) return [];
  const keys = await listAllKeys(env.TRACKER, null);
  const trackers = [];
  const BATCH = 50;
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(k => env.TRACKER.get(k.name, 'json')));
    for (let j = 0; j < results.length; j++) {
      if (results[j]) trackers.push({ ...results[j], _id: batch[j].name });
    }
  }
  return trackers;
}

/**
 * Cascading open-time analysis for optimal hour in recipient timezone.
 */
export async function getOptimalSendTime(env, email, timezone, preloadedTrackers) {
  const tz = isValidIanaTimezone(timezone) ? timezone : 'America/New_York';

  if (!env.TRACKER) {
    return { hour: 9, confidence: 'default', source: 'default', sampleSize: 0 };
  }

  const trackers = preloadedTrackers || await loadAllTrackers(env);
  const norm = normalizeEmail(email);
  const domain = norm.includes('@') ? norm.split('@')[1] : '';

  // Level 1: per-recipient
  const ts1 = collectOpenTimestamps(trackers, 'recipient', email, domain);
  if (ts1.length >= 3) {
    const { bestHour, total } = bucketHours(ts1, tz);
    return {
      hour: bestHour,
      confidence: 'high',
      source: 'recipient',
      sampleSize: total,
    };
  }

  // Level 2: per-domain
  const ts2 = collectOpenTimestamps(trackers, 'domain', email, domain);
  if (ts2.length >= 5) {
    const { bestHour, total } = bucketHours(ts2, tz);
    return {
      hour: bestHour,
      confidence: 'medium',
      source: 'domain',
      sampleSize: total,
    };
  }

  // Level 3: global
  const ts3 = [];
  for (const t of trackers) {
    for (const ev of t.events || []) {
      if (ev.time) ts3.push(ev.time);
    }
  }
  if (ts3.length > 0) {
    const { bestHour, total } = bucketHours(ts3, tz);
    return {
      hour: bestHour,
      confidence: 'low',
      source: 'global',
      sampleSize: total,
    };
  }

  return { hour: 9, confidence: 'default', source: 'default', sampleSize: 0 };
}

/**
 * Most recent open-history timezone from tracker events for this email.
 */
function timezoneFromOpenHistory(trackers, email) {
  const norm = normalizeEmail(email);
  let bestTime = 0;
  let bestTz = null;

  for (const t of trackers) {
    const rec = t.recipient ? normalizeEmail(t.recipient) : '';
    if (rec !== norm) continue;
    for (const ev of t.events || []) {
      const tz = ev.timezone;
      if (!tz || tz === 'unknown') continue;
      const ts = new Date(ev.time).getTime();
      if (ts >= bestTime && isValidIanaTimezone(tz)) {
        bestTime = ts;
        bestTz = tz;
      }
    }
  }

  return bestTz;
}

/**
 * Full recipient intelligence: cache, trackers, HubSpot, TLD, optimal send time.
 */
export async function getRecipientInfo(env, email, defaultTimezone) {
  const addr = normalizeEmail(email);
  const defTz = defaultTimezone && isValidIanaTimezone(defaultTimezone)
    ? defaultTimezone
    : 'America/New_York';

  const cacheKey = `recipient-info:${addr}`;

  if (env.SEQUENCES) {
    const cached = await env.SEQUENCES.get(cacheKey, 'json');
    if (cached) return cached;
  }

  const trackers = env.TRACKER ? await loadAllTrackers(env) : [];

  const openHistoryTz = timezoneFromOpenHistory(trackers, addr);
  const hubspot = await lookupRecipient(env, addr);
  const tldInf = inferTimezoneFromTLD(addr);

  let timezoneSource = 'default';
  let timezone = defTz;

  if (openHistoryTz) {
    timezone = openHistoryTz;
    timezoneSource = 'open_history';
  } else if (hubspot?.timezone) {
    timezone = hubspot.timezone;
    timezoneSource = 'hubspot';
  } else if (tldInf?.timezone) {
    timezone = tldInf.timezone;
    timezoneSource = 'tld';
  }

  const optimalSendTime = await getOptimalSendTime(env, addr, timezone, trackers);

  const result = {
    email: addr,
    timezone,
    timezoneSource,
    city: hubspot?.city ?? null,
    state: hubspot?.state ?? null,
    country: hubspot?.country ?? null,
    firstName: hubspot?.firstName ?? null,
    lastName: hubspot?.lastName ?? null,
    jobTitle: hubspot?.jobTitle ?? null,
    company: hubspot?.company ?? null,
    source: hubspot ? 'hubspot' : timezoneSource === 'tld' ? 'tld' : timezoneSource === 'open_history' ? 'open_history' : 'default',
    optimalSendTime,
  };

  if (env.SEQUENCES) {
    await env.SEQUENCES.put(cacheKey, JSON.stringify(result), {
      expirationTtl: RECIPIENT_CACHE_TTL,
    });
  }

  return result;
}
