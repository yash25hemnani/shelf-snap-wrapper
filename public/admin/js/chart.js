import { escapeHtml } from "./shell.js";
import { formatCompact, formatDay, formatNumber } from "./format.js";

// Draws a daily bar chart into [el]. [points] is [{ date: "yyyy-mm-dd", value }],
// oldest first. Plain HTML bars, so it stays sharp at any width.
export function renderBarChart(el, points, { unit = "" } = {}) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const suffix = unit ? ` ${unit}` : "";

  const bars = points.map((p) => {
    const pct = max ? (p.value / max) * 100 : 0;
    return `
      <div class="chart-bar" data-zero="${p.value === 0}">
        <span style="height:${pct.toFixed(2)}%"></span>
        <div class="chart-tip">${escapeHtml(formatDay(p.date))} · ${formatNumber(p.value)}${escapeHtml(suffix)}</div>
      </div>`;
  }).join("");

  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];

  el.innerHTML = `
    <div class="chart" role="img"
      aria-label="${escapeHtml(`Daily values, highest ${formatNumber(max)}${suffix}`)}">
      <div class="chart-max">Peak ${formatCompact(max)}${escapeHtml(suffix)}</div>
      <div class="chart-bars">${bars}</div>
      <div class="chart-axis">
        <span>${first ? escapeHtml(formatDay(first.date)) : ""}</span>
        <span>${middle ? escapeHtml(formatDay(middle.date)) : ""}</span>
        <span>${last ? "Today" : ""}</span>
      </div>
    </div>`;
}

// Scans = identify + discover (the two model routes), searches = search + ISBN
export function scansOf(day) {
  return (day.routes.scan ?? 0) + (day.routes.discover ?? 0);
}

export function searchesOf(day) {
  return (day.routes.search ?? 0) + (day.routes.isbn ?? 0);
}
