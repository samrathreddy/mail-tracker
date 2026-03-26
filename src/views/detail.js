import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { renderStatCard, renderStepProgress, renderBadge, safeJson } from './components.js';

/**
 * Renders the tracker detail page.
 *
 * @param {string} id - Tracker ID
 * @param {Object} data - Tracker data from KV
 * @param {Object|null} sequenceInfo - Sequence info if attached
 * @param {boolean} oauthConnected - Whether Gmail OAuth is connected
 * @returns {string} Complete HTML page
 */
export function renderDetail(id, data, sequenceInfo, oauthConnected) {
  const events = data.events || [];
  const filteredEvents = data.filteredEvents || [];
  const recipient = data.recipient || id;
  const firstOpen = events.length > 0 ? events[0].time : null;
  const lastOpenTime = events.length > 0 ? events[events.length - 1].time : null;
  const uniqueIps = new Set(events.map(e => e.ip)).size;

  // -- Header actions: back link + delete button --
  const headerActions = `
    <a href="/" class="btn btn-secondary" style="text-decoration:none;font-size:12px;color:var(--text-muted);transition:color 0.15s ease;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
      Dashboard
    </a>
    <button class="btn btn-danger" id="deleteBtn">Delete</button>`;

  // -- Stat cards --
  const statCards = `<div class="stat-grid">
    ${renderStatCard({
      label: 'Real Opens',
      value: String(data.opens || 0),
      extra: uniqueIps + ' unique ' + (uniqueIps === 1 ? 'viewer' : 'viewers'),
    })}
    ${renderStatCard({
      label: 'Filtered',
      value: String(data.skipped || 0),
      extra: 'bots &amp; self-opens',
    })}
    ${renderStatCard({
      label: 'First Open',
      value: firstOpen ? '<span id="statFirst"></span>' : '\u2014',
      extra: firstOpen ? '<span id="statFirstSub"></span>' : 'not yet',
    })}
    ${renderStatCard({
      label: 'Last Open',
      value: lastOpenTime ? '<span id="statLast"></span>' : '\u2014',
      extra: lastOpenTime ? '<span id="statLastSub"></span>' : 'not yet',
    })}
  </div>`;

  // -- Sequence section --
  let sequenceHtml = '';
  if (sequenceInfo) {
    const statusVariant = sequenceInfo.status === 'active' ? 'green'
      : sequenceInfo.status === 'completed' ? 'blue'
        : sequenceInfo.status === 'stopped' ? 'gray' : 'yellow';

    const stepDetails = sequenceInfo.steps.map((s, i) => {
      const sentInfo = s.sentAt
        ? ' (sent ' + esc(new Date(s.sentAt).toLocaleString('en-US', { timeZone: sequenceInfo.timezone })) + ')'
        : '';
      return `<div style="padding:4px 0;font-size:12px;color:var(--text-secondary);">
        Step ${i + 1}: Day ${s.delayDays} - ${esc(s.subject.substring(0, 60))}${sentInfo}
      </div>`;
    }).join('');

    const actionButtons = sequenceInfo.status === 'active' ? `
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn btn-danger" id="cancelSeqBtn">Cancel Sequence</button>
        <button class="btn btn-primary" id="skipStepBtn">Skip Step</button>
      </div>` : '';

    sequenceHtml = `
      <div class="panel sequence-callout" style="margin-bottom:16px;">
        <div class="panel-title" style="display:flex;align-items:center;gap:8px;">
          Sequence ${renderBadge(esc(sequenceInfo.status), statusVariant)}
        </div>
        ${renderStepProgress(sequenceInfo.steps)}
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;">
          <div style="font-size:11px;color:var(--text-muted);">
            Template: <span style="color:var(--text-secondary);">${esc(sequenceInfo.templateName || 'Unknown')}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);">
            Timezone: <span style="color:var(--text-secondary);">${esc(sequenceInfo.timezone || 'UTC')}</span>
          </div>
          ${sequenceInfo.nextSendAt ? `<div style="font-size:11px;color:var(--text-muted);">
            Next send: <span style="color:var(--text-secondary);">${esc(new Date(sequenceInfo.nextSendAt).toLocaleString('en-US', { timeZone: sequenceInfo.timezone }))}</span>
          </div>` : ''}
        </div>
        ${stepDetails}
        ${actionButtons}
      </div>`;
  }

  // -- Pixel snippet section (content populated client-side) --
  const pixelSnippet = `
    <div class="panel">
      <div class="panel-title">Pixel Snippet</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">HTML (click to copy)</div>
      <div class="input snippet-box" id="snippetHtml" style="font-family:monospace;font-size:11px;word-break:break-all;user-select:all;cursor:pointer;padding:10px;margin-bottom:10px;"></div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">URL (click to copy)</div>
      <div class="input snippet-box" id="snippetUrl" style="font-family:monospace;font-size:11px;word-break:break-all;user-select:all;cursor:pointer;padding:10px;"></div>
    </div>`;

  // -- Two-column layout --
  const bodyHtml = `
    <div style="padding:0 32px 32px;">
      ${statCards}

      ${sequenceHtml}

      <div class="two-col" style="margin-top:16px;">
        <div class="col-left" style="display:flex;flex-direction:column;gap:16px;">
          <div class="panel">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <span class="panel-title" style="margin-bottom:0;">Event Timeline</span>
              <div class="filter-tabs">
                <button class="filter-tab active" id="tabOpens">Opens</button>
                <button class="filter-tab" id="tabFiltered">Filtered</button>
              </div>
            </div>
            <div id="opensTab" class="detail-event-list"></div>
            <div id="filteredTab" class="detail-event-list" style="display:none"></div>
          </div>
        </div>
        <div class="col-right" style="display:flex;flex-direction:column;gap:16px;">
          <div class="panel">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <span class="panel-title" style="margin-bottom:0;">Open Activity</span>
              <span style="font-size:10px;color:var(--text-muted);" id="calRange"></span>
            </div>
            <div id="calWrap" style="overflow-x:auto;"></div>
            <div id="calLegend" style="display:flex;align-items:center;gap:4px;margin-top:10px;justify-content:flex-end;"></div>
          </div>
          <div class="panel">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <span class="panel-title" style="margin-bottom:0;">Peak Hours</span>
              <span style="font-size:10px;color:var(--text-muted);">local time</span>
            </div>
            <div id="timeGrid"></div>
          </div>
          ${pixelSnippet}
        </div>
      </div>
    </div>`;

  // -- Additional detail-page styles --
  const detailStyles = `
    <style>
      .cal-grid { display: flex; gap: 3px; }
      .cal-week { display: flex; flex-direction: column; gap: 3px; }
      .cal-cell { width: 13px; height: 13px; border-radius: 3px; background: var(--bg-hover); cursor: default; position: relative; transition: transform 0.1s ease, box-shadow 0.1s ease; }
      .cal-cell.l1 { background: rgba(59,130,246,0.2); }
      .cal-cell.l2 { background: rgba(59,130,246,0.4); }
      .cal-cell.l3 { background: rgba(59,130,246,0.6); }
      .cal-cell.l4 { background: var(--accent); }
      .cal-cell:hover { transform: scale(1.3); z-index: 2; box-shadow: 0 0 8px rgba(0,0,0,0.3); }
      .cal-months { display: flex; gap: 0; margin-bottom: 4px; }
      .cal-months span { font-size: 9px; color: var(--text-muted); }
      .cal-legend-cell { width: 11px; height: 11px; border-radius: 3px; }
      .cal-tooltip { position: fixed; padding: 4px 8px; border-radius: 4px; background: var(--text-primary); color: var(--bg-base); font-size: 11px; pointer-events: none; z-index: 100; white-space: nowrap; opacity: 0; transition: opacity 0.1s; }

      .time-grid { display: flex; flex-direction: column; gap: 10px; }
      .time-row-label { font-size: 10px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px; letter-spacing: 0.04em; }
      .time-row { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; }
      .time-cell { aspect-ratio: 1; border-radius: var(--radius-btn); background: var(--bg-hover); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: default; transition: transform 0.15s ease, box-shadow 0.15s ease; position: relative; }
      .time-cell:hover { transform: scale(1.15); z-index: 2; box-shadow: 0 0 12px rgba(0,0,0,0.5); }
      .time-cell .tc-hour { font-size: 8px; color: var(--text-muted); font-weight: 500; line-height: 1; }
      .time-cell .tc-count { font-size: 10px; font-weight: 700; color: var(--text-primary); line-height: 1; margin-top: 2px; }
      .time-cell.t0 { background: var(--bg-hover); }
      .time-cell.t0 .tc-count { color: var(--text-muted); }
      .time-cell.t1 { background: rgba(59,130,246,0.2); }
      .time-cell.t2 { background: rgba(59,130,246,0.4); }
      .time-cell.t3 { background: rgba(59,130,246,0.6); }
      .time-cell.t4 { background: rgba(59,130,246,0.85); }
      .time-cell.peak { background: var(--success); }
      .time-cell.peak .tc-hour { color: rgba(0,0,0,0.5); }
      .time-cell.peak .tc-count { color: #fff; }
      .time-peak-info { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
      .time-peak-info .tpi-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--success); flex-shrink: 0; }
      .time-peak-info .tpi-text { font-size: 11px; color: var(--text-secondary); }

      .event-row .event-dot.open { background: var(--accent); }
      .event-row .event-dot.filtered { background: var(--warning); }

      .detail-event-list .event-row:nth-child(even) {
        background: rgba(148,163,184,0.03);
        border-radius: var(--radius-btn);
      }

      .snippet-box {
        transition: background 0.2s ease;
      }
      .snippet-box.copied-flash {
        background: rgba(34,197,94,0.15);
      }

      @media (max-width: 900px) {
        .two-col { flex-direction: column; }
      }
      @media (max-width: 768px) {
        .stat-grid { flex-wrap: wrap; }
        .stat-grid .stat-card { min-width: calc(50% - 8px); }
      }
      @media (max-width: 480px) {
        .stat-grid .stat-card { min-width: 100%; }
      }
    </style>`;

  // -- Client-side scripts --
  const scripts = `
    var DATA = {
      id: ${safeJson(id)},
      recipient: ${safeJson(recipient)},
      subject: ${safeJson(data.subject || '')},
      opens: ${safeJson(data.opens || 0)},
      skipped: ${safeJson(data.skipped || 0)},
      hasSenderIp: ${safeJson(!!data.senderIp)},
      createdAt: ${safeJson(data.createdAt || null)},
      firstOpen: ${safeJson(firstOpen)},
      lastOpen: ${safeJson(lastOpenTime)},
      uniqueIps: ${safeJson(uniqueIps)},
      events: ${safeJson(events)},
      filtered: ${safeJson(filteredEvents)},
      sequenceId: ${safeJson(sequenceInfo ? sequenceInfo.id : null)}
    };

    function formatTime(iso) {
      return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric' });
    }
    function shortDate(iso) {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    function shortTime(iso) {
      return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    function relativeTime(iso) {
      var diff = Date.now() - new Date(iso).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      var days = Math.floor(hrs / 24);
      if (days < 30) return days + 'd ago';
      return formatTime(iso);
    }

    // Populate date-dependent stat values client-side
    var statFirst = document.getElementById('statFirst');
    if (statFirst) statFirst.textContent = shortDate(DATA.firstOpen);
    var statFirstSub = document.getElementById('statFirstSub');
    if (statFirstSub) statFirstSub.textContent = shortTime(DATA.firstOpen);
    var statLast = document.getElementById('statLast');
    if (statLast) statLast.textContent = shortDate(DATA.lastOpen);
    var statLastSub = document.getElementById('statLastSub');
    if (statLastSub) statLastSub.textContent = shortTime(DATA.lastOpen);

    // Delete button
    document.getElementById('deleteBtn').addEventListener('click', function() {
      if (confirm('Delete this tracker?')) {
        fetch('/d/' + DATA.id).then(function() { location.href = '/'; });
      }
    });

    // Sequence action buttons
    var cancelSeqBtn = document.getElementById('cancelSeqBtn');
    if (cancelSeqBtn) {
      cancelSeqBtn.addEventListener('click', function() {
        if (confirm('Cancel sequence?')) {
          fetch('/sequences/' + DATA.sequenceId, { method: 'DELETE' }).then(function() { location.reload(); });
        }
      });
    }
    var skipStepBtn = document.getElementById('skipStepBtn');
    if (skipStepBtn) {
      skipStepBtn.addEventListener('click', function() {
        if (confirm('Skip current step?')) {
          fetch('/sequences/' + DATA.sequenceId + '/skip', { method: 'POST' }).then(function() { location.reload(); });
        }
      });
    }

    // Pixel snippet (click to copy)
    var base = location.origin;
    var pixelHtmlStr = '<img src="' + base + '/t/' + DATA.id + '" width="1" height="1" style="display:none" />';
    var pixelUrlStr = base + '/t/' + DATA.id;
    var snippetHtml = document.getElementById('snippetHtml');
    function flashCopied(el, originalText) {
      navigator.clipboard.writeText(originalText).then(function() {
        el.textContent = 'Copied!';
        el.classList.add('copied-flash');
        setTimeout(function() {
          el.textContent = originalText;
          el.classList.remove('copied-flash');
        }, 1500);
      });
    }

    snippetHtml.textContent = pixelHtmlStr;
    snippetHtml.addEventListener('click', function() { flashCopied(snippetHtml, pixelHtmlStr); });
    var snippetUrl = document.getElementById('snippetUrl');
    snippetUrl.textContent = pixelUrlStr;
    snippetUrl.addEventListener('click', function() { flashCopied(snippetUrl, pixelUrlStr); });

    // Peak Hours (local timezone)
    var localHourly = new Array(24).fill(0);
    DATA.events.forEach(function(e) { localHourly[new Date(e.time).getHours()] += 1; });
    var maxH = Math.max.apply(null, localHourly.concat([1]));
    var peakHour = localHourly.indexOf(maxH);
    var HOUR_LABELS = ['12 AM','1 AM','2 AM','3 AM','4 AM','5 AM','6 AM','7 AM','8 AM','9 AM','10 AM','11 AM','12 PM','1 PM','2 PM','3 PM','4 PM','5 PM','6 PM','7 PM','8 PM','9 PM','10 PM','11 PM'];
    var SHORT_HOURS = ['12','1','2','3','4','5','6','7','8','9','10','11'];

    var timeGrid = document.getElementById('timeGrid');
    if (DATA.events.length === 0) {
      var ep = document.createElement('div'); ep.className = 'empty-state';
      var et = document.createElement('p'); et.textContent = 'No activity data yet'; ep.appendChild(et); timeGrid.appendChild(ep);
    } else {
      function getTimeLevel(v) { if (v === 0) return 't0'; var r = v / maxH; if (r <= 0.25) return 't1'; if (r <= 0.5) return 't2'; if (r <= 0.75) return 't3'; return 't4'; }
      function buildRow(label, start, end) {
        var lbl = document.createElement('div'); lbl.className = 'time-row-label'; lbl.textContent = label; timeGrid.appendChild(lbl);
        var row = document.createElement('div'); row.className = 'time-row';
        for (var i = start; i < end; i++) {
          var cell = document.createElement('div'); var v = localHourly[i];
          cell.className = 'time-cell ' + (i === peakHour ? 'peak' : getTimeLevel(v));
          cell.title = HOUR_LABELS[i] + ': ' + v + ' open' + (v !== 1 ? 's' : '');
          var h = document.createElement('span'); h.className = 'tc-hour'; h.textContent = SHORT_HOURS[i % 12];
          var c = document.createElement('span'); c.className = 'tc-count'; c.textContent = v;
          cell.appendChild(h); cell.appendChild(c); row.appendChild(cell);
        }
        timeGrid.appendChild(row);
      }
      buildRow('AM', 0, 12); buildRow('PM', 12, 24);
      var pi = document.createElement('div'); pi.className = 'time-peak-info';
      var dot = document.createElement('div'); dot.className = 'tpi-dot';
      var txt = document.createElement('span'); txt.className = 'tpi-text';
      txt.textContent = 'Peak: ' + HOUR_LABELS[peakHour] + ' with ' + maxH + ' open' + (maxH !== 1 ? 's' : '');
      pi.appendChild(dot); pi.appendChild(txt); timeGrid.appendChild(pi);
    }

    // Calendar heatmap (local timezone)
    var localDailyOpens = {};
    DATA.events.forEach(function(e) { var d = new Date(e.time); var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); localDailyOpens[key] = (localDailyOpens[key] || 0) + 1; });

    var calWrap = document.getElementById('calWrap');
    var calRange = document.getElementById('calRange');
    var tooltip = document.createElement('div'); tooltip.className = 'cal-tooltip'; document.body.appendChild(tooltip);

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var WEEKS = 16;
    var startDate = new Date(today); startDate.setDate(startDate.getDate() - (WEEKS * 7) + 1);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    calRange.textContent = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' \\u2014 ' + today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    var allVals = Object.values(localDailyOpens);
    var maxD = allVals.length > 0 ? Math.max.apply(null, allVals) : 1;

    function getLevel(count) { if (count === 0) return ''; var ratio = count / maxD; if (ratio <= 0.25) return 'l1'; if (ratio <= 0.5) return 'l2'; if (ratio <= 0.75) return 'l3'; return 'l4'; }

    var monthsRow = document.createElement('div'); monthsRow.className = 'cal-months';
    var lastMonth = -1; var weekPositions = [];
    var grid = document.createElement('div'); grid.className = 'cal-grid';
    var cursor = new Date(startDate); var weekIdx = 0;

    while (cursor <= today) {
      var week = document.createElement('div'); week.className = 'cal-week';
      var weekStartMonth = cursor.getMonth();
      for (var dow = 0; dow < 7; dow++) {
        var cell = document.createElement('div'); cell.className = 'cal-cell';
        if (cursor <= today) {
          var key = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
          var count = localDailyOpens[key] || 0; var lvl = getLevel(count);
          if (lvl) cell.className += ' ' + lvl;
          cell.setAttribute('data-date', key); cell.setAttribute('data-count', count);
        } else { cell.style.visibility = 'hidden'; }
        week.appendChild(cell); cursor.setDate(cursor.getDate() + 1);
      }
      if (weekStartMonth !== lastMonth) { weekPositions.push({ month: weekStartMonth, idx: weekIdx }); lastMonth = weekStartMonth; }
      grid.appendChild(week); weekIdx++;
    }

    var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    weekPositions.forEach(function(wp, i) {
      var label = document.createElement('span'); label.textContent = monthNames[wp.month];
      var nextIdx = (i + 1 < weekPositions.length) ? weekPositions[i + 1].idx : weekIdx;
      label.style.width = ((nextIdx - wp.idx) * 16) + 'px'; monthsRow.appendChild(label);
    });
    calWrap.appendChild(monthsRow); calWrap.appendChild(grid);

    var legend = document.getElementById('calLegend');
    var ls = document.createElement('span'); ls.textContent = 'Less'; ls.style.cssText = 'font-size:9px;color:var(--text-muted);'; legend.appendChild(ls);
    ['', 'l1', 'l2', 'l3', 'l4'].forEach(function(cls) { var b = document.createElement('div'); b.className = 'cal-legend-cell cal-cell' + (cls ? ' ' + cls : ''); legend.appendChild(b); });
    var ms = document.createElement('span'); ms.textContent = 'More'; ms.style.cssText = 'font-size:9px;color:var(--text-muted);'; legend.appendChild(ms);

    calWrap.addEventListener('mouseover', function(e) {
      if (e.target.classList.contains('cal-cell') && e.target.getAttribute('data-date')) {
        var d = e.target.getAttribute('data-date'); var c = e.target.getAttribute('data-count');
        tooltip.textContent = c + ' open' + (c !== '1' ? 's' : '') + ' on ' + new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        tooltip.style.opacity = '1'; var rect = e.target.getBoundingClientRect();
        tooltip.style.left = (rect.left + rect.width / 2 - tooltip.offsetWidth / 2) + 'px'; tooltip.style.top = (rect.top - 28) + 'px';
      }
    });
    calWrap.addEventListener('mouseout', function(e) { if (e.target.classList.contains('cal-cell')) tooltip.style.opacity = '0'; });

    // Timeline tabs
    document.getElementById('tabOpens').textContent = 'Opens (' + DATA.events.length + ')';
    document.getElementById('tabFiltered').textContent = 'Filtered (' + DATA.filtered.length + ')';
    document.getElementById('tabOpens').addEventListener('click', function() { showTab('opens'); });
    document.getElementById('tabFiltered').addEventListener('click', function() { showTab('filtered'); });
    function showTab(tab) {
      document.getElementById('opensTab').style.display = tab === 'opens' ? '' : 'none';
      document.getElementById('filteredTab').style.display = tab === 'filtered' ? '' : 'none';
      document.getElementById('tabOpens').className = 'filter-tab' + (tab === 'opens' ? ' active' : '');
      document.getElementById('tabFiltered').className = 'filter-tab' + (tab === 'filtered' ? ' active' : '');
    }

    function buildTimelineItem(e, isFiltered, idx) {
      var item = document.createElement('div'); item.className = 'event-row'; item.style.animationDelay = (idx * 0.04) + 's';
      var evDot = document.createElement('div'); evDot.className = 'event-dot ' + (isFiltered ? 'filtered' : 'open');
      var content = document.createElement('div'); content.className = 'event-text'; content.style.cssText = 'flex:1;min-width:0;';
      var timeStr = document.createElement('strong'); timeStr.textContent = relativeTime(e.time);
      var timeFull = document.createElement('em'); timeFull.textContent = ' \\u2014 ' + formatTime(e.time);
      content.appendChild(timeStr); content.appendChild(timeFull);
      if (isFiltered) {
        var reason = document.createElement('div'); reason.style.cssText = 'font-size:11px;color:var(--warning);font-weight:500;margin-top:2px;';
        reason.textContent = e.reason === 'sender_ip' ? 'Self-open' : 'Bot / Proxy';
        content.appendChild(reason);
      } else if (e.country) {
        var country = document.createElement('div'); country.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px;';
        country.textContent = e.country;
        content.appendChild(country);
      }
      var timeCol = document.createElement('div'); timeCol.className = 'event-time'; timeCol.textContent = e.ip;
      item.appendChild(evDot); item.appendChild(content); item.appendChild(timeCol);
      return item;
    }

    var opensTab = document.getElementById('opensTab');
    if (DATA.events.length === 0) {
      var ee = document.createElement('div'); ee.className = 'empty-state';
      var eep = document.createElement('p'); eep.textContent = 'No opens recorded yet';
      ee.appendChild(eep); opensTab.appendChild(ee);
    } else {
      DATA.events.slice().reverse().slice(0, 30).forEach(function(e, i) { opensTab.appendChild(buildTimelineItem(e, false, i)); });
    }

    var filteredTab = document.getElementById('filteredTab');
    if (DATA.filtered.length === 0) {
      var ef = document.createElement('div'); ef.className = 'empty-state';
      var efp = document.createElement('p'); efp.textContent = 'No filtered events';
      ef.appendChild(efp); filteredTab.appendChild(ef);
    } else {
      DATA.filtered.slice().reverse().slice(0, 20).forEach(function(e, i) { filteredTab.appendChild(buildTimelineItem(e, true, i)); });
    }
  `;

  const subtitle = data.subject ? esc(data.subject) : '';

  return detailStyles + renderLayout({
    title: esc(recipient),
    subtitle,
    activePage: 'dashboard',
    headerActions,
    bodyHtml,
    scripts,
    oauthConnected,
  });
}
