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
        '<span style="display:inline-block;width:12px;height:2px;background:#3b82f6;vertical-align:middle;opacity:0.5;"></span>',
      );
    }
    parts.push(
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;vertical-align:middle;"></span>',
    );
  }
  return `<div style="display:flex;align-items:center;gap:2px;margin-top:6px;">${parts.join('')}</div>`;
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

  // -- Template list rows --
  const templateRows = templates
    .map((tmpl) => {
      const stepCount = tmpl.steps ? tmpl.steps.length : 0;
      const timeline = renderMiniTimeline(tmpl.steps);

      return `<div class="list-row" style="cursor:default;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${esc(tmpl.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
          ${esc(String(stepCount))} step${stepCount !== 1 ? 's' : ''} &middot; ${esc(tmpl.timezone || 'UTC')}
        </div>
        ${timeline}
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <a class="btn btn-secondary" href="/templates/${esc(tmpl.id)}/edit" style="font-size:11px;padding:4px 10px;">Edit</a>
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="duplicateTemplate('${esc(tmpl.id)}')">Duplicate</button>
        <button class="btn btn-danger" style="font-size:11px;padding:4px 10px;" onclick="deleteTemplate('${esc(tmpl.id)}')">Delete</button>
      </div>
    </div>`;
    })
    .join('');

  const emptyState =
    templates.length === 0
      ? '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No templates yet. Create one to get started.</div>'
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
    <div style="padding:0 32px 32px;">
      ${listPanel}
    </div>`;

  // -- Client-side scripts --
  const scripts = `
    function duplicateTemplate(id) {
      fetch('/templates/' + encodeURIComponent(id), {
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
          window.location.href = '/templates/' + encodeURIComponent(created.id) + '/edit';
        } else {
          location.reload();
        }
      })
      .catch(function(err) {
        alert('Failed to duplicate template: ' + err.message);
      });
    }

    function deleteTemplate(id) {
      if (!confirm('Delete this template? This cannot be undone.')) return;
      fetch('/templates/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function() { location.reload(); })
        .catch(function(err) {
          alert('Failed to delete template: ' + err.message);
        });
    }
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
