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

// --- Skeleton loading helper ---
function renderSkeletonLoading(container, count) {
  container.textContent = '';
  for (var i = 0; i < count; i++) {
    var row = document.createElement('div');
    row.className = 'skeleton-row';
    var circle = document.createElement('div');
    circle.className = 'skeleton-circle';
    circle.style.animationDelay = (i * 0.15) + 's';
    row.appendChild(circle);
    var lines = document.createElement('div');
    lines.className = 'skeleton-lines';
    var line1 = document.createElement('div');
    line1.className = 'skeleton-line';
    line1.style.animationDelay = (i * 0.15) + 's';
    var line2 = document.createElement('div');
    line2.className = 'skeleton-line';
    line2.style.animationDelay = (i * 0.15 + 0.1) + 's';
    lines.appendChild(line1);
    lines.appendChild(line2);
    row.appendChild(lines);
    container.appendChild(row);
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

  // Update server URL display if connected
  updateServerUrlDisplay();

  checkOAuthStatus();
}

function updateServerUrlDisplay() {
  var existing = document.getElementById('server-url-display');
  if (existing) existing.remove();

  if (!serverUrl) return;
  var container = document.querySelector('.setup');
  var footer = container.querySelector('.settings-footer');
  if (!footer) return;

  var urlCard = document.createElement('div');
  urlCard.id = 'server-url-display';
  urlCard.style.cssText = 'margin-top:16px;padding:10px 12px;background:#27272a;border-radius:8px;border:1px solid #3f3f46;text-align:left;';

  var urlLabel = document.createElement('div');
  urlLabel.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#71717a;margin-bottom:4px;';
  urlLabel.textContent = 'Connected Server';
  urlCard.appendChild(urlLabel);

  var urlValue = document.createElement('div');
  urlValue.style.cssText = 'font-family:"SF Mono","Fira Code",monospace;font-size:11px;color:#60a5fa;word-break:break-all;';
  urlValue.textContent = serverUrl;
  urlCard.appendChild(urlValue);

  container.insertBefore(urlCard, footer);
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
      noOpens.style.cssText = 'color:#71717a;font-size:12px;text-align:center;padding:16px;';
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
    errDiv.style.cssText = 'color:#ef4444;text-align:center;padding:16px;';
    errDiv.textContent = `Failed to load: ${err.message}`;
    eventsListEl.appendChild(errDiv);
  }
}

// --- Actions ---
async function loadPixels() {
  renderSkeletonLoading(pixelContainer, 4);

  try {
    const pixels = await api('/list');
    pixelContainer.textContent = '';

    if (pixels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty view-fade';
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size:28px;margin-bottom:4px;';
      icon.textContent = '\u25CB';
      const text = document.createElement('p');
      text.textContent = 'No tracked emails yet';
      var sub = document.createElement('p');
      sub.style.cssText = 'color:#71717a;font-size:11px;margin-top:4px;';
      sub.textContent = 'Click + Manual to create a tracker';
      empty.appendChild(icon);
      empty.appendChild(text);
      empty.appendChild(sub);
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
    list.className = 'pixel-list view-fade';

    pixels.forEach(p => {
      const item = document.createElement('div');
      item.className = 'pixel-item';
      item.dataset.id = p.id;

      const opens = document.createElement('div');
      opens.className = 'pixel-opens';
      opens.textContent = p.opens;
      if (p.opens > 0) {
        opens.classList.add('has-opens');
      } else {
        opens.classList.add('no-opens');
      }

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
      meta.textContent = metaParts.join(' \u00B7 ');
      info.appendChild(meta);
      item.appendChild(opens);
      item.appendChild(info);

      item.addEventListener('click', () => showDetail(p.id));
      list.appendChild(item);
    });

    pixelContainer.appendChild(list);
  } catch (err) {
    pixelContainer.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty view-fade';
    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:24px;margin-bottom:4px;';
    icon.textContent = '\u26A0';
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
  errorEl.style.color = '#a1a1aa';

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
      b.classList.remove('active');
    });
    btn.classList.add('active');

    var tab = btn.getAttribute('data-tab');
    var pixelEl = document.getElementById('pixel-container');
    var seqEl = document.getElementById('sequences-view');
    var tmplEl = document.getElementById('templates-view');

    pixelEl.style.display = tab === 'list' ? '' : 'none';
    seqEl.style.display = tab === 'sequences' ? '' : 'none';
    tmplEl.style.display = tab === 'templates' ? '' : 'none';

    // Add fade animation to active tab content
    var activeEl = tab === 'list' ? pixelEl : (tab === 'sequences' ? seqEl : tmplEl);
    activeEl.classList.remove('view-fade');
    // Force reflow to restart animation
    void activeEl.offsetWidth;
    activeEl.classList.add('view-fade');

    if (tab === 'sequences') loadSequencesView();
    if (tab === 'templates') loadTemplatesView();
  });
});

