export type OutputFormat = 'json' | 'table' | 'plain';

export interface FormatOptions {
  /** Column keys to include (defaults to all keys from first row) */
  columns?: string[];
  /** Minimum column width */
  minWidth?: number;
}

export function formatOutput(
  data: Record<string, unknown>[],
  format: OutputFormat,
  options?: FormatOptions
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'table':
      return formatTable(data, options);
    case 'plain':
      return formatPlain(data);
  }
}

function formatTable(data: Record<string, unknown>[], options?: FormatOptions): string {
  if (data.length === 0) return '';

  const columns = options?.columns ?? Object.keys(data[0]);
  const minWidth = options?.minWidth ?? 4;

  const widths = columns.map((col) => {
    const maxData = data.reduce((max, row) => Math.max(max, String(row[col] ?? '').length), 0);
    return Math.max(col.length, maxData, minWidth);
  });

  const header = columns.map((col, i) => col.padEnd(widths[i])).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');

  const rows = data.map((row) =>
    columns.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join('  ')
  );

  return [header, separator, ...rows].join('\n');
}

function formatPlain(data: Record<string, unknown>[]): string {
  return data
    .map((row) =>
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    )
    .join('\n');
}
