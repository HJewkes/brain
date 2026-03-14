import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface SignatureEntry {
  kind: 'function' | 'interface' | 'type';
  signature: string;
}

export interface FileSnapshot {
  file: string;
  signatures: SignatureEntry[];
}

export type InterfaceSnapshot = FileSnapshot[];

const FUNCTION_RE = /^export\s+(?:async\s+)?function\s+\w+[^{]*/;
const INTERFACE_RE = /^export\s+interface\s+\w+.*\{/;
const TYPE_RE = /^export\s+type\s+\w+\s*=/;

/**
 * Extract exported signatures from TypeScript source content.
 * Handles multi-line function signatures by accumulating lines until
 * a closing paren or opening brace is found.
 */
export function extractSignaturesFromContent(content: string): SignatureEntry[] {
  const entries: SignatureEntry[] = [];
  const lines = content.split('\n');

  let pending: { kind: SignatureEntry['kind']; parts: string[] } | null = null;

  for (const line of lines) {
    if (pending) {
      pending.parts.push(line.trim());
      if (line.includes('{') || line.includes(');')) {
        entries.push(finalizePending(pending));
        pending = null;
      }
      continue;
    }

    const trimmed = line.trim();

    const fnMatch = trimmed.match(FUNCTION_RE);
    if (fnMatch) {
      const sig = fnMatch[0];
      if (isComplete(sig)) {
        entries.push({ kind: 'function', signature: cleanSignature(sig) });
      } else {
        pending = { kind: 'function', parts: [sig] };
      }
      continue;
    }

    const ifaceMatch = trimmed.match(INTERFACE_RE);
    if (ifaceMatch) {
      entries.push({ kind: 'interface', signature: extractName(ifaceMatch[0], 'interface') });
      continue;
    }

    const typeMatch = trimmed.match(TYPE_RE);
    if (typeMatch) {
      entries.push({ kind: 'type', signature: trimmed });
      continue;
    }
  }

  return entries;
}

function isComplete(sig: string): boolean {
  return sig.includes(')') || sig.includes('{');
}

function cleanSignature(sig: string): string {
  return sig.replace(/\s*\{?\s*$/, '').trim();
}

function extractName(match: string, keyword: string): string {
  const re = new RegExp(`export\\s+${keyword}\\s+(\\w+)`);
  const m = match.match(re);
  return m ? `export ${keyword} ${m[1]}` : match.replace(/\s*\{.*/, '').trim();
}

function finalizePending(pending: {
  kind: SignatureEntry['kind'];
  parts: string[];
}): SignatureEntry {
  const joined = pending.parts.join(' ');
  return { kind: pending.kind, signature: cleanSignature(joined) };
}

/**
 * Capture interface snapshots for files matching the given glob patterns.
 */
export function captureInterfaceSnapshot(
  projectDir: string,
  patterns: string[]
): InterfaceSnapshot {
  const snapshot: InterfaceSnapshot = [];

  for (const pattern of patterns) {
    const files = resolveGlobFiles(projectDir, pattern);
    for (const absPath of files) {
      const relPath = relative(projectDir, absPath);
      const fileSnap = snapshotFile(absPath, relPath);
      if (fileSnap) snapshot.push(fileSnap);
    }
  }

  return deduplicateByFile(snapshot);
}

function resolveGlobFiles(projectDir: string, pattern: string): string[] {
  try {
    // Node 22+ globSync from node:fs
    return globSync(pattern, { cwd: projectDir }).map((f) => join(projectDir, f));
  } catch {
    return [];
  }
}

function snapshotFile(absPath: string, relPath: string): FileSnapshot | null {
  try {
    const content = readFileSync(absPath, 'utf-8');
    const signatures = extractSignaturesFromContent(content);
    if (signatures.length === 0) return null;
    return { file: relPath, signatures };
  } catch {
    return null;
  }
}

function deduplicateByFile(snapshots: FileSnapshot[]): InterfaceSnapshot {
  const seen = new Set<string>();
  return snapshots.filter((s) => {
    if (seen.has(s.file)) return false;
    seen.add(s.file);
    return true;
  });
}

/**
 * Format an interface snapshot for inclusion in a dispatch brief.
 */
export function formatInterfaceSnapshotBrief(snapshot: InterfaceSnapshot): string {
  if (snapshot.length === 0) return '';

  const lines: string[] = [];
  lines.push('--- Interface Snapshot ---');
  lines.push('Current exported signatures in scope files:');

  for (const file of snapshot) {
    lines.push(`  ${file.file}`);
    for (const entry of file.signatures) {
      lines.push(`    [${entry.kind}] ${entry.signature}`);
    }
  }

  return lines.join('\n');
}
