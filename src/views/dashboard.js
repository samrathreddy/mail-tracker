import { FAVICON, LOGO_SVG } from '../shared.js';

export function renderDashboard(results, totalOpens, activeCount) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mail Tracker</title>
<link rel="icon" href="${FAVICON}">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #09090b; --surface: #18181b; --surface-2: #1f1f23;
    --border: #27272a; --border-hover: #3f3f46;
    --text: #fafafa; --text-2: #a1a1aa; --text-3: #71717a;
    --accent: #6366f1; --green: #34d399; --green-dim: rgba(52,211,153,0.12);
    --amber: #fbbf24; --amber-dim: rgba(251,191,36,0.12);
    --blue: #60a5fa; --blue-dim: rgba(96,165,250,0.12);
    --radius: 12px; --radius-sm: 8px;
  }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .top-bar { position: sticky; top: 0; z-index: 50; background: rgba(9,9,11,0.8); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); padding: 0 24px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
  .top-bar .brand { font-weight: 700; font-size: 0.95rem; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
  .new-btn { padding: 7px 16px; border-radius: 8px; border: none; background: var(--accent); color: white; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
  .new-btn:hover { background: #818cf8; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
  .container { max-width: 960px; margin: 0 auto; padding: 28px 24px 64px; }
  .summary { display: flex; gap: 24px; margin-bottom: 28px; flex-wrap: wrap; }
  .summary-item { display: flex; align-items: baseline; gap: 8px; }
  .summary-val { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  .summary-val.green { color: var(--green); } .summary-val.blue { color: var(--blue); } .summary-val.amber { color: var(--amber); }
  .summary-label { font-size: 0.8rem; color: var(--text-3); }
  .search-bar { width: 100%; padding: 10px 16px; margin-bottom: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); font-size: 0.875rem; outline: none; transition: border-color 0.15s; }
  .search-bar::placeholder { color: var(--text-3); } .search-bar:focus { border-color: var(--accent); }
  .card-list { display: flex; flex-direction: column; gap: 8px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; text-decoration: none; color: inherit; transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s; cursor: pointer; }
  .card:hover { border-color: var(--border-hover); transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
  .card-left { min-width: 0; }
  .card-subject { font-weight: 600; font-size: 0.95rem; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-meta { display: flex; gap: 12px; flex-wrap: wrap; }
  .card-meta span { font-size: 0.75rem; color: var(--text-3); display: flex; align-items: center; gap: 4px; }
  .card-preview { font-size: 0.8rem; color: var(--text-3); margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-right { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  .open-count { text-align: center; } .open-count .num { font-size: 1.25rem; font-weight: 700; color: var(--green); }
  .open-count .label { font-size: 0.65rem; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; }
  .open-count.zero .num { color: var(--text-3); }
  .card-arrow { color: var(--text-3); transition: color 0.15s, transform 0.15s; }
  .card:hover .card-arrow { color: var(--accent); transform: translateX(2px); }
  .badge-sm { padding: 2px 8px; border-radius: 999px; font-size: 0.65rem; font-weight: 600; }
  .badge-opened { background: var(--green-dim); color: var(--green); } .badge-pending { background: var(--amber-dim); color: var(--amber); }
  .empty-state { text-align: center; padding: 64px 20px; color: var(--text-3); }
  .empty-state p { font-size: 0.95rem; margin-bottom: 8px; } .empty-state .sub { font-size: 0.8rem; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
  .modal-overlay.open { opacity: 1; pointer-events: auto; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px; width: 90%; max-width: 440px; transform: translateY(8px); transition: transform 0.2s; }
  .modal-overlay.open .modal { transform: translateY(0); }
  .modal h2 { font-size: 1.1rem; margin-bottom: 20px; font-weight: 700; }
  .modal label { display: block; font-size: 0.8rem; color: var(--text-2); margin-bottom: 6px; font-weight: 500; }
  .modal input { width: 100%; padding: 10px 14px; margin-bottom: 16px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.875rem; outline: none; }
  .modal input:focus { border-color: var(--accent); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .btn-cancel { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text-2); font-size: 0.8rem; cursor: pointer; transition: all 0.15s; }
  .btn-cancel:hover { border-color: var(--border-hover); color: var(--text); }
  .btn-create { padding: 8px 20px; border-radius: 8px; border: none; background: var(--accent); color: white; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .btn-create:hover { background: #818cf8; }
  .result-box { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-top: 16px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75rem; color: var(--text-2); word-break: break-all; user-select: all; }
  .result-label { font-size: 0.7rem; color: var(--text-3); margin-bottom: 4px; font-family: 'Inter', system-ui; }
</style></head>
<body>
  <div class="top-bar">
    <div class="brand">${LOGO_SVG} Mail Tracker</div>
    <button class="new-btn" id="newBtn">+ New Tracker</button>
  </div>
  <div class="container">
    <div class="summary">
      <div class="summary-item"><span class="summary-val blue" id="totalTrackers"></span><span class="summary-label">trackers</span></div>
      <div class="summary-item"><span class="summary-val green" id="totalOpens"></span><span class="summary-label">total opens</span></div>
      <div class="summary-item"><span class="summary-val amber" id="activeCount"></span><span class="summary-label">opened</span></div>
    </div>
    <input type="text" class="search-bar" id="searchInput" placeholder="Search by email, subject, or preview...">
    <div class="card-list" id="cardList"></div>
    <div class="empty-state" id="emptyState" style="display:none"><p>No tracked emails yet</p><span class="sub">Click "+ New Tracker" to create your first pixel</span></div>
    <div class="empty-state" id="noResults" style="display:none"><p>No results found</p></div>
  </div>
  <div class="modal-overlay" id="modalOverlay">
    <div class="modal">
      <h2>Create New Tracker</h2>
      <div id="modalForm">
        <label>Recipient Email (optional)</label><input type="email" id="inputTo" placeholder="recipient@example.com">
        <label>Subject (optional)</label><input type="text" id="inputSubject" placeholder="Email subject line">
        <div class="modal-actions"><button class="btn-cancel" id="cancelBtn">Cancel</button><button class="btn-create" id="createBtn">Create Tracker</button></div>
      </div>
      <div id="modalResult" style="display:none">
        <div><div class="result-label">Pixel HTML (copy into your email)</div><div class="result-box" id="resultHtml"></div></div>
        <div style="margin-top:12px"><div class="result-label">Stats URL</div><div class="result-box" id="resultStats"></div></div>
        <div class="modal-actions" style="margin-top:20px"><button class="btn-cancel" id="closeResult">Close</button><button class="btn-create" id="copyHtmlBtn">Copy Pixel HTML</button></div>
      </div>
    </div>
  </div>
  <script>
    var DATA = ${JSON.stringify(results)};
    var TOTAL_OPENS = ${JSON.stringify(totalOpens)};
    var ACTIVE_COUNT = ${JSON.stringify(activeCount)};
    document.getElementById('totalTrackers').textContent = DATA.length;
    document.getElementById('totalOpens').textContent = TOTAL_OPENS;
    document.getElementById('activeCount').textContent = ACTIVE_COUNT;

    function formatTime(iso) { return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric' }); }
    function relativeTime(iso) { var diff = Date.now() - new Date(iso).getTime(); var mins = Math.floor(diff / 60000); if (mins < 1) return 'just now'; if (mins < 60) return mins + 'm ago'; var hrs = Math.floor(mins / 60); if (hrs < 24) return hrs + 'h ago'; var days = Math.floor(hrs / 24); if (days < 30) return days + 'd ago'; return formatTime(iso); }

    var cardList = document.getElementById('cardList');
    var emptyState = document.getElementById('emptyState');
    var noResults = document.getElementById('noResults');

    function renderCards(items) {
      cardList.textContent = '';
      if (DATA.length === 0) { emptyState.style.display = ''; return; }
      emptyState.style.display = 'none';
      if (items.length === 0) { noResults.style.display = ''; return; }
      noResults.style.display = 'none';
      items.forEach(function(r) {
        var card = document.createElement('a'); card.href = '/s/' + r.id; card.className = 'card';
        var left = document.createElement('div'); left.className = 'card-left';
        var subj = document.createElement('div'); subj.className = 'card-subject'; subj.textContent = r.subject || r.email || 'Untitled'; left.appendChild(subj);
        var meta = document.createElement('div'); meta.className = 'card-meta';
        if (r.email && r.subject) { var es = document.createElement('span'); es.textContent = r.email; meta.appendChild(es); }
        var cs = document.createElement('span'); cs.textContent = r.createdAt ? relativeTime(r.createdAt) : 'unknown'; meta.appendChild(cs);
        if (r.lastOpen !== 'never') { var lo = document.createElement('span'); lo.textContent = 'Last open: ' + relativeTime(r.lastOpen); meta.appendChild(lo); }
        var bs = document.createElement('span'); bs.className = 'badge-sm ' + (r.opens > 0 ? 'badge-opened' : 'badge-pending'); bs.textContent = r.opens > 0 ? 'opened' : 'pending'; meta.appendChild(bs);
        left.appendChild(meta);
        if (r.bodyPreview) { var pv = document.createElement('div'); pv.className = 'card-preview'; pv.textContent = r.bodyPreview; left.appendChild(pv); }
        var right = document.createElement('div'); right.className = 'card-right';
        var cd = document.createElement('div'); cd.className = 'open-count' + (r.opens === 0 ? ' zero' : '');
        var nd = document.createElement('div'); nd.className = 'num'; nd.textContent = r.opens;
        var ld = document.createElement('div'); ld.className = 'label'; ld.textContent = r.opens === 1 ? 'open' : 'opens';
        cd.appendChild(nd); cd.appendChild(ld); right.appendChild(cd);
        var arrow = document.createElement('div'); arrow.className = 'card-arrow'; arrow.textContent = '\\u203A'; arrow.style.fontSize = '1.5rem'; right.appendChild(arrow);
        card.appendChild(left); card.appendChild(right); cardList.appendChild(card);
      });
    }
    renderCards(DATA);

    document.getElementById('searchInput').addEventListener('input', function(e) {
      var q = e.target.value.toLowerCase(); if (!q) { renderCards(DATA); return; }
      renderCards(DATA.filter(function(r) { return (r.email || '').toLowerCase().indexOf(q) !== -1 || (r.subject || '').toLowerCase().indexOf(q) !== -1 || (r.bodyPreview || '').toLowerCase().indexOf(q) !== -1; }));
    });

    var overlay = document.getElementById('modalOverlay');
    var modalForm = document.getElementById('modalForm');
    var modalResult = document.getElementById('modalResult');
    document.getElementById('newBtn').addEventListener('click', function() { modalForm.style.display = ''; modalResult.style.display = 'none'; document.getElementById('inputTo').value = ''; document.getElementById('inputSubject').value = ''; overlay.classList.add('open'); });
    document.getElementById('cancelBtn').addEventListener('click', function() { overlay.classList.remove('open'); });
    document.getElementById('closeResult').addEventListener('click', function() { overlay.classList.remove('open'); location.reload(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.classList.remove('open'); });

    var createdPixelHtml = '';
    document.getElementById('createBtn').addEventListener('click', function() {
      var body = {}; var to = document.getElementById('inputTo').value; var subject = document.getElementById('inputSubject').value;
      if (to) body.to = to; if (subject) body.subject = subject;
      fetch('/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(r) { return r.json(); })
      .then(function(data) { createdPixelHtml = data.html; document.getElementById('resultHtml').textContent = data.html; document.getElementById('resultStats').textContent = data.stats; modalForm.style.display = 'none'; modalResult.style.display = ''; });
    });
    document.getElementById('copyHtmlBtn').addEventListener('click', function() { navigator.clipboard.writeText(createdPixelHtml).then(function() { var btn = document.getElementById('copyHtmlBtn'); btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy Pixel HTML'; }, 1500); }); });
  </script>
</body></html>`;
}
