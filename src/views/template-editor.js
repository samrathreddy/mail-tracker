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

      /* Autospintax button */
      .autospintax-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        border: 1px solid rgba(59,130,246,0.3);
        background: rgba(59,130,246,0.1);
        color: #60a5fa;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        padding: 0 10px;
        margin-left: 4px;
        transition: all 0.15s ease;
        white-space: nowrap;
      }
      .autospintax-btn:hover {
        background: rgba(59,130,246,0.2);
        border-color: rgba(59,130,246,0.5);
      }
      .autospintax-btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      .autospintax-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: #18181b;
        color: #e4e4e7;
        font-size: 13px;
        font-weight: 600;
        padding: 10px 20px;
        border-radius: 8px;
        border: 1px solid #3f3f46;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        z-index: 9999;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .autospintax-toast.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* Spam checker panel */
      .spam-toggle-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        border: none;
        background: none;
        color: var(--text-secondary);
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        padding: 0 8px;
        white-space: nowrap;
        transition: all 0.15s ease;
      }
      .spam-toggle-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }
      .spam-toggle-btn.active {
        background: var(--accent-bg);
        color: var(--accent-light);
      }

      .editor-with-spam {
        display: flex;
        gap: 0;
        flex: 1;
        min-height: 0;
      }
      .editor-main {
        flex: 1;
        min-width: 0;
      }
      .spam-panel {
        width: 0;
        overflow: hidden;
        opacity: 0;
        background: var(--bg-sidebar);
        border-left: 1px solid var(--border);
        transition: width 0.25s ease, opacity 0.2s ease, padding 0.25s ease;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 0;
      }
      .spam-panel.open {
        width: 280px;
        min-width: 280px;
        opacity: 1;
        padding: 16px;
        overflow-y: auto;
      }
      .spam-panel-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
      }
      .spam-score-ring {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      .spam-score-ring svg {
        filter: drop-shadow(0 0 6px rgba(0,0,0,0.3));
      }
      .spam-score-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-secondary);
      }
      .spam-metric {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .spam-metric-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .spam-metric-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
      }
      .spam-metric-value {
        font-size: 12px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .spam-bar {
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(90deg, #22c55e 0%, #22c55e 33%, #eab308 33%, #eab308 66%, #ef4444 66%, #ef4444 100%);
        position: relative;
      }
      .spam-bar-marker {
        position: absolute;
        top: -3px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #fff;
        border: 2px solid #18181b;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        transform: translateX(-50%);
        transition: left 0.3s ease;
      }
      .spam-word-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 2px;
      }
      .spam-word-tag {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        white-space: nowrap;
      }
      .spam-word-tag.red {
        background: rgba(239,68,68,0.15);
        color: #f87171;
      }
      .spam-word-tag.orange {
        background: rgba(249,115,22,0.15);
        color: #fb923c;
      }
      .spam-word-tag.yellow {
        background: rgba(234,179,8,0.15);
        color: #facc15;
      }
      .spam-recommendation {
        font-size: 11px;
        color: var(--text-muted);
        line-height: 1.5;
        padding: 8px;
        background: var(--bg-hover);
        border-radius: var(--radius-btn);
      }
      .severity-green { color: #22c55e; }
      .severity-yellow { color: #eab308; }
      .severity-red { color: #ef4444; }
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
      { name: 'first_name', desc: "Recipient's first name" },
      { name: 'company', desc: "Recipient's company name" },
      { name: 'recipient', desc: 'Full email address' },
      { name: 'subject', desc: 'Original email subject' },
      { name: 'originalBody', desc: 'Body preview' },
      { name: 'daysSince', desc: 'Days since previous step' },
      { name: 'stepNumber', desc: 'Current step number' }
    ];

    var SAMPLE_DATA = {
      firstName: 'Alice',
      first_name: 'Alice',
      company: 'Acme',
      recipient: 'alice@acme.com',
      subject: 'Partnership proposal',
      originalBody: 'Hi, I wanted to discuss a potential partnership...',
      daysSince: '3',
      stepNumber: '1',
      sender_first_name: 'You',
      senderFirstName: 'You'
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
      delayLabel.textContent = 'Send after (business days from previous step)';
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
      subjectInput.addEventListener('input', function() { debouncePreviewUpdate(); debounceSpamUpdate(); });
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

      // Autospintax button
      var autospintaxBtn = document.createElement('button');
      autospintaxBtn.type = 'button';
      autospintaxBtn.className = 'autospintax-btn';
      autospintaxBtn.title = 'Auto-replace common phrases with spintax alternatives';
      var wandSvgNS = 'http://www.w3.org/2000/svg';
      var wandSvg = document.createElementNS(wandSvgNS, 'svg');
      wandSvg.setAttribute('width', '14');
      wandSvg.setAttribute('height', '14');
      wandSvg.setAttribute('viewBox', '0 0 24 24');
      wandSvg.setAttribute('fill', 'none');
      wandSvg.setAttribute('stroke', 'currentColor');
      wandSvg.setAttribute('stroke-width', '2');
      wandSvg.setAttribute('stroke-linecap', 'round');
      wandSvg.setAttribute('stroke-linejoin', 'round');
      // Lucide "wand-sparkles" icon paths
      var wandPath1 = document.createElementNS(wandSvgNS, 'path');
      wandPath1.setAttribute('d', 'M21.64 3.64l-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.21 1.21 0 0 0 1.72 0L21.64 5.36a1.21 1.21 0 0 0 0-1.72z');
      wandSvg.appendChild(wandPath1);
      var wandPath2 = document.createElementNS(wandSvgNS, 'path');
      wandPath2.setAttribute('d', 'M14 7l3 3');
      wandSvg.appendChild(wandPath2);
      var wandStar1 = document.createElementNS(wandSvgNS, 'path');
      wandStar1.setAttribute('d', 'M5 6v4');
      wandSvg.appendChild(wandStar1);
      var wandStar2 = document.createElementNS(wandSvgNS, 'path');
      wandStar2.setAttribute('d', 'M3 8h4');
      wandSvg.appendChild(wandStar2);
      var wandStar3 = document.createElementNS(wandSvgNS, 'path');
      wandStar3.setAttribute('d', 'M19 14v4');
      wandSvg.appendChild(wandStar3);
      var wandStar4 = document.createElementNS(wandSvgNS, 'path');
      wandStar4.setAttribute('d', 'M17 16h4');
      wandSvg.appendChild(wandStar4);
      autospintaxBtn.appendChild(wandSvg);
      var spintaxLabel = document.createElement('span');
      spintaxLabel.textContent = 'Autospintax';
      autospintaxBtn.appendChild(spintaxLabel);
      autospintaxBtn.addEventListener('click', function() { runAutospintax(); });
      toolbar.appendChild(autospintaxBtn);

      var spacer = document.createElement('div');
      spacer.className = 'toolbar-spacer';
      toolbar.appendChild(spacer);

      // Spam checker toggle
      var spamBtn = document.createElement('button');
      spamBtn.type = 'button';
      spamBtn.className = 'spam-toggle-btn' + (spamPanelOpen ? ' active' : '');
      spamBtn.id = 'spam-toggle';
      spamBtn.title = 'Toggle spam checker panel';
      var shieldSvg = makeSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>');
      spamBtn.appendChild(shieldSvg);
      var spamLabel = document.createElement('span');
      spamLabel.textContent = 'Spam Check';
      spamBtn.appendChild(spamLabel);
      spamBtn.addEventListener('click', function() { toggleSpamPanel(); });
      toolbar.appendChild(spamBtn);

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

      // Wrapper for body editor + spam panel side by side
      var editorWithSpam = document.createElement('div');
      editorWithSpam.className = 'editor-with-spam';

      var editorMain = document.createElement('div');
      editorMain.className = 'editor-main';

      // Contenteditable body area
      // This contains the template author's own content (not untrusted user input).
      // Reading innerHTML to save is acceptable per project conventions.
      var bodyEl = document.createElement('div');
      bodyEl.className = 'editor-area';
      bodyEl.id = 'step-body';
      bodyEl.contentEditable = 'true';
      bodyEl.innerHTML = step.body;
      bodyEl.addEventListener('focus', function() { lastFocusedField = 'body'; });
      bodyEl.addEventListener('input', function() {
        debouncePreviewUpdate();
        debounceSpamUpdate();
      });
      /* Track selection changes for toolbar active state */
      bodyEl.addEventListener('keyup', updateToolbarState);
      bodyEl.addEventListener('mouseup', updateToolbarState);
      editorMain.appendChild(bodyEl);
      editorWithSpam.appendChild(editorMain);

      // Spam checker panel
      var spamPanel = document.createElement('div');
      spamPanel.className = 'spam-panel' + (spamPanelOpen ? ' open' : '');
      spamPanel.id = 'spam-panel';
      editorWithSpam.appendChild(spamPanel);
      if (spamPanelOpen) { setTimeout(function() { updateSpamPanel(); }, 0); }

      bodyField.appendChild(editorWithSpam);

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
      return text.replace(/\\{\\{([^}]+)\\}\\}/g, function(match, inner) {
        // Spintax: contains pipe → pick random option
        if (inner.indexOf('|') !== -1) {
          var opts = inner.split('|');
          return opts[Math.floor(Math.random() * opts.length)].trim();
        }
        // Variable lookup
        var name = inner.trim();
        return SAMPLE_DATA[name] || match;
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

    /* ============================================================
     * Autospintax
     * ============================================================ */
    var SPINTAX_DICTIONARY = [
      { match: /\\bjust following up\\b/gi, replace: '{{Just following up|Wanted to circle back|Bumping this to the top of your inbox}}' },
      { match: /\\bfollowing up\\b/gi, replace: '{{following up|circling back|checking in}}' },
      { match: /\\bhope you're well\\b/gi, replace: "{{Hope you're well|Hope you're doing great|Trust you're doing well}}" },
      { match: /\\bhope this finds you well\\b/gi, replace: "{{Hope this finds you well|Hope you're having a great week|Trust all is well}}" },
      { match: /\\blet me know\\b/gi, replace: '{{let me know|feel free to share|happy to hear your thoughts}}' },
      { match: /\\bwould love to\\b/gi, replace: '{{would love to|would be great to|would be happy to}}' },
      { match: /\\bhappy to\\b/gi, replace: '{{happy to|glad to|pleased to}}' },
      { match: /\\bquick question\\b/gi, replace: '{{quick question|brief question|short question}}' },
      { match: /\\bI wanted to reach out\\b/gi, replace: '{{I wanted to reach out|I thought I would reach out|I wanted to connect}}' },
      { match: /\\breaching out\\b/gi, replace: '{{reaching out|getting in touch|connecting}}' },
      { match: /\\btouching base\\b/gi, replace: '{{touching base|checking in|following up}}' },
      { match: /\\bwhen you get a chance\\b/gi, replace: '{{when you get a chance|when you have a moment|at your convenience}}' },
      { match: /\\blooking forward\\b/gi, replace: '{{looking forward|excited|eager}}' },
      { match: /\\bthank you\\b/gi, replace: '{{Thank you|Thanks|Thanks so much}}' },
      { match: /\\bthanks\\b/gi, replace: '{{Thanks|Cheers|Best}}' },
      { match: /\\bbest regards\\b/gi, replace: '{{Best regards|Best|Kind regards|Cheers}}' },
      { match: /\\bI think\\b/gi, replace: '{{I think|I believe|I feel}}' },
      { match: /\\bgreat fit\\b/gi, replace: '{{great fit|strong fit|good match}}' },
      { match: /\\bschedule a call\\b/gi, replace: '{{schedule a call|find time to chat|hop on a quick call}}' },
      { match: /\\bshare more\\b/gi, replace: '{{share more|send over details|walk you through it}}' }
    ];

    function runAutospintax() {
      var bodyEl = document.getElementById('step-body');
      if (!bodyEl) return;

      var html = bodyEl.innerHTML;
      var count = 0;

      // Temporarily replace existing {{...}} blocks with placeholders
      var existingBlocks = [];
      html = html.replace(/\\{\\{[^}]+\\}\\}/g, function(m) {
        existingBlocks.push(m);
        return '%%SPINTAX_PLACEHOLDER_' + (existingBlocks.length - 1) + '%%';
      });

      // Run dictionary replacements on remaining text
      for (var i = 0; i < SPINTAX_DICTIONARY.length; i++) {
        var entry = SPINTAX_DICTIONARY[i];
        html = html.replace(entry.match, function() {
          count++;
          return entry.replace;
        });
      }

      // Restore original {{...}} blocks
      html = html.replace(/%%SPINTAX_PLACEHOLDER_(\\d+)%%/g, function(_m, idx) {
        return existingBlocks[parseInt(idx)];
      });

      bodyEl.innerHTML = html;
      debouncePreviewUpdate();
      debounceSpamUpdate();
      showAutospintaxToast(count);
    }

    function showAutospintaxToast(count) {
      var existing = document.getElementById('autospintax-toast');
      if (existing) existing.parentNode.removeChild(existing);

      var toast = document.createElement('div');
      toast.className = 'autospintax-toast';
      toast.id = 'autospintax-toast';
      toast.textContent = count > 0
        ? 'Replaced ' + count + ' phrase' + (count !== 1 ? 's' : '') + ' with spintax'
        : 'No matching phrases found';
      document.body.appendChild(toast);

      // Force reflow then show
      toast.offsetHeight;
      toast.classList.add('visible');

      setTimeout(function() {
        toast.classList.remove('visible');
        setTimeout(function() {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 250);
      }, 2200);
    }

    /* ============================================================
     * Spam Checker Panel
     * ============================================================ */
    var spamPanelOpen = false;
    var spamDebounceTimer = null;

    var SPAM_WORDS_RED = ['free', 'buy now', 'act now', 'limited time', 'click here',
      'no obligation', 'risk-free', 'winner', 'congratulations', 'urgent', '100%',
      'guarantee', 'earn money', 'make money', 'cash', 'credit', 'discount', 'deal',
      'offer', 'lowest price', 'order now', 'subscribe', 'no cost'];
    var SPAM_WORDS_ORANGE = ['opportunity', 'amazing', 'incredible', 'exclusive',
      'special', 'bonus', 'profit', 'income', 'investment', 'affordable'];
    var SPAM_WORDS_YELLOW = ['reminder', 'help', 'improve', 'solution', 'results',
      'success', 'easy', 'simple', 'proven', 'effective'];

    function toggleSpamPanel() {
      spamPanelOpen = !spamPanelOpen;
      var panel = document.getElementById('spam-panel');
      var btn = document.getElementById('spam-toggle');
      if (!panel) return;
      if (spamPanelOpen) {
        panel.classList.add('open');
        if (btn) btn.classList.add('active');
        updateSpamPanel();
      } else {
        panel.classList.remove('open');
        if (btn) btn.classList.remove('active');
      }
    }

    function debounceSpamUpdate() {
      if (spamDebounceTimer) clearTimeout(spamDebounceTimer);
      spamDebounceTimer = setTimeout(function() {
        if (spamPanelOpen) updateSpamPanel();
      }, 500);
    }

    function findSpamWords(text, wordList) {
      var found = [];
      for (var i = 0; i < wordList.length; i++) {
        var word = wordList[i];
        var escaped = word.replace(/[.*+?^\\\\|(){}[\\]]/g, function(c) { return '\\\\' + c; });
        var regex = new RegExp('\\\\b' + escaped + '\\\\b', 'gi');
        if (regex.test(text)) {
          found.push(word);
        }
      }
      return found;
    }

    function analyzeSpam(bodyHtml, subjectText) {
      // Strip HTML tags for text analysis
      var text = bodyHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\\s+/g, ' ').trim();
      var fullText = (subjectText + ' ' + text).toLowerCase();

      // Count words (approximate spintax by using first option)
      var plainText = fullText.replace(/\\{\\{([^}]*)\\}\\}/g, function(m, inner) {
        if (inner.indexOf('|') !== -1) return inner.split('|')[0];
        return inner;
      });
      var wordCount = plainText.split(/\\s+/).filter(Boolean).length;

      // Count spintax/variable blocks
      var spintaxMatches = fullText.match(/\\{\\{[^}]+\\}\\}/g) || [];
      var spintaxPercent = wordCount > 0 ? Math.round((spintaxMatches.length / wordCount) * 100) : 0;

      // Count spam words by severity
      var redFound = findSpamWords(fullText, SPAM_WORDS_RED);
      var orangeFound = findSpamWords(fullText, SPAM_WORDS_ORANGE);
      var yellowFound = findSpamWords(fullText, SPAM_WORDS_YELLOW);

      // Count links, images, emojis
      var linkCount = (bodyHtml.match(/<a\\b/gi) || []).length;
      var urlsInText = text.match(/https?:\\/\\/\\S+/gi) || [];
      linkCount += urlsInText.length;
      var imageCount = (bodyHtml.match(/<img\\b/gi) || []).length;
      var emojiCount = 0;
      try {
        var emojiMatches = text.match(/[\\u{1F600}-\\u{1F64F}\\u{1F300}-\\u{1F5FF}\\u{1F680}-\\u{1F6FF}\\u{1F900}-\\u{1F9FF}\\u{2600}-\\u{26FF}\\u{2700}-\\u{27BF}]/gu);
        emojiCount = emojiMatches ? emojiMatches.length : 0;
      } catch(e) { emojiCount = 0; }

      // Compute overall score
      var score = 0;
      score += redFound.length * 10;
      score += orangeFound.length * 5;
      score += yellowFound.length * 2;
      score += Math.max(0, linkCount * 15);
      score += Math.max(0, imageCount * 10);
      score += Math.max(0, (emojiCount - 1) * 5);
      if (wordCount < 25 || wordCount > 100) score += 10;
      if (spintaxPercent < 5) score += 10;
      score = Math.min(100, score);

      return {
        score: score,
        spamWords: { red: redFound, orange: orangeFound, yellow: yellowFound },
        spintaxPercent: spintaxPercent,
        linkCount: linkCount,
        imageCount: imageCount,
        emojiCount: emojiCount,
        wordCount: wordCount
      };
    }

    function severityColor(level) {
      if (level === 'green') return '#22c55e';
      if (level === 'yellow') return '#eab308';
      return '#ef4444';
    }

    function scoreColor(score) {
      if (score < 30) return '#22c55e';
      if (score <= 60) return '#eab308';
      return '#ef4444';
    }

    function updateSpamPanel() {
      var panel = document.getElementById('spam-panel');
      if (!panel) return;
      while (panel.firstChild) panel.removeChild(panel.firstChild);

      var bodyEl = document.getElementById('step-body');
      var subjectEl = document.getElementById('step-subject');
      var bodyHtml = bodyEl ? bodyEl.innerHTML : '';
      var subjectText = subjectEl ? subjectEl.value : '';
      var data = analyzeSpam(bodyHtml, subjectText);

      // Title
      var title = document.createElement('div');
      title.className = 'spam-panel-title';
      title.textContent = 'Spam Analysis';
      panel.appendChild(title);

      // Ring chart for overall score
      var ringWrap = document.createElement('div');
      ringWrap.className = 'spam-score-ring';
      var ringSize = 80;
      var radius = 32;
      var circumference = 2 * Math.PI * radius;
      var dashLen = (data.score / 100) * circumference;
      var ringColor = scoreColor(data.score);

      var svgNS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', String(ringSize));
      svg.setAttribute('height', String(ringSize));
      svg.setAttribute('viewBox', '0 0 ' + ringSize + ' ' + ringSize);

      var bgCircle = document.createElementNS(svgNS, 'circle');
      bgCircle.setAttribute('cx', String(ringSize/2));
      bgCircle.setAttribute('cy', String(ringSize/2));
      bgCircle.setAttribute('r', String(radius));
      bgCircle.setAttribute('fill', 'none');
      bgCircle.setAttribute('stroke', '#27272a');
      bgCircle.setAttribute('stroke-width', '5');
      svg.appendChild(bgCircle);

      var fgCircle = document.createElementNS(svgNS, 'circle');
      fgCircle.setAttribute('cx', String(ringSize/2));
      fgCircle.setAttribute('cy', String(ringSize/2));
      fgCircle.setAttribute('r', String(radius));
      fgCircle.setAttribute('fill', 'none');
      fgCircle.setAttribute('stroke', ringColor);
      fgCircle.setAttribute('stroke-width', '5');
      fgCircle.setAttribute('stroke-dasharray', dashLen + ' ' + (circumference - dashLen));
      fgCircle.setAttribute('stroke-dashoffset', String(circumference * 0.25));
      fgCircle.setAttribute('stroke-linecap', 'round');
      svg.appendChild(fgCircle);

      var scoreText = document.createElementNS(svgNS, 'text');
      scoreText.setAttribute('x', String(ringSize/2));
      scoreText.setAttribute('y', String(ringSize/2 + 1));
      scoreText.setAttribute('text-anchor', 'middle');
      scoreText.setAttribute('dominant-baseline', 'middle');
      scoreText.setAttribute('fill', ringColor);
      scoreText.setAttribute('font-size', '18');
      scoreText.setAttribute('font-weight', '700');
      scoreText.setAttribute('font-family', 'inherit');
      scoreText.textContent = data.score + '%';
      svg.appendChild(scoreText);

      ringWrap.appendChild(svg);
      var ringLabel = document.createElement('div');
      ringLabel.className = 'spam-score-label';
      ringLabel.textContent = data.score < 30 ? 'Low spam risk' : data.score <= 60 ? 'Moderate spam risk' : 'High spam risk';
      ringWrap.appendChild(ringLabel);
      panel.appendChild(ringWrap);

      // Helper to add a metric row
      // inverted=true means higher is BETTER (red-yellow-green left to right) — used for spintax & word count
      function addMetric(label, value, barPercent, severity, inverted) {
        var metric = document.createElement('div');
        metric.className = 'spam-metric';
        var header = document.createElement('div');
        header.className = 'spam-metric-header';
        var lbl = document.createElement('span');
        lbl.className = 'spam-metric-label';
        lbl.textContent = label;
        header.appendChild(lbl);
        var val = document.createElement('span');
        val.className = 'spam-metric-value';
        val.style.color = severityColor(severity);
        val.textContent = String(value);
        header.appendChild(val);
        metric.appendChild(header);

        var bar = document.createElement('div');
        bar.className = 'spam-bar';
        if (inverted) {
          bar.style.background = 'linear-gradient(90deg, #ef4444 0%, #ef4444 33%, #eab308 33%, #eab308 66%, #22c55e 66%, #22c55e 100%)';
        }
        var marker = document.createElement('div');
        marker.className = 'spam-bar-marker';
        marker.style.left = Math.min(100, Math.max(0, barPercent)) + '%';
        bar.appendChild(marker);
        metric.appendChild(bar);
        return metric;
      }

      // Spam Words metric
      var totalSpamWords = data.spamWords.red.length + data.spamWords.orange.length + data.spamWords.yellow.length;
      var spamWordSeverity = data.spamWords.red.length > 0 ? 'red' : data.spamWords.orange.length > 0 ? 'yellow' : 'green';
      var spamBarPct = Math.min(100, totalSpamWords * 10);
      var spamMetric = addMetric('Spam Words', totalSpamWords, spamBarPct, spamWordSeverity);

      // Show found spam words as tags
      if (totalSpamWords > 0) {
        var tags = document.createElement('div');
        tags.className = 'spam-word-tags';
        function addTags(words, cls) {
          for (var i = 0; i < words.length; i++) {
            var tag = document.createElement('span');
            tag.className = 'spam-word-tag ' + cls;
            tag.textContent = words[i];
            tags.appendChild(tag);
          }
        }
        addTags(data.spamWords.red, 'red');
        addTags(data.spamWords.orange, 'orange');
        addTags(data.spamWords.yellow, 'yellow');
        spamMetric.appendChild(tags);
      }
      panel.appendChild(spamMetric);

      // Spintax & Variables (inverted: higher = better, bar goes red→green)
      var spintaxSeverity = data.spintaxPercent >= 10 ? 'green' : data.spintaxPercent >= 5 ? 'yellow' : 'red';
      var spintaxBarPct = Math.min(100, data.spintaxPercent * 2.5);
      panel.appendChild(addMetric('Spintax & Variables', data.spintaxPercent + '%', spintaxBarPct, spintaxSeverity, true));

      // Links
      var linkSeverity = data.linkCount === 0 ? 'green' : data.linkCount <= 2 ? 'yellow' : 'red';
      var linkMetric = addMetric('Links', data.linkCount, Math.min(100, data.linkCount * 25), linkSeverity);
      panel.appendChild(linkMetric);

      // Images
      var imgSeverity = data.imageCount === 0 ? 'green' : data.imageCount === 1 ? 'yellow' : 'red';
      panel.appendChild(addMetric('Images', data.imageCount, Math.min(100, data.imageCount * 35), imgSeverity));

      // Emojis
      var emojiSeverity = data.emojiCount <= 1 ? 'green' : data.emojiCount <= 3 ? 'yellow' : 'red';
      panel.appendChild(addMetric('Emojis', data.emojiCount, Math.min(100, data.emojiCount * 15), emojiSeverity));

      // Word Count (custom bar: red-yellow-green-yellow-red for sweet spot in middle)
      var wcSeverity = (data.wordCount >= 25 && data.wordCount <= 100) ? 'green'
        : ((data.wordCount >= 15 && data.wordCount < 25) || (data.wordCount > 100 && data.wordCount <= 150)) ? 'yellow' : 'red';
      var wcBarPct = Math.min(100, (data.wordCount / 150) * 100);
      var wcMetric = addMetric('Word Count', '~' + data.wordCount, wcBarPct, wcSeverity);
      // Override bar gradient for word count: red-yellow-green-yellow-red
      var wcBar = wcMetric.querySelector('.spam-bar');
      if (wcBar) wcBar.style.background = 'linear-gradient(90deg, #ef4444 0%, #eab308 10%, #eab308 17%, #22c55e 17%, #22c55e 67%, #eab308 67%, #eab308 80%, #ef4444 80%, #ef4444 100%)';
      panel.appendChild(wcMetric);

      // Recommendations
      var recs = [];
      if (data.spamWords.red.length > 0) recs.push('Remove high-severity spam trigger words.');
      if (data.linkCount > 0) recs.push('Avoid hyperlinks \\u2014 use plain text URLs instead.');
      if (data.imageCount > 0) recs.push('Minimize images to improve deliverability.');
      if (data.spintaxPercent < 5) recs.push('Add more spintax or variables for personalization.');
      if (data.wordCount < 25) recs.push('Email body is very short \\u2014 add more context.');
      if (data.wordCount > 100) recs.push('Consider shortening your email for better engagement.');
      if (data.emojiCount > 3) recs.push('Reduce emoji usage to avoid spam filters.');

      if (recs.length > 0) {
        var recBox = document.createElement('div');
        recBox.className = 'spam-recommendation';
        recBox.textContent = recs.join(' ');
        panel.appendChild(recBox);
      }
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
