/**
 * Titan Design System Migration Bridge
 *
 * This file is a MIGRATION AID, not a runtime dependency. It documents the
 * conceptual mapping between Brain's internal components (StyleSheet.create)
 * and the Titan Design System (NativeWind/Tailwind).
 *
 * Why a bridge and not a direct swap?
 * Brain uses StyleSheet.create with raw hex colors passed at call sites, while
 * Titan uses design tokens (e.g. `bg-status-success`) via NativeWind class names.
 * Bridging them at runtime would require either converting hex→token at runtime
 * (fragile) or adopting NativeWind across the whole dashboard (a larger effort).
 *
 * How to use this file:
 * - Use `toBadgeProps` / `toAvatarProps` to understand what Brain props map to in
 *   Titan terms when planning a full migration.
 * - When NativeWind is adopted, replace Brain component call sites with Titan
 *   components using these mappers as the translation guide.
 */

// ---------------------------------------------------------------------------
// Badge bridge
// ---------------------------------------------------------------------------

/** Brain Badge props (src/dashboard/components/shared/Badge.tsx) */
export interface BrainBadgeProps {
  label: string;
  color: string;
  bgOpacity?: number;
  borderOpacity?: number;
  dot?: boolean;
  size?: 'sm' | 'md';
}

/** Subset of Titan BadgeProps relevant to migration */
export interface TitanBadgeProps {
  /** Visual variant — Brain's tinted pill maps to 'subtle' */
  variant: 'solid' | 'subtle' | 'outline';
  /**
   * Semantic color token — Brain uses raw hex; map to the nearest Titan token.
   * See `colorToTitanBadgeColor` for the approximate mapping.
   */
  color: 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  size: 'sm' | 'md' | 'lg';
  /** Text content (Brain's `label` becomes children) */
  children: string;
}

/**
 * Approximate mapping from the named hex values used in Brain's design tokens
 * to Titan semantic color keys.
 *
 * Brain passes raw hex strings at call sites (e.g. "#22c55e" for green/success).
 * Titan uses semantic tokens. This mapping covers the colors used in the Brain
 * dashboard at time of writing — extend as needed.
 */
export const BRAIN_HEX_TO_TITAN_COLOR: Record<string, TitanBadgeProps['color']> = {
  // Green / success
  '#22c55e': 'success',
  '#16a34a': 'success',
  // Red / error
  '#ef4444': 'error',
  '#dc2626': 'error',
  // Amber / warning
  '#f59e0b': 'warning',
  '#d97706': 'warning',
  // Blue / info
  '#3b82f6': 'info',
  '#2563eb': 'info',
  // Purple / primary
  '#a855f7': 'primary',
  '#9333ea': 'primary',
  // Cyan / secondary
  '#06b6d4': 'secondary',
  '#0891b2': 'secondary',
};

/**
 * Convert Brain Badge props to the nearest equivalent Titan Badge props.
 *
 * Notes on lossy conversions:
 * - `color` is converted via `BRAIN_HEX_TO_TITAN_COLOR`; unknown hex values
 *   fall back to `'default'`.
 * - `bgOpacity` / `borderOpacity` have no Titan equivalent (Titan handles this
 *   internally via design tokens).
 * - `dot` has no direct Titan equivalent; callers should render a leading
 *   status indicator separately using Titan's AvatarBadge or a plain View.
 * - Brain `'md'` maps to Titan `'sm'` (Brain's md font is 10px ≈ Titan sm).
 */
export function toBadgeProps(brainProps: BrainBadgeProps): TitanBadgeProps {
  const titanColor =
    BRAIN_HEX_TO_TITAN_COLOR[brainProps.color.toLowerCase()] ?? 'default';

  const titanSize: TitanBadgeProps['size'] =
    brainProps.size === 'sm' ? 'sm' : 'sm'; // Both map to Titan sm; Titan md is larger

  return {
    variant: 'subtle',
    color: titanColor,
    size: titanSize,
    children: brainProps.label,
  };
}

// ---------------------------------------------------------------------------
// Avatar bridge
// ---------------------------------------------------------------------------

/** Brain Avatar props (src/dashboard/components/shared/Avatar.tsx) */
export interface BrainAvatarProps {
  name: string;
  size?: number; // px number
  rounded?: boolean;
}

/** Subset of Titan AvatarProps relevant to migration */
export interface TitanAvatarProps {
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Derived from Brain's `name` using the `initials` util */
  fallback: string;
  /** Accessible label derived from `name` */
  alt: string;
}

/** Brain pixel sizes → nearest Titan size token (Titan: xs=24, sm=32, md=40, lg=48, xl=64, 2xl=80) */
const PX_TO_TITAN_AVATAR_SIZE: Array<[number, TitanAvatarProps['size']]> = [
  [24, 'xs'],
  [32, 'sm'],
  [40, 'md'],
  [48, 'lg'],
  [64, 'xl'],
  [80, '2xl'],
];

function nearestTitanAvatarSize(px: number): TitanAvatarProps['size'] {
  let best: TitanAvatarProps['size'] = 'md';
  let bestDiff = Infinity;
  for (const [threshold, token] of PX_TO_TITAN_AVATAR_SIZE) {
    const diff = Math.abs(px - threshold);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = token;
    }
  }
  return best;
}

/** Derive initials from a display name (matches Brain's `initials` util logic) */
function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Convert Brain Avatar props to the nearest equivalent Titan Avatar props.
 *
 * Notes on lossy conversions:
 * - `size` (px) is mapped to the nearest Titan size token.
 * - `rounded=false` (rounded rect) has no Titan equivalent; Titan Avatar is
 *   always a full circle. Callers will need a custom `className` override.
 * - Brain derives background color from `name` via `avatarColor()`; Titan uses
 *   a fixed `bg-border-strong` token. Color parity is not preserved.
 */
export function toAvatarProps(brainProps: BrainAvatarProps): TitanAvatarProps {
  return {
    size: nearestTitanAvatarSize(brainProps.size ?? 32),
    fallback: toInitials(brainProps.name),
    alt: brainProps.name,
  };
}
