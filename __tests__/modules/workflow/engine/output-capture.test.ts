import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  captureStepOutput,
  getStepOutput,
  injectStepOutputVariables,
} from '../../../../src/modules/workflow/engine/output-capture.js';

let projectDir: string;

beforeEach(() => {
  projectDir = join(tmpdir(), `oc-test-${randomUUID()}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

describe('captureStepOutput', () => {
  test('creates directories and writes output file', () => {
    captureStepOutput(projectDir, 'TST-01.05', 'research', 'Research findings here');

    const path = join(projectDir, '.plans', 'TST-01.05', 'step-outputs', 'research.md');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('Research findings here');
  });

  test('overwrites existing output', () => {
    captureStepOutput(projectDir, 'TST-01.05', 'research', 'First version');
    captureStepOutput(projectDir, 'TST-01.05', 'research', 'Second version');

    const path = join(projectDir, '.plans', 'TST-01.05', 'step-outputs', 'research.md');
    expect(readFileSync(path, 'utf-8')).toBe('Second version');
  });
});

describe('getStepOutput', () => {
  test('returns content for existing output', () => {
    captureStepOutput(projectDir, 'TST-01.05', 'design', 'Design doc');
    expect(getStepOutput(projectDir, 'TST-01.05', 'design')).toBe('Design doc');
  });

  test('returns null for missing output', () => {
    expect(getStepOutput(projectDir, 'TST-01.05', 'nonexistent')).toBeNull();
  });

  test('returns null for missing instance directory', () => {
    expect(getStepOutput(projectDir, 'DOES-NOT-EXIST', 'research')).toBeNull();
  });
});

describe('injectStepOutputVariables', () => {
  test('injects STEP_OUTPUT_* variables for completed steps', () => {
    captureStepOutput(projectDir, 'TST-01.05', 'research', 'Research output');
    captureStepOutput(projectDir, 'TST-01.05', 'design', 'Design output');

    const vars: Record<string, string> = {};
    injectStepOutputVariables(projectDir, 'TST-01.05', ['research', 'design'], vars);

    expect(vars.STEP_OUTPUT_RESEARCH).toBe('Research output');
    expect(vars.STEP_OUTPUT_DESIGN).toBe('Design output');
    expect(vars.PREVIOUS_STEP_OUTPUTS).toContain('### research');
    expect(vars.PREVIOUS_STEP_OUTPUTS).toContain('### design');
  });

  test('skips steps with no output', () => {
    captureStepOutput(projectDir, 'TST-01.05', 'research', 'Only research');

    const vars: Record<string, string> = {};
    injectStepOutputVariables(projectDir, 'TST-01.05', ['research', 'missing'], vars);

    expect(vars.STEP_OUTPUT_RESEARCH).toBe('Only research');
    expect(vars.STEP_OUTPUT_MISSING).toBeUndefined();
  });

  test('does not set PREVIOUS_STEP_OUTPUTS when no outputs exist', () => {
    const vars: Record<string, string> = {};
    injectStepOutputVariables(projectDir, 'TST-01.05', ['nonexistent'], vars);

    expect(vars.PREVIOUS_STEP_OUTPUTS).toBeUndefined();
  });

  test('converts hyphenated step IDs to underscored variable names', () => {
    captureStepOutput(projectDir, 'TST-01.05', 'spec-tests', 'Spec test output');

    const vars: Record<string, string> = {};
    injectStepOutputVariables(projectDir, 'TST-01.05', ['spec-tests'], vars);

    expect(vars.STEP_OUTPUT_SPEC_TESTS).toBe('Spec test output');
  });
});
