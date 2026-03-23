import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowDefinition } from '../../../src/modules/workflow/types.js';

const DEFS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'src',
  'modules',
  'workflow',
  'definitions'
);

function loadDefinition(name: string): WorkflowDefinition {
  const content = readFileSync(join(DEFS_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(content);
}

describe('workflow definitions', () => {
  describe('implementation workflow', () => {
    const def = loadDefinition('implementation-workflow');

    it('has version 2', () => {
      expect(def.version).toBe(2);
    });

    it('every step has a template or is human mode', () => {
      for (const step of def.steps) {
        if (step.mode === 'human') continue;
        expect(step.template, `step ${step.id} missing template`).toBeTruthy();
      }
    });

    it('every step has a mode', () => {
      for (const step of def.steps) {
        expect(step.mode, `step ${step.id} missing mode`).toBeTruthy();
      }
    });

    it('fix step has iteration gate', () => {
      const fix = def.steps.find((s) => s.id === 'fix');
      expect(fix?.gates).toBeDefined();
      expect(fix?.gates?.[0]?.maxIterations).toBe(3);
    });

    it('fix loops back to review', () => {
      const fixEdge = def.edges.find((e) => e.from === 'fix');
      expect(fixEdge?.to).toBe('review');
    });
  });

  describe('planning workflow', () => {
    const def = loadDefinition('planning-workflow');

    it('has version 2', () => {
      expect(def.version).toBe(2);
    });

    it('every step has a template', () => {
      for (const step of def.steps) {
        expect(step.template, `step ${step.id} missing template`).toBeTruthy();
      }
    });

    it('critic has 3-round iteration gate', () => {
      const critic = def.steps.find((s) => s.id === 'critic');
      expect(critic?.gates?.[0]?.maxIterations).toBe(3);
    });

    it('has complexity parameter with values', () => {
      const complexity = def.parameters?.find((p) => p.name === 'complexity');
      expect(complexity).toBeDefined();
      expect(complexity?.values).toContain('low');
      expect(complexity?.values).toContain('high');
    });

    it('interview step is assisted mode', () => {
      const interview = def.steps.find((s) => s.id === 'interview');
      expect(interview?.mode).toBe('assisted');
    });
  });

  describe('review workflow', () => {
    const def = loadDefinition('review-workflow');

    it('has version 1', () => {
      expect(def.version).toBe(1);
    });

    it('every agent step has a template', () => {
      for (const step of def.steps) {
        if (step.mode === 'human' || step.id === 'route') continue;
        expect(step.template, `step ${step.id} missing template`).toBeTruthy();
      }
    });

    it('fixup loops back to review', () => {
      const fixupEdge = def.edges.find((e) => e.from === 'fixup');
      expect(fixupEdge?.to).toBe('review');
    });

    it('route has three outgoing edges', () => {
      const routeEdges = def.edges.filter((e) => e.from === 'route');
      expect(routeEdges).toHaveLength(3);
    });

    it('human-review step has human-approval gate', () => {
      const hr = def.steps.find((s) => s.id === 'human-review');
      expect(hr?.gates?.[0]?.type).toBe('human-approval');
    });

    it('requires prUrl and branch parameters', () => {
      const required = def.parameters?.filter((p) => p.required);
      expect(required).toHaveLength(2);
      expect(required?.map((p) => p.name)).toContain('prUrl');
      expect(required?.map((p) => p.name)).toContain('branch');
    });
  });

  describe('brainstorming workflow', () => {
    const def = loadDefinition('brainstorming-workflow');

    it('has version 1', () => {
      expect(def.version).toBe(1);
    });

    it('has 6 steps in explore→interview→propose→design→write-doc→write-plan order', () => {
      expect(def.steps.map((s) => s.id)).toEqual([
        'explore',
        'interview',
        'propose',
        'design',
        'write-doc',
        'write-plan',
      ]);
    });

    it('every step has a template', () => {
      for (const step of def.steps) {
        expect(step.template, `step ${step.id} missing template`).toBeTruthy();
      }
    });

    it('every step has a mode', () => {
      for (const step of def.steps) {
        expect(step.mode, `step ${step.id} missing mode`).toBeTruthy();
      }
    });

    it('interview, propose, and design are assisted mode', () => {
      for (const id of ['interview', 'propose', 'design']) {
        const step = def.steps.find((s) => s.id === id);
        expect(step?.mode, `step ${id}`).toBe('assisted');
      }
    });

    it('explore, write-doc, and write-plan are agent mode', () => {
      for (const id of ['explore', 'write-doc', 'write-plan']) {
        const step = def.steps.find((s) => s.id === id);
        expect(step?.mode, `step ${id}`).toBe('agent');
      }
    });

    it('design has approval and iteration gates', () => {
      const design = def.steps.find((s) => s.id === 'design');
      expect(design?.gates).toHaveLength(2);
      expect(design?.gates?.[0]?.type).toBe('approval');
      expect(design?.gates?.[1]?.type).toBe('iteration');
      expect(design?.gates?.[1]?.maxIterations).toBe(3);
    });

    it('design→interview is a conditional feedback edge', () => {
      const feedbackEdge = def.edges.find((e) => e.from === 'design' && e.to === 'interview');
      expect(feedbackEdge?.condition).toBe('needs_clarification');
    });

    it('has 6 edges total (5 unconditional + 1 conditional)', () => {
      expect(def.edges).toHaveLength(6);
      const conditional = def.edges.filter((e) => e.condition);
      expect(conditional).toHaveLength(1);
    });

    it('requires topic parameter', () => {
      const topic = def.parameters?.find((p) => p.name === 'topic');
      expect(topic?.required).toBe(true);
    });

    it('repo parameter is optional', () => {
      const repo = def.parameters?.find((p) => p.name === 'repo');
      expect(repo?.required).toBe(false);
    });
  });

  describe('pr-lifecycle workflow', () => {
    const def = loadDefinition('pr-lifecycle-workflow');

    it('has version 1', () => {
      expect(def.version).toBe(1);
    });

    it('has 5 steps in implement→create-pr→review→fixup→merge order', () => {
      expect(def.steps.map((s) => s.id)).toEqual([
        'implement',
        'create-pr',
        'review',
        'fixup',
        'merge',
      ]);
    });

    it('every agent step has a template', () => {
      for (const step of def.steps) {
        if (step.mode === 'human') continue;
        expect(step.template, `step ${step.id} missing template`).toBeTruthy();
      }
    });

    it('every step has a mode', () => {
      for (const step of def.steps) {
        expect(step.mode, `step ${step.id} missing mode`).toBeTruthy();
      }
    });

    it('fixup step has iteration gate with max 3 rounds', () => {
      const fixup = def.steps.find((s) => s.id === 'fixup');
      expect(fixup?.gates).toBeDefined();
      const iterGate = fixup?.gates?.find((g) => g.type === 'iteration');
      expect(iterGate?.maxIterations).toBe(3);
    });

    it('merge step is human mode', () => {
      const merge = def.steps.find((s) => s.id === 'merge');
      expect(merge?.mode).toBe('human');
    });

    it('fixup loops back to review', () => {
      const fixupEdge = def.edges.find((e) => e.from === 'fixup');
      expect(fixupEdge?.to).toBe('review');
    });

    it('review has two outgoing conditional edges', () => {
      const reviewEdges = def.edges.filter((e) => e.from === 'review');
      expect(reviewEdges).toHaveLength(2);
      const conditions = reviewEdges.map((e) => e.condition);
      expect(conditions).toContain('approved');
      expect(conditions).toContain('changes_requested');
    });

    it('review→merge edge has approved condition', () => {
      const approvedEdge = def.edges.find((e) => e.from === 'review' && e.to === 'merge');
      expect(approvedEdge?.condition).toBe('approved');
    });

    it('review→fixup edge has changes_requested condition', () => {
      const changesEdge = def.edges.find((e) => e.from === 'review' && e.to === 'fixup');
      expect(changesEdge?.condition).toBe('changes_requested');
    });

    it('requires taskId and branch parameters', () => {
      const required = def.parameters?.filter((p) => p.required);
      expect(required?.map((p) => p.name)).toContain('taskId');
      expect(required?.map((p) => p.name)).toContain('branch');
    });

    it('prUrl parameter is optional', () => {
      const prUrl = def.parameters?.find((p) => p.name === 'prUrl');
      expect(prUrl?.required).toBeFalsy();
    });

    it('baseBranch defaults to main', () => {
      const base = def.parameters?.find((p) => p.name === 'baseBranch');
      expect(base?.default).toBe('main');
    });

    it('has no unconditional cycles (DAG is valid)', () => {
      const unconditional = def.edges.filter((e) => !e.condition);
      const adj = new Map<string, string[]>();
      for (const step of def.steps) adj.set(step.id, []);
      for (const edge of unconditional) adj.get(edge.from)?.push(edge.to);

      const visited = new Set<string>();
      const inStack = new Set<string>();

      function hasCycle(node: string): boolean {
        if (inStack.has(node)) return true;
        if (visited.has(node)) return false;
        visited.add(node);
        inStack.add(node);
        for (const neighbor of adj.get(node) ?? []) {
          if (hasCycle(neighbor)) return true;
        }
        inStack.delete(node);
        return false;
      }

      for (const step of def.steps) {
        expect(hasCycle(step.id)).toBe(false);
      }
    });
  });
});
