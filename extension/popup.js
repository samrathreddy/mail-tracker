// --- State ---
let serverUrl = '';
let dashboardPassword = '';
let currentPixelId = null;
let authFailed = false; // Track if last auth failed

// --- DOM refs ---
const listView = document.getElementById('list-view');
const detailView = document.getElementById('detail-view');
const setupView = document.getElementById('setup-view');
const pixelContainer = document.getElementById('pixel-container');
const toastEl = document.getElementById('toast');

// --- Sanitization ---
function _esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  const { serverUrl: saved, dashboardPassword: savedPass, authFailed: savedAuthFailed } = await chrome.storage.sync.get(['serverUrl', 'dashboardPassword', 'authFailed']);
  serverUrl = saved || '';
  dashboardPassword = savedPass || '';
  authFailed = savedAuthFailed || false;

  if (!serverUrl || !dashboardPassword || authFailed) {
    showSetup(true);
  } else {
    loadPixels();
  }

  // Event listeners
  document.getElementById('new-btn').addEventListener('click', createPixel);
  document.getElementById('settings-btn').addEventListener('click', () => showSetup(false));
  document.getElementById('back-btn').addEventListener('click', showList);
  document.getElementById('setup-back-btn').addEventListener('click', () => {
    if (serverUrl) {
      setupView.style.display = 'none';
      listView.style.display = 'block';
    }
  });
  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('delete-btn').addEventListener('click', deleteCurrentPixel);

  // Auto-track toggle
  const autoToggle = document.getElementById('auto-track-toggle');
  const { autoTrack } = await chrome.storage.sync.get('autoTrack');
  autoToggle.checked = autoTrack !== false; // default on
  autoToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ autoTrack: autoToggle.checked });
  });
  document.getElementById('snippet-html').addEventListener('click', () => {
    copyToClipboard(document.getElementById('snippet-html').dataset.value);
  });
  document.getElementById('snippet-url').addEventListener('click', () => {
    copyToClipboard(document.getElementById('snippet-url').dataset.value);
  });
});

