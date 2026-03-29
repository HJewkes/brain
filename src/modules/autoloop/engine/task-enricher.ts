import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder } from '../../../types.js';
import { search } from '../../../services/search.js';
import type { TaskReadinessScore } from '../types.js';

export interface EnrichmentSuggestion {
  taskId: string;
  currentDescription: string;
  suggestedAdditions: string[];
  relatedResearch: Array<{ title: string; noteId: string; relevance: number }>;
  relatedMemories: string[];
}

export interface EnrichmentReport {
  totalTasksScanned: number;
  tasksEnriched: number;
  suggestions: EnrichmentSuggestion[];
}

/**
 * For under-specified tasks, search brain research notes and memories
 * for relevant context. Returns enrichment suggestions with source attribution.
 */
export async function enrichUnderSpecifiedTasks(
  db: BrainDB,
  embedder: Embedder,
  underSpecified: TaskReadinessScore[],
  opts?: { maxTasks?: number; minRelevance?: number }
): Promise<EnrichmentReport> {
  const maxTasks = opts?.maxTasks ?? 10;
  const minRelevance = opts?.minRelevance ?? 0.3;
  const suggestions: EnrichmentSuggestion[] = [];

  const tasksToEnrich = underSpecified.slice(0, maxTasks);

  for (const task of tasksToEnrich) {
    const suggestion = await enrichTask(db, embedder, task, minRelevance);
    if (suggestion.suggestedAdditions.length > 0 || suggestion.relatedResearch.length > 0) {
      suggestions.push(suggestion);
    }
  }

  return {
    totalTasksScanned: underSpecified.length,
    tasksEnriched: suggestions.length,
    suggestions,
  };
}

async function enrichTask(
  db: BrainDB,
  embedder: Embedder,
  task: TaskReadinessScore,
  minRelevance: number
): Promise<EnrichmentSuggestion> {
  const taskTitle = task.taskId;
  const currentDescription = '';

  // Search for related research using the task ID as query
  const searchResult = await search(db, embedder, taskTitle, {
    limit: 5,
    tier: 'slow',
  });

  const relatedResearch = searchResult.results
    .filter((r) => r.score >= minRelevance)
    .filter((r) => {
      // Prefer research notes by checking tags
      return r.tags.some(
        (t) => t.includes('research') || t.includes('synthesis') || t.includes('competitive')
      );
    })
    .map((r) => ({
      title: r.heading ?? r.noteId,
      noteId: r.noteId,
      relevance: r.score,
    }));

  const suggestedAdditions: string[] = [];

  if (!task.dimensions.hasDescription) {
    suggestedAdditions.push('Add a detailed description explaining what needs to be implemented');
  }

  if (!task.dimensions.hasRelatedResearch && relatedResearch.length > 0) {
    const refs = relatedResearch.map((r) => r.title).join(', ');
    suggestedAdditions.push(`Related research found: ${refs}`);
  }

  if (!task.dimensions.hasDoneWhen) {
    suggestedAdditions.push('Add acceptance criteria or done-when definition');
  }

  // Search memories for relevant context
  const relatedMemories: string[] = [];

  return {
    taskId: task.taskId,
    currentDescription,
    suggestedAdditions,
    relatedResearch,
    relatedMemories,
  };
}
