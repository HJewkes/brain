import { describe, it, expect } from 'vitest';
import { buildSegmentMarkdown } from '../../../src/modules/sessions/data/segment-ops.js';
import type { CreateSegmentInput } from '../../../src/modules/sessions/data/segment-ops.js';
import type { DetectedSegment } from '../../../src/modules/sessions/engine/segmenter.js';
import type { ToolCall } from '../../../src/modules/sessions/types.js';

function makeSegment(overrides: Partial<DetectedSegment> = {}): DetectedSegment {
  return {
    index: 0,
    startToolIndex: 0,
    endToolIndex: 5,
    startTimestamp: '2026-03-15T10:00:00Z',
    endTimestamp: '2026-03-15T10:45:00Z',
    boundaryType: 'start',
    toolCalls: 5,
    errorCount: 0,
    tasksWorked: [],
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolUseId: 'tu-001',
    toolName: 'Read',
    input: { file_path: '/path/to/file.ts' },
    timestamp: '2026-03-15T10:05:00Z',
    outcome: 'success',
    isSidechain: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateSegmentInput> = {}): CreateSegmentInput {
  return {
    parentDisplayId: 'SNS-042',
    parentSessionId: 'session-abc-123',
    segment: makeSegment(),
    toolCalls: [],
    errors: [],
    notesDir: '/tmp/brain',
    ...overrides,
  };
}

describe('buildSegmentMarkdown', () => {
  it('produces valid frontmatter with all required fields', () => {
    const result = buildSegmentMarkdown(makeInput());

    expect(result).toContain('type: session-segment');
    expect(result).toContain('tier: slow');
    expect(result).toContain('module: sessions');
    expect(result).toContain('visibility: contextual');
    expect(result).toContain('parent_session: SNS-042');
    expect(result).toContain('segment_index: 0');
    expect(result).toContain('started_at: "2026-03-15T10:00:00Z"');
    expect(result).toContain('ended_at: "2026-03-15T10:45:00Z"');
    expect(result).toContain('duration_minutes: 45');
    expect(result).toContain('boundary_type: start');
    expect(result).toContain('tool_calls: 5');
    expect(result).toContain('error_count: 0');
  });

  it('includes compaction summary when present', () => {
    const segment = makeSegment({
      boundaryType: 'compaction',
      compactionSummary: 'Refactored the PM task routing engine.',
    });
    const result = buildSegmentMarkdown(makeInput({ segment }));

    expect(result).toContain('## Compaction Summary');
    expect(result).toContain('Refactored the PM task routing engine.');
    expect(result).toContain('compaction_summary:');
  });

  it('omits compaction summary section when not present', () => {
    const result = buildSegmentMarkdown(makeInput());
    expect(result).not.toContain('## Compaction Summary');
  });

  it('includes enriched tool call log entries', () => {
    const toolCalls = [
      makeToolCall({ toolName: 'Read', input: { file_path: '/src/main.ts' } }),
      makeToolCall({
        toolUseId: 'tu-002',
        toolName: 'Bash',
        input: { command: 'npm test' },
        timestamp: '2026-03-15T10:10:00Z',
      }),
    ];
    const result = buildSegmentMarkdown(makeInput({ toolCalls }));

    expect(result).toContain('## Tool Call Log');
    expect(result).toContain('Read');
    expect(result).toContain('file_path: /src/main.ts');
    expect(result).toContain('Bash');
    expect(result).toContain('command: npm test');
  });

  it('omits Errors section when error count is 0', () => {
    const result = buildSegmentMarkdown(makeInput({ errors: [] }));
    expect(result).not.toContain('## Errors');
  });

  it('includes Errors section when errors are present', () => {
    const errors = [
      {
        timestamp: '2026-03-15T10:20:00Z',
        toolName: 'Bash',
        message: 'Command failed: exit code 1',
      },
    ];
    const result = buildSegmentMarkdown(makeInput({ errors }));

    expect(result).toContain('## Errors');
    expect(result).toContain('Command failed: exit code 1');
  });

  it('uses zero-padded segment number in id (seg-01 for index 0)', () => {
    const result = buildSegmentMarkdown(makeInput());
    expect(result).toContain('id: sns-042-seg-01');
  });

  it('uses correct zero-padded id for higher indices', () => {
    const segment = makeSegment({ index: 4 });
    const result = buildSegmentMarkdown(makeInput({ segment }));
    expect(result).toContain('id: sns-042-seg-05');
  });

  it('includes tasks_worked in frontmatter when present', () => {
    const segment = makeSegment({ tasksWorked: ['VNM-21.04', 'VNM-21.05'] });
    const result = buildSegmentMarkdown(makeInput({ segment }));

    expect(result).toContain('tasks_worked:');
    expect(result).toContain('  - VNM-21.04');
    expect(result).toContain('  - VNM-21.05');
  });
});
