/**
 * Shared formatting utilities for the brain dashboard.
 *
 * All display-facing formatting functions live here to avoid duplication
 * across views and components.
 */

// ---------------------------------------------------------------------------
// Time / timestamp
// ---------------------------------------------------------------------------

/** Format an ISO timestamp as HH:MM:SS (local time). */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Format an ISO timestamp as "Mon DD, HH:MM" (local time, no year). */
export function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format an ISO timestamp as "Mon DD, HH:MM:SS" (local time, no year).
 * Used in the sessions list where seconds are important.
 */
export function fmtTimestampLong(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Format an ISO timestamp as "HH:MM" only (no seconds). */
export function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Duration / elapsed
// ---------------------------------------------------------------------------

/** Format a millisecond duration as a human-readable string (e.g. "1m 30s"). */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Format a gap between turns (returns label like "5m gap" or "1h 10m gap"). */
export function fmtGap(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m gap`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m gap`;
}

/**
 * Format a minute count as a compact duration string (e.g. "2h 30m").
 * Used in productivity/quality KPI cards.
 */
export function fmtMinutes(minutes: number): string {
  if (minutes === 0) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format an age in minutes as a short label (e.g. "45m", "3h", "2d").
 * Used on kanban queue-age badges.
 */
export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Format a duration between two ISO timestamps (or start to now if end is null). */
export function fmtSessionDuration(start: string, end: string | null): string {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diffMs = endMs - new Date(start).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

/** Format an ISO timestamp as a relative time string (e.g. "5m ago", "yesterday"). */
export function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'yesterday';
  return `${diffD}d ago`;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/**
 * Format a large integer with SI suffixes (k / M).
 * Handles millions: 1_200_000 -> "1.2M", 45_000 -> "45k", 999 -> "999".
 */
export function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Status / color helpers
// ---------------------------------------------------------------------------

/** Return a CSS color for a session status string. */
