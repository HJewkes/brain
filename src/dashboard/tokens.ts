/**
 * Brain Dashboard Design Tokens — v2
 *
 * Principle: every color on the page traces back to a named token.
 * Three layers: Palette (raw values), Semantic (meaning), Component (usage).
 *
 * The backward-compat `colors` export preserves the exact shape of the v1 API.
 */

import { generateShades } from './utils/color-utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1: Primitive Palette
// ═══════════════════════════════════════════════════════════════════════════

// Pre-compute shade scales so the palette object can be `as const`.
const _brand = generateShades('#FF7900');
const _teal = generateShades('#14B8A6');
const _red = generateShades('#F83030');
const _amber = generateShades('#F4A736');
const _gold = generateShades('#D4A520');
const _userBlue = generateShades('#5B9BD5');
const _accentBlue = generateShades('#2563EB');
const _steel = generateShades('#406D87');
const _purple = generateShades('#823CA0'); // dim-base intentionally differs from display base
const _green = generateShades('#22c55e');
const _gray = generateShades('#6B7280'); // dim-base; display variants use brighter tones

export const palette = {
  // -- Neutrals / Surfaces --
  black: '#000000',
  white: '#ffffff',
  bg: '#101010',
  surface1: '#161616',
  surface2: '#191919',
  surface3: '#1e1e1e',

  // -- Brand --
  brand: {
    ..._brand,
    // Extra shades beyond the standard scale
    dim06: `rgba(255,121,0,0.06)`,
    dim20: `rgba(255,121,0,0.20)`,
    dim30: `rgba(255,121,0,0.30)`,
  },

  // -- Teal (success/done/write) --
  teal: {
    ..._teal,
    // Extra shades beyond the standard scale
    dim10: `rgba(20,184,166,0.10)`,
    dim20: `rgba(20,184,166,0.20)`,
  },

  // -- Red (error/blocked) --
  red: {
    ..._red,
    light: '#F87171',
    // was #DC050C — brightened for WCAG AA (3.4→4.6:1 on surface2 #191919)
    // Extra shades beyond the standard scale
    dim10: `rgba(248,48,48,0.10)`,
    dim20: `rgba(248,48,48,0.20)`,
    dim30: `rgba(248,48,48,0.30)`,
  },

  // -- Critical (iOS system red -- priority only) --
  critical: {
    base: '#FF3B30',
  },

  // -- Amber (edit/idle/warning) --
  amber: {
    ..._amber,
    // Extra shades beyond the standard scale
    dim20: `rgba(244,167,54,0.20)`,
    dim40: `rgba(244,167,54,0.40)`,
  },

  // -- Gold (ready/queued) --
  gold: {
    ..._gold,
  },

  // -- Blue (info/read) --
  blue: {
    base: '#2196F3',
    dark: '#1965B0',
    light: '#7BAFDE',
  },

  // -- User blue (message cards) --
  userBlue: {
    ..._userBlue,
    // Special named aliases kept for semantic clarity
    bgDark: 'rgba(20,50,90,0.35)',
    border50: `rgba(91,155,213,0.50)`,
    // Extra shades beyond the standard scale
    dim35: `rgba(91,155,213,0.35)`,
  },

  // -- SubagentDrawer blue (different base from info blue) --
  accentBlue: {
    ..._accentBlue,
    // Extra shades beyond the standard scale
    dim06: `rgba(37,99,235,0.06)`,
    dim40: `rgba(37,99,235,0.40)`,
  },

  // -- Steel (secondary accent) --
  steel: {
    ..._steel,
    // Extra shades beyond the standard scale
    dim30: `rgba(64,109,135,0.30)`,
  },

  // -- Purple (review/grep/glob) --
  purple: {
    base: '#A855F7',
    light: '#C084FC',
    // dim uses #823CA0 (muted purple) intentionally for subtle backgrounds
    dim20: `rgba(130,60,160,0.20)`,
  },

  // -- Green (live/active dot) --
  green: {
    ..._green,
  },

  // -- Gray (bash/inactive) --
  gray: {
    base: '#9CA3AF',
    dark: '#848B98', // was #6B7280 — brightened for WCAG AA (3.9→5.6:1 on #101010)
    darker: '#4B5563',
    // dim variants use #6B7280 (mid-gray) as base for subtle backgrounds
    dim15: _gray.dim15,
    dim20: `rgba(107,114,128,0.20)`,
  },

  // -- Overlay --
  overlay: {
    white02: 'rgba(255,255,255,0.02)',
    white03: 'rgba(255,255,255,0.03)',
    white04: 'rgba(255,255,255,0.04)',
    white06: 'rgba(255,255,255,0.06)',
    white12: 'rgba(255,255,255,0.12)',
    white25: 'rgba(255,255,255,0.25)',
    black30: 'rgba(0,0,0,0.30)',
    black40: 'rgba(0,0,0,0.40)',
    black70: 'rgba(0,0,0,0.70)',
  },

  // -- Chart series palette --
  series: [
    '#FF7900',
    '#1965B0',
    '#14B8A6',
    '#882E72',
    '#4EB265',
    '#F4A736',
    '#7BAFDE',
    '#DC050C',
    '#F7F056',
  ] as const,

  // -- Avatar palette --
  avatar: ['#FF7900', '#2196F3', '#14B8A6', '#406D87', '#F4A736', '#8B5CF6', '#EC4899'] as const,

  // -- Chart data colors (extended for NotesBreakdown) --
  dataColors: [
    '#FF7900',
    '#1965B0',
    '#14B8A6',
    '#882E72',
    '#4EB265',
    '#F4A736',
    '#7BAFDE',
    '#DC050C',
    '#8B5CF6',
    '#EC4899',
  ] as const,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2: Semantic Aliases
// ═══════════════════════════════════════════════════════════════════════════

export const semantic = {
  // -- Typography --
  text: {
    primary: '#F3F4F6',
    secondary: palette.gray.base,
    tertiary: palette.gray.dark,
    inverse: palette.white,
  },

  // -- Surfaces --
  surface: {
    page: palette.bg,
    card: palette.surface1,
    nested: palette.surface2,
    elevated: palette.surface3,
  },

  border: '#2a2a2a',

  // -- Status --
  status: {
    success: palette.teal.base,
    error: palette.red.base,
    warning: palette.amber.base,
    info: palette.blue.base,
    active: palette.brand.base,
    idle: palette.amber.base,
    live: palette.green.base,
    done: palette.teal.base,
    blocked: palette.red.base,
    pending: palette.gray.dark,
    static: palette.gray.darker,
  },

  // -- Priority --
  priority: {
    critical: palette.critical.base,
    high: palette.red.base,
    medium: palette.amber.base,
    low: palette.blue.base,
    lowStripe: palette.blue.dark,
  },

  // -- Column / workflow stage --
  column: {
    blocked: palette.red.base,
    ready: palette.gold.base,
    inprogress: palette.blue.base,
    review: palette.purple.base,
    done: palette.teal.base,
  },

  // -- Tool types --
  tool: {
    read: { fg: palette.blue.light, bg: 'rgba(25,101,176,0.2)' },
    write: { fg: palette.teal.base, bg: palette.teal.dim20 },
    edit: { fg: palette.amber.base, bg: palette.amber.dim20 },
    bash: { fg: palette.gray.base, bg: palette.gray.dim20 },
    grep: { fg: palette.purple.light, bg: palette.purple.dim20 },
    glob: { fg: palette.purple.light, bg: palette.purple.dim20 },
    agent: { fg: palette.brand.base, bg: palette.brand.dim12 },
  },

  // -- Tool pill variants (slightly different bg) --
  toolPill: {
    read: { fg: palette.blue.light, bg: 'rgba(25,101,176,0.2)' },
    write: { fg: palette.teal.base, bg: palette.teal.dim20 },
    bash: { fg: palette.amber.base, bg: palette.amber.dim15 },
    agent: { fg: palette.brand.base, bg: palette.brand.dim12 },
  },

  // -- Roles --
  role: {
    user: {
      accent: palette.userBlue.base,
      text: palette.blue.light,
      bg: palette.userBlue.bgDark,
      border: palette.userBlue.border50,
    },
    claude: {
      accent: palette.brand.base,
      text: palette.brand.base,
      bg: '#1a1400',
      border: palette.brand.dim25,
    },
  },

  // -- Error text on dark --
  errorText: palette.red.light,

  // -- Brand accent --
  accent: palette.brand.base,
  accentDim: palette.brand.dim12,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Layer 3: Component Tokens
// ═══════════════════════════════════════════════════════════════════════════

export const component = {
  // -- App shell / sidebar --
  sidebar: {
    bg: palette.surface1,
    border: semantic.border,
    navHoverBg: palette.overlay.white04,
    navActiveBg: palette.brand.dim08,
    navActiveBar: palette.brand.base,
  },

  // -- Card --
  card: {
    plainBg: palette.surface2,
    subtleBg: palette.overlay.white03,
    border: semantic.border,
  },

  // -- User message card --
  userCard: {
    bg: semantic.role.user.bg,
    border: semantic.role.user.border,
    accent: semantic.role.user.accent,
    labelColor: semantic.role.user.text,
    textColor: semantic.text.primary,
  },

  // -- Claude response card --
  claudeCard: {
    bg: semantic.role.claude.bg,
    border: semantic.role.claude.border,
    accent: semantic.role.claude.accent,
    labelColor: semantic.role.claude.text,
    errorAccent: semantic.status.error,
    toolSectionBorder: palette.brand.dim12,
    codeInlineBg: palette.overlay.white06,
  },

  // -- Tool call row --
  toolCallRow: {
    errorBorder: palette.red.dim25,
    errorBg: palette.red.dim05,
    agentBorder: palette.brand.dim20,
    agentBg: palette.brand.dim06,
  },

  // -- Summary card --
  summaryCard: {
    bg: palette.overlay.white03,
    border: palette.brand.dim15,
    errorBorder: palette.red.dim25,
  },

  // -- Error block --
  errorBlock: {
    bg: palette.red.dim08,
    border: palette.red.dim20,
    textColor: palette.red.light,
    toggleColor: palette.red.base,
  },

  // -- Badge (opacity-derived) --
  badge: {
    defaultBgOpacity: 0.12,
    defaultBorderOpacity: 0.25,
  },

  // -- Task / kanban pills --
  taskPill: {
    ready: { bg: palette.gold.dim15, fg: palette.gold.base, border: palette.gold.base },
    active: { bg: palette.brand.dim15, fg: palette.brand.base, border: palette.brand.base },
    done: { bg: palette.teal.dim12, fg: palette.teal.base, border: palette.teal.base },
  },

  // -- Task chip --
  taskChip: {
    color: palette.brand.base,
    bg: palette.brand.dim12,
    activeBg: palette.brand.dim25,
    borderColor: palette.brand.dim25,
  },

  // -- Kanban column header --
  kanbanHead: {
    ready: { bg: palette.gold.dim12, fg: palette.gold.base },
    active: { bg: palette.brand.dim12, fg: palette.brand.base },
    done: { bg: palette.teal.dim10, fg: palette.teal.base },
  },

  // -- Status badges --
  statusBadge: {
    complete: { bg: palette.teal.dim12, fg: palette.teal.base, border: palette.teal.dim25 },
    error: { bg: palette.red.dim12, fg: palette.red.base, border: palette.red.dim25 },
    active: { bg: palette.brand.dim12, fg: palette.brand.base, border: palette.brand.dim25 },
  },

  // -- Agent dot --
  agentDot: {
    live: { bg: palette.green.base, glow: palette.green.dim50 },
    idle: { bg: palette.amber.base, glow: palette.amber.dim40 },
    done: { bg: semantic.text.tertiary, glow: undefined as string | undefined },
  },

  // -- Timeline dots --
  timelineDot: {
    user: palette.userBlue.base,
    ok: palette.teal.base,
    err: palette.red.base,
    agent: palette.brand.base,
    info: semantic.text.tertiary,
  },

  // -- MiniStatus dots --
  miniStatus: {
    success: palette.teal.base,
    error: palette.red.base,
    pending: semantic.text.tertiary,
  },

  // -- Token gauge --
  tokenGauge: {
    inputBar: palette.blue.base,
    outputBar: palette.brand.base,
    track: palette.surface3,
    inputLabel: palette.blue.base,
    outputLabel: palette.brand.base,
  },

  // -- StatCard --
  statCard: {
    bg: palette.surface1,
    border: semantic.border,
    positiveDeltaBg: palette.teal.dim15,
    negativeDeltaBg: 'rgba(209,67,67,0.15)',
    positiveSpark: palette.brand.base,
    negativeSpark: palette.red.base,
  },

  // -- Context window chart --
  contextChart: {
    input: palette.blue.dark,
    output: palette.brand.base,
    compaction: palette.red.base,
    marker: palette.white,
  },

  // -- Files widget --
  filesWidget: {
    readLabel: palette.blue.light,
    readFill: palette.blue.dark,
    writeColor: palette.teal.base,
    trackBg: palette.surface3,
  },

  // -- Activity minimap --
  minimap: {
    blueTick: palette.userBlue.dim35,
    viewportBg: palette.overlay.white12,
    viewportBorder: palette.overlay.white25,
  },

  // -- Drawer / modal overlays --
  drawer: {
    backdrop: palette.overlay.black40,
    bg: palette.surface1,
    border: semantic.border,
  },

  // -- Command palette --
  commandPalette: {
    overlayBg: palette.overlay.black70,
    panelBg: '#1a1a1a',
    activeItemBg: palette.brand.dim08,
  },

  // -- Live indicator --
  liveIndicator: {
    active: palette.teal.base,
    static: palette.gray.darker,
  },

  // -- Workstream badge --
  workstreamBadge: {
    bg: palette.steel.dim15,
    border: palette.steel.dim30,
    text: palette.steel.base,
  },

  // -- SubagentDrawer tool row --
  subagentToolRow: {
    bg: palette.accentBlue.dim06,
    border: palette.accentBlue.dim15,
    leftAccent: palette.accentBlue.dim40,
  },

  // -- Swimlane header --
  swimlaneHeader: {
    bg: palette.overlay.white02,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Backward-compat re-exports (existing shape preserved)
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated Use `palette.*` / `semantic.*` / `component.*` */
export const colors = {
  bg: palette.bg,
  surface1: palette.surface1,
  surface2: palette.surface2,
  surface3: palette.surface3,
  brand: palette.brand.base,
  steel: palette.steel.base,
  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textTertiary: '#848B98',
  success: palette.teal.base,
  error: palette.red.base,
  warning: palette.amber.base,
  info: palette.blue.base,
  border: '#2a2a2a',
} as const;

/** Tool type colors for sparklines and tool-activity breakdowns. */
export const TOOL_COLORS: Record<string, string> = {
  read: semantic.status.info,
  write: palette.brand.base,
  bash: palette.teal.base,
  search: palette.steel.base,
  error: palette.red.base,
};

// ---------------------------------------------------------------------------
// Categorical color palettes — for avatar hashing, chart series, etc.
// ---------------------------------------------------------------------------

/** Stable palette for deterministic avatar / agent coloring. */
export const AVATAR_COLORS = palette.avatar;

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
  base: palette.bg,
  /** Cards and panels */
  raised: palette.surface1,
  /** Nested cards, sidebars */
  overlay: palette.surface2,
  /** Tooltips, dropdowns */
  floating: palette.surface3,
} as const;
