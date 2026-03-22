import { describe, it, expect } from 'vitest';
import { bisect } from '../../src/dashboard/components/session/bisect.js';
import { buildTimelines } from '../../src/dashboard/components/session/precompute.js';
import type { SessionDetailData } from '../../src/dashboard/types.js';

// ---------------------------------------------------------------------------
// bisect
// ---------------------------------------------------------------------------

describe('bisect', () => {
  it('returns 0 for empty array', () => {
    expect(bisect([], 5)).toBe(0);
  });

  it('single element — target before', () => {
    expect(bisect([10], 5)).toBe(0);
  });

  it('single element — target at element', () => {
    expect(bisect([10], 10)).toBe(1);
  });

  it('single element — target after', () => {
    expect(bisect([10], 15)).toBe(1);
  });

  it('multiple elements — target before all', () => {
    expect(bisect([10, 20, 30], 5)).toBe(0);
  });

  it('multiple elements — target between elements', () => {
    expect(bisect([10, 20, 30], 15)).toBe(1);
    expect(bisect([10, 20, 30], 25)).toBe(2);
  });

  it('multiple elements — target after all', () => {
    expect(bisect([10, 20, 30], 35)).toBe(3);
  });

  it('all elements equal — target matches', () => {
    expect(bisect([5, 5, 5, 5], 5)).toBe(4);
  });

  it('all elements equal — target below', () => {
    expect(bisect([5, 5, 5, 5], 3)).toBe(0);
  });

  it('all elements equal — target above', () => {
    expect(bisect([5, 5, 5, 5], 8)).toBe(4);
  });

  it('target exactly matching an element returns index after it', () => {
    expect(bisect([10, 20, 30, 40], 20)).toBe(2);
    expect(bisect([10, 20, 30, 40], 30)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// buildTimelines
// ---------------------------------------------------------------------------

function makeToolCall(
  overrides: Partial<{
    id: string;
    timestamp: string;
    toolName: string;
    inputSummary: string;
    outcome: 'success' | 'error' | 'pending';
    errorMessage: string | null;
    durationMs: number | null;
    byteOffset: number | null;
    agentId: string | null;
  }>
) {
  return {
    id: overrides.id ?? 'tc-1',
    timestamp: overrides.timestamp ?? '2026-03-16T10:00:00Z',
    toolName: overrides.toolName ?? 'Bash',
    inputSummary: overrides.inputSummary ?? '',
    outcome: overrides.outcome ?? 'success',
    errorMessage: overrides.errorMessage ?? null,
    durationMs: overrides.durationMs ?? 100,
    byteOffset: overrides.byteOffset ?? null,
    agentId: overrides.agentId ?? null,
  };
}

function makeSessionData(overrides: Partial<SessionDetailData> = {}): SessionDetailData {
  return {
    session: {
      sessionId: 's1',
      displayId: 'S-001',
      projectDir: '/tmp/project',
      project: null,
      workstream: null,
      status: 'completed',
      startedAt: '2026-03-16T10:00:00Z',
      completedAt: '2026-03-16T11:00:00Z',
      durationMinutes: 60,
      branch: null,
      worktreePath: null,
      agentModel: null,
      mode: null,
      compactCount: 0,
      summary: null,
      totalTurns: 0,
      toolCalls: 0,
      errorCount: 0,
      errorRate: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tasksWorked: [],
      tasksCompleted: [],
      notesCreated: [],
      commits: [],
      memoriesExtracted: 0,
      ...overrides.session,
    },
    turns: overrides.turns ?? [],
    tokenTimeline: overrides.tokenTimeline ?? [],
    compactions: overrides.compactions ?? [],
    taskEvents: overrides.taskEvents ?? [],
    agentEvents: overrides.agentEvents ?? [],
    subagents: overrides.subagents ?? [],
    frictionSignals: overrides.frictionSignals ?? [],
    totalToolCalls: overrides.totalToolCalls ?? 0,
    totalErrors: overrides.totalErrors ?? 0,
    errorRate: overrides.errorRate ?? 0,
  };
}

describe('buildTimelines', () => {
  it('returns empty timelines for a session with no turns', () => {
    const result = buildTimelines(makeSessionData());

    expect(result.agentTimeline).toHaveLength(1);
    expect(result.agentTimeline[0].isMain).toBe(true);
    expect(result.filesTimeline).toEqual([]);
    expect(result.toolTimestamps.Read).toEqual([]);
    expect(result.toolTimestamps.Write).toEqual([]);
    expect(result.toolTimestamps.Bash).toEqual([]);
    expect(result.toolTimestamps.Agent).toEqual([]);
    expect(result.errorTimestamps).toEqual([]);
    expect(result.allToolTs).toEqual([]);
    expect(result.totalReadFiles).toBe(0);
    expect(result.totalWriteFiles).toBe(0);
  });

  it('categorises tool calls into correct categories', () => {
    const data = makeSessionData({
      turns: [
        {
          index: 0,
          userMessage: 'test',
          assistantResponse: 'ok',
          toolCalls: [
            makeToolCall({ id: 'tc-1', toolName: 'Read', timestamp: '2026-03-16T10:01:00Z' }),
            makeToolCall({ id: 'tc-2', toolName: 'Grep', timestamp: '2026-03-16T10:02:00Z' }),
            makeToolCall({ id: 'tc-3', toolName: 'Write', timestamp: '2026-03-16T10:03:00Z' }),
            makeToolCall({ id: 'tc-4', toolName: 'Edit', timestamp: '2026-03-16T10:04:00Z' }),
            makeToolCall({ id: 'tc-5', toolName: 'Bash', timestamp: '2026-03-16T10:05:00Z' }),
            makeToolCall({ id: 'tc-6', toolName: 'Agent', timestamp: '2026-03-16T10:06:00Z' }),
            makeToolCall({ id: 'tc-7', toolName: 'Glob', timestamp: '2026-03-16T10:07:00Z' }),
            makeToolCall({ id: 'tc-8', toolName: 'Task', timestamp: '2026-03-16T10:08:00Z' }),
            makeToolCall({ id: 'tc-9', toolName: 'Skill', timestamp: '2026-03-16T10:09:00Z' }),
          ],
          timestamp: '2026-03-16T10:00:00Z',
          tokenUsage: null,
        },
      ],
    });

    const result = buildTimelines(data);

    expect(result.toolTotals.Read).toBe(3); // Read, Grep, Glob
    expect(result.toolTotals.Write).toBe(2); // Write, Edit
    expect(result.toolTotals.Bash).toBe(1); // Bash
    expect(result.toolTotals.Agent).toBe(3); // Agent, Task, Skill
  });

  it('tool timestamps are sorted ascending', () => {
    const data = makeSessionData({
      turns: [
        {
          index: 0,
          userMessage: 'test',
          assistantResponse: 'ok',
          toolCalls: [
            makeToolCall({ id: 'tc-3', toolName: 'Read', timestamp: '2026-03-16T10:30:00Z' }),
            makeToolCall({ id: 'tc-1', toolName: 'Read', timestamp: '2026-03-16T10:10:00Z' }),
            makeToolCall({ id: 'tc-2', toolName: 'Read', timestamp: '2026-03-16T10:20:00Z' }),
          ],
          timestamp: '2026-03-16T10:00:00Z',
          tokenUsage: null,
        },
      ],
    });

    const result = buildTimelines(data);
    const ts = result.toolTimestamps.Read;
    expect(ts).toHaveLength(3);
    expect(ts[0]).toBeLessThan(ts[1]);
    expect(ts[1]).toBeLessThan(ts[2]);
  });

  it('builds agent timeline with spawn/complete pairs', () => {
    const data = makeSessionData({
      agentEvents: [
        {
          agentId: 'agent-1',
          action: 'spawned',
          timestamp: '2026-03-16T10:10:00Z',
          taskId: 'T-001',
          model: null,
        },
        {
          agentId: 'agent-1',
          action: 'completed',
          timestamp: '2026-03-16T10:30:00Z',
          taskId: 'T-001',
          model: null,
        },
        {
          agentId: 'agent-2',
          action: 'spawned',
          timestamp: '2026-03-16T10:15:00Z',
          taskId: 'T-002',
          model: null,
        },
      ],
    });

    const result = buildTimelines(data);

    expect(result.agentTimeline).toHaveLength(3); // main + 2 sub
    expect(result.agentTimeline[0].isMain).toBe(true);
    expect(result.agentTimeline[0].label).toBe('Main session');

    const agent1 = result.agentTimeline.find((a) => a.agentId === 'agent-1')!;
    expect(agent1.spawnTs).toBe(new Date('2026-03-16T10:10:00Z').getTime());
    expect(agent1.completeTs).toBe(new Date('2026-03-16T10:30:00Z').getTime());
    expect(agent1.label).toBe('T-001');

    const agent2 = result.agentTimeline.find((a) => a.agentId === 'agent-2')!;
    expect(agent2.spawnTs).toBe(new Date('2026-03-16T10:15:00Z').getTime());
    // no completed event — defaults to spawn + 60s
    expect(agent2.completeTs).toBe(new Date('2026-03-16T10:15:00Z').getTime() + 60_000);
  });

  it('deduplicates files timeline by type:path key', () => {
    const data = makeSessionData({
      turns: [
        {
          index: 0,
          userMessage: 'test',
          assistantResponse: 'ok',
          toolCalls: [
            makeToolCall({
              id: 'tc-1',
              toolName: 'Read',
              inputSummary: 'file_path: "/src/a.ts"',
              timestamp: '2026-03-16T10:01:00Z',
            }),
            makeToolCall({
              id: 'tc-2',
              toolName: 'Read',
              inputSummary: 'file_path: "/src/a.ts"',
              timestamp: '2026-03-16T10:02:00Z',
            }),
            makeToolCall({
              id: 'tc-3',
              toolName: 'Write',
              inputSummary: 'file_path: "/src/a.ts"',
              timestamp: '2026-03-16T10:03:00Z',
            }),
          ],
          timestamp: '2026-03-16T10:00:00Z',
          tokenUsage: null,
        },
      ],
    });

    const result = buildTimelines(data);

    // read:/src/a.ts appears once, write:/src/a.ts appears once
    expect(result.filesTimeline).toHaveLength(2);
    expect(result.filesTimeline[0].type).toBe('read');
    expect(result.filesTimeline[1].type).toBe('write');
  });

  it('collects error timestamps', () => {
    const data = makeSessionData({
      turns: [
        {
          index: 0,
          userMessage: 'test',
          assistantResponse: 'ok',
          toolCalls: [
            makeToolCall({ id: 'tc-1', outcome: 'success', timestamp: '2026-03-16T10:01:00Z' }),
            makeToolCall({ id: 'tc-2', outcome: 'error', timestamp: '2026-03-16T10:02:00Z' }),
            makeToolCall({ id: 'tc-3', outcome: 'error', timestamp: '2026-03-16T10:03:00Z' }),
            makeToolCall({ id: 'tc-4', outcome: 'success', timestamp: '2026-03-16T10:04:00Z' }),
          ],
          timestamp: '2026-03-16T10:00:00Z',
          tokenUsage: null,
        },
      ],
    });

    const result = buildTimelines(data);

    expect(result.errorTimestamps).toHaveLength(2);
    expect(result.errorTimestamps[0]).toBe(new Date('2026-03-16T10:02:00Z').getTime());
    expect(result.errorTimestamps[1]).toBe(new Date('2026-03-16T10:03:00Z').getTime());
  });

  it('computes unique file totals for read and write', () => {
    const data = makeSessionData({
      turns: [
        {
          index: 0,
          userMessage: 'test',
          assistantResponse: 'ok',
          toolCalls: [
            makeToolCall({ id: 'tc-1', toolName: 'Read', inputSummary: 'file_path: "/src/a.ts"' }),
            makeToolCall({ id: 'tc-2', toolName: 'Read', inputSummary: 'file_path: "/src/b.ts"' }),
            makeToolCall({ id: 'tc-3', toolName: 'Read', inputSummary: 'file_path: "/src/a.ts"' }),
            makeToolCall({ id: 'tc-4', toolName: 'Write', inputSummary: 'file_path: "/src/c.ts"' }),
            makeToolCall({ id: 'tc-5', toolName: 'Edit', inputSummary: 'file_path: "/src/c.ts"' }),
            makeToolCall({ id: 'tc-6', toolName: 'Edit', inputSummary: 'file_path: "/src/d.ts"' }),
          ],
          timestamp: '2026-03-16T10:00:00Z',
          tokenUsage: null,
        },
      ],
    });

    const result = buildTimelines(data);

    expect(result.totalReadFiles).toBe(2); // a.ts, b.ts (deduplicated)
    expect(result.totalWriteFiles).toBe(2); // c.ts, d.ts
  });

  it('allToolTs is sorted ascending across turns', () => {
    const data = makeSessionData({
      turns: [
        {
          index: 0,
          userMessage: 'first',
          assistantResponse: 'ok',
          toolCalls: [
            makeToolCall({ id: 'tc-2', toolName: 'Bash', timestamp: '2026-03-16T10:20:00Z' }),
          ],
          timestamp: '2026-03-16T10:00:00Z',
          tokenUsage: null,
        },
        {
          index: 1,
          userMessage: 'second',
          assistantResponse: 'ok',
          toolCalls: [
            makeToolCall({ id: 'tc-1', toolName: 'Bash', timestamp: '2026-03-16T10:10:00Z' }),
          ],
          timestamp: '2026-03-16T10:05:00Z',
          tokenUsage: null,
        },
      ],
    });

    const result = buildTimelines(data);

    expect(result.allToolTs).toHaveLength(2);
    expect(result.allToolTs[0]).toBeLessThan(result.allToolTs[1]);
  });

  it('uses session duration when completedAt is null', () => {
    const data = makeSessionData({
      session: {
        sessionId: 's1',
        displayId: 'S-001',
        projectDir: '/tmp/project',
        project: null,
        workstream: null,
        status: 'active',
        startedAt: '2026-03-16T10:00:00Z',
        completedAt: null,
        durationMinutes: 30,
        branch: null,
        worktreePath: null,
        agentModel: null,
        mode: null,
        compactCount: 0,
        summary: null,
        totalTurns: 0,
        toolCalls: 0,
        errorCount: 0,
        errorRate: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tasksWorked: [],
        tasksCompleted: [],
        notesCreated: [],
        commits: [],
        memoriesExtracted: 0,
      },
    });

    const result = buildTimelines(data);
    const main = result.agentTimeline[0];
    const startMs = new Date('2026-03-16T10:00:00Z').getTime();
    expect(main.completeTs).toBe(startMs + 30 * 60_000);
  });
});
