import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { replaceFrontmatterField } from '../../../utils.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes, getAllProjectPrefixes } from '../data/queries.js';
import { validatePrefix } from '../ids.js';

export interface RenamePrefixResult {
  projectsRenamed: number;
  workstreamsRenamed: number;
  tasksRenamed: number;
  filesRenamed: string[];
}

export interface RenamePrefixOptions {
  dryRun?: boolean;
}

export async function renameProjectPrefix(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  oldPrefix: string,
  newPrefix: string,
  options: RenamePrefixOptions = {}
): Promise<RenamePrefixResult> {
  validatePrefixes(oldPrefix, newPrefix, db);

  const result: RenamePrefixResult = {
    projectsRenamed: 0,
    workstreamsRenamed: 0,
    tasksRenamed: 0,
    filesRenamed: [],
  };

  const projectNotes = getPmNotes(db, 'project', { prefix: oldPrefix });
  const workstreamNotes = getPmNotes(db, 'workstream', { project: oldPrefix });
  const taskNotes = getPmNotes(db, 'task', { project: oldPrefix });

  if (options.dryRun) {
    return computeDryRunResult(projectNotes, workstreamNotes, taskNotes, oldPrefix, newPrefix);
  }

  for (const note of taskNotes) {
    await renameTaskNote(db, config, embedder, note, oldPrefix, newPrefix, result);
  }

  for (const note of workstreamNotes) {
    await renameWorkstreamNote(db, config, embedder, note, oldPrefix, newPrefix, result);
  }

  for (const note of projectNotes) {
    await renameProjectNote(db, config, embedder, note, oldPrefix, newPrefix, result);
  }

  return result;
}

function validatePrefixes(oldPrefix: string, newPrefix: string, db: BrainDB): void {
  if (!validatePrefix(oldPrefix)) {
    throw new Error(
      `Invalid old prefix "${oldPrefix}": must be 2-5 uppercase alphanumeric characters`
    );
  }
  if (!validatePrefix(newPrefix)) {
    throw new Error(
      `Invalid new prefix "${newPrefix}": must be 2-5 uppercase alphanumeric characters`
    );
  }

  const existing = getAllProjectPrefixes(db);
  if (!existing.includes(oldPrefix)) {
    throw new Error(`Project with prefix "${oldPrefix}" not found`);
  }
  if (existing.includes(newPrefix)) {
    throw new Error(`Project with prefix "${newPrefix}" already exists`);
  }
}

function computeDryRunResult(
  projectNotes: { filePath: string }[],
  workstreamNotes: { filePath: string; metadata?: string | null }[],
  taskNotes: { filePath: string; metadata?: string | null }[],
  oldPrefix: string,
  newPrefix: string
): RenamePrefixResult {
  const filesRenamed: string[] = [];

  for (const note of projectNotes) {
    const newPath = note.filePath.replace(`/${oldPrefix}/`, `/${newPrefix}/`);
    filesRenamed.push(`${note.filePath} -> ${newPath}`);
  }
  for (const note of workstreamNotes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const oldId = meta.display_id as string;
    const newId = oldId.replace(oldPrefix, newPrefix);
    const newPath = note.filePath
      .replace(`/${oldPrefix}/`, `/${newPrefix}/`)
      .replace(`${oldId}.md`, `${newId}.md`);
    filesRenamed.push(`${note.filePath} -> ${newPath}`);
  }
  for (const note of taskNotes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const oldId = meta.display_id as string;
    const newId = oldId.replace(oldPrefix, newPrefix);
    const newPath = note.filePath
      .replace(`/${oldPrefix}/`, `/${newPrefix}/`)
      .replace(`${oldId}.md`, `${newId}.md`);
    filesRenamed.push(`${note.filePath} -> ${newPath}`);
  }

  return {
    projectsRenamed: projectNotes.length,
    workstreamsRenamed: workstreamNotes.length,
    tasksRenamed: taskNotes.length,
    filesRenamed,
  };
}

function rewriteDisplayId(content: string, oldPrefix: string, newPrefix: string): string {
  const regex = new RegExp(`\\b${oldPrefix}(-\\d{2}(?:\\.\\d{2})?)\\b`, 'g');
  return content.replace(regex, `${newPrefix}$1`);
}

function updateNoteContent(
  filePath: string,
  oldPrefix: string,
  newPrefix: string,
  noteType: 'project' | 'workstream' | 'task'
): string {
  let content = readFileSync(filePath, 'utf-8');

  if (noteType === 'project') {
    content = replaceFrontmatterField(content, 'prefix', newPrefix);
    content = replaceFrontmatterField(content, 'display_id', newPrefix);
    content = replaceFrontmatterField(content, 'id', `${newPrefix.toLowerCase()}-project`);
  } else {
    content = replaceFrontmatterField(content, 'project', newPrefix);
    content = rewriteDisplayIdField(content, oldPrefix, newPrefix);
    content = rewriteIdField(content, oldPrefix, newPrefix, noteType);
  }

  content = rewriteDependsOn(content, oldPrefix, newPrefix);
  return content;
}

