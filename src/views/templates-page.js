import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { safeJson as _safeJson } from './components.js';

/**
 * Renders a mini visual timeline showing step sequence as connected circles.
 * Each step is an 8px blue circle, connected by 12px lines.
 */
function renderMiniTimeline(steps) {
  if (!steps || !steps.length) return '';
  const parts = [];
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) {
      parts.push(
        '<span class="tmpl-timeline-connector"></span>',
      );
    }
    parts.push(
      '<span class="tmpl-timeline-dot"></span>',
    );
  }
  return `<div class="tmpl-mini-timeline">${parts.join('')}</div>`;
}

/**
 * Renders the Templates management page.
 *
 * @param {Array} templates - Array of template objects from KV
 * @param {boolean} oauthConnected - Whether Gmail OAuth is connected
 * @returns {string} Complete HTML page
 */
export function renderTemplatesPage(templates, oauthConnected) {
  // -- Header actions --
  const headerActions = `
    <a class="btn btn-primary" href="/templates/new">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      New Template
    </a>`;

  // -- Page-specific styles --
  const pageStyles = `<style>
    /* Template row hover lift */
    .tmpl-row {
      transition: all 0.15s ease;
      cursor: default;
    }
    .tmpl-row:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    /* Action buttons: hidden by default, fade in on hover */
    .tmpl-row .tmpl-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .tmpl-row:hover .tmpl-actions {
      opacity: 1;
    }

    /* Edit button: blue accent */
    .tmpl-btn-edit {
      background: var(--accent-bg);
      color: var(--accent-light);
      font-size: 11px;
      padding: 4px 10px;
      border: none;
      border-radius: var(--radius-btn);
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .tmpl-btn-edit:hover {
      background: rgba(59,130,246,0.2);
    }
    .tmpl-btn-edit:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* Duplicate button: secondary gray */
    .tmpl-btn-dup {
      background: var(--bg-hover);
      color: var(--text-secondary);
      font-size: 11px;
      padding: 4px 10px;
      border: none;
      border-radius: var(--radius-btn);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .tmpl-btn-dup:hover {
      color: var(--text-primary);
    }
    .tmpl-btn-dup:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* Delete button: icon only, red on hover */
    .tmpl-btn-del {
      background: none;
      color: var(--text-muted);
      width: 28px;
      height: 28px;
      border: none;
      border-radius: var(--radius-btn);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      padding: 0;
    }
    .tmpl-btn-del:hover {
      background: rgba(239,68,68,0.12);
      color: var(--error);
    }
    .tmpl-btn-del:focus-visible {
      outline: 2px solid var(--error);
      outline-offset: 2px;
    }

    /* Mini timeline dots with glow */
    .tmpl-mini-timeline {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 6px;
    }
    .tmpl-timeline-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      vertical-align: middle;
      box-shadow: 0 0 6px rgba(59,130,246,0.35);
      transition: box-shadow 0.15s ease;
    }
    .tmpl-row:hover .tmpl-timeline-dot {
      box-shadow: 0 0 10px rgba(59,130,246,0.5);
    }
    .tmpl-timeline-connector {
      display: inline-block;
      width: 12px;
      height: 2px;
      background: var(--accent);
      vertical-align: middle;
      opacity: 0.5;
    }

    /* Empty state */
    .tmpl-empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 60px 20px;
      gap: 4px;
    }

    /* Focus visible on generic buttons */
    .btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  </style>`;

  // -- Template list rows --
  const templateRows = templates
    .map((tmpl) => {
      const stepCount = tmpl.steps ? tmpl.steps.length : 0;
      const timeline = renderMiniTimeline(tmpl.steps);

      return `<div class="list-row tmpl-row">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${esc(tmpl.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
          ${esc(String(stepCount))} step${stepCount !== 1 ? 's' : ''} &middot; ${esc(tmpl.timezone || 'UTC')}
        </div>
        ${timeline}
      </div>
      <div class="tmpl-actions">
        <a class="tmpl-btn-edit" href="/templates/${esc(tmpl.id)}/edit">Edit</a>
        <button class="tmpl-btn-dup" data-dup="${esc(tmpl.id)}">Duplicate</button>
        <button class="tmpl-btn-del" data-del="${esc(tmpl.id)}" title="Delete template">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </div>
    </div>`;
    })
    .join('');

  const emptyState =
    templates.length === 0
      ? `<div class="tmpl-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;">
            <rect x="2" y="1" width="14" height="16" rx="2" transform="translate(3 3)"/>
            <line x1="8.5" y1="8.5" x2="15.5" y2="8.5"/>
            <line x1="8.5" y1="12" x2="15.5" y2="12"/>
            <line x1="8.5" y1="15.5" x2="12.5" y2="15.5"/>
          </svg>
          <p style="font-size:14px;font-weight:600;color:var(--text-secondary);margin-top:4px;">Create your first sequence template</p>
          <p style="font-size:12px;color:var(--text-muted);">Templates let you define reusable follow-up sequences with timed steps.</p>
        </div>`
      : '';

  // -- List panel --
  const listPanel = `<div class="list-panel">
    <div class="list-header">
      <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">All Templates</span>
      <span class="badge badge-gray">${esc(String(templates.length))}</span>
    </div>
    <div class="list-body" id="templates-list">
      ${templateRows}
      ${emptyState}
    </div>
  </div>`;

  // -- Body --
  const bodyHtml = `
    ${pageStyles}
    <div style="padding:0 32px 32px;">
      ${listPanel}
    </div>`;

  // -- Client-side scripts --
  const scripts = `
    /* Duplicate template */
    document.querySelectorAll('[data-dup]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-dup');
        fetch('/templates/' + id, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        })
        .then(function(res) { return res.json(); })
        .then(function(tmpl) {
          var payload = {
            name: (tmpl.name || 'Template') + ' (copy)',
            timezone: tmpl.timezone || 'UTC',
            steps: tmpl.steps || []
          };
          return fetch('/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        })
        .then(function(res) { return res.json(); })
        .then(function(created) {
          if (created && created.id) {
            window.location.href = '/templates/' + created.id + '/edit';
          } else {
            location.reload();
          }
        })
        .catch(function(err) {
          alert('Failed to duplicate template: ' + err.message);
        });
      });
    });

    /* Delete template */
    document.querySelectorAll('[data-del]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-del');
        if (!confirm('Delete this template? This cannot be undone.')) return;
        fetch('/templates/' + id, { method: 'DELETE' })
          .then(function(res) {
            if (!res.ok) throw new Error('Server returned ' + res.status);
            location.reload();
          })
          .catch(function(err) {
            alert('Failed to delete template: ' + err.message);
          });
      });
    });
  `;

  return renderLayout({
    title: 'Templates',
    activePage: 'templates',
    headerActions,
    bodyHtml,
    scripts,
    oauthConnected,
  });
}
