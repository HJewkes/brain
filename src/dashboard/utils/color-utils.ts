/** Generate a consistent opacity shade scale from a base hex color */
export function generateShades(hex: string): {
  base: string; // the hex color
  dim50: string; // rgba at 0.50 opacity
  dim25: string; // rgba at 0.25
  dim15: string; // rgba at 0.15
  dim12: string; // rgba at 0.12
  dim08: string; // rgba at 0.08
  dim05: string; // rgba at 0.05
} {
  const [r, g, b] = hexToRgb(hex);
  return {
    base: hex,
    dim50: `rgba(${r},${g},${b},0.5)`,
    dim25: `rgba(${r},${g},${b},0.25)`,
    dim15: `rgba(${r},${g},${b},0.15)`,
    dim12: `rgba(${r},${g},${b},0.12)`,
    dim08: `rgba(${r},${g},${b},0.08)`,
    dim05: `rgba(${r},${g},${b},0.05)`,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
