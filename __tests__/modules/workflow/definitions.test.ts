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
});

// Appended by hand — remove the duplicate closing brace above first
