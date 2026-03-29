import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const INDEXABLE_FILES = new Set(['spec.md', 'design.md', 'acceptance-criteria.md']);

const EXEC_OPTS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: 'utf-8',
  stdio: 'pipe',
  timeout: 10_000,
};

/** Index final planning artifacts into brain */
export function indexPlanningArtifacts(
  planDir: string,
  cwd: string
): { indexed: string[]; skipped: string[] } {
  const indexed: string[] = [];
  const skipped: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(planDir);
  } catch {
    return { indexed, skipped };
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const filePath = join(planDir, entry);
    if (!INDEXABLE_FILES.has(entry)) {
      skipped.push(filePath);
      continue;
    }

    try {
      execFileSync('node', [process.argv[1], 'add', filePath], { ...EXEC_OPTS, cwd });
      indexed.push(filePath);
    } catch {
      skipped.push(filePath);
    }
  }

  return { indexed, skipped };
}
