/**
 * Shared CSS Design Tokens and Component Styles
 *
 * Single source of truth for the mail-tracker dashboard UI.
 * Imported by layout.js and every view file.
 * Usage: <style>${getStyles()}</style>
 */

export function getStyles() {
  return `
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Design Tokens ── */
    :root {
      --bg-base: #242a3d;
      --bg-surface: #2d3450;
      --bg-surface-alt: #2a3148;
      --bg-sidebar: #1e2435;
      --bg-hover: #333d57;
      --bg-elevated: #353e5a;

      --border: rgba(148,163,184,0.1);
      --border-subtle: rgba(148,163,184,0.06);

      --text-primary: #f1f5f9;
      --text-secondary: #8896b3;
      --text-muted: #6b7c9e;

      --accent: #3b82f6;
      --accent-light: #60a5fa;
      --accent-bg: rgba(59,130,246,0.12);

      --success: #22c55e;
      --warning: #eab308;
      --error: #ef4444;

      --radius-card: 14px;
      --radius-row: 10px;
      --radius-btn: 8px;
      --radius-badge: 20px;
    }

    /* ── Body ── */
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      background: var(--bg-base);
      color: var(--text-primary);
      min-height: 100vh;
    }

    /* ── Page Shell ── */
    .page-shell {
      display: flex;
      min-height: 100vh;
    }
    .page-main {
      flex: 1;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: 56px;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
      gap: 20px;
    }
    .sidebar-logo {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #3b82f6, #60a5fa);
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(59,130,246,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .sidebar-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
      position: relative;
      text-decoration: none;
    }
    .sidebar-icon:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .sidebar-icon.active {
      background: var(--accent-bg);
      color: var(--accent-light);
    }
    .sidebar-icon:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      left: calc(100% + 8px);
      top: 50%;
      transform: translateY(-50%);
      background: var(--bg-elevated);
      color: var(--text-primary);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      white-space: nowrap;
      pointer-events: none;
      border: 1px solid var(--border);
      z-index: 100;
    }

    /* ── Page Header ── */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .page-header h1 {
      font-size: 20px;
      font-weight: 700;
    }
    .page-header p {
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* ── Stat Cards ── */
    .stat-grid {
      display: flex;
      gap: 12px;
    }
    .stat-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 16px;
      flex: 1;
      min-width: 0;
    }
    .stat-label {
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 26px;
      font-weight: 700;
    }
    .stat-value.up { color: var(--success); }
    .stat-value.down { color: var(--error); }
    .stat-value.neutral { color: var(--text-secondary); }
    .stat-change {
      font-size: 11px;
      margin-top: 4px;
    }
    .stat-change.up { color: var(--success); }
    .stat-change.down { color: var(--error); }

    /* ── Sparkline ── */
    .sparkline {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 22px;
    }
    .sparkline-bar {
      width: 5px;
      border-radius: 2px;
      background: linear-gradient(to top, var(--accent), var(--accent-light));
      transition: height 0.2s;
    }

    /* ── Ring Chart ── */
    .ring-chart {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    /* ── Segmented Bar ── */
    .seg-bar {
      display: flex;
      gap: 4px;
    }
    .seg {
      height: 4px;
      border-radius: 2px;
    }
    .seg-legend {
      display: flex;
      gap: 8px;
      font-size: 9px;
      color: var(--text-muted);
    }

    /* ── Badges ── */
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: var(--radius-badge);
      font-size: 10px;
      font-weight: 600;
    }
    .badge-blue { background: var(--accent-bg); color: var(--accent-light); }
    .badge-green { background: rgba(34,197,94,0.12); color: var(--success); }
    .badge-yellow { background: rgba(234,179,8,0.12); color: var(--warning); }
    .badge-orange { background: rgba(249,115,22,0.12); color: #f97316; }
    .badge-gray { background: rgba(148,163,184,0.1); color: var(--text-muted); }

    /* ── Filter Tabs ── */
    .filter-tabs {
      display: flex;
      gap: 2px;
    }
    .filter-tab {
      padding: 5px 14px;
      border-radius: 7px;
      font-size: 11px;
      color: var(--text-secondary);
      cursor: pointer;
      border: none;
      background: none;
      transition: all 0.15s;
    }
    .filter-tab:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .filter-tab.active {
      background: var(--accent-bg);
      color: var(--accent-light);
    }

    /* ── List Panel ── */
    .list-panel {
      background: var(--bg-surface-alt);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 14px;
      display: flex;
      flex-direction: column;
    }
    .list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .list-cols {
      display: flex;
      padding: 0 12px 6px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
    }
    .list-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    /* ── List Rows ── */
    .list-row {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      gap: 16px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-row);
      transition: all 0.15s;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .list-row:hover {
      background: var(--bg-hover);
      border-color: var(--border);
    }
    .row-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .row-dot.open {
      background: var(--success);
      box-shadow: 0 0 6px rgba(34,197,94,0.4);
    }
    .row-dot.closed {
      background: var(--text-muted);
    }

    /* ── Buttons ── */
    .btn {
      border: none;
      border-radius: var(--radius-btn);
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-primary {
      background: var(--accent-bg);
      color: var(--accent-light);
    }
    .btn-primary:hover {
      background: rgba(59,130,246,0.2);
    }
    .btn-danger {
      background: rgba(239,68,68,0.12);
      color: var(--error);
    }
    .btn-danger:hover {
      background: rgba(239,68,68,0.2);
    }
    .btn-secondary {
      background: var(--bg-hover);
      color: var(--text-secondary);
    }
    .btn-secondary:hover {
      color: var(--text-primary);
    }
    .btn-success {
      background: rgba(34,197,94,0.12);
      color: var(--success);
    }
    .btn-success:hover {
      background: rgba(34,197,94,0.2);
    }

    /* ── Inputs ── */
    .input {
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: var(--radius-btn);
      padding: 6px 12px;
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
      font-family: inherit;
    }
    .input::placeholder {
      color: var(--text-muted);
    }
    .input:focus {
      border-color: var(--accent);
    }
    textarea.input {
      resize: vertical;
      min-height: 60px;
    }

    /* ── Live Feed ── */
    .live-feed {
      background: var(--accent-bg);
      border: 1px solid rgba(59,130,246,0.15);
      border-radius: var(--radius-btn);
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--accent-light);
    }
    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 6px rgba(34,197,94,0.5);
      animation: pulse 2s ease-in-out infinite;
    }

    /* ── Two Column Layout ── */
    .two-col {
      display: flex;
      gap: 16px;
    }
    .col-left { flex: 3; min-width: 0; }
    .col-right { flex: 2; min-width: 0; }

    /* ── Panel ── */
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 16px;
    }
    .panel-title {
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    /* ── Step Progress ── */
    .step-progress {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .step-dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .step-dot.sent {
      background: var(--accent);
      color: #fff;
    }
    .step-dot.pending {
      background: transparent;
      border: 2px solid var(--text-muted);
      color: var(--text-muted);
    }
    .step-dot.failed {
      background: var(--error);
      color: #fff;
    }
    .step-dot.skipped {
      background: rgba(148,163,184,0.15);
      color: var(--text-muted);
    }
    .step-connector {
      width: 16px;
      height: 2px;
      background: var(--text-muted);
      flex-shrink: 0;
    }

    /* ── Event Rows ── */
    .event-row {
      display: flex;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
      align-items: flex-start;
    }
    .event-row:last-child {
      border-bottom: none;
    }
    .event-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 4px;
    }
    .event-text {
      font-size: 12px;
      color: var(--text-secondary);
      flex: 1;
      min-width: 0;
    }
    .event-text strong {
      color: var(--text-primary);
      font-weight: 600;
    }
    .event-text em {
      font-style: normal;
      color: var(--text-muted);
    }
    .event-time {
      color: var(--text-muted);
      font-size: 11px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Search Box ── */
    .search-box {
      background: var(--bg-hover);
      border: 1px solid var(--border);
      border-radius: var(--radius-btn);
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .search-box input {
      background: none;
      border: none;
      outline: none;
      color: var(--text-primary);
      font-size: 12px;
      flex: 1;
      font-family: inherit;
    }
    .search-box input::placeholder {
      color: var(--text-muted);
    }

    /* ── Transitions on interactive elements ── */
    a, button, .btn, .filter-tab, .stat-card, .list-row, .event-row, .badge, .input, .search-box {
      transition: all 0.15s ease;
    }

    /* ── Card hover lift ── */
    .stat-card {
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .stat-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      border-color: var(--border);
    }

    /* ── Scrollbar styling ── */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(148,163,184,0.15);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(148,163,184,0.25);
    }

    /* ── Focus-visible accessibility ring ── */
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .input:focus-visible,
    .btn:focus-visible,
    .filter-tab:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* ── Fade-in animation ── */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .page-main > *:not(.modal-overlay) {
      animation: fadeIn 0.25s ease both;
    }
    .page-main > :nth-child(2) { animation-delay: 0.04s; }
    .page-main > :nth-child(3) { animation-delay: 0.08s; }

    /* ── Improved empty state ── */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
      font-size: 13px;
      border: 1px dashed var(--border);
      border-radius: var(--radius-card);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .empty-state-icon {
      width: 40px;
      height: 40px;
      color: var(--text-muted);
      opacity: 0.5;
    }

    /* ── List row hover accent border ── */
    .list-row {
      border-left: 2px solid transparent;
    }
    .list-row:hover {
      background: var(--bg-hover);
      border-color: var(--border);
      border-left-color: var(--accent);
    }

    /* ── Search box focus glow ── */
    .search-box {
      transition: border-color 0.15s ease, box-shadow 0.15s ease, width 0.2s ease;
    }
    .search-box:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
    }

    /* ── Filter tab bottom indicator ── */
    .filter-tab {
      position: relative;
    }
    .filter-tab::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 50%;
      right: 50%;
      height: 2px;
      background: var(--accent);
      border-radius: 1px;
      transition: left 0.15s ease, right 0.15s ease;
    }
    .filter-tab.active::after {
      left: 4px;
      right: 4px;
    }

    /* ── Modal backdrop + appear ── */
    .modal-overlay {
      backdrop-filter: blur(6px);
    }
    .modal-close-btn {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: none;
      background: var(--bg-hover);
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .modal-close-btn:hover {
      background: rgba(239,68,68,0.15);
      color: var(--error);
    }

    /* ── Copied flash feedback ── */
    @keyframes copiedFlash {
      0% { background: rgba(34,197,94,0.2); }
      100% { background: var(--bg-hover); }
    }
    .copied-flash {
      animation: copiedFlash 0.6s ease;
    }

    /* ── Sequence callout border ── */
    .sequence-callout {
      border-left: 3px solid var(--accent);
    }

    /* ── Activity event left border accent ── */
    .event-row-accent {
      border-left: 3px solid transparent;
      padding-left: 12px;
    }

    /* ── Ghost button (load more) ── */
    .btn-ghost {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius-btn);
      color: var(--text-secondary);
      padding: 10px 32px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-ghost:hover {
      border-color: var(--accent);
      color: var(--accent-light);
      background: var(--accent-bg);
    }

    /* ── Event timeline alternating rows ── */
    .event-row-alt:nth-child(even) {
      background: rgba(148,163,184,0.03);
      border-radius: var(--radius-btn);
    }

    /* ── Keyframes ── */
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.95); }
    }
  `;
}
