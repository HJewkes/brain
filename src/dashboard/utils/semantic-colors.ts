/**
 * Canonical semantic color mappings for the dashboard.
 *
 * Single source of truth — resolves conflicts between COL_ACCENT (KanbanColumn)
 * and colColor (TaskDetailView). Design intent follows the Kanban board headers:
 *   - ready → warning (amber): "queued, waiting"
 *   - inprogress → info (blue): "active work"
 *   - review/pr → purple: "under review"
 */
import { C } from '../components/shared/colors.js';

// ---------------------------------------------------------------------------
// Column colors (task workflow stage)
// ---------------------------------------------------------------------------

const COLUMN_COLOR_MAP: Record<string, string> = {
  blocked: C.error,
  ready: C.warning,
  inprogress: C.info,
  review: '#A855F7',
  pr: '#A855F7',
  done: C.success,
};

/** Maps a task column/stage name to its representative color. */
export function columnColor(col: string): string {
  return COLUMN_COLOR_MAP[col] ?? C.textTertiary;
}

// ---------------------------------------------------------------------------
// Priority colors
// ---------------------------------------------------------------------------

const PRIORITY_COLOR_MAP: Record<string, string> = {
  critical: '#FF3B30',
  high: C.error,
  medium: C.warning,
  low: C.info,
};

/** Maps a priority level to its representative text/badge color. */
export function priorityColor(priority: string): string {
  return PRIORITY_COLOR_MAP[priority] ?? C.textTertiary;
}

/**
 * Maps a priority level to its sidebar stripe color.
 * Uses a darker navy for 'low' to distinguish the stripe from badge text color.
 */
const PRIORITY_STRIPE_MAP: Record<string, string> = {
  critical: '#FF3B30',
  high: C.error,
  medium: C.warning,
  low: '#1965B0',
};

export function priorityStripeColor(priority: string): string {
  return PRIORITY_STRIPE_MAP[priority] ?? C.textTertiary;
}

// ---------------------------------------------------------------------------
// Status colors (session / agent lifecycle)
// ---------------------------------------------------------------------------

/**
 * Maps a session or agent status string to a color.
 * Covers both session states (active, completed, error) and agent states (running, failed).
 */
export function statusColor(status: string | undefined | null): string {
  if (!status) return C.textTertiary;
  const s = status.toLowerCase();
  if (s === 'active' || s === 'running') return C.brand;
  if (s === 'completed' || s === 'done') return C.success;
  if (s === 'error' || s === 'failed') return C.error;
  return C.textTertiary;
}
