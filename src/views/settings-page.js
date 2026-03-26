import { esc } from '../shared.js';
import { renderLayout } from './layout.js';

/**
 * Renders the Settings page.
 *
 * @param {Object} opts
 * @param {boolean} opts.oauthConnected - Whether Gmail OAuth is connected
 * @param {string|null} opts.oauthEmail - Connected Gmail address, if any
 * @param {string|null} opts.oauthError - OAuth error message, if any
 * @param {number} opts.sequenceCount - Number of active sequences
 * @param {number} opts.templateCount - Number of templates
 * @param {number} opts.trackerCount - Number of trackers
 * @returns {string} Complete HTML page
 */
export function renderSettingsPage(opts) {
  const {
    oauthConnected,
    oauthEmail,
    oauthError,
    sequenceCount,
    templateCount,
    trackerCount,
  } = opts;

  // Gmail OAuth Connection section
  const oauthStatusBadge = oauthConnected
    ? `<span class="badge badge-green">Connected</span>`
    : `<span class="badge badge-gray">Not connected</span>`;

  const oauthEmailHtml = oauthConnected && oauthEmail
    ? `<span style="margin-left:8px;font-size:13px;color:var(--text-secondary);">${esc(oauthEmail)}</span>`
    : '';

  const oauthActionBtn = oauthConnected
    ? `<button class="btn btn-danger" id="disconnectOAuthBtn">Disconnect</button>`
    : `<button class="btn btn-primary" id="connectOAuthBtn">Connect Gmail</button>`;

  const oauthErrorHtml = oauthError
    ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-btn);color:var(--error);font-size:12px;">
        <strong>Error:</strong> ${esc(String(oauthError))}
      </div>`
    : '';

  const oauthSection = `<div class="panel" style="margin-bottom:16px;">
    <div class="panel-title">Gmail OAuth Connection</div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      ${oauthStatusBadge}
      ${oauthEmailHtml}
      <div style="margin-left:auto;">${oauthActionBtn}</div>
    </div>
    ${oauthErrorHtml}
    <p style="margin-top:12px;font-size:11px;color:var(--text-muted);">
      Gmail OAuth is required for sending follow-up emails in sequences.
    </p>
  </div>`;

  // Webhook Status section
  const webhookSection = `<div class="panel" style="margin-bottom:16px;">
    <div class="panel-title">Webhook Notifications</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:13px;color:var(--text-secondary);width:60px;">Slack</span>
        <span class="badge badge-gray">Status unknown</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:13px;color:var(--text-secondary);width:60px;">Discord</span>
        <span class="badge badge-gray">Status unknown</span>
      </div>
    </div>
    <p style="margin-top:12px;font-size:11px;color:var(--text-muted);">
      Webhook URLs are set via CLI. Secrets are not readable at runtime.<br>
      <code style="background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-size:10px;">wrangler secret put SLACK_WEBHOOK_URL</code>
      &nbsp;
      <code style="background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-size:10px;">wrangler secret put DISCORD_WEBHOOK_URL</code>
    </p>
  </div>`;

  // Dashboard Access section
  const accessSection = `<div class="panel" style="margin-bottom:16px;">
    <div class="panel-title">Dashboard Access</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span class="badge badge-green">Password protected</span>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Worker URL</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="input" id="workerUrl" style="flex:1;font-family:monospace;font-size:12px;user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <button class="btn btn-secondary" id="copyUrlBtn">Copy</button>
      </div>
    </div>
    <p style="font-size:11px;color:var(--text-muted);">
      Change password:
      <code style="background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-size:10px;">wrangler secret put DASHBOARD_PASSWORD</code>
    </p>
  </div>`;

  // System Info section
  const systemSection = `<div class="panel">
    <div class="panel-title">System Info</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
      <div class="stat-card" style="padding:12px;">
        <div class="stat-label">Trackers</div>
        <div class="stat-value" style="font-size:20px;">${esc(String(trackerCount))}</div>
      </div>
      <div class="stat-card" style="padding:12px;">
        <div class="stat-label">Templates</div>
        <div class="stat-value" style="font-size:20px;">${esc(String(templateCount))}</div>
      </div>
      <div class="stat-card" style="padding:12px;">
        <div class="stat-label">Active Sequences</div>
        <div class="stat-value" style="font-size:20px;">${esc(String(sequenceCount))}</div>
      </div>
    </div>
    <p style="margin-top:12px;font-size:11px;color:var(--text-muted);">
      Manage deployments and configuration via CLI:
      <code style="background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-size:10px;">pnpm run deploy</code>
    </p>
  </div>`;

  const bodyHtml = `
    <div style="padding:0 32px 32px;max-width:720px;">
      ${oauthSection}
      ${webhookSection}
      ${accessSection}
      ${systemSection}
    </div>`;

  // Client-side JS for OAuth connect/disconnect and copy-to-clipboard
  const scripts = `
    (function() {
      // Populate worker URL from current location
      var urlEl = document.getElementById('workerUrl');
      if (urlEl) {
        urlEl.textContent = window.location.origin;
      }

      // Copy URL button
      var copyBtn = document.getElementById('copyUrlBtn');
      if (copyBtn) {
        copyBtn.addEventListener('click', function() {
          navigator.clipboard.writeText(window.location.origin).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
          });
        });
      }

      // Connect Gmail OAuth
      var connectBtn = document.getElementById('connectOAuthBtn');
      if (connectBtn) {
        connectBtn.addEventListener('click', function() {
          connectBtn.disabled = true;
          connectBtn.textContent = 'Connecting...';
          fetch('/oauth/url')
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.url) {
                window.location.href = data.url;
              } else {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect Gmail';
              }
            })
            .catch(function() {
              connectBtn.disabled = false;
              connectBtn.textContent = 'Connect Gmail';
            });
        });
      }

      // Disconnect Gmail OAuth
      var disconnectBtn = document.getElementById('disconnectOAuthBtn');
      if (disconnectBtn) {
        disconnectBtn.addEventListener('click', function() {
          if (!confirm('Disconnect Gmail? Active sequences will stop sending.')) return;
          disconnectBtn.disabled = true;
          disconnectBtn.textContent = 'Disconnecting...';
          fetch('/oauth/disconnect', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.disconnected) {
                window.location.reload();
              } else {
                disconnectBtn.disabled = false;
                disconnectBtn.textContent = 'Disconnect';
              }
            })
            .catch(function() {
              disconnectBtn.disabled = false;
              disconnectBtn.textContent = 'Disconnect';
            });
        });
      }
    })();
  `;

  return renderLayout({
    title: 'Settings',
    subtitle: 'Configuration and integrations',
    activePage: 'settings',
    bodyHtml,
    scripts,
    oauthConnected,
  });
}
