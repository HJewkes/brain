import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder } from '../../../types.js';
import { search, searchMemories } from '../../../services/search.js';
import type { TaskReadinessScore } from '../types.js';

export interface RelatedResearchEntry {
  title: string;
  noteId: string;
  relevance: number;
  excerpt: string;
}

export interface EnrichmentSuggestion {
  taskId: string;
  currentDescription: string;
  suggestedAdditions: string[];
  relatedResearch: RelatedResearchEntry[];
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

function buildSearchQuery(task: TaskReadinessScore): string {
  const parts: string[] = [];
  if (task.title) parts.push(task.title);
  if (task.description) parts.push(task.description.slice(0, 200));
  if (task.category) parts.push(task.category);
  return parts.join(' ').trim() || task.taskId;
}

async function enrichTask(
  db: BrainDB,
  embedder: Embedder,
  task: TaskReadinessScore,
  minRelevance: number
): Promise<EnrichmentSuggestion> {
  const query = buildSearchQuery(task);

  // Search for related research notes
  const searchResult = await search(db, embedder, query, {
    limit: 5,
    tier: 'slow',
  });

  const relatedResearch: RelatedResearchEntry[] = searchResult.results
    .filter((r) => r.score >= minRelevance)
    .filter((r) =>
      r.tags.some(
        (t) => t.includes('research') || t.includes('synthesis') || t.includes('competitive')
      )
    )
    .map((r) => ({
      title: r.heading ?? r.noteId,
      noteId: r.noteId,
      relevance: r.score,
      excerpt: r.excerpt.slice(0, 300),
    }));

  // Search memories for relevant context
  const memoryResults = await searchMemories(db, embedder, query, 5);
  const relatedMemories = memoryResults.filter((m) => m.score >= minRelevance).map((m) => m.memory);

  const suggestedAdditions: string[] = [];

  if (!task.dimensions.hasDescription) {
    suggestedAdditions.push('Add a detailed description explaining what needs to be implemented');
  }

  if (!task.dimensions.hasRelatedResearch && relatedResearch.length > 0) {
    const refs = relatedResearch.map((r) => `${r.title} (${r.excerpt.slice(0, 80)}…)`).join('; ');
    suggestedAdditions.push(`Related research found: ${refs}`);
  }

  if (!task.dimensions.hasDoneWhen) {
    suggestedAdditions.push('Add acceptance criteria or done-when definition');
  }

  if (relatedMemories.length > 0) {
    suggestedAdditions.push(`Relevant memories: ${relatedMemories.join('; ')}`);
  }

  return {
    taskId: task.taskId,
    currentDescription: task.description,
    suggestedAdditions,
    relatedResearch,
    relatedMemories,
  };
}
