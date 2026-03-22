import React from 'react';
import { palette } from '../../../tokens.js';

export interface GridLinesProps {
  /** Number of horizontal lines (evenly spaced top-to-bottom in the chart area). */
  horizontal?: number;
  /** Number of vertical lines (evenly spaced left-to-right in the chart area). */
  vertical?: number;
  /** Total SVG width (same as ChartContainer width). */
  width: number;
  /** Total SVG height (same as ChartContainer height). */
  height: number;
  /** Padding applied to the chart — lines are drawn within the inner area. */
  padding: { top: number; right: number; bottom: number; left: number };
  /** Stroke color for grid lines. Defaults to subtle white overlay. */
  color?: string;
}

/**
 * Renders horizontal and/or vertical grid lines within the padded chart area.
 */
export function GridLines({
  horizontal = 0,
  vertical = 0,
  width,
  height,
  padding,
  color = palette.overlay.white06,
}: GridLinesProps) {
  const x1 = padding.left;
  const x2 = width - padding.right;
  const y1 = padding.top;
  const y2 = height - padding.bottom;
  const cH = y2 - y1;
  const cW = x2 - x1;

  const hLines = Array.from({ length: horizontal }, (_, i) => {
    const y = horizontal > 1 ? y1 + (i / (horizontal - 1)) * cH : y1 + cH / 2;
    return <line key={`h${i}`} x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="0.5" opacity="0.6" />;
  });

  const vLines = Array.from({ length: vertical }, (_, i) => {
    const x = vertical > 1 ? x1 + (i / (vertical - 1)) * cW : x1 + cW / 2;
    return <line key={`v${i}`} x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth="0.5" opacity="0.6" />;
  });

  return <>{hLines}{vLines}</>;
}
