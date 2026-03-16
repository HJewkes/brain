import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionFile } from '../../../src/modules/sessions/engine/parser.js';

function makeTmpJsonl(lines: object[]): string {
  const path = join(tmpdir(), `test-session-${Date.now()}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return path;
}

const SESSION_ID = 'test-session-id';
const PROJECT_DIR = '/tmp/test-project';
const TS1 = '2026-01-01T10:00:00.000Z';
const TS2 = '2026-01-01T10:00:05.000Z';
const TOOL_ID = 'toolu_abc123';

const assistantEvent = {
  type: 'assistant',
  sessionId: SESSION_ID,
  cwd: PROJECT_DIR,
  timestamp: TS1,
  message: {
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [
      {
        type: 'tool_use',
        id: TOOL_ID,
        name: 'Bash',
        input: { command: 'echo hello' },
      },
    ],
  },
};

const userEvent = {
  type: 'user',
  sessionId: SESSION_ID,
  cwd: PROJECT_DIR,
  timestamp: TS2,
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: TOOL_ID,
        content: 'hello',
      },
    ],
  },
};

describe('parseSessionFile — byte offset tracking', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    tmpFiles.length = 0;
  });

  it('assigns non-zero byte offsets to completed tool calls', async () => {
    const path = makeTmpJsonl([assistantEvent, userEvent]);
    tmpFiles.push(path);

    const analytics = await parseSessionFile(path);
    const toolCall = analytics.toolCalls.find((tc) => tc.toolUseId === TOOL_ID);

    expect(toolCall).toBeDefined();
    expect(toolCall!.byteOffset).toBeDefined();
    expect(toolCall!.byteOffset).toBe(0); // first line starts at offset 0
  });

  it('byte offsets increase across multiple tool calls', async () => {
    const TOOL_ID_2 = 'toolu_def456';
    const assistantEvent2 = {
      type: 'assistant',
      sessionId: SESSION_ID,
      cwd: PROJECT_DIR,
      timestamp: TS2,
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 50, output_tokens: 20 },
        content: [
          {
            type: 'tool_use',
            id: TOOL_ID_2,
            name: 'Read',
            input: { file_path: '/tmp/file.txt' },
          },
        ],
      },
    };
    const userEvent2 = {
      type: 'user',
      sessionId: SESSION_ID,
      cwd: PROJECT_DIR,
      timestamp: '2026-01-01T10:00:10.000Z',
      message: {
        content: [{ type: 'tool_result', tool_use_id: TOOL_ID_2, content: 'file contents' }],
      },
    };

    const path = makeTmpJsonl([assistantEvent, userEvent, assistantEvent2, userEvent2]);
    tmpFiles.push(path);

    const analytics = await parseSessionFile(path);
    const tc1 = analytics.toolCalls.find((tc) => tc.toolUseId === TOOL_ID);
    const tc2 = analytics.toolCalls.find((tc) => tc.toolUseId === TOOL_ID_2);

    expect(tc1).toBeDefined();
    expect(tc2).toBeDefined();
    expect(tc1!.byteOffset).toBe(0);
    expect(tc2!.byteOffset).toBeGreaterThan(tc1!.byteOffset!);
  });

  it('pending tool calls (no result) do not have a byte offset on the finalized entry', async () => {
    // Only the assistant event — no user tool_result to complete it
    const path = makeTmpJsonl([assistantEvent]);
    tmpFiles.push(path);

    const analytics = await parseSessionFile(path);
    const toolCall = analytics.toolCalls.find((tc) => tc.toolUseId === TOOL_ID);

    expect(toolCall).toBeDefined();
    expect(toolCall!.outcome).toBe('pending');
    // pending entries carry the byteOffset from the assistant event (first line = 0)
    expect(toolCall!.byteOffset).toBe(0);
  });
});
