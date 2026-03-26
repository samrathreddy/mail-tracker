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

  const navHtml = navItems
    .map((item) => {
      const isActive = activePage === item.id;
      const cls = 'sidebar-icon' + (isActive ? ' active' : '');
      const color = isActive ? '#60a5fa' : '#94a3b8';
      return `<a href="${item.href}" class="${cls}" style="color:${color}" title="${item.label}">
        ${item.icon}
        <span class="tooltip">${item.label}</span>
      </a>`;
    })
    .join('\n      ');

  const statusDotClass = oauthConnected
    ? 'status-dot connected'
    : 'status-dot disconnected';

  const statusDotTooltip = oauthConnected ? 'Gmail: Connected' : 'Gmail: Not connected';

  const settingsActive = activePage === 'settings';
  const settingsColor = settingsActive ? '#60a5fa' : '#94a3b8';
  const settingsClass = settingsActive ? ' settings-active' : '';

  const settingsIcon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="9" cy="9" r="2.5"/>
    <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.05 3.05l1.41 1.41M13.54 13.54l1.41 1.41M3.05 14.95l1.41-1.41M13.54 4.46l1.41-1.41"/>
  </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${docTitle}</title>
  <link rel="icon" href="${FAVICON}">
  <style>${getStyles()}
    /* Layout shell */
    .page-shell {
      display: flex;
      min-height: 100vh;
    }
    nav.sidebar {
      width: 56px;
      background: #0f0f11;
      border-right: 1px solid #27272a;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: 40;
    }
    .sidebar-logo {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: linear-gradient(135deg, #6366f1, #3b82f6);
      box-shadow: 0 0 12px rgba(59,130,246,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      flex-shrink: 0;
    }
    .sidebar-icon {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      margin-bottom: 6px;
      text-decoration: none;
      transition: background 0.15s, color 0.15s, transform 0.15s;
    }
    .sidebar-icon:hover {
      background: rgba(255,255,255,0.06);
      color: #c8d0dc;
      transform: scale(1.05);
    }
    .sidebar-icon.active {
      background: rgba(96,165,250,0.12);
    }
    .sidebar-icon.active::before {
      content: '';
      position: absolute;
      left: -2px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 20px;
      border-radius: 0 2px 2px 0;
      background: #60a5fa;
    }
    .sidebar-icon .tooltip {
      display: none;
      position: absolute;
      left: calc(100% + 12px);
      top: 50%;
      transform: translateY(-50%);
      background: #333d57;
      color: #fafafa;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      white-space: nowrap;
      pointer-events: none;
      z-index: 50;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .sidebar-icon .tooltip::before {
      content: '';
      position: absolute;
      right: 100%;
      top: 50%;
      transform: translateY(-50%);
      border: 4px solid transparent;
      border-right-color: #333d57;
    }
    .sidebar-icon:hover .tooltip {
      display: block;
    }
    .sidebar-nav-separator {
      width: 24px;
      height: 1px;
      background: rgba(255,255,255,0.06);
      margin: 8px 0;
      flex-shrink: 0;
    }
    .sidebar-bottom {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .status-dot-link {
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      cursor: pointer;
      position: relative;
    }
    .status-dot-link .tooltip {
      display: none;
      position: absolute;
      left: calc(100% + 12px);
      top: 50%;
      transform: translateY(-50%);
      background: #333d57;
      color: #fafafa;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      white-space: nowrap;
      pointer-events: none;
      z-index: 50;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .status-dot-link .tooltip::before {
      content: '';
      position: absolute;
      right: 100%;
      top: 50%;
      transform: translateY(-50%);
      border: 4px solid transparent;
      border-right-color: #333d57;
    }
    .status-dot-link:hover .tooltip {
      display: block;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .status-dot.connected {
      background: #34d399;
      box-shadow: 0 0 6px rgba(52,211,153,0.5);
    }
    .status-dot.disconnected {
      background: #71717a;
    }
    .sidebar-bottom a.settings-link {
      color: #94a3b8;
      text-decoration: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      transition: background 0.15s, color 0.15s, transform 0.15s;
      position: relative;
    }
    .sidebar-bottom a.settings-link:hover {
      background: rgba(255,255,255,0.06);
      color: #fafafa;
      transform: scale(1.05);
    }
    .sidebar-bottom a.settings-link.settings-active {
      background: rgba(96,165,250,0.12);
      color: #60a5fa;
    }
    .sidebar-bottom a.settings-link.settings-active::before {
      content: '';
      position: absolute;
      left: -2px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 20px;
      border-radius: 0 2px 2px 0;
      background: #60a5fa;
    }
    .sidebar-bottom a.settings-link .tooltip {
      display: none;
      position: absolute;
      left: calc(100% + 12px);
      top: 50%;
      transform: translateY(-50%);
      background: #333d57;
      color: #fafafa;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      white-space: nowrap;
      pointer-events: none;
      z-index: 50;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .sidebar-bottom a.settings-link .tooltip::before {
      content: '';
      position: absolute;
      right: 100%;
      top: 50%;
      transform: translateY(-50%);
      border: 4px solid transparent;
      border-right-color: #333d57;
    }
    .sidebar-bottom a.settings-link:hover .tooltip {
      display: block;
    }
    main.page-main {
      margin-left: 56px;
      flex: 1;
      min-height: 100vh;
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 24px 32px 16px;
      border-bottom: 1px solid #27272a;
    }
    .page-header-left h1 {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #fafafa;
      margin: 0;
    }
    .page-header-left p {
      font-size: 0.8rem;
      color: #71717a;
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="M22 4L12 13 2 4"/>
        </svg>
      </div>
      ${navHtml}
      <div class="sidebar-nav-separator"></div>
      <div class="sidebar-bottom">
        <a href="/settings" class="status-dot-link" title="${statusDotTooltip}">
          <div class="${statusDotClass}"></div>
          <span class="tooltip">${statusDotTooltip}</span>
        </a>
        <a href="/settings" class="settings-link${settingsClass}" style="color:${settingsColor}">
          ${settingsIcon}
          <span class="tooltip">Settings</span>
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
