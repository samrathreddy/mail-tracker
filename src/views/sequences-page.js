import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import {
  renderFilterTabs,
  renderStepProgress,
  renderBadge,
  safeJson,
} from './components.js';

/**
 * Renders the sequences list page using the shared design system.
 *
 * @param {Array} sequences - Array of sequence objects
 * @param {boolean} oauthConnected - Whether Gmail OAuth is connected
 * @returns {string} Complete HTML page
 */
export function renderSequencesPage(sequences, oauthConnected) {
  // -- Compute status counts --
  const counts = { all: sequences.length, active: 0, paused: 0, stopped: 0, completed: 0 };
  for (const seq of sequences) {
    if (counts[seq.status] !== undefined) {
      counts[seq.status]++;
    }
  }

  // -- Filter tabs --
  const filterTabsHtml = renderFilterTabs(
    [
      { key: 'all', label: 'All', count: counts.all },
      { key: 'active', label: 'Active', count: counts.active },
      { key: 'paused', label: 'Paused', count: counts.paused },
      { key: 'stopped', label: 'Stopped', count: counts.stopped },
      { key: 'completed', label: 'Completed', count: counts.completed },
    ],
    'all',
  );

  // -- Status color mapping --
  const statusDotColor = {
    active: 'var(--success)',
    completed: 'var(--accent)',
    stopped: 'var(--warning)',
    paused: '#f97316',
  };
  const statusBadgeVariant = {
    active: 'green',
    completed: 'blue',
    stopped: 'yellow',
    paused: 'orange',
  };

  // -- Build sequence rows --
  const rowsHtml = sequences
    .map((seq) => {
      const dotColor = statusDotColor[seq.status] || 'var(--text-muted)';
      const badgeVariant = statusBadgeVariant[seq.status] || 'gray';
      const templateLabel = seq.templateId ? esc(seq.templateId) : 'One-off';

      // Build step progress data
      const stepData = seq.steps.map((step, i) => {
        if (i < seq.currentStep) {
          const status = step.status === 'skipped' ? 'skipped' : step.status === 'failed' ? 'failed' : 'sent';
          return { status };
        }
        if (i === seq.currentStep) {
          return { status: 'pending' };
        }
        return { status: 'pending' };
      });
      const stepProgressHtml = renderStepProgress(stepData);

      // Next send time for active sequences
      let nextSendHtml = '';
      if (seq.status === 'active') {
        const nextStep = seq.steps[seq.currentStep];
        if (nextStep && nextStep.scheduledAt) {
          nextSendHtml = `<span style="font-size:11px;color:var(--text-muted);">Next: ${esc(new Date(nextStep.scheduledAt).toLocaleString())}</span>`;
        }
      }

      // Action buttons for active sequences only
      let actionsHtml = '';
      if (seq.status === 'active') {
        actionsHtml = `
          <button class="btn btn-danger btn-sm" data-cancel="${esc(seq.id)}" style="padding:3px 10px;font-size:11px;">Cancel</button>
          <button class="btn btn-primary btn-sm" data-skip="${esc(seq.id)}" style="padding:3px 10px;font-size:11px;">Skip</button>`;
      }

      return `<div class="list-row" data-status="${esc(seq.status)}">
        <div class="row-dot" style="background:${dotColor};box-shadow:0 0 6px ${dotColor}40;"></div>
        <div style="flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <span style="font-weight:600;font-size:13px;">${esc(seq.recipient)}</span>
        </div>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-muted);">
          ${templateLabel}
        </div>
        <div style="flex:1;min-width:0;">
          ${stepProgressHtml}
        </div>
        <div style="flex:1;min-width:0;text-align:center;">
          ${nextSendHtml}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
          ${renderBadge(seq.status, badgeVariant)}
          ${actionsHtml}
        </div>
      </div>`;
    })
    .join('');

  // -- Empty state --
  const emptyState =
    sequences.length === 0
      ? '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">No sequences yet. Create one from Gmail or the extension.</div>'
      : '';

  // -- List panel --
  const listPanel = `<div class="list-panel">
    <div class="list-header">
      ${filterTabsHtml}
    </div>
    <div class="list-cols">
      <span style="width:8px"></span>
      <span style="flex:2">Recipient</span>
      <span style="flex:1">Template</span>
      <span style="flex:1">Progress</span>
      <span style="flex:1;text-align:center">Next Send</span>
      <span style="flex-shrink:0;width:160px;text-align:right">Status</span>
    </div>
    <div class="list-body" id="seqList">
      ${rowsHtml}
      ${emptyState}
    </div>
  </div>`;

  const bodyHtml = `
    <div style="padding:0 32px 32px;">
      <div style="margin-top:16px;">${listPanel}</div>
    </div>`;

  // -- Client-side scripts --
  const scripts = `
    var SEQUENCES = ${safeJson(sequences)};

    /* Filter tab switching */
    document.querySelectorAll('.filter-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var filterKey = tab.getAttribute('data-filter');
        var rows = document.querySelectorAll('.list-row');
        rows.forEach(function(row) {
          if (filterKey === 'all' || row.getAttribute('data-status') === filterKey) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      });
    });

    /* Cancel sequence */
    document.querySelectorAll('[data-cancel]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var seqId = btn.getAttribute('data-cancel');
        if (confirm('Cancel this sequence?')) {
          fetch('/sequences/' + encodeURIComponent(seqId), { method: 'DELETE' })
            .then(function() { location.reload(); });
        }
      });
    });

    /* Skip step */
    document.querySelectorAll('[data-skip]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var seqId = btn.getAttribute('data-skip');
        if (confirm('Skip the current step?')) {
          fetch('/sequences/' + encodeURIComponent(seqId) + '/skip', { method: 'POST' })
            .then(function() { location.reload(); });
        }
      });
    });
  `;

  const subtitle =
    counts.all + ' sequence' + (counts.all !== 1 ? 's' : '') + ' total';

  return renderLayout({
    title: 'Sequences',
    subtitle,
    activePage: 'sequences',
    headerActions: '',
    bodyHtml,
    scripts,
    oauthConnected,
  });
}
