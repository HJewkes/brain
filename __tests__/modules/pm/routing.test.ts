import { describe, test, expect } from 'vitest';
import { computeRouting, isAgentDispatchable } from '../../../src/modules/pm/engine/routing.js';
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
      concurrency: 'sequential-within-workstream',
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

  test('testing + agent → haiku, no worktree', () => {
    const result = computeRouting('testing', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'haiku',
      isolation: 'none',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('configuration + agent → haiku, no worktree', () => {
    const result = computeRouting('configuration', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'haiku',
      isolation: 'none',
      verify: false,
      concurrency: 'parallel',
    });
  });

  test('design + agent → opus, no worktree', () => {
    const result = computeRouting('design', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'opus',
      isolation: 'none',
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

  test('documentation + agent → sonnet, no worktree', () => {
    const result = computeRouting('documentation', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'sonnet',
      isolation: 'none',
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
      concurrency: 'sequential-within-workstream',
    });
  });

  test('migration + agent → opus, worktree, verify', () => {
    const result = computeRouting('migration', 'agent');
    expect(result).toEqual<RoutingResult>({
      agentType: 'general-purpose',
      model: 'opus',
      isolation: 'worktree',
      verify: true,
      concurrency: 'sequential-within-workstream',
    });
  });

  // Non-agent modes return default routing
  const nonAgentDefault: RoutingResult = {
    agentType: 'general-purpose',
    model: 'sonnet',
    isolation: 'none',
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
