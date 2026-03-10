import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { Result } from '../errors.js';
import type { ProjectMetadata, ProjectCommands, ProjectBranchPrefix } from '../types.js';
import { ok, fail } from '../errors.js';
import { validatePrefix } from '../ids.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes, getProjectNotes } from './queries.js';

export interface CreateProjectInput {
  name: string;
  prefix: string;
  phase?: string;
  wipLimit?: number;
  path?: string;
  remote?: string;
  defaultBranch?: string;
  reviewThreshold?: number;
  packageName?: string;
  packageManager?: string;
  commands?: ProjectCommands;
  branchPrefix?: ProjectBranchPrefix;
  notes?: Record<string, string>;
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

  if (input.path) lines.push(`path: "${input.path}"`);
  if (input.remote) lines.push(`remote: "${input.remote}"`);
  if (input.defaultBranch) lines.push(`default_branch: "${input.defaultBranch}"`);
  if (input.reviewThreshold !== undefined) lines.push(`review_threshold: ${input.reviewThreshold}`);
  if (input.packageName) lines.push(`package_name: "${input.packageName}"`);
  if (input.packageManager) lines.push(`package_manager: "${input.packageManager}"`);
  if (input.commands) lines.push(`commands: '${JSON.stringify(input.commands)}'`);
  if (input.branchPrefix) lines.push(`branch_prefix: '${JSON.stringify(input.branchPrefix)}'`);
  if (input.notes) lines.push(`notes: '${JSON.stringify(input.notes)}'`);

  lines.push(`created: ${now}`, `modified: ${now}`, '---', '', `# ${input.name}`, '');
  return lines.join('\n');
}

export async function createProject(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CreateProjectInput
): Promise<Result<ProjectMetadata>> {
  if (!validatePrefix(input.prefix)) {
    return fail(
      'INVALID_INPUT',
      `Invalid prefix "${input.prefix}": must be 2-5 uppercase alphanumeric characters`
    );
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
    path: input.path,
    remote: input.remote,
    default_branch: input.defaultBranch,
    review_threshold: input.reviewThreshold,
    package_name: input.packageName,
    package_manager: input.packageManager,
    commands: input.commands,
    branch_prefix: input.branchPrefix,
    notes: input.notes,
  };

  return ok(metadata);
}

function projectMetaFromRecord(meta: Record<string, unknown>): ProjectMetadata {
  const parseJsonField = <T>(val: unknown): T | undefined => {
    if (!val) return undefined;
    if (typeof val === 'object') return val as T;
    if (typeof val === 'string') {
      try {
        return JSON.parse(val) as T;
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  return {
    title: (meta.title as string) ?? undefined,
    display_id: meta.display_id as string,
    prefix: meta.prefix as string,
    status: meta.status as ProjectMetadata['status'],
    phase: meta.phase as string | undefined,
    wip_limit: meta.wip_limit as number | undefined,
    path: meta.path as string | undefined,
    remote: meta.remote as string | undefined,
    default_branch: meta.default_branch as string | undefined,
    review_threshold: meta.review_threshold as number | undefined,
    package_name: meta.package_name as string | undefined,
    package_manager: meta.package_manager as string | undefined,
    commands: parseJsonField<ProjectCommands>(meta.commands),
    branch_prefix: parseJsonField<ProjectBranchPrefix>(meta.branch_prefix),
    notes: parseJsonField<Record<string, string>>(meta.notes),
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

function availableProjectsList(db: BrainDB): string {
  const notes = getPmNotes(db, 'project');
  const prefixes = notes
    .map((n) => {
      if (!n.metadata) return undefined;
      const m = JSON.parse(n.metadata) as Record<string, unknown>;
      return m.prefix as string | undefined;
    })
    .filter((p): p is string => !!p);
  return prefixes.length > 0 ? ` Available: ${prefixes.join(', ')}` : '';
}

export function getProject(db: BrainDB, prefix: string): Result<ProjectMetadata> {
  const notes = getPmNotes(db, 'project', { prefix });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found.${availableProjectsList(db)}`);
  }

  const meta = JSON.parse(notes[0].metadata!) as Record<string, unknown>;
  return ok(projectMetaFromRecord(meta));
}

export async function updateProject(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  prefix: string,
  updates: Partial<
    Pick<
      ProjectMetadata,
      | 'status'
      | 'phase'
      | 'wip_limit'
      | 'path'
      | 'remote'
      | 'default_branch'
      | 'review_threshold'
      | 'package_name'
      | 'package_manager'
      | 'commands'
      | 'branch_prefix'
      | 'notes'
    >
  >
): Promise<Result<ProjectMetadata>> {
  const notes = getPmNotes(db, 'project', { prefix });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found.${availableProjectsList(db)}`);
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
  if (updates.path !== undefined) {
    updated = replaceFrontmatterField(updated, 'path', `"${updates.path}"`);
  }
  if (updates.remote !== undefined) {
    updated = replaceFrontmatterField(updated, 'remote', `"${updates.remote}"`);
  }
  if (updates.default_branch !== undefined) {
    updated = replaceFrontmatterField(updated, 'default_branch', `"${updates.default_branch}"`);
  }
  if (updates.review_threshold !== undefined) {
    updated = replaceFrontmatterField(
      updated,
      'review_threshold',
      String(updates.review_threshold)
    );
  }
  if (updates.package_name !== undefined) {
    updated = replaceFrontmatterField(updated, 'package_name', `"${updates.package_name}"`);
  }
  if (updates.package_manager !== undefined) {
    updated = replaceFrontmatterField(updated, 'package_manager', `"${updates.package_manager}"`);
  }
  if (updates.commands !== undefined) {
    updated = replaceFrontmatterField(updated, 'commands', `'${JSON.stringify(updates.commands)}'`);
  }
  if (updates.branch_prefix !== undefined) {
    updated = replaceFrontmatterField(
      updated,
      'branch_prefix',
      `'${JSON.stringify(updates.branch_prefix)}'`
    );
  }
  if (updates.notes !== undefined) {
    updated = replaceFrontmatterField(updated, 'notes', `'${JSON.stringify(updates.notes)}'`);
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
  force?: boolean
): Promise<Result<void>> {
  const notes = getPmNotes(db, 'project', { prefix });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found.${availableProjectsList(db)}`);
  }

  const projectNotes = getProjectNotes(db, prefix);
  const nonProjectNotes = projectNotes.filter((n) => n.id !== notes[0].id);

  if (nonProjectNotes.length > 0 && !force) {
    return fail(
      'HAS_DEPENDENTS',
      `Project "${prefix}" has ${nonProjectNotes.length} dependent note(s). Use force to delete.`,
      { count: nonProjectNotes.length }
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
  const isAlreadyQuoted =
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'));
  const quoted = isAlreadyQuoted ? value : value.includes(' ') ? `"${value}"` : value;

  if (fieldRegex.test(frontmatter)) {
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }
  return frontmatter + `\n${field}: ${quoted}` + rest;
}
