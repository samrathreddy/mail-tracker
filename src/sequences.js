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
