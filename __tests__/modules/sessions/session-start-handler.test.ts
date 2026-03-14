import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HookInput } from '../../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';

vi.mock('../../../src/services/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/services/brain-db.js', () => ({
  BrainDB: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/engine/session-briefing.js', () => ({
  generateSessionBriefing: vi.fn(),
  renderBriefingXml: vi.fn(),
}));

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getActiveProject: vi.fn(),
}));

import { loadConfig } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import {
  generateSessionBriefing,
  renderBriefingXml,
} from '../../../src/modules/sessions/engine/session-briefing.js';
import { getActiveProject } from '../../../src/modules/pm/data/queries.js';
import {
  sessionStartHandler,
  resetSessionStartHandler,
} from '../../../src/modules/sessions/hooks/session-start-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockGenerateBriefing = generateSessionBriefing as ReturnType<typeof vi.fn>;
const mockRenderXml = renderBriefingXml as ReturnType<typeof vi.fn>;
const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;

function makeInput(cwd = '/proj'): HookInput {
  return { event: 'session-start', raw: '', parsed: {}, cwd };
}

describe('sessions:start handler', () => {
  let savedSession: string | undefined;
  let savedProject: string | undefined;
  let savedEnvFile: string | undefined;

  beforeEach(() => {
    savedSession = process.env.BRAIN_PM_SESSION;
    savedProject = process.env.BRAIN_PM_PROJECT;
    savedEnvFile = process.env.CLAUDE_ENV_FILE;
    delete process.env.BRAIN_PM_SESSION;
    delete process.env.BRAIN_PM_PROJECT;
    delete process.env.CLAUDE_ENV_FILE;

    resetSessionStartHandler();
    vi.clearAllMocks();

    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockLoadConfig.mockReturnValue({
      notesDir: '/tmp',
      dbPath: '/tmp/db',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    });
    mockGetActiveProject.mockReturnValue(null);
  });

  afterEach(() => {
    if (savedSession === undefined) delete process.env.BRAIN_PM_SESSION;
    else process.env.BRAIN_PM_SESSION = savedSession;

    if (savedProject === undefined) delete process.env.BRAIN_PM_PROJECT;
    else process.env.BRAIN_PM_PROJECT = savedProject;

    if (savedEnvFile === undefined) delete process.env.CLAUDE_ENV_FILE;
    else process.env.CLAUDE_ENV_FILE = savedEnvFile;
  });

  it('has correct metadata', () => {
    expect(sessionStartHandler.name).toBe('sessions:start');
    expect(sessionStartHandler.event).toBe('session-start');
    expect(sessionStartHandler.priority).toBe(10);
  });

  it('is always enabled on first run', () => {
    expect(sessionStartHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('only fires once (one-shot guard)', () => {
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(sessionStartHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('resets with resetSessionStartHandler', () => {
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(sessionStartHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);

    resetSessionStartHandler();
    expect(sessionStartHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('generates a session ID and sets BRAIN_PM_SESSION', () => {
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

    expect(process.env.BRAIN_PM_SESSION).toBeDefined();
    expect(process.env.BRAIN_PM_SESSION!.length).toBeGreaterThan(0);
  });

  it('reuses existing BRAIN_PM_SESSION if already set', () => {
    process.env.BRAIN_PM_SESSION = 'existing-session-id';
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

    expect(process.env.BRAIN_PM_SESSION).toBe('existing-session-id');
  });

  it('sets BRAIN_PM_PROJECT when project is detected', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockGenerateBriefing.mockReturnValue({
      project: 'VNM',
      sections: [{ heading: 'Progress', items: ['5/10'] }],
      suggestedFocus: [],
    });
    mockRenderXml.mockReturnValue('<session-briefing>test</session-briefing>');

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

    expect(process.env.BRAIN_PM_PROJECT).toBe('VNM');
  });

  it('does not set BRAIN_PM_PROJECT when no project exists', () => {
    mockGetActiveProject.mockReturnValue(null);
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

    expect(process.env.BRAIN_PM_PROJECT).toBeUndefined();
  });

  it('returns briefing context when project exists', () => {
    mockGetActiveProject.mockReturnValue('VNM');
    mockGenerateBriefing.mockReturnValue({
      project: 'VNM',
      sections: [{ heading: 'Progress', items: ['5/10 done'] }],
      suggestedFocus: ['Continue VNM-01.01'],
    });
    mockRenderXml.mockReturnValue('<session-briefing>test</session-briefing>');

    const result = sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { additionalContext: string };
    expect(parsed.additionalContext).toContain('session-start');
    expect(parsed.additionalContext).toContain('session-briefing');
  });

  it('returns minimal context when no project and no sections', () => {
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    const result = sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { additionalContext: string };
    expect(parsed.additionalContext).toContain('session-start');
    expect(parsed.additionalContext).toContain('session_id=');
  });

  it('writes env vars to CLAUDE_ENV_FILE when available', () => {
    const envFile = join(tmpdir(), `brain-test-env-${Date.now()}`);
    writeFileSync(envFile, '');
    process.env.CLAUDE_ENV_FILE = envFile;

    mockGetActiveProject.mockReturnValue('VNM');
    mockGenerateBriefing.mockReturnValue({
      project: 'VNM',
      sections: [{ heading: 'Progress', items: ['5/10'] }],
      suggestedFocus: [],
    });
    mockRenderXml.mockReturnValue('<session-briefing>test</session-briefing>');

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

    const content = readFileSync(envFile, 'utf-8');
    expect(content).toContain('BRAIN_PM_SESSION=');
    expect(content).toContain('BRAIN_PM_PROJECT=VNM');

    try {
      unlinkSync(envFile);
    } catch {
      /* cleanup */
    }
  });

  it('does not write BRAIN_PM_PROJECT to env file when no project', () => {
    const envFile = join(tmpdir(), `brain-test-env-${Date.now()}`);
    writeFileSync(envFile, '');
    process.env.CLAUDE_ENV_FILE = envFile;

    mockGetActiveProject.mockReturnValue(null);
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

    const content = readFileSync(envFile, 'utf-8');
    expect(content).toContain('BRAIN_PM_SESSION=');
    expect(content).not.toContain('BRAIN_PM_PROJECT');

    try {
      unlinkSync(envFile);
    } catch {
      /* cleanup */
    }
  });

  it('returns allow on error', () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error('no config');
    });

    const result = sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('closes DB even on error', () => {
    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockGetActiveProject.mockImplementation(() => {
      throw new Error('fail');
    });

    sessionStartHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(fakeDb.close).toHaveBeenCalled();
  });
});
