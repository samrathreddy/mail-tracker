import { esc, FAVICON, LOGO_SVG } from '../shared.js';

export function renderAnalyticsPage(analyticsData, templates) {
  var templateNames = {};
  for (var i = 0; i < templates.length; i++) {
    templateNames[templates[i].id] = templates[i].name;
  }

  function renderAnalyticsCard(analytics) {
    var name = templateNames[analytics.templateId] || analytics.templateId;

    var stepsHtml = analytics.steps.map(function(s, i) {
      return '<tr>' +
        '<td style="padding:6px 12px;">Step ' + (i + 1) + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + s.sent + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + s.opened + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + (s.openRate * 100).toFixed(0) + '%</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + s.replied + '</td>' +
        '<td style="padding:6px 12px;text-align:center;">' + (s.replyRate * 100).toFixed(0) + '%</td>' +
        '</tr>';
    }).join('');

    var maxSent = Math.max.apply(null, analytics.steps.map(function(s) { return s.sent; }).concat([1]));
    var funnelHtml = analytics.steps.map(function(s, i) {
      var width = Math.max((s.sent / maxSent) * 100, 5);
      return '<div style="display:flex;align-items:center;gap:10px;margin:4px 0;">' +
        '<span style="color:#a1a1aa;font-size:12px;width:50px;">Step ' + (i + 1) + '</span>' +
        '<div style="background:#6366f133;border-radius:4px;height:24px;width:' + width + '%;display:flex;align-items:center;padding:0 8px;">' +
        '<span style="color:#a5b4fc;font-size:12px;">' + s.sent + ' sent</span>' +
        '</div></div>';
    }).join('');

    return `
      <div style="background:#27272a;border-radius:12px;padding:20px;margin-bottom:16px;">
        <h3 style="color:#e4e4e7;font-size:16px;margin-bottom:12px;">${esc(name)}</h3>
        <div style="display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap;">
          <div style="background:#3f3f46;border-radius:8px;padding:10px 16px;"><div style="color:#71717a;font-size:12px;">Total</div><div style="color:#e4e4e7;font-size:20px;font-weight:600;">${analytics.totalSequences}</div></div>
          <div style="background:#3f3f46;border-radius:8px;padding:10px 16px;"><div style="color:#71717a;font-size:12px;">Completed</div><div style="color:#22c55e;font-size:20px;font-weight:600;">${analytics.completedSequences}</div></div>
          <div style="background:#3f3f46;border-radius:8px;padding:10px 16px;"><div style="color:#71717a;font-size:12px;">Stopped</div><div style="color:#eab308;font-size:20px;font-weight:600;">${analytics.stoppedSequences}</div></div>
        </div>
        <div style="margin-bottom:16px;">${funnelHtml}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="color:#71717a;border-bottom:1px solid #3f3f46;">
            <th style="padding:6px 12px;text-align:left;">Step</th>
            <th style="padding:6px 12px;">Sent</th>
            <th style="padding:6px 12px;">Opened</th>
            <th style="padding:6px 12px;">Open Rate</th>
            <th style="padding:6px 12px;">Replied</th>
            <th style="padding:6px 12px;">Reply Rate</th>
          </tr></thead>
          <tbody style="color:#e4e4e7;">${stepsHtml}</tbody>
        </table>
      </div>
    `;
  }

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Analytics - Mail Tracker</title>
    <link rel="icon" href="${FAVICON}">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#18181b;color:#e4e4e7;font-family:system-ui,sans-serif;padding:20px;max-width:900px;margin:0 auto}
    a{color:#818cf8;text-decoration:none}a:hover{text-decoration:underline}</style>
  </head><body>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      ${LOGO_SVG}
      <span style="font-size:18px;font-weight:700;">Sequence Analytics</span>
      <div style="margin-left:auto;display:flex;gap:12px;">
        <a href="/">Dashboard</a>
        <a href="/sequences">Sequences</a>
        <a href="/templates">Templates</a>
      </div>
    </div>
    ${analyticsData.map(renderAnalyticsCard).join('')}
    ${analyticsData.length === 0 ? '<p style="color:#71717a;text-align:center;margin-top:40px;">No analytics data yet. Analytics appear after sequences start sending.</p>' : ''}
  </body></html>`;
}
