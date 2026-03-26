import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { safeJson, renderBadge } from './components.js';

/**
 * Renders the template canvas editor page.
 * @param {object|null} template - Existing template object or null for new
 * @param {boolean} oauthConnected - Whether Gmail OAuth is connected
 * @returns {string} Complete HTML document
 */
export function renderTemplateEditor(template, oauthConnected) {
  const isNew = !template;
  const title = isNew ? 'New Template' : 'Edit Template';
  const stepCount = template ? template.steps.length : 0;

  const editorCss = `
    <style>
      .editor-topbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 24px;
        border-bottom: 1px solid var(--border);
        flex-wrap: wrap;
      }
      .editor-topbar .name-input {
        font-size: 18px;
        font-weight: 700;
        background: none;
        border: 1px solid transparent;
        border-radius: var(--radius-btn);
        color: var(--text-primary);
        padding: 4px 8px;
        outline: none;
        min-width: 200px;
        font-family: inherit;
        transition: border-color 0.15s ease;
      }
      .editor-topbar .name-input:focus {
        border-color: var(--accent);
        background: var(--bg-hover);
      }
      .editor-topbar .name-input:focus-visible {
        outline: none;
      }
      .editor-topbar .name-input::placeholder {
        color: var(--text-muted);
      }
      .editor-topbar .tz-select {
        background: var(--bg-hover);
        border: 1px solid var(--border);
        border-radius: var(--radius-btn);
        color: var(--text-primary);
        padding: 6px 10px;
        font-size: 12px;
        outline: none;
        font-family: inherit;
        cursor: pointer;
        transition: border-color 0.15s ease;
      }
      .editor-topbar .tz-select:focus {
        border-color: var(--accent);
      }
      .editor-topbar .spacer { flex: 1; }
      .cancel-link {
        color: var(--text-secondary);
        text-decoration: none;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: var(--radius-btn);
        transition: all 0.15s ease;
        cursor: pointer;
      }
      .cancel-link:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      /* Save button with loading state */
      .save-btn {
        position: relative;
        min-width: 80px;
        justify-content: center;
      }
      .save-btn.saving {
        pointer-events: none;
        opacity: 0.7;
      }
      .save-btn .save-spinner {
        display: none;
        width: 14px;
        height: 14px;
        border: 2px solid transparent;
        border-top-color: currentColor;
        border-radius: 50%;
        animation: spinSave 0.6s linear infinite;
      }
      .save-btn.saving .save-spinner {
        display: inline-block;
      }
      .save-btn.saving .save-label {
        display: none;
      }
      @keyframes spinSave {
        to { transform: rotate(360deg); }
      }

      .editor-body {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      /* Timeline panel with responsive collapse */
      .timeline-panel {
        width: 220px;
        min-width: 220px;
        background: var(--bg-sidebar);
        border-right: 1px solid var(--border);
        padding: 20px 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0;
        transition: width 0.2s ease, min-width 0.2s ease, padding 0.2s ease;
      }
      @media (max-width: 680px) {
        .timeline-panel {
          width: 56px;
          min-width: 56px;
          padding: 12px 6px;
        }
        .timeline-node-text {
          display: none;
        }
        .reorder-arrows {
          display: none;
        }
      }

      /* Timeline node selection transition */
      .timeline-node {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        position: relative;
        cursor: pointer;
        padding: 6px 8px;
        border-radius: var(--radius-btn);
        transition: all 0.15s ease;
      }
      .timeline-node:hover {
        background: var(--bg-hover);
      }
      .timeline-node:hover .reorder-arrows {
        opacity: 1;
      }
      .timeline-connector {
        width: 2px;
        height: 20px;
        background: rgba(59,130,246,0.25);
        margin-left: 23px;
        flex-shrink: 0;
      }

      /* Timeline circle with smooth selection transition */
      .timeline-circle {
        width: 36px;
        height: 36px;
        min-width: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        flex-shrink: 0;
        transition: all 0.2s ease;
      }
      .timeline-circle.origin {
        background: var(--bg-hover);
        border: 2px solid var(--text-muted);
        color: var(--text-muted);
      }
      .timeline-circle.selected {
        background: var(--accent);
        border: 2px solid var(--accent);
        color: #fff;
        box-shadow: 0 0 12px rgba(59,130,246,0.4);
        transform: scale(1.08);
      }
      .timeline-circle.unselected {
        background: transparent;
        border: 2px solid rgba(59,130,246,0.4);
        color: var(--accent-light);
      }
      .timeline-circle.add {
        background: transparent;
        border: 2px dashed var(--text-muted);
        color: var(--text-muted);
        cursor: pointer;
      }
      .timeline-circle.add:hover {
        border-color: var(--accent-light);
        color: var(--accent-light);
      }
      .timeline-node-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        padding-top: 4px;
      }
      .timeline-node-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .timeline-node-label.muted {
        color: var(--text-secondary);
        font-weight: 500;
      }
      .timeline-node-detail {
        font-size: 10px;
        color: var(--text-muted);
      }
      .timeline-node-detail.active-detail {
        color: var(--accent-light);
      }

      /* Reorder arrows: more discoverable */
      .reorder-arrows {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 2px;
        opacity: 0.25;
        transition: opacity 0.15s ease;
      }
      .timeline-node:hover .reorder-arrows {
        opacity: 1;
      }
      .reorder-arrow {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        border: none;
        background: var(--bg-hover);
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        font-size: 10px;
        transition: all 0.15s ease;
      }
      .reorder-arrow:hover {
        background: var(--accent-bg);
        color: var(--accent-light);
      }
      .reorder-arrow:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      .editor-panel {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .editor-panel .editor-header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .editor-panel .step-circle {
        width: 32px;
        height: 32px;
        min-width: 32px;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
      }
      .editor-panel .editor-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
      }
      .remove-step-link {
        font-size: 12px;
        color: var(--error);
        cursor: pointer;
        border: none;
        background: none;
        font-family: inherit;
        font-weight: 600;
        padding: 4px 8px;
        border-radius: var(--radius-btn);
        transition: all 0.15s ease;
      }
      .remove-step-link:hover {
        background: rgba(239,68,68,0.12);
      }
      .editor-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .editor-field label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .editor-field .field-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .editor-field input[type="number"] {
        width: 80px;
      }
      .stop-checks {
        display: flex;
        gap: 16px;
      }
      .stop-checks label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--text-secondary);
        text-transform: none;
        letter-spacing: normal;
        font-weight: 500;
        cursor: pointer;
      }
      .stop-checks input[type="checkbox"] {
        accent-color: var(--accent);
      }
      .subject-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .subject-row input {
        flex: 1;
      }
      .editor-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-bottom: none;
        border-radius: var(--radius-btn) var(--radius-btn) 0 0;
      }
      .toolbar-btn {
        width: 30px;
        height: 28px;
        border: none;
        background: none;
        color: var(--text-secondary);
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        font-family: inherit;
        transition: all 0.15s ease;
        padding: 0;
      }
      .toolbar-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }
      .toolbar-btn.active {
        background: var(--accent-bg);
        color: var(--accent-light);
      }
      .toolbar-btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      .toolbar-spacer { flex: 1; }

      /* Contenteditable body with inset shadow */
      .editor-area {
        min-height: 180px;
        max-height: 400px;
        overflow-y: auto;
        padding: 12px;
        background: var(--bg-hover);
        border: 1px solid var(--border);
        border-radius: 0 0 var(--radius-btn) var(--radius-btn);
        color: var(--text-primary);
        font-size: 13px;
        font-family: inherit;
        line-height: 1.6;
        outline: none;
        box-shadow: inset 0 2px 6px rgba(0,0,0,0.15);
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .editor-area:focus {
        border-color: var(--accent);
        box-shadow: inset 0 2px 6px rgba(0,0,0,0.15), 0 0 0 1px rgba(59,130,246,0.15);
      }

      /* Variable pills with hover state */
      .var-pill {
        display: inline-block;
        background: var(--accent-bg);
        color: var(--accent-light);
        padding: 1px 8px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        cursor: default;
        transition: background 0.15s ease;
      }
      .var-pill:hover {
        background: rgba(59,130,246,0.2);
      }
      .var-dropdown {
        position: absolute;
        z-index: 200;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-btn);
        padding: 4px 0;
        min-width: 200px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        display: none;
      }
      .var-dropdown.open {
        display: block;
      }
      .var-dropdown-item {
        padding: 8px 14px;
        font-size: 12px;
        color: var(--text-primary);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background 0.1s ease;
      }
      .var-dropdown-item:hover {
        background: var(--bg-hover);
      }
      .var-dropdown-item .var-name {
        color: var(--accent-light);
        font-weight: 600;
      }
      .var-dropdown-item .var-desc {
        color: var(--text-muted);
        font-size: 11px;
      }

      /* Preview panel with slide-down animation */
      .preview-panel {
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        padding: 0 16px;
        margin-top: 12px;
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        transition: max-height 0.3s ease, opacity 0.25s ease, padding 0.3s ease;
      }
      .preview-panel.visible {
        max-height: 600px;
        opacity: 1;
        padding: 16px;
      }
      .preview-panel .preview-header {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 12px;
      }
      .preview-email {
        background: #f8fafc;
        border-radius: var(--radius-btn);
        padding: 16px;
        color: #1e293b;
        font-size: 13px;
        line-height: 1.6;
      }
      .preview-email .preview-to {
        font-size: 11px;
        color: #64748b;
        margin-bottom: 4px;
      }
      .preview-email .preview-subject {
        font-size: 14px;
        font-weight: 700;
        color: #0f172a;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e2e8f0;
      }
      .preview-email .preview-body {
        color: #334155;
      }
      .empty-editor {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        gap: 12px;
        color: var(--text-muted);
        text-align: center;
        padding: 40px;
      }
      .empty-editor svg {
        opacity: 0.3;
      }
      .empty-editor p {
        font-size: 13px;
      }

      /* Focus visible on all interactive elements */
      .cancel-link:focus-visible,
      .btn:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
    </style>`;

  // The save button uses an onclick attribute calling saveTemplate(), which is
  // defined in the client-side scripts block below. This is safe because it
  // does not involve dynamic/untrusted data in the attribute value.
  const topBarHtml = `
    ${editorCss}
    <div class="editor-topbar">
      <input class="name-input" id="template-name" type="text"
        placeholder="Untitled Template"
        value="${template ? esc(template.name) : ''}">
      <span id="step-count-badge">${renderBadge(stepCount + ' step' + (stepCount !== 1 ? 's' : ''), 'blue')}</span>
      <select class="tz-select" id="template-tz">
        <option value="America/New_York">Eastern</option>
        <option value="America/Chicago">Central</option>
        <option value="America/Denver">Mountain</option>
        <option value="America/Los_Angeles">Pacific</option>
        <option value="Europe/London">London</option>
        <option value="Europe/Berlin">Berlin</option>
        <option value="Asia/Tokyo">Tokyo</option>
        <option value="UTC">UTC</option>
      </select>
      <div class="spacer"></div>
      <a href="/templates" class="cancel-link">Cancel</a>
      <button class="btn btn-success save-btn" id="save-btn">
        <span class="save-spinner"></span>
        <span class="save-label">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="10.5 3.5 5.5 9.5 3 7"/>
          </svg>
          Save
        </span>
      </button>
    </div>`;

  const emptyEditorSvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none"'
    + ' stroke="currentColor" stroke-width="1.5">'
    + '<rect x="2" y="4" width="20" height="16" rx="2"/>'
    + '<path d="M22 4L12 13 2 4"/></svg>';

  const bodyHtml = `
    ${topBarHtml}
    <div class="editor-body">
      <div class="timeline-panel" id="timeline-panel">
        <div id="timeline-nodes"></div>
      </div>
      <div class="editor-panel" id="editor-panel">
        <div class="empty-editor">
          ${emptyEditorSvg}
          <p>Add a follow-up step to get started</p>
        </div>
      </div>
    </div>`;

  const scripts = buildClientScripts(template);

  return renderLayout({
    title,
    activePage: 'templates',
    bodyHtml,
    scripts,
    oauthConnected,
  });
}