function rewriteDisplayIdField(content: string, oldPrefix: string, newPrefix: string): string {
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return content;

  const frontmatter = content.slice(0, fmEnd);
  const rest = content.slice(fmEnd);

  const regex = new RegExp(`^(display_id:\\s*)${oldPrefix}(-\\d{2}(?:\\.\\d{2})?)`, 'm');
  const updated = frontmatter.replace(regex, `$1${newPrefix}$2`);
  return updated + rest;
}

function rewriteIdField(
  content: string,
  oldPrefix: string,
  newPrefix: string,
  noteType: string
): string {
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return content;

  const frontmatter = content.slice(0, fmEnd);
  const rest = content.slice(fmEnd);

  const regex = new RegExp(`^(id:\\s*)${oldPrefix.toLowerCase()}(-[\\w.-]+-${noteType})`, 'm');
  const updated = frontmatter.replace(regex, `$1${newPrefix.toLowerCase()}$2`);
  return updated + rest;
}

function rewriteDependsOn(content: string, oldPrefix: string, newPrefix: string): string {
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return content;

  const frontmatter = content.slice(0, fmEnd);
  const rest = content.slice(fmEnd);
  const updated = rewriteDisplayId(frontmatter, oldPrefix, newPrefix);
  return updated + rest;
}

async function renameTaskNote(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  note: { id: string; filePath: string; metadata?: string | null },
  oldPrefix: string,
  newPrefix: string,
  result: RenamePrefixResult
): Promise<void> {
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  const oldDisplayId = meta.display_id as string;
  const newDisplayId = oldDisplayId.replace(oldPrefix, newPrefix);

  const content = updateNoteContent(note.filePath, oldPrefix, newPrefix, 'task');
  const newFilePath = computeNewFilePath(
    config,
    oldPrefix,
    newPrefix,
    note.filePath,
    oldDisplayId,
    newDisplayId
  );

  await writeAndReindex(db, embedder, note, content, note.filePath, newFilePath);
  result.tasksRenamed++;
  result.filesRenamed.push(`${note.filePath} -> ${newFilePath}`);
}

async function renameWorkstreamNote(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  note: { id: string; filePath: string; metadata?: string | null },
  oldPrefix: string,
  newPrefix: string,
  result: RenamePrefixResult
): Promise<void> {
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  const oldDisplayId = meta.display_id as string;
  const newDisplayId = oldDisplayId.replace(oldPrefix, newPrefix);

  const content = updateNoteContent(note.filePath, oldPrefix, newPrefix, 'workstream');
  const newFilePath = computeNewFilePath(
    config,
    oldPrefix,
    newPrefix,
    note.filePath,
    oldDisplayId,
    newDisplayId
  );

  await writeAndReindex(db, embedder, note, content, note.filePath, newFilePath);
  result.workstreamsRenamed++;
  result.filesRenamed.push(`${note.filePath} -> ${newFilePath}`);
}

async function renameProjectNote(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  note: { id: string; filePath: string },
  oldPrefix: string,
  newPrefix: string,
  result: RenamePrefixResult
): Promise<void> {
  const content = updateNoteContent(note.filePath, oldPrefix, newPrefix, 'project');
  const newDir = join(config.notesDir, 'modules', 'pm', newPrefix);
  const newFilePath = join(newDir, 'project.md');

  await writeAndReindex(db, embedder, note, content, note.filePath, newFilePath);
  result.projectsRenamed++;
  result.filesRenamed.push(`${note.filePath} -> ${newFilePath}`);
}

function computeNewFilePath(
  config: BrainConfig,
  oldPrefix: string,
  newPrefix: string,
  oldFilePath: string,
  oldDisplayId: string,
  newDisplayId: string
): string {
  const newDir = join(config.notesDir, 'modules', 'pm', newPrefix);
  const fileName = oldFilePath.split('/').pop()!;
  const newFileName = fileName.replace(oldDisplayId, newDisplayId);
  return join(newDir, newFileName);
}

async function writeAndReindex(
  db: BrainDB,
  embedder: Embedder,
  note: { id: string },
  content: string,
  oldFilePath: string,
  newFilePath: string
): Promise<void> {
  const { mkdirSync } = await import('node:fs');
  const dir = dirname(newFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db.deleteNote(note.id);

  if (oldFilePath !== newFilePath) {
    writeFileSync(newFilePath, content, 'utf-8');
    if (existsSync(oldFilePath)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(oldFilePath);
    }
  } else {
    writeFileSync(newFilePath, content, 'utf-8');
  }

  const hash = createHash('sha256').update(content).digest('hex');
  await indexSingleFile(db, embedder, newFilePath, content, hash, Date.now());
}
