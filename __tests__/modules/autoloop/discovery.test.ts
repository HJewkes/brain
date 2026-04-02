import { describe, it, expect, beforeEach } from 'vitest';
import { readSessionTranscript } from '../../../src/modules/autoloop/engine/discovery.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('readSessionTranscript', () => {
  const testDir = join(tmpdir(), 'autoloop-discovery-test');
  const testFile = join(testDir, 'test-session.jsonl');

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  it('extracts user and assistant turns', async () => {
    const lines = [
      JSON.stringify({ type: 'human', content: 'Hello, fix the bug' }),
      JSON.stringify({ type: 'assistant', content: 'I will look into it' }),
    ];
    writeFileSync(testFile, lines.join('\n'));

    const turns = await readSessionTranscript(testFile);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Hello, fix the bug');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toBe('I will look into it');
  });

  it('extracts tool_use events', async () => {
    const lines = [
      JSON.stringify({
        type: 'tool_use',
        name: 'Read',
        input: { file_path: '/src/main.ts' },
      }),
    ];
    writeFileSync(testFile, lines.join('\n'));

    const turns = await readSessionTranscript(testFile);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool_use');
    expect(turns[0].toolName).toBe('Read');
    expect(turns[0].content).toContain('Read');
    expect(turns[0].content).toContain('/src/main.ts');
  });

  it('handles array content blocks', async () => {
    const lines = [
      JSON.stringify({
        type: 'human',
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
      }),
    ];
    writeFileSync(testFile, lines.join('\n'));

    const turns = await readSessionTranscript(testFile);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toContain('First part');
    expect(turns[0].content).toContain('Second part');
  });

  it('truncates long content to 2000 chars', async () => {
    const longContent = 'x'.repeat(5000);
    const lines = [JSON.stringify({ type: 'human', content: longContent })];
    writeFileSync(testFile, lines.join('\n'));

    const turns = await readSessionTranscript(testFile);
    expect(turns).toHaveLength(1);
    expect(turns[0].content.length).toBeLessThanOrEqual(2001); // 2000 + ellipsis
  });

  it('respects maxTokenEstimate', async () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ type: 'human', content: `Message ${i}: ${'a'.repeat(200)}` })
    );
    writeFileSync(testFile, lines.join('\n'));

    const turns = await readSessionTranscript(testFile, { maxTokenEstimate: 500 });
    const totalChars = turns.reduce((sum, t) => sum + t.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(2500); // 500 tokens * 4 chars + some buffer
  });

  it('skips invalid JSON lines gracefully', async () => {
    const lines = [
      'not json',
      JSON.stringify({ type: 'human', content: 'Valid message' }),
      '{ broken json',
    ];
    writeFileSync(testFile, lines.join('\n'));

    const turns = await readSessionTranscript(testFile);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('Valid message');
  });

  it('returns empty array for empty file', async () => {
    writeFileSync(testFile, '');
    const turns = await readSessionTranscript(testFile);
    expect(turns).toHaveLength(0);
  });

  it('handles role-based format (user/assistant)', async () => {
    const lines = [
      JSON.stringify({ role: 'user', content: 'Hi there' }),
      JSON.stringify({ role: 'assistant', content: 'Hello!' }),
    ];
    writeFileSync(testFile, lines.join('\n'));

    const turns = await readSessionTranscript(testFile);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');
  });
});
