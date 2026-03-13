import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HookInput, HookConfig } from '../../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';

// Mock session-restore before importing the handler
vi.mock('../../../src/modules/sessions/engine/session-restore.js', () => ({
  detectResumableSession: vi.fn(),
}));

import { detectResumableSession } from '../../../src/modules/sessions/engine/session-restore.js';
import {
  sessionRestoreHandler,
  resetSessionRestoreHandler,
} from '../../../src/modules/sessions/hooks/session-restore-handler.js';

const mockDetect = detectResumableSession as ReturnType<typeof vi.fn>;

function makeInput(cwd: string): HookInput {
  return { event: 'prompt-submit', raw: '', parsed: {}, cwd };
}

describe('sessions:restore handler', () => {
  let tmpDir: string;

  beforeEach(() => {
    resetSessionRestoreHandler();
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `restore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns allow when no resumable session exists', () => {
    mockDetect.mockReturnValue(null);
    const result = sessionRestoreHandler.run(makeInput('/tmp'), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('returns context when a snapshot exists', () => {
    const snapshotPath = join(tmpDir, 'snap.json');
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        session_id: 'sess-123',
        project_dir: '/proj',
        git_branch: 'main',
        snapshot_at: '2026-03-13T10:00:00Z',
        open_items: ['Fix bug'],
        active_files: ['src/foo.ts'],
        message_count: 10,
      })
    );

    mockDetect.mockReturnValue({ sessionId: 'sess-123', snapshotPath });

    const result = sessionRestoreHandler.run(makeInput('/proj'), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { additionalContext: string };
    expect(parsed.additionalContext).toContain('session-restore');
    expect(parsed.additionalContext).toContain('sess-123');
    expect(parsed.additionalContext).toContain('Fix bug');
    expect(parsed.additionalContext).toContain('src/foo.ts');
  });

  it('only fires once (one-shot guard)', () => {
    mockDetect.mockReturnValue(null);

    sessionRestoreHandler.run(makeInput('/tmp'), DEFAULT_HOOK_CONFIG);
    expect(sessionRestoreHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('resetSessionRestoreHandler re-enables the handler', () => {
    mockDetect.mockReturnValue(null);
    sessionRestoreHandler.run(makeInput('/tmp'), DEFAULT_HOOK_CONFIG);
    expect(sessionRestoreHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);

    resetSessionRestoreHandler();
    expect(sessionRestoreHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('returns allow when snapshot file cannot be read', () => {
    mockDetect.mockReturnValue({
      sessionId: 'sess-bad',
      snapshotPath: join(tmpDir, 'nonexistent.json'),
    });

    const result = sessionRestoreHandler.run(makeInput('/tmp'), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('handles snapshot with no open items or active files', () => {
    const snapshotPath = join(tmpDir, 'minimal.json');
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        session_id: 'sess-min',
        project_dir: '/proj',
        git_branch: null,
        snapshot_at: '2026-03-13T10:00:00Z',
        open_items: [],
        active_files: [],
        message_count: 1,
      })
    );

    mockDetect.mockReturnValue({ sessionId: 'sess-min', snapshotPath });

    const result = sessionRestoreHandler.run(makeInput('/proj'), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { additionalContext: string };
    expect(parsed.additionalContext).toContain('sess-min');
    expect(parsed.additionalContext).not.toContain('open_items');
    expect(parsed.additionalContext).not.toContain('active_files');
  });

  it('has correct metadata', () => {
    expect(sessionRestoreHandler.name).toBe('sessions:restore');
    expect(sessionRestoreHandler.event).toBe('prompt-submit');
    expect(sessionRestoreHandler.priority).toBe(50);
  });
});
