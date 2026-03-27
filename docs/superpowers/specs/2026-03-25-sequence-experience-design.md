# Sequence Experience — Design Spec (Sub-project 2)

## Overview

Overhaul the sequence creation and management experience. The centerpiece is a visual timeline canvas editor for building sequence templates, replacing the current inline form. Also includes a rich body editor with formatting toolbar and variable insertion, inline email preview, enhanced analytics with time-series charts and template comparison, and an upgraded one-off builder in the Gmail extension. The compact sequence selector in Gmail compose is also fixed to not overlap the Send button.

## Sequence Canvas Editor

### Pages

Two new HTML routes serve the canvas:
- `GET /templates/new` — canvas with empty state for creating a new template
- `GET /templates/:id/edit` — canvas pre-populated with existing template data

Both render the same view (`src/views/template-editor.js`) with different initial data. The existing `/templates` list page links to these instead of toggling an inline form.

### Layout

Full-width page inside the sidebar layout shell. Three zones:

**Top bar:** Editable template name (inline input, 18px bold), step count badge, timezone selector dropdown, Save button (`POST /templates` or `PUT /templates/:id`), Cancel button (navigates to `/templates`).

**Left panel (220px, fixed):** Vertical timeline visualization.
- "Original email" origin node at top (gray circle with envelope icon, "Day 0" label)
- Step nodes below, connected by vertical lines (blue tint)
- Selected step: filled blue circle with white number, bold label, blue detail text
- Unselected steps: outlined blue circle, muted label
- "Add step" dashed circle at bottom
- Up/down reorder arrows on hover per step node

**Right panel (flex, scrollable):** Inline editor for the currently selected step.

### Timeline Interactions

- Click a step node → loads its data into the right panel editor
- Click "Add step" → appends new step with defaults: `delayDays` = previous step's delay + 3 (or 2 if first step), subject empty, body empty, `stopOn: ['reply']`
- Up/down arrows on step nodes reorder steps (swap positions, recalculate nothing — delay days are absolute from origin)
- Deleting a step via "Remove step" button in the editor removes it and selects the adjacent step

### Step Editor (Right Panel)

**Header row:** Step number circle + "Follow-up #N" label + "Remove step" link (red text).

**Delay config row:**
- "Send after (days from original)" — number input
- "Stop conditions" — checkboxes: "On reply" (default checked), "On open" (default unchecked)

**Subject line:**
- Text input with placeholder `Re: {{subject}}`
- If saved empty, the cron handler substitutes `Re: {{subject}}` at send time (like a Gmail reply)
- "{{ Insert var" button next to the input opens a dropdown with all available variables

**Body editor:**
- Formatting toolbar (horizontal bar above the contenteditable area):
  - Bold (B), Italic (I), Link (chain icon), Bullet list (list icon)
  - `{{ var` dropdown button for inserting variables at cursor position
  - "Preview" toggle button (right-aligned)
