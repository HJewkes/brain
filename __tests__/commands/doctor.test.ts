import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, makeInboxItem } from '../helpers.js';
import type { BrainConfig, HealthReport } from '../../src/types.js';

let db: BrainDB;
let config: BrainConfig;

vi.mock('../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn) => fn({ db, config, close: () => {} })),
}));

const mockReport: HealthReport = {
  checks: [
    { name: 'Database', status: 'ok', message: 'connected' },
    { name: 'Embedder', status: 'ok', message: 'local' },
  ],
  summary: { ok: 2, warnings: 0, errors: 0 },
};

vi.mock('../../src/services/health.js', () => ({
  runAllChecks: vi.fn(async () => mockReport),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { doctorCommand } from '../../src/commands/doctor.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await doctorCommand.parseAsync(['node', 'doctor', ...args], { from: 'node' });
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('doctor-cmd'));
  config = {
    notesDir: '/tmp/test-doctor',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;

  // Reset report to healthy default
  mockReport.checks = [
    { name: 'Database', status: 'ok', message: 'connected' },
    { name: 'Embedder', status: 'ok', message: 'local' },
  ];
  mockReport.summary = { ok: 2, warnings: 0, errors: 0 };
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('doctor command', () => {
  it('prints health report to stderr', async () => {
    await run();
    const out = stderr();
    expect(out).toContain('brain doctor');
    expect(out).toContain('Database');
    expect(out).toContain('ok');
    expect(out).toContain('All checks passed');
  });

  it('--json outputs report as JSON', async () => {
    await run('--json');
    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('checks');
    expect(parsed).toHaveProperty('summary');
    expect(parsed.summary.ok).toBe(2);
  });

  it('suggests --fix when there are warnings', async () => {
    mockReport.checks.push({ name: 'LLM', status: 'warning', message: 'model not found' });
    mockReport.summary = { ok: 2, warnings: 1, errors: 0 };

    await run();
    expect(stderr()).toContain('brain doctor --fix');
  });

  it('--fix resets failed inbox items to pending', async () => {
    db.addInboxItem(makeInboxItem({ id: 'fail-1', status: 'failed' }));
    db.addInboxItem(makeInboxItem({ id: 'fail-2', status: 'failed' }));

    await run('--fix');
    expect(stderr()).toContain('Reset 2 failed inbox item(s) to pending');

    const item1 = db.getInboxItem('fail-1');
    const item2 = db.getInboxItem('fail-2');
    expect(item1?.status).toBe('pending');
    expect(item2?.status).toBe('pending');
  });

  it('--fix attempts to pull model when LLM check warns about missing model', async () => {
    const { execFileSync } = await import('node:child_process');
    mockReport.checks.push({ name: 'LLM', status: 'warning', message: 'model not found' });
    mockReport.summary = { ok: 2, warnings: 1, errors: 0 };

    await run('--fix');
    expect(execFileSync).toHaveBeenCalledWith(
      'ollama',
      ['pull', expect.any(String)],
      expect.any(Object)
    );
  });
});
