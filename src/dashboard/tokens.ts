/**
 * Shared design token layer for Brain dashboard.
 *
 * All color values are exact matches to the Titan Design System semantic tokens,
 * making this the single source of truth for both Brain and Titan-aligned components.
 */

// ---------------------------------------------------------------------------
// Color tokens — aligned 1:1 with Titan Design System semantic tokens
// ---------------------------------------------------------------------------

export const colors = {
  // Backgrounds
  bg: '#101010',
  surface1: '#161616',
  surface2: '#191919',
  surface3: '#1e1e1e',

  // Brand / accent
  brand: '#FF7900',
  steel: '#406D87',

  // Typography
  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',

  // Semantic status
  success: '#14B8A6',
  error: '#D14343',
  warning: '#FFB020',
  info: '#2196F3',

  // Structure
  border: '#2a2a2a',
} as const;

/** Tool type colors for sparklines and tool-activity breakdowns. */
export const TOOL_COLORS: Record<string, string> = {
  read: colors.info,
  write: colors.brand,
  bash: colors.success,
  search: colors.steel,
  error: colors.error,
};

// ---------------------------------------------------------------------------
// Spacing scale (px values)
// ---------------------------------------------------------------------------

export const spacing = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 10,
  6: 12,
  7: 14,
  8: 16,
  10: 20,
  12: 24,
} as const;

// ---------------------------------------------------------------------------
// Border radius scale (px values)
// ---------------------------------------------------------------------------

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const typography = {
  fonts: {
    heading: "'Space Grotesk', sans-serif",
    body: "'Inter', sans-serif",
    mono: 'monospace',
  },
  sizes: {
    xs: '11px',
    sm: '12px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '32px',
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

// ---------------------------------------------------------------------------
// Elevation / surface colors
// Layers ordered from deepest (base) to highest (overlay)
// ---------------------------------------------------------------------------

export const elevation = {
  /** Page background */
  base: colors.bg,
  /** Cards and panels */
  raised: colors.surface1,
  /** Nested cards, sidebars */
  overlay: colors.surface2,
  /** Tooltips, dropdowns */
  floating: colors.surface3,
} as const;
