import React from 'react';
import { Pill } from './Pill.js';

export interface BadgeProps {
  label: string;
  /** Semantic color used for text, dot, border, and tinted background. */
  color: string;
  /** Background opacity multiplier, default 0.12. */
  bgOpacity?: number;
  /** Border opacity multiplier, default 0.25. */
  borderOpacity?: number;
  /** Show a status dot before the label, default false. */
  dot?: boolean;
  /** Font size tier: sm=9px, md=10px (default md). */
  size?: 'sm' | 'md';
}

/**
 * Unified pill badge.
 *
 * Renders a rounded pill with semi-transparent tinted background, optional
 * leading dot, and colored label text. A single component for column badges,
 * priority badges, review/status badges, and other labeled indicators.
 */
export function Badge({
  label,
  color,
  bgOpacity = 0.12,
  borderOpacity = 0.25,
  dot = false,
  size = 'md',
}: BadgeProps) {
  const pillSize = size === 'sm' ? 'xs' : 'sm';
  return (
    <Pill
      label={label}
      color={color}
      bg={hexToRgba(color, bgOpacity)}
      borderColor={hexToRgba(color, borderOpacity)}
      rounded
      size={pillSize}
      dot={dot ? { color, size: 6 } : undefined}
    />
  );
}

/**
 * Convert a hex color string to an rgba() string with the given opacity.
 * Handles 3-digit and 6-digit hex. Falls back to the original value if
 * the input is already an rgba/rgb string or cannot be parsed.
 */
function hexToRgba(color: string, opacity: number): string {
  const hex = color.trim();
  const match6 = hex.match(/^#([0-9a-f]{6})$/i);
  if (match6) {
    const n = parseInt(match6[1], 16);
    return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${opacity})`;
  }
  const match3 = hex.match(/^#([0-9a-f]{3})$/i);
  if (match3) {
    const [r, g, b] = match3[1].split('').map(c => parseInt(c + c, 16));
    return `rgba(${r},${g},${b},${opacity})`;
  }
  return hex;
}
