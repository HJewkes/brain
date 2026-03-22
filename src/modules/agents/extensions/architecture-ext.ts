import type { DispatchExtension, DispatchExtensionInput } from '../dispatch-extensions.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { NoteRecord } from '../../../types.js';
import { getPmNotes } from '../../pm/data/queries.js';
import type { TaskMetadata } from '../../pm/types.js';
import { readTaskBody } from '../../pm/engine/dispatch.js';

export interface ArchitectureModuleInfo {
  modulePath: string;
  purpose: string;
  exports: string[];
  dependencies: string[];
  invariants: string[];
}

export interface ArchitectureContext {
  relevantModules: ArchitectureModuleInfo[];
  relatedPatterns: string[];
}

/**
 * Extract module/file path references from task text.
 * Looks for patterns like src/modules/..., src/services/..., etc.
 */
export function extractModuleReferences(text: string): string[] {
  const pattern = /(?:^|\s|`)((?:src|__tests__)\/[\w./-]+)/g;
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const p = match[1];
    if (/\.\w+$/.test(p)) {
      paths.add(p);
    } else {
      paths.add(p.replace(/\/$/, ''));
    }
  }
  return [...paths].sort();
}

function getTaskText(db: BrainDB, taskDisplayId: string): string {
  const notes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (notes.length === 0) return '';
  const meta = JSON.parse(notes[0].metadata!) as TaskMetadata;
  const body = readTaskBody(notes[0]);
  return [meta.title ?? '', body].join('\n');
}

function findArchitectureNotes(db: BrainDB): NoteRecord[] {
  const noteIds = db.getModuleNoteIds({ module: 'codebase', type: 'architecture' });
  if (noteIds.length === 0) return [];
  const notes = db.getNotesByIds(noteIds);
  return [...notes.values()];
}

function parseModulePath(note: NoteRecord): string | null {
  if (!note.metadata) return null;
  try {
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    return (meta['module-path'] as string) ?? null;
  } catch {
    return null;
  }
}

function matchesReference(modulePath: string, references: string[]): boolean {
  return references.some(
    (ref) => modulePath === ref || modulePath.startsWith(ref + '/') || ref.startsWith(modulePath)
  );
}

function extractSection(content: string, heading: string): string | undefined {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  if (start === -1) return undefined;

  const bodyStart = content.indexOf('\n', start);
  if (bodyStart === -1) return undefined;

  const nextHeading = content.indexOf('\n## ', bodyStart);
  const body =
    nextHeading === -1 ? content.slice(bodyStart + 1) : content.slice(bodyStart + 1, nextHeading);

  return body.trim() || undefined;
}

function parseExportsFromSection(section: string | undefined): string[] {
  if (!section) return [];
  const exports: string[] = [];
  const lines = section.split('\n');
  for (const line of lines) {
    const match = /^\|\s*(\w+)\s*\|/.exec(line);
    if (match && match[1] !== 'Export' && match[1] !== '*(none)*') {
      exports.push(match[1]);
    }
  }
  return exports;
}

function parseDependenciesFromSection(section: string | undefined): string[] {
  if (!section) return [];
  const deps: string[] = [];
  const lines = section.split('\n');
  for (const line of lines) {
    const match = /^-\s*`([^`]+)`/.exec(line);
    if (match) deps.push(match[1]);
  }
  return deps;
}

function parseInvariantsFromSection(section: string | undefined): string[] {
  if (!section || section === '*(none yet)*') return [];
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== '*(none yet)*');
}

function buildModuleInfo(note: NoteRecord, modulePath: string): ArchitectureModuleInfo {
  const chunks = getBodyContent(note);
  const purpose = extractSection(chunks, 'Purpose') ?? 'Unknown';
  const apiSection = extractSection(chunks, 'Public API');
  const depsSection = extractSection(chunks, 'Dependencies');
  const invariantsSection = extractSection(chunks, 'Invariants');

  return {
    modulePath,
    purpose,
    exports: parseExportsFromSection(apiSection),
    dependencies: parseDependenciesFromSection(depsSection),
    invariants: parseInvariantsFromSection(invariantsSection),
  };
}

function getBodyContent(note: NoteRecord): string {
  // Use l1Overview if available, otherwise fall back to title
  return note.l1Overview ?? note.title ?? '';
}

function collectRelatedPatterns(db: BrainDB, noteIds: string[]): string[] {
  const patterns: string[] = [];
  for (const noteId of noteIds.slice(0, 5)) {
    const memories = db.getMemoriesForNote(noteId);
    for (const m of memories) {
      if (!patterns.includes(m.memory)) {
        patterns.push(m.memory);
      }
    }
  }
  return patterns.slice(0, 5);
}

function computeArchitecture(input: DispatchExtensionInput): ArchitectureContext | undefined {
  try {
    const { db, taskDisplayId } = input;
    const taskText = getTaskText(db, taskDisplayId);
    if (!taskText) return undefined;

    const references = extractModuleReferences(taskText);
    if (references.length === 0) return undefined;

    const archNotes = findArchitectureNotes(db);
    if (archNotes.length === 0) return undefined;

    const relevantModules: ArchitectureModuleInfo[] = [];
    const matchedNoteIds: string[] = [];
    for (const note of archNotes) {
      const modulePath = parseModulePath(note);
      if (!modulePath) continue;
      if (!matchesReference(modulePath, references)) continue;
      relevantModules.push(buildModuleInfo(note, modulePath));
      matchedNoteIds.push(note.id);
    }

    if (relevantModules.length === 0) return undefined;

    const relatedPatterns = collectRelatedPatterns(db, matchedNoteIds);

    return { relevantModules, relatedPatterns };
  } catch {
    return undefined;
  }
}

function formatModuleSection(mod: ArchitectureModuleInfo): string {
  const lines: string[] = [];
  lines.push(`### ${mod.modulePath}`);
  lines.push(`**Purpose:** ${mod.purpose}`);

  if (mod.exports.length > 0) {
    lines.push(`**Key Exports:** ${mod.exports.join(', ')}`);
  }
  if (mod.dependencies.length > 0) {
    lines.push(`**Dependencies:** ${mod.dependencies.join(', ')}`);
  }
  if (mod.invariants.length > 0) {
    lines.push(`**Invariants:** ${mod.invariants.join('; ')}`);
  }

  return lines.join('\n');
}

function formatArchitectureContext(data: ArchitectureContext, _taskId: string): string | null {
  if (data.relevantModules.length === 0) return null;

  const lines: string[] = [];
  lines.push('## Relevant Architecture');
  lines.push('');

  for (const mod of data.relevantModules) {
    lines.push(formatModuleSection(mod));
    lines.push('');
  }

  if (data.relatedPatterns.length > 0) {
    lines.push('### Related Patterns');
    for (const pattern of data.relatedPatterns) {
      lines.push(`- ${pattern}`);
    }
  }

  return lines.join('\n').trimEnd();
}

export const architectureExtension: DispatchExtension = {
  name: 'architecture',

  compute(input: DispatchExtensionInput): ArchitectureContext | undefined {
    return computeArchitecture(input);
  },

  format(data: unknown, taskId: string): string | null {
    if (!data) return null;
    return formatArchitectureContext(data as ArchitectureContext, taskId);
  },
};
