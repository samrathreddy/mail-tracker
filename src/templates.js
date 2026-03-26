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
    if (step.subject && step.subject.length > 500) {
      return `Step ${i + 1}: subject must be 500 chars or less`;
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
