# Dashboard Redesign Implementation Plan (Sub-project 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the mail-tracker web dashboard with a unified design system — slate mid-tone palette, glass-style surfaces, blue accents, icon-only sidebar — applied to all pages, plus a new Activity Feed page.

**Architecture:** Three new shared modules (`styles.js`, `layout.js`, `components.js`) establish the design system. Each existing view is then rewritten to use these shared modules. A new activity feed page aggregates events across all trackers and sequences. All views remain server-rendered HTML strings with embedded client-side JS — no frameworks, no build step.

**Tech Stack:** Cloudflare Workers (V8), vanilla JS, server-rendered HTML, inline CSS/SVG

**Spec:** `docs/superpowers/specs/2026-03-25-dashboard-redesign-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/views/styles.js` | Shared CSS string with design tokens and base component styles |
| `src/views/layout.js` | Page shell with icon sidebar, header, main container |
| `src/views/components.js` | Reusable stat cards, badges, filter tabs, step progress |
| `src/views/activity-page.js` | Activity feed page with chronological event timeline |

### Existing files to modify

| File | Changes |
|------|---------|
| `src/index.js` | Add `/activity` route, update dashboard route for sparkline data and sequence stats |
| `src/views/dashboard.js` | Full rewrite using shared modules |
| `src/views/detail.js` | Restyle with shared modules, add visual step progress |
| `src/views/sequences-page.js` | Restyle with shared modules, row-based list |
| `src/views/templates-page.js` | Restyle with shared modules |
| `src/views/analytics-page.js` | Restyle with shared modules |

---

## Task 1: Shared CSS Design Tokens (`styles.js`)

**Files:**
- Create: `src/views/styles.js`

- [ ] **Step 1: Create the styles module**

Create `src/views/styles.js` exporting a single `getStyles()` function that returns a CSS string containing:
- CSS custom properties for all design tokens from the spec (bg-base through error)
- Border radius tokens (card: 14px, row: 10px, btn: 8px, badge: 20px)
- Reset styles (margin/padding/box-sizing)
- Body styles (bg-base, text-primary, system-ui font)
- Page shell (flex layout, min-height 100vh)
- Sidebar styles (56px width, bg-sidebar, icon sizing, hover/active states, tooltip on hover)
- Page header styles (flex between, title 20px/700, subtitle 12px secondary)
- Stat card styles (bg-surface, border, label uppercase 10px, value 26px/700, change color variants)
- Sparkline (flex end, gradient bars)
- Ring chart (SVG sizing)
- Segmented bar (flex with gap)
- Badge variants (blue, green, yellow, orange, gray with matching bg/text colors)
- Filter tabs (flex, rounded, active = accent-bg)
- List panel (bg-surface-alt, border)
- List rows (flex, hover state, row-dot open/closed)
- Buttons (primary/danger/secondary/success variants)
- Inputs (bg-hover, border, focus state)
- Live feed bar (accent tint, pulsing dot animation)
- Two-column layout (3:2 ratio)
- Panel (bg-surface, border, title)
- Step progress dots (sent/pending/failed/skipped with connectors)
- Event rows (dot, text with strong/em, timestamp)
- Search box with embedded input

All color values must match the spec palette exactly. The CSS string is embedded via `<style>${getStyles()}</style>` in each page.

- [ ] **Step 2: Verify module loads**

Run: `node -e "import('./src/views/styles.js').then(m => console.log(typeof m.getStyles()))"`
Expected: `string`

- [ ] **Step 3: Commit**

```bash
git add src/views/styles.js
git commit -m "feat: add shared design system CSS with slate mid-tone palette"
```

---

## Task 2: Shared Layout Shell (`layout.js`)

**Files:**
- Create: `src/views/layout.js`

- [ ] **Step 1: Create the layout module**

Create `src/views/layout.js` exporting `renderLayout(opts)` where opts is `{ title, subtitle, activePage, headerActions, bodyHtml, scripts, oauthConnected }`.

