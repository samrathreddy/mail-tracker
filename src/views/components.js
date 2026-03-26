import { esc } from '../shared.js';

/**
 * Renders a stat card with label, value, optional change indicator,
 * and one of several visualization types (sparkline, ring, segments, or raw HTML).
 */
export function renderStatCard({ label, value, change, changeDirection, sparklineData, ringPercent, ringLabel, barSegments, barLegend, extra }) {
  let changeHtml = '';
  if (change !== undefined && change !== null) {
    const dir = changeDirection === 'up' ? 'up' : 'neutral';
    changeHtml = ` <span class="change ${dir}">${esc(change)}</span>`;
  }

  let extraHtml = '';
  if (sparklineData && sparklineData.length) {
    extraHtml = renderSparkline(sparklineData);
  } else if (ringPercent !== undefined && ringPercent !== null) {
    extraHtml = renderRing(ringPercent, ringLabel);
  } else if (barSegments && barSegments.length) {
    extraHtml = renderSegBar(barSegments, barLegend);
  } else if (extra) {
    extraHtml = `<div class="stat-extra">${extra}</div>`;
  }

  return `<div class="stat-card">
<div class="stat-label">${esc(label)}</div>
<div class="stat-value"><span class="number">${esc(value)}</span>${changeHtml}</div>
${extraHtml}
</div>`;
}

function renderSparkline(data) {
  const max = Math.max(...data, 1);
  const bars = data.map(v => {
    const heightPct = (v / max) * 100;
    const opacity = 0.4 + (v / max) * 0.6;
    return `<div class="sparkline-bar" style="height:${heightPct}%;opacity:${opacity.toFixed(2)}"></div>`;
  }).join('');
  return `<div class="stat-extra"><div class="sparkline">${bars}</div></div>`;
}

function renderRing(percent, label) {
  const clamped = Math.max(0, Math.min(100, percent));
  const circumference = 2 * Math.PI * 14; // radius = 14
  const dashArray = `${(clamped / 100) * circumference} ${circumference}`;
  const labelHtml = label ? ` <span class="ring-label">${esc(label)}</span>` : '';
  return `<div class="stat-extra"><div class="ring-chart"><svg viewBox="0 0 36 36" width="36" height="36"><circle cx="18" cy="18" r="14" fill="none" stroke="#27272a" stroke-width="3"/><circle cx="18" cy="18" r="14" fill="none" stroke="#3b82f6" stroke-width="3" stroke-dasharray="${dashArray}" stroke-dashoffset="0" transform="rotate(-90 18 18)" stroke-linecap="round"/></svg>${labelHtml}</div></div>`;
}

function renderSegBar(segments, legend) {
  const segs = segments.map(s =>
    `<div class="seg" style="flex:${s.value};background:${s.color}"></div>`
  ).join('');
  let legendHtml = '';
  if (legend && legend.length) {
    const items = legend.map(l =>
      `<span class="seg-legend-item"><span class="seg-legend-dot" style="background:${l.color}"></span>${esc(l.label)}</span>`
    ).join('');
    legendHtml = `<div class="seg-legend">${items}</div>`;
  }
  return `<div class="stat-extra"><div class="seg-bar">${segs}</div>${legendHtml}</div>`;
}

/**
 * Renders a small badge with a variant color class.
 * Variants: 'blue', 'green', 'yellow', 'orange', 'gray'
 */
export function renderBadge(text, variant) {
  return `<span class="badge badge-${variant}">${esc(text)}</span>`;
}

/**
 * Renders a row of filter tab buttons.
 * The tab matching activeKey gets the .active class.
 */
export function renderFilterTabs(tabs, activeKey) {
  const buttons = tabs.map(tab => {
    const activeClass = tab.key === activeKey ? ' active' : '';
    const countStr = tab.count !== undefined && tab.count !== null ? ` (${esc(String(tab.count))})` : '';
    return `<button class="filter-tab${activeClass}" data-filter="${esc(tab.key)}">${esc(tab.label)}${countStr}</button>`;
  }).join('');
  return `<div class="filter-tabs">${buttons}</div>`;
}

/**
 * Renders a step-progress indicator with dots and connectors.
 * Each step has a status: 'sent', 'pending', 'failed', or 'skipped'.
 */
export function renderStepProgress(steps) {
  const parts = [];
  steps.forEach((step, i) => {
    if (i > 0) {
      parts.push('<div class="step-connector"></div>');
    }
    const content = step.status === 'failed' ? '!' : String(i + 1);
    parts.push(`<div class="step-dot ${step.status}">${content}</div>`);
  });
  return `<div class="step-progress">${parts.join('')}</div>`;
}

/**
 * Safely serializes a value to JSON for embedding in <script> tags.
 * Replaces '<' to prevent injection via </script> or similar.
 */
export function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
