// Shared color constants for dashboard components.
// These match the prototype CSS variables.
export const C = {
  bg: '#101010',
  surface1: '#161616',
  surface2: '#191919',
  surface3: '#1e1e1e',
  brand: '#FF7900',
  steel: '#406D87',
  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',
  success: '#14B8A6',
  error: '#D14343',
  warning: '#FFB020',
  info: '#2196F3',
  border: '#2a2a2a',
} as const;

// Tool type colors for sparklines
export const TOOL_COLORS: Record<string, string> = {
  read: C.info,
  write: C.brand,
  bash: C.success,
  search: C.steel,
  error: C.error,
};
