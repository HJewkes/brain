export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_PADDING: ChartPadding = { top: 10, right: 20, bottom: 28, left: 32 };

export interface DataPoint {
  label: string;
  value: number;
}

export interface ChartConfig {
  width: number;
  height: number;
  padding: ChartPadding;
}

/** Compute x pixel position for index i over n total points within chart area. */
export function xPos(i: number, n: number, cfg: ChartConfig): number {
  const cW = cfg.width - cfg.padding.left - cfg.padding.right;
  return cfg.padding.left + (i / Math.max(n - 1, 1)) * cW;
}

/** Compute y pixel position for value v scaled to maxY within chart area. */
export function yPos(v: number, maxY: number, cfg: ChartConfig): number {
  const cH = cfg.height - cfg.padding.top - cfg.padding.bottom;
  return cfg.padding.top + cH - (v / Math.max(maxY, 1)) * cH;
}