// --- API helpers ---
async function api(path) {
  const headers = {
    'Accept': 'application/json'
  };
  if (dashboardPassword) {
    headers['Authorization'] = 'Basic ' + btoa(':' + dashboardPassword);
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
  
  try {
    const res = await fetch(`${serverUrl}${path}`, { 
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (res.status === 401) {
      // Authentication failed - clear stored password and show setup
      authFailed = true;
      dashboardPassword = ''; // Clear in memory
      await chrome.storage.sync.set({ authFailed: true, dashboardPassword: '' });
      showSetup(false);
      throw new Error('Authentication required');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - check your password', { cause: err });
    }
    throw err;
  }
}

// --- Views ---
async function showSetup(isFirst) {
  setupView.style.display = 'block';
  listView.style.display = 'none';
  detailView.classList.remove('active');
  document.getElementById('setup-back-btn').style.display = isFirst ? 'none' : 'block';
  
  const serverInput = document.getElementById('server-input');
  const passwordInput = document.getElementById('password-input');
  
  // Restore from temporary storage (persists across popup closes)
  const { tempServerUrl, tempPassword } = await chrome.storage.local.get(['tempServerUrl', 'tempPassword']);
  
  serverInput.value = tempServerUrl || serverUrl;
  passwordInput.value = tempPassword || dashboardPassword;
  
  // Save to temp storage on blur (when field loses focus)
  serverInput.onblur = () => chrome.storage.local.set({ tempServerUrl: serverInput.value });
  passwordInput.onblur = () => chrome.storage.local.set({ tempPassword: passwordInput.value });

  checkOAuthStatus();
}

function showList() {
  listView.style.display = 'block';
  detailView.classList.remove('active');
  setupView.style.display = 'none';
  currentPixelId = null;
  loadPixels();
}

async function showDetail(id) {
  currentPixelId = id;
  listView.style.display = 'none';
  detailView.classList.add('active');

  document.getElementById('detail-id').textContent = id;
  document.getElementById('detail-recipient').textContent = '';
  document.getElementById('detail-opens').textContent = '...';
  document.getElementById('detail-last').textContent = '...';

  const eventsListEl = document.getElementById('events-list');
  eventsListEl.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  const spinnerDiv = document.createElement('div');
  spinnerDiv.className = 'spinner';
  loadingDiv.appendChild(spinnerDiv);
  eventsListEl.appendChild(loadingDiv);

  const pixelUrl = `${serverUrl}/t/${id}`;
  const htmlSnippet = `<img src="${pixelUrl}" width="1" height="1" style="display:none" />`;

  const snippetHtml = document.getElementById('snippet-html');
  const snippetUrl = document.getElementById('snippet-url');
  snippetHtml.dataset.value = htmlSnippet;
  snippetHtml.firstChild.textContent = htmlSnippet;
  snippetUrl.dataset.value = pixelUrl;
  snippetUrl.firstChild.textContent = pixelUrl;

  try {
    const data = await api(`/s/${id}`);
    document.getElementById('detail-recipient').textContent =
      data.recipient ? `To: ${data.recipient}` : '';
    document.getElementById('detail-opens').textContent = data.opens;
    document.getElementById('detail-skipped').textContent = data.skipped || 0;
    document.getElementById('detail-protection').textContent =
      data.hasSenderProtection ? 'Active' : 'Off';
    document.getElementById('detail-last').textContent = data.events.length
      ? timeAgo(data.events[data.events.length - 1].time)
      : 'Never';

    const events = (data.events || []).slice().reverse().slice(0, 20);
    eventsListEl.textContent = '';

    if (events.length === 0) {
      const noOpens = document.createElement('div');
      noOpens.style.cssText = 'color:#444;font-size:12px;';
      noOpens.textContent = 'No opens yet';
      eventsListEl.appendChild(noOpens);
    } else {
      events.forEach(e => {
        const item = document.createElement('div');
        item.className = 'event-item';

        const timeDiv = document.createElement('div');
        timeDiv.className = 'event-time';
        timeDiv.textContent = timeAgo(e.time);

        const detailDiv = document.createElement('div');
        detailDiv.className = 'event-detail';
        detailDiv.textContent = `${e.country || '?'} · ${e.ip || '?'} · ${truncate(e.userAgent, 50)}`;

        item.appendChild(timeDiv);
        item.appendChild(detailDiv);
        eventsListEl.appendChild(item);
      });
    }
  } catch (err) {
    eventsListEl.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.style.color = '#ef4444';
    errDiv.textContent = `Failed to load: ${err.message}`;
    eventsListEl.appendChild(errDiv);
  }
}

// --- Actions ---
async function loadPixels() {
  pixelContainer.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  loadingDiv.appendChild(spinner);
  loadingDiv.appendChild(document.createTextNode('Loading...'));
  pixelContainer.appendChild(loadingDiv);

  try {
    const pixels = await api('/list');
    pixelContainer.textContent = '';

    if (pixels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      const icon = document.createElement('div');
      icon.style.fontSize = '24px';
      icon.textContent = '\u25CB';
      const text = document.createElement('p');
      text.textContent = 'No tracked emails yet. Click + New to create one.';
      empty.appendChild(icon);
      empty.appendChild(text);
      pixelContainer.appendChild(empty);
      return;
    }

    // Sort by most recent open
    pixels.sort((a, b) => {
      if (!a.lastOpen && !b.lastOpen) return 0;
      if (!a.lastOpen) return 1;
      if (!b.lastOpen) return -1;
      return new Date(b.lastOpen) - new Date(a.lastOpen);
    });

    const list = document.createElement('div');
    list.className = 'pixel-list';

    pixels.forEach(p => {
      const item = document.createElement('div');
      item.className = 'pixel-item';
      item.dataset.id = p.id;

      const opens = document.createElement('div');
      opens.className = 'pixel-opens';
      opens.textContent = p.opens;

      const info = document.createElement('div');
      info.className = 'pixel-info';

      if (p.recipient) {
        const recipDiv = document.createElement('div');
        recipDiv.className = 'pixel-recipient';
        recipDiv.textContent = p.recipient;
        info.appendChild(recipDiv);
      } else {
        const idDiv = document.createElement('div');
        idDiv.className = 'pixel-id';
        idDiv.textContent = p.id;
        info.appendChild(idDiv);
      }

      const meta = document.createElement('div');
      meta.className = 'pixel-meta';
      const metaParts = [];
      if (p.recipient) metaParts.push(p.id);
      metaParts.push(p.lastOpen ? timeAgo(p.lastOpen) : 'No opens yet');
      meta.textContent = metaParts.join(' · ');
      item.appendChild(opens);
      item.appendChild(info);

      item.addEventListener('click', () => showDetail(p.id));
      list.appendChild(item);
    });

    pixelContainer.appendChild(list);
  } catch (err) {
    pixelContainer.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    const icon = document.createElement('div');
    icon.style.fontSize = '24px';
    icon.textContent = '⚠️';
    const text = document.createElement('p');
    if (err.message === 'Authentication required') {
      text.textContent = 'Password incorrect. Please update your settings.';
    } else {
      text.textContent = `Error: ${err.message}`;
    }
    empty.appendChild(icon);
    empty.appendChild(text);
    pixelContainer.appendChild(empty);
  }
}

async function createPixel() {
  try {
    const data = await api('/new');
    showToast(`Tracker "${data.id}" created!`);
    loadPixels();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deleteCurrentPixel() {
  if (!currentPixelId) return;
  if (!confirm(`Delete tracker "${currentPixelId}"? This cannot be undone.`)) return;

  try {
    await api(`/d/${currentPixelId}`);
    showToast('Tracker deleted');
    showList();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function saveSettings() {
  const input = document.getElementById('server-input').value.trim().replace(/\/$/, '');
  const passwordInput = document.getElementById('password-input').value.trim();
  const errorEl = document.getElementById('setup-error');

  if (!input) {
    errorEl.textContent = 'Please enter a URL';
    errorEl.style.display = 'block';
    errorEl.style.color = '#ef4444';
    return;
  }

  // Test connection
  errorEl.textContent = 'Connecting...';
  errorEl.style.display = 'block';
  errorEl.style.color = '#888';

  try {
    const headers = {};
    if (passwordInput) {
      headers['Authorization'] = 'Basic ' + btoa(':' + passwordInput);
    }
    const res = await fetch(`${input}/list`, { headers });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    await res.json();
  } catch (err) {
    errorEl.textContent = `Can't connect: ${err.message}`;
    errorEl.style.color = '#ef4444';
    return;
  }

  serverUrl = input;
  dashboardPassword = passwordInput;
  authFailed = false;
  await chrome.storage.sync.set({ serverUrl: input, dashboardPassword: passwordInput, authFailed: false });
  
  // Clear temp storage after successful save
  await chrome.storage.local.remove(['tempServerUrl', 'tempPassword']);
  
  errorEl.style.display = 'none';
  showToast('Connected!');

  setupView.style.display = 'none';
  listView.style.display = 'block';
  loadPixels();
}

// --- Utilities ---
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2000);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  });
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function truncate(str, len) {
  if (!str) return '?';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// === SEQUENCE & TEMPLATE TAB LOGIC ===

document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) {
      b.style.background = 'transparent';
      b.style.color = '#71717a';
      b.classList.remove('active');
    });
    btn.style.background = '#27272a';
    btn.style.color = '#e4e4e7';
    btn.classList.add('active');

    var tab = btn.getAttribute('data-tab');
    document.getElementById('pixel-container').style.display = tab === 'list' ? '' : 'none';
    document.getElementById('sequences-view').style.display = tab === 'sequences' ? '' : 'none';
    document.getElementById('templates-view').style.display = tab === 'templates' ? '' : 'none';

    if (tab === 'sequences') loadSequencesView();
    if (tab === 'templates') loadTemplatesView();
  });
});