The function returns a complete HTML document string containing:
- DOCTYPE, html, head (charset, viewport, title, favicon from shared.js, style tag with getStyles())
- Body with `.page-shell` flex container:
  - `nav.sidebar` with:
    - Logo: 32x32 blue gradient square with mail SVG icon
    - 5 nav items: dashboard (grid), sequences (list), templates (document), analytics (bars), activity (timeline dots) - each as an `<a>` with `.sidebar-icon` class, `.active` class when `activePage` matches
    - Bottom section: Gmail status dot (green if oauthConnected, red otherwise) + settings gear icon
    - Each icon has a `.tooltip` span that appears on hover showing the label
  - `main.page-main` with:
    - `.page-header` div with title h1, subtitle p, and headerActions div
    - bodyHtml inserted directly
  - Optional `<script>` tag with scripts content

Nav items array: `[{key:'dashboard',href:'/',icon:SVG,label:'Dashboard'}, ...]`

All SVG icons should be inline, 18x18, stroke-based, matching the mockup style.

- [ ] **Step 2: Verify module loads**

Run: `node -e "import('./src/views/layout.js').then(m => console.log(typeof m.renderLayout))"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add src/views/layout.js
git commit -m "feat: add shared layout shell with icon sidebar and page header"
```

---

## Task 3: Shared Components (`components.js`)

**Files:**
- Create: `src/views/components.js`

- [ ] **Step 1: Create the components module**

Create `src/views/components.js` exporting these functions:

**`renderStatCard({ label, value, change, changeDirection, sparklineData, ringPercent, ringLabel, barSegments, barLegend, extra })`**
- Returns a `.stat-card` div with label, value, optional change indicator, and optional visualization
- `sparklineData`: array of numbers, rendered as vertical gradient bars proportional to max
- `ringPercent`: 0-100, rendered as SVG donut chart
- `barSegments`: array of `{value, color}`, rendered as horizontal segmented bar
- `barLegend`: array of `{label, color}`, rendered below the bar
- `extra`: raw HTML string for custom content

**`renderBadge(text, variant)`**
- Returns a `.badge` span with the appropriate color class
- Variants: 'blue', 'green', 'yellow', 'orange', 'gray'

**`renderFilterTabs(tabs, activeKey)`**
- `tabs`: array of `{key, label, count?}`
- Returns `.filter-tabs` div with buttons, active tab highlighted

**`renderStepProgress(steps)`**
- `steps`: array of `{status}` where status is 'sent', 'pending', 'failed', or 'skipped'
- Returns `.step-progress` div with colored circles and connectors between them
- Sent = filled blue with step number, Pending = outlined blue, Failed = red with '!', Skipped = gray

**`safeJson(value)`**
- Returns `JSON.stringify(value).replace(/</g, '\\u003c')` for safe embedding in script tags

All functions use `esc()` from `shared.js` for any dynamic text content.

- [ ] **Step 2: Verify module loads**

Run: `node -e "import('./src/views/components.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'renderStatCard', 'renderBadge', 'renderFilterTabs', 'renderStepProgress', 'safeJson' ]`

- [ ] **Step 3: Commit**

```bash
git add src/views/components.js
git commit -m "feat: add shared UI components (stat cards, badges, tabs, step progress)"
```

---

## Task 4: Dashboard Page Rewrite

**Files:**
- Modify: `src/views/dashboard.js` (full rewrite)
- Modify: `src/index.js` (update dashboard route)

- [ ] **Step 1: Update the dashboard route in `src/index.js`**

In the GET `/` route handler, add:
1. Sparkline computation: during the result-building loop, aggregate event timestamps into a 7-element array (last 7 days, oldest first). For each event in `data.events`, compute `dayIndex = 6 - Math.floor((now - eventTime) / 86400000)` and increment `sparkline[dayIndex]` if in range 0-6.
2. Sequence stats: list `seq:*` keys from SEQUENCES KV, count active/completed/stopped.
3. OAuth status: check if `oauth:tokens` exists in SEQUENCES KV.
4. Change `renderDashboard` call to pass an object: `renderDashboard({ results, totalOpens, activeCount, sparkline, totalTrackers: results.length, sequences: { active, completed, stopped, total }, oauthConnected })`.

