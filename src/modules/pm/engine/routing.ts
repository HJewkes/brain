import type { TaskCategory, TaskMode } from '../types.js';

type EntityType = 'task' | 'workstream' | 'project';

export function detectEntityType(id: string): EntityType {
  if (id.includes('.')) return 'task';
  if (id.includes('-')) return 'workstream';
  return 'project';
}

export function checkNamespaceMismatch(id: string, expectedType: EntityType): string | null {
  const actualType = detectEntityType(id);
  if (actualType === expectedType) return null;

  const commands: Record<EntityType, string> = {
    task: 'brain pm task show',
    workstream: 'brain pm workstream show',
    project: 'brain pm project show',
  };

  return `${id} is a ${actualType}, not a ${expectedType}.\n  → Use: ${commands[actualType]} ${id}`;
}

export interface RoutingResult {
  agentType: 'general-purpose' | 'Explore' | 'Plan';
  model: 'opus' | 'sonnet' | 'haiku';
  isolation: 'worktree' | 'none';
  verify: boolean;
  concurrency: 'parallel' | 'sequential-within-workstream';
}

const ROUTING_TABLE: Record<TaskCategory, RoutingResult> = {
  implementation: {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'worktree',
    verify: true,
    concurrency: 'parallel',
  },
  research: {
    agentType: 'Explore',
    model: 'sonnet',
    isolation: 'none',
    verify: false,
    concurrency: 'parallel',
  },
  testing: {
    agentType: 'general-purpose',
    model: 'haiku',
    isolation: 'worktree',
    verify: false,
    concurrency: 'parallel',
  },
  configuration: {
    agentType: 'general-purpose',
    model: 'haiku',
    isolation: 'worktree',
    verify: false,
    concurrency: 'parallel',
  },
  design: {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'worktree',
    verify: false,
    concurrency: 'parallel',
  },
  review: {
    agentType: 'Explore',
    model: 'sonnet',
    isolation: 'none',
    verify: false,
    concurrency: 'parallel',
  },
  documentation: {
    agentType: 'general-purpose',
    model: 'sonnet',
    isolation: 'worktree',
    verify: false,
    concurrency: 'parallel',
  },
  infrastructure: {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'worktree',
    verify: true,
    concurrency: 'parallel',
  },
  migration: {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'worktree',
    verify: true,
    concurrency: 'parallel',
  },
};

const NON_AGENT_DEFAULT: RoutingResult = {
  agentType: 'general-purpose',
  model: 'sonnet',
  isolation: 'worktree',
  verify: false,
  concurrency: 'parallel',
};

export function computeRouting(category: TaskCategory, mode: TaskMode): RoutingResult {
  if (!isAgentDispatchable(mode)) {
    return { ...NON_AGENT_DEFAULT };
  }
  return { ...ROUTING_TABLE[category] };
}

export function isAgentDispatchable(mode: TaskMode): boolean {
  return mode === 'agent' || mode === 'auto' || mode === 'interactive';
}

// --- Workflow turn complexity routing ---

// Templates requiring strong reasoning: design, critique, implementation
const COMPLEX_WORKFLOW_TEMPLATES = new Set([
  'planning-design',
  'planning-critic',
  'brainstorm-design',
  'implementation-compact',
]);

// Formulaic templates: generate from spec, apply fixups, write docs, ops tasks
const SIMPLE_WORKFLOW_TEMPLATES = new Set([
  'planning-spectests',
  'review-fixup',
  'ops',
  'brainstorm-write-doc',
]);

/**
 * Classify a workflow dispatch turn's model requirement.
 *
 * Complex templates (design, critique) need opus; formulaic templates
 * (spec-test gen, fixups) can run on haiku; everything else uses sonnet.
 * Retry iterations (iterationCount > 0) step down one tier since prior
 * step outputs provide additional context.
 */
export function classifyWorkflowTurnComplexity(
  templateName: string,
  iterationCount: number
): 'opus' | 'sonnet' | 'haiku' {
  const base: 'opus' | 'sonnet' | 'haiku' = COMPLEX_WORKFLOW_TEMPLATES.has(templateName)
    ? 'opus'
    : SIMPLE_WORKFLOW_TEMPLATES.has(templateName)
      ? 'haiku'
      : 'sonnet';

  if (iterationCount > 0) {
    // Step down one tier on retries — prior context reduces required reasoning
    return base === 'opus' ? 'sonnet' : 'haiku';
  }
  return base;
}