async function loadSequencesView() {
  var container = document.getElementById('sequences-view');
  container.textContent = '';
  var loading = document.createElement('div');
  loading.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
  loading.textContent = 'Loading...';
  container.appendChild(loading);

  try {
    var sequences = await api('/sequences');
    container.textContent = '';

    if (sequences.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
      empty.textContent = 'No sequences yet';
      container.appendChild(empty);
      return;
    }

    var statusColors = { active: '#22c55e', stopped: '#eab308', completed: '#6366f1', paused: '#f97316' };

    sequences.forEach(function(seq) {
      var card = document.createElement('div');
      card.style.cssText = 'background:#27272a;border-radius:10px;padding:12px;margin-bottom:8px;';

      var header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

      var recipientEl = document.createElement('span');
      recipientEl.style.cssText = 'color:#e4e4e7;font-size:13px;font-weight:500;';
      recipientEl.textContent = seq.recipient;
      header.appendChild(recipientEl);

      var statusEl = document.createElement('span');
      statusEl.style.cssText = 'font-size:12px;color:' + (statusColors[seq.status] || '#71717a') + ';';
      statusEl.textContent = seq.status;
      header.appendChild(statusEl);

      card.appendChild(header);

      var progress = document.createElement('div');
      progress.style.cssText = 'color:#a1a1aa;font-size:12px;margin-top:4px;';
      progress.textContent = 'Step ' + (seq.currentStep + 1) + '/' + seq.steps.length;
      card.appendChild(progress);

      // Show next send time for active sequences
      if (seq.status === 'active' && seq.steps && seq.steps[seq.currentStep]) {
        var nextStep = seq.steps[seq.currentStep];
        if (nextStep.scheduledAt) {
          var nextTime = document.createElement('div');
          nextTime.style.cssText = 'color:#818cf8;font-size:11px;margin-top:2px;';
          var scheduledDate = new Date(nextStep.scheduledAt);
          var now = Date.now();
          var diffMs = scheduledDate.getTime() - now;
          if (diffMs <= 0) {
            nextTime.textContent = 'Sending soon';
          } else if (diffMs < 3600000) {
            nextTime.textContent = 'Next in ' + Math.ceil(diffMs / 60000) + 'm';
          } else if (diffMs < 86400000) {
            nextTime.textContent = 'Next in ' + Math.ceil(diffMs / 3600000) + 'h';
          } else {
            nextTime.textContent = 'Next: ' + scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          }
          card.appendChild(nextTime);
        }
      }

      // Click-to-expand step timeline
      var timeline = document.createElement('div');
      timeline.style.cssText = 'display:none;margin-top:8px;border-top:1px solid #3f3f46;padding-top:8px;';
      seq.steps.forEach(function(step, si) {
        var stepRow = document.createElement('div');
        stepRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;';

        var dot = document.createElement('span');
        if (step.sentAt) {
          dot.style.cssText = 'color:#22c55e;';
          dot.textContent = '\u2713';
        } else if (si === seq.currentStep && seq.status === 'active') {
          dot.style.cssText = 'color:#818cf8;';
          dot.textContent = '\u25CF';
        } else {
          dot.style.cssText = 'color:#52525b;';
          dot.textContent = '\u25CB';
        }
        stepRow.appendChild(dot);

        var stepLabel = document.createElement('span');
        stepLabel.style.cssText = 'color:#a1a1aa;';
        stepLabel.textContent = 'Step ' + (si + 1) + ' (Day ' + (step.delayDays || '?') + ')';
        stepRow.appendChild(stepLabel);

        var stepStatus = document.createElement('span');
        stepStatus.style.cssText = 'margin-left:auto;color:#71717a;font-size:10px;';
        if (step.sentAt) {
          stepStatus.textContent = 'Sent ' + timeAgo(step.sentAt);
        } else if (step.scheduledAt) {
          stepStatus.textContent = 'Scheduled ' + new Date(step.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } else {
          stepStatus.textContent = 'Pending';
        }
        stepRow.appendChild(stepStatus);

        timeline.appendChild(stepRow);
      });
      card.appendChild(timeline);

      card.style.cursor = 'pointer';
      card.addEventListener('click', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        timeline.style.display = timeline.style.display === 'none' ? 'block' : 'none';
      });

      if (seq.status === 'active') {
        var actions = document.createElement('div');
        actions.style.cssText = 'margin-top:8px;display:flex;gap:6px;';

        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
          if (confirm('Cancel this sequence?')) {
            fetch(serverUrl + '/sequences/' + seq.id, {
              method: 'DELETE',
              headers: dashboardPassword ? { 'Authorization': 'Basic ' + btoa(':' + dashboardPassword) } : {},
            }).then(function() { loadSequencesView(); });
          }
        });
        actions.appendChild(cancelBtn);

        var skipBtn = document.createElement('button');
        skipBtn.style.cssText = 'background:#3b82f6;color:white;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', function() {
          if (confirm('Skip current step?')) {
            fetch(serverUrl + '/sequences/' + seq.id + '/skip', {
              method: 'POST',
              headers: dashboardPassword ? { 'Authorization': 'Basic ' + btoa(':' + dashboardPassword) } : {},
            }).then(function() { loadSequencesView(); });
          }
        });
        actions.appendChild(skipBtn);

        card.appendChild(actions);
      }

      container.appendChild(card);
    });
  } catch (_e) {
    container.textContent = '';
    var err = document.createElement('div');
    err.style.cssText = 'text-align:center;color:#ef4444;padding:20px;';
    err.textContent = 'Failed to load sequences';
    container.appendChild(err);
  }
}

