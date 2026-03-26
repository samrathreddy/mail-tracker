import { esc, FAVICON, LOGO_SVG } from '../shared.js';

export function renderSequencesPage(sequences) {
  const active = sequences.filter(s => s.status === 'active');
  const stopped = sequences.filter(s => s.status === 'stopped');
  const completed = sequences.filter(s => s.status === 'completed');
  const paused = sequences.filter(s => s.status === 'paused');

  function renderSeqCard(seq) {
    const progress = `${seq.currentStep}/${seq.steps.length}`;
    const nextStep = seq.steps[seq.currentStep];
    const nextSend = nextStep ? new Date(nextStep.scheduledAt).toLocaleString('en-US', { timeZone: seq.timezone }) : 'N/A';
    const statusColors = {
      active: '#22c55e', stopped: '#eab308', completed: '#6366f1', paused: '#f97316',
    };
    const statusColor = statusColors[seq.status] || '#71717a';

    return `
      <div style="background:#27272a;border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:600;color:#e4e4e7;">${esc(seq.recipient)}</span>
          <span style="background:${statusColor}22;color:${statusColor};padding:2px 10px;border-radius:8px;font-size:13px;">${esc(seq.status)}</span>
        </div>
        <div style="color:#a1a1aa;font-size:13px;margin-bottom:4px;">Step ${esc(progress)} ${seq.templateId ? '| Template: ' + esc(seq.templateId) : '| One-off'}</div>
        ${seq.status === 'active' && nextStep ? `<div style="color:#a1a1aa;font-size:13px;">Next send: ${esc(nextSend)}</div>` : ''}
        <div style="color:#71717a;font-size:12px;margin-top:8px;">Created: ${esc(new Date(seq.createdAt).toLocaleString('en-US', { timeZone: seq.timezone }))}</div>
        ${seq.status === 'active' ? `
          <div style="margin-top:10px;display:flex;gap:8px;">
            <button onclick="cancelSeq('${esc(seq.id)}')" style="background:#ef4444;color:white;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Cancel</button>
            <button onclick="skipStepAction('${esc(seq.id)}')" style="background:#3b82f6;color:white;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Skip Step</button>
          </div>
        ` : ''}
        ${seq.stoppedReason ? `<div style="color:#eab308;font-size:12px;margin-top:6px;">Stopped: ${esc(seq.stoppedReason)}</div>` : ''}
      </div>
    `;
  }

  function renderSection(title, seqs) {
    if (seqs.length === 0) return '';
    return `
      <h2 style="color:#e4e4e7;font-size:16px;margin:20px 0 10px;">${esc(title)} (${seqs.length})</h2>
      ${seqs.map(renderSeqCard).join('')}
    `;
  }

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Sequences - Mail Tracker</title>
    <link rel="icon" href="${FAVICON}">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#18181b;color:#e4e4e7;font-family:system-ui,sans-serif;padding:20px;max-width:800px;margin:0 auto}
    a{color:#818cf8;text-decoration:none}a:hover{text-decoration:underline}</style>
  </head><body>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      ${LOGO_SVG}
      <span style="font-size:18px;font-weight:700;">Sequences</span>
      <div style="margin-left:auto;display:flex;gap:12px;">
        <a href="/">Dashboard</a>
        <a href="/templates">Templates</a>
        <a href="/analytics">Analytics</a>
      </div>
    </div>
    ${renderSection('Active', active)}
    ${renderSection('Paused', paused)}
    ${renderSection('Stopped', stopped)}
    ${renderSection('Completed', completed)}
    ${sequences.length === 0 ? '<p style="color:#71717a;text-align:center;margin-top:40px;">No sequences yet. Create one from Gmail or the extension.</p>' : ''}
    <script>
      function cancelSeq(id) { if (confirm('Cancel this sequence?')) fetch('/sequences/' + id, { method: 'DELETE' }).then(() => location.reload()); }
      function skipStepAction(id) { if (confirm('Skip current step?')) fetch('/sequences/' + id + '/skip', { method: 'POST' }).then(() => location.reload()); }
    </script>
  </body></html>`;
}
