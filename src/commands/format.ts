export type OutputFormat = 'json' | 'plain';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = { parent?: { opts(): any } | null };

export function resolveFormat(
  opts: { json?: boolean; format?: string },
  cmd?: AnyCommand
): OutputFormat {
  if (opts.format === 'json') return 'json';
  if (opts.format === 'plain') return 'plain';
  if (opts.json) return 'json';

  const parentFormat = cmd?.parent?.opts()?.format as string | undefined;
  if (parentFormat === 'json') return 'json';

  return 'plain';
}

export function isJsonFormat(opts: { json?: boolean; format?: string }, cmd?: AnyCommand): boolean {
  return resolveFormat(opts, cmd) === 'json';
}
