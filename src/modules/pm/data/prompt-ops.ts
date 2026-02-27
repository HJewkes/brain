import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { Result } from '../errors.js';
import type { PromptMetadata, PromptStatus } from '../types.js';
import { ok, fail } from '../errors.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes, resolveDisplayId } from './queries.js';

export interface WritePromptInput {
  project: string;
  task: string;
  content: string;
  status?: PromptStatus;
}

function promptFilePath(config: BrainConfig, prefix: string, displayId: string): string {
  return join(config.notesDir, 'modules', 'pm', prefix, `${displayId}.md`);
}

function nextPromptNumber(db: BrainDB, prefix: string): number {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'prompt' });
  if (noteIds.length === 0) return 1;

  const notes = db.getNotesByIds(noteIds);
  let max = 0;

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.project !== prefix) continue;
    const did = meta.display_id as string;
    const match = /P(\d+)$/.exec(did);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }

  return max + 1;
}

function formatPromptDisplayId(prefix: string, number: number): string {
  return `${prefix}-P${String(number).padStart(2, '0')}`;
}

function currentVersionForTask(db: BrainDB, taskDisplayId: string, project: string): number {
  const notes = getPmNotes(db, 'prompt', { task: taskDisplayId, project });
  let max = 0;
  for (const note of notes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const v = (meta.version as number) ?? 0;
    if (v > max) max = v;
  }
  return max;
}

function buildPromptMarkdown(
  input: WritePromptInput,
  displayId: string,
  status: PromptStatus,
  version: number
): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    '---',
    `id: ${displayId.toLowerCase()}-prompt`,
    `title: "Prompt ${displayId} v${version}"`,
    'type: prompt',
    'tier: slow',
    'module: pm',
    'visibility: private',
    `project: ${input.project}`,
    `display_id: ${displayId}`,
    `task: ${input.task}`,
    `prompt_status: ${status}`,
    `version: ${version}`,
    `created: ${now}`,
    `modified: ${now}`,
    '---',
    '',
    `# Prompt ${displayId} v${version}`,
    '',
    input.content,
    '',
  ];
  return lines.join('\n');
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

function promptMetaFromRecord(meta: Record<string, unknown>): PromptMetadata {
  return {
    title: (meta.title as string) ?? undefined,
    display_id: meta.display_id as string,
    project: meta.project as string,
    task: meta.task as string,
    prompt_status: meta.prompt_status as PromptStatus,
    version: meta.version as number | undefined,
  };
}

async function supersedeCurrentPrompt(
  db: BrainDB,
  embedder: Embedder,
  taskDisplayId: string,
  project: string
): Promise<void> {
  const notes = getPmNotes(db, 'prompt', { task: taskDisplayId, project });
  for (const note of notes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    if (meta.prompt_status !== 'current') continue;

    const filePath = note.filePath;
    if (!existsSync(filePath)) continue;

    let content = readFileSync(filePath, 'utf-8');
    content = replaceFrontmatterField(content, 'prompt_status', 'superseded');
    const now = new Date().toISOString().slice(0, 10);
    content = replaceFrontmatterField(content, 'modified', now);
    writeFileSync(filePath, content, 'utf-8');

    const hash = createHash('sha256').update(content).digest('hex');
    await indexSingleFile(db, embedder, filePath, content, hash, Date.now());
  }
}

