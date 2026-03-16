import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractCompactionSummary,
  AnalyticsAccumulator,
} from '../../../src/modules/sessions/engine/accumulator.js';

const FULL_COMPACTION = `This session is being continued from a previous conversation that ran out of context. Here is a summary of the conversation so far:

We were implementing the session module. Key decisions included using SQLite for storage and a 7-stage pipeline.

The conversation may now continue.`;

const COMPACTION_NO_CLOSING = `This session is being continued from a previous conversation that ran out of context. Here is a summary of the conversation so far:

We were discussing architecture options for the brain project.`;

const COMPACTION_EMPTY = `This session is being continued from a previous conversation that ran out of context. Here is a summary of the conversation so far:

The conversation may now continue.`;

describe('extractCompactionSummary', () => {
  it('extracts summary from a full compaction message', () => {
    const result = extractCompactionSummary(FULL_COMPACTION);
    expect(result).toBe(
      'We were implementing the session module. Key decisions included using SQLite for storage and a 7-stage pipeline.'
    );
  });

  it('returns null for non-compaction messages', () => {
    expect(extractCompactionSummary('Hello, how can I help you today?')).toBeNull();
    expect(extractCompactionSummary('')).toBeNull();
  });

  it('handles missing closing line by extracting to end of content', () => {
    const result = extractCompactionSummary(COMPACTION_NO_CLOSING);
    expect(result).toBe('We were discussing architecture options for the brain project.');
  });

  it('returns null when marker is present but no summary content', () => {
    const result = extractCompactionSummary(COMPACTION_EMPTY);
    expect(result).toBeNull();
  });
});

describe('AnalyticsAccumulator — compaction summary extraction', () => {
  let acc: AnalyticsAccumulator;

  function makeUserEvent(content: string | unknown[], _opts: { byteOffset?: number } = {}) {
    return {
      type: 'user' as const,
      sessionId: 'sess-1',
      timestamp: '2026-01-01T00:00:00Z',
      cwd: '/test/project',
      gitBranch: 'main',
      message: { role: 'user', content },
    };
  }

  beforeEach(() => {
    acc = new AnalyticsAccumulator();
  });

  it('extracts summary from a string-content compaction user message', () => {
    acc.ingest(makeUserEvent(FULL_COMPACTION));
    const result = acc.finalize();
    expect(result.compactionCount).toBe(1);
    expect(result.compactionSummaries).toHaveLength(1);
    expect(result.compactionSummaries[0]).toContain('implementing the session module');
  });

  it('extracts summary from array-content compaction user message', () => {
    acc.ingest(makeUserEvent([{ type: 'text', text: FULL_COMPACTION }]));
    const result = acc.finalize();
    expect(result.compactionCount).toBe(1);
    expect(result.compactionSummaries).toHaveLength(1);
    expect(result.compactionSummaries[0]).toContain('implementing the session module');
  });

  it('records byte offset for compaction events', () => {
    acc.ingest(makeUserEvent(FULL_COMPACTION), 1024);
    const result = acc.finalize();
    expect(result.compactionByteOffsets).toEqual([1024]);
  });

  it('produces multiple summaries for multiple compaction events', () => {
    const second = `This session is being continued from a previous conversation that ran out of context. Here is a summary of the conversation so far:

The second context window covered testing infrastructure.

The conversation may now continue.`;

    acc.ingest(makeUserEvent(FULL_COMPACTION), 512);
    acc.ingest(makeUserEvent(second), 2048);

    const result = acc.finalize();
    expect(result.compactionCount).toBe(2);
    expect(result.compactionSummaries).toHaveLength(2);
    expect(result.compactionSummaries[0]).toContain('implementing the session module');
    expect(result.compactionSummaries[1]).toContain('testing infrastructure');
    expect(result.compactionByteOffsets).toEqual([512, 2048]);
  });

  it('does not record byte offset when not provided', () => {
    acc.ingest(makeUserEvent(FULL_COMPACTION));
    const result = acc.finalize();
    expect(result.compactionByteOffsets).toHaveLength(0);
  });

  it('does not push null summary when marker present but no content', () => {
    acc.ingest(makeUserEvent(COMPACTION_EMPTY));
    const result = acc.finalize();
    expect(result.compactionCount).toBe(1);
    expect(result.compactionSummaries).toHaveLength(0);
  });
});
