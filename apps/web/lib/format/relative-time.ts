// Tiny relative-time formatter for dashboard "Started X ago" hints.
// No Intl.RelativeTimeFormat — we want consistent strings under SSR/CSR
// without locale surprises, and the granularity we care about is coarse.

export function formatRelativeTime(from: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - from.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
