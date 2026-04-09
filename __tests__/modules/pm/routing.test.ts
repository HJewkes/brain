import { describe, test, expect } from 'vitest';
import {
  computeRouting,
  isAgentDispatchable,
  classifyWorkflowTurnComplexity,
} from '../../../src/modules/pm/engine/routing.js';
import type { RoutingResult } from '../../../src/modules/pm/engine/routing.js';
import type { TaskCategory } from '../../../src/modules/pm/types.js';

describe('computeRouting', () => {
  // Agent mode — every category
  test('implementation + agent → opus, worktree, verify', () => {
    const result = computeRouting('implementation', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'opus',
      isolation: 'worktree',
      verify: true,
      concurrency: 'parallel',
    });
  });

  test('research + agent → sonnet, Explore, no worktree', () => {
    const result = computeRouting('research', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'Explore',
      model: 'sonnet',
      isolation: 'none',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('testing + agent → haiku, worktree', () => {
    const result = computeRouting('testing', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'haiku',
      isolation: 'worktree',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('configuration + agent → haiku, worktree', () => {
    const result = computeRouting('configuration', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'haiku',
      isolation: 'worktree',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('design + agent → opus, worktree', () => {
    const result = computeRouting('design', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'opus',
      isolation: 'worktree',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('review + agent → sonnet, Explore, no worktree', () => {
    const result = computeRouting('review', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'Explore',
      model: 'sonnet',
      isolation: 'none',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('documentation + agent → sonnet, worktree', () => {
    const result = computeRouting('documentation', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'sonnet',
      isolation: 'worktree',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('infrastructure + agent → opus, worktree, verify', () => {
    const result = computeRouting('infrastructure', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'opus',
      isolation: 'worktree',
      verify: true,
      concurrency: 'parallel',
    });
  });

  test('migration + agent → opus, worktree, verify', () => {
    const result = computeRouting('migration', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'opus',
      isolation: 'worktree',
      verify: true,
      concurrency: 'parallel',
    });
  });

  // Non-agent modes return default routing (worktree by default)
  const nonAgentDefault: RoutingResult = {
    agentType: 'general-purpose',
    model: 'sonnet',
    isolation: 'worktree',
    verify: false,
    concurrency: 'parallel',
  };

  const categories: TaskCategory[] = [
    'implementation',
    'testing',
    'documentation',
    'research',
    'review',
    'infrastructure',
    'configuration',
    'design',
    'migration',
  ];

  test('any category + assisted → default non-agent routing', () => {
    for (const category of categories) {
      expect(computeRouting(category, 'assisted')).toEqual(nonAgentDefault);
    }
  });

  test('any category + human → default non-agent routing', () => {
    for (const category of categories) {
      expect(computeRouting(category, 'human')).toEqual(nonAgentDefault);
    }
  });

  test('any category + review → default non-agent routing', () => {
    for (const category of categories) {
      expect(computeRouting(category, 'review')).toEqual(nonAgentDefault);
    }
  });

  test('returns a copy, not a reference to internal state', () => {
    const a = computeRouting('implementation', 'agent');
    const b = computeRouting('implementation', 'agent');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('classifyWorkflowTurnComplexity', () => {
  test('complex templates use opus on first iteration', () => {
    for (const t of [
      'planning-design',
      'planning-critic',
      'brainstorm-design',
      'implementation-compact',
    ]) {
      expect(classifyWorkflowTurnComplexity(t, 0)).toBe('opus');
    }
  });

  test('simple/formulaic templates use haiku on first iteration', () => {
    for (const t of ['planning-spectests', 'review-fixup', 'ops', 'brainstorm-write-doc']) {
      expect(classifyWorkflowTurnComplexity(t, 0)).toBe('haiku');
    }
  });

  test('routine templates use sonnet on first iteration', () => {
    for (const t of [
      'planning-research',
      'review-agent',
      'brainstorm-explore',
      'planning-decompose',
    ]) {
      expect(classifyWorkflowTurnComplexity(t, 0)).toBe('sonnet');
    }
  });

  test('unknown templates fall back to sonnet', () => {
    expect(classifyWorkflowTurnComplexity('unknown-template', 0)).toBe('sonnet');
  });

  test('complex templates step down to sonnet on retries', () => {
    expect(classifyWorkflowTurnComplexity('planning-design', 1)).toBe('sonnet');
    expect(classifyWorkflowTurnComplexity('planning-critic', 2)).toBe('sonnet');
  });

  test('sonnet templates step down to haiku on retries', () => {
    expect(classifyWorkflowTurnComplexity('planning-research', 1)).toBe('haiku');
  });

  test('haiku templates stay at haiku on retries', () => {
    expect(classifyWorkflowTurnComplexity('planning-spectests', 1)).toBe('haiku');
  });
});

describe('isAgentDispatchable', () => {
  test('agent → true', () => {
    expect(isAgentDispatchable('agent')).toBe(true);
  });

  test('assisted → false', () => {
    expect(isAgentDispatchable('assisted')).toBe(false);
  });

  test('human → false', () => {
    expect(isAgentDispatchable('human')).toBe(false);
  });

  test('review → false', () => {
    expect(isAgentDispatchable('review')).toBe(false);
  });
});