- [ ] **Step 2: Rewrite `src/views/dashboard.js`**

Full rewrite using shared modules. Import `renderLayout`, `renderStatCard`, `renderBadge`, `renderFilterTabs`, `safeJson` from the shared modules and `esc` from shared.js.

Change function signature to `export function renderDashboard(opts)` accepting `{ results, totalOpens, activeCount, sparkline, totalTrackers, sequences, oauthConnected }`.

The function should:
1. Build `headerActions` HTML with search box and "+ New Tracker" button
2. Build stat cards row with 4 cards: Total Opens (sparkline), Trackers (opened/waiting badges), Sequences (segmented bar), Open Rate (ring chart)
3. Build filter tabs: All, Opened, Unopened, With Sequence (with counts)
4. Build list panel with column headers (dot, Recipient, Subject, Opens, Sequence, When) and empty `.list-body` container
5. Build live feed bar showing most recent open event
6. Build create-tracker modal (hidden by default)
7. Build client-side scripts for: rendering rows with DOM APIs (createElement/textContent, NO innerHTML with dynamic data), search filtering, sort selection, filter tab switching, create tracker POST
8. Wrap everything in `renderLayout()` with title "Dashboard", activePage "dashboard"

All dynamic data embedded in scripts uses `safeJson()`. Row rendering uses DOM APIs exclusively.

- [ ] **Step 3: Test dashboard loads**

Run: `pnpm dev`
Visit: http://localhost:8787/
Expected: New dashboard with sidebar, stat cards, columnar tracker list.

- [ ] **Step 4: Run lint and fix**

Run: `pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add src/views/dashboard.js src/index.js
git commit -m "feat: rewrite dashboard with new design system"
```

---

## Task 5: Tracker Detail Page Restyle

**Files:**
- Modify: `src/views/detail.js`

- [ ] **Step 1: Rewrite `src/views/detail.js` using shared modules**

Import `renderLayout`, `renderStatCard`, `renderStepProgress`, `renderBadge`, `safeJson` from shared modules.

Function signature stays: `export function renderDetail(id, data, sequenceInfo)`

