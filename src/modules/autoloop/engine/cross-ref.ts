import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder, NoteRecord } from '../../../types.js';
import { search } from '../../../services/search.js';
import { listTasks } from '../../pm/data/task-ops.js';
import { listWorkstreams } from '../../pm/data/workstream-ops.js';
import type { TaskMetadata, TaskPriority } from '../../pm/types.js';

export interface SuggestedNewTask {
  title: string;
  description: string;
  suggestedWorkstream: string;
  suggestedPriority: TaskPriority;
  sourceNoteId: string;
  sourceTitle: string;
  rationale: string;
}

export interface TaskUpdate {
  taskDisplayId: string;
  taskTitle: string;
  field: 'description' | 'priority' | 'references';
  currentValue: string;
  suggestedValue: string;
  sourceNoteId: string;
  sourceTitle: string;
  rationale: string;
}

export interface PriorityChange {
  taskDisplayId: string;
  taskTitle: string;
  currentPriority: TaskPriority;
  suggestedPriority: TaskPriority;
  sourceNoteId: string;
  sourceTitle: string;
  rationale: string;
}

export interface CrossRefReport {
  synthesisNotesScanned: number;
  tasksScanned: number;
  workstreamsScanned: number;
  suggestedNewTasks: SuggestedNewTask[];
  taskUpdates: TaskUpdate[];
  priorityChanges: PriorityChange[];
  errors: string[];
}

export interface CrossRefOptions {
  project?: string;
  minRelevance?: number;
  maxSuggestedTasks?: number;
}

/**
 * Cross-reference synthesis research notes with existing workstreams and tasks.
 * Identifies gaps (new tasks), updates (existing tasks needing changes),
 * and priority adjustments based on competitive analysis.
 */
