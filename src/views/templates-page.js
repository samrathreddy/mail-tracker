import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { safeJson as _safeJson } from './components.js';

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
    <button class="btn btn-primary" onclick="toggleForm()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      New Template
    </button>`;

  // -- Template list rows --
  const templateRows = templates.map((tmpl) => {
    const stepCount = tmpl.steps.length;
    const stepSummary = tmpl.steps
      .map((s) => 'Day ' + esc(String(s.delayDays)))
      .join(' -> ');

    return `<div class="list-row" style="cursor:default;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${esc(tmpl.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
          ${esc(String(stepCount))} step${stepCount !== 1 ? 's' : ''} &middot; ${esc(tmpl.timezone)}
        </div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
          ${stepSummary}
        </div>
      </div>
      <button class="btn btn-danger" style="font-size:11px;padding:4px 10px;" onclick="deleteTmpl('${esc(tmpl.id)}')">Delete</button>
    </div>`;
  }).join('');

  const emptyState = templates.length === 0
    ? '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No templates yet. Create one above.</div>'
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

  // -- Create form (hidden by default) --
  const createForm = `<div class="panel" id="create-form" style="display:none;margin-bottom:16px;">
    <div class="panel-title">New Template</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Name</label>
        <input class="input" id="tmpl-name" placeholder="e.g. Sales Follow-up" style="width:100%;">
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Timezone</label>
        <input class="input" id="tmpl-tz" placeholder="America/New_York" style="width:100%;">
      </div>
      <div id="steps-container"></div>
      <div>
        <button class="btn btn-secondary" onclick="addStep()">+ Add Step</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="toggleForm()">Cancel</button>
        <button class="btn btn-success" onclick="saveTemplate()">Save Template</button>
      </div>
    </div>
  </div>`;

  // -- Body --
  const bodyHtml = `
    <div style="padding:0 32px 32px;">
      ${createForm}
      ${listPanel}
    </div>`;

  // -- Client-side scripts --
  const scripts = `
    var stepCount = 0;

    function toggleForm() {
      var form = document.getElementById('create-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (form.style.display === 'block' && stepCount === 0) addStep();
    }

    function addStep() {
      stepCount++;
      var container = document.getElementById('steps-container');

      var card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-hover);border:1px solid var(--border);border-radius:var(--radius-row);padding:12px;margin-bottom:8px;';

      var title = document.createElement('div');
      title.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px;';
      title.textContent = 'Step ' + stepCount;
      card.appendChild(title);

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;margin-bottom:10px;';

      var delayWrap = document.createElement('div');
      delayWrap.style.flex = '1';
      var delayLabel = document.createElement('label');
      delayLabel.style.cssText = 'display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;';
      delayLabel.textContent = 'Delay (days)';
      var delayInput = document.createElement('input');
      delayInput.type = 'number';
      delayInput.className = 'input step-delay';
      delayInput.min = '1';
      delayInput.max = '90';
      delayInput.value = stepCount === 1 ? '2' : String(stepCount * 3);
      delayInput.style.width = '100%';
      delayWrap.appendChild(delayLabel);
      delayWrap.appendChild(delayInput);

      var subjectWrap = document.createElement('div');
      subjectWrap.style.flex = '3';
      var subjectLabel = document.createElement('label');
      subjectLabel.style.cssText = 'display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;';
      subjectLabel.textContent = 'Subject';
      var subjectInput = document.createElement('input');
      subjectInput.className = 'input step-subject';
      subjectInput.placeholder = 'Re: {{subject}}';
      subjectInput.style.width = '100%';
      subjectWrap.appendChild(subjectLabel);
      subjectWrap.appendChild(subjectInput);

      row.appendChild(delayWrap);
      row.appendChild(subjectWrap);
      card.appendChild(row);

      var bodyLabel = document.createElement('label');
      bodyLabel.style.cssText = 'display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;';
      bodyLabel.textContent = 'Body (HTML)';
      var bodyInput = document.createElement('textarea');
      bodyInput.className = 'input step-body';
      bodyInput.placeholder = '<p>Hi {{firstName}},</p>';
      bodyInput.style.width = '100%';
      card.appendChild(bodyLabel);
      card.appendChild(bodyInput);

      var stopDiv = document.createElement('div');
      stopDiv.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:12px;';

      var stopLabel = document.createElement('span');
      stopLabel.style.cssText = 'font-size:11px;color:var(--text-muted);';
      stopLabel.textContent = 'Stop on:';
      stopDiv.appendChild(stopLabel);

      var openWrap = document.createElement('label');
      openWrap.style.cssText = 'font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;cursor:pointer;';
      var openCheck = document.createElement('input');
      openCheck.type = 'checkbox';
      openCheck.className = 'stop-open';
      openWrap.appendChild(openCheck);
      openWrap.appendChild(document.createTextNode('Open'));
      stopDiv.appendChild(openWrap);

      var replyWrap = document.createElement('label');
      replyWrap.style.cssText = 'font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;cursor:pointer;';
      var replyCheck = document.createElement('input');
      replyCheck.type = 'checkbox';
      replyCheck.className = 'stop-reply';
      replyCheck.checked = true;
      replyWrap.appendChild(replyCheck);
      replyWrap.appendChild(document.createTextNode('Reply'));
      stopDiv.appendChild(replyWrap);

      card.appendChild(stopDiv);
      container.appendChild(card);
    }

    function saveTemplate() {
      var steps = [];
      var stepDivs = document.querySelectorAll('#steps-container > div');
      for (var i = 0; i < stepDivs.length; i++) {
        var div = stepDivs[i];
        var stopOn = [];
        if (div.querySelector('.stop-open').checked) stopOn.push('open');
        if (div.querySelector('.stop-reply').checked) stopOn.push('reply');
        steps.push({
          delayDays: parseInt(div.querySelector('.step-delay').value) || 2,
          subject: div.querySelector('.step-subject').value,
          body: div.querySelector('.step-body').value,
          stopOn: stopOn,
        });
      }
      fetch('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('tmpl-name').value,
          timezone: document.getElementById('tmpl-tz').value || 'UTC',
          steps: steps,
        }),
      }).then(function(res) {
        if (res.ok) location.reload();
        else res.json().then(function(err) { alert(err.error || 'Failed'); });
      });
    }

    function deleteTmpl(id) {
      if (confirm('Delete this template?')) {
        fetch('/templates/' + id, { method: 'DELETE' }).then(function() { location.reload(); });
      }
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
