import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { analyzeFriction } from '../engine/friction.js';
import type {
  FrictionAnalysis,
  FrictionEvent,
  FrictionPatternType,
} from '../engine/friction-types.js';
import { listSessions } from '../../sessions/data/session-ops.js';
import { aggregateSessionEvents } from '../../sessions/engine/aggregate.js';
import { parseDuration, sessionAnalyticsToFrictionInput, mergeAnalyses } from './observe.js';

export type ImprovementCategory = 'hooks' | 'prompts' | 'workflow' | 'infrastructure';
export type ImprovementImpact = 'low' | 'medium' | 'high';

export interface Suggestion {
  category: ImprovementCategory;
  impact: ImprovementImpact;
  description: string;
  steps: string[];
  sourceEvents: number;
}

const IMPACT_ORDER: Record<ImprovementImpact, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const PATTERN_TO_CATEGORY: Record<FrictionPatternType, ImprovementCategory> = {
  repeated_tool_failure: 'infrastructure',
  permission_denial: 'hooks',
  excessive_retry: 'prompts',
  context_pressure: 'workflow',
  progress_stall: 'workflow',
  agent_spawn_failure: 'infrastructure',
  hook_prevention: 'hooks',
  error_loop: 'prompts',
};

export function categorizeEvents(
  events: FrictionEvent[]
): Map<ImprovementCategory, FrictionEvent[]> {
  const grouped = new Map<ImprovementCategory, FrictionEvent[]>();
  for (const event of events) {
    const category = PATTERN_TO_CATEGORY[event.type];
    const list = grouped.get(category) ?? [];
    list.push(event);
    grouped.set(category, list);
  }
  return grouped;
}

export function computeImpact(events: FrictionEvent[]): ImprovementImpact {
  const hasCritical = events.some((e) => e.severity === 'critical');
  if (hasCritical || events.length >= 5) return 'high';
  const hasHigh = events.some((e) => e.severity === 'high');
  if (hasHigh || events.length >= 3) return 'medium';
  return 'low';
}

export function generateSteps(category: ImprovementCategory, events: FrictionEvent[]): string[] {
  const generators: Record<ImprovementCategory, () => string[]> = {
    hooks: () => generateHookSteps(events),
    prompts: () => generatePromptSteps(events),
    workflow: () => generateWorkflowSteps(events),
    infrastructure: () => generateInfraSteps(events),
  };
  return generators[category]();
}

function generateHookSteps(events: FrictionEvent[]): string[] {
  const steps: string[] = [];
  const hasPermission = events.some((e) => e.type === 'permission_denial');
  const hasHookPrevention = events.some((e) => e.type === 'hook_prevention');

  if (hasPermission) {
    steps.push('Review file ownership rules in hook configuration');
    steps.push('Add missing path patterns to allowed-writes list');
  }
  if (hasHookPrevention) {
    steps.push('Audit hook prevention rules for false positives');
    steps.push('Consider adding pre-check validation before triggering hooks');
  }
  if (steps.length === 0) {
    steps.push('Review hook configuration for unnecessary restrictions');
  }
  return steps;
}

function generatePromptSteps(events: FrictionEvent[]): string[] {
  const steps: string[] = [];
  const hasRetry = events.some((e) => e.type === 'excessive_retry');
  const hasErrorLoop = events.some((e) => e.type === 'error_loop');

  if (hasRetry) {
    steps.push('Add clearer error messages to guide retry strategy');
    steps.push('Consider adding tool-specific usage examples to prompts');
  }
  if (hasErrorLoop) {
    steps.push('Add loop-breaking instructions to system prompts');
    steps.push('Set maximum retry limits in agent configuration');
  }
  if (steps.length === 0) {
    steps.push('Review prompt clarity for common failure patterns');
  }
  return steps;
}

function generateWorkflowSteps(events: FrictionEvent[]): string[] {
  const steps: string[] = [];
  const hasContextPressure = events.some((e) => e.type === 'context_pressure');
  const hasStall = events.some((e) => e.type === 'progress_stall');

  if (hasContextPressure) {
    steps.push('Break long tasks into smaller sub-tasks');
    steps.push('Add context checkpoints to preserve key information');
  }
  if (hasStall) {
    steps.push('Add progress tracking to long-running workflows');
    steps.push('Set timeout thresholds for stalled steps');
  }
  if (steps.length === 0) {
    steps.push('Review workflow step granularity for optimization');
  }
  return steps;
}