async function loadTemplatesView() {
  var container = document.getElementById('templates-view');
  container.textContent = '';
  var loading = document.createElement('div');
  loading.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
  loading.textContent = 'Loading...';
  container.appendChild(loading);

  try {
    var templates = await api('/templates');
    container.textContent = '';

    var createBtn = document.createElement('button');
    createBtn.style.cssText = 'background:#6366f1;color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;margin-bottom:12px;width:100%;';
    createBtn.textContent = '+ Create Template (opens dashboard)';
    createBtn.addEventListener('click', function() {
      chrome.tabs.create({ url: serverUrl + '/templates' });
    });
    container.appendChild(createBtn);

    if (templates.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#71717a;padding:20px;';
      empty.textContent = 'No templates yet. Create them in the dashboard.';
      container.appendChild(empty);
      return;
    }

    templates.forEach(function(tmpl) {
      var card = document.createElement('div');
      card.style.cssText = 'background:#27272a;border-radius:10px;padding:12px;margin-bottom:8px;';

      var name = document.createElement('div');
      name.style.cssText = 'color:#e4e4e7;font-size:13px;font-weight:500;';
      name.textContent = tmpl.name;
      card.appendChild(name);

      var meta = document.createElement('div');
      meta.style.cssText = 'color:#a1a1aa;font-size:12px;margin-top:4px;';
      meta.textContent = tmpl.steps.length + ' steps | ' + tmpl.timezone;
      card.appendChild(meta);

      tmpl.steps.forEach(function(s, i) {
        var step = document.createElement('div');
        step.style.cssText = 'color:#71717a;font-size:11px;margin-top:2px;';
        step.textContent = 'Step ' + (i + 1) + ': Day ' + s.delayDays;
        card.appendChild(step);
      });

      container.appendChild(card);
    });
  } catch (_e) {
    container.textContent = '';
    var err = document.createElement('div');
    err.style.cssText = 'text-align:center;color:#ef4444;padding:20px;';
    err.textContent = 'Failed to load templates';
    container.appendChild(err);
  }
}

