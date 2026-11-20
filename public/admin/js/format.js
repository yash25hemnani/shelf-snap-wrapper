// Number and date formatting shared by the admin pages.

const full = new Intl.NumberFormat("en");
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(value) {
  return full.format(value ?? 0);
}

// 1,234 below ten thousand, then 12.3K, 4.5M
export function formatCompact(value) {
  const n = value ?? 0;
  return Math.abs(n) < 10_000 ? full.format(n) : compact.format(n);
}

// "2026-11-19" (UTC day key) -> "Nov 19"
export function formatDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// "Nov 19, 2026"
export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "3 min ago", "5 h ago", else the date
export function formatRelative(iso) {
  if (!iso) return "—";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} d ago`;
  return formatDateTime(iso);
}
