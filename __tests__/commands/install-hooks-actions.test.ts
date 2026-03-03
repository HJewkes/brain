import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateLaunchdPlist,
  generateSystemdService,
  generateSystemdTimer,
  installHooksCommand,
} from '../../src/commands/install-hooks.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

vi.mock('../../src/services/config.js', () => ({
  loadConfig: vi.fn(() => ({
    notesDir: '/tmp/test-hooks',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  })),
}));

beforeEach(() => {
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('install-hooks generators', () => {
  it('plist contains all required keys', () => {
    const plist = generateLaunchdPlist('/usr/bin/brain', 120, '/notes');
    expect(plist).toContain('Label');
    expect(plist).toContain('ProgramArguments');
    expect(plist).toContain('StartInterval');
    expect(plist).toContain('<integer>7200</integer>');
  });

  it('systemd service has correct ExecStart', () => {
    const svc = generateSystemdService('/usr/bin/brain');
    expect(svc).toContain('ExecStart=/usr/bin/brain index --inbox --extract --quiet');
  });

  it('systemd timer uses correct interval', () => {
    const timer = generateSystemdTimer(30);
    expect(timer).toContain('OnUnitActiveSec=30min');
  });
});

describe('install-hooks --status', () => {
  it('--status shows current status as text', async () => {
    await installHooksCommand.parseAsync(['node', 'install-hooks', '--status'], { from: 'node' });

    const err = stderr();
    expect(err).toContain('Scheduled processing:');
    expect(err).toContain('Platform:');
  });

  it('--json outputs status as JSON', async () => {
    await installHooksCommand.parseAsync(['node', 'install-hooks', '--json'], { from: 'node' });

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('installed');
    expect(parsed).toHaveProperty('platform');
  });
});

describe('install-hooks --interval validation', () => {
  it('rejects non-numeric interval', async () => {
    await installHooksCommand.parseAsync(['node', 'install-hooks', '--interval', 'abc'], {
      from: 'node',
    });

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('interval must be a positive number');
  });

  it('rejects zero interval', async () => {
    await installHooksCommand.parseAsync(['node', 'install-hooks', '--interval', '0'], {
      from: 'node',
    });

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('interval must be a positive number');
  });
});
