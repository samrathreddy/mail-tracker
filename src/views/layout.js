import { FAVICON } from '../shared.js';
import { getStyles } from './styles.js';

/**
 * Renders a complete HTML document with shared layout shell.
 *
 * @param {Object} opts
 * @param {string} opts.title - Page title shown in header h1
 * @param {string} [opts.subtitle] - Optional subtitle paragraph
 * @param {string} opts.activePage - One of: dashboard, sequences, templates, analytics, activity, settings
 * @param {string} [opts.headerActions] - Optional HTML string for header action buttons
 * @param {string} opts.bodyHtml - Main content HTML
 * @param {string} [opts.scripts] - Optional JS to include in a script tag
 * @param {boolean} [opts.oauthConnected] - Whether Gmail OAuth is connected
 * @param {number} [opts.sequenceCount] - Badge count for Sequences nav item
 * @returns {string} Complete HTML document
 */
export function renderLayout(opts) {
  const {
    title,
    subtitle,
    activePage,
    headerActions,
    bodyHtml,
    scripts,
    oauthConnected,
    sequenceCount,
  } = opts;

  const docTitle = `${title} — Mail Tracker`;

  const navItems = [
    {
      id: 'dashboard',
      href: '/',
      label: 'Dashboard',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="1" y="1" width="6" height="6" rx="1.5"/>
        <rect x="11" y="1" width="6" height="6" rx="1.5"/>
        <rect x="1" y="11" width="6" height="6" rx="1.5"/>
        <rect x="11" y="11" width="6" height="6" rx="1.5"/>
      </svg>`,
    },
    {
      id: 'sequences',
      href: '/sequences',
      label: 'Sequences',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="3" cy="4" r="1.5"/>
        <line x1="7" y1="4" x2="16" y2="4"/>
        <circle cx="3" cy="9" r="1.5"/>
        <line x1="7" y1="9" x2="16" y2="9"/>
        <circle cx="3" cy="14" r="1.5"/>
        <line x1="7" y1="14" x2="16" y2="14"/>
      </svg>`,
    },
    {
      id: 'templates',
      href: '/templates',
      label: 'Templates',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="1" width="14" height="16" rx="2"/>
        <line x1="5.5" y1="5.5" x2="12.5" y2="5.5"/>
        <line x1="5.5" y1="9" x2="12.5" y2="9"/>
        <line x1="5.5" y1="12.5" x2="9.5" y2="12.5"/>
      </svg>`,
    },
    {
      id: 'analytics',
      href: '/analytics',
      label: 'Analytics',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="1" y="10" width="3" height="7" rx="0.5"/>
        <rect x="5.5" y="7" width="3" height="10" rx="0.5"/>
        <rect x="10" y="4" width="3" height="13" rx="0.5"/>
        <rect x="14.5" y="1" width="3" height="16" rx="0.5"/>
      </svg>`,
    },
    {
      id: 'activity',
      href: '/activity',
      label: 'Activity',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="4" cy="3" r="1.5"/>
        <line x1="7" y1="3" x2="16" y2="3"/>
        <circle cx="4" cy="9" r="1.5"/>
        <line x1="7" y1="9" x2="16" y2="9"/>
        <circle cx="4" cy="15" r="1.5"/>
        <line x1="7" y1="15" x2="16" y2="15"/>
      </svg>`,
    },
  ];

  const settingsIcon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="9" cy="9" r="2.5"/>
    <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.05 3.05l1.41 1.41M13.54 13.54l1.41 1.41M3.05 14.95l1.41-1.41M13.54 4.46l1.41-1.41"/>
  </svg>`;

  const navHtml = navItems
    .map((item) => {
      const isActive = activePage === item.id;
      const cls = 'nav-item' + (isActive ? ' active' : '');
      const badgeHtml =
        item.id === 'sequences' && sequenceCount && sequenceCount > 0
          ? `<span class="nav-badge">${sequenceCount}</span>`
          : '';
      return `<a href="${item.href}" class="${cls}">
        <div class="nav-icon">${item.icon}</div>
        <span class="nav-label">${item.label}</span>
        ${badgeHtml}
      </a>`;
    })
    .join('\n      ');

  const statusDotClass = oauthConnected
    ? 'sidebar-status-dot connected'
    : 'sidebar-status-dot disconnected';

  const statusText = oauthConnected ? 'Gmail connected' : 'Gmail disconnected';

  const settingsActive = activePage === 'settings';
  const settingsClass = 'nav-item' + (settingsActive ? ' active' : '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${docTitle}</title>
  <link rel="icon" href="${FAVICON}">
  <style>${getStyles()}
    /* ── Layout Shell ── */
    .page-shell {
      display: flex;
      min-height: 100vh;
    }

    /* ── Expand-on-hover Sidebar ── */
    nav.sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: 40;
      width: 56px;
      background: #1a1f30;
      border-right: 1px solid rgba(148,163,184,0.06);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px 0;
      transition: width 0.2s ease;
      overflow: hidden;
    }
    nav.sidebar:hover {
      width: 200px;
      align-items: stretch;
      padding: 12px 8px;
    }

    .sidebar-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 4px 6px;
      margin-bottom: 16px;
    }
    nav.sidebar:hover .sidebar-logo {
      justify-content: flex-start;
    }
    .sidebar-logo-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #3b82f6, #60a5fa);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 0 12px rgba(59,130,246,0.15);
    }
    .sidebar-logo-text {
      color: #f1f5f9;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    nav.sidebar:hover .sidebar-logo-text {
      opacity: 1;
    }

    .nav-item {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 8px 0;
      border-radius: 8px;
      text-decoration: none;
      color: #8896b3;
      transition: background 0.15s, color 0.15s;
      margin-bottom: 2px;
      white-space: nowrap;
      position: relative;
    }
    nav.sidebar:hover .nav-item {
      justify-content: flex-start;
      padding: 8px 10px;
    }
    .nav-item:hover {
      background: rgba(255,255,255,0.04);
    }
    .nav-item.active {
      background: rgba(59,130,246,0.12);
      color: #60a5fa;
    }
    nav.sidebar:hover .nav-item.active {
      border-left: 3px solid #3b82f6;
      border-radius: 0 8px 8px 0;
      padding-left: 7px;
    }

    .nav-icon {
      width: 34px;
      height: 34px;
      min-width: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border-radius: 8px;
    }

    .nav-label {
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    nav.sidebar:hover .nav-label {
      opacity: 1;
    }

    .nav-badge {
      margin-left: auto;
      background: #2d3450;
      color: #60a5fa;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 10px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    nav.sidebar:hover .nav-badge {
      opacity: 1;
    }

    .sidebar-separator {
      width: calc(100% - 16px);
      height: 1px;
      background: rgba(148,163,184,0.08);
      margin: 8px 8px;
    }

    .sidebar-bottom {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .sidebar-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 8px 0;
      border-radius: 8px;
    }
    nav.sidebar:hover .sidebar-status {
      justify-content: flex-start;
      padding: 8px 10px;
    }
    .sidebar-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      margin: 0 14px 0 14px;
    }
    .sidebar-status-dot.connected {
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
    }
    .sidebar-status-dot.disconnected {
      background: #64748b;
    }
    .sidebar-status-text {
      color: #8896b3;
      font-size: 11px;
      opacity: 0;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    nav.sidebar:hover .sidebar-status-text {
      opacity: 1;
    }

    main.page-main {
      margin-left: 56px;
      flex: 1;
      min-height: 100vh;
      background: var(--bg-base);
      padding: 0;
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 24px 32px 16px;
      padding-left: 32px;
      border-bottom: 1px solid var(--border);
    }
    .page-header-left h1 {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      margin: 0;
    }
    .page-header-left p {
      font-size: 0.8rem;
      color: var(--text-secondary);
      margin: 4px 0 0 0;
    }
    .page-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <nav class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M22 4L12 13 2 4"/>
          </svg>
        </div>
        <span class="sidebar-logo-text">Mail Tracker</span>
      </div>
      ${navHtml}
      <div class="sidebar-separator"></div>
      <div class="sidebar-bottom">
        <div class="sidebar-status">
          <div class="${statusDotClass}"></div>
          <span class="sidebar-status-text">${statusText}</span>
        </div>
        <a href="/settings" class="${settingsClass}">
          <div class="nav-icon">${settingsIcon}</div>
          <span class="nav-label">Settings</span>
        </a>
      </div>
    </nav>
    <main class="page-main">
      <div class="page-header">
        <div class="page-header-left">
          <h1>${title}</h1>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
        ${headerActions ? `<div class="page-header-actions">${headerActions}</div>` : ''}
      </div>
      ${bodyHtml}
    </main>
  </div>
  ${scripts ? `<script>${scripts}</script>` : ''}
</body>
</html>`;
}
