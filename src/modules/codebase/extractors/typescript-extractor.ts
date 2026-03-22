import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import type {
  ExportSignature,
  ExportKind,
  InternalDependency,
  ExternalDependency,
  ModuleDependencies,
  ModuleSummary,
} from '../types.js';

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

const NAMED_EXPORT_RE =
  /^export\s+(?:declare\s+)?(?:async\s+)?(function|class|interface|type|const|let|enum)\s+/;

/** Trim a signature at the first opening brace or semicolon boundary. */
function trimSignature(line: string): string {
  // Remove trailing opening brace (and anything after)
  const braceIdx = line.indexOf('{');
  const semi = line.indexOf(';');
  const cutAt =
    braceIdx >= 0 && semi >= 0
      ? Math.min(braceIdx, semi)
      : braceIdx >= 0
        ? braceIdx
        : semi >= 0
          ? semi
          : line.length;
  return line.slice(0, cutAt).trim();
}

/** Join continuation lines for multiline signatures (e.g. params spanning lines). */
function joinMultilineSignature(lines: string[], startIdx: number): string {
  let combined = lines[startIdx];
  let openParens = countChar(combined, '(') - countChar(combined, ')');
  let openAngles = countChar(combined, '<') - countChar(combined, '>');
  let i = startIdx + 1;
  while ((openParens > 0 || openAngles > 0) && i < lines.length) {
    combined += ' ' + lines[i].trim();
    openParens += countChar(lines[i], '(') - countChar(lines[i], ')');
    openAngles += countChar(lines[i], '<') - countChar(lines[i], '>');
    i++;
  }
  return combined;
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

function extractNameFromSignature(sig: string, kind: ExportKind): string {
  const afterKind = sig.replace(
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+/,
    '',
  );
  const match = afterKind.match(/^(\w+)/);
  return match ? match[1] : kind;
}

function normaliseKind(raw: string): ExportKind {
  if (raw === 'let') return 'const';
  return raw as ExportKind;
}

/** Parse `export { A, B as C }` or `export { A } from '...'` */
function parseReExports(line: string): ExportSignature[] {
  const inner = line.match(/export\s*\{([^}]+)\}/);
  if (!inner) return [];
  return inner[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0]).trim();
      return { name, kind: 'const' as ExportKind, signature: trimSignature(line) };
    });
}

function parseDefaultExport(line: string): ExportSignature {
  const sig = trimSignature(line);
  // export default function name / class name
  const namedMatch = line.match(/export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/);
  const name = namedMatch ? namedMatch[1] : 'default';
  const kindMatch = line.match(/export\s+default\s+(?:async\s+)?(function|class)/);
  const kind: ExportKind = kindMatch ? (kindMatch[1] as ExportKind) : 'const';
  return { name, kind, signature: sig };
}

export function extractExports(content: string): ExportSignature[] {
  const lines = content.split('\n');
  const results: ExportSignature[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!trimmed.startsWith('export')) continue;

    // Re-exports: export { ... }
    if (/^export\s*\{/.test(trimmed)) {
      results.push(...parseReExports(trimmed));
      continue;
    }

    // Default exports
    if (/^export\s+default\b/.test(trimmed)) {
      results.push(parseDefaultExport(trimmed));
      continue;
    }

    // Named exports
    const namedMatch = trimmed.match(NAMED_EXPORT_RE);
    if (namedMatch) {
      const rawKind = namedMatch[1];
      const kind = normaliseKind(rawKind);
      const full = joinMultilineSignature(lines, i);
      const signature = trimSignature(full.trimStart());
      const name = extractNameFromSignature(signature, kind);
      results.push({ name, kind, signature });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

const IMPORT_RE = /^import\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+)(?:\s*,\s*\{([^}]*)\})?)\s+from\s+['"]([^'"]+)['"]/;
const SIDE_EFFECT_IMPORT_RE = /^import\s+['"]([^'"]+)['"]/;

function parseImportSymbols(braceContent: string | undefined): string[] {
  if (!braceContent) return [];
  return braceContent
    .split(',')
    .map((s) => {
      const parts = s.trim().split(/\s+as\s+/);
      return (parts[1] ?? parts[0]).replace(/^type\s+/, '').trim();
    })
    .filter(Boolean);
}

function isInternalSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

export function extractDependencies(
  content: string,
  filePath: string
): ModuleDependencies {
  const internal: InternalDependency[] = [];
  const external: ExternalDependency[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('import')) continue;

    const match = trimmed.match(IMPORT_RE);
    if (match) {
      const [, braceImports, defaultImport, additionalBrace, specifier] = match;
      const symbols = [
        ...parseImportSymbols(braceImports),
        ...(defaultImport ? [defaultImport] : []),
        ...parseImportSymbols(additionalBrace),
      ];
      if (isInternalSpecifier(specifier)) {
        internal.push({ path: specifier, imports: symbols });
      } else {
        external.push({ package: specifier, imports: symbols });
      }
      continue;
    }

    // Side-effect import (import 'foo')
    const sideEffect = trimmed.match(SIDE_EFFECT_IMPORT_RE);
    if (sideEffect) {
      const specifier = sideEffect[1];
      if (isInternalSpecifier(specifier)) {
        internal.push({ path: specifier, imports: [] });
      } else {
        external.push({ package: specifier, imports: [] });
      }
    }
  }

  return { internal, external };
}

// ---------------------------------------------------------------------------
// Purpose extraction
// ---------------------------------------------------------------------------

export function extractModulePurpose(content: string): string | undefined {
  const trimmed = content.trimStart();

  // Leading JSDoc: /** ... */
  const jsdocMatch = trimmed.match(/^\/\*\*\s*([\s\S]*?)\s*\*\//);
  if (jsdocMatch) {
    return jsdocMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)
      .join(' ');
  }

  // Leading line comment(s) before any code
  const lines = trimmed.split('\n');
  const commentLines: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith('//')) {
      commentLines.push(l.replace(/^\/\/\s?/, '').trim());
    } else if (l === '') {
      if (commentLines.length > 0) break;
    } else {
      break;
    }
  }

  return commentLines.length > 0 ? commentLines.join(' ') : undefined;
}

// ---------------------------------------------------------------------------
// Export hash
// ---------------------------------------------------------------------------

export function computeExportsHash(exports: ExportSignature[]): string {
  const sorted = [...exports].sort((a, b) => a.name.localeCompare(b.name));
  const combined = sorted.map((e) => e.signature).join('\n');
  return createHash('sha256').update(combined).digest('hex');
}

// ---------------------------------------------------------------------------
// Combined per-file extraction
// ---------------------------------------------------------------------------

export function extractFileInfo(
  filePath: string,
  content: string,
  projectRoot?: string
): ModuleSummary {
  const exports = extractExports(content);
  const dependencies = extractDependencies(content, filePath);
  const exportHash = computeExportsHash(exports);
  const modulePath = projectRoot ? relative(projectRoot, filePath) : filePath;

  return {
    modulePath,
    language: 'typescript',
    exports,
    dependencies,
    exportHash,
  };
}
