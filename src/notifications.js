// Webhook notification handlers for Slack and Discord

/**
 * Send notification to Slack webhook
 */
async function sendSlackNotification(webhookUrl, data) {
  const message = {
    text: `📬 *Email Opened*\n\n*Recipient:* ${data.recipient || 'Unknown'}\n*Subject:* ${data.subject || 'No subject'}\n*Opens:* ${data.opens}\n*Time:* ${data.time}\n\n© Mail Tracker - <https://github.com/samrathreddy/mail-tracker|GitHub>`
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    console.log('Slack response:', response.status, response.ok);
    return response.ok;
  } catch (e) {
    console.error('Slack notification failed:', e);
    return false;
  }
}

/**
 * Send notification to Discord webhook
 */
async function sendDiscordNotification(webhookUrl, data) {
  const message = {
    embeds: [{
      title: "📬 Email Opened",
      color: 0x34A853,
      fields: [
        {
          name: "Recipient",
          value: data.recipient || 'Unknown',
          inline: false
        },
        {
          name: "Subject",
          value: data.subject || 'No subject',
          inline: false
        },
        {
          name: "Opens",
          value: String(data.opens),
          inline: true
        },
        {
          name: "Time",
          value: data.time,
          inline: true
        }
      ],
      footer: {
        text: "© Mail Tracker"
      },
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    console.log('Discord response:', response.status, response.ok);
    return response.ok;
  } catch (e) {
    console.error('Discord notification failed:', e);
    return false;
  }
}

/**
 * Send notifications to all configured webhooks
 * @param {Object} env - Cloudflare environment with webhook URLs
 * @param {Object} data - Email open data
 */
export async function sendWebhookNotifications(env, data) {
  const promises = [];

  console.log('sendWebhookNotifications called with:', data);

  if (env.SLACK_WEBHOOK_URL) {
    console.log('Sending to Slack...');
    promises.push(sendSlackNotification(env.SLACK_WEBHOOK_URL, data));
  } else {
    console.log('No Slack webhook URL');
  }

  if (env.DISCORD_WEBHOOK_URL) {
    console.log('Sending to Discord...');
    promises.push(sendDiscordNotification(env.DISCORD_WEBHOOK_URL, data));
  } else {
    console.log('No Discord webhook URL');
  }

  // Send all notifications in parallel and wait for completion
  if (promises.length > 0) {
    try {
      await Promise.all(promises);
      console.log('All webhooks sent successfully');
    } catch (e) {
      console.error('Webhook notifications failed:', e);
    }
  } else {
    console.log('No webhooks configured');
  }
}

/**
 * Send notification for sequence events (follow-up sent, stopped, failed, etc.)
 */
export async function sendSequenceNotification(env, data) {
  const { type, recipient, subject, stepNumber, totalSteps, reason } = data;

  const messages = {
    'follow-up-sent': `Follow-up Sent (Step ${stepNumber}/${totalSteps})\n\nTo: ${recipient}\nSubject: ${subject}`,
    'sequence-completed': `Sequence Completed (All ${totalSteps} steps sent)\n\nTo: ${recipient}\nSubject: ${subject}`,
    'sequence-stopped': `Sequence Stopped - ${reason}\n\nTo: ${recipient}\nSubject: ${subject}`,
    'step-failed': `Step Failed (Step ${stepNumber}/${totalSteps})\n\nTo: ${recipient}\nSubject: ${subject}\nReason: ${reason}`,
    'oauth-error': `Gmail OAuth Error\n\nAll sequences paused. Please reconnect Gmail.\nError: ${reason}`,
  };

  const text = messages[type] || `Sequence event: ${type}`;

  const promises = [];

  if (env.SLACK_WEBHOOK_URL) {
    promises.push(
      fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => {})
    );
  }

  if (env.DISCORD_WEBHOOK_URL) {
    const colors = {
      'follow-up-sent': 0x3B82F6,
      'sequence-completed': 0x22C55E,
      'sequence-stopped': 0xEAB308,
      'step-failed': 0xEF4444,
      'oauth-error': 0xEF4444,
    };

    promises.push(
      fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: text.split('\n')[0],
            description: text.split('\n').slice(1).join('\n'),
            color: colors[type] || 0x6366F1,
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch(() => {})
    );
  }

  await Promise.all(promises);
}
