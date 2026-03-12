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

  if (env.SLACK_WEBHOOK_URL) {
    promises.push(sendSlackNotification(env.SLACK_WEBHOOK_URL, data));
  }

  if (env.DISCORD_WEBHOOK_URL) {
    promises.push(sendDiscordNotification(env.DISCORD_WEBHOOK_URL, data));
  }

  // Send all notifications in parallel, don't wait for responses
  if (promises.length > 0) {
    Promise.all(promises).catch(e => console.error('Webhook notifications failed:', e));
  }
}
