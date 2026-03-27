# Sequence Experience Implementation Plan (Sub-project 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a visual timeline canvas editor for sequence templates, add rich body editing with formatting toolbar and variable insertion, inline email preview, enhanced analytics with time-series charts and template comparison, and upgrade the Gmail extension's one-off builder and sequence selector.

**Architecture:** A new `template-editor.js` view module provides the canvas editor page, used by two new HTML routes (`/templates/new`, `/templates/:id/edit`). The existing templates list page is updated to link to the editor instead of using an inline form. Analytics gets daily bucketed data from the cron handler and client-side SVG charts. The extension's sequence selector becomes a compact icon button and the one-off builder gets variable pills, mini toolbar, and preview.

**Tech Stack:** Cloudflare Workers (V8), vanilla JS, server-rendered HTML with embedded client-side JS, contenteditable for body editing, SVG for charts, no libraries

**Spec:** `docs/superpowers/specs/2026-03-25-sequence-experience-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/views/template-editor.js` | Canvas editor page — timeline, step editor, toolbar, preview |

### Existing files to modify

| File | Changes |
|------|---------|
| `src/index.js` | Add `/templates/new` and `/templates/:id/edit` routes, update analytics route to fetch daily data |
| `src/views/templates-page.js` | Remove inline form, add Edit/Duplicate/Delete actions, mini timeline viz, link to canvas |
| `src/views/analytics-page.js` | Add time-series SVG charts, template comparison view |
| `src/cron.js` | Add daily bucketing to `updateAnalytics` |
| `extension/gmail.js` | Compact selector button, upgraded one-off builder |

---

## Task 1: Canvas Editor Page — Template Editor View

**Files:**
- Create: `src/views/template-editor.js`
- Modify: `src/index.js` (add routes)

This is the largest task — the centerpiece of the sub-project. The canvas editor is a single page with rich client-side interactivity.

- [ ] **Step 1: Create `src/views/template-editor.js`**

Create the file exporting `renderTemplateEditor(template, oauthConnected)` where `template` is null (new) or the existing template object.

The function builds three sections and wraps them in `renderLayout()`:

**Top bar HTML (server-rendered):**
- Editable template name input (value = template.name or empty, placeholder "Untitled sequence")
- Step count badge (computed client-side)
- Timezone selector (select element with common timezones, default to template.timezone or browser's timezone)
- Save button (`.btn.btn-success`) and Cancel button (`.btn.btn-secondary`, links to `/templates`)

**Left panel HTML (server-rendered container, populated client-side):**
- `#timeline-panel` div (220px width, fixed, bg-sidebar, left border)
- "SEQUENCE TIMELINE" label
- `#timeline-nodes` container (populated by JS)
- "Add step" button at bottom

**Right panel HTML (server-rendered container, populated client-side):**
- `#editor-panel` div (flex:1, padding, scrollable)
- Populated when a step is selected

**Client-side JS (the bulk of the code):**

State management:
```javascript
var template = ${safeJson(template)}; // null or existing
var steps = template ? template.steps.map(function(s, i) {
  return { id: i, delayDays: s.delayDays, subject: s.subject, body: s.body, stopOn: s.stopOn || [] };
}) : [];
var selectedStep = 0;
var stepIdCounter = steps.length;
```

Timeline rendering function `renderTimeline()`:
- Clears `#timeline-nodes`
- Renders origin node (gray circle + envelope icon + "Original email" + "Day 0")
- For each step: vertical connector line + step node (circle with number, label, delay info)
- Selected step gets filled blue circle with box-shadow; others get outlined
- Each step node has click handler to select it
- Up/down arrows on hover (swap steps in array, re-render)
- "Add step" dashed circle at bottom

Step editor rendering function `renderEditor()`:
- If no steps exist, show empty state "Add a step to get started"
- Otherwise, render the selected step's editor:
  - Header: step number circle + "Follow-up #N" + "Remove step" link
  - Delay: number input (value = step.delayDays)
  - Stop conditions: two checkboxes (reply, open) with checked states
  - Subject: text input (value = step.subject, placeholder "Re: {{subject}}")
  - Variable insert button next to subject
  - Body: formatting toolbar + contenteditable div
  - Preview toggle button + preview panel (hidden by default)

Formatting toolbar handlers:
- Bold: `document.execCommand('bold')`
- Italic: `document.execCommand('italic')`
- Link: prompt for URL, `document.execCommand('createLink', false, url)`
- List: `document.execCommand('insertUnorderedList')`
- All buttons use DOM creation (createElement, addEventListener)

Variable insertion:
- Dropdown with 6 variables (firstName, recipient, subject, originalBody, daysSince, stepNumber)
- On click: insert `{{varName}}` at cursor in subject input or body contenteditable
- For contenteditable: use `document.execCommand('insertHTML', false, '<span style="...">{{varName}}</span>')` to render as blue pill
- For subject input: insert text at cursor position via selectionStart/selectionEnd

Preview toggle:
- Button toggles `#preview-panel` visibility
- Preview content built by substituting variables with sample data in the body HTML
- Sample data: firstName="Alice", recipient="alice@acme.com", subject=template name or "Your email", daysSince="3", stepNumber=current step number
- Updates on toggle (not live — re-renders when toggled on)

Save handler:
- Collect: name from input, timezone from select, steps array (each step's delayDays, subject from input value, body from contenteditable innerHTML, stopOn from checkboxes)
- If template exists (editing): `PUT /templates/${template.id}`
- If new: `POST /templates`
- On success: redirect to `/templates`
- On error: show alert with error message

Cancel: navigate to `/templates`

Add step handler:
- Push new step: `{ id: stepIdCounter++, delayDays: (last step delay + 3) || 2, subject: '', body: '', stopOn: ['reply'] }`
- Select the new step
- Re-render timeline and editor

Remove step handler:
- Remove step from array
- Select adjacent step (or none if empty)
- Re-render

Reorder (up/down):
- Swap step with neighbor in array
- Re-render timeline, keep same step selected

**Editor-specific CSS (embedded in the page):**
Additional styles for the canvas that aren't in the shared design system:
```css
.editor-topbar { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid var(--border); }
.editor-body { flex:1; display:flex; overflow:hidden; }
.timeline-panel { width:220px; background:var(--bg-sidebar); border-right:1px solid var(--border); padding:24px 16px; display:flex; flex-direction:column; overflow-y:auto; }
.timeline-node { display:flex; align-items:center; gap:10px; cursor:pointer; margin-bottom:4px; }
.timeline-connector { width:2px; height:24px; background:rgba(59,130,246,0.3); margin-left:13px; }
.timeline-circle { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:12px; font-weight:700; }
.timeline-circle.selected { background:var(--accent); color:white; box-shadow:0 0 12px rgba(59,130,246,0.4); }
.timeline-circle.unselected { background:var(--bg-surface); border:2px solid var(--accent-light); color:var(--accent-light); }
.timeline-circle.origin { background:var(--bg-hover); color:var(--text-secondary); }
.timeline-circle.add { border:2px dashed rgba(148,163,184,0.2); background:none; color:var(--text-muted); font-size:16px; }
.editor-panel { flex:1; padding:24px; overflow-y:auto; }
.editor-toolbar { background:var(--bg-surface); border:1px solid var(--border); border-radius:8px 8px 0 0; padding:6px 10px; display:flex; gap:2px; align-items:center; }
.editor-toolbar button { background:none; border:none; color:var(--text-secondary); padding:4px 8px; border-radius:4px; cursor:pointer; font-size:13px; }
.editor-toolbar button:hover { background:var(--bg-hover); }
.editor-area { background:var(--bg-hover); border:1px solid var(--border); border-top:none; border-radius:0 0 8px 8px; padding:12px; min-height:120px; color:var(--text-primary); font-size:13px; line-height:1.6; outline:none; }
.var-pill { background:rgba(59,130,246,0.15); color:var(--accent-light); padding:1px 4px; border-radius:3px; }
.var-dropdown { position:absolute; background:var(--bg-elevated); border:1px solid var(--border); border-radius:8px; padding:4px 0; min-width:180px; z-index:100; box-shadow:0 4px 16px rgba(0,0,0,0.3); }
.var-dropdown-item { padding:6px 12px; cursor:pointer; font-size:12px; color:var(--text-primary); }
.var-dropdown-item:hover { background:var(--bg-hover); }
.preview-panel { background:var(--bg-surface); border:1px solid rgba(59,130,246,0.15); border-radius:8px; padding:16px; margin-top:12px; }
.preview-email { background:var(--bg-hover); border-radius:6px; padding:12px; font-size:13px; color:var(--text-primary); line-height:1.6; }
.reorder-arrows { display:none; flex-direction:column; gap:2px; margin-left:auto; }
.timeline-node:hover .reorder-arrows { display:flex; }
.reorder-arrow { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px; padding:0 4px; }
.reorder-arrow:hover { color:var(--text-primary); }
```

- [ ] **Step 2: Add routes in `src/index.js`**

Add import at top: `import { renderTemplateEditor } from './views/template-editor.js';`

Add two HTML routes BEFORE the existing `/templates` HTML route (so they match first):

```javascript
    // GET /templates/new — canvas editor, new template
    if (url.pathname === '/templates/new' && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;
      return html(renderTemplateEditor(null, oauthConnected));
    }

    // GET /templates/:id/edit — canvas editor, existing template
    if (url.pathname.match(/^\/templates\/tmpl:[a-f0-9]+\/edit$/) && request.method === 'GET') {
      if (!checkAuth(request, env)) return requireAuth();
      const id = url.pathname.match(/^\/templates\/(tmpl:[a-f0-9]+)\/edit$/)[1];
      const template = await getTemplate(env, id);
      if (!template) return new Response('Template not found', { status: 404 });
      const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;
      return html(renderTemplateEditor(template, oauthConnected));
    }
```

- [ ] **Step 3: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 4: Commit**

```bash
git add src/views/template-editor.js src/index.js
git commit -m "feat: add sequence canvas editor with timeline, toolbar, and preview"
```

---

## Task 2: Templates Page Overhaul

**Files:**
- Modify: `src/views/templates-page.js`

- [ ] **Step 1: Rewrite `src/views/templates-page.js`**

Remove the inline create form entirely. Update the page to:

1. Header action: "+ New Template" button navigates to `/templates/new` (not toggle form)
2. Template rows enhanced:
   - Name (bold) + step count + timezone
   - Mini timeline: small 8px circles connected by thin lines showing step numbers
   - Three buttons: Edit (navigates to `/templates/:id/edit`), Duplicate, Delete
3. Duplicate handler: client-side JS that POSTs to `/templates` with the template's data (name + " (copy)", same steps/timezone), then redirects to the new template's edit page
4. Delete handler: confirmation then DELETE to `/templates/:id`, reload page
5. No more toggleForm, addStep, saveTemplate client-side functions — all removed

The mini timeline for each template row:
```javascript
// Build inline for each template
const miniTimeline = tmpl.steps.map((s, i) => {
  return '<span style="display:inline-flex;align-items:center;">' +
    (i > 0 ? '<span style="width:12px;height:1px;background:var(--accent);display:inline-block;"></span>' : '') +
    '<span style="width:8px;height:8px;background:var(--accent);border-radius:50%;display:inline-block;"></span>' +
    '</span>';
}).join('');
```

Use DOM APIs for client-side actions. All template data escaped with esc().

- [ ] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 3: Commit**

```bash
git add src/views/templates-page.js
git commit -m "feat: overhaul templates page with canvas editor links and mini timelines"
```

---

## Task 3: Analytics Daily Bucketing in Cron

**Files:**
- Modify: `src/cron.js`

- [ ] **Step 1: Add daily bucketing to `updateAnalytics`**

In `src/cron.js`, find the `updateAnalytics` function. After the per-step stats update and before `analytics.updatedAt = ...`, add daily bucketing:

```javascript
  // Write daily bucketed data for time-series charts
  if (eventType && templateId) {
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `analytics-daily:${templateId}`;
    let dailyData = await env.SEQUENCES.get(dailyKey, 'json');
    if (!dailyData) {
      dailyData = { templateId, days: {} };
    }
    if (!dailyData.days[today]) {
      dailyData.days[today] = { sent: 0, opened: 0, replied: 0 };
    }
    if (eventType === 'sent') dailyData.days[today].sent++;
    else if (eventType === 'opened') dailyData.days[today].opened++;
    else if (eventType === 'replied') dailyData.days[today].replied++;

    // Prune entries older than 90 days
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    for (const day of Object.keys(dailyData.days)) {
      if (day < cutoff) delete dailyData.days[day];
    }

    await env.SEQUENCES.put(dailyKey, JSON.stringify(dailyData));
  }
```

- [ ] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 3: Commit**

```bash
git add src/cron.js
git commit -m "feat: add daily bucketed analytics for time-series charts"
```

---

## Task 4: Enhanced Analytics Page

**Files:**
- Modify: `src/views/analytics-page.js`
- Modify: `src/index.js` (analytics route update)

- [ ] **Step 1: Update analytics route in `src/index.js`**

In the GET `/analytics` route, also fetch daily data for each template. After fetching `analyticsData`, add:

```javascript
      // Fetch daily data for time-series charts
      const dailyKeys = await env.SEQUENCES.list({ prefix: 'analytics-daily:' });
      const dailyDataMap = {};
      for (const k of dailyKeys.keys) {
        const d = await env.SEQUENCES.get(k.name, 'json');
        if (d) dailyDataMap[d.templateId] = d.days;
      }
```

Update the `renderAnalyticsPage` call to pass `dailyDataMap`:
```javascript
      return html(renderAnalyticsPage(analyticsData.filter(Boolean), templates, oauthConnected, dailyDataMap));
```

- [ ] **Step 2: Rewrite `src/views/analytics-page.js`**

Update function signature: `export function renderAnalyticsPage(analyticsData, templates, oauthConnected, dailyDataMap)`

Add to the page:

**Template comparison section (top of page, if 2+ templates):**
- Two `<select>` dropdowns populated with template names
- Side-by-side `.two-col` layout with `#compare-left` and `#compare-right` divs
- Client-side JS: on dropdown change, fetch and render the selected template's funnel + chart into the respective panel

**Time-series chart per template:**
- After each template's funnel bar chart, add a `.panel` with an SVG chart
- Chart rendered client-side from `dailyDataMap[templateId]`
- SVG polyline for sends (blue), opens (green), replies (purple)
- X-axis: last 30 days, Y-axis: auto-scaled counts
- Simple implementation: compute points, draw polylines + circles for data points
- No hover tooltips in v1 (keep it simple)

**SVG chart rendering (client-side JS):**
```javascript
function renderChart(containerId, dailyData) {
  var container = document.getElementById(containerId);
  if (!container || !dailyData) return;

  var days = [];
  var now = new Date();
  for (var i = 29; i >= 0; i--) {
    var d = new Date(now.getTime() - i * 86400000);
    days.push(d.toISOString().split('T')[0]);
  }

  var sent = days.map(function(d) { return (dailyData[d] || {}).sent || 0; });
  var opened = days.map(function(d) { return (dailyData[d] || {}).opened || 0; });
  var replied = days.map(function(d) { return (dailyData[d] || {}).replied || 0; });

  var maxVal = Math.max.apply(null, sent.concat(opened).concat(replied).concat([1]));
  var width = container.offsetWidth || 500;
  var height = 160;
  var padX = 30;
  var padY = 20;
  var chartW = width - padX * 2;
  var chartH = height - padY * 2;

  function toPoints(data) {
    return data.map(function(v, i) {
      var x = padX + (i / 29) * chartW;
      var y = padY + chartH - (v / maxVal) * chartH;
      return x + ',' + y;
    }).join(' ');
  }

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

  // Grid lines
  for (var g = 0; g <= 4; g++) {
    var gy = padY + (g / 4) * chartH;
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padX); line.setAttribute('x2', width - padX);
    line.setAttribute('y1', gy); line.setAttribute('y2', gy);
    line.setAttribute('stroke', 'rgba(148,163,184,0.08)');
    svg.appendChild(line);
  }

  // Polylines
  function addLine(points, color) {
    var pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', points);
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', color);
    pl.setAttribute('stroke-width', '2');
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pl);
  }

  addLine(toPoints(sent), '#3b82f6');
  addLine(toPoints(opened), '#22c55e');
  addLine(toPoints(replied), '#a855f7');

  container.appendChild(svg);

  // Legend
  var legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:16px;margin-top:8px;font-size:11px;';
  ['Sends|#3b82f6', 'Opens|#22c55e', 'Replies|#a855f7'].forEach(function(item) {
    var parts = item.split('|');
    var span = document.createElement('span');
    span.style.cssText = 'display:flex;align-items:center;gap:4px;color:' + parts[1] + ';';
    var dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:3px;background:' + parts[1] + ';border-radius:2px;';
    span.appendChild(dot);
    span.appendChild(document.createTextNode(parts[0]));
    legend.appendChild(span);
  });
  container.appendChild(legend);
}
```

Embed `dailyDataMap` via safeJson and call `renderChart()` for each template after the page loads.

**Comparison view client-side JS:**
- On dropdown change, read the selected template IDs
- Find their analytics + daily data from the embedded page data
- Render funnel + chart into the left/right comparison panels using the same rendering functions

- [ ] **Step 3: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 4: Commit**

```bash
git add src/views/analytics-page.js src/index.js
git commit -m "feat: add time-series charts and template comparison to analytics"
```

---

## Task 5: Compact Sequence Selector in Gmail

**Files:**
- Modify: `extension/gmail.js`

- [ ] **Step 1: Replace the sequence selector button with compact icon**

Find the `injectSequenceSelector` function. Replace the wide button creation with a compact ~32px icon button:

- Button: 32x32 rounded square, contains a small SVG icon (3 connected dots forming a vertical timeline)
- Default state: gray background (`#3f3f46`), gray icon
- When a template/one-off is selected: blue background (`rgba(59,130,246,0.15)`), blue icon, small blue dot indicator
- Tooltip on hover showing "Select sequence" or the selected template name
- Same dropdown behavior on click (opens the template list + one-off option)

Remove the text label span and arrow span. The button is now just the icon.

Update the "No sequence" handler to reset the button to gray state.
Update the template selection handler to set the button to blue state.
Update the one-off handler to set the button to blue state with "One-off" tooltip.

- [ ] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 3: Commit**

```bash
git add extension/gmail.js
git commit -m "feat: compact sequence selector icon button to avoid Send overlap"
```

---

## Task 6: Upgraded One-off Builder in Extension

**Files:**
- Modify: `extension/gmail.js`

- [ ] **Step 1: Upgrade the `showOneOffBuilder` function**

Find and rewrite `showOneOffBuilder`. The upgraded version should:

**Gmail-adapted color palette:**
- Container: `#f8f9fa` bg, `#e2e5e9` border, rounded 10px
- Inputs: white bg, `#d1d5db` border
- Accent: `#3b82f6`
- Text: `#1f2937` primary, `#6b7280` muted
- Variable pills: `#dbeafe` bg, `#3b82f6` text

**Variable pill buttons:**
- Row of 3 quick-insert pills: `{{firstName}}`, `{{subject}}`, `{{daysSince}}`
- Styled as small rounded buttons with the variable pill palette
- Click inserts the variable text at the textarea's cursor position (using selectionStart/selectionEnd)

**Mini formatting toolbar:**
- Bold (B) and Italic (I) buttons above the textarea
- Click wraps selected text in `<b>`/`<i>` tags
- Implementation: get selectionStart/End from textarea, wrap selected text, update value

**Preview toggle:**
- Small "Preview" text button
- On click: hides the textarea/toolbar, shows a rendered preview div
- Preview substitutes variables with data from the compose form: recipient from compose recipients, subject from compose subject input
- Click "Edit" to go back

**Multi-step support:**
- "Add another step" link below each step
- Can add up to 3 steps inline (each with its own delay/subject/body fields)
- Each additional step has the same variable pills and toolbar
- If 3 steps exist, show "Create full template in dashboard →" link instead of "Add another step"
- Store all steps in `data-oneoff-steps` as JSON array

**Stop conditions:**
- Checkbox row: "Stop on reply" (default checked), "Stop on open" (unchecked)
- Per-step stop conditions

All UI built with DOM APIs (createElement, textContent, addEventListener). No innerHTML with user data.

- [ ] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 3: Commit**

```bash
git add extension/gmail.js
git commit -m "feat: upgrade one-off builder with variables, toolbar, preview, multi-step"
```

---

## Task 7: Subject Line Default Behavior

**Files:**
- Modify: `src/cron.js`

- [ ] **Step 1: Add empty-subject fallback in the cron send logic**

In `src/cron.js`, find where `substituteVariables` is called for the step subject (in `sendDueFollowUps`). Before substitution, add:

```javascript
    // If subject is empty, default to "Re: {{subject}}" (like a Gmail reply)
    const stepSubject = step.subject.trim() || 'Re: {{subject}}';
    const renderedSubject = substituteVariables(stepSubject, context);
```

Replace the existing `substituteVariables(step.subject, context)` call with this pattern.

- [ ] **Step 2: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 3: Commit**

```bash
git add src/cron.js
git commit -m "feat: default empty subject to Re: {{subject}} like Gmail reply"
```

---

## Task 8: Final Lint and Verification

**Files:**
- All modified files

- [ ] **Step 1: Run lint**

Run: `pnpm lint`
Fix all errors.

- [ ] **Step 2: Verify all pages load**

Run: `pnpm dev`
Visit:
- http://localhost:8787/templates (list page with Edit/Duplicate/Delete buttons)
- http://localhost:8787/templates/new (canvas editor, empty state)
- http://localhost:8787/analytics (time-series charts, comparison dropdowns if 2+ templates)

- [ ] **Step 3: Verify extension**

1. Reload extension in Chrome
2. Open Gmail compose
3. Verify compact icon button next to Send (not overlapping)
4. Click icon, verify dropdown opens
5. Select "+ One-off follow-up", verify upgraded builder with variable pills and toolbar

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: final lint and polish for sequence experience"
```

---

## Task Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Canvas editor page (timeline + editor + toolbar + preview) | `src/views/template-editor.js`, `src/index.js` |
| 2 | Templates page overhaul (remove form, add canvas links) | `src/views/templates-page.js` |
| 3 | Analytics daily bucketing in cron | `src/cron.js` |
| 4 | Enhanced analytics (time-series charts + comparison) | `src/views/analytics-page.js`, `src/index.js` |
| 5 | Compact sequence selector in Gmail | `extension/gmail.js` |
| 6 | Upgraded one-off builder in extension | `extension/gmail.js` |
| 7 | Subject line default behavior | `src/cron.js` |
| 8 | Final lint and verification | All files |

**Dependencies:** Task 1 is the foundation. Task 2 depends on 1 (links to canvas routes). Tasks 3-7 are independent. Task 8 is last.
