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
});
