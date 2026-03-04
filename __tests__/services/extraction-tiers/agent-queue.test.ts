import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeQueueFile, type QueueContext } from '../../../src/services/extraction-tiers/agent-queue.js';
import type { ModuleRegistry } from '../../../src/modules/registry.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

function makeRegistry(importable: Array<{ module: string; noteType: { name: string; description: string; schema?: { properties: Record<string, { type: string; description?: string }> } } }> = []): ModuleRegistry {
  return {
    getImportableNoteTypes: vi.fn().mockReturnValue(importable),
  } as unknown as ModuleRegistry;
}

function makeContext(overrides: Partial<QueueContext> = {}): QueueContext {
  return {
    sourcePath: '/home/user/docs/meeting-notes.md',
    format: 'markdown',
    lineCount: 42,
    tier1Items: [],
    tier2Items: [],
    lowConfidenceRegions: [],
    remainderContent: '',
    ...overrides,
  };
}

describe('writeQueueFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates queue directory recursively', () => {
    const registry = makeRegistry();
    writeQueueFile('/brain', makeContext(), registry);

    expect(mkdirSync).toHaveBeenCalledWith(join('/brain', 'import-queue'), { recursive: true });
  });

  it('writes file with correct frontmatter', () => {
    const registry = makeRegistry();
    const result = writeQueueFile('/brain', makeContext(), registry);

    expect(result.queuePath).toBe(join('/brain', 'import-queue', 'meeting-notes.md'));
    expect(writeFileSync).toHaveBeenCalledOnce();

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('---');
    expect(content).toContain('source: /home/user/docs/meeting-notes.md');
    expect(content).toContain('status: pending');
    expect(content).toContain('format: markdown');
    expect(content).toContain('lines: 42');
  });

  it('includes header with filename', () => {
    const registry = makeRegistry();
    writeQueueFile('/brain', makeContext(), registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('# Import Review: meeting-notes.md');
  });

  it('lists Tier 1 extracted items in What We Know', () => {
    const registry = makeRegistry();
    const ctx = makeContext({
      tier1Items: [
        { noteType: 'task', title: 'Fix bug', content: '', fields: {} },
        { noteType: 'task', title: 'Add tests', content: '', fields: {} },
      ],
    });
    writeQueueFile('/brain', ctx, registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('Tier 1 extracted: 2 items (task)');
  });

  it('lists Tier 2 extracted items in What We Know', () => {
    const registry = makeRegistry();
    const ctx = makeContext({
      tier2Items: [
        { noteType: 'note', title: 'Meeting', content: '', fields: {} },
        { noteType: 'decision', title: 'Use React', content: '', fields: {} },
      ],
    });
    writeQueueFile('/brain', ctx, registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('Tier 2 extracted: 2 items (note, decision)');
  });

  it('lists low confidence regions in What We Know', () => {
    const registry = makeRegistry();
    const ctx = makeContext({
      lowConfidenceRegions: [
        { startLine: 10, endLine: 25, suggestedType: 'task', confidence: 0.45 },
      ],
    });
    writeQueueFile('/brain', ctx, registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('Low confidence: lines 10-25 (task, confidence: 0.45)');
  });

  it('includes available note types from registry', () => {
    const registry = makeRegistry([
      {
        module: 'pm',
        noteType: {
          name: 'task',
          description: 'A project task',
          schema: {
            properties: {
              status: { type: 'string', description: 'Task status' },
              priority: { type: 'string', description: 'Priority level' },
            },
          },
        },
      },
    ]);
    writeQueueFile('/brain', makeContext(), registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('## Available Note Types');
    expect(content).toContain('**task**: A project task');
    expect(content).toContain('Fields: status (Task status), priority (Priority level)');
  });

  it('generates questions for low confidence regions', () => {
    const registry = makeRegistry();
    const ctx = makeContext({
      lowConfidenceRegions: [
        { startLine: 5, endLine: 15, suggestedType: 'decision', confidence: 0.30 },
      ],
    });
    writeQueueFile('/brain', ctx, registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('## Questions');
    expect(content).toContain('suggested "decision" but confidence is 0.30. Is this correct?');
  });

  it('generates question for unclassified remainder content', () => {
    const registry = makeRegistry();
    const ctx = makeContext({
      remainderContent: 'line1\nline2\nline3',
    });
    writeQueueFile('/brain', ctx, registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('3 lines of unclassified content');
  });

  it('includes source file path', () => {
    const registry = makeRegistry();
    writeQueueFile('/brain', makeContext(), registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('## Source File');
    expect(content).toContain('Path: `/home/user/docs/meeting-notes.md`');
  });

  it('includes instructions section', () => {
    const registry = makeRegistry();
    writeQueueFile('/brain', makeContext(), registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('## Instructions');
    expect(content).toContain('brain pm task add');
    expect(content).toContain('brain add --type');
  });

  it('slugifies filename correctly for queue path', () => {
    const registry = makeRegistry();
    const ctx = makeContext({ sourcePath: '/docs/My Complex Notes (2024).txt' });
    const result = writeQueueFile('/brain', ctx, registry);

    expect(result.queuePath).toBe(join('/brain', 'import-queue', 'my-complex-notes-2024.md'));
  });

  it('returns reason for low confidence regions', () => {
    const registry = makeRegistry();
    const ctx = makeContext({
      lowConfidenceRegions: [
        { startLine: 1, endLine: 10, suggestedType: 'note', confidence: 0.3 },
        { startLine: 11, endLine: 20, suggestedType: 'task', confidence: 0.4 },
      ],
    });
    const result = writeQueueFile('/brain', ctx, registry);

    expect(result.reason).toBe('low confidence: 2 regions');
  });

  it('returns reason for unclassified content', () => {
    const registry = makeRegistry();
    const ctx = makeContext({ remainderContent: 'some leftover text\nmore text' });
    const result = writeQueueFile('/brain', ctx, registry);

    expect(result.reason).toBe('unclassified: 2 lines');
  });

  it('returns generic reason when no specific cause', () => {
    const registry = makeRegistry();
    const result = writeQueueFile('/brain', makeContext(), registry);

    expect(result.reason).toBe('complex content');
  });

  it('handles note types without schema', () => {
    const registry = makeRegistry([
      {
        module: 'core',
        noteType: { name: 'note', description: 'A generic note' },
      },
    ]);
    writeQueueFile('/brain', makeContext(), registry);

    const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(content).toContain('**note**: A generic note');
    expect(content).not.toContain('Fields:');
  });
});
