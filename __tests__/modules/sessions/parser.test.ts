import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSessionFile } from '../../../src/modules/sessions/engine/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'sample.jsonl');

describe('parseSessionFile', () => {
  it('parses fixture file without throwing', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result).toBeDefined();
  });

  it('extracts session identity', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.sessionId).toBe('test-session-001');
    expect(result.projectDir).toBe('/Users/test/project');
    expect(result.gitBranch).toBe('feat/session');
    expect(result.model).toBe('claude-opus-4-6');
  });

  it('counts turns correctly', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    // user events with string content: "Fix the search function" and "Great, thanks!"
    expect(result.userTurns).toBe(2);
    // assistant events with text/tool_use: 5 total
    expect(result.assistantTurns).toBe(5);
  });

  it('extracts tool calls', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(4);
    expect(result.toolCallsByName['Read']).toBe(1);
    expect(result.toolCallsByName['Edit']).toBe(2);
    expect(result.toolCallsByName['Bash']).toBe(1);
    expect(result.uniqueToolsUsed.sort()).toEqual(['Bash', 'Edit', 'Read']);
  });

  it('detects errors', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].toolName).toBe('Bash');
    expect(result.errorRate).toBeCloseTo(0.25); // 1 error / 4 tools
  });

  it('accumulates tokens', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.tokens.inputTokens).toBeGreaterThan(0);
    expect(result.tokens.outputTokens).toBeGreaterThan(0);
  });

  it('computes positive duration', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('sets provenance flags', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.capturedViaJsonl).toBe(true);
    expect(result.capturedViaHooks).toBe(false);
  });

  it('counts hook events', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.hookEventCount).toBe(1);
  });

  it('is not compacted', async () => {
    const result = await parseSessionFile(FIXTURE_PATH);
    expect(result.isCompacted).toBe(false);
    expect(result.compactionCount).toBe(0);
  });
});
