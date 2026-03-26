import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { renderStatCard, safeJson } from './components.js';

/**
 * Renders the analytics page with time-series charts and template comparison.
 *
 * @param {Array} analyticsData - Array of analytics objects (one per template)
 * @param {Array} templates - Array of template objects with id and name
 * @param {boolean} oauthConnected - Whether Gmail OAuth is connected
 * @param {Object} dailyDataMap - Map of templateId to array of daily data objects
 * @returns {string} Complete HTML page
 */
export function renderAnalyticsPage(analyticsData, templates, oauthConnected, dailyDataMap) {
  const templateNames = {};
  for (let i = 0; i < templates.length; i++) {
    templateNames[templates[i].id] = templates[i].name;
  }

  dailyDataMap = dailyDataMap || {};

  // -- Page-specific styles --
  const pageStyles = `<style>
    /* Stat card hover lift */
    .analytics-stats .stat-card {
      transition: all 0.15s ease;
      cursor: default;
    }
    .analytics-stats .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    }

    /* Comparison select dropdowns */
    .analytics-select {
      width: 100%;
      padding: 8px 12px;
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: var(--radius-btn);
      color: var(--text-primary);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      cursor: pointer;
      transition: border-color 0.15s ease;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 28px;
    }
    .analytics-select:hover {
      border-color: rgba(148,163,184,0.3);
    }
    .analytics-select:focus {
      border-color: var(--accent);
    }

    /* Stats table hover and alternating rows */
    .analytics-table {
      width: 100%;
      border-collapse: collapse;
    }
    .analytics-table thead tr {
      border-bottom: 1px solid var(--border);
    }
    .analytics-table th {
      padding: 8px 12px;
      text-align: center;
      color: var(--text-secondary);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .analytics-table th:first-child {
      text-align: left;
    }
    .analytics-table tbody tr {
      border-bottom: 1px solid var(--border-subtle);
      transition: background 0.15s ease;
    }
    .analytics-table tbody tr:nth-child(even) {
      background: rgba(255,255,255,0.015);
    }
    .analytics-table tbody tr:hover {
      background: var(--bg-hover);
    }
    .analytics-table td {
      padding: 8px 12px;
      text-align: center;
      color: var(--text-primary);
      font-size: 13px;
    }
    .analytics-table td:first-child {
      text-align: left;
    }

    /* Funnel bars hover state */
    .funnel-bar-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 4px 0;
      position: relative;
    }
    .funnel-bar {
      background: linear-gradient(90deg,rgba(59,130,246,0.25),rgba(96,165,250,0.15));
      border-radius: 4px;
      height: 24px;
      display: flex;
      align-items: center;
      padding: 0 8px;
      transition: all 0.15s ease;
      position: relative;
    }
    .funnel-bar:hover {
      background: linear-gradient(90deg,rgba(59,130,246,0.35),rgba(96,165,250,0.25));
    }
    .funnel-bar .funnel-tooltip {
      display: none;
      position: absolute;
      right: -6px;
      top: -28px;
      background: var(--bg-elevated);
      color: var(--text-primary);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      white-space: nowrap;
      border: 1px solid var(--border);
      pointer-events: none;
      z-index: 10;
    }
    .funnel-bar:hover .funnel-tooltip {
      display: block;
    }

    /* Empty state */
    .analytics-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 80px 20px;
      gap: 4px;
    }

    /* Focus visible */
    .analytics-select:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  </style>`;

  let bodyHtml;

  if (analyticsData.length === 0) {
    bodyHtml = `
      ${pageStyles}
      <div style="padding:0 32px 32px;">
        <div class="analytics-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;">
            <rect x="1" y="10" width="3" height="11" rx="0.5"/>
            <rect x="5.5" y="7" width="3" height="14" rx="0.5"/>
            <rect x="10" y="4" width="3" height="17" rx="0.5"/>
            <rect x="14.5" y="1" width="3" height="20" rx="0.5"/>
          </svg>
          <p style="font-size:14px;font-weight:600;color:var(--text-secondary);margin-top:4px;">No analytics data yet</p>
          <p style="font-size:12px;color:var(--text-muted);">Analytics will appear once your sequences start sending and tracking opens.</p>
        </div>
      </div>`;
  } else {
    // Template comparison section (only if 2+ templates)
    let comparisonHtml = '';
    if (analyticsData.length >= 2) {
      const options = analyticsData.map((a) => {
        const name = templateNames[a.templateId] || a.templateId;
        return `<option value="${esc(a.templateId)}">${esc(name)}</option>`;
      }).join('');

      comparisonHtml = `
        <div class="panel" style="margin-bottom:16px;">
          <h3 style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:14px;">Template Comparison</h3>
          <div style="display:flex;gap:16px;margin-bottom:16px;">
            <div style="flex:1;">
              <label style="color:var(--text-secondary);font-size:12px;display:block;margin-bottom:4px;">Left template</label>
              <select id="compare-select-left" class="analytics-select">
                ${options}
              </select>
            </div>
            <div style="flex:1;">
              <label style="color:var(--text-secondary);font-size:12px;display:block;margin-bottom:4px;">Right template</label>
              <select id="compare-select-right" class="analytics-select">
                ${options}
              </select>
            </div>
          </div>
          <div class="two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div id="compare-left" style="min-height:100px;"></div>
            <div id="compare-right" style="min-height:100px;"></div>
          </div>
        </div>`;
    }

    // Per-template cards with funnel + time-series charts
    const cards = analyticsData.map((analytics, cardIndex) => {
      const name = templateNames[analytics.templateId] || analytics.templateId;
      const maxSent = Math.max(
        ...analytics.steps.map((s) => s.sent),
        1,
      );

      // Funnel bar chart with hover tooltips
      const funnelHtml = analytics.steps
        .map((s, i) => {
          const widthPct = Math.max((s.sent / maxSent) * 100, 5);
          const openRate = (s.openRate * 100).toFixed(0);
          return `<div class="funnel-bar-row">
          <span style="color:var(--text-secondary);font-size:12px;width:50px;flex-shrink:0;">Step ${i + 1}</span>
          <div class="funnel-bar" style="width:${widthPct}%;">
            <span style="color:var(--accent-light);font-size:12px;">${esc(String(s.sent))} sent</span>
            <div class="funnel-tooltip">${esc(String(s.sent))} sent, ${esc(String(s.opened))} opened (${esc(openRate)}%)</div>
          </div>
        </div>`;
        })
        .join('');

      // Stats table rows
      const tableRows = analytics.steps
        .map((s, i) => {
          const openRate = (s.openRate * 100).toFixed(0);
          const replyRate = (s.replyRate * 100).toFixed(0);
          return `<tr>
          <td>Step ${i + 1}</td>
          <td>${esc(String(s.sent))}</td>
          <td>${esc(String(s.opened))}</td>
          <td>${esc(openRate)}%</td>
          <td>${esc(String(s.replied))}</td>
          <td>${esc(replyRate)}%</td>
        </tr>`;
        })
        .join('');

      const chartContainerId = 'chart-' + cardIndex;

      return `<div class="panel" style="margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:14px;">${esc(name)}</h3>
        <div class="stat-grid analytics-stats" style="margin-bottom:16px;">
          ${renderStatCard({ label: 'Total Sequences', value: String(analytics.totalSequences) })}
          ${renderStatCard({ label: 'Completed', value: String(analytics.completedSequences) })}
          ${renderStatCard({ label: 'Stopped', value: String(analytics.stoppedSequences) })}
        </div>
        <div style="margin-bottom:16px;">${funnelHtml}</div>
        <div class="panel" style="margin-bottom:16px;padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);border-radius:8px;">
          <h4 style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:12px;">Last 30 Days</h4>
          <div id="${chartContainerId}"></div>
        </div>
        <table class="analytics-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Sent</th>
              <th>Opened</th>
              <th>Open Rate</th>
              <th>Replied</th>
              <th>Reply Rate</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
    });

    bodyHtml = `${pageStyles}<div style="padding:0 32px 32px;">${comparisonHtml}${cards.join('')}</div>`;
  }

  const scripts = buildClientScripts(analyticsData, templateNames, dailyDataMap);

  return renderLayout({
    title: 'Analytics',
    subtitle: 'Sequence performance',
    activePage: 'analytics',
    bodyHtml,
    oauthConnected,
    scripts,
  });
}

/**
 * Builds client-side JavaScript for time-series charts and template comparison.
 */
function buildClientScripts(analyticsData, templateNames, dailyDataMap) {
  return `
    var __analyticsData = ${safeJson(analyticsData)};
    var __templateNames = ${safeJson(templateNames)};
    var __dailyDataMap = ${safeJson(dailyDataMap)};

    function generateDayStrings() {
      var days = [];
      var now = new Date();
      for (var i = 29; i >= 0; i--) {
        var d = new Date(now);
        d.setDate(d.getDate() - i);
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var dd = String(d.getDate()).padStart(2, '0');
        days.push(y + '-' + m + '-' + dd);
      }
      return days;
    }

    function renderChart(containerId, dailyData) {
      var container = document.getElementById(containerId);
      if (!container) return;
      while (container.firstChild) container.removeChild(container.firstChild);

      var days = generateDayStrings();
      var sentArr = [];
      var openedArr = [];
      var repliedArr = [];
      var dayMap = {};
      if (dailyData && Array.isArray(dailyData)) {
        for (var i = 0; i < dailyData.length; i++) {
          dayMap[dailyData[i].date] = dailyData[i];
        }
      }
      for (var i = 0; i < days.length; i++) {
        var entry = dayMap[days[i]];
        sentArr.push(entry ? (entry.sent || 0) : 0);
        openedArr.push(entry ? (entry.opened || 0) : 0);
        repliedArr.push(entry ? (entry.replied || 0) : 0);
      }

      var allVals = sentArr.concat(openedArr).concat(repliedArr);
      var maxVal = Math.max.apply(null, allVals.concat([1]));

      var svgNS = 'http://www.w3.org/2000/svg';
      var width = container.offsetWidth || 400;
      var height = 160;
      var padX = 30;
      var padY = 20;
      var chartW = width - padX * 2;
      var chartH = height - padY * 2;

      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.style.display = 'block';

      /* Gradient definitions for area fills */
      var defs = document.createElementNS(svgNS, 'defs');
      var seriesColors = ['#3b82f6', '#22c55e', '#a855f7'];
      var seriesIds = ['sent', 'opened', 'replied'];
      for (var gi = 0; gi < seriesColors.length; gi++) {
        var grad = document.createElementNS(svgNS, 'linearGradient');
        grad.setAttribute('id', 'area-grad-' + seriesIds[gi] + '-' + containerId);
        grad.setAttribute('x1', '0');
        grad.setAttribute('y1', '0');
        grad.setAttribute('x2', '0');
        grad.setAttribute('y2', '1');
        var stop1 = document.createElementNS(svgNS, 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', seriesColors[gi]);
        stop1.setAttribute('stop-opacity', '0.15');
        var stop2 = document.createElementNS(svgNS, 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', seriesColors[gi]);
        stop2.setAttribute('stop-opacity', '0.02');
        grad.appendChild(stop1);
        grad.appendChild(stop2);
        defs.appendChild(grad);
      }
      svg.appendChild(defs);

      // Grid lines (4 horizontal)
      for (var g = 0; g < 4; g++) {
        var gy = padY + (chartH / 4) * g;
        var line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String(padX));
        line.setAttribute('y1', String(gy));
        line.setAttribute('x2', String(width - padX));
        line.setAttribute('y2', String(gy));
        line.setAttribute('stroke', 'rgba(255,255,255,0.06)');
        line.setAttribute('stroke-width', '1');
        svg.appendChild(line);
      }

      function buildPoints(arr) {
        var pts = [];
        for (var j = 0; j < arr.length; j++) {
          var x = padX + (j / (arr.length - 1 || 1)) * chartW;
          var y = padY + chartH - (arr[j] / maxVal) * chartH;
          pts.push(x.toFixed(1) + ',' + y.toFixed(1));
        }
        return pts.join(' ');
      }

      function buildAreaPoints(arr) {
        var pts = buildPoints(arr);
        var firstX = padX;
        var lastX = padX + chartW;
        var baseline = padY + chartH;
        return pts + ' ' + lastX.toFixed(1) + ',' + baseline.toFixed(1) + ' ' + firstX.toFixed(1) + ',' + baseline.toFixed(1);
      }

      var series = [
        { data: sentArr, color: '#3b82f6', label: 'Sent', id: 'sent' },
        { data: openedArr, color: '#22c55e', label: 'Opened', id: 'opened' },
        { data: repliedArr, color: '#a855f7', label: 'Replied', id: 'replied' }
      ];

      for (var s = 0; s < series.length; s++) {
        /* Area fill under the line */
        var area = document.createElementNS(svgNS, 'polygon');
        area.setAttribute('points', buildAreaPoints(series[s].data));
        area.setAttribute('fill', 'url(#area-grad-' + series[s].id + '-' + containerId + ')');
        svg.appendChild(area);

        /* Line */
        var polyline = document.createElementNS(svgNS, 'polyline');
        polyline.setAttribute('points', buildPoints(series[s].data));
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', series[s].color);
        polyline.setAttribute('stroke-width', '2');
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('stroke-linecap', 'round');
        svg.appendChild(polyline);
      }

      container.appendChild(svg);

      // Legend
      var legend = document.createElement('div');
      legend.style.display = 'flex';
      legend.style.gap = '16px';
      legend.style.marginTop = '8px';
      for (var l = 0; l < series.length; l++) {
        var item = document.createElement('span');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '6px';
        item.style.fontSize = '12px';
        item.style.color = 'var(--text-secondary)';
        var dot = document.createElement('span');
        dot.style.width = '8px';
        dot.style.height = '8px';
        dot.style.borderRadius = '50%';
        dot.style.background = series[l].color;
        dot.style.display = 'inline-block';
        item.appendChild(dot);
        item.appendChild(document.createTextNode(series[l].label));
        legend.appendChild(item);
      }
      container.appendChild(legend);
    }

    function renderComparisonFunnel(container, analytics) {
      while (container.firstChild) container.removeChild(container.firstChild);
      var maxSent = 1;
      for (var i = 0; i < analytics.steps.length; i++) {
        if (analytics.steps[i].sent > maxSent) maxSent = analytics.steps[i].sent;
      }

      var title = document.createElement('div');
      title.style.fontSize = '13px';
      title.style.fontWeight = '600';
      title.style.color = 'var(--text-primary)';
      title.style.marginBottom = '8px';
      var tName = __templateNames[analytics.templateId] || analytics.templateId;
      title.textContent = tName;
      container.appendChild(title);

      for (var i = 0; i < analytics.steps.length; i++) {
        var s = analytics.steps[i];
        var widthPct = Math.max((s.sent / maxSent) * 100, 5);
        var row = document.createElement('div');
        row.className = 'funnel-bar-row';
        var label = document.createElement('span');
        label.style.color = 'var(--text-secondary)';
        label.style.fontSize = '12px';
        label.style.width = '50px';
        label.style.flexShrink = '0';
        label.textContent = 'Step ' + (i + 1);
        var bar = document.createElement('div');
        bar.className = 'funnel-bar';
        bar.style.width = widthPct + '%';
        var val = document.createElement('span');
        val.style.color = 'var(--accent-light)';
        val.style.fontSize = '12px';
        val.textContent = s.sent + ' sent';
        bar.appendChild(val);
        var tip = document.createElement('div');
        tip.className = 'funnel-tooltip';
        var openRate = (s.openRate * 100).toFixed(0);
        tip.textContent = s.sent + ' sent, ' + s.opened + ' opened (' + openRate + '%)';
        bar.appendChild(tip);
        row.appendChild(label);
        row.appendChild(bar);
        container.appendChild(row);
      }

      var chartDiv = document.createElement('div');
      chartDiv.style.marginTop = '12px';
      var chartId = 'compare-chart-' + Math.random().toString(36).slice(2, 8);
      chartDiv.id = chartId;
      container.appendChild(chartDiv);

      var daily = __dailyDataMap[analytics.templateId] || [];
      setTimeout(function() { renderChart(chartId, daily); }, 0);
    }

    function updateComparison(side) {
      var selectId = side === 'left' ? 'compare-select-left' : 'compare-select-right';
      var panelId = side === 'left' ? 'compare-left' : 'compare-right';
      var sel = document.getElementById(selectId);
      var panel = document.getElementById(panelId);
      if (!sel || !panel) return;
      var tid = sel.value;
      var analytics = null;
      for (var i = 0; i < __analyticsData.length; i++) {
        if (__analyticsData[i].templateId === tid) { analytics = __analyticsData[i]; break; }
      }
      if (!analytics) return;
      renderComparisonFunnel(panel, analytics);
    }

    // Initialize on load
    (function() {
      // Render per-template time-series charts
      for (var i = 0; i < __analyticsData.length; i++) {
        var tid = __analyticsData[i].templateId;
        var daily = __dailyDataMap[tid] || [];
        renderChart('chart-' + i, daily);
      }

      // Initialize comparison dropdowns
      var leftSel = document.getElementById('compare-select-left');
      var rightSel = document.getElementById('compare-select-right');
      if (leftSel && rightSel && __analyticsData.length >= 2) {
        rightSel.selectedIndex = 1;
        leftSel.addEventListener('change', function() { updateComparison('left'); });
        rightSel.addEventListener('change', function() { updateComparison('right'); });
        updateComparison('left');
        updateComparison('right');
      }
    })();
  `;
}