function generateInfraSteps(events: FrictionEvent[]): string[] {
  const steps: string[] = [];
  const hasToolFailure = events.some((e) => e.type === 'repeated_tool_failure');
  const hasSpawnFailure = events.some((e) => e.type === 'agent_spawn_failure');

  if (hasToolFailure) {
    steps.push('Check tool availability and configuration');
    steps.push('Add health checks before tool invocation');
  }
  if (hasSpawnFailure) {
    steps.push('Verify agent spawn prerequisites and resource limits');
    steps.push('Add retry-with-backoff for transient spawn failures');
  }
  if (steps.length === 0) {
    steps.push('Review infrastructure health and resource allocation');
  }
  return steps;
}

export function buildSuggestions(analysis: FrictionAnalysis): Suggestion[] {
  if (analysis.events.length === 0) return [];

  const grouped = categorizeEvents(analysis.events);
  const suggestions: Suggestion[] = [];

  grouped.forEach((events, category) => {
    suggestions.push({
      category,
      impact: computeImpact(events),
      description: buildDescription(category, events),
      steps: generateSteps(category, events),
      sourceEvents: events.length,
    });
  });

  return suggestions.sort((a, b) => IMPACT_ORDER[b.impact] - IMPACT_ORDER[a.impact]);
}

function buildDescription(category: ImprovementCategory, events: FrictionEvent[]): string {
  const types = [...new Set(events.map((e) => e.type))];
  const typeLabels = types.map((t) => t.replace(/_/g, ' ')).join(', ');
  return `${capitalize(category)} improvements needed: ${events.length} event(s) involving ${typeLabels}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function filterByCategory(
  suggestions: Suggestion[],
  category: ImprovementCategory
): Suggestion[] {
  return suggestions.filter((s) => s.category === category);
}

export function formatSuggestions(suggestions: Suggestion[]): string {
  const lines: string[] = [];

  if (suggestions.length === 0) {
    lines.push('No improvement suggestions — no friction detected.');
    return lines.join('\n');
  }

  lines.push(`Improvement Suggestions (${suggestions.length})`);
  lines.push('');

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    lines.push(`${i + 1}. [${s.impact.toUpperCase()}] ${s.description}`);
    lines.push(`   Category: ${s.category}`);
    for (const step of s.steps) {
      lines.push(`   - ${step}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildJsonSuggestions(
  suggestions: Suggestion[],
  analysis: FrictionAnalysis
): Record<string, unknown> {
  return {
    frictionScore: analysis.score,
    suggestionCount: suggestions.length,
    suggestions,
  };
}

export function createImproveCommand(): Command {
  return new Command('improve')
    .description('Analyze friction and suggest workflow improvements')
    .option('--since <duration>', 'Time window (e.g., 1h, 24h, 7d)', '24h')
    .option('--session <id>', 'Analyze a specific session')
    .option('--json', 'Output as JSON')
    .option('--category <cat>', 'Filter by category: hooks, prompts, workflow, infrastructure')
    .action(async (opts) => {
      await withDb(async (svc) => {
        const analyses = collectAnalyses(svc.db, opts.since ?? '24h', opts.session);

        if (analyses.length === 0) {
          outputEmpty(!!opts.json);
          return;
        }

        const merged = mergeAnalyses(analyses);
        let suggestions = buildSuggestions(merged);

        if (opts.category) {
          suggestions = filterByCategory(suggestions, validateCategory(opts.category));
        }

        if (opts.json) {
          const json = buildJsonSuggestions(suggestions, merged);
          process.stdout.write(JSON.stringify(json, null, 2) + '\n');
        } else {
          process.stdout.write(formatSuggestions(suggestions) + '\n');
        }
      });
    });
}

function outputEmpty(json: boolean): void {
  if (json) {
    process.stdout.write(
      JSON.stringify({ frictionScore: 0, suggestionCount: 0, suggestions: [] }) + '\n'
    );
  } else {
    process.stdout.write('No session data found.\n');
  }
}

function validateCategory(input: string): ImprovementCategory {
  const valid: ImprovementCategory[] = ['hooks', 'prompts', 'workflow', 'infrastructure'];
  if (valid.includes(input as ImprovementCategory)) return input as ImprovementCategory;
  return 'workflow';
}

function collectAnalyses(
  db: Parameters<Parameters<typeof withDb>[0]>[0]['db'],
  since: string,
  sessionId?: string
): FrictionAnalysis[] {
  if (sessionId) {
    const analytics = aggregateSessionEvents(db, sessionId);
    if (!analytics) return [];
    const input = sessionAnalyticsToFrictionInput(analytics);
    return [analyzeFriction(input)];
  }

  const durationMs = parseDuration(since);
  const cutoff = new Date(Date.now() - durationMs).toISOString();
  const sessions = listSessions(db, { since: cutoff });

  const results: FrictionAnalysis[] = [];
  for (const session of sessions) {
    const analytics = aggregateSessionEvents(db, session.session_id);
    if (!analytics) continue;
    const input = sessionAnalyticsToFrictionInput(analytics);
    results.push(analyzeFriction(input));
  }
  return results;
}
