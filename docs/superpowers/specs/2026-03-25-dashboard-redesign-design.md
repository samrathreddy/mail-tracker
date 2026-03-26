# Dashboard Redesign — Design Spec (Sub-project 1)

## Overview

Full visual redesign of the mail-tracker web dashboard. Establishes a shared design system (slate mid-tone palette, glass-style surfaces, blue accents, icon-only sidebar) and applies it to all pages: Dashboard, Tracker Detail, Activity Feed (new), Sequences List, Templates, and Analytics. This is Sub-project 1 of 2; Sub-project 2 covers the sequence creation canvas and rich template editor.

## Design Language

**Style:** Glass/gradient aesthetic with blue accents and an icon-only sidebar. Slate mid-tone palette — not full dark, not light. Inspired by Raycast/Arc with the density of a data tool.

**Color Palette:**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#242a3d` | Page background |
| `--bg-surface` | `#2d3450` | Cards, stat panels |
| `--bg-surface-alt` | `#2a3148` | List panels, secondary surfaces |
| `--bg-sidebar` | `#1e2435` | Sidebar background |
| `--bg-hover` | `#333d57` | Hover states, input backgrounds |
| `--bg-elevated` | `#353e5a` | Modals, dropdowns, tooltips |
| `--border` | `rgba(148,163,184,0.1)` | Default borders |
| `--border-subtle` | `rgba(148,163,184,0.06)` | List item borders |
| `--text-primary` | `#f1f5f9` | Headings, primary content |
| `--text-secondary` | `#8896b3` | Subtitles, labels, metadata |
| `--text-muted` | `#6b7c9e` | Placeholders, disabled text |
| `--accent` | `#3b82f6` | Primary blue |
| `--accent-light` | `#60a5fa` | Hover/active accent, sparklines |
| `--accent-bg` | `rgba(59,130,246,0.12)` | Accent tinted backgrounds |
| `--success` | `#22c55e` | Opens, connected, complete |
| `--warning` | `#eab308` | Stopped, attention needed |
| `--error` | `#ef4444` | Failed, errors |

**Typography:** `system-ui, -apple-system, sans-serif`. Page titles 20px/700. Stat values 26-28px/700. Body 12-13px. Labels 10px/500 with 0.8px letter-spacing, uppercase.

**Border radius:** 14px for cards/panels, 10px for sidebar icons and list rows, 8px for buttons/inputs, 20px for pill badges.

**Shared patterns:**
- Glass-style surfaces: solid background color (not transparent overlay) with subtle 1px border
- Blue gradient sparklines in stat cards
- Green glowing dots for "opened" / "connected" status
- Pill badges for sequence status (blue=active, green=complete, yellow=stopped, orange=paused)
- Rows are full-width with subtle borders, clickable with hover state

## Architecture: Shared Modules

### `src/views/styles.js`

Exports a single function `getStyles()` returning a CSS string with all design tokens as CSS custom properties, plus base styles for the page shell, typography, stat cards, list rows, badges, buttons, inputs, and filter tabs. Every view imports and embeds this in its `<style>` tag.

### `src/views/layout.js`

Exports `renderLayout({ title, subtitle, activePage, headerActions, bodyHtml })` which wraps page content with:
- The icon sidebar (logo, 5 nav icons + activity feed icon, Gmail status dot, settings gear)
- Page header with title, subtitle, and optional action buttons
- A `<main>` container for the body content

Each view calls `renderLayout()` instead of generating its own full HTML document. The `activePage` parameter highlights the correct sidebar icon.

**Sidebar icons (top to bottom):**
1. Logo — blue gradient square with mail icon
2. Dashboard — 4-square grid icon
3. Sequences — list with dot icon
4. Templates — document with lines icon
5. Analytics — bar chart icon
6. Activity — timeline dots icon

**Sidebar bottom:**
- Gmail connection indicator (green/red dot)
- Settings gear icon

### `src/views/components.js`

Exports reusable rendering functions:
- `renderStatCard({ label, value, change, sparklineData?, ringPercent?, barSegments? })` — the summary stat cards with optional sparkline, ring chart, or segmented bar
- `renderBadge(text, color)` — pill badge (sequence status, open count)
- `renderFilterTabs(tabs, activeTab)` — horizontal tab bar with counts
- `renderListRow(columns)` — a standard list row with status dot, flexible columns

