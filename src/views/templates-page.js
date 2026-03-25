import { esc, FAVICON, LOGO_SVG } from '../shared.js';

export function renderTemplatesPage(templates) {
  function renderTemplateCard(tmpl) {
    const stepsSummary = tmpl.steps.map((s, i) => {
      const truncSubject = s.subject.length > 50 ? s.subject.substring(0, 50) + '...' : s.subject;
      return `Step ${i + 1}: Day ${s.delayDays} - ${esc(truncSubject)}`;
    }).join('<br>');

    return `
      <div style="background:#27272a;border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:600;color:#e4e4e7;font-size:15px;">${esc(tmpl.name)}</span>
          <span style="color:#a1a1aa;font-size:13px;">${tmpl.steps.length} step${tmpl.steps.length > 1 ? 's' : ''} | ${esc(tmpl.timezone)}</span>
        </div>
        <div style="color:#a1a1aa;font-size:13px;line-height:1.6;">${stepsSummary}</div>
        <div style="margin-top:10px;">
          <button onclick="deleteTmpl('${esc(tmpl.id)}')" style="background:#ef4444;color:white;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Delete</button>
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Templates - Mail Tracker</title>
    <link rel="icon" href="${FAVICON}">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#18181b;color:#e4e4e7;font-family:system-ui,sans-serif;padding:20px;max-width:800px;margin:0 auto}
    a{color:#818cf8;text-decoration:none}a:hover{text-decoration:underline}
    input,select,textarea{background:#3f3f46;color:#e4e4e7;border:1px solid #52525b;border-radius:8px;padding:8px 12px;font-size:14px;width:100%}
    textarea{resize:vertical;min-height:80px}</style>
  </head><body>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      ${LOGO_SVG}
      <span style="font-size:18px;font-weight:700;">Templates</span>
      <div style="margin-left:auto;display:flex;gap:12px;">
        <a href="/">Dashboard</a>
        <a href="/sequences">Sequences</a>
        <a href="/analytics">Analytics</a>
      </div>
    </div>

    <button id="create-btn" onclick="toggleForm()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;font-size:14px;margin-bottom:20px;">+ New Template</button>

    <div id="create-form" style="display:none;background:#27272a;border-radius:12px;padding:20px;margin-bottom:20px;">
      <div style="margin-bottom:12px;"><label style="font-size:13px;color:#a1a1aa;">Name</label><input id="tmpl-name" placeholder="e.g. Sales Follow-up"></div>
      <div style="margin-bottom:12px;"><label style="font-size:13px;color:#a1a1aa;">Timezone</label><input id="tmpl-tz" placeholder="America/New_York"></div>
      <div id="steps-container"></div>
      <button onclick="addStep()" style="background:#3f3f46;color:#e4e4e7;border:1px solid #52525b;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;margin:10px 0;">+ Add Step</button>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button onclick="saveTemplate()" style="background:#22c55e;color:white;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;">Save</button>
        <button onclick="toggleForm()" style="background:#3f3f46;color:#e4e4e7;border:1px solid #52525b;padding:10px 20px;border-radius:10px;cursor:pointer;">Cancel</button>
      </div>
    </div>

    <div id="templates-list">
      ${templates.map(renderTemplateCard).join('')}
      ${templates.length === 0 ? '<p style="color:#71717a;text-align:center;margin-top:40px;">No templates yet. Create one above.</p>' : ''}
    </div>

    <script>
      var stepCount = 0;
      function toggleForm() {
        var form = document.getElementById('create-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        if (form.style.display === 'block' && stepCount === 0) addStep();
      }
      function addStep() {
        stepCount++;
        var container = document.getElementById('steps-container');
        var div = document.createElement('div');
        div.style.cssText = 'background:#3f3f46;border-radius:8px;padding:12px;margin-bottom:8px;';
        var label = document.createElement('div');
        label.style.cssText = 'font-size:13px;color:#a1a1aa;margin-bottom:8px;';
        label.textContent = 'Step ' + stepCount;
        div.appendChild(label);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';

        var delayWrap = document.createElement('div');
        delayWrap.style.flex = '1';
        var delayLabel = document.createElement('label');
        delayLabel.style.cssText = 'font-size:12px;color:#71717a;';
        delayLabel.textContent = 'Delay (days)';
        var delayInput = document.createElement('input');
        delayInput.type = 'number';
        delayInput.className = 'step-delay';
        delayInput.min = '1';
        delayInput.max = '90';
        delayInput.value = stepCount === 1 ? '2' : String(stepCount * 3);
        delayWrap.appendChild(delayLabel);
        delayWrap.appendChild(delayInput);

        var subjectWrap = document.createElement('div');
        subjectWrap.style.flex = '3';
        var subjectLabel = document.createElement('label');
        subjectLabel.style.cssText = 'font-size:12px;color:#71717a;';
        subjectLabel.textContent = 'Subject';
        var subjectInput = document.createElement('input');
        subjectInput.className = 'step-subject';
        subjectInput.placeholder = 'Re: {{subject}}';
        subjectWrap.appendChild(subjectLabel);
        subjectWrap.appendChild(subjectInput);

        row.appendChild(delayWrap);
        row.appendChild(subjectWrap);
        div.appendChild(row);

        var bodyLabel = document.createElement('label');
        bodyLabel.style.cssText = 'font-size:12px;color:#71717a;';
        bodyLabel.textContent = 'Body (HTML)';
        var bodyInput = document.createElement('textarea');
        bodyInput.className = 'step-body';
        bodyInput.placeholder = '<p>Hi {{firstName}},</p>';
        div.appendChild(bodyLabel);
        div.appendChild(bodyInput);

        var stopDiv = document.createElement('div');
        stopDiv.style.cssText = 'margin-top:8px;';
        var stopLabel = document.createElement('span');
        stopLabel.style.cssText = 'font-size:12px;color:#71717a;';
        stopLabel.textContent = 'Stop on: ';
        stopDiv.appendChild(stopLabel);

        var openCheck = document.createElement('input');
        openCheck.type = 'checkbox';
        openCheck.className = 'stop-open';
        var openLabel = document.createElement('label');
        openLabel.style.cssText = 'font-size:13px;margin-right:8px;';
        openLabel.appendChild(openCheck);
        openLabel.appendChild(document.createTextNode(' Open'));
        stopDiv.appendChild(openLabel);

        var replyCheck = document.createElement('input');
        replyCheck.type = 'checkbox';
        replyCheck.className = 'stop-reply';
        replyCheck.checked = true;
        var replyLabel = document.createElement('label');
        replyLabel.style.cssText = 'font-size:13px;';
        replyLabel.appendChild(replyCheck);
        replyLabel.appendChild(document.createTextNode(' Reply'));
        stopDiv.appendChild(replyLabel);

        div.appendChild(stopDiv);
        container.appendChild(div);
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
        if (confirm('Delete this template?')) fetch('/templates/' + id, { method: 'DELETE' }).then(function() { location.reload(); });
      }
    </script>
  </body></html>`;
}
