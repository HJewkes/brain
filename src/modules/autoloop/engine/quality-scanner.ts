import type { BrainDB } from '../../../services/brain-db.js';
import type { TaskReadinessScore } from '../types.js';
import { listTasks } from '../../pm/data/task-ops.js';

export interface QualityScanOptions {
  project: string;
  workstream?: number;
  status?: string;
}

export interface QualityScanReport {
  totalScanned: number;
  averageReadiness: number;
  underSpecified: TaskReadinessScore[];
  wellSpecified: TaskReadinessScore[];
}

const VAGUE_PATTERNS = [
  /^(fix|update|improve|refactor|handle|add|implement)\s/i,
  /^TODO/i,
  /^WIP/i,
];

const MIN_DESCRIPTION_LENGTH = 30;

export function scanTaskQuality(db: BrainDB, opts: QualityScanOptions): QualityScanReport {
  const result = listTasks(
    db,
    opts.project,
    {
      workstream: opts.workstream,
      status: opts.status ?? 'pending',
    },
    'default'
  );

  if (!result.ok) {
    return {
      totalScanned: 0,
      averageReadiness: 0,
      underSpecified: [],
      wellSpecified: [],
    };
  }

  const scores: TaskReadinessScore[] = result.data.map((task) => scoreTask(task));

  const underSpecified = scores
    .filter((s) => s.overall < 0.6)
    .sort((a, b) => a.overall - b.overall);

  const wellSpecified = scores
    .filter((s) => s.overall >= 0.6)
    .sort((a, b) => b.overall - a.overall);

  const totalScore = scores.reduce((sum, s) => sum + s.overall, 0);

  return {
    totalScanned: scores.length,
    averageReadiness: scores.length > 0 ? totalScore / scores.length : 0,
    underSpecified,
    wellSpecified,
  };
}

export function scoreTask(task: {
  display_id: string;
  title?: string;
  description?: string;
  category?: string;
  depends_on?: string[];
  done_when?: string;
  acceptance_criteria?: string[];
}): TaskReadinessScore {
  const suggestions: string[] = [];

  const hasDescription = !!(task.description && task.description.length >= MIN_DESCRIPTION_LENGTH);
  if (!hasDescription) {
    suggestions.push('Add a detailed description (30+ chars)');
  }

  const hasDependencies = !!(task.depends_on && task.depends_on.length > 0);

  const hasDoneWhen = !!(
    task.done_when ||
    (task.acceptance_criteria && task.acceptance_criteria.length > 0)
  );
  if (!hasDoneWhen) {
    suggestions.push('Add done-when criteria or acceptance criteria');
  }

  const hasRelatedResearch = !!(
    task.description &&
    (task.description.includes('research') ||
      task.description.includes('synthesis') ||
      task.description.includes('See ') ||
      task.description.includes('Ref:'))
  );

  const isSpecific = isTaskSpecific(task.title ?? '', task.description ?? '');
  if (!isSpecific) {
    suggestions.push('Title or description is too vague — add concrete details');
  }

  const dimensions = {
    hasDescription,
    hasDependencies,
    hasRelatedResearch,
    hasDoneWhen,
    isSpecific,
  };

  const weights = {
    hasDescription: 0.25,
    hasDependencies: 0.1,
    hasRelatedResearch: 0.15,
    hasDoneWhen: 0.1,
    isSpecific: 0.4,
  };

  const overall =
    (dimensions.hasDescription ? weights.hasDescription : 0) +
    (dimensions.hasDependencies ? weights.hasDependencies : 0) +
    (dimensions.hasRelatedResearch ? weights.hasRelatedResearch : 0) +
    (dimensions.hasDoneWhen ? weights.hasDoneWhen : 0) +
    (dimensions.isSpecific ? weights.isSpecific : 0);

  return {
    taskId: task.display_id,
    title: task.title ?? '',
    description: task.description ?? '',
    category: task.category ?? '',
    overall,
    dimensions,
    suggestions,
  };
}

function isTaskSpecific(title: string, description: string): boolean {
  const combined = `${title} ${description}`;

  // Check for actionable content first — these override vague pattern detection
  const hasFileRef = /\.[jt]sx?|\.py|\.rs|\.go|\.md/.test(combined);
  const hasComponentRef = /[A-Z][a-z]+[A-Z]/.test(combined); // PascalCase
  const hasCodeRef = /`[^`]+`/.test(combined); // inline code
  const hasStructuredContent =
    combined.includes(':') || combined.includes('→') || combined.includes('--');

  if (hasFileRef || hasComponentRef || hasCodeRef || hasStructuredContent) return true;
  if (description.length >= MIN_DESCRIPTION_LENGTH) return true;

  // Vague patterns with insufficient detail
  if (VAGUE_PATTERNS.some((p) => p.test(title))) return false;
  if (title.length < 10) return false;

  return true;
}