/**
 * Builds the client-side JavaScript for the template editor.
 * All dynamic content rendering uses DOM APIs (createElement, textContent,
 * appendChild). The contenteditable body reads innerHTML only for the
 * template author's own content, which is acceptable per project conventions.
 * @param {object|null} template
 * @returns {string}
 */
function buildClientScripts(template) {
  return `
    var template = ${safeJson(template)};
    var steps = template ? template.steps.map(function(s, i) {
      return {
        id: i,
        delayDays: s.delayDays,
        subject: s.subject || '',
        body: s.body || '',
        stopOn: s.stopOn ? s.stopOn.slice() : ['reply']
      };
    }) : [];
    var selectedStep = 0;
    var stepIdCounter = steps.length;
    var activeVarDropdown = null;
    var previewVisible = false;
    var lastFocusedField = null;
    var previewDebounceTimer = null;
    var isSaving = false;

    var VARIABLES = [
      { name: 'firstName', desc: "Recipient's first name" },
      { name: 'recipient', desc: 'Full email address' },
      { name: 'subject', desc: 'Original email subject' },
      { name: 'originalBody', desc: 'Body preview' },
      { name: 'daysSince', desc: 'Days since original email' },
      { name: 'stepNumber', desc: 'Current step number' }
    ];

    var SAMPLE_DATA = {
      firstName: 'Alice',
      recipient: 'alice@acme.com',
      subject: 'Partnership proposal',
      originalBody: 'Hi, I wanted to discuss a potential partnership...',
      daysSince: '3',
      stepNumber: '1'
    };

    // Set timezone selector to match template
    if (template && template.timezone) {
      var tzSel = document.getElementById('template-tz');
      for (var i = 0; i < tzSel.options.length; i++) {
        if (tzSel.options[i].value === template.timezone) {
          tzSel.selectedIndex = i;
          break;
        }
      }
    }

    // Wire up save button
    document.getElementById('save-btn').addEventListener('click', function() {
      saveTemplate();
    });

    function makeSvg(svgMarkup) {
      var tmp = document.createElement('div');
      tmp.innerHTML = svgMarkup;
      return tmp.firstChild;
    }

    function renderTimeline() {
      var container = document.getElementById('timeline-nodes');
      while (container.firstChild) container.removeChild(container.firstChild);

      // Origin node
      var originNode = document.createElement('div');
      originNode.className = 'timeline-node';
      originNode.style.cursor = 'default';

      var originCircle = document.createElement('div');
      originCircle.className = 'timeline-circle origin';
      var envelopeSvg = makeSvg('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>');
      originCircle.appendChild(envelopeSvg);
      originNode.appendChild(originCircle);

      var originText = document.createElement('div');
      originText.className = 'timeline-node-text';
      var originLabel = document.createElement('div');
      originLabel.className = 'timeline-node-label muted';
      originLabel.textContent = 'Original email';
      originText.appendChild(originLabel);
      var originDetail = document.createElement('div');
      originDetail.className = 'timeline-node-detail';
      originDetail.textContent = 'Day 0';
      originText.appendChild(originDetail);
      originNode.appendChild(originText);
      container.appendChild(originNode);

      // Step nodes
      for (var i = 0; i < steps.length; i++) {
        (function(idx) {
          var conn = document.createElement('div');
          conn.className = 'timeline-connector';
          container.appendChild(conn);

          var node = document.createElement('div');
          node.className = 'timeline-node';
          node.addEventListener('click', function() {
            syncCurrentStepFromDom();
            selectedStep = idx;
            renderTimeline();
            renderEditor();
          });

          var isSelected = idx === selectedStep;

          var circle = document.createElement('div');
          circle.className = 'timeline-circle ' + (isSelected ? 'selected' : 'unselected');
          circle.textContent = String(idx + 1);
          node.appendChild(circle);

          var text = document.createElement('div');
          text.className = 'timeline-node-text';
          var label = document.createElement('div');
          label.className = 'timeline-node-label' + (isSelected ? '' : ' muted');
          label.textContent = 'Follow-up #' + (idx + 1);
          text.appendChild(label);
          var detail = document.createElement('div');
          detail.className = 'timeline-node-detail' + (isSelected ? ' active-detail' : '');
          detail.textContent = 'Day ' + steps[idx].delayDays;
          text.appendChild(detail);
          node.appendChild(text);

          // Reorder arrows
          var arrows = document.createElement('div');
          arrows.className = 'reorder-arrows';

          if (idx > 0) {
            var upBtn = document.createElement('button');
            upBtn.className = 'reorder-arrow';
            upBtn.type = 'button';
            upBtn.textContent = '\\u25B2';
            upBtn.addEventListener('click', function(e) {
              e.stopPropagation();
              moveStep(idx, -1);
            });
            arrows.appendChild(upBtn);
          }

          if (idx < steps.length - 1) {
            var downBtn = document.createElement('button');
            downBtn.className = 'reorder-arrow';
            downBtn.type = 'button';
            downBtn.textContent = '\\u25BC';
            downBtn.addEventListener('click', function(e) {
              e.stopPropagation();
              moveStep(idx, 1);
            });
            arrows.appendChild(downBtn);
          }

          node.appendChild(arrows);
          container.appendChild(node);
        })(i);
      }

      // Add step node
      var addConn = document.createElement('div');
      addConn.className = 'timeline-connector';
      container.appendChild(addConn);

      var addNode = document.createElement('div');
      addNode.className = 'timeline-node';
      addNode.addEventListener('click', function() { addStep(); });

      var addCircle = document.createElement('div');
      addCircle.className = 'timeline-circle add';
      addCircle.textContent = '+';
      addNode.appendChild(addCircle);

      var addText = document.createElement('div');
      addText.className = 'timeline-node-text';
      var addLabel = document.createElement('div');
      addLabel.className = 'timeline-node-label muted';
      addLabel.textContent = 'Add step';
      addText.appendChild(addLabel);
      addNode.appendChild(addText);
      container.appendChild(addNode);

      updateStepBadge();
    }

    function updateStepBadge() {
      var badge = document.getElementById('step-count-badge');
      if (badge) {
        badge.textContent = steps.length + ' step' + (steps.length !== 1 ? 's' : '');
        badge.className = 'badge badge-blue';
      }
    }

    function syncCurrentStepFromDom() {
      if (steps.length === 0 || selectedStep >= steps.length) return;
      var delayInput = document.getElementById('step-delay');
      if (delayInput) steps[selectedStep].delayDays = parseInt(delayInput.value) || 1;
      var subjectInput = document.getElementById('step-subject');
      if (subjectInput) steps[selectedStep].subject = subjectInput.value;
      var bodyEl = document.getElementById('step-body');
      if (bodyEl) steps[selectedStep].body = bodyEl.innerHTML;
      var replyCheck = document.getElementById('stop-reply');
      var openCheck = document.getElementById('stop-open');
      if (replyCheck || openCheck) {
        var stopOn = [];
        if (replyCheck && replyCheck.checked) stopOn.push('reply');
        if (openCheck && openCheck.checked) stopOn.push('open');
        steps[selectedStep].stopOn = stopOn;
      }
    }

    /* Track active formatting for toolbar button states */
    function updateToolbarState() {
      var boldBtn = document.getElementById('toolbar-bold');
      var italicBtn = document.getElementById('toolbar-italic');
      if (boldBtn) {
        if (document.queryCommandState('bold')) {
          boldBtn.classList.add('active');
        } else {
          boldBtn.classList.remove('active');
        }
      }
      if (italicBtn) {
        if (document.queryCommandState('italic')) {
          italicBtn.classList.add('active');
        } else {
          italicBtn.classList.remove('active');
        }
      }
    }

    function renderEditor() {
      var panel = document.getElementById('editor-panel');
      while (panel.firstChild) panel.removeChild(panel.firstChild);
      previewVisible = false;

      if (steps.length === 0 || selectedStep >= steps.length) {
        var empty = document.createElement('div');
        empty.className = 'empty-editor';
        var emptySvg = makeSvg('<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>');
        empty.appendChild(emptySvg);
        var emptyP = document.createElement('p');
        emptyP.textContent = 'Add a follow-up step to get started';
        empty.appendChild(emptyP);
        panel.appendChild(empty);
        return;
      }

      var step = steps[selectedStep];

      // Header
      var header = document.createElement('div');
      header.className = 'editor-header';
      var circleEl = document.createElement('div');
      circleEl.className = 'step-circle';
      circleEl.textContent = String(selectedStep + 1);
      header.appendChild(circleEl);
      var titleEl = document.createElement('div');
      titleEl.className = 'editor-title';
      titleEl.textContent = 'Follow-up #' + (selectedStep + 1);
      header.appendChild(titleEl);
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-step-link';
      removeBtn.textContent = 'Remove step';
      removeBtn.addEventListener('click', function() { removeStep(selectedStep); });
      header.appendChild(removeBtn);
      panel.appendChild(header);

      // Delay field
      var delayField = document.createElement('div');
      delayField.className = 'editor-field';
      var delayLabel = document.createElement('label');
      delayLabel.textContent = 'Send after (days from original)';
      delayField.appendChild(delayLabel);
      var delayRow = document.createElement('div');
      delayRow.className = 'field-row';
      var delayInput = document.createElement('input');
      delayInput.type = 'number';
      delayInput.className = 'input';
      delayInput.id = 'step-delay';
      delayInput.min = '1';
      delayInput.max = '365';
      delayInput.value = String(step.delayDays);
      delayInput.addEventListener('change', function() {
        steps[selectedStep].delayDays = parseInt(this.value) || 1;
        renderTimeline();
      });
      delayRow.appendChild(delayInput);
      var daysSpan = document.createElement('span');
      daysSpan.style.cssText = 'font-size:12px;color:var(--text-secondary)';
      daysSpan.textContent = 'days';
      delayRow.appendChild(daysSpan);
      delayField.appendChild(delayRow);
      panel.appendChild(delayField);

      // Stop conditions
      var stopField = document.createElement('div');
      stopField.className = 'editor-field';
      var stopLabel = document.createElement('label');
      stopLabel.textContent = 'Stop conditions';
      stopField.appendChild(stopLabel);
      var stopChecks = document.createElement('div');
      stopChecks.className = 'stop-checks';

      var replyLabel = document.createElement('label');
      var replyCheck = document.createElement('input');
      replyCheck.type = 'checkbox';
      replyCheck.id = 'stop-reply';
      replyCheck.checked = step.stopOn.indexOf('reply') !== -1;
      replyLabel.appendChild(replyCheck);
      replyLabel.appendChild(document.createTextNode(' On reply'));
      stopChecks.appendChild(replyLabel);

      var openLabel = document.createElement('label');
      var openCheck = document.createElement('input');
      openCheck.type = 'checkbox';
      openCheck.id = 'stop-open';
      openCheck.checked = step.stopOn.indexOf('open') !== -1;
      openLabel.appendChild(openCheck);
      openLabel.appendChild(document.createTextNode(' On open'));
      stopChecks.appendChild(openLabel);

      stopField.appendChild(stopChecks);
      panel.appendChild(stopField);

      // Subject field
      var subjectField = document.createElement('div');
      subjectField.className = 'editor-field';
      var subjectLabel = document.createElement('label');
      subjectLabel.textContent = 'Subject line';
      subjectField.appendChild(subjectLabel);
      var subjectRow = document.createElement('div');
      subjectRow.className = 'subject-row';
      var subjectInput = document.createElement('input');
      subjectInput.type = 'text';
      subjectInput.className = 'input';
      subjectInput.id = 'step-subject';
      subjectInput.placeholder = 'Re: {{subject}}';
      subjectInput.value = step.subject;
      subjectInput.addEventListener('focus', function() { lastFocusedField = 'subject'; });
      subjectInput.addEventListener('input', function() { debouncePreviewUpdate(); });
      subjectRow.appendChild(subjectInput);

      var subjectVarBtn = document.createElement('button');
      subjectVarBtn.type = 'button';
      subjectVarBtn.className = 'btn btn-secondary';
      subjectVarBtn.style.cssText = 'white-space:nowrap;font-size:11px';
      subjectVarBtn.textContent = '{{ var';
      subjectVarBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        lastFocusedField = 'subject';
        toggleVarDropdown(this);
      });
      subjectRow.appendChild(subjectVarBtn);
      subjectField.appendChild(subjectRow);
      panel.appendChild(subjectField);

      // Body field
      var bodyField = document.createElement('div');
      bodyField.className = 'editor-field';
      var bodyLabel = document.createElement('label');
      bodyLabel.textContent = 'Body';
      bodyField.appendChild(bodyLabel);

      // Toolbar
      var toolbar = document.createElement('div');
      toolbar.className = 'editor-toolbar';

      var boldBtn = createToolbarBtn('B', 'bold', 'font-weight:700');
      boldBtn.id = 'toolbar-bold';
      toolbar.appendChild(boldBtn);

      var italicBtn = createToolbarBtn('I', 'italic', 'font-style:italic');
      italicBtn.id = 'toolbar-italic';
      toolbar.appendChild(italicBtn);

      var linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'toolbar-btn';
      linkBtn.title = 'Insert link';
      var linkSvg = makeSvg('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 8a3 3 0 004 .5l2-2a3 3 0 00-4.24-4.24L6.5 3.5"/><path d="M8 6a3 3 0 00-4-.5l-2 2A3 3 0 006.24 11.74L7.5 10.5"/></svg>');
      linkBtn.appendChild(linkSvg);
      linkBtn.addEventListener('click', function() {
        var bodyArea = document.getElementById('step-body');
        if (bodyArea) bodyArea.focus();
        var linkUrl = prompt('Enter URL:');
        if (linkUrl) document.execCommand('createLink', false, linkUrl);
      });
      toolbar.appendChild(linkBtn);

      var listBtn = document.createElement('button');
      listBtn.type = 'button';
      listBtn.className = 'toolbar-btn';
      listBtn.title = 'Bullet list';
      var listSvg = makeSvg('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="5" y1="3" x2="12" y2="3"/><line x1="5" y1="7" x2="12" y2="7"/><line x1="5" y1="11" x2="12" y2="11"/><circle cx="2.5" cy="3" r="0.75" fill="currentColor"/><circle cx="2.5" cy="7" r="0.75" fill="currentColor"/><circle cx="2.5" cy="11" r="0.75" fill="currentColor"/></svg>');
      listBtn.appendChild(listSvg);
      listBtn.addEventListener('click', function() {
        var bodyArea = document.getElementById('step-body');
        if (bodyArea) bodyArea.focus();
        document.execCommand('insertUnorderedList');
      });
      toolbar.appendChild(listBtn);

      var toolbarVarBtn = document.createElement('button');
      toolbarVarBtn.type = 'button';
      toolbarVarBtn.className = 'btn btn-secondary';
      toolbarVarBtn.style.cssText = 'font-size:11px;margin-left:4px';
      toolbarVarBtn.textContent = '{{ var';
      toolbarVarBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        lastFocusedField = 'body';
        toggleVarDropdown(this);
      });
      toolbar.appendChild(toolbarVarBtn);

      var spacer = document.createElement('div');
      spacer.className = 'toolbar-spacer';
      toolbar.appendChild(spacer);

      var previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'toolbar-btn';
      previewBtn.id = 'preview-toggle';
      previewBtn.title = 'Preview';
      previewBtn.textContent = 'Preview';
      previewBtn.style.cssText = 'width:auto;padding:0 8px;font-size:11px;font-weight:600';
      previewBtn.addEventListener('click', function() { togglePreview(); });
      toolbar.appendChild(previewBtn);

      bodyField.appendChild(toolbar);

      // Contenteditable body area
      // This contains the template author's own content (not untrusted user input).
      // Reading innerHTML to save is acceptable per project conventions.
      var bodyEl = document.createElement('div');
      bodyEl.className = 'editor-area';
      bodyEl.id = 'step-body';
      bodyEl.contentEditable = 'true';
      bodyEl.innerHTML = step.body;
      bodyEl.addEventListener('focus', function() { lastFocusedField = 'body'; });
      bodyEl.addEventListener('input', function() { debouncePreviewUpdate(); });
      /* Track selection changes for toolbar active state */
      bodyEl.addEventListener('keyup', updateToolbarState);
      bodyEl.addEventListener('mouseup', updateToolbarState);
      bodyField.appendChild(bodyEl);

      // Preview panel
      var previewPanel = document.createElement('div');
      previewPanel.className = 'preview-panel';
      previewPanel.id = 'preview-panel';
      var previewHead = document.createElement('div');
      previewHead.className = 'preview-header';
      previewHead.textContent = 'Email Preview';
      previewPanel.appendChild(previewHead);
      var previewEmail = document.createElement('div');
      previewEmail.className = 'preview-email';
      previewEmail.id = 'preview-email';
      previewPanel.appendChild(previewEmail);
      bodyField.appendChild(previewPanel);

      panel.appendChild(bodyField);
    }

    function createToolbarBtn(label, command, style) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toolbar-btn';
      btn.textContent = label;
      if (style) btn.style.cssText = style;
      btn.addEventListener('click', function() {
        var bodyArea = document.getElementById('step-body');
        if (bodyArea) bodyArea.focus();
        document.execCommand(command);
        updateToolbarState();
      });
      return btn;
    }

    function toggleVarDropdown(anchorEl) {
      closeVarDropdown();
      var dropdown = document.createElement('div');
      dropdown.className = 'var-dropdown open';
      dropdown.id = 'var-dropdown';

      var rect = anchorEl.getBoundingClientRect();
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.left = rect.left + 'px';
      dropdown.style.position = 'fixed';

      for (var vi = 0; vi < VARIABLES.length; vi++) {
        (function(v) {
          var item = document.createElement('div');
          item.className = 'var-dropdown-item';
          var nameSpan = document.createElement('span');
          nameSpan.className = 'var-name';
          nameSpan.textContent = '{{' + v.name + '}}';
          item.appendChild(nameSpan);
          var descSpan = document.createElement('span');
          descSpan.className = 'var-desc';
          descSpan.textContent = v.desc;
          item.appendChild(descSpan);
          item.addEventListener('click', function(e) {
            e.stopPropagation();
            insertVariable(v.name);
            closeVarDropdown();
          });
          dropdown.appendChild(item);
        })(VARIABLES[vi]);
      }

      document.body.appendChild(dropdown);
      activeVarDropdown = dropdown;
    }

    function closeVarDropdown() {
      if (activeVarDropdown && activeVarDropdown.parentNode) {
        activeVarDropdown.parentNode.removeChild(activeVarDropdown);
        activeVarDropdown = null;
      }
    }

    document.addEventListener('click', function() { closeVarDropdown(); });

    function insertVariable(varName) {
      var text = '{{' + varName + '}}';
      if (lastFocusedField === 'subject') {
        var input = document.getElementById('step-subject');
        if (!input) return;
        var start = input.selectionStart != null ? input.selectionStart : input.value.length;
        var end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
        input.value = input.value.substring(0, start) + text + input.value.substring(end);
        input.focus();
        var pos = start + text.length;
        input.setSelectionRange(pos, pos);
      } else {
        var bodyArea = document.getElementById('step-body');
        if (!bodyArea) return;
        bodyArea.focus();
        var pill = document.createElement('span');
        pill.className = 'var-pill';
        pill.contentEditable = 'false';
        pill.textContent = text;
        var sel = window.getSelection();
        if (sel.rangeCount) {
          var range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(pill);
          range.setStartAfter(pill);
          range.setEndAfter(pill);
          sel.removeAllRanges();
          sel.addRange(range);
          var spaceNode = document.createTextNode('\\u00A0');
          range.insertNode(spaceNode);
          range.setStartAfter(spaceNode);
          range.setEndAfter(spaceNode);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      debouncePreviewUpdate();
    }

    function togglePreview() {
      previewVisible = !previewVisible;
      var previewPanel = document.getElementById('preview-panel');
      var btn = document.getElementById('preview-toggle');
      if (!previewPanel || !btn) return;
      if (previewVisible) {
        previewPanel.classList.add('visible');
        btn.classList.add('active');
        updatePreview();
      } else {
        previewPanel.classList.remove('visible');
        btn.classList.remove('active');
      }
    }

    function debouncePreviewUpdate() {
      if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
      previewDebounceTimer = setTimeout(function() {
        if (previewVisible) updatePreview();
      }, 300);
    }

    function replaceVars(text) {
      return text.replace(/\\{\\{(\\w+)\\}\\}/g, function(_m, name) {
        return SAMPLE_DATA[name] || ('{{' + name + '}}');
      });
    }

    function updatePreview() {
      var emailEl = document.getElementById('preview-email');
      if (!emailEl) return;
      while (emailEl.firstChild) emailEl.removeChild(emailEl.firstChild);

      var subjectInput = document.getElementById('step-subject');
      var bodyArea = document.getElementById('step-body');
      var subjectVal = subjectInput ? subjectInput.value : '';
      var bodyVal = bodyArea ? bodyArea.innerHTML : '';

      var toDiv = document.createElement('div');
      toDiv.className = 'preview-to';
      toDiv.textContent = 'To: ' + SAMPLE_DATA.recipient;
      emailEl.appendChild(toDiv);

      var subjDiv = document.createElement('div');
      subjDiv.className = 'preview-subject';
      subjDiv.textContent = replaceVars(subjectVal || 'Re: {{subject}}');
      emailEl.appendChild(subjDiv);

      // Preview body: this renders the template author's own content with
      // sample variable replacements. The content originates from the
      // contenteditable div which the author controls.
      var bodyDiv = document.createElement('div');
      bodyDiv.className = 'preview-body';
      if (bodyVal) {
        bodyDiv.innerHTML = replaceVars(bodyVal);
      } else {
        var emptyNote = document.createElement('em');
        emptyNote.textContent = 'No body content yet';
        bodyDiv.appendChild(emptyNote);
      }
      emailEl.appendChild(bodyDiv);
    }

    function addStep() {
      syncCurrentStepFromDom();
      var defaultDelay = steps.length === 0 ? 2 : (steps[steps.length - 1].delayDays + 3);
      steps.push({
        id: stepIdCounter++,
        delayDays: defaultDelay,
        subject: '',
        body: '',
        stopOn: ['reply']
      });
      selectedStep = steps.length - 1;
      renderTimeline();
      renderEditor();
    }

    function removeStep(index) {
      if (index < 0 || index >= steps.length) return;
      syncCurrentStepFromDom();
      steps.splice(index, 1);
      if (selectedStep >= steps.length) {
        selectedStep = Math.max(0, steps.length - 1);
      }
      renderTimeline();
      renderEditor();
    }

    function moveStep(index, direction) {
      var target = index + direction;
      if (target < 0 || target >= steps.length) return;
      syncCurrentStepFromDom();
      var temp = steps[index];
      steps[index] = steps[target];
      steps[target] = temp;
      selectedStep = target;
      renderTimeline();
      renderEditor();
    }

    function collectTemplate() {
      syncCurrentStepFromDom();
      var name = document.getElementById('template-name').value.trim() || 'Untitled Template';
      var timezone = document.getElementById('template-tz').value;
      return {
        name: name,
        timezone: timezone,
        steps: steps.map(function(s) {
          return {
            delayDays: s.delayDays,
            subject: s.subject,
            body: s.body,
            stopOn: s.stopOn
          };
        })
      };
    }

    function saveTemplate() {
      if (isSaving) return;
      var data = collectTemplate();
      if (data.steps.length === 0) {
        alert('Add at least one follow-up step before saving.');
        return;
      }

      var saveBtn = document.getElementById('save-btn');
      isSaving = true;
      saveBtn.classList.add('saving');

      var isEdit = template && template.id;
      var method = isEdit ? 'PUT' : 'POST';
      var endpoint = isEdit ? '/templates/' + template.id : '/templates';

      fetch(endpoint, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(err) { throw new Error(err.error || 'Save failed'); });
        return res.json();
      }).then(function() {
        window.location.href = '/templates';
      }).catch(function(err) {
        isSaving = false;
        saveBtn.classList.remove('saving');
        alert('Error: ' + err.message);
      });
    }

    // Initial render
    if (steps.length > 0) {
      selectedStep = 0;
      renderTimeline();
      renderEditor();
    } else {
      renderTimeline();
    }
  `;
}
