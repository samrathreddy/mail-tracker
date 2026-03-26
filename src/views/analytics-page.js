import { esc } from '../shared.js';
import { renderLayout } from './layout.js';
import { renderStatCard } from './components.js';

/**
 * Renders the analytics page using the shared design system.
 *
 * @param {Array} analyticsData - Array of analytics objects (one per template)
 * @param {Array} templates - Array of template objects with id and name
 * @param {boolean} oauthConnected - Whether Gmail OAuth is connected
 * @returns {string} Complete HTML page
 */
export function renderAnalyticsPage(analyticsData, templates, oauthConnected) {
  // Build template name lookup map
  const templateNames = {};
  for (let i = 0; i < templates.length; i++) {
    templateNames[templates[i].id] = templates[i].name;
  }

  let bodyHtml;

  if (analyticsData.length === 0) {
    bodyHtml = `
      <div style="padding:0 32px 32px;">
        <p style="color:var(--text-muted);text-align:center;margin-top:60px;font-size:14px;">
          No analytics data yet
        </p>
      </div>`;
  } else {
    const cards = analyticsData.map((analytics) => {
      const name = templateNames[analytics.templateId] || analytics.templateId;
      const maxSent = Math.max(
        ...analytics.steps.map((s) => s.sent),
        1,
      );

      // Funnel bar chart
      const funnelHtml = analytics.steps
        .map((s, i) => {
          const widthPct = Math.max((s.sent / maxSent) * 100, 5);
          return `<div style="display:flex;align-items:center;gap:10px;margin:4px 0;">
          <span style="color:var(--text-secondary);font-size:12px;width:50px;flex-shrink:0;">Step ${i + 1}</span>
          <div style="background:linear-gradient(90deg,rgba(59,130,246,0.25),rgba(96,165,250,0.15));border-radius:4px;height:24px;width:${widthPct}%;display:flex;align-items:center;padding:0 8px;">
            <span style="color:var(--accent-light);font-size:12px;">${esc(String(s.sent))} sent</span>
          </div>
        </div>`;
        })
        .join('');

      // Stats table rows
      const tableRows = analytics.steps
        .map((s, i) => {
          const openRate = (s.openRate * 100).toFixed(0);
          const replyRate = (s.replyRate * 100).toFixed(0);
          return `<tr style="border-bottom:1px solid var(--border-subtle);">
          <td style="padding:8px 12px;color:var(--text-primary);font-size:13px;">Step ${i + 1}</td>
          <td style="padding:8px 12px;text-align:center;color:var(--text-primary);font-size:13px;">${esc(String(s.sent))}</td>
          <td style="padding:8px 12px;text-align:center;color:var(--text-primary);font-size:13px;">${esc(String(s.opened))}</td>
          <td style="padding:8px 12px;text-align:center;color:var(--text-primary);font-size:13px;">${esc(openRate)}%</td>
          <td style="padding:8px 12px;text-align:center;color:var(--text-primary);font-size:13px;">${esc(String(s.replied))}</td>
          <td style="padding:8px 12px;text-align:center;color:var(--text-primary);font-size:13px;">${esc(replyRate)}%</td>
        </tr>`;
        })
        .join('');

      return `<div class="panel" style="margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:14px;">${esc(name)}</h3>
        <div class="stat-grid" style="margin-bottom:16px;">
          ${renderStatCard({ label: 'Total Sequences', value: String(analytics.totalSequences) })}
          ${renderStatCard({ label: 'Completed', value: String(analytics.completedSequences) })}
          ${renderStatCard({ label: 'Stopped', value: String(analytics.stoppedSequences) })}
        </div>
        <div style="margin-bottom:16px;">${funnelHtml}</div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);">
              <th style="padding:8px 12px;text-align:left;color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Step</th>
              <th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Sent</th>
              <th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Opened</th>
              <th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Open Rate</th>
              <th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Replied</th>
              <th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Reply Rate</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
    });

    bodyHtml = `<div style="padding:0 32px 32px;">${cards.join('')}</div>`;
  }

  return renderLayout({
    title: 'Analytics',
    subtitle: 'Sequence performance',
    activePage: 'analytics',
    bodyHtml,
    oauthConnected,
  });
}