## Page: Dashboard (`/`)

**Header:** "Dashboard" title, subtitle with tracker count + total opens, search input, "+ New Tracker" button.

**Stat cards row (4 cards):**
1. Total Opens — value + % change + 7-bar sparkline (last 7 days)
2. Trackers — value + today's new count + opened/waiting pill badges
3. Sequences — active count + "of N total" + segmented status bar (active/done/stopped)
4. Open Rate — percentage + change + mini ring chart with ratio

**Tracker list panel:**
- Filter tabs: All (N) | Opened (N) | Unopened (N) | With Sequence (N)
- Column headers: (status dot) | Recipient | Subject | Opens | Sequence | When
- Sort selector (Recent, Most Opens, Oldest)
- Each row: green/gray status dot, recipient (bold), subject (muted, truncated), open count, sequence badge or dash, relative timestamp
- Rows are clickable — navigate to `/s/:id`

**Live feed bar (bottom):**
- Green pulsing dot + latest event description + "View all activity" link to `/activity`
- Shows the single most recent open event

**Data flow:** The dashboard route in `index.js` already builds the results array with tracker data and `sequenceProgress`. The stat card values (total opens, open rate, etc.) are computed server-side from the results array. Sparkline data for "last 7 days" is derived from aggregating `events[].time` across all trackers, grouped by day.

## Page: Tracker Detail (`/s/:id`)

**Header:** Back arrow link to Dashboard. Recipient email (large). Subject line (muted). Created date. Sender protection badge if `senderIp` exists.

**Stats row (4 stat cards):**
1. Real Opens — count + sparkline
2. Filtered — skipped count
3. First Open — timestamp (or "Not yet")
4. Last Open — timestamp (or "Not yet")

**Sequence section (conditional, if tracker has active/completed/stopped sequence):**
- Surface card with: template name (or "One-off"), status badge, timezone
- Visual step progress: horizontal row of circles — filled blue (sent), outlined blue (pending), red X (failed), gray skip (skipped) — with step numbers
- Next send time for active sequences
- Cancel / Skip buttons for active sequences

**Two-column layout:**