export async function writePrompt(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: WritePromptInput
): Promise<Result<PromptMetadata>> {
  const projectNotes = getPmNotes(db, 'project', { prefix: input.project });
  if (projectNotes.length === 0) {
    return fail('NOT_FOUND', `Project "${input.project}" not found`);
  }

  const taskResolved = resolveDisplayId(db, input.task);
  if (!taskResolved.ok) {
    return fail('NOT_FOUND', `Task "${input.task}" not found`);
  }

  await supersedeCurrentPrompt(db, embedder, input.task, input.project);

  const version = currentVersionForTask(db, input.task, input.project) + 1;
  const number = nextPromptNumber(db, input.project);
  const displayId = formatPromptDisplayId(input.project, number);
  const status = input.status ?? 'current';

  const filePath = promptFilePath(config, input.project, displayId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const markdown = buildPromptMarkdown(input, displayId, status, version);
  writeFileSync(filePath, markdown, 'utf-8');

  const hash = createHash('sha256').update(markdown).digest('hex');
  await indexSingleFile(db, embedder, filePath, markdown, hash, Date.now());

  const metadata: PromptMetadata = {
    display_id: displayId,
    project: input.project,
    task: input.task,
    prompt_status: status,
    version,
  };

  return ok(metadata);
}

export function getPrompt(
  db: BrainDB,
  taskDisplayId: string,
  version?: number
): Result<PromptMetadata & { content: string }> {
  const notes = getPmNotes(db, 'prompt', { task: taskDisplayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `No prompts found for task "${taskDisplayId}"`);
  }

  let target = notes[0];
  let targetMeta = JSON.parse(target.metadata!) as Record<string, unknown>;

  if (version !== undefined) {
    const match = notes.find((n) => {
      const m = JSON.parse(n.metadata!) as Record<string, unknown>;
      return m.version === version;
    });
    if (!match) {
      return fail('NOT_FOUND', `Prompt version ${version} not found for task "${taskDisplayId}"`);
    }
    target = match;
    targetMeta = JSON.parse(match.metadata!) as Record<string, unknown>;
  } else {
    for (const note of notes) {
      const m = JSON.parse(note.metadata!) as Record<string, unknown>;
      const v = (m.version as number) ?? 0;
      const tv = (targetMeta.version as number) ?? 0;
      if (v > tv) {
        target = note;
        targetMeta = m;
      }
    }
  }

  let content = '';
  if (existsSync(target.filePath)) {
    const raw = readFileSync(target.filePath, 'utf-8');
    const endOfFrontmatter = raw.indexOf('\n---', 4);
    if (endOfFrontmatter !== -1) {
      const body = raw.slice(endOfFrontmatter + 4).trim();
      const headingEnd = body.indexOf('\n');
      content = headingEnd !== -1 ? body.slice(headingEnd + 1).trim() : '';
    }
  }

  return ok({ ...promptMetaFromRecord(targetMeta), content });
}

export function listPrompts(
  db: BrainDB,
  prefix: string,
  filters?: { status?: string; task?: string }
): Result<PromptMetadata[]> {
  const filterObj: Record<string, unknown> = { project: prefix };
  if (filters?.status !== undefined) filterObj.prompt_status = filters.status;
  if (filters?.task !== undefined) filterObj.task = filters.task;

  const notes = getPmNotes(db, 'prompt', filterObj);
  const prompts: PromptMetadata[] = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    return promptMetaFromRecord(meta);
  });

  return ok(prompts);
}

export function getPromptHistory(db: BrainDB, taskDisplayId: string): Result<PromptMetadata[]> {
  const notes = getPmNotes(db, 'prompt', { task: taskDisplayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `No prompts found for task "${taskDisplayId}"`);
  }

  const prompts: PromptMetadata[] = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    return promptMetaFromRecord(meta);
  });

  prompts.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));

  return ok(prompts);
}

function getIndexedAt(db: BrainDB, filePath: string): number {
  const file = db.getFile(filePath);
  return file?.indexedAt ?? 0;
}

export function detectStalePrompts(db: BrainDB, prefix: string): Result<PromptMetadata[]> {
  const currentPrompts = getPmNotes(db, 'prompt', { project: prefix, prompt_status: 'current' });
  if (currentPrompts.length === 0) {
    return ok([]);
  }

  const decisionNotes = getPmNotes(db, 'decision', { project: prefix });
  const stale: PromptMetadata[] = [];

  for (const promptNote of currentPrompts) {
    const promptMeta = JSON.parse(promptNote.metadata!) as Record<string, unknown>;
    const taskDisplayId = promptMeta.task as string;
    const promptIndexedAt = getIndexedAt(db, promptNote.filePath);

    for (const decNote of decisionNotes) {
      const decMeta = JSON.parse(decNote.metadata!) as Record<string, unknown>;
      const impacts = decMeta.impacts as string[] | undefined;
      if (!impacts || !impacts.includes(taskDisplayId)) continue;

      const decIndexedAt = getIndexedAt(db, decNote.filePath);
      if (decIndexedAt > promptIndexedAt) {
        stale.push(promptMetaFromRecord(promptMeta));
        break;
      }
    }
  }

  return ok(stale);
}
