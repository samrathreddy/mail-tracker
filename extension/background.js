// Background service worker — polls for new opens and sends notifications

const POLL_INTERVAL = 60_000; // 1 minute

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  return serverUrl || '';
}

async function pollForOpens() {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return;

  try {
    const res = await fetch(`${serverUrl}/list`);
    if (!res.ok) return;
    const pixels = await res.json();

    const { lastKnownOpens = {} } = await chrome.storage.local.get('lastKnownOpens');
    const updated = {};
    let hasChanges = false;

    for (const pixel of pixels) {
      const prev = lastKnownOpens[pixel.id] || 0;
      updated[pixel.id] = pixel.opens;

      if (prev > 0 && pixel.opens > prev) {
        hasChanges = true;
        const diff = pixel.opens - prev;
        const who = pixel.recipient || pixel.id;
        chrome.notifications.create(`open-${pixel.id}-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Email Opened!',
          message: `${who} opened your email${diff > 1 ? ` (${diff} times)` : ''} — total: ${pixel.opens}`,
        });
      }
    }

    await chrome.storage.local.set({ lastKnownOpens: updated });
  } catch (e) {
    // Server unreachable — silently ignore
  }
}

// Poll on alarm
chrome.alarms.create('poll-opens', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-opens') pollForOpens();
});

// Also poll on install/startup
chrome.runtime.onStartup.addListener(pollForOpens);
chrome.runtime.onInstalled.addListener(pollForOpens);
