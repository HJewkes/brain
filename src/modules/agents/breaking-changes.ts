import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BreakingChange {
  file: string;
  changedAt: string;
  currentSignatures: string[];
}

const KEY_FILES = ['src/types.ts', 'src/services/search.ts'];

const SIGNATURE_PATTERNS = [
  /^export\s+function\s+\w+[^{]*/,
  /^export\s+interface\s+\w+/,
  /^export\s+type\s+\w+/,
  /^export\s+const\s+\w+/,
];

/**
 * Extract exported signatures from file content using regex.
 */
export function extractSignatures(content: string): string[] {
  const signatures: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    for (const pattern of SIGNATURE_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        signatures.push(match[0]);
        break;
      }
    }
  }
  return signatures;
}

/**
 * Detect recently modified key files that may contain breaking API changes.
 */
export function detectBreakingChanges(
  projectRoot: string,
  sinceDays: number = 7
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  let modifiedFiles: string[];
  try {
    const result = execSync(
      `git log --since="${sinceDays} days ago" --diff-filter=M --name-only --pretty=format: -- ${KEY_FILES.join(' ')}`,
      { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 }
    );
    modifiedFiles = [
      ...new Set(
        result
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean)
      ),
    ];
  } catch {
    return [];
  }

  for (const file of modifiedFiles) {
    let lastChanged: string;
    try {
      lastChanged = execSync(`git log -1 --format=%ci -- "${file}"`, {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      lastChanged = 'unknown';
    }

    let content: string;
    try {
      content = readFileSync(join(projectRoot, file), 'utf-8');
    } catch {
      continue;
    }

    const currentSignatures = extractSignatures(content);
    if (currentSignatures.length > 0) {
      changes.push({ file, changedAt: lastChanged, currentSignatures });
    }
  }

  return changes;
}

/**
 * Format breaking changes as a dispatch brief section.
 */
export function formatBreakingChangesBrief(changes: BreakingChange[]): string {
  const lines: string[] = [];
  lines.push('--- API Break Notice ---');
  lines.push(
    'The following key files were recently modified. Verify current signatures before use:'
  );

  for (const change of changes) {
    lines.push(`  ${change.file} (changed: ${change.changedAt})`);
    for (const sig of change.currentSignatures) {
      lines.push(`    ${sig}`);
    }
  }

  return lines.join('\n');
}
