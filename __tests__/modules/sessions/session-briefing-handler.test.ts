import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HookInput } from '../../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';

// Mock the DB and config
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

import { loadConfig } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import {
  generateSessionBriefing,
  renderBriefingXml,
} from '../../../src/modules/sessions/engine/session-briefing.js';
import {
  sessionBriefingHandler,
  resetSessionBriefingHandler,
} from '../../../src/modules/sessions/hooks/session-briefing-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockGenerateBriefing = generateSessionBriefing as ReturnType<typeof vi.fn>;
const mockRenderXml = renderBriefingXml as ReturnType<typeof vi.fn>;

function makeInput(cwd = '/proj'): HookInput {
  return { event: 'prompt-submit', raw: '', parsed: {}, cwd };
}

describe('sessions:briefing handler', () => {
  beforeEach(() => {
    resetSessionBriefingHandler();
    vi.clearAllMocks();

    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockLoadConfig.mockReturnValue({
      notesDir: '/tmp',
      dbPath: '/tmp/db',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    });
  });

  it('returns briefing context when project exists', () => {
    mockGenerateBriefing.mockReturnValue({
      project: 'VNM',
      sections: [{ heading: 'Progress', items: ['5/10 done'] }],
      suggestedFocus: ['Continue VNM-01.01'],
    });
    mockRenderXml.mockReturnValue('<session-briefing>test</session-briefing>');

    const result = sessionBriefingHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as { additionalContext: string };
    expect(parsed.additionalContext).toContain('session-briefing');
  });

  it('returns allow when no project and no sections', () => {
    mockGenerateBriefing.mockReturnValue({
      project: null,
      sections: [],
      suggestedFocus: [],
    });

    const result = sessionBriefingHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('only fires once (one-shot guard)', () => {
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionBriefingHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(sessionBriefingHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('resets with resetSessionBriefingHandler', () => {
    mockGenerateBriefing.mockReturnValue({ project: null, sections: [], suggestedFocus: [] });

    sessionBriefingHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(sessionBriefingHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);

    resetSessionBriefingHandler();
    expect(sessionBriefingHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('returns allow on error', () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error('no config');
    });

    const result = sessionBriefingHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('closes DB even on error', () => {
    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockGenerateBriefing.mockImplementation(() => {
      throw new Error('fail');
    });

    sessionBriefingHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(fakeDb.close).toHaveBeenCalled();
  });

  it('has correct metadata', () => {
    expect(sessionBriefingHandler.name).toBe('sessions:briefing');
    expect(sessionBriefingHandler.event).toBe('prompt-submit');
    expect(sessionBriefingHandler.priority).toBe(51);
  });
});