// OAuth status check
async function checkOAuthStatus() {
  try {
    var status = await api('/oauth/status');
    var indicator = document.getElementById('oauth-indicator');
    var btn = document.getElementById('oauth-btn');
    if (!indicator || !btn) return;

    if (status.connected) {
      indicator.textContent = 'Connected (' + status.email + ')';
      indicator.style.color = '#22c55e';
      btn.textContent = 'Disconnect';
      btn.style.background = '#ef4444';
      btn.style.display = 'block';
    } else {
      indicator.textContent = 'Not connected';
      indicator.style.color = '#ef4444';
      btn.textContent = 'Connect Gmail';
      btn.style.background = '#6366f1';
      btn.style.display = 'block';
    }
  } catch { /* ignore */ }
}

document.getElementById('oauth-btn')?.addEventListener('click', async function() {
  try {
    var status = await api('/oauth/status');
    if (status.connected) {
      if (!confirm('Disconnect Gmail?')) return;
      await fetch(serverUrl + '/oauth/disconnect', {
        method: 'POST',
        headers: dashboardPassword ? { 'Authorization': 'Basic ' + btoa(':' + dashboardPassword) } : {},
      });
      checkOAuthStatus();
    } else {
      var data = await api('/oauth/url');
      if (data.url) chrome.tabs.create({ url: data.url });
    }
  } catch { showToast('OAuth error'); }
});
