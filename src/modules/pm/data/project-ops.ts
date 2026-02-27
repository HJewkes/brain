import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { Result } from '../errors.js';
import type { ProjectMetadata } from '../types.js';
import { ok, fail } from '../errors.js';
import { validatePrefix } from '../ids.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes, getProjectNotes } from './queries.js';

export interface CreateProjectInput {
  name: string;
  prefix: string;
  phase?: string;
  wipLimit?: number;
}

function projectFilePath(config: BrainConfig, prefix: string): string {
  return join(config.notesDir, 'modules', 'pm', prefix, 'project.md');
}

function buildProjectMarkdown(input: CreateProjectInput): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    '---',
    `id: ${input.prefix.toLowerCase()}-project`,
    `title: "Project ${input.name}"`,
    'type: project',
    'tier: slow',
    'module: pm',
    `prefix: ${input.prefix}`,
    `display_id: ${input.prefix}`,
    'status: active',
  ];

  if (input.phase) {
    lines.push(`phase: ${input.phase}`);
  }
  if (input.wipLimit !== undefined) {
    lines.push(`wip_limit: ${input.wipLimit}`);
  }

  lines.push(`created: ${now}`, `modified: ${now}`, '---', '', `# ${input.name}`, '');
  return lines.join('\n');
}


export async function createProject(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CreateProjectInput,
): Promise<Result<ProjectMetadata>> {
  if (!validatePrefix(input.prefix)) {
    return fail('INVALID_INPUT', `Invalid prefix "${input.prefix}": must be 2-5 uppercase alphanumeric characters`);
  }

  const existing = getPmNotes(db, 'project', { prefix: input.prefix });
  if (existing.length > 0) {
    return fail('PROJECT_EXISTS', `Project with prefix "${input.prefix}" already exists`);
  }

  const filePath = projectFilePath(config, input.prefix);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const markdown = buildProjectMarkdown(input);
  writeFileSync(filePath, markdown, 'utf-8');

  const hash = createHash('sha256').update(markdown).digest('hex');
  await indexSingleFile(db, embedder, filePath, markdown, hash, Date.now());

  const metadata: ProjectMetadata = {
    display_id: input.prefix,
    prefix: input.prefix,
    status: 'active',
    phase: input.phase,
    wip_limit: input.wipLimit,
  };

  return ok(metadata);
}

function projectMetaFromRecord(meta: Record<string, unknown>): ProjectMetadata {
  return {
    display_id: meta.display_id as string,
    prefix: meta.prefix as string,
    status: meta.status as ProjectMetadata['status'],
    phase: meta.phase as string | undefined,
    wip_limit: meta.wip_limit as number | undefined,
  };
}

export function listProjects(db: BrainDB): Result<ProjectMetadata[]> {
  const notes = getPmNotes(db, 'project');
  const projects: ProjectMetadata[] = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    return projectMetaFromRecord(meta);
  });

  return ok(projects);
}

export function getProject(db: BrainDB, prefix: string): Result<ProjectMetadata> {
  const notes = getPmNotes(db, 'project', { prefix });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found`);
  }

  const meta = JSON.parse(notes[0].metadata!) as Record<string, unknown>;
  return ok(projectMetaFromRecord(meta));
}

export async function updateProject(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  prefix: string,
  updates: Partial<Pick<ProjectMetadata, 'status' | 'phase' | 'wip_limit'>>,
): Promise<Result<ProjectMetadata>> {
  const notes = getPmNotes(db, 'project', { prefix });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found`);
  }

  const note = notes[0];
  const filePath = note.filePath;

  if (!existsSync(filePath)) {
    return fail('NOT_FOUND', `Project file not found at "${filePath}"`);
  }

  const content = readFileSync(filePath, 'utf-8');
  let updated = content;

  if (updates.status !== undefined) {
    updated = replaceFrontmatterField(updated, 'status', updates.status);
  }
  if (updates.phase !== undefined) {
    updated = replaceFrontmatterField(updated, 'phase', updates.phase);
  }
  if (updates.wip_limit !== undefined) {
    updated = replaceFrontmatterField(updated, 'wip_limit', String(updates.wip_limit));
  }

  const now = new Date().toISOString().slice(0, 10);
  updated = replaceFrontmatterField(updated, 'modified', now);

  writeFileSync(filePath, updated, 'utf-8');

  const hash = createHash('sha256').update(updated).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, updated, hash, Date.now());

  const refreshedNote = db.getNoteById(noteId);
  const meta = JSON.parse(refreshedNote!.metadata!) as Record<string, unknown>;

  return ok(projectMetaFromRecord(meta));
}

export async function deleteProject(
  db: BrainDB,
  config: BrainConfig,
  prefix: string,
  force?: boolean,
): Promise<Result<void>> {
  const notes = getPmNotes(db, 'project', { prefix });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found`);
  }

  const projectNotes = getProjectNotes(db, prefix);
  const nonProjectNotes = projectNotes.filter((n) => n.id !== notes[0].id);

  if (nonProjectNotes.length > 0 && !force) {
    return fail(
      'HAS_DEPENDENTS',
      `Project "${prefix}" has ${nonProjectNotes.length} dependent note(s). Use force to delete.`,
      { count: nonProjectNotes.length },
    );
  }

  if (force) {
    for (const note of projectNotes) {
      db.deleteNote(note.id);
      if (existsSync(note.filePath)) {
        unlinkSync(note.filePath);
      }
    }
  } else {
    const projectNote = notes[0];
    db.deleteNote(projectNote.id);
    if (existsSync(projectNote.filePath)) {
      unlinkSync(projectNote.filePath);
    }
  }

  const projectDir = join(config.notesDir, 'modules', 'pm', prefix);
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }

  return ok(undefined);
}

function replaceFrontmatterField(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
  const quoted = value.includes(' ') ? `"${value}"` : value;

  if (fieldRegex.test(frontmatter)) {
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }
  return frontmatter + `\n${field}: ${quoted}` + rest;
}
