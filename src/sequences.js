function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parse formatted date parts from Intl.DateTimeFormat into an object
 * with numeric values for year, month (0-based), day, hour, minute, second.
 */
function parseTzParts(formatter, date) {
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(p => [p.type, p.value])
  );
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month) - 1,
    day: parseInt(parts.day),
    hour: parseInt(parts.hour === '24' ? '0' : parts.hour),
    minute: parseInt(parts.minute),
    second: parseInt(parts.second),
  };
}

/**
 * Find the UTC offset (in ms) for a given timezone at a given UTC instant,
 * accounting for sub-hour offsets (e.g. IST +5:30, Nepal +5:45) and DST.
 */
function getUtcOffsetMs(formatter, utcDate) {
  const local = parseTzParts(formatter, utcDate);
  // Build a UTC date from the local-looking components
  const localAsUtc = Date.UTC(local.year, local.month, local.day, local.hour, local.minute, local.second);
  // The difference tells us the offset: local = utc + offset => offset = localAsUtc - utcDate
  return localAsUtc - utcDate.getTime();
}

/**
 * Compute scheduledAt for a step, respecting timezone and 8am-6pm send window.
 * delayDays is relative to the original email send time.
 * Handles sub-hour offsets (IST +5:30, Nepal +5:45) and DST boundaries correctly.
 */
export function computeScheduledAt(createdAt, delayDays, timezone) {
  const tz = timezone || 'UTC';
  const origin = new Date(createdAt);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Get the origin time in the target timezone
  const originLocal = parseTzParts(formatter, origin);

  // Add delayDays as BUSINESS days (skip weekends)
  let calendarDays = 0;
  let businessDaysCounted = 0;
  while (businessDaysCounted < delayDays) {
    calendarDays++;
    const candidateMs = Date.UTC(
      originLocal.year, originLocal.month, originLocal.day + calendarDays,
      originLocal.hour, originLocal.minute, originLocal.second
    );
    const dayOfWeek = new Date(candidateMs).getUTCDay(); // 0=Sun, 6=Sat
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDaysCounted++;
    }
  }

  const targetLocalMs = Date.UTC(
    originLocal.year, originLocal.month, originLocal.day + calendarDays,
    originLocal.hour, originLocal.minute, originLocal.second
  );

  let sendYear = new Date(targetLocalMs).getUTCFullYear();
  let sendMonth = new Date(targetLocalMs).getUTCMonth();
  let sendDay = new Date(targetLocalMs).getUTCDate();
  let sendHour = new Date(targetLocalMs).getUTCHours();
  let sendMinute = new Date(targetLocalMs).getUTCMinutes();

  // Clamp to 8am-6pm send window in target timezone
  if (sendHour < 8) {
    sendHour = 9;
    sendMinute = 0;
  } else if (sendHour >= 18) {
    // Snap to 9am next business day
    let nextDayOffset = 1;
    let nextDayMs = Date.UTC(sendYear, sendMonth, sendDay + nextDayOffset, 9, 0, 0);
    while (new Date(nextDayMs).getUTCDay() === 0 || new Date(nextDayMs).getUTCDay() === 6) {
      nextDayOffset++;
      nextDayMs = Date.UTC(sendYear, sendMonth, sendDay + nextDayOffset, 9, 0, 0);
    }
    sendYear = new Date(nextDayMs).getUTCFullYear();
    sendMonth = new Date(nextDayMs).getUTCMonth();
    sendDay = new Date(nextDayMs).getUTCDate();
    sendHour = 9;
    sendMinute = 0;
  }

  // We now have the desired local time; find the corresponding UTC time.
  // Start with a candidate: desired_local_as_utc - estimated_offset
  // Use iterative approach to converge on the correct UTC timestamp.
  const desiredLocalMs = Date.UTC(sendYear, sendMonth, sendDay, sendHour, sendMinute, 0);

  // First estimate: use the offset at the origin as a starting point
  let candidateUtc = new Date(desiredLocalMs - getUtcOffsetMs(formatter, origin));

  // Refine: check what local time this candidate actually produces, and adjust
  for (let i = 0; i < 3; i++) {
    const actualOffset = getUtcOffsetMs(formatter, candidateUtc);
    candidateUtc = new Date(desiredLocalMs - actualOffset);
  }

  return candidateUtc.toISOString();
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
      if (s.subject && s.subject.length > 500) return `Step ${i + 1}: subject must be 500 chars or less`;
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

  // Check active sequence limit (only count sequences with status === 'active')
  const allSeqKeys = await env.SEQUENCES.list({ prefix: 'seq:' });
  const allSeqs = await Promise.all(
    allSeqKeys.keys.map(k => env.SEQUENCES.get(k.name, 'json'))
  );
  const activeCount = allSeqs.filter(s => s && s.status === 'active').length;
  if (activeCount >= 500) {
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
    steps: steps.reduce((acc, s) => {
      // Each step is relative to the previous step's scheduledAt (or original email time for step 1)
      const baseTime = acc.length > 0 ? acc[acc.length - 1].scheduledAt : now;
      const scheduledAt = computeScheduledAt(baseTime, s.delayDays, timezone);
      acc.push({
        delayDays: s.delayDays,
        subject: s.subject,
        body: s.body,
        stopOn: s.stopOn || [],
        scheduledAt,
        sentAt: null,
        sentMessageId: null,
        status: 'pending',
        retryCount: 0,
        failedReason: null,
      });
      return acc;
    }, []),
    variables: data.variables || {},
    stoppedAt: null,
    stoppedReason: null,
    createdAt: now,
  };

  await env.SEQUENCES.put(id, JSON.stringify(sequence));

  // Create reverse index: tracker -> sequence
  await env.SEQUENCES.put(`tracker-seq:${data.trackerId}`, id);

  // Initialize analytics entry for this template so data shows immediately
  if (templateId) {
    const analyticsKey = `analytics:${templateId}`;
    let analytics = await env.SEQUENCES.get(analyticsKey, 'json');
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
    analytics.totalSequences++;
    analytics.updatedAt = new Date().toISOString();
    await env.SEQUENCES.put(analyticsKey, JSON.stringify(analytics));
  }

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