The rewrite should:
1. Use `renderLayout()` to wrap the page with `activePage: null` (detail is a sub-page, no sidebar highlight — or highlight 'dashboard' since it's accessed from there)
2. Add a back link to dashboard in the header area
3. Replace the 4-stat grid with `renderStatCard()` calls for Real Opens, Filtered, First Open, Last Open
4. If `sequenceInfo` exists, render a `.panel` section with:
   - Status badge via `renderBadge()`
   - Step progress via `renderStepProgress(sequenceInfo.steps)`
   - Template name, timezone, next send time
   - Cancel/Skip buttons for active sequences (using fetch with confirmation)
5. Two-column layout using `.two-col` / `.col-left` / `.col-right`:
   - Left: Event timeline panel with tabs (Opens/Filtered), event rows
   - Right: Calendar heatmap panel, Peak hours panel, Pixel snippet panel
6. All client-side JS for heatmap, peak hours, and timeline rendering stays functionally the same — update CSS class references to match new styles
7. All `JSON.stringify` in scripts uses `safeJson()`
8. Pass `oauthConnected` from the route handler (needs index.js update — add OAuth check to the `/s/:id` route)

- [ ] **Step 2: Update `/s/:id` route in `index.js` to pass OAuth status**

Add `const oauthConnected = env.SEQUENCES ? !!(await env.SEQUENCES.get('oauth:tokens')) : false;` and pass to `renderDetail`.

- [ ] **Step 3: Test detail page**

Run: `pnpm dev`
Expected: Restyled detail page with sidebar, new stat cards, sequence section.

- [ ] **Step 4: Commit**

```bash
git add src/views/detail.js src/index.js
git commit -m "feat: restyle tracker detail page with new design system"
```

---

## Task 6: Activity Feed Page (New)

**Files:**
- Create: `src/views/activity-page.js`
- Modify: `src/index.js`

- [ ] **Step 1: Create `src/views/activity-page.js`**

Import `renderLayout`, `renderFilterTabs` from shared modules and `esc` from shared.js.

Export `renderActivityPage(events, totalCount, offset, oauthConnected)`.

The function should:
1. Build filter tabs: All (count), Opens, Sequences, Filtered
2. Build event list from `events` array — each event has `{ type, description, timeAgo }`
3. Each event rendered as `.event-row` with colored dot (green=open, blue=sequence, yellow=stopped, gray=filtered), description HTML, and timestamp
4. "Load more" link at bottom if events.length >= 50, linking to `/activity?offset=N`
5. Client-side filter tab logic: toggle `.event-row` visibility based on `data-type` attribute
6. Wrap in `renderLayout()` with title "Activity", activePage "activity"

Event descriptions contain pre-escaped HTML with `<strong>` and `<em>` tags (built server-side using `esc()` for dynamic values).

- [ ] **Step 2: Add `/activity` route in `src/index.js`**

Add import for `renderActivityPage` at the top of index.js.

Add the route handler before the template/sequence API routes:
1. Check auth
2. Parse `offset` from query string (default 0)
3. Collect events from all trackers: iterate `TRACKER.list()`, for each tracker collect `events[]` (type: 'open'), `filteredEvents[]` (type: 'filtered'), and `createdAt` (type: 'tracker_created'). Build description strings using `esc()` for all dynamic values.
4. Collect events from sequences (if SEQUENCES KV exists): iterate `seq:*` keys, collect step sentAt (type: 'follow_up_sent'), stoppedAt (type: 'sequence_stopped'), completion (type: 'sequence_completed').
5. Sort all events by time descending
6. Slice to 50 starting from offset
7. Compute relative timeAgo for each event
8. Check OAuth status
9. Return `html(renderActivityPage(pageEvents, totalCount, offset, oauthConnected))`

- [ ] **Step 3: Test activity page**

Run: `pnpm dev`
Visit: http://localhost:8787/activity
Expected: Activity page with sidebar, filter tabs, event list.

- [ ] **Step 4: Commit**

```bash
git add src/views/activity-page.js src/index.js
git commit -m "feat: add activity feed page with chronological event timeline"
```

---

## Task 7: Sequences List Page Restyle

**Files:**
- Modify: `src/views/sequences-page.js`

- [ ] **Step 1: Rewrite `src/views/sequences-page.js`**

Import `renderLayout`, `renderFilterTabs`, `renderStepProgress`, `renderBadge`, `safeJson` from shared modules and `esc` from shared.js.

Function signature stays: `export function renderSequencesPage(sequences, oauthConnected)`
(Update the index.js call site to pass `oauthConnected`.)

The rewrite should:
1. Compute counts per status from the sequences array
2. Build filter tabs: All, Active, Paused, Stopped, Completed (with counts)
3. Build list panel with column headers and rows
4. Each row: status dot (colored by status), recipient (bold), template name or "One-off" (muted), step progress circles via `renderStepProgress()`, next send time (active only), Cancel/Skip buttons (active only)
5. Client-side JS: filter tab switching (hide/show rows by `data-status` attribute), cancel/skip fetch handlers with confirmation
6. Wrap in `renderLayout()` with activePage 'sequences'
7. Embed sequences data via `safeJson()` for client-side rendering

- [ ] **Step 2: Update index.js route to pass `oauthConnected`**

- [ ] **Step 3: Test and commit**

```bash
git add src/views/sequences-page.js src/index.js
git commit -m "feat: restyle sequences page with shared design system"
```

---

## Task 8: Templates Page Restyle

**Files:**
- Modify: `src/views/templates-page.js`

- [ ] **Step 1: Rewrite `src/views/templates-page.js`**

Import `renderLayout` from shared modules and `esc` from shared.js.

Function signature becomes: `export function renderTemplatesPage(templates, oauthConnected)`
(Update index.js call site.)

The rewrite should:
1. Use `renderLayout()` with activePage 'templates', headerActions containing "+ New Template" button
2. Template rows in a `.list-panel`: name (bold), step count + timezone (muted), step summary as "Day 2 -> Day 5 -> Day 10", delete button
3. Create form (toggled by button) in a `.panel`: name input, timezone input, dynamic step builder, save/cancel buttons
4. All inputs use `.input` class, buttons use `.btn` classes
5. Step builder cards use `--bg-surface` background
6. Same client-side JS logic for step building (addStep, saveTemplate, deleteTmpl) but with updated styling

- [ ] **Step 2: Update index.js route to pass `oauthConnected`**

- [ ] **Step 3: Test and commit**

```bash
git add src/views/templates-page.js src/index.js
git commit -m "feat: restyle templates page with shared design system"
```

---

## Task 9: Analytics Page Restyle

**Files:**
- Modify: `src/views/analytics-page.js`

- [ ] **Step 1: Rewrite `src/views/analytics-page.js`**

Import `renderLayout`, `renderStatCard` from shared modules and `esc` from shared.js.

Function signature becomes: `export function renderAnalyticsPage(analyticsData, templates, oauthConnected)`
(Update index.js call site.)

The rewrite should:
1. Use `renderLayout()` with activePage 'analytics'
2. Per-template sections in `.panel` cards:
   - Template name heading
   - Stat cards row: Total Sequences, Completed, Stopped (using `renderStatCard()`)
   - Funnel bar chart: blue gradient bars proportional to max sent, step labels
   - Stats table with column headers and rows styled with new palette

- [ ] **Step 2: Update index.js route to pass `oauthConnected`**

- [ ] **Step 3: Test and commit**

```bash
git add src/views/analytics-page.js src/index.js
git commit -m "feat: restyle analytics page with shared design system"
```

---

## Task 10: Final Lint and Verification

**Files:**
- All modified files

- [ ] **Step 1: Run lint**

Run: `pnpm lint`
Fix all errors. Common issues to watch for: unused imports, unused variables, missing `esc()` calls.

- [ ] **Step 2: Verify all pages load**

Run: `pnpm dev`
Visit each page:
- http://localhost:8787/ (dashboard)
- http://localhost:8787/sequences
- http://localhost:8787/templates
- http://localhost:8787/analytics
- http://localhost:8787/activity

Expected: All pages render with consistent sidebar (icon-only, blue accents), slate mid-tone palette, glass-style cards, and proper data display. Sidebar highlights the active page. Gmail status dot shows at the bottom.

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: lint cleanup and final polish for dashboard redesign"
```

---

## Task Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Shared CSS design tokens | `src/views/styles.js` |
| 2 | Shared layout shell with sidebar | `src/views/layout.js` |
| 3 | Shared UI components | `src/views/components.js` |
| 4 | Dashboard page rewrite | `src/views/dashboard.js`, `src/index.js` |
| 5 | Tracker detail page restyle | `src/views/detail.js`, `src/index.js` |
| 6 | Activity feed page (new) | `src/views/activity-page.js`, `src/index.js` |
| 7 | Sequences list page restyle | `src/views/sequences-page.js` |
| 8 | Templates page restyle | `src/views/templates-page.js` |
| 9 | Analytics page restyle | `src/views/analytics-page.js` |
| 10 | Final lint and verification | All files |

**Dependencies:** Tasks 1-3 are the foundation (build in order). Tasks 4-9 all depend on 1-3. Tasks 5-9 can be done in parallel after 4. Task 10 is last.
