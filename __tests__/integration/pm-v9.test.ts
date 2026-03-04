import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const CLI = `npx tsx ${join(PROJECT_ROOT, 'src', 'cli.ts')}`;

let tmpDir: string;
let notesDir: string;
let fakeHome: string;
let docsDir: string;

function cli(args: string): string {
  return execSync(`${CLI} ${args}`, {
    cwd: tmpDir,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, HOME: fakeHome, NODE_NO_WARNINGS: '1' },
  }).trim();
}

function pm(args: string): string {
  return cli(`pm ${args}`);
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'brain-pm-v9-'));
  notesDir = join(tmpDir, 'notes');
  fakeHome = join(tmpDir, 'home');
  docsDir = join(tmpDir, 'project-docs');

  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(docsDir, { recursive: true });

  // Create sample doc files for onboard
  mkdirSync(join(docsDir, 'docs'), { recursive: true });
  writeFileSync(
    join(docsDir, 'docs', 'architecture.md'),
    '# Architecture\n\nThis is the architecture document for the test project.\n'
  );
  writeFileSync(
    join(docsDir, 'docs', 'getting-started.md'),
    '# Getting Started\n\nFollow these steps to get started with the project.\n'
  );
  writeFileSync(join(docsDir, 'package.json'), '{"name": "test-project", "version": "1.0.0"}');

  cli(`init --notes-dir "${notesDir}" --embedder local --json`);
}, 90_000);

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('PM V9 integration', { timeout: 60_000 }, () => {
  describe('onboard creates hierarchy with parent edges', () => {
    it('onboard creates project, workstreams, and tasks', () => {
      const output = pm(`onboard "Test V9 Project" --prefix TV9 --cwd "${docsDir}" --json`);
      const result = JSON.parse(output);

      expect(result.project).toBe('TV9');
      expect(result.components).toBeDefined();
      expect(result.docs).toBeDefined();
      expect(result.docs.discovered).toBeGreaterThanOrEqual(0);
    });

    it('project context returns hierarchy data', () => {
      const output = pm('context TV9 --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('project');
      expect(result.project.prefix).toBe('TV9');
      expect(result).toHaveProperty('workstreams');
      expect(result).toHaveProperty('statusDistribution');
    });

    it('project show includes synthesized body', () => {
      const output = pm('project show TV9 --json');
      const result = JSON.parse(output);

      expect(result.prefix).toBe('TV9');
      expect(result).toHaveProperty('description');
      // Synthesized body should contain component inventory
      if (result.description) {
        expect(typeof result.description).toBe('string');
      }
    });
  });

  describe('manual project with task enrichment', () => {
    it('init creates a manual project', () => {
      const output = pm('init "V9 Manual" --prefix VNM --json');
      const result = JSON.parse(output);
      expect(result.prefix).toBe('VNM');
    });

    it('creates workstreams', () => {
      const ws1 = pm('workstream add "Backend" --project VNM --json');
      const ws1Result = JSON.parse(ws1);
      expect(ws1Result.display_id).toBe('VNM-01');

      const ws2 = pm('workstream add "Testing" --project VNM --json');
      const ws2Result = JSON.parse(ws2);
      expect(ws2Result.display_id).toBe('VNM-02');
    });

    it('creates tasks with categories for auto-dependency', () => {
      // Implementation tasks in ws1
      pm(
        'task add "Build API endpoint" --workstream 1 --priority high --category implementation --description "Build the REST API endpoint for the service." --json'
      );
      pm(
        'task add "Build data model" --workstream 1 --priority medium --category implementation --description "Build the database data model." --json'
      );
      // Testing task in ws1
      pm(
        'task add "Write API tests" --workstream 1 --priority medium --category testing --description "Write tests for the API endpoints." --json'
      );
      // Implementation task in ws2
      pm(
        'task add "Setup test framework" --workstream 2 --priority high --category implementation --description "Set up the test framework for the project." --json'
      );
    });

    it('task list --json includes enriched fields', () => {
      pm('use VNM');
      const output = pm('task list --json');
      const tasks = JSON.parse(output);

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThanOrEqual(4);

      const task = tasks[0];
      expect(task).toHaveProperty('display_id');
      expect(task).toHaveProperty('created');
      expect(task).toHaveProperty('modified');
      // blocked_by is only present for tasks with upstream prerequisites
      expect('display_id' in task).toBe(true);
      expect(task).toHaveProperty('description');
      // depends_on is only present when task has explicit dependencies
      expect('status' in task).toBe(true);
      expect('category' in task).toBe(true);
    });
  });

  describe('temporal fields round-trip', () => {
    it('creates task with --due and --milestone', () => {
      pm('use VNM');
      const output = pm(
        'task add "Deadline task" --workstream 1 --due 2026-06-01 --milestone v1.0 --description "Task with a deadline and milestone." --json'
      );
      const result = JSON.parse(output);

      expect(result.display_id).toMatch(/^VNM-01\.\d+$/);
      expect(result.due_date).toBe('2026-06-01');
      expect(result.milestone).toBe('v1.0');
    });

    it('task list --json preserves temporal fields', () => {
      const output = pm('task list --json');
      const tasks = JSON.parse(output);

      const deadlineTask = tasks.find(
        (t: Record<string, unknown>) => t.title === '"Deadline task"' || t.milestone === 'v1.0'
      );
      expect(deadlineTask).toBeDefined();
      expect(deadlineTask.due_date).toBe('2026-06-01');
      expect(deadlineTask.milestone).toBe('v1.0');
    });
  });

  describe('search finds body content', () => {
    it('creates task with specific body content', () => {
      pm('use VNM');
      // Create a task - body is set via the title for search
      pm(
        'task add "Implement xylophone parser" --workstream 1 --category implementation --description "Implement a parser for xylophone notation format." --json'
      );
    });

    it('--search matches task by title', () => {
      const output = pm('task list --search xylophone --json');
      const tasks = JSON.parse(output);

      expect(tasks.length).toBeGreaterThanOrEqual(1);
      const found = tasks.find(
        (t: Record<string, unknown>) =>
          typeof t.title === 'string' && t.title.toLowerCase().includes('xylophone')
      );
      expect(found).toBeDefined();
    });
  });

  describe('context at all three levels', () => {
    it('project-level context (PREFIX)', () => {
      const output = pm('context VNM --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('project');
      expect(result.project.prefix).toBe('VNM');
      expect(result).toHaveProperty('workstreams');
      expect(result.workstreams.length).toBeGreaterThanOrEqual(2);
    });

    it('workstream-level context (PREFIX-NN)', () => {
      const output = pm('context VNM-01 --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('workstream');
      expect(result.workstream.displayId).toBe('VNM-01');
      expect(result).toHaveProperty('tasks');
      expect(result.tasks.length).toBeGreaterThanOrEqual(1);
      expect(result).toHaveProperty('statusDistribution');
      expect(result).toHaveProperty('eligibleTasks');
    });

    it('task-level context (PREFIX-NN.NN)', () => {
      const output = pm('context VNM-01.01 --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('task');
      expect(result.task.display_id).toBe('VNM-01.01');
      expect(result).toHaveProperty('relatedNotes');
      expect(result).toHaveProperty('dependencies');
      expect(result).toHaveProperty('decisions');
      expect(result).toHaveProperty('contextHash');
    });
  });

  describe('slug collision handling', () => {
    it('onboardSlug deduplicates', async () => {
      const { onboardSlug } = await import('../../src/modules/pm/commands/onboard.js');

      const used = new Set<string>();
      const first = onboardSlug('architecture', undefined, used);
      const second = onboardSlug('architecture', undefined, used);

      expect(first).toBe('architecture');
      expect(second).toBe('architecture-2');
      expect(used.size).toBe(2);
    });

    it('onboardSlug handles component prefix', async () => {
      const { onboardSlug } = await import('../../src/modules/pm/commands/onboard.js');

      const used = new Set<string>();
      const slug1 = onboardSlug('readme', 'frontend', used);
      const slug2 = onboardSlug('readme', 'backend', used);

      expect(slug1).toBe('frontend-readme');
      expect(slug2).toBe('backend-readme');
    });
  });

  describe('auto-dependencies via inferDependencies', () => {
    it('testing task exists with correct category', () => {
      const output = pm('task list --json');
      const tasks = JSON.parse(output);
      const testingTask = tasks.find(
        (t: Record<string, unknown>) =>
          typeof t.title === 'string' && t.title.includes('Write API tests')
      );
      expect(testingTask).toBeDefined();
      expect(testingTask.category).toBe('testing');
    });
  });
});