- Contenteditable div for the body
- Variables rendered inline as highlighted blue pills (`{{firstName}}` on light blue background)
- Formatting uses `document.execCommand('bold')` etc. — no library needed
- Output is read as `innerHTML` of the contenteditable div (this is the template author's own content, not untrusted user input)

**Variable insertion dropdown:** Triggered by the `{{ var` button in toolbar or next to subject. Shows:
- `{{firstName}}` — Recipient's first name
- `{{recipient}}` — Full email address
- `{{subject}}` — Original email subject
- `{{originalBody}}` — Body preview
- `{{daysSince}}` — Days since original email
- `{{stepNumber}}` — Current step number

Click a variable → inserts it at the cursor position in the subject input or body contenteditable.

### Email Preview

Toggle button in the toolbar labeled "Preview". When active:
- A panel appears below the body editor
- Shows the rendered email with sample data filled in: `{{firstName}}` → "Alice", `{{subject}}` → "Partnership proposal", etc.
- Updates live as the body content changes (debounced, ~300ms)
- Shows subject line rendered with variables filled
- Shows "To: alice@acme.com" header line
- Styled as a faux email card (light background within the dark panel)

When toggled off, the preview panel hides and the editor takes full height.

### Data Flow

- On page load for `/templates/:id/edit`: fetch `GET /templates/:id` (JSON) to get template data, populate the timeline and editor
- On page load for `/templates/new`: start with empty state (no steps, name placeholder)
- All editing is client-side — no server round-trips while editing
- On Save: `POST /templates` (new) or `PUT /templates/:id` (edit) with the full template object, then redirect to `/templates`
- On Cancel: navigate to `/templates`
- Template object built client-side from the step editor states: collect name, timezone, and each step's delayDays, subject, body (innerHTML), stopOn array

## Templates Page Overhaul

### List Page (`/templates`)

**Header:** "Templates" title + "+ New Template" button (navigates to `/templates/new`).

**Template rows (`.list-row`):**
- Name (bold)
- Step count + timezone (muted)
- Mini visual timeline: small circles (8px) connected by thin lines, showing step numbers — a compact representation of the sequence flow
- Three action buttons (right-aligned): Edit (navigates to `/templates/:id/edit`), Duplicate (`POST /templates` with the same steps/timezone and name appended with " (copy)", then redirects to the new template's edit page), Delete (with confirmation)

**Removed:** The old inline create form. All creation/editing happens on the dedicated canvas pages.

### New Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/templates/new` | GET | Yes | Canvas editor, empty state |
| `/templates/:id/edit` | GET | Yes | Canvas editor, pre-populated |

These are HTML page routes (not API routes). They render `src/views/template-editor.js`.

## Enhanced Analytics

### Time-Series Charts

Each template's analytics section gets a 30-day line chart rendered as client-side SVG:
- Three lines: Sends (blue `#3b82f6`), Opens (green `#22c55e`), Replies (purple `#a855f7`)
- X-axis: dates (last 30 days)
- Y-axis: counts (auto-scaled)
- Rendered as SVG polylines with dot markers at data points
- Hover on a data point shows a tooltip with exact date and count
- Chart dimensions: full panel width, ~180px height

### Template Comparison View

New section at the top of `/analytics`:
- Two dropdown selectors: "Template A" and "Template B"
- Side-by-side display (`.two-col` layout):
  - Left: Template A's funnel bars + per-step stats + time-series chart
  - Right: Template B's funnel bars + per-step stats + time-series chart
- Hidden if fewer than 2 templates exist

### Data Model Addition

New KV key pattern: `analytics-daily:{templateId}`
```json
{
  "templateId": "tmpl:abc12345",
  "days": {
    "2026-03-20": { "sent": 5, "opened": 3, "replied": 1 },
    "2026-03-21": { "sent": 8, "opened": 5, "replied": 2 }
  }
}
```

Updated by the cron handler (`src/cron.js`) whenever it sends a follow-up, detects an open, or detects a reply. The `updateAnalytics` function writes to both the aggregate `analytics:` key and the daily `analytics-daily:` key.

Prune: entries older than 90 days are removed on each write to keep the value size bounded.

### Analytics Page Layout

1. **Comparison section** (top, if 2+ templates): dropdowns + side-by-side panels
2. **Per-template sections** (below): each template gets:
   - Summary stat cards (Total, Completed, Stopped) — existing, restyled
   - Time-series chart — new
   - Funnel bar chart — existing, restyled
   - Per-step stats table — existing, restyled

## Extension: One-off Builder Upgrade

### Enhanced Builder UI

The inline one-off builder in the Gmail compose dropdown gets polished:

**Variable pill buttons:** Row of 3 quick-insert pills above the body area: `{{firstName}}`, `{{subject}}`, `{{daysSince}}`. Click to insert at cursor position in the textarea below.

**Mini formatting toolbar:** Bold (B) and Italic (I) buttons above the textarea. These wrap selected text in `<b>` / `<i>` tags in the textarea value. Link and list omitted for compactness.

**Preview toggle:** Small "Preview" text button. Swaps the textarea for a rendered preview showing the email with variables substituted using data from the current compose form (recipient name, subject line). Click again to return to editing.

**Stop conditions:** Checkbox row: "Stop on reply" (default checked), "Stop on open" (unchecked).

**Multi-step:** "Add another step" link below the first step. Can add up to 3 steps inline, each with its own delay/subject/body. More than 3 steps shows a link: "Create a full template in the dashboard →" that opens `/templates/new` in a new tab.

### Color Palette (Gmail-adapted)

Since the builder renders inside Gmail's white UI:
| Token | Value | Usage |
|-------|-------|-------|
| Container bg | `#f8f9fa` | Builder background |
| Container border | `#e2e5e9` | Builder border |
| Input bg | `white` | Input backgrounds |
| Input border | `#d1d5db` | Input borders |
| Accent | `#3b82f6` | Buttons, variable pills |
| Text | `#1f2937` | Primary text |
| Text muted | `#6b7280` | Labels, placeholders |
| Variable pill bg | `#dbeafe` | Variable button background |
| Variable pill text | `#3b82f6` | Variable button text |

## Extension: Compact Sequence Selector

### The Problem

The current selector shows `[clipboard-icon] [template name] [arrow]` next to the Send button, which is wide enough to overlap/cover the Send button.

### The Fix

Replace with a compact icon-only button (~32px):
- Small circle/rounded-square button with a sequence icon (3 connected dots or a small timeline icon)
- Blue accent color when a sequence is selected, gray when "No sequence"
- Tooltip on hover: "Select sequence" (or the selected template name)
- Click opens the dropdown (same dropdown as before — template list, one-off option)
- When a template is selected, the icon turns blue and shows a tiny dot indicator

This takes ~32px of horizontal space instead of ~150px+, eliminating the Send button overlap entirely.

## New Files

| File | Purpose |
|------|---------|
| `src/views/template-editor.js` | Canvas editor page for creating/editing templates |

## Modified Files

| File | Changes |
|------|---------|
| `src/index.js` | Add `/templates/new` and `/templates/:id/edit` routes, update analytics daily data |
| `src/views/templates-page.js` | Remove inline form, add Edit/Duplicate/Delete actions, mini timeline visualization |
| `src/views/analytics-page.js` | Add time-series SVG charts, template comparison view |
| `src/cron.js` | Update `updateAnalytics` to write daily bucketed data |
| `extension/gmail.js` | Compact selector button, upgraded one-off builder with variables/toolbar/preview/multi-step |

## Constraints

- No frameworks, no build step, no npm runtime deps — vanilla JS only
- Canvas editor is server-rendered HTML with embedded client-side JS for interactivity
- Body editor uses contenteditable + `document.execCommand` — no WYSIWYG library
- SVG charts are hand-drawn (polylines, circles) — no charting library
- Extension code uses DOM APIs only (createElement/textContent) — no innerHTML with external data
- All server-rendered dynamic data escaped with `esc()`, all JSON in scripts uses `safeJson()`
