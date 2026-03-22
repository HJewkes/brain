import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  ModuleSummary,
  ExportSignature,
  InternalDependency,
  ExternalDependency,
} from './types.js';
import type { ScanResult } from './scanner.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface NoteGeneratorOptions {
  projectName: string;
  outputDir: string;
  dryRun?: boolean;
  forceAll?: boolean;
}

export interface NoteGeneratorResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  notes: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Convert a module path to a note file path. */
export function buildNotePath(outputDir: string, modulePath: string): string {
  const slug = modulePath.replace(/\//g, '-');
  return join(outputDir, `${slug}.md`);
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/** Write a note file, creating directories as needed. */
export function writeNote(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Frontmatter generation
// ---------------------------------------------------------------------------

function buildFrontmatter(summary: ModuleSummary, projectName: string, now: string): string {
  const lines = [
    '---',
    `title: "Architecture: ${summary.modulePath}"`,
    'type: architecture',
    'tier: slow',
    'module: codebase',
    `module-path: ${summary.modulePath}`,
    `language: ${summary.language}`,
    `exports-hash: "${summary.exportHash}"`,
    `tags: [architecture, ${summary.language}, ${projectName}]`,
    `created: ${now}`,
    `modified: ${now}`,
    '---',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Body section builders
// ---------------------------------------------------------------------------

function buildPurposeSection(purpose?: string): string {
  const text = purpose || 'No module-level documentation found.';
  return `## Purpose\n\n${text}`;
}

function buildExportRow(exp: ExportSignature): string {
  const sig = exp.signature.replace(/\|/g, '\\|');
  return `| ${exp.name} | ${exp.kind} | ${sig} |`;
}

function buildPublicApiSection(exports: ExportSignature[]): string {
  const sorted = [...exports].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  const header = '## Public API\n\n| Export | Kind | Signature |\n|--------|------|-----------|';
  if (sorted.length === 0) {
    return `${header}\n| *(none)* | | |`;
  }
  const rows = sorted.map(buildExportRow);
  return `${header}\n${rows.join('\n')}`;
}

function buildInternalDeps(deps: InternalDependency[]): string {
  const sorted = [...deps].sort((a, b) => a.path.localeCompare(b.path));
  if (sorted.length === 0) return '### Internal\n\n*(none)*';
  const lines = sorted.map((d) => {
    const imports = [...d.imports].sort().join(', ');
    return `- \`${d.path}\` — ${imports}`;
  });
  return `### Internal\n\n${lines.join('\n')}`;
}

function buildExternalDeps(deps: ExternalDependency[]): string {
  const sorted = [...deps].sort((a, b) => a.package.localeCompare(b.package));
  if (sorted.length === 0) return '### External\n\n*(none)*';
  const lines = sorted.map((d) => {
    const imports = [...d.imports].sort().join(', ');
    return `- \`${d.package}\` — ${imports}`;
  });
  return `### External\n\n${lines.join('\n')}`;
}

function buildDependenciesSection(summary: ModuleSummary): string {
  const internal = buildInternalDeps(summary.dependencies.internal);
  const external = buildExternalDeps(summary.dependencies.external);
  return `## Dependencies\n\n${internal}\n\n${external}`;
}

// ---------------------------------------------------------------------------
// Single note generation
// ---------------------------------------------------------------------------

/** Generate a complete markdown note from a ModuleSummary. */
export function generateArchitectureNote(summary: ModuleSummary, projectName: string): string {
  const now = new Date().toISOString();
  const frontmatter = buildFrontmatter(summary, projectName, now);
  const purpose = buildPurposeSection();
  const api = buildPublicApiSection(summary.exports);
  const deps = buildDependenciesSection(summary);
  const invariants = '## Invariants\n\n*(none yet)*';

  return `${frontmatter}\n\n${purpose}\n\n${api}\n\n${deps}\n\n${invariants}\n`;
}

// ---------------------------------------------------------------------------
// Update logic — preserve hand-edited sections
// ---------------------------------------------------------------------------

function extractSection(content: string, heading: string): string | undefined {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  if (start === -1) return undefined;

  const bodyStart = content.indexOf('\n', start);
  if (bodyStart === -1) return undefined;

  const nextHeading = content.indexOf('\n## ', bodyStart);
  const body =
    nextHeading === -1 ? content.slice(bodyStart + 1) : content.slice(bodyStart + 1, nextHeading);

  return body.trimEnd() || undefined;
}

function replaceFrontmatterField(content: string, field: string, value: string): string {
  const pattern = new RegExp(`^(${field}:)\\s*.+$`, 'm');
  if (pattern.test(content)) {
    return content.replace(pattern, `$1 ${value}`);
  }
  return content;
}

/** Update an existing note, preserving hand-edited Invariants. */
export function updateArchitectureNote(
  existing: string,
  summary: ModuleSummary,
  projectName: string
): string {
  const now = new Date().toISOString();

  let updated = replaceFrontmatterField(existing, 'exports-hash', `"${summary.exportHash}"`);
  updated = replaceFrontmatterField(updated, 'modified', now);

  const existingInvariants = extractSection(existing, 'Invariants');

  const api = buildPublicApiSection(summary.exports);
  const deps = buildDependenciesSection(summary);
  const invariantsBody = existingInvariants || '*(none yet)*';
  const invariants = `## Invariants\n\n${invariantsBody}`;

  const bodyStart = updated.indexOf('\n---\n', 4);
  if (bodyStart === -1) return generateArchitectureNote(summary, projectName);

  const frontmatter = updated.slice(0, bodyStart + 5);
  const existingPurpose = extractSection(existing, 'Purpose');
  const defaultPurpose = 'No module-level documentation found.';
  const purposeText =
    existingPurpose && existingPurpose !== defaultPurpose ? existingPurpose : defaultPurpose;

  const body = [buildPurposeSection(purposeText), api, deps, invariants].join('\n\n');

  return `${frontmatter}\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Batch generation
// ---------------------------------------------------------------------------

/** Batch generate/update notes for scan results. */
export function generateNotes(
  scanResult: ScanResult,
  options: NoteGeneratorOptions
): NoteGeneratorResult {
  const { projectName, outputDir, dryRun, forceAll } = options;
  const changedSet = new Set(scanResult.changed);
  const result: NoteGeneratorResult = {
    created: [],
    updated: [],
    unchanged: [],
    notes: new Map(),
  };

  for (const summary of scanResult.modules) {
    const isChanged = changedSet.has(summary.modulePath);
    if (!forceAll && !isChanged) {
      result.unchanged.push(summary.modulePath);
      continue;
    }

    const filePath = buildNotePath(outputDir, summary.modulePath);
    const existingContent = readExistingNote(filePath);
    const content = existingContent
      ? updateArchitectureNote(existingContent, summary, projectName)
      : generateArchitectureNote(summary, projectName);

    result.notes.set(summary.modulePath, content);

    if (existingContent) {
      result.updated.push(filePath);
    } else {
      result.created.push(filePath);
    }

    if (!dryRun) {
      writeNote(filePath, content);
    }
  }

  return result;
}

function readExistingNote(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, 'utf-8');
}