async function loadSequencesView() {
  var container = document.getElementById('sequences-view');
  container.textContent = '';

  // Skeleton loading
  var loadWrap = document.createElement('div');
  loadWrap.style.cssText = 'padding:4px 0;';
  for (var li = 0; li < 3; li++) {
    var skel = document.createElement('div');
    skel.style.cssText = 'background:#27272a;border-radius:10px;padding:14px;margin-bottom:8px;';
    var skelLine1 = document.createElement('div');
    skelLine1.className = 'skeleton-line';
    skelLine1.style.width = '70%';
    skelLine1.style.animationDelay = (li * 0.15) + 's';
    var skelLine2 = document.createElement('div');
    skelLine2.className = 'skeleton-line';
    skelLine2.style.width = '40%';
    skelLine2.style.animationDelay = (li * 0.15 + 0.1) + 's';
    skel.appendChild(skelLine1);
    skel.appendChild(skelLine2);
    loadWrap.appendChild(skel);
  }
  container.appendChild(loadWrap);

  try {
    var sequences = await api('/sequences');
    container.textContent = '';

    if (sequences.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      var emptyIcon = document.createElement('div');
      emptyIcon.style.cssText = 'font-size:28px;margin-bottom:4px;';
      emptyIcon.textContent = '\u25CB';
      var emptyText = document.createElement('p');
      emptyText.textContent = 'No sequences yet';
      var emptySub = document.createElement('p');
      emptySub.style.cssText = 'color:#71717a;font-size:11px;margin-top:4px;';
      emptySub.textContent = 'Create sequences from the dashboard';
      empty.appendChild(emptyIcon);
      empty.appendChild(emptyText);
      empty.appendChild(emptySub);
      container.appendChild(empty);
      return;
    }

    var statusColors = { active: '#22c55e', stopped: '#eab308', completed: '#3b82f6', paused: '#f97316' };
    var statusBgColors = { active: 'rgba(34,197,94,0.12)', stopped: 'rgba(234,179,8,0.12)', completed: 'rgba(59,130,246,0.12)', paused: 'rgba(249,115,22,0.12)' };

    sequences.forEach(function(seq) {
      var card = document.createElement('div');
      card.style.cssText = 'background:#27272a;border-radius:10px;padding:14px;margin-bottom:8px;cursor:pointer;transition:background 0.2s,transform 0.15s,box-shadow 0.2s;border:1px solid transparent;';

      card.addEventListener('mouseenter', function() {
        card.style.background = '#3f3f46';
        card.style.transform = 'translateY(-1px)';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
      });
      card.addEventListener('mouseleave', function() {
        card.style.background = '#27272a';
        card.style.transform = 'translateY(0)';
        card.style.boxShadow = 'none';
      });

      var header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';

      var recipientEl = document.createElement('span');
      recipientEl.style.cssText = 'color:#e4e4e7;font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      recipientEl.textContent = seq.recipient;
      header.appendChild(recipientEl);

      var statusEl = document.createElement('span');
      statusEl.className = 'seq-badge';
      var sColor = statusColors[seq.status] || '#71717a';
      var sBg = statusBgColors[seq.status] || 'rgba(113,113,122,0.12)';
      statusEl.style.cssText = 'color:' + sColor + ';background:' + sBg + ';';
      // Status dot
      var statusDot = document.createElement('span');
      statusDot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:' + sColor + ';margin-right:4px;vertical-align:middle;';
      statusEl.appendChild(statusDot);
      var statusText = document.createTextNode(seq.status);
      statusEl.appendChild(statusText);
      header.appendChild(statusEl);

      card.appendChild(header);

      var progress = document.createElement('div');
      progress.style.cssText = 'color:#a1a1aa;font-size:12px;margin-top:6px;';
      progress.textContent = 'Step ' + (seq.currentStep + 1) + ' of ' + seq.steps.length;
      card.appendChild(progress);

      // Show next send time for active sequences
      if (seq.status === 'active' && seq.steps && seq.steps[seq.currentStep]) {
        var nextStep = seq.steps[seq.currentStep];
        if (nextStep.scheduledAt) {
          var nextTime = document.createElement('div');
          nextTime.style.cssText = 'display:flex;align-items:center;gap:4px;color:#60a5fa;font-size:11px;margin-top:4px;';
          // Clock icon (unicode)
          var clockIcon = document.createElement('span');
          clockIcon.style.cssText = 'font-size:12px;';
          clockIcon.textContent = '\u23F0';
          nextTime.appendChild(clockIcon);

          var timeText = document.createElement('span');
          var scheduledDate = new Date(nextStep.scheduledAt);
          var now = Date.now();
          var diffMs = scheduledDate.getTime() - now;
          if (diffMs <= 0) {
            timeText.textContent = 'Sending soon';
          } else if (diffMs < 3600000) {
            timeText.textContent = 'Next in ' + Math.ceil(diffMs / 60000) + 'm';
          } else if (diffMs < 86400000) {
            timeText.textContent = 'Next in ' + Math.ceil(diffMs / 3600000) + 'h';
          } else {
            timeText.textContent = 'Next: ' + scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          }
          nextTime.appendChild(timeText);
          card.appendChild(nextTime);
        }
      }

      // Click-to-expand step timeline with smooth transition
      var timeline = document.createElement('div');
      timeline.className = 'timeline-collapse';
      timeline.style.cssText += 'margin-top:8px;border-top:1px solid #3f3f46;padding-top:0;';

      var timelineInner = document.createElement('div');
      timelineInner.style.cssText = 'padding-top:8px;';

      seq.steps.forEach(function(step, si) {
        var stepRow = document.createElement('div');
        stepRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;';

        var dot = document.createElement('span');
        if (step.sentAt) {
          dot.style.cssText = 'color:#22c55e;font-size:12px;';
          dot.textContent = '\u2713';
        } else if (si === seq.currentStep && seq.status === 'active') {
          dot.style.cssText = 'color:#3b82f6;font-size:10px;';
          dot.textContent = '\u25CF';
        } else {
          dot.style.cssText = 'color:#52525b;font-size:10px;';
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

        timelineInner.appendChild(stepRow);
      });

      timeline.appendChild(timelineInner);
      card.appendChild(timeline);

      card.addEventListener('click', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        if (timeline.classList.contains('expanded')) {
          timeline.classList.remove('expanded');
        } else {
          timeline.classList.add('expanded');
        }
      });

      if (seq.status === 'active') {
        var actions = document.createElement('div');
        actions.style.cssText = 'margin-top:8px;display:flex;gap:6px;';

        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'background:transparent;color:#ef4444;border:1px solid #ef4444;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:500;transition:background 0.2s,color 0.2s;';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('mouseenter', function() {
          cancelBtn.style.background = '#ef4444';
          cancelBtn.style.color = '#fff';
        });
        cancelBtn.addEventListener('mouseleave', function() {
          cancelBtn.style.background = 'transparent';
          cancelBtn.style.color = '#ef4444';
        });
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
        skipBtn.style.cssText = 'background:transparent;color:#3b82f6;border:1px solid #3b82f6;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:500;transition:background 0.2s,color 0.2s;';
        skipBtn.textContent = 'Skip Step';
        skipBtn.addEventListener('mouseenter', function() {
          skipBtn.style.background = '#3b82f6';
          skipBtn.style.color = '#fff';
        });
        skipBtn.addEventListener('mouseleave', function() {
          skipBtn.style.background = 'transparent';
          skipBtn.style.color = '#3b82f6';
        });
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

  // Skeleton loading
  var loadWrap = document.createElement('div');
  var skelBtn = document.createElement('div');
  skelBtn.className = 'skeleton-line';
  skelBtn.style.cssText += 'height:38px;width:100%;border-radius:8px;margin-bottom:12px;';
  loadWrap.appendChild(skelBtn);
  for (var li = 0; li < 2; li++) {
    var skel = document.createElement('div');
    skel.style.cssText = 'background:#27272a;border-radius:10px;padding:14px;margin-bottom:8px;';
    var sl1 = document.createElement('div');
    sl1.className = 'skeleton-line';
    sl1.style.width = '60%';
    sl1.style.animationDelay = (li * 0.15) + 's';
    var sl2 = document.createElement('div');
    sl2.className = 'skeleton-line';
    sl2.style.width = '35%';
    sl2.style.animationDelay = (li * 0.15 + 0.1) + 's';
    skel.appendChild(sl1);
    skel.appendChild(sl2);
    loadWrap.appendChild(skel);
  }
  container.appendChild(loadWrap);

  try {
    var templates = await api('/templates');
    container.textContent = '';

    var createBtn = document.createElement('button');
    createBtn.style.cssText = 'background:linear-gradient(135deg,#6366f1,#3b82f6);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;margin-bottom:12px;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;transition:opacity 0.2s,transform 0.15s;';
    var plusIcon = document.createElement('span');
    plusIcon.style.cssText = 'font-size:16px;font-weight:700;';
    plusIcon.textContent = '+';
    var btnLabel = document.createElement('span');
    btnLabel.textContent = 'Create Template';
    var extIcon = document.createElement('span');
    extIcon.style.cssText = 'font-size:11px;opacity:0.7;';
    extIcon.textContent = '\u2197';
    createBtn.appendChild(plusIcon);
    createBtn.appendChild(btnLabel);
    createBtn.appendChild(extIcon);
    createBtn.addEventListener('mouseenter', function() {
      createBtn.style.opacity = '0.85';
      createBtn.style.transform = 'translateY(-1px)';
    });
    createBtn.addEventListener('mouseleave', function() {
      createBtn.style.opacity = '1';
      createBtn.style.transform = 'translateY(0)';
    });
    createBtn.addEventListener('click', function() {
      chrome.tabs.create({ url: serverUrl + '/templates' });
    });
    container.appendChild(createBtn);

    if (templates.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      var emptyIcon = document.createElement('div');
      emptyIcon.style.cssText = 'font-size:28px;margin-bottom:4px;';
      emptyIcon.textContent = '\u25CB';
      var emptyText = document.createElement('p');
      emptyText.textContent = 'No templates yet';
      var emptySub = document.createElement('p');
      emptySub.style.cssText = 'color:#71717a;font-size:11px;margin-top:4px;';
      emptySub.textContent = 'Create them from the dashboard';
      empty.appendChild(emptyIcon);
      empty.appendChild(emptyText);
      empty.appendChild(emptySub);
      container.appendChild(empty);
      return;
    }

    templates.forEach(function(tmpl) {
      var card = document.createElement('div');
      card.style.cssText = 'background:#27272a;border-radius:10px;padding:14px;margin-bottom:8px;border:1px solid #3f3f46;transition:background 0.2s,transform 0.15s,box-shadow 0.2s;cursor:default;';

      card.addEventListener('mouseenter', function() {
        card.style.background = '#3f3f46';
        card.style.transform = 'translateY(-1px)';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
      });
      card.addEventListener('mouseleave', function() {
        card.style.background = '#27272a';
        card.style.transform = 'translateY(0)';
        card.style.boxShadow = 'none';
      });

      var nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

      var name = document.createElement('div');
      name.style.cssText = 'color:#e4e4e7;font-size:13px;font-weight:600;';
      name.textContent = tmpl.name;
      nameRow.appendChild(name);

      var stepsCount = document.createElement('span');
      stepsCount.style.cssText = 'font-size:11px;color:#a1a1aa;background:#3f3f46;padding:2px 8px;border-radius:20px;';
      stepsCount.textContent = tmpl.steps.length + ' steps';
      nameRow.appendChild(stepsCount);

      card.appendChild(nameRow);

      var meta = document.createElement('div');
      meta.style.cssText = 'color:#71717a;font-size:11px;margin-top:6px;';
      meta.textContent = tmpl.timezone;
      card.appendChild(meta);

      // Step pills
      var pillRow = document.createElement('div');
      pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;';
      tmpl.steps.forEach(function(s, i) {
        var pill = document.createElement('span');
        pill.style.cssText = 'display:inline-block;font-size:10px;font-weight:500;padding:2px 8px;border-radius:20px;background:#3f3f46;color:#a1a1aa;';
        if (i === 0) {
          pill.textContent = 'Day 0';
        } else {
          pill.textContent = 'Day ' + s.delayDays;
        }
        pillRow.appendChild(pill);
      });
      card.appendChild(pillRow);

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
      indicator.textContent = '';
      var connDot = document.createElement('span');
      connDot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;margin-right:4px;vertical-align:middle;';
      indicator.appendChild(connDot);
      var connText = document.createTextNode(status.email || 'Connected');
      indicator.appendChild(connText);
      indicator.style.cssText = 'font-size:12px;color:#22c55e;padding:2px 8px;border-radius:20px;background:rgba(34,197,94,0.12);';
      btn.textContent = 'Disconnect Gmail';
      btn.style.cssText = 'margin-top:10px;background:transparent;color:#ef4444;border:1px solid #ef4444;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;width:100%;display:block;transition:background 0.2s,color 0.2s;';
      btn.onmouseenter = function() { btn.style.background = '#ef4444'; btn.style.color = '#fff'; };
      btn.onmouseleave = function() { btn.style.background = 'transparent'; btn.style.color = '#ef4444'; };
    } else {
      indicator.textContent = '';
      var discDot = document.createElement('span');
      discDot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#ef4444;margin-right:4px;vertical-align:middle;';
      indicator.appendChild(discDot);
      var discText = document.createTextNode('Not connected');
      indicator.appendChild(discText);
      indicator.style.cssText = 'font-size:12px;color:#ef4444;padding:2px 8px;border-radius:20px;background:rgba(239,68,68,0.12);';
      btn.textContent = 'Connect Gmail';
      btn.style.cssText = 'margin-top:10px;background:linear-gradient(135deg,#6366f1,#3b82f6);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;width:100%;display:block;transition:opacity 0.2s,transform 0.15s;';
      btn.onmouseenter = function() { btn.style.opacity = '0.85'; };
      btn.onmouseleave = function() { btn.style.opacity = '1'; };
    }
  } catch (_e) { /* ignore */ }
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
  } catch (_e) { showToast('OAuth error'); }
});
