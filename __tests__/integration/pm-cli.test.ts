import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const CLI = `npx tsx ${join(PROJECT_ROOT, 'src', 'cli.ts')}`;

let tmpDir: string;
let notesDir: string;
let fakeHome: string;

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
  // Allow extra time for cold start + embedder init
  tmpDir = mkdtempSync(join(tmpdir(), 'brain-pm-integration-'));
  notesDir = join(tmpDir, 'notes');
  fakeHome = join(tmpDir, 'home');
  mkdirSync(fakeHome, { recursive: true });

  cli(`init --notes-dir "${notesDir}" --embedder local --json`);
}, 90_000);

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('PM CLI integration', { timeout: 60_000 }, () => {
  describe('project lifecycle', () => {
    it('init creates a project', () => {
      const output = pm('init "Test Project" --prefix TST --json');
      const result = JSON.parse(output);

      expect(result.prefix).toBe('TST');
      expect(result.status).toBe('active');
    });

    it('list shows the project', () => {
      const output = pm('list --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const tst = result.find((p: Record<string, unknown>) => p.prefix === 'TST');
      expect(tst).toBeDefined();
    });

    it('status shows task counts', () => {
      const output = pm('status TST --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('prefix');
      expect(result).toHaveProperty('taskCounts');
      expect(result.taskCounts).toHaveProperty('total');
      expect(result.taskCounts).toHaveProperty('pending');
      expect(result.taskCounts).toHaveProperty('done');
    });

    it('use sets active project', () => {
      const output = pm('use TST');
      expect(output).toContain('TST');
    });

    it('list marks active project', () => {
      const output = pm('list');
      expect(output).toContain('TST');
    });
  });

  describe('workstream CRUD', () => {
    it('add creates workstream', () => {
      const output = pm('workstream add "Testing" --project TST --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('display_id');
      expect(result.display_id).toMatch(/^TST-\d+$/);
      expect(result.status).toBe('active');
    });

    it('list shows workstreams', () => {
      const output = pm('workstream list --project TST --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('show displays detail', () => {
      const output = pm('workstream show TST-01 --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('display_id');
      expect(result.display_id).toBe('TST-01');
    });
  });

  describe('task CRUD and filters', () => {
    it('add creates task', () => {
      const output = pm(
        'task add "First task" --workstream 1 --priority high --category implementation --description "First implementation task." --json'
      );
      const result = JSON.parse(output);

      expect(result).toHaveProperty('display_id');
      expect(result.display_id).toMatch(/^TST-01\.\d+$/);
      expect(result.priority).toBe('high');
      expect(result.status).toBe('pending');
    });

    it('add creates second task with dependency', () => {
      const output = pm(
        'task add "Second task" --workstream 1 --priority medium --category implementation --description "Second task depending on first." --depends-on TST-01.01 --json'
      );
      const result = JSON.parse(output);

      expect(result).toHaveProperty('display_id');
      expect(result.depends_on).toContain('TST-01.01');
    });

    it('list returns all tasks', () => {
      const output = pm('task list --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('list --status filters', () => {
      const output = pm('task list --status pending --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      for (const task of result) {
        expect(task.status).toBe('pending');
      }
    });

    it('list --priority filters', () => {
      const output = pm('task list --priority high --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].priority).toBe('high');
    });

    it('list --sort --limit works', () => {
      const output = pm('task list --sort priority --limit 1 --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].priority).toBe('high');
    });
  });

  describe('plural aliases', () => {
    it('tasks alias returns same as task list', () => {
      const output = pm('tasks --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('tasks alias passes --priority filter', () => {
      const output = pm('tasks --priority high --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].priority).toBe('high');
    });

    it('workstreams alias returns same as workstream list', () => {
      const output = pm('workstreams --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('orchestration commands', () => {
    it('next shows eligible tasks', () => {
      const output = pm('next --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      // TST-01.01 should be eligible (no deps), TST-01.02 should not (depends on TST-01.01)
      const ids = result.map((t: Record<string, unknown>) => t.display_id);
      expect(ids).toContain('TST-01.01');
      expect(ids).not.toContain('TST-01.02');
    });

    it('next --workstream filters', () => {
      const output = pm('next --workstream 1 --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      for (const task of result) {
        expect(task.workstream).toBe(1);
      }
    });

    it('waves shows grouping', () => {
      const output = pm('waves --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);

      const firstWave = result[0];
      expect(firstWave).toHaveProperty('wave');
      expect(firstWave).toHaveProperty('tasks');
      expect(Array.isArray(firstWave.tasks)).toBe(true);

      // Task with dependency should be in a later wave
      if (result.length >= 2) {
        const allWave1Ids = result[0].tasks.map((t: Record<string, unknown>) => t.display_id);
        const allWave2Ids = result[1].tasks.map((t: Record<string, unknown>) => t.display_id);
        expect(allWave1Ids).toContain('TST-01.01');
        expect(allWave2Ids).toContain('TST-01.02');
      }
    });

    it('dispatch returns enriched context', () => {
      const output = pm('dispatch TST-01.01 --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('task');
      expect(result.task.display_id).toBe('TST-01.01');
      expect(result).toHaveProperty('relatedNotes');
      expect(result).toHaveProperty('dependencies');
    });

    it('briefing returns project overview', () => {
      const output = pm('briefing --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('project');
      expect(result).toHaveProperty('tasks');
      expect(result.tasks).toHaveProperty('total');
      expect(result.tasks.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('task lifecycle', () => {
    let claimToken: string;

    it('claim returns token', () => {
      const output = pm('task claim TST-01.01 --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('token');
      expect(result.status).toBe('claimed');
      claimToken = result.token;
    });

    it('start transitions to in-progress', () => {
      const output = pm(`task start TST-01.01 --token ${claimToken} --json`);
      const result = JSON.parse(output);

      expect(result.status).toBe('in-progress');
    });

    it('complete marks task done', () => {
      const output = pm('complete TST-01.01 --summary "Done" --json');
      const result = JSON.parse(output);

      expect(result.status).toBe('done');
      expect(result).toHaveProperty('newlyEligible');
      // TST-01.02 should now be eligible since its dependency is done
      expect(result.newlyEligible).toContain('TST-01.02');
    });
  });

  describe('decisions and check', () => {
    it('decision add creates', () => {
      const output = pm(
        'decision add "Use REST" --project TST --source-task TST-01.01 --json'
      );
      const result = JSON.parse(output);

      expect(result).toHaveProperty('display_id');
      expect(result.status).toBe('accepted');
    });

    it('decision list returns decisions', () => {
      const output = pm('decision list --project TST --json');
      const result = JSON.parse(output);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('check returns report', () => {
      const output = pm('check --project TST --json');
      const result = JSON.parse(output);

      expect(result).toHaveProperty('project');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalTasks');
    });
  });
});
