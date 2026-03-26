// Background service worker — polls for new opens and sends notifications

// Poll interval: 5 minutes (configured via chrome.alarms below)

async function getServerUrl() {
  const { serverUrl, dashboardPassword } = await chrome.storage.sync.get(['serverUrl', 'dashboardPassword']);
  return { serverUrl: serverUrl || '', password: dashboardPassword || '' };
}

async function pollForOpens() {
  const { serverUrl, password } = await getServerUrl();
  if (!serverUrl) return;

  try {
    const headers = {};
    if (password) {
      headers['Authorization'] = 'Basic ' + btoa(':' + password);
    }
    const res = await fetch(`${serverUrl}/list`, { headers });
    if (!res.ok) return;
    const pixels = await res.json();

    const { lastKnownOpens = {} } = await chrome.storage.local.get('lastKnownOpens');
    const updated = {};
    for (const pixel of pixels) {
      const prev = lastKnownOpens[pixel.id] || 0;
      updated[pixel.id] = pixel.opens;

      if (prev > 0 && pixel.opens > prev) {
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
  } catch (_e) {
    // Server unreachable — silently ignore
  }
}

async function pollSequenceStatus() {
  const { serverUrl, dashboardPassword } = await chrome.storage.sync.get(['serverUrl', 'dashboardPassword']);
  if (!serverUrl) return;

  try {
    const headers = {};
    if (dashboardPassword) {
      headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
    }
    const res = await fetch(serverUrl + '/sequences?status=active', { headers });
    if (!res.ok) return;
    const sequences = await res.json();

    const activeCount = sequences.length;
    if (activeCount > 0) {
      chrome.action.setBadgeText({ text: String(activeCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch { /* silent */ }
}

// Poll on alarm
chrome.alarms.create('poll-opens', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-opens') {
    pollForOpens();
    pollSequenceStatus();
  }
});

// Also poll on install/startup
chrome.runtime.onStartup.addListener(() => {
  pollForOpens();
  pollSequenceStatus();
});
chrome.runtime.onInstalled.addListener(() => {
  pollForOpens();
  pollSequenceStatus();
});

// Gray out icon on non-Gmail tabs, full color on Gmail
function updateIconForTab(tabId, url) {
  const isGmail = url && url.startsWith('https://mail.google.com');
  if (isGmail) {
    chrome.action.setIcon({ tabId, path: { '16': 'icons/icon16.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' } });
    chrome.action.setPopup({ tabId, popup: 'popup.html' });
  } else {
    // Disable popup on non-Gmail — clicking shows nothing useful
    chrome.action.setPopup({ tabId, popup: '' });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateIconForTab(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    updateIconForTab(activeInfo.tabId, tab.url);
  } catch { /* tab may not exist */ }
});
