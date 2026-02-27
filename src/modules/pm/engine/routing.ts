import type { TaskCategory, TaskMode } from '../types.js';

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
    concurrency: 'sequential-within-workstream',
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
    isolation: 'none',
    verify: false,
    concurrency: 'parallel',
  },
  configuration: {
    agentType: 'general-purpose',
    model: 'haiku',
    isolation: 'none',
    verify: false,
    concurrency: 'parallel',
  },
  design: {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'none',
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
    isolation: 'none',
    verify: false,
    concurrency: 'parallel',
  },
  infrastructure: {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'worktree',
    verify: true,
    concurrency: 'sequential-within-workstream',
  },
  migration: {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'worktree',
    verify: true,
    concurrency: 'sequential-within-workstream',
  },
};

const NON_AGENT_DEFAULT: RoutingResult = {
  agentType: 'general-purpose',
  model: 'sonnet',
  isolation: 'none',
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
  return mode === 'agent';
}
