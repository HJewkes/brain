import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { replaceFrontmatterField } from '../../../utils.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';
import type { TaskMetadata, VirtualState } from '../types.js';
import {
  setFrontmatterList,
  setFrontmatterRaw,
  quoteYamlString,
} from '../engine/frontmatter-list.js';
import { getPmNotes } from './queries.js';
import { getTask } from './task-ops.js';

export interface TaskFieldUpdates {
  estimate?: number | null;
  doneWhen?: string | null;
  addTags?: string[];
  removeTags?: string[];
}

export type TaskField = 'estimate' | 'done_when' | 'tags';

export interface TaskFieldsResult {
  task: TaskMetadata & { virtualStates: VirtualState[] };
  changed: TaskField[];
}

interface TaskFieldValues {
  estimate?: number;
  done_when?: string;
  tags: string[];
}

const TAG_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,63}$/;
const MAX_TAGS = 20;
const MAX_ESTIMATE = 100;
const MAX_DONE_WHEN_LENGTH = 500;

function validateUpdates(updates: TaskFieldUpdates): string | undefined {
  const { estimate, doneWhen, addTags = [], removeTags = [] } = updates;
  const hasAny =
    estimate !== undefined || doneWhen !== undefined || addTags.length + removeTags.length > 0;
  if (!hasAny) return 'At least one of estimate, doneWhen, addTags, or removeTags is required';

  if (
    estimate != null &&
    !(Number.isInteger(estimate) && estimate >= 0 && estimate <= MAX_ESTIMATE)
  ) {
    return `estimate must be an integer from 0 to ${MAX_ESTIMATE}`;
  }
  if (doneWhen != null) {
    const length = doneWhen.trim().length;
    if (length === 0 || length > MAX_DONE_WHEN_LENGTH) {
      return `doneWhen must be 1 to ${MAX_DONE_WHEN_LENGTH} characters after trimming`;
    }
  }
  const badTag = [...addTags, ...removeTags].find((tag) => !TAG_PATTERN.test(tag));
  if (badTag !== undefined) return `Invalid tag "${badTag}": must match ${TAG_PATTERN.source}`;

  const overlap = addTags.find((tag) => removeTags.includes(tag));
  if (overlap !== undefined) return `Tag "${overlap}" is in both addTags and removeTags`;
  return undefined;
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

function readFieldValues(content: string): TaskFieldValues {
  const data = matter(content).data as Record<string, unknown>;
  return {
    estimate: typeof data.estimate === 'number' ? data.estimate : undefined,
    done_when: typeof data.done_when === 'string' ? data.done_when : undefined,
    tags: normalizeTags(data.tags),
  };
}

function nextFieldValues(current: TaskFieldValues, updates: TaskFieldUpdates): TaskFieldValues {
  const removed = new Set(updates.removeTags ?? []);
  const tags = current.tags.filter((tag) => !removed.has(tag));
  for (const tag of updates.addTags ?? []) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  return {
    estimate: updates.estimate === undefined ? current.estimate : (updates.estimate ?? undefined),
    done_when:
      updates.doneWhen === undefined ? current.done_when : (updates.doneWhen?.trim() ?? undefined),
    tags,
  };
}

function changedFields(current: TaskFieldValues, next: TaskFieldValues): TaskField[] {
  const changed: TaskField[] = [];
  if (current.estimate !== next.estimate) changed.push('estimate');
  if (current.done_when !== next.done_when) changed.push('done_when');
  if (current.tags.join('\n') !== next.tags.join('\n')) changed.push('tags');
  return changed;
}

function writeFieldValues(content: string, changed: TaskField[], next: TaskFieldValues): string {
  let updated = content;
  if (changed.includes('estimate')) {
    updated = setFrontmatterRaw(updated, 'estimate', next.estimate?.toString());
  }
  if (changed.includes('done_when')) {
    const quoted = next.done_when === undefined ? undefined : quoteYamlString(next.done_when);
    updated = setFrontmatterRaw(updated, 'done_when', quoted);
  }
  if (changed.includes('tags')) {
    updated = setFrontmatterList(updated, 'tags', next.tags);
  }
  const today = new Date().toISOString().slice(0, 10);
  return replaceFrontmatterField(updated, 'modified', today);
}

function refreshedResult(
  db: BrainDB,
  displayId: string,
  changed: TaskField[]
): Result<TaskFieldsResult> {
  const task = getTask(db, displayId);
  if (!task.ok) return task;
  return ok({ task: task.data, changed });
}

/** Set estimate, done_when, and tags on a task in one file write; identical values write nothing. */
export async function setTaskFields(
  db: BrainDB,
  _config: BrainConfig,
  embedder: Embedder,
  displayId: string,
  updates: TaskFieldUpdates
): Promise<Result<TaskFieldsResult>> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) return fail('NOT_FOUND', `Task "${displayId}" not found`);

  const invalid = validateUpdates(updates);
  if (invalid) return fail('INVALID_INPUT', invalid);

  const filePath = notes[0].filePath;
  if (!existsSync(filePath)) return fail('NOT_FOUND', `Task file not found at "${filePath}"`);

  const content = readFileSync(filePath, 'utf-8');
  const current = readFieldValues(content);
  const next = nextFieldValues(current, updates);
  if (next.tags.length > MAX_TAGS) {
    return fail('INVALID_INPUT', `A task can have at most ${MAX_TAGS} tags`);
  }

  const changed = changedFields(current, next);
  if (changed.length === 0) return refreshedResult(db, displayId, changed);

  const updated = writeFieldValues(content, changed, next);
  writeFileSync(filePath, updated, 'utf-8');
  const hash = createHash('sha256').update(updated).digest('hex');
  await indexSingleFile(db, embedder, filePath, updated, hash, Date.now());
  return refreshedResult(db, displayId, changed);
}
