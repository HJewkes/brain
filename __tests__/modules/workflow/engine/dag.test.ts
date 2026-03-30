import { describe, test, expect } from 'vitest';
import {
  validateDag,
  topologicalSort,
  getSuccessors,
  getPredecessors,
  isConditionalOnlyTarget,
} from '../../../../src/modules/workflow/engine/dag.js';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowEdge,
} from '../../../../src/modules/workflow/types.js';

function makeDefinition(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  overrides: Partial<WorkflowDefinition> = {}
): WorkflowDefinition {
  return {
    version: 1,
    name: 'test-workflow',
    description: 'Test workflow definition',
    steps,
    edges,
    ...overrides,
  };
}

function step(id: string, name?: string): WorkflowStep {
  return { id, name: name ?? id };
}

function edge(from: string, to: string, condition?: string): WorkflowEdge {
  return { from, to, ...(condition ? { condition } : {}) };
}

// --- AC-03: Workflow Definition Validation (register) ---

describe('validateDag', () => {
  describe('AC-03: valid DAG acceptance', () => {
    test('accepts a valid linear DAG with entry and terminal steps', () => {
      const def = makeDefinition(
        [step('a'), step('b'), step('c')],
        [edge('a', 'b'), edge('b', 'c')]
      );
      const result = validateDag(def);
      expect(result.ok).toBe(true);
    });

    test('accepts a valid DAG with branching and merging', () => {
      const def = makeDefinition(
        [step('a'), step('b'), step('c'), step('d')],
        [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]
      );
      const result = validateDag(def);
      expect(result.ok).toBe(true);
    });

    test('accepts a DAG with multiple entry steps', () => {
      const def = makeDefinition(
        [step('a'), step('b'), step('c')],
        [edge('a', 'c'), edge('b', 'c')]
      );
      const result = validateDag(def);
      expect(result.ok).toBe(true);
    });

    test('accepts a DAG with multiple terminal steps', () => {
      const def = makeDefinition(
        [step('a'), step('b'), step('c')],
        [edge('a', 'b'), edge('a', 'c')]
      );
      const result = validateDag(def);
      expect(result.ok).toBe(true);
    });

    test('accepts a single-step DAG with no edges', () => {
      const def = makeDefinition([step('only')], []);
      const result = validateDag(def);
      expect(result.ok).toBe(true);
    });
  });

  describe('AC-03: cycle detection', () => {
    test('rejects a DAG with a direct cycle and returns CYCLE_DETECTED', () => {
      const def = makeDefinition([step('a'), step('b')], [edge('a', 'b'), edge('b', 'a')]);
      const result = validateDag(def);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CYCLE_DETECTED');
      }
    });

    test('rejects a DAG with an indirect cycle', () => {
      const def = makeDefinition(
        [step('a'), step('b'), step('c')],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
      );
      const result = validateDag(def);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CYCLE_DETECTED');
      }
    });

    test('cycle error identifies the cycle path', () => {
      const def = makeDefinition(
        [step('a'), step('b'), step('c')],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')]
      );
      const result = validateDag(def);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CYCLE_DETECTED');
        // Error message or details should indicate which steps form the cycle
        const msg = result.error.message + JSON.stringify(result.error.details ?? {});
        expect(msg).toMatch(/b|c/);
      }
    });
  });

  describe('AC-03: dangling edge references', () => {
    test('rejects an edge referencing a non-existent source step', () => {
      const def = makeDefinition([step('a'), step('b')], [edge('nonexistent', 'b')]);
      const result = validateDag(def);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_DEFINITION');
        expect(result.error.message).toContain('nonexistent');
      }
    });

    test('rejects an edge referencing a non-existent target step', () => {
      const def = makeDefinition([step('a'), step('b')], [edge('a', 'nonexistent')]);
      const result = validateDag(def);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_DEFINITION');
        expect(result.error.message).toContain('nonexistent');
      }
    });
  });

  describe('AC-03: terminal step requirement', () => {
    test('rejects a DAG with no terminal steps', () => {
      const def = makeDefinition([step('a'), step('b')], [edge('a', 'b'), edge('b', 'a')]);
      const result = validateDag(def);
      expect(result.ok).toBe(false);
    });
  });

  describe('AC-E8: empty workflow definition', () => {
    test('rejects a definition with an empty steps array', () => {
      const def = makeDefinition([], []);
      const result = validateDag(def);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_DEFINITION');
        expect(result.error.message).toMatch(/at least one step/i);
      }
    });
  });
});

// --- Topological sort ---

describe('topologicalSort', () => {
  test('returns steps in valid topological order for a linear chain', () => {
    const steps = [step('a'), step('b'), step('c')];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    const result = topologicalSort(steps, edges);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const order = result.data;
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    }
  });

  test('returns steps in valid order for a diamond DAG', () => {
    const steps = [step('a'), step('b'), step('c'), step('d')];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    const result = topologicalSort(steps, edges);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const order = result.data;
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    }
  });

  test('fails with CYCLE_DETECTED for cyclic graph', () => {
    const steps = [step('a'), step('b')];
    const edges = [edge('a', 'b'), edge('b', 'a')];
    const result = topologicalSort(steps, edges);
    expect(result.ok).toBe(false);
  });
});

// --- Successor / predecessor helpers ---

describe('getSuccessors', () => {
  test('returns direct successors of a step', () => {
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd')];
    expect(getSuccessors('a', edges)).toEqual(expect.arrayContaining(['b', 'c']));
    expect(getSuccessors('a', edges)).toHaveLength(2);
  });

  test('returns empty array for terminal step', () => {
    const edges = [edge('a', 'b')];
    expect(getSuccessors('b', edges)).toEqual([]);
  });
});

describe('getPredecessors', () => {
  test('returns direct predecessors of a step', () => {
    const edges = [edge('a', 'c'), edge('b', 'c')];
    expect(getPredecessors('c', edges)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(getPredecessors('c', edges)).toHaveLength(2);
  });

  test('returns empty array for entry step', () => {
    const edges = [edge('a', 'b')];
    expect(getPredecessors('a', edges)).toEqual([]);
  });
});

// --- isConditionalOnlyTarget ---

describe('isConditionalOnlyTarget', () => {
  test('returns true for step with only conditional incoming edges', () => {
    const edges = [edge('a', 'b', 'needs_revision')];
    expect(isConditionalOnlyTarget('b', edges)).toBe(true);
  });

  test('returns false for step with unconditional incoming edges', () => {
    const edges = [edge('a', 'b'), edge('c', 'b', 'needs_revision')];
    expect(isConditionalOnlyTarget('b', edges)).toBe(false);
  });

  test('returns false for step with no incoming edges (entry node)', () => {
    const edges = [edge('a', 'b')];
    expect(isConditionalOnlyTarget('a', edges)).toBe(false);
  });

  test('returns true for step with multiple conditional incoming edges', () => {
    const edges = [edge('a', 'c', 'cond1'), edge('b', 'c', 'cond2')];
    expect(isConditionalOnlyTarget('c', edges)).toBe(true);
  });
});