export async function crossRefResearchToWorkstreams(
  db: BrainDB,
  embedder: Embedder,
  opts?: CrossRefOptions
): Promise<CrossRefReport> {
  const project = opts?.project ?? process.env.BRAIN_PM_PROJECT ?? 'VNM';
  const minRelevance = opts?.minRelevance ?? 0.3;
  const maxSuggested = opts?.maxSuggestedTasks ?? 20;
  const errors: string[] = [];

  const synthesisNotes = findSynthesisNotes(db);
  if (synthesisNotes.length === 0) {
    return emptyReport('No synthesis notes found');
  }

  const taskResult = listTasks(db, project, { status: 'all' }, 'default');
  const tasks = taskResult.ok ? taskResult.data : [];

  const wsResult = listWorkstreams(db, project);
  const workstreams = wsResult.ok ? wsResult.data : [];

  const suggestedNewTasks: SuggestedNewTask[] = [];
  const taskUpdates: TaskUpdate[] = [];
  const priorityChanges: PriorityChange[] = [];

  for (const note of synthesisNotes) {
    try {
      const recommendations = extractRecommendations(note);

      let matches = new Map<string, TaskMatch>();
      if (tasks.length > 0) {
        try {
          matches = await matchRecommendationsToTasks(
            db,
            embedder,
            recommendations,
            tasks,
            minRelevance
          );
        } catch (err) {
          errors.push(`Search ${note.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const rec of recommendations) {
        const match = matches.get(rec.text);
        if (match) {
          addTaskUpdates(taskUpdates, priorityChanges, match, note, rec);
        } else if (suggestedNewTasks.length < maxSuggested) {
          suggestedNewTasks.push(buildNewTaskSuggestion(rec, note, workstreams));
        }
      }
    } catch (err) {
      errors.push(`Note ${note.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    synthesisNotesScanned: synthesisNotes.length,
    tasksScanned: tasks.length,
    workstreamsScanned: workstreams.length,
    suggestedNewTasks,
    taskUpdates,
    priorityChanges,
    errors,
  };
}

interface Recommendation {
  text: string;
  priority: TaskPriority;
  isCompetitive: boolean;
}

interface TaskMatch {
  task: TaskMetadata & { description?: string };
  score: number;
}

export function findSynthesisNotes(db: BrainDB): NoteRecord[] {
  const categoryIds = db.getFilteredNoteIds({ category: 'synthesis' });
  if (!categoryIds || categoryIds.size === 0) {
    const tagIds = db.getFilteredNoteIds({ tags: ['synthesis'] });
    if (!tagIds || tagIds.size === 0) return [];
    const notes = db.getNotesByIds([...tagIds]);
    return [...notes.values()];
  }
  const notes = db.getNotesByIds([...categoryIds]);
  return [...notes.values()];
}

export function extractRecommendations(note: NoteRecord): Recommendation[] {
  const body = note.summary ?? '';
  const tags = note.tags ? note.tags.split(',').map((t) => t.trim()) : [];
  const isCompetitive = tags.some((t) => t.includes('competitive') || t.includes('comparison'));

  const recs: Recommendation[] = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (isActionableLine(trimmed)) {
      recs.push({
        text: cleanRecommendation(trimmed),
        priority: inferPriority(trimmed, isCompetitive),
        isCompetitive,
      });
    }
  }

  if (recs.length === 0 && body.length > 0) {
    recs.push({
      text: body.slice(0, 300),
      priority: isCompetitive ? 'high' : 'medium',
      isCompetitive,
    });
  }

  return recs;
}

function isActionableLine(line: string): boolean {
  const actionPatterns = [
    /^[-*]\s+(add|implement|create|build|integrate|support|enable|migrate)/i,
    /^[-*]\s+(should|must|need|recommend|consider|prioriti[zs]e)/i,
    /^[-*]\s+\*\*(add|implement|create|build|integrate|support|enable)/i,
    /^#+\s+(recommendation|action|next step|suggestion)/i,
    /\b(gap|missing|lacking|absent|needed)\b/i,
  ];
  return actionPatterns.some((p) => p.test(line));
}

function cleanRecommendation(line: string): string {
  return line
    .replace(/^[-*]\s+/, '')
    .replace(/^\*\*/, '')
    .replace(/\*\*$/, '')
    .replace(/^#+\s+/, '')
    .trim();
}

function inferPriority(text: string, isCompetitive: boolean): TaskPriority {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('urgent')) return 'critical';
  if (lower.includes('high priority') || lower.includes('important')) return 'high';
  if (isCompetitive && (lower.includes('gap') || lower.includes('missing'))) return 'high';
  if (lower.includes('low priority') || lower.includes('nice to have')) return 'low';
  return 'medium';
}

async function matchRecommendationsToTasks(
  db: BrainDB,
  embedder: Embedder,
  recommendations: Recommendation[],
  tasks: Array<TaskMetadata & { description?: string }>,
  minRelevance: number
): Promise<Map<string, TaskMatch>> {
  const matches = new Map<string, TaskMatch>();

  for (const rec of recommendations) {
    const searchResult = await search(db, embedder, rec.text, {
      limit: 3,
      includePm: true,
    });

    const taskNoteIds = new Set(tasks.map((t) => `${t.display_id.toLowerCase()}-task`));

    for (const result of searchResult.results) {
      if (result.score < minRelevance) continue;
      if (!taskNoteIds.has(result.noteId)) continue;

      const matchedTask = tasks.find((t) => `${t.display_id.toLowerCase()}-task` === result.noteId);
      if (!matchedTask) continue;

      const existing = matches.get(rec.text);
      if (!existing || result.score > existing.score) {
        matches.set(rec.text, { task: matchedTask, score: result.score });
      }
    }
  }

  return matches;
}

function addTaskUpdates(
  taskUpdates: TaskUpdate[],
  priorityChanges: PriorityChange[],
  match: TaskMatch,
  note: NoteRecord,
  rec: Recommendation
): void {
  const alreadyReferenced = taskUpdates.some(
    (u) => u.taskDisplayId === match.task.display_id && u.field === 'references'
  );

  if (!alreadyReferenced) {
    taskUpdates.push({
      taskDisplayId: match.task.display_id,
      taskTitle: match.task.title ?? match.task.display_id,
      field: 'references',
      currentValue: '',
      suggestedValue: note.id,
      sourceNoteId: note.id,
      sourceTitle: note.title,
      rationale: `Research note matches task (score: ${match.score.toFixed(2)}): ${rec.text.slice(0, 100)}`,
    });
  }

  if (shouldAdjustPriority(match.task.priority, rec.priority)) {
    const alreadyChanged = priorityChanges.some((c) => c.taskDisplayId === match.task.display_id);
    if (!alreadyChanged) {
      priorityChanges.push({
        taskDisplayId: match.task.display_id,
        taskTitle: match.task.title ?? match.task.display_id,
        currentPriority: match.task.priority,
        suggestedPriority: rec.priority,
        sourceNoteId: note.id,
        sourceTitle: note.title,
        rationale: rec.isCompetitive
          ? `Competitive analysis suggests elevated priority: ${rec.text.slice(0, 100)}`
          : `Research findings suggest priority change: ${rec.text.slice(0, 100)}`,
      });
    }
  }
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function shouldAdjustPriority(current: TaskPriority, suggested: TaskPriority): boolean {
  return PRIORITY_RANK[suggested] > PRIORITY_RANK[current];
}

function buildNewTaskSuggestion(
  rec: Recommendation,
  note: NoteRecord,
  workstreams: Array<{ number: number; display_id: string; title?: string; description?: string }>
): SuggestedNewTask {
  const bestWs = findBestWorkstream(rec.text, workstreams);

  return {
    title: rec.text.slice(0, 120),
    description: `From research: ${note.title}\n\n${rec.text}`,
    suggestedWorkstream: bestWs?.display_id ?? workstreams[0]?.display_id ?? 'unknown',
    suggestedPriority: rec.priority,
    sourceNoteId: note.id,
    sourceTitle: note.title,
    rationale: rec.isCompetitive
      ? 'Competitive gap identified — no existing task covers this area'
      : 'Research recommendation not covered by existing tasks',
  };
}

function findBestWorkstream(
  text: string,
  workstreams: Array<{ number: number; display_id: string; title?: string; description?: string }>
): { display_id: string } | undefined {
  const lower = text.toLowerCase();
  let bestScore = 0;
  let bestWs: { display_id: string } | undefined;

  for (const ws of workstreams) {
    const wsText = `${ws.title ?? ''} ${ws.description ?? ''}`.toLowerCase();
    const words = wsText.split(/\s+/).filter((w) => w.length > 3);
    const score = words.filter((w) => lower.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestWs = ws;
    }
  }

  return bestWs;
}

function emptyReport(error?: string): CrossRefReport {
  return {
    synthesisNotesScanned: 0,
    tasksScanned: 0,
    workstreamsScanned: 0,
    suggestedNewTasks: [],
    taskUpdates: [],
    priorityChanges: [],
    errors: error ? [error] : [],
  };
}
