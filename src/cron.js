import { substituteVariables } from './variables.js';
import { stopSequence } from './sequences.js';
import { sendFollowUp, checkThreadForReplies, getAccessToken } from './gmail-api.js';
import { sendSequenceNotification } from './notifications.js';

const MAX_RETRIES = 3;
const REPLY_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_TTL = 300; // 5 minutes in seconds
const BATCH_SIZE = 50;

/**
 * List all keys from a KV namespace with a given prefix, handling pagination.
 */
async function listAllKeys(kv, prefix) {
  const allKeys = [];
  let cursor = undefined;
  let done = false;
  while (!done) {
    const result = await kv.list({ prefix, cursor });
    allKeys.push(...result.keys);
    cursor = result.cursor;
    done = result.list_complete;
  }
  return allKeys;
}

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

  const allKeys = await listAllKeys(env.SEQUENCES, 'seq:');
  const now = Date.now();

  // M2: Batch processing with cursor
  const lastProcessedKey = await env.SEQUENCES.get('cron:lastProcessedKey');
  let startIndex = 0;
  if (lastProcessedKey) {
    const idx = allKeys.findIndex(k => k.name === lastProcessedKey);
    if (idx >= 0) {
      startIndex = idx + 1;
    }
  }

  const batch = allKeys.slice(startIndex, startIndex + BATCH_SIZE);
  for (const key of batch) {
    const seq = await env.SEQUENCES.get(key.name, 'json');
    if (!seq || seq.status !== 'active') continue;

    const step = seq.steps[seq.currentStep];
    if (!step || step.status !== 'pending') continue;

    // H2: Idempotent recovery -- if sentMessageId is set but status is still pending,
    // this is a crash-recovery case. Skip the send and just advance.
    if (step.sentMessageId) {
      console.log(`[cron] Recovering step ${seq.currentStep} for ${seq.id} — sentMessageId exists, advancing without re-send`);
      step.sentAt = new Date().toISOString();
      step.status = 'sent';
      seq.currentStep++;
      if (seq.currentStep >= seq.steps.length) {
        seq.status = 'completed';
        await updateAnalytics(env, seq.templateId, seq.currentStep - 1, 'sent', 'sequence_completed');
      } else {
        await updateAnalytics(env, seq.templateId, seq.currentStep - 1, 'sent');
      }
      await env.SEQUENCES.put(seq.id, JSON.stringify(seq));
      continue;
    }

    // Check if step is due
    const scheduledTime = new Date(step.scheduledAt).getTime();
    if (scheduledTime > now) continue;

    // C6: Track first processing of this sequence for analytics
    if (!seq._cronCounted) {
      await updateAnalytics(env, seq.templateId, null, null, 'sequence_created');
      seq._cronCounted = true;
    }

    // Check stop conditions before sending
    const shouldStop = await checkStopConditions(env, seq, step);
    if (shouldStop) {
      await stopSequence(env, seq.id, shouldStop);
      await updateAnalytics(env, seq.templateId, seq.currentStep, null, 'sequence_stopped');
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

    const stepSubject = (step.subject && step.subject.trim()) ? step.subject : 'Re: {{subject}}';
    const renderedSubject = substituteVariables(stepSubject, context);
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
      // M3: Differentiated error handling based on status code
      if (result.status === 401) {
        await pauseAllSequences(env, result.error);
        return;
      }

      if (result.status === 400 || result.status === 404) {
        // Permanent error: mark step as failed immediately, no retry
        step.status = 'failed';
        step.failedReason = result.error;
        // H6: Capture step index before incrementing
        const failedStepIndex = seq.currentStep;
        seq.currentStep++;
        if (seq.currentStep >= seq.steps.length) {
          seq.status = 'completed';
        }
        await env.SEQUENCES.put(seq.id, JSON.stringify(seq));
        await sendSequenceNotification(env, {
          type: 'step-failed',
          recipient: seq.recipient,
          subject: seq.variables?.subject || '',
          stepNumber: failedStepIndex + 1,
          totalSteps: seq.steps.length,
          reason: result.error,
        });
      } else if (result.status === 403 || (result.status && result.status >= 500)) {
        // Transient error: leave step as pending, do NOT increment retryCount
        // Will retry next cron cycle
        await env.SEQUENCES.put(seq.id, JSON.stringify(seq));
      } else {
        // Other errors: increment retryCount
        step.retryCount = (step.retryCount || 0) + 1;

        if (step.retryCount >= MAX_RETRIES) {
          step.status = 'failed';
          step.failedReason = result.error;
          // H6: Capture step index before incrementing
          const failedStepIndex = seq.currentStep;
          seq.currentStep++;
          if (seq.currentStep >= seq.steps.length) {
            seq.status = 'completed';
          }
          await env.SEQUENCES.put(seq.id, JSON.stringify(seq));
          await sendSequenceNotification(env, {
            type: 'step-failed',
            recipient: seq.recipient,
            subject: seq.variables?.subject || '',
            stepNumber: failedStepIndex + 1,
            totalSteps: seq.steps.length,
            reason: result.error,
          });
        } else {
          await env.SEQUENCES.put(seq.id, JSON.stringify(seq));
        }
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

    // H1: Advance sequence inline to avoid KV eventual consistency issues
    step.sentAt = new Date().toISOString();
    step.status = 'sent';
    seq.currentStep++;
    if (seq.currentStep >= seq.steps.length) {
      seq.status = 'completed';
    }
    await env.SEQUENCES.put(seq.id, JSON.stringify(seq));

    // Update analytics (C6: include sequence_completed event if applicable)
    const seqEvent = seq.status === 'completed' ? 'sequence_completed' : undefined;
    await updateAnalytics(env, seq.templateId, seq.currentStep - 1, 'sent', seqEvent);

    // Notify
    const notifType = seq.status === 'completed' ? 'sequence-completed' : 'follow-up-sent';
    await sendSequenceNotification(env, {
      type: notifType,
      recipient: seq.recipient,
      subject: renderedSubject,
      stepNumber: seq.currentStep,
      totalSteps: seq.steps.length,
    });
  }

  // M2: Update or clear the cursor
  if (startIndex + BATCH_SIZE < allKeys.length) {
    // More keys remain — save cursor for next invocation
    const lastKey = batch[batch.length - 1]?.name;
    if (lastKey) {
      await env.SEQUENCES.put('cron:lastProcessedKey', lastKey);
    }
  } else {
    // All keys processed — clear cursor
    await env.SEQUENCES.delete('cron:lastProcessedKey');
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

  const allKeys = await listAllKeys(env.SEQUENCES, 'seq:');

  for (const key of allKeys) {
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
      await updateAnalytics(env, seq.templateId, seq.currentStep, 'replied', 'sequence_stopped');
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

  // H3: Check for reply stop condition
  if (step.stopOn.includes('reply') && seq.threadId) {
    let afterMessageId = seq.originalMessageId;
    for (let i = seq.currentStep - 1; i >= 0; i--) {
      if (seq.steps[i].sentMessageId) {
        afterMessageId = seq.steps[i].sentMessageId;
        break;
      }
    }
    const result = await checkThreadForReplies(env, seq.threadId, afterMessageId);
    if (!result.error && result.hasReply) return 'reply';
  }

  return null;
}

/**
 * Pause all active sequences due to OAuth failure.
 */
async function pauseAllSequences(env, errorDetail) {
  const allKeys = await listAllKeys(env.SEQUENCES, 'seq:');
  for (const key of allKeys) {
    const seq = await env.SEQUENCES.get(key.name, 'json');
    if (seq && seq.status === 'active') {
      seq.status = 'paused';
      await env.SEQUENCES.put(key.name, JSON.stringify(seq));
    }
  }

  // M4: Set oauth:error in KV for dashboard/extension visibility
  await env.SEQUENCES.put('oauth:error', JSON.stringify({
    error: 'Token invalid during send',
    detail: errorDetail,
    at: new Date().toISOString(),
  }));

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
 * C6: Optional 4th parameter `sequenceEvent` can be 'sequence_created',
 * 'sequence_completed', or 'sequence_stopped' to increment top-level counters.
 */
async function updateAnalytics(env, templateId, stepIndex, eventType, sequenceEvent) {
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

  // C6: Increment top-level sequence counters when a sequence event is provided
  if (sequenceEvent === 'sequence_created') {
    analytics.totalSequences++;
  } else if (sequenceEvent === 'sequence_completed') {
    analytics.completedSequences++;
  } else if (sequenceEvent === 'sequence_stopped') {
    analytics.stoppedSequences++;
  }

  // Update per-step counters if stepIndex and eventType are provided
  if (stepIndex != null && eventType) {
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
  }

  // Write daily bucketed data for time-series charts
  if (eventType && templateId) {
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `analytics-daily:${templateId}`;
    let dailyData = await env.SEQUENCES.get(dailyKey, 'json');
    if (!dailyData) {
      dailyData = { templateId, days: {} };
    }
    if (!dailyData.days[today]) {
      dailyData.days[today] = { sent: 0, opened: 0, replied: 0 };
    }
    if (eventType === 'sent') dailyData.days[today].sent++;
    else if (eventType === 'opened') dailyData.days[today].opened++;
    else if (eventType === 'replied') dailyData.days[today].replied++;

    // Prune entries older than 90 days
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    for (const day of Object.keys(dailyData.days)) {
      if (day < cutoff) delete dailyData.days[day];
    }

    await env.SEQUENCES.put(dailyKey, JSON.stringify(dailyData));
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
