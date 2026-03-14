export type { OutputFormat } from '../services/output-formatter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = { parent?: { opts(): any } | null };

export function resolveFormat(
  opts: { json?: boolean; format?: string },
  cmd?: AnyCommand
): 'json' | 'table' | 'plain' {
  if (opts.format === 'json' || opts.format === 'table') return opts.format;
  if (opts.format === 'plain') return 'plain';
  if (opts.json) return 'json';

  const parentFormat = cmd?.parent?.opts()?.format as string | undefined;
  if (parentFormat === 'json' || parentFormat === 'table') return parentFormat;

  return 'plain';
}

export function isJsonFormat(opts: { json?: boolean; format?: string }, cmd?: AnyCommand): boolean {
  return resolveFormat(opts, cmd) === 'json';
}
