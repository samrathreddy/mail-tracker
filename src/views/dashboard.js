import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { renderStatCard, renderBadge, renderFilterTabs, safeJson } from './components.js';

/**
 * Renders the dashboard page.
 *
 * @param {Object} opts
 * @param {Array} opts.results - Tracker result objects
 * @param {number} opts.totalOpens - Total opens across all trackers
 * @param {number} opts.activeCount - Number of trackers with at least one open
 * @param {number[]} opts.sparkline - 7-element array of daily open counts (last 7 days)
 * @param {number} opts.totalTrackers - Total number of trackers
 * @param {Object} opts.sequences - { active, completed, stopped, total }
 * @param {boolean} opts.oauthConnected - Whether Gmail OAuth is connected
 * @returns {string} Complete HTML page
 */
export function renderDashboard(opts) {
  const {
    results,
    totalOpens,
    activeCount,
    sparkline,
    totalTrackers,
    sequences,
    oauthConnected,
  } = opts;

  // -- Header actions: search box + new tracker button --
  const headerActions = `
    <div class="search-box">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="searchInput" type="text" placeholder="Search trackers...">
    </div>
    <button class="btn btn-primary" id="newBtn">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      New Tracker
    </button>`;

  // -- Stat cards --
  const unopenedCount = totalTrackers - activeCount;
  const openRate = totalTrackers > 0 ? Math.round((activeCount / totalTrackers) * 100) : 0;

  const statCards = `<div class="stat-grid">
    ${renderStatCard({
      label: 'Total Opens',
      value: String(totalOpens),
      sparklineData: sparkline,
    })}
    ${renderStatCard({
      label: 'Trackers',
      value: String(totalTrackers),
      extra: `${renderBadge(activeCount + ' opened', 'green')} ${renderBadge(unopenedCount + ' waiting', 'gray')}`,
    })}
    ${renderStatCard({
      label: 'Sequences',
      value: String(sequences.active),
      change: 'of ' + sequences.total + ' total',
      changeDirection: 'neutral',
      barSegments: [
        { value: sequences.active || 0, color: 'var(--accent)' },
        { value: sequences.completed || 0, color: 'var(--success)' },
        { value: sequences.stopped || 0, color: 'var(--text-muted)' },
      ],
      barLegend: [
        { color: 'var(--accent)', label: 'Active' },
        { color: 'var(--success)', label: 'Done' },
        { color: 'var(--text-muted)', label: 'Stopped' },
      ],
    })}
    ${renderStatCard({
      label: 'Open Rate',
      value: openRate + '%',
      ringPercent: openRate,
      ringLabel: activeCount + '/' + totalTrackers,
    })}
  </div>`;

  // -- Filter tabs --
  const withSequenceCount = results.filter(r => r.sequenceProgress).length;
  const filterTabsHtml = renderFilterTabs([
    { key: 'all', label: 'All', count: totalTrackers },
    { key: 'opened', label: 'Opened', count: activeCount },
    { key: 'unopened', label: 'Unopened', count: unopenedCount },
    { key: 'sequence', label: 'With Sequence', count: withSequenceCount },
  ], 'all');

  // -- Sort select --
  const sortSelect = `<select class="input" id="sortSelect" style="padding:4px 8px;font-size:11px;">
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="most-opens">Most Opens</option>
    <option value="last-opened">Last Opened</option>
  </select>`;

  // -- List panel --
  const listPanel = `<div class="list-panel">
    <div class="list-header">
      ${filterTabsHtml}
      ${sortSelect}
    </div>
    <div class="list-cols">
      <span style="width:8px"></span>
      <span style="flex:2">Recipient</span>
      <span style="flex:2">Subject</span>
      <span style="width:65px;text-align:right">Opens</span>
      <span style="width:80px;text-align:center">Sequence</span>
      <span style="width:65px;text-align:right">When</span>
    </div>
    <div class="list-body" id="trackerList"></div>
  </div>`;

  // -- Live feed bar --
  const lastOpened = results.find(r => r.opens > 0 && r.lastOpen !== 'never');
  let liveFeedHtml = '';
  if (lastOpened) {
    liveFeedHtml = `<div class="live-feed">
      <div class="live-dot"></div>
      <span>Latest: <strong>${esc(lastOpened.email)}</strong> opened <strong>${esc(lastOpened.subject || 'Untitled')}</strong></span>
      <a href="/activity" style="margin-left:auto;color:var(--accent-light);font-size:11px;text-decoration:none;">View Activity</a>
    </div>`;
  }

  // -- Create tracker modal --
  const modal = `<div class="modal-overlay" id="modalOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);z-index:100;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.2s ease;">
    <div id="modalInner" style="position:relative;background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;padding:28px;width:90%;max-width:440px;transform:translateY(8px);transition:transform 0.2s ease, opacity 0.2s ease;opacity:0;">
      <button class="modal-close-btn" id="modalCloseX" type="button" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <h2 style="font-size:1.1rem;margin-bottom:20px;font-weight:700;">Create New Tracker</h2>
      <div id="modalForm">
        <label style="display:block;font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px;font-weight:500;">Recipient Email (optional)</label>
        <input class="input" type="email" id="inputTo" placeholder="recipient@example.com" style="width:100%;margin-bottom:16px;">
        <label style="display:block;font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px;font-weight:500;">Subject (optional)</label>
        <input class="input" type="text" id="inputSubject" placeholder="Email subject line" style="width:100%;margin-bottom:16px;">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
          <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary" id="createBtn">Create Tracker</button>
        </div>
      </div>
      <div id="modalResult" style="display:none">
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px;">Pixel HTML (copy into your email)</div>
          <div class="input" id="resultHtml" style="font-family:monospace;font-size:0.75rem;word-break:break-all;user-select:all;padding:12px;cursor:pointer;"></div>
        </div>
        <div style="margin-top:12px">
          <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px;">Stats URL</div>
          <div class="input" id="resultStats" style="font-family:monospace;font-size:0.75rem;word-break:break-all;user-select:all;padding:12px;cursor:pointer;"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">
          <button class="btn btn-secondary" id="closeResult">Close</button>
          <button class="btn btn-primary" id="copyHtmlBtn">Copy Pixel HTML</button>
        </div>
      </div>
    </div>
  </div>`;

  // -- Combine body --
  const bodyHtml = `
    <div style="padding:0 32px 32px;">
      ${statCards}
      <div style="margin-top:16px;">${liveFeedHtml}</div>
      <div style="margin-top:16px;">${listPanel}</div>
    </div>
    ${modal}`;

  // -- Client-side scripts --
  const scripts = `
    var DATA = ${safeJson(results)};
    var TOTAL_TRACKERS = ${safeJson(totalTrackers)};

    function relativeTime(dateStr) {
      if (!dateStr || dateStr === 'never') return 'never';
      var diff = Date.now() - new Date(dateStr).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      var days = Math.floor(hrs / 24);
      if (days < 30) return days + 'd ago';
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    var listBody = document.getElementById('trackerList');
    var currentFilter = 'all';
    var currentSort = 'newest';
    var currentSearch = '';

    function getFiltered() {
      var items = DATA;
      if (currentSearch) {
        var q = currentSearch.toLowerCase();
        items = items.filter(function(r) {
          return (r.email || '').toLowerCase().indexOf(q) !== -1 ||
            (r.subject || '').toLowerCase().indexOf(q) !== -1 ||
            (r.bodyPreview || '').toLowerCase().indexOf(q) !== -1;
        });
      }
      if (currentFilter === 'opened') items = items.filter(function(r) { return r.opens > 0; });
      else if (currentFilter === 'unopened') items = items.filter(function(r) { return r.opens === 0; });
      else if (currentFilter === 'sequence') items = items.filter(function(r) { return !!r.sequenceProgress; });

      items = items.slice();
      if (currentSort === 'oldest') items.sort(function(a, b) { return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); });
      else if (currentSort === 'most-opens') items.sort(function(a, b) { return b.opens - a.opens; });
      else if (currentSort === 'last-opened') items.sort(function(a, b) {
        var aT = a.lastOpen === 'never' ? 0 : new Date(a.lastOpen).getTime();
        var bT = b.lastOpen === 'never' ? 0 : new Date(b.lastOpen).getTime();
        return bT - aT;
      });
      return items;
    }

    function renderRows(items) {
      while (listBody.firstChild) listBody.removeChild(listBody.firstChild);
      if (items.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'empty-state';
        var emptyText = document.createElement('p');
        emptyText.textContent = DATA.length === 0 ? 'No tracked emails yet' : 'No results match your filters';
        empty.appendChild(emptyText);
        listBody.appendChild(empty);
        return;
      }
      items.forEach(function(r) {
        var row = document.createElement('a');
        row.href = '/s/' + encodeURIComponent(r.id);
        row.className = 'list-row';

        var dot = document.createElement('div');
        dot.className = 'row-dot ' + (r.opens > 0 ? 'open' : 'closed');
        row.appendChild(dot);

        var recipient = document.createElement('div');
        recipient.style.cssText = 'flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;';
        recipient.textContent = r.email || r.id;
        row.appendChild(recipient);

        var subject = document.createElement('div');
        subject.style.cssText = 'flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--text-secondary);';
        subject.textContent = r.subject || 'Untitled';
        row.appendChild(subject);

        var opens = document.createElement('div');
        opens.style.cssText = 'width:65px;text-align:right;font-size:13px;font-weight:600;';
        opens.style.color = r.opens > 0 ? 'var(--success)' : 'var(--text-muted)';
        opens.textContent = r.opens;
        row.appendChild(opens);

        var seqCell = document.createElement('div');
        seqCell.style.cssText = 'width:80px;text-align:center;font-size:10px;';
        if (r.sequenceProgress) {
          var seqBadge = document.createElement('span');
          seqBadge.className = 'badge badge-blue';
          seqBadge.textContent = r.sequenceProgress;
          seqCell.appendChild(seqBadge);
        } else {
          seqCell.textContent = '-';
          seqCell.style.color = 'var(--text-muted)';
        }
        row.appendChild(seqCell);

        var when = document.createElement('div');
        when.style.cssText = 'width:65px;text-align:right;font-size:11px;color:var(--text-muted);';
        when.textContent = relativeTime(r.createdAt);
        row.appendChild(when);

        listBody.appendChild(row);
      });
    }

    renderRows(getFiltered());

    /* Filter tabs */
    document.querySelectorAll('.filter-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        currentFilter = tab.getAttribute('data-filter');
        renderRows(getFiltered());
      });
    });

    /* Search */
    document.getElementById('searchInput').addEventListener('input', function(e) {
      currentSearch = e.target.value;
      renderRows(getFiltered());
    });

    /* Sort */
    document.getElementById('sortSelect').addEventListener('change', function(e) {
      currentSort = e.target.value;
      renderRows(getFiltered());
    });

    /* Modal */
    var overlay = document.getElementById('modalOverlay');
    var modalForm = document.getElementById('modalForm');
    var modalResult = document.getElementById('modalResult');

    var modalInner = document.getElementById('modalInner');

    function openModal() {
      modalForm.style.display = '';
      modalResult.style.display = 'none';
      document.getElementById('inputTo').value = '';
      document.getElementById('inputSubject').value = '';
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';
      requestAnimationFrame(function() {
        modalInner.style.opacity = '1';
        modalInner.style.transform = 'translateY(0)';
      });
    }

    function closeModal(reload) {
      modalInner.style.opacity = '0';
      modalInner.style.transform = 'translateY(8px)';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      if (reload) setTimeout(function() { location.reload(); }, 200);
    }

    document.getElementById('newBtn').addEventListener('click', openModal);

    document.getElementById('cancelBtn').addEventListener('click', function() { closeModal(false); });

    document.getElementById('modalCloseX').addEventListener('click', function() { closeModal(false); });

    document.getElementById('closeResult').addEventListener('click', function() { closeModal(true); });

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal(false);
    });

    var createdPixelHtml = '';
    document.getElementById('createBtn').addEventListener('click', function() {
      var body = {};
      var to = document.getElementById('inputTo').value;
      var subject = document.getElementById('inputSubject').value;
      if (to) body.to = to;
      if (subject) body.subject = subject;
      fetch('/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function(r) {
          if (!r.ok) throw new Error('Request failed');
          return r.json();
        })
        .then(function(data) {
          createdPixelHtml = data.html;
          document.getElementById('resultHtml').textContent = data.html;
          document.getElementById('resultStats').textContent = data.stats;
          modalForm.style.display = 'none';
          modalResult.style.display = '';
        })
        .catch(function(err) {
          alert('Error: ' + err.message);
        });
    });

    document.getElementById('copyHtmlBtn').addEventListener('click', function() {
      navigator.clipboard.writeText(createdPixelHtml).then(function() {
        var btn = document.getElementById('copyHtmlBtn');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy Pixel HTML'; }, 1500);
      });
    });
  `;

  const subtitle = totalTrackers + ' tracker' + (totalTrackers !== 1 ? 's' : '') + ' active';

  return renderLayout({
    title: 'Dashboard',
    subtitle,
    activePage: 'dashboard',
    headerActions,
    bodyHtml,
    scripts,
    oauthConnected,
  });
}
