import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { renderFilterTabs } from './components.js';

/**
 * Renders the activity feed page showing a chronological list of all events.
 *
 * @param {Array<{type: string, description: string, timeAgo: string}>} events - Event objects
 * @param {number} totalCount - Total number of events across all trackers
 * @param {number} offset - Current pagination offset
 * @param {boolean} oauthConnected - Whether Gmail OAuth is connected
 * @returns {string} Complete HTML page
 */
export function renderActivityPage(events, totalCount, offset, oauthConnected) {
  // -- Filter tabs --
  const filterTabsHtml = renderFilterTabs([
    { key: 'all', label: 'All', count: totalCount },
    { key: 'open', label: 'Opens' },
    { key: 'sequence', label: 'Sequences' },
    { key: 'filtered', label: 'Filtered' },
  ], 'all');

  // -- Event rows --
  const eventRowsHtml = events.map(evt => {
    const dotColor = getDotColor(evt.type);
    const glowStyle = evt.type === 'open'
      ? 'box-shadow:0 0 6px rgba(34,197,94,0.4);'
      : '';

    const dataType = getFilterType(evt.type);

    return `<div class="event-row" data-type="${esc(dataType)}">
      <div class="event-dot" style="background:${dotColor};${glowStyle}"></div>
      <div class="event-text">${evt.description}</div>
      <div class="event-time">${esc(evt.timeAgo)}</div>
    </div>`;
  }).join('');

  // -- Load more link --
  const loadMoreHtml = events.length >= 50
    ? `<div style="text-align:center;padding:16px;">
        <a href="/activity?offset=${offset + 50}" style="color:var(--accent-light);font-size:12px;text-decoration:none;">Load more</a>
      </div>`
    : '';

  // -- Empty state --
  const emptyHtml = events.length === 0
    ? '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No activity yet</div>'
    : '';

  // -- Body --
  const bodyHtml = `
    <div style="padding:0 32px 32px;">
      <div class="list-panel">
        <div class="list-header">
          ${filterTabsHtml}
        </div>
        <div class="list-body">
          ${emptyHtml}
          ${eventRowsHtml}
        </div>
        ${loadMoreHtml}
      </div>
    </div>`;

  // -- Client-side filter scripts --
  const scripts = `
    document.querySelectorAll('.filter-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var filter = tab.getAttribute('data-filter');
        document.querySelectorAll('.event-row').forEach(function(row) {
          if (filter === 'all') {
            row.style.display = '';
          } else {
            row.style.display = row.getAttribute('data-type') === filter ? '' : 'none';
          }
        });
      });
    });
  `;

  return renderLayout({
    title: 'Activity',
    subtitle: totalCount + ' events',
    activePage: 'activity',
    bodyHtml,
    scripts,
    oauthConnected,
  });
}

/**
 * Maps event type to a CSS color variable for the dot.
 */
function getDotColor(type) {
  switch (type) {
  case 'open':
    return 'var(--success)';
  case 'follow_up_sent':
  case 'sequence_completed':
    return 'var(--accent)';
  case 'sequence_stopped':
    return 'var(--warning)';
  case 'filtered':
  case 'tracker_created':
  default:
    return 'var(--text-muted)';
  }
}

/**
 * Maps event type to a filter category for the client-side tabs.
 */
function getFilterType(type) {
  switch (type) {
  case 'open':
    return 'open';
  case 'follow_up_sent':
  case 'sequence_completed':
  case 'sequence_stopped':
    return 'sequence';
  case 'filtered':
    return 'filtered';
  default:
    return 'all';
  }
}
