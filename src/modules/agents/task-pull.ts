import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../types.js';
import type { TaskPriority } from '../pm/types.js';
import type { AgentDispatchContext, DispatchContextOptions } from './dispatch-context.js';
import { buildAgentDispatchContext, formatDispatchBrief } from './dispatch-context.js';
import { computeEligible } from '../pm/engine/dependency.js';
import { getTask } from '../pm/data/task-ops.js';
import { generateClaim } from '../pm/engine/claims.js';
import { getAllProjectPrefixes } from '../pm/data/queries.js';
import { getPmNotes } from '../pm/data/queries.js';

export interface PullResult {
  taskId: string;
  claimToken: string;
  dispatchContext: AgentDispatchContext;
  brief: string;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function resolveTaskPriority(db: BrainDB, displayId: string): TaskPriority {
  const result = getTask(db, displayId);
  if (!result.ok) return 'low';
  return result.data.priority;
}

function sortByPriority(db: BrainDB, displayIds: string[]): string[] {
  return [...displayIds].sort((a, b) => {
    const pa = PRIORITY_ORDER[resolveTaskPriority(db, a)];
    const pb = PRIORITY_ORDER[resolveTaskPriority(db, b)];
    return pa - pb;
  });
}

export async function pullNextTask(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  options?: DispatchContextOptions
): Promise<PullResult | null> {
  const prefixes = getAllProjectPrefixes(db);
  if (prefixes.length === 0) return null;

  let allEligible: string[] = [];
  for (const prefix of prefixes) {
    const eligible = computeEligible(db, prefix);
    allEligible = allEligible.concat(eligible);
  }

  if (allEligible.length === 0) return null;

  const sorted = sortByPriority(db, allEligible);

  for (const taskId of sorted) {
    const taskResult = getTask(db, taskId);
    if (!taskResult.ok) continue;
    if (taskResult.data.status !== 'pending') continue;

    const claim = generateClaim();

    const statusResult = await claimTaskWithToken(
      db,
      embedder,
      taskId,
      claim.token,
      claim.claimedAt
    );
    if (!statusResult) continue;

    const dispatchContext = buildAgentDispatchContext(db, taskId, options);
    if (!dispatchContext) continue;

    const brief = formatDispatchBrief(dispatchContext);

    return {
      taskId,
      claimToken: claim.token,
      dispatchContext,
      brief,
    };
  }

  return null;
}

async function claimTaskWithToken(
  db: BrainDB,
  embedder: Embedder,
  displayId: string,
  token: string,
  claimedAt: string
): Promise<boolean> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) return false;

  const note = notes[0];
  const filePath = note.filePath;

  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { indexSingleFile } = await import('../../services/indexing.js');

  if (!existsSync(filePath)) return false;

  let content = readFileSync(filePath, 'utf-8');
  content = replaceFrontmatterField(content, 'status', 'claimed');
  content = replaceFrontmatterField(content, 'claim_token', token);
  content = replaceFrontmatterField(content, 'claimed_at', claimedAt);
  const now = new Date().toISOString().slice(0, 10);
  content = replaceFrontmatterField(content, 'modified', now);

  writeFileSync(filePath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

  return true;
}

function replaceFrontmatterField(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const needsQuoting = value.includes(' ') || /^\d{4}-\d{2}-\d{2}/.test(value);
  const quoted = needsQuoting ? `"${value}"` : value;
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');

  if (fieldRegex.test(frontmatter)) {
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }
  return frontmatter + `\n${field}: ${quoted}` + rest;
}
