import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPlanningSeed } from '../../../../src/modules/workflow/flows/planning-seed.js';

let projectDir: string;

beforeEach(() => {
  projectDir = join(tmpdir(), `seed-test-${randomUUID()}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

describe('buildPlanningSeed', () => {
  test('produces seed result with no context params', async () => {
    const seed = buildPlanningSeed({
      projectDir,
      planId: 'test-plan',
    });

    const result = await seed();

    expect(result.data.skipResearch).toBe('false');
    expect(result.output).toBe('No pre-existing context provided.');
  });

  test('writes pre-existing-context.md to .plans/<planId>/', async () => {
    const seed = buildPlanningSeed({
      projectDir,
      planId: 'my-plan',
      priorContext: 'Some prior decisions',
    });

    await seed();

    const contextPath = join(projectDir, '.plans', 'my-plan', 'pre-existing-context.md');
    expect(existsSync(contextPath)).toBe(true);

    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('# Pre-Existing Context');
    expect(content).toContain('Some prior decisions');
  });

  test('gathers brain notes by slug from top-level', async () => {
    const notesDir = join(projectDir, '.brain', 'notes');
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(join(notesDir, 'my-note.md'), '# My Note\n\nContent here');

    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-1',
      brainNotes: 'my-note',
    });

    const result = await seed();

    const contextPath = join(projectDir, '.plans', 'plan-1', 'pre-existing-context.md');
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('Brain Note: my-note');
    expect(content).toContain('Content here');
    expect(result.output).toContain('1 context section(s)');
  });

  test('gathers brain notes from subdirectories by path', async () => {
    const researchDir = join(projectDir, '.brain', 'notes', 'research');
    mkdirSync(researchDir, { recursive: true });
    writeFileSync(join(researchDir, 'competitive-analysis.md'), '# Competitive\n\nFindings');

    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-1b',
      brainNotes: 'research/competitive-analysis',
    });

    await seed();

    const contextPath = join(projectDir, '.plans', 'plan-1b', 'pre-existing-context.md');
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('Brain Note: research/competitive-analysis');
    expect(content).toContain('Findings');
  });

  test('resolves slugs by searching common subdirectories', async () => {
    const researchDir = join(projectDir, '.brain', 'notes', 'research');
    mkdirSync(researchDir, { recursive: true });
    writeFileSync(join(researchDir, 'my-research.md'), 'Found in research/');

    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-1c',
      brainNotes: 'my-research',
    });

    await seed();

    const contextPath = join(projectDir, '.plans', 'plan-1c', 'pre-existing-context.md');
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('Found in research/');
    expect(content).not.toContain('not found');
  });

  test('handles missing brain notes gracefully', async () => {
    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-2',
      brainNotes: 'nonexistent-note',
    });

    const result = await seed();

    const contextPath = join(projectDir, '.plans', 'plan-2', 'pre-existing-context.md');
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('*(not found');
    expect(result.output).toContain('1 context section(s)');
  });

  test('gathers files from comma-separated paths', async () => {
    writeFileSync(join(projectDir, 'readme.md'), '# README');
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const x = 1;');

    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-3',
      files: 'readme.md,src/index.ts',
    });

    const result = await seed();

    const contextPath = join(projectDir, '.plans', 'plan-3', 'pre-existing-context.md');
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('File: readme.md');
    expect(content).toContain('# README');
    expect(content).toContain('File: src/index.ts');
    expect(content).toContain('export const x = 1;');
    expect(result.output).toContain('2 context section(s)');
  });

  test('includes priorContext as a section', async () => {
    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-4',
      priorContext: 'We chose TypeScript over Python.',
    });

    const result = await seed();

    const contextPath = join(projectDir, '.plans', 'plan-4', 'pre-existing-context.md');
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('Prior Context');
    expect(content).toContain('We chose TypeScript over Python.');
    expect(result.data.skipResearch).toBe('false');
  });

  test('includes interviewAnswers in seed data', async () => {
    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-5',
      interviewAnswers: 'Q1: Yes\nQ2: No',
    });

    const result = await seed();

    expect(result.data.interviewAnswers).toBe('Q1: Yes\nQ2: No');
    expect(result.data.hasRequirements).toBe('true');
  });

  test('sets skipResearch=true when coverage is comprehensive', async () => {
    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-6',
      priorContext:
        'Reviewed src/modules/foo.ts and __tests__/foo.test.ts. Reference: https://arxiv.org/abs/1234',
      interviewAnswers:
        'Requirement: must support streaming. Acceptance criteria: events arrive within 1s.',
    });

    const result = await seed();

    expect(result.data.hasCodebaseReview).toBe('true');
    expect(result.data.hasExternalResearch).toBe('true');
    expect(result.data.hasRequirements).toBe('true');
    expect(result.data.skipResearch).toBe('true');
  });

  test('does not skip research when only partial coverage', async () => {
    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-6b',
      priorContext: 'Some general notes about the feature',
    });

    const result = await seed();

    expect(result.data.skipResearch).toBe('false');
  });

  test('multiple brain notes are comma-separated', async () => {
    const notesDir = join(projectDir, '.brain', 'notes');
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(join(notesDir, 'note-a.md'), 'Content A');
    writeFileSync(join(notesDir, 'note-b.md'), 'Content B');

    const seed = buildPlanningSeed({
      projectDir,
      planId: 'plan-7',
      brainNotes: 'note-a, note-b',
    });

    const result = await seed();

    const contextPath = join(projectDir, '.plans', 'plan-7', 'pre-existing-context.md');
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('Content A');
    expect(content).toContain('Content B');
    expect(result.output).toContain('2 context section(s)');
  });
});
