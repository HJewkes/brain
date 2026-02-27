import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import type { Result } from '../errors.js';
import type { DecisionMetadata, DecisionStatus } from '../types.js';
import { ok, fail } from '../errors.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes, resolveDisplayId } from './queries.js';

export interface CreateDecisionInput {
  project: string;
  name: string;
  sourceTask: string;
  impacts?: string[];
  content: string;
}

function decisionFilePath(config: BrainConfig, prefix: string, displayId: string): string {
  return join(config.notesDir, 'modules', 'pm', prefix, `${displayId}.md`);
}

function nextDecisionNumber(db: BrainDB, prefix: string): number {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'decision' });
  if (noteIds.length === 0) return 1;

  const notes = db.getNotesByIds(noteIds);
  let max = 0;

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.project !== prefix) continue;
    const did = meta.display_id as string;
    const match = /D(\d+)$/.exec(did);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }

  return max + 1;
}

function formatDecisionDisplayId(prefix: string, number: number): string {
  return `${prefix}-D${String(number).padStart(2, '0')}`;
}

function buildDecisionMarkdown(
  input: CreateDecisionInput,
  displayId: string,
  status: DecisionStatus,
): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    '---',
    `id: ${displayId.toLowerCase()}-decision`,
    `title: "${input.name}"`,
    'type: decision',
    'tier: slow',
    'module: pm',
    'visibility: public',
    `project: ${input.project}`,
    `display_id: ${displayId}`,
    `status: ${status}`,
    `source_task: ${input.sourceTask}`,
  ];

  if (input.impacts && input.impacts.length > 0) {
    lines.push(`impacts: [${input.impacts.join(', ')}]`);
  }

  lines.push(`created: ${now}`, `modified: ${now}`, '---', '', `# ${input.name}`, '', input.content, '');
  return lines.join('\n');
}

function decisionMetaFromRecord(meta: Record<string, unknown>): DecisionMetadata {
  return {
    display_id: meta.display_id as string,
    project: meta.project as string,
    status: meta.status as DecisionStatus,
    source_task: meta.source_task as string,
    impacts: meta.impacts as string[] | undefined,
  };
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

export async function createDecision(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CreateDecisionInput,
): Promise<Result<DecisionMetadata>> {
  const projectNotes = getPmNotes(db, 'project', { prefix: input.project });
  if (projectNotes.length === 0) {
    return fail('NOT_FOUND', `Project "${input.project}" not found`);
  }

  const sourceResolved = resolveDisplayId(db, input.sourceTask);
  if (!sourceResolved.ok) {
    return fail('NOT_FOUND', `Source task "${input.sourceTask}" not found`);
  }

  const resolvedImpacts: Array<{ displayId: string; noteId: string }> = [];
  if (input.impacts && input.impacts.length > 0) {
    for (const impactId of input.impacts) {
      const resolved = resolveDisplayId(db, impactId);
      if (!resolved.ok) {
        return fail('NOT_FOUND', `Impact target "${impactId}" not found`);
      }
      resolvedImpacts.push({ displayId: impactId, noteId: resolved.data });
    }
  }

  const number = nextDecisionNumber(db, input.project);
  const displayId = formatDecisionDisplayId(input.project, number);

  const filePath = decisionFilePath(config, input.project, displayId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const markdown = buildDecisionMarkdown(input, displayId, 'accepted');
  writeFileSync(filePath, markdown, 'utf-8');

  const hash = createHash('sha256').update(markdown).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, markdown, hash, Date.now());

  if (resolvedImpacts.length > 0) {
    const relations: Relation[] = resolvedImpacts.map((impact) => ({
      sourceId: noteId,
      targetId: impact.noteId,
      type: 'impacts',
    }));
    db.upsertRelations(noteId, relations);
  }

  const metadata: DecisionMetadata = {
    display_id: displayId,
    project: input.project,
    status: 'accepted',
    source_task: input.sourceTask,
    impacts: input.impacts,
  };

  return ok(metadata);
}

export function listDecisions(
  db: BrainDB,
  prefix: string,
  filters?: { status?: string; task?: string },
): Result<DecisionMetadata[]> {
  const filterObj: Record<string, unknown> = { project: prefix };
  if (filters?.status !== undefined) filterObj.status = filters.status;
  if (filters?.task !== undefined) filterObj.source_task = filters.task;

  const notes = getPmNotes(db, 'decision', filterObj);
  const decisions: DecisionMetadata[] = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    return decisionMetaFromRecord(meta);
  });

  return ok(decisions);
}

export function getDecision(
  db: BrainDB,
  displayId: string,
): Result<DecisionMetadata & { content: string }> {
  const notes = getPmNotes(db, 'decision', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Decision "${displayId}" not found`);
  }

  const note = notes[0];
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  const decisionMeta = decisionMetaFromRecord(meta);

  let content = '';
  if (existsSync(note.filePath)) {
    const raw = readFileSync(note.filePath, 'utf-8');
    const endOfFrontmatter = raw.indexOf('\n---', 4);
    if (endOfFrontmatter !== -1) {
      const body = raw.slice(endOfFrontmatter + 4).trim();
      const headingEnd = body.indexOf('\n');
      content = headingEnd !== -1 ? body.slice(headingEnd + 1).trim() : '';
    }
  }

  return ok({ ...decisionMeta, content });
}

export async function supersedeDecision(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  oldDisplayId: string,
  newInput: CreateDecisionInput,
): Promise<Result<{ old: DecisionMetadata; new: DecisionMetadata }>> {
  const oldNotes = getPmNotes(db, 'decision', { display_id: oldDisplayId });
  if (oldNotes.length === 0) {
    return fail('NOT_FOUND', `Decision "${oldDisplayId}" not found`);
  }

  const oldNote = oldNotes[0];
  const oldFilePath = oldNote.filePath;

  if (!existsSync(oldFilePath)) {
    return fail('NOT_FOUND', `Decision file not found at "${oldFilePath}"`);
  }

  let oldContent = readFileSync(oldFilePath, 'utf-8');
  oldContent = replaceFrontmatterField(oldContent, 'status', 'superseded');
  const now = new Date().toISOString().slice(0, 10);
  oldContent = replaceFrontmatterField(oldContent, 'modified', now);
  writeFileSync(oldFilePath, oldContent, 'utf-8');

  const oldHash = createHash('sha256').update(oldContent).digest('hex');
  await indexSingleFile(db, embedder, oldFilePath, oldContent, oldHash, Date.now());

  const oldMeta = JSON.parse(oldNote.metadata!) as Record<string, unknown>;
  const oldDecision: DecisionMetadata = {
    ...decisionMetaFromRecord(oldMeta),
    status: 'superseded',
  };

  const newResult = await createDecision(db, config, embedder, newInput);
  if (!newResult.ok) {
    return newResult as Result<never>;
  }

  const newDisplayId = newResult.data.display_id;
  const newResolved = resolveDisplayId(db, newDisplayId);
  const oldResolved = resolveDisplayId(db, oldDisplayId);

  if (newResolved.ok && oldResolved.ok) {
    const supersedesRelation: Relation[] = [{
      sourceId: newResolved.data,
      targetId: oldResolved.data,
      type: 'supersedes',
    }];
    db.upsertRelations(newResolved.data, supersedesRelation);
  }

  return ok({ old: oldDecision, new: newResult.data });
}
