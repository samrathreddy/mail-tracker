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
