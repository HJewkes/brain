import { describe, it, expect } from 'vitest';
import { checkBounds, createCounters, loadBounds } from '../../../src/modules/autoloop/engine/bounds.js';
import { DEFAULT_BOUNDS } from '../../../src/modules/autoloop/types.js';
import type { AutoloopBounds } from '../../../src/modules/autoloop/types.js';

describe('autoloop bounds', () => {
  describe('checkBounds', () => {
    const bounds: AutoloopBounds = {
      maxDurationMs: 10_000,
      maxNotesCreated: 5,
      maxTaskModifications: 3,
      maxLlmCalls: 10,
      cooldownMs: 60_000,
    };

    it('returns not exceeded when all counters are within limits', () => {
      const counters = createCounters();
      const result = checkBounds(bounds, counters);
      expect(result.exceeded).toBe(false);
    });

    it('detects time limit exceeded', () => {
      const counters = createCounters();
      counters.startedAt = Date.now() - 15_000;
      const result = checkBounds(bounds, counters);
      expect(result.exceeded).toBe(true);
      expect(result).toHaveProperty('reason');
      expect((result as { reason: string }).reason).toContain('Time limit');
    });

    it('detects notes limit exceeded', () => {
      const counters = createCounters();
      counters.notesCreated = 5;
      const result = checkBounds(bounds, counters);
      expect(result.exceeded).toBe(true);
      expect((result as { reason: string }).reason).toContain('Notes limit');
    });

    it('detects task modification limit exceeded', () => {
      const counters = createCounters();
      counters.taskModifications = 3;
      const result = checkBounds(bounds, counters);
      expect(result.exceeded).toBe(true);
      expect((result as { reason: string }).reason).toContain('Task modification limit');
    });

    it('detects LLM call limit exceeded', () => {
      const counters = createCounters();
      counters.llmCalls = 10;
      const result = checkBounds(bounds, counters);
      expect(result.exceeded).toBe(true);
      expect((result as { reason: string }).reason).toContain('LLM call limit');
    });

    it('checks time first (priority order)', () => {
      const counters = createCounters();
      counters.startedAt = Date.now() - 15_000;
      counters.notesCreated = 10;
      const result = checkBounds(bounds, counters);
      expect(result.exceeded).toBe(true);
      expect((result as { reason: string }).reason).toContain('Time limit');
    });
  });

  describe('createCounters', () => {
    it('initializes all counters to zero with current timestamp', () => {
      const before = Date.now();
      const counters = createCounters();
      const after = Date.now();

      expect(counters.notesCreated).toBe(0);
      expect(counters.taskModifications).toBe(0);
      expect(counters.llmCalls).toBe(0);
      expect(counters.startedAt).toBeGreaterThanOrEqual(before);
      expect(counters.startedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('loadBounds', () => {
    it('returns defaults when no config file exists', () => {
      const bounds = loadBounds('/nonexistent/path');
      expect(bounds).toEqual(DEFAULT_BOUNDS);
    });

    it('returns defaults when config has no autoloop key', () => {
      // loadBounds reads ao.config.json from cwd -- test with a known directory
      const bounds = loadBounds('/tmp');
      expect(bounds).toEqual(DEFAULT_BOUNDS);
    });
  });

  describe('DEFAULT_BOUNDS', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_BOUNDS.maxDurationMs).toBe(15 * 60 * 1000);
      expect(DEFAULT_BOUNDS.maxNotesCreated).toBe(20);
      expect(DEFAULT_BOUNDS.maxTaskModifications).toBe(10);
      expect(DEFAULT_BOUNDS.maxLlmCalls).toBe(50);
      expect(DEFAULT_BOUNDS.cooldownMs).toBe(30 * 60 * 1000);
    });
  });
});
