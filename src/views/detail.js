import { esc, FAVICON } from '../shared.js';

export function renderDetail(id, data) {
  const events = data.events || [];
  const filteredEvents = data.filteredEvents || [];
  const recipient = data.recipient || id;
  const firstOpen = events.length > 0 ? events[0].time : null;
  const lastOpenTime = events.length > 0 ? events[events.length - 1].time : null;
  const uniqueIps = new Set(events.map(e => e.ip)).size;

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(recipient)} - Mail Tracker</title>
<link rel="icon" href="${FAVICON}">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #09090b; --surface: #18181b; --surface-2: #1f1f23;
    --border: #27272a; --border-hover: #3f3f46;
    --text: #fafafa; --text-2: #a1a1aa; --text-3: #71717a;
    --accent: #6366f1; --accent-glow: rgba(99,102,241,0.15);
    --green: #34d399; --green-dim: rgba(52,211,153,0.12);
    --amber: #fbbf24; --amber-dim: rgba(251,191,36,0.12);
    --red: #f87171; --red-dim: rgba(248,113,113,0.12);
    --blue: #60a5fa; --blue-dim: rgba(96,165,250,0.12);
    --radius: 12px; --radius-sm: 8px;
  }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .top-bar { position: sticky; top: 0; z-index: 50; background: rgba(9,9,11,0.8); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); padding: 0 24px; height: 56px; display: flex; align-items: center; gap: 16px; }
  .top-bar a { color: var(--text-2); text-decoration: none; font-size: 0.875rem; transition: color 0.15s; }
  .top-bar a:hover { color: var(--text); }
  .top-bar .sep { color: var(--text-3); }
  .top-bar .current { color: var(--text); font-weight: 600; font-size: 0.875rem; }
  .container { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
  .header { margin-bottom: 32px; }
  .header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .header h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  .header .meta { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
  .header .meta span { font-size: 0.8rem; color: var(--text-3); display: flex; align-items: center; gap: 5px; }
  .badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 500; }
  .badge-green { background: var(--green-dim); color: var(--green); }
  .badge-amber { background: var(--amber-dim); color: var(--amber); }
  .copy-id { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 0.75rem; color: var(--text-3); cursor: pointer; font-family: 'SF Mono', 'Fira Code', monospace; transition: all 0.15s; }
  .copy-id:hover { border-color: var(--accent); color: var(--accent); }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  @media (max-width: 640px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; transition: border-color 0.2s; }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label { font-size: 0.75rem; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .stat-value { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; }
  .stat-value.green { color: var(--green); } .stat-value.amber { color: var(--amber); } .stat-value.blue { color: var(--blue); }
  .stat-sub { font-size: 0.75rem; color: var(--text-3); margin-top: 4px; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; overflow: hidden; }
  .panel-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .panel-title { font-size: 0.875rem; font-weight: 600; }
  .panel-body { padding: 20px; }
  .panel-hint { font-size: 0.7rem; color: var(--text-3); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }
  .two-col .panel { margin-bottom: 0; }
  .time-grid { display: flex; flex-direction: column; gap: 10px; }
  .time-row-label { font-size: 0.7rem; color: var(--text-3); font-weight: 600; margin-bottom: 4px; letter-spacing: 0.04em; }
  .time-row { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; }
  .time-cell { aspect-ratio: 1; border-radius: 4px; background: var(--surface-2); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: default; transition: transform 0.15s, box-shadow 0.15s; position: relative; }
  .time-cell:hover { transform: scale(1.15); z-index: 2; box-shadow: 0 0 12px rgba(0,0,0,0.5); }
  .time-cell .tc-hour { font-size: 0.55rem; color: var(--text-3); font-weight: 500; line-height: 1; }
  .time-cell .tc-count { font-size: 0.7rem; font-weight: 700; color: var(--text); line-height: 1; margin-top: 2px; }
  .time-cell.t0 { background: var(--surface-2); } .time-cell.t0 .tc-count { color: var(--text-3); }
  .time-cell.t1 { background: rgba(99,102,241,0.2); } .time-cell.t2 { background: rgba(99,102,241,0.4); }
  .time-cell.t3 { background: rgba(99,102,241,0.6); } .time-cell.t4 { background: rgba(99,102,241,0.85); }
  .time-cell.peak { background: var(--green); } .time-cell.peak .tc-hour { color: rgba(0,0,0,0.5); } .time-cell.peak .tc-count { color: #fff; }
  .time-peak-info { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .time-peak-info .tpi-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--green); flex-shrink: 0; }
  .time-peak-info .tpi-text { font-size: 0.75rem; color: var(--text-2); }
  .cal-wrap { overflow-x: auto; }
  .cal-grid { display: flex; gap: 3px; } .cal-week { display: flex; flex-direction: column; gap: 3px; }
  .cal-cell { width: 13px; height: 13px; border-radius: 2px; background: var(--surface-2); transition: background 0.15s; cursor: default; position: relative; }
  .cal-cell.l1 { background: rgba(99,102,241,0.25); } .cal-cell.l2 { background: rgba(99,102,241,0.45); }
  .cal-cell.l3 { background: rgba(99,102,241,0.7); } .cal-cell.l4 { background: var(--accent); }
  .cal-cell:hover { outline: 1px solid var(--text-3); outline-offset: -1px; }
  .cal-months { display: flex; gap: 0; margin-bottom: 4px; } .cal-months span { font-size: 0.6rem; color: var(--text-3); }
  .cal-legend { display: flex; align-items: center; gap: 4px; margin-top: 10px; justify-content: flex-end; }
  .cal-legend span { font-size: 0.6rem; color: var(--text-3); }
  .cal-legend-cell { width: 11px; height: 11px; border-radius: 2px; }
  .cal-tooltip { position: fixed; padding: 4px 8px; border-radius: 4px; background: var(--text); color: var(--bg); font-size: 0.7rem; pointer-events: none; z-index: 100; white-space: nowrap; opacity: 0; transition: opacity 0.1s; }
  .timeline { position: relative; }
  .timeline::before { content: ''; position: absolute; left: 7px; top: 8px; bottom: 8px; width: 2px; background: var(--border); border-radius: 1px; }
  .tl-item { display: flex; gap: 16px; padding: 12px 0; position: relative; animation: fadeSlide 0.3s ease both; }
  .tl-item:first-child { padding-top: 0; }
  @keyframes fadeSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .tl-dot { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; background: var(--surface-2); border: 2px solid var(--accent); position: relative; z-index: 1; margin-top: 2px; }
  .tl-dot.filtered { border-color: var(--amber); }
  .tl-content { flex: 1; min-width: 0; } .tl-time { font-size: 0.8rem; color: var(--text-2); font-weight: 500; }
  .tl-time-full { color: var(--text-3); font-weight: 400; }
  .tl-details { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
  .tl-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; color: var(--text-3); background: var(--surface-2); padding: 2px 8px; border-radius: 4px; }
  .tl-reason { font-size: 0.75rem; color: var(--amber); font-weight: 500; }
  .tabs { display: flex; gap: 4px; }
  .tab { padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; background: transparent; border: none; color: var(--text-3); cursor: pointer; transition: all 0.15s; font-weight: 500; }
  .tab:hover { color: var(--text-2); background: var(--surface-2); } .tab.active { color: var(--text); background: var(--surface-2); }
  .empty-state { text-align: center; padding: 48px 20px; color: var(--text-3); } .empty-state p { font-size: 0.875rem; }
  .protection-banner { display: flex; align-items: center; gap: 8px; background: var(--green-dim); border: 1px solid rgba(52,211,153,0.2); border-radius: var(--radius-sm); padding: 10px 16px; margin-bottom: 20px; font-size: 0.8rem; color: var(--green); }
  .delete-btn { background: transparent; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 0.75rem; color: var(--text-3); cursor: pointer; transition: all 0.15s; }
  .delete-btn:hover { border-color: var(--red); color: var(--red); background: var(--red-dim); }
</style></head>
<body>
  <div class="top-bar">
    <a href="/">Mail Tracker</a>
    <span class="sep">/</span>
    <span class="current" id="navRecipient"></span>
  </div>

  <div class="container">
    <div class="header">
      <div class="header-row">
        <div>
          <h1 id="pageTitle"></h1>
          <div class="meta">
            <span id="metaRecipient" style="display:none"></span>
            <span id="metaCreated"></span>
            <button class="copy-id" id="copyBtn"></button>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span id="statusBadge" class="badge"></span>
          <button class="delete-btn" id="deleteBtn">Delete</button>
        </div>
      </div>
    </div>

    <div id="protectionBanner" class="protection-banner" style="display:none">
      Sender protection active — your own opens are automatically filtered
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Opens</div><div class="stat-value green" id="statOpens"></div><div class="stat-sub" id="statViewers"></div></div>
      <div class="stat-card"><div class="stat-label">Filtered</div><div class="stat-value amber" id="statFiltered"></div><div class="stat-sub">bots &amp; self-opens</div></div>
      <div class="stat-card"><div class="stat-label">First Open</div><div class="stat-value blue" style="font-size:1rem" id="statFirst"></div><div class="stat-sub" id="statFirstSub"></div></div>
      <div class="stat-card"><div class="stat-label">Last Open</div><div class="stat-value blue" style="font-size:1rem" id="statLast"></div><div class="stat-sub" id="statLastSub"></div></div>
    </div>

    <div class="two-col">
      <div class="panel"><div class="panel-header"><span class="panel-title">Open Activity</span><span class="panel-hint" id="calRange"></span></div><div class="panel-body"><div class="cal-wrap" id="calWrap"></div><div class="cal-legend" id="calLegend"></div></div></div>
      <div class="panel"><div class="panel-header"><span class="panel-title">Peak Hours</span><span class="panel-hint">local time</span></div><div class="panel-body"><div class="time-grid" id="timeGrid"></div></div></div>
    </div>

    <div class="panel">
      <div class="panel-header"><span class="panel-title">Event Timeline</span><div class="tabs"><button class="tab active" id="tabOpens">Opens</button><button class="tab" id="tabFiltered">Filtered</button></div></div>
      <div class="panel-body"><div id="opensTab" class="timeline"></div><div id="filteredTab" class="timeline" style="display:none"></div></div>
    </div>
  </div>

  <script>
    var DATA = {
      id: ${JSON.stringify(id)},
      recipient: ${JSON.stringify(recipient)},
      subject: ${JSON.stringify(data.subject || '')},
      opens: ${JSON.stringify(data.opens || 0)},
      skipped: ${JSON.stringify(data.skipped || 0)},
      hasSenderIp: ${JSON.stringify(!!data.senderIp)},
      createdAt: ${JSON.stringify(data.createdAt || null)},
      firstOpen: ${JSON.stringify(firstOpen)},
      lastOpen: ${JSON.stringify(lastOpenTime)},
      uniqueIps: ${JSON.stringify(uniqueIps)},
      events: ${JSON.stringify(events)},
      filtered: ${JSON.stringify(filteredEvents)},
      dailyOpens: {}
    };

    function formatTime(iso) { return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric' }); }
    function shortDate(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
    function shortTime(iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
    function relativeTime(iso) { var diff = Date.now() - new Date(iso).getTime(); var mins = Math.floor(diff / 60000); if (mins < 1) return 'just now'; if (mins < 60) return mins + 'm ago'; var hrs = Math.floor(mins / 60); if (hrs < 24) return hrs + 'h ago'; var days = Math.floor(hrs / 24); if (days < 30) return days + 'd ago'; return formatTime(iso); }

    // Header
    document.getElementById('navRecipient').textContent = DATA.recipient;
    document.getElementById('pageTitle').textContent = DATA.subject || DATA.recipient;
    if (DATA.subject) { var metaR = document.getElementById('metaRecipient'); metaR.style.display = ''; metaR.textContent = DATA.recipient; }
    document.getElementById('metaCreated').textContent = 'Created ' + (DATA.createdAt ? new Date(DATA.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown');
    var copyBtn = document.getElementById('copyBtn');
    copyBtn.textContent = DATA.id;
    copyBtn.addEventListener('click', function() { navigator.clipboard.writeText(DATA.id).then(function() { copyBtn.textContent = 'Copied!'; setTimeout(function() { copyBtn.textContent = DATA.id; }, 1500); }); });

    var badge = document.getElementById('statusBadge');
    badge.className = 'badge ' + (DATA.opens > 0 ? 'badge-green' : 'badge-amber');
    badge.textContent = DATA.opens > 0 ? 'Opened' : 'Pending';

    document.getElementById('deleteBtn').addEventListener('click', function() { if (confirm('Delete this tracker?')) fetch('/d/' + DATA.id).then(function() { location.href = '/'; }); });
    if (DATA.hasSenderIp) document.getElementById('protectionBanner').style.display = '';

    // Stats
    document.getElementById('statOpens').textContent = DATA.opens;
    document.getElementById('statViewers').textContent = DATA.uniqueIps + ' unique ' + (DATA.uniqueIps === 1 ? 'viewer' : 'viewers');
    document.getElementById('statFiltered').textContent = DATA.skipped;
    document.getElementById('statFirst').textContent = DATA.firstOpen ? shortDate(DATA.firstOpen) : '\\u2014';
    document.getElementById('statFirstSub').textContent = DATA.firstOpen ? shortTime(DATA.firstOpen) : 'not yet';
    document.getElementById('statLast').textContent = DATA.lastOpen ? shortDate(DATA.lastOpen) : '\\u2014';
    document.getElementById('statLastSub').textContent = DATA.lastOpen ? shortTime(DATA.lastOpen) : 'not yet';

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
    var ls = document.createElement('span'); ls.textContent = 'Less'; legend.appendChild(ls);
    ['', 'l1', 'l2', 'l3', 'l4'].forEach(function(cls) { var b = document.createElement('div'); b.className = 'cal-legend-cell cal-cell' + (cls ? ' ' + cls : ''); legend.appendChild(b); });
    var ms = document.createElement('span'); ms.textContent = 'More'; legend.appendChild(ms);

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
      document.getElementById('tabOpens').className = 'tab' + (tab === 'opens' ? ' active' : '');
      document.getElementById('tabFiltered').className = 'tab' + (tab === 'filtered' ? ' active' : '');
    }

    function buildTimelineItem(e, isFiltered, idx) {
      var item = document.createElement('div'); item.className = 'tl-item'; item.style.animationDelay = (idx * 0.04) + 's';
      var dot = document.createElement('div'); dot.className = 'tl-dot' + (isFiltered ? ' filtered' : '');
      var content = document.createElement('div'); content.className = 'tl-content';
      var timeRow = document.createElement('div'); timeRow.className = 'tl-time'; timeRow.textContent = relativeTime(e.time) + ' ';
      var timeFull = document.createElement('span'); timeFull.className = 'tl-time-full'; timeFull.textContent = '\\u2014 ' + formatTime(e.time); timeRow.appendChild(timeFull);
      var details = document.createElement('div'); details.className = 'tl-details';
      if (isFiltered) { var rs = document.createElement('span'); rs.className = 'tl-reason'; rs.textContent = e.reason === 'sender_ip' ? 'Self-open' : 'Bot / Proxy'; details.appendChild(rs); }
      else { var ct = document.createElement('span'); ct.className = 'tl-tag'; ct.textContent = e.country || '?'; details.appendChild(ct); }
      var ip = document.createElement('span'); ip.className = 'tl-tag'; ip.textContent = e.ip; details.appendChild(ip);
      content.appendChild(timeRow); content.appendChild(details); item.appendChild(dot); item.appendChild(content); return item;
    }

    var opensTab = document.getElementById('opensTab');
    if (DATA.events.length === 0) { var ee = document.createElement('div'); ee.className = 'empty-state'; var ep = document.createElement('p'); ep.textContent = 'No opens recorded yet'; ee.appendChild(ep); opensTab.appendChild(ee); }
    else { DATA.events.slice().reverse().slice(0, 30).forEach(function(e, i) { opensTab.appendChild(buildTimelineItem(e, false, i)); }); }

    var filteredTab = document.getElementById('filteredTab');
    if (DATA.filtered.length === 0) { var ef = document.createElement('div'); ef.className = 'empty-state'; var fp = document.createElement('p'); fp.textContent = 'No filtered events'; ef.appendChild(fp); filteredTab.appendChild(ef); }
    else { DATA.filtered.slice().reverse().slice(0, 20).forEach(function(e, i) { filteredTab.appendChild(buildTimelineItem(e, true, i)); }); }
  </script>
</body></html>`;
}
