import { describe, it, expect, beforeEach } from 'vitest';
import { FrictionDetector } from '../../../src/modules/sessions/engine/friction.js';

describe('FrictionDetector', () => {
  let detector: FrictionDetector;

  beforeEach(() => {
    detector = new FrictionDetector();
  });

  describe('consecutive identical tool calls', () => {
    it('emits signal on 2nd identical call', () => {
      detector.onToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T00:00:00Z');
      detector.onToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T00:00:01Z');

      const signals = detector.flush();
      expect(signals).toHaveLength(1);
      expect(signals[0].kind).toBe('consecutive_identical_tool');
      expect(signals[0].toolName).toBe('Read');
    });

    it('does not emit when different tool in between', () => {
      detector.onToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T00:00:00Z');
      detector.onToolUse('Edit', { file_path: '/a.ts' }, '2026-01-01T00:00:01Z');
      detector.onToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T00:00:02Z');

      expect(detector.flush()).toHaveLength(0);
    });

    it('does not emit when same tool with different input', () => {
      detector.onToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T00:00:00Z');
      detector.onToolUse('Read', { file_path: '/b.ts' }, '2026-01-01T00:00:01Z');

      expect(detector.flush()).toHaveLength(0);
    });
  });

  describe('error loops', () => {
    it('emits signal after 3 consecutive errors', () => {
      detector.onToolResult(true, '2026-01-01T00:00:00Z', 'Bash');
      detector.onToolResult(true, '2026-01-01T00:00:01Z', 'Bash');
      detector.onToolResult(true, '2026-01-01T00:00:02Z', 'Bash');

      const signals = detector.flush();
      expect(signals).toHaveLength(1);
      expect(signals[0].kind).toBe('error_loop');
      expect(signals[0].count).toBe(3);
    });

    it('resets on success', () => {
      detector.onToolResult(true, '2026-01-01T00:00:00Z', 'Bash');
      detector.onToolResult(true, '2026-01-01T00:00:01Z', 'Bash');
      detector.onToolResult(false, '2026-01-01T00:00:02Z', 'Bash');
      detector.onToolResult(true, '2026-01-01T00:00:03Z', 'Bash');
      detector.onToolResult(true, '2026-01-01T00:00:04Z', 'Bash');
      detector.onToolResult(true, '2026-01-01T00:00:05Z', 'Bash');

      const signals = detector.flush();
      expect(signals).toHaveLength(1);
      expect(signals[0].timestamp).toBe('2026-01-01T00:00:05Z');
    });

    it('does not emit for 2 errors only', () => {
      detector.onToolResult(true, '2026-01-01T00:00:00Z');
      detector.onToolResult(true, '2026-01-01T00:00:01Z');

      expect(detector.flush()).toHaveLength(0);
    });
  });

  describe('user corrections', () => {
    it('detects correction keywords', () => {
      detector.onUserMessage("no, that's not right", '2026-01-01T00:00:00Z');

      const signals = detector.flush();
      expect(signals).toHaveLength(1);
      expect(signals[0].kind).toBe('user_correction');
    });

    it('detects "don\'t" keyword', () => {
      detector.onUserMessage("don't do that", '2026-01-01T00:00:00Z');
      expect(detector.flush()).toHaveLength(1);
    });

    it('detects "actually" keyword', () => {
      detector.onUserMessage('actually, use the other approach', '2026-01-01T00:00:00Z');
      expect(detector.flush()).toHaveLength(1);
    });

    it('does not trigger on unrelated text', () => {
      detector.onUserMessage('please fix the search function', '2026-01-01T00:00:00Z');
      expect(detector.flush()).toHaveLength(0);
    });

    it('requires word boundary for "no"', () => {
      // "no" must be followed by comma/period then space
      detector.onUserMessage('nothing to worry about', '2026-01-01T00:00:00Z');
      expect(detector.flush()).toHaveLength(0);
    });
  });

  describe('hook prevention', () => {
    it('records hook prevention signal', () => {
      detector.onHookPrevention('2026-01-01T00:00:00Z', 'Hook prevented: lint');

      const signals = detector.flush();
      expect(signals).toHaveLength(1);
      expect(signals[0].kind).toBe('hook_prevention');
    });
  });

  describe('no friction', () => {
    it('returns empty for varied tool calls with no errors', () => {
      detector.onToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T00:00:00Z');
      detector.onToolResult(false, '2026-01-01T00:00:01Z');
      detector.onToolUse('Edit', { file_path: '/a.ts' }, '2026-01-01T00:00:02Z');
      detector.onToolResult(false, '2026-01-01T00:00:03Z');

      expect(detector.flush()).toHaveLength(0);
    });
  });
});