Left column (60%):
- **Event timeline** — tabbed: "Real Opens" | "Filtered"
- Each event is a row: timestamp (in viewer's local timezone), IP address, country flag/code, user-agent (truncated)
- Most recent 30 events shown, "Show more" if capped

Right column (40%):
- **Calendar heatmap** — same existing client-side computation, restyled with blue gradient cells on `--bg-surface` background
- **Peak hours grid** — same 24-hour grid, blue intensity scale on `--bg-surface`
- **Pixel snippet** — HTML and URL in copy-to-clipboard boxes styled with `--bg-hover` background

All timezone-dependent computations remain client-side (existing behavior).

## Page: Activity Feed (`/activity`) — NEW

**Route:** `GET /activity` — new route in `index.js`, new view file `src/views/activity-page.js`

**Header:** "Activity" title, subtitle with event count.

**Filter tabs:** All | Opens | Sequences | Filtered

**Event list:** Chronological, most recent first. Each event is a compact row:
- Status dot (color by type: green=open, blue=sequence, gray=filtered)
- Description line with bold recipient/email, event text, italic subject
- Relative timestamp on the right

**Event types:**
| Type | Dot Color | Format |
|------|-----------|--------|
| Email opened | `--success` green | **alice@acme.com** opened *Partnership proposal* |
| Follow-up sent | `--accent` blue | Follow-up #2 sent to **bob@startup.io** |
| Sequence completed | `--accent` blue | Sequence completed for **carol@bigcorp.com** |
| Sequence stopped | `--warning` yellow | Sequence stopped for **dave@agency.co** — recipient replied |
| Filtered open | `--text-muted` gray | Filtered: bot detected on *Invoice #1042* |
| Tracker created | `--accent` blue | New tracker created for **eve@enterprise.com** |

**Data source:** Server-side aggregation in the `/activity` route handler:
1. List all tracker keys from `TRACKER` KV, fetch each, collect items from `events[]` (type: open) and `filteredEvents[]` (type: filtered). Each item already has a `time` field.
2. List all sequence keys from `SEQUENCES` KV (prefix `seq:`), fetch each, collect: creation time (type: tracker_created from `createdAt`), each step with `sentAt` set (type: follow_up_sent), `stoppedAt` if set (type: sequence_stopped with `stoppedReason`), and if `status === 'completed'` (type: sequence_completed).
3. Merge all items into a single array, sort by timestamp descending, slice to 50 + offset.

This is an O(n) scan of all trackers + sequences per request. Acceptable for a personal tool with <500 trackers. If performance becomes an issue, a dedicated `activity:` KV log could be added later.

**Pagination:** "Load more" button at the bottom. Sends `?offset=50` to load the next batch. Server returns the next 50 events.

## Page: Sequences List (`/sequences`) — RESTYLED

Same data and functionality, new visual treatment.

**Header:** "Sequences" title, subtitle with active/total counts.

**Filter tabs:** All | Active | Paused | Stopped | Completed (with counts)

**Sequence rows:** Same columnar style as dashboard tracker rows:
- Status dot (green/blue/yellow/orange by status)
- Recipient email (bold)
- Template name or "One-off" (muted)
- Visual step progress — small horizontal circles (filled=sent, outlined=pending, X=failed)
- Next send time (active only)
- Cancel / Skip buttons (active only, right-aligned)

**No create functionality here** — sequences are created from Gmail compose or the sequences creation canvas (Sub-project 2).

## Page: Templates (`/templates`) — RESTYLED

Same data and functionality, new visual treatment.

**Header:** "Templates" title, "+ New Template" button.

**Template rows:** Row-based list:
- Template name (bold)
- Step count + timezone (muted)
- Step summary: "Day 2 → Day 5 → Day 10" compact format
- Delete button (right-aligned)

**Create form (inline, toggled by button):** Same fields as current (name, timezone, step builder), restyled with new palette. Inputs use `--bg-hover` background, buttons use accent blue. Step builder cards use `--bg-surface`.

This page gets a full overhaul in Sub-project 2 with the visual timeline editor. For now, functional parity with better visuals.

## Page: Analytics (`/analytics`) — RESTYLED

Same data and functionality, new visual treatment.

**Header:** "Analytics" title, subtitle "Sequence performance".

**Per-template cards:**
- Template name heading
- Summary stat cards row: Total Sequences, Completed, Stopped (using `renderStatCard`)
- Funnel bar chart: blue gradient bars, step labels, sent counts
- Per-step stats table: Step | Sent | Opened | Open Rate | Replied | Reply Rate — styled with `--bg-surface` alternating rows

## New Files

| File | Purpose |
|------|---------|
| `src/views/styles.js` | Shared CSS with design tokens |
| `src/views/layout.js` | Page shell with icon sidebar |
| `src/views/components.js` | Reusable stat cards, badges, tabs, rows |
| `src/views/activity-page.js` | Activity feed page |

## Modified Files

| File | Changes |
|------|---------|
| `src/index.js` | Add `/activity` route, update dashboard route to compute sparkline data |
| `src/views/dashboard.js` | Full rewrite with new layout, stat cards, columnar list, filters, search, live feed |
| `src/views/detail.js` | Restyle with new palette, use shared layout, add step progress visualization |
| `src/views/sequences-page.js` | Restyle with shared layout, row-based list, step progress dots |
| `src/views/templates-page.js` | Restyle with shared layout, row-based list, form restyled |
| `src/views/analytics-page.js` | Restyle with shared layout, blue gradient funnels, stat cards |

## Constraints

- No frameworks, no build step, no npm runtime deps — vanilla JS only (existing project convention)
- All views are server-rendered HTML strings with embedded `<script>` for client-side interactivity
- All dynamic data escaped with `esc()` from `shared.js`, all `JSON.stringify` inside `<script>` blocks uses `safeJson()` pattern
- Timezone-dependent computations remain client-side
- Icon sidebar uses inline SVG — no external icon libraries

## What's Deferred to Sub-project 2

- Sequence creation canvas (visual timeline editor with inline step editors)
- Rich body editor with formatting toolbar and variable insertion
- Inline email preview on hover
- Template page overhaul with visual editor
- Enhanced analytics with richer charts
