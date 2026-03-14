import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';

const FAKE_HOME = join(tmpdir(), `brain-restore-test-${process.pid}`);
const SNAPSHOT_DIR = join(FAKE_HOME, '.claude', 'session-snapshots');

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: () => FAKE_HOME,
  };
});

// Import after mock is set up
import { detectResumableSession } from '../../../src/modules/sessions/engine/session-restore.js';

function writeSnapshot(sessionId: string, projectDir: string, snapshotAt: string): void {
  writeFileSync(
    join(SNAPSHOT_DIR, `${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      project_dir: projectDir,
      git_branch: null,
      snapshot_at: snapshotAt,
      message_count: 0,
      open_items: [],
      active_files: [],
    }),
    'utf-8'
  );
}

describe('detectResumableSession', () => {
  beforeEach(() => {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  it('returns null when snapshot directory does not exist', () => {
    rmSync(FAKE_HOME, { recursive: true, force: true });

    const result = detectResumableSession('/some/project');

    expect(result).toBeNull();
  });

  it('returns null when no snapshots match project dir', () => {
    writeSnapshot('abc-123', '/other/project', new Date().toISOString());

    const result = detectResumableSession('/my/project');

    expect(result).toBeNull();
  });

  it('returns null when all matching snapshots are older than 7 days', () => {
    const old = new Date();
    old.setDate(old.getDate() - 8);
    writeSnapshot('old-session', '/my/project', old.toISOString());

    const result = detectResumableSession('/my/project');

    expect(result).toBeNull();
  });

  it('returns the most recent matching snapshot', () => {
    const now = new Date();
    const older = new Date(now.getTime() - 3600_000);

    writeSnapshot('session-older', '/my/project', older.toISOString());
    writeSnapshot('session-newer', '/my/project', now.toISOString());

    const result = detectResumableSession('/my/project');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('session-newer');
    expect(result!.snapshotPath).toBe(join(SNAPSHOT_DIR, 'session-newer.json'));
  });

  it('ignores malformed JSON files', () => {
    writeFileSync(join(SNAPSHOT_DIR, 'bad.json'), 'not valid json', 'utf-8');
    writeSnapshot('good-session', '/my/project', new Date().toISOString());

    const result = detectResumableSession('/my/project');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('good-session');
  });

  it('ignores non-JSON files', () => {
    writeFileSync(join(SNAPSHOT_DIR, 'readme.txt'), 'not a snapshot', 'utf-8');

    const result = detectResumableSession('/my/project');

    expect(result).toBeNull();
  });

  it('filters by exact project dir match', () => {
    writeSnapshot('session-1', '/my/project', new Date().toISOString());
    writeSnapshot('session-2', '/my/project/sub', new Date().toISOString());

    const result = detectResumableSession('/my/project');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('session-1');
  });
});
