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
  const statusBorderColor = {
    active: 'var(--success)',
    completed: 'var(--accent)',
    stopped: 'var(--warning)',
    paused: '#f97316',
  };

  // -- Build sequence rows --
  const rowsHtml = sequences
    .map((seq) => {
      const dotColor = statusDotColor[seq.status] || 'var(--text-muted)';
      const badgeVariant = statusBadgeVariant[seq.status] || 'gray';
      const templateLabel = seq.templateId ? esc(seq.templateId) : 'One-off';
      const borderColor = statusBorderColor[seq.status] || 'var(--text-muted)';

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
          nextSendHtml = `<span class="seq-next-send">${esc(new Date(nextStep.scheduledAt).toLocaleString())}</span>`;
        }
      }

      // Action buttons for active sequences only
      let actionsHtml = '';
      if (seq.status === 'active') {
        actionsHtml = `
          <button class="btn seq-btn-cancel" data-cancel="${esc(seq.id)}">Cancel</button>
          <button class="btn seq-btn-skip" data-skip="${esc(seq.id)}">Skip</button>`;
      }

      return `<div class="list-row seq-row" data-status="${esc(seq.status)}" data-border-color="${borderColor}">
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
      ? `<div class="seq-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;">
            <circle cx="3" cy="4" r="1.5"/>
            <line x1="7" y1="4" x2="20" y2="4"/>
            <circle cx="3" cy="12" r="1.5"/>
            <line x1="7" y1="12" x2="20" y2="12"/>
            <circle cx="3" cy="20" r="1.5"/>
            <line x1="7" y1="20" x2="20" y2="20"/>
          </svg>
          <p style="font-size:14px;font-weight:600;color:var(--text-secondary);margin-top:4px;">No sequences yet</p>
          <p style="font-size:12px;color:var(--text-muted);">Create one from Gmail or the extension to start tracking follow-ups.</p>
        </div>`
      : '';

  // -- Page-specific styles --
  const pageStyles = `<style>
    /* Sequence row hover lift */
    .seq-row {
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
    }
    .seq-row:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      border-left-color: var(--_row-border, var(--text-muted));
    }

    /* Pending step dot pulse */
    .step-dot.pending {
      animation: stepPulse 2s ease-in-out infinite;
    }
    @keyframes stepPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(107,124,158,0.3); }
      50% { box-shadow: 0 0 8px 2px rgba(107,124,158,0.25); }
    }

    /* Status badges consistent sizing */
    .seq-row .badge {
      min-width: 68px;
      text-align: center;
      padding: 3px 10px;
    }

    /* Cancel/Skip buttons */
    .seq-btn-cancel,
    .seq-btn-skip {
      padding: 3px 10px;
      font-size: 11px;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .seq-btn-cancel {
      background: rgba(239,68,68,0.08);
      color: var(--text-secondary);
    }
    .seq-btn-cancel:hover {
      background: rgba(239,68,68,0.2);
      color: var(--error);
    }
    .seq-btn-skip {
      background: var(--accent-bg);
      color: var(--text-secondary);
    }
    .seq-btn-skip:hover {
      background: rgba(59,130,246,0.2);
      color: var(--accent-light);
    }

    /* Next send time styling */
    .seq-next-send {
      font-size: 11px;
      color: var(--accent-light);
      background: var(--accent-bg);
      padding: 2px 8px;
      border-radius: var(--radius-badge);
      font-weight: 500;
      white-space: nowrap;
    }

    /* Filter tabs smooth transition */
    .filter-tab {
      transition: all 0.2s ease;
      position: relative;
    }
    .filter-tab.active {
      box-shadow: 0 0 0 1px rgba(59,130,246,0.2);
    }

    /* Empty state */
    .seq-empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 60px 20px;
      gap: 4px;
    }

    /* Focus visible states */
    .filter-tab:focus-visible,
    .btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  </style>`;

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
    ${pageStyles}
    <div style="padding:0 32px 32px;">
      <div style="margin-top:16px;">${listPanel}</div>
    </div>`;

  // -- Client-side scripts --
  const scripts = `
    var SEQUENCES = ${safeJson(sequences)};

    /* Apply border color custom property from data attribute */
    document.querySelectorAll('.seq-row').forEach(function(row) {
      var borderColor = row.getAttribute('data-border-color');
      if (borderColor) {
        row.style.setProperty('--_row-border', borderColor);
      }
    });

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
          fetch('/sequences/' + seqId, { method: 'DELETE' })
            .then(function(res) {
              if (!res.ok) throw new Error('Request failed');
              location.reload();
            })
            .catch(function(err) {
              alert('Error: ' + err.message);
            });
        }
      });
    });

    /* Skip step */
    document.querySelectorAll('[data-skip]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var seqId = btn.getAttribute('data-skip');
        if (confirm('Skip the current step?')) {
          fetch('/sequences/' + seqId + '/skip', { method: 'POST' })
            .then(function(res) {
              if (!res.ok) throw new Error('Request failed');
              location.reload();
            })
            .catch(function(err) {
              alert('Error: ' + err.message);
            });
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
