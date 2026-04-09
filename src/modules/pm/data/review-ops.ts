import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import type { Result } from '../errors.js';
import type { TaskMetadata, TaskStatus } from '../types.js';
import { ok, fail } from '../errors.js';
import { createTask, updateTaskStatus } from './task-ops.js';
import { createWorkstream } from './workstream-ops.js';
import { getPmNotes, resolveDisplayId } from './queries.js';
import { createCapture } from './capture-ops.js';

export interface ReviewCreateInput {
  sourceTaskId: string;
  prUrl: string;
  branch: string;
  agentId?: string;
  rewireDeps?: boolean;
  risk?: number;
  autoComplete?: boolean;
}

export interface ReviewCreateResult {
  reviewTaskId: string;
  reviewTaskMeta: TaskMetadata;
  rewiredDeps: string[];
  captureNoteId: string;
  riskAdvisory?: string;
  sourceAutoCompleted: boolean;
}

function extractPrNumber(url: string): string {
  const match = /\/pull\/(\d+)/.exec(url);
  return match ? match[1] : 'N/A';
}

function findReviewWorkstream(
  db: BrainDB,
  project: string
): { found: true; number: number } | { found: false } {
  const wsNotes = getPmNotes(db, 'workstream', { project });
  for (const note of wsNotes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const title = (meta.title as string) ?? '';
    if (title.toLowerCase().includes('review')) {
      return { found: true, number: meta.number as number };
    }
  }
  return { found: false };
}

const AUTO_COMPLETE_TRANSITIONS: Record<string, TaskStatus[]> = {
  pending: ['claimed', 'in-progress', 'done'],
  claimed: ['in-progress', 'done'],
  'in-progress': ['done'],
  'pending-merge': ['done'],
};

async function autoCompleteSourceTask(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  displayId: string,
  currentStatus: string
): Promise<boolean> {
  const steps = AUTO_COMPLETE_TRANSITIONS[currentStatus];
  if (!steps) return false;

  for (const targetStatus of steps) {
    const result = await updateTaskStatus(db, config, embedder, displayId, targetStatus);
    if (!result.ok) return false;
  }
  return true;
}

export async function createReviewTask(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: ReviewCreateInput
): Promise<Result<ReviewCreateResult>> {
  if (
    input.risk !== undefined &&
    (!Number.isInteger(input.risk) || input.risk < 1 || input.risk > 5)
  ) {
    return fail('INVALID_INPUT', `Risk must be an integer between 1 and 5, got ${input.risk}`);
  }

  const sourceDisplayId = input.sourceTaskId.toUpperCase();
  const sourceNotes = getPmNotes(db, 'task', { display_id: sourceDisplayId });
  if (sourceNotes.length === 0) {
    return fail('NOT_FOUND', `Source task "${sourceDisplayId}" not found`);
  }

  const sourceMeta = JSON.parse(sourceNotes[0].metadata!) as Record<string, unknown>;
  const project = sourceMeta.project as string;
  const sourceTitle = (sourceMeta.title as string) ?? sourceDisplayId;
  const sourcePriority = (sourceMeta.priority as string) ?? 'medium';

  const prNumber = extractPrNumber(input.prUrl);

  let reviewWsNumber: number;
  const wsLookup = findReviewWorkstream(db, project);
  if (wsLookup.found) {
    reviewWsNumber = wsLookup.number;
  } else {
    const wsResult = await createWorkstream(db, config, embedder, {
      project,
      name: 'PR Review',
      description: 'Pull request review tasks requiring human approval',
    });
    if (!wsResult.ok) {
      return fail(wsResult.error.code, wsResult.error.message, wsResult.error.details);
    }
    reviewWsNumber = wsResult.data.number;
  }

  const reviewTitle = `Review PR #${prNumber}: ${sourceTitle}`;
  const descriptionLines = [
    `## PR Review`,
    '',
    `- **PR:** ${input.prUrl}`,
    `- **Branch:** ${input.branch}`,
    `- **Source task:** ${sourceDisplayId}`,
  ];
  if (input.agentId) {
    descriptionLines.push(`- **Agent:** ${input.agentId}`);
  }
  if (input.risk !== undefined) {
    descriptionLines.push(`- **Risk:** ${input.risk}/5`);
  }
  descriptionLines.push('', 'Review and merge the pull request to unblock downstream work.');

  const taskResult = await createTask(db, config, embedder, {
    project,
    workstream: reviewWsNumber,
    name: reviewTitle,
    mode: 'human',
    category: 'review',
    priority: sourcePriority as TaskMetadata['priority'],
    dependsOn: [sourceDisplayId],
    description: descriptionLines.join('\n'),
  });

  if (!taskResult.ok) {
    return fail(taskResult.error.code, taskResult.error.message, taskResult.error.details);
  }

  const reviewDisplayId = taskResult.data.display_id;

  const rewiredDeps: string[] = [];
  if (input.rewireDeps !== false) {
    const sourceResolved = resolveDisplayId(db, sourceDisplayId);
    if (sourceResolved.ok) {
      const sourceNoteId = sourceResolved.data;
      const incomingRelations = db.getRelationsTo(sourceNoteId);
      const dependents = incomingRelations.filter((r) => r.type === 'depends_on');

      const reviewResolved = resolveDisplayId(db, reviewDisplayId);
      if (reviewResolved.ok) {
        const reviewNoteId = reviewResolved.data;

        for (const rel of dependents) {
          const dependentNote = db.getNoteById(rel.sourceId);
          if (!dependentNote?.metadata) continue;
          const depMeta = JSON.parse(dependentNote.metadata) as Record<string, unknown>;
          const depDisplayId = depMeta.display_id as string;

          if (depDisplayId === reviewDisplayId) continue;

          const existingRelations = db.getRelationsFrom(rel.sourceId);
          const withoutOldDep = existingRelations.filter(
            (r) => !(r.type === 'depends_on' && r.targetId === sourceNoteId)
          );
          const newRelations: Relation[] = [
            ...withoutOldDep,
            { sourceId: rel.sourceId, targetId: reviewNoteId, type: 'depends_on' },
          ];
          db.upsertRelations(rel.sourceId, newRelations);
          rewiredDeps.push(depDisplayId);
        }
      }
    }
  }

  const agentStr = input.agentId ? ` | agent: ${input.agentId}` : '';
  const captureContent = `${sourceDisplayId}: PR #${prNumber} at ${input.prUrl} | branch: ${input.branch}${agentStr}`;
  const captureResult = await createCapture(db, config, embedder, {
    content: captureContent,
    source: 'review-create',
    project,
  });

  const captureNoteId = captureResult.ok ? captureResult.data.noteId : '';

  let sourceAutoCompleted = false;
  if (input.autoComplete !== false) {
    const sourceStatus = (sourceMeta.status as string) ?? 'pending';
    if (sourceStatus !== 'done') {
      try {
        sourceAutoCompleted = await autoCompleteSourceTask(
          db,
          config,
          embedder,
          sourceDisplayId,
          sourceStatus
        );
      } catch {
        // Auto-completion failure must not block review creation
      }
    }
  }

  let riskAdvisory: string | undefined;
  if (input.risk !== undefined) {
    riskAdvisory =
      input.risk >= 4
        ? `Advisory: risk ${input.risk} — human review recommended`
        : `Advisory: risk ${input.risk} — agent review may be sufficient`;
  }

  return ok({
    reviewTaskId: reviewDisplayId,
    reviewTaskMeta: taskResult.data,
    rewiredDeps,
    captureNoteId,
    riskAdvisory,
    sourceAutoCompleted,
  });
}
