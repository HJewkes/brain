import type { SessionAnalytics, ToolCall } from '../types.js';

export interface SegmentBoundary {
  toolCallIndex: number;
  timestamp: string;
  boundaryType: 'compaction' | 'task_switch' | 'idle_gap';
  compactionSummary?: string;
  byteOffset?: number;
}

export interface DetectedSegment {
  index: number;
  startToolIndex: number;
  endToolIndex: number;
  startTimestamp: string;
  endTimestamp: string;
  boundaryType: 'start' | 'compaction' | 'task_switch' | 'idle_gap';
  compactionSummary?: string;
  toolCalls: number;
  errorCount: number;
  tasksWorked: string[];
}

const TASK_REF_PATTERN = /\b([A-Z]{2,6}-\d{2,3}\.\d{2,3})\b/g;
const TASK_CLAIM_PATTERN = /brain\s+pm\s+(claim|complete)\b/;
const IDLE_GAP_MS = 30 * 60 * 1000;
const MIN_TOOL_CALLS_BEFORE_TASK_SWITCH = 10;

function findToolCallAfterTimestamp(toolCalls: ToolCall[], ts: string): number {
  for (let i = 0; i < toolCalls.length; i++) {
    if (toolCalls[i].timestamp >= ts) return i;
  }
  return -1;
}

function extractTaskRefsFromInput(input: Record<string, unknown>): string[] {
  const text = JSON.stringify(input);
  const refs: string[] = [];
  TASK_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TASK_REF_PATTERN.exec(text)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

function detectCompactionBoundaries(analytics: SessionAnalytics): SegmentBoundary[] {
  const boundaries: SegmentBoundary[] = [];
  for (let i = 0; i < analytics.compactionTimestamps.length; i++) {
    const ts = analytics.compactionTimestamps[i];
    const idx = findToolCallAfterTimestamp(analytics.toolCalls, ts);
    if (idx < 0) continue;
    boundaries.push({
      toolCallIndex: idx,
      timestamp: analytics.toolCalls[idx].timestamp,
      boundaryType: 'compaction',
      compactionSummary: analytics.compactionSummaries[i],
      byteOffset: analytics.compactionByteOffsets[i],
    });
  }
  return boundaries;
}

function detectIdleGapBoundaries(toolCalls: ToolCall[]): SegmentBoundary[] {
  const boundaries: SegmentBoundary[] = [];
  for (let i = 1; i < toolCalls.length; i++) {
    const prev = new Date(toolCalls[i - 1].timestamp).getTime();
    const curr = new Date(toolCalls[i].timestamp).getTime();
    if (!isNaN(prev) && !isNaN(curr) && curr - prev >= IDLE_GAP_MS) {
      boundaries.push({
        toolCallIndex: i,
        timestamp: toolCalls[i].timestamp,
        boundaryType: 'idle_gap',
      });
    }
  }
  return boundaries;
}

function detectTaskSwitchBoundaries(
  toolCalls: ToolCall[],
  existingBoundaries: SegmentBoundary[]
): SegmentBoundary[] {
  const boundaries: SegmentBoundary[] = [];
  const boundaryIndices = new Set(existingBoundaries.map((b) => b.toolCallIndex));

  let lastBoundaryIndex = 0;

  for (let i = 0; i < toolCalls.length; i++) {
    if (boundaryIndices.has(i)) {
      lastBoundaryIndex = i;
      continue;
    }

    const tc = toolCalls[i];
    if (tc.toolName !== 'Bash') continue;

    const cmd = tc.input.command as string | undefined;
    if (!cmd || !TASK_CLAIM_PATTERN.test(cmd)) continue;

    const sinceLastBoundary = i - lastBoundaryIndex;
    if (sinceLastBoundary < MIN_TOOL_CALLS_BEFORE_TASK_SWITCH) continue;

    boundaries.push({
      toolCallIndex: i,
      timestamp: tc.timestamp,
      boundaryType: 'task_switch',
    });
    lastBoundaryIndex = i;
    boundaryIndices.add(i);
  }

  return boundaries;
}

function deduplicateBoundaries(boundaries: SegmentBoundary[]): SegmentBoundary[] {
  const priority = { compaction: 0, task_switch: 1, idle_gap: 2 } as const;
  const byIndex = new Map<number, SegmentBoundary>();

  for (const b of boundaries) {
    const existing = byIndex.get(b.toolCallIndex);
    if (!existing || priority[b.boundaryType] < priority[existing.boundaryType]) {
      byIndex.set(b.toolCallIndex, b);
    }
  }

  return [...byIndex.values()].sort((a, b) => a.toolCallIndex - b.toolCallIndex);
}

export function detectSegmentBoundaries(analytics: SessionAnalytics): SegmentBoundary[] {
  if (analytics.toolCalls.length === 0) return [];

  const compaction = detectCompactionBoundaries(analytics);
  const idle = detectIdleGapBoundaries(analytics.toolCalls);
  const taskSwitch = detectTaskSwitchBoundaries(analytics.toolCalls, [...compaction, ...idle]);

  return deduplicateBoundaries([...compaction, ...idle, ...taskSwitch]);
}

function buildSegmentFromSlice(
  toolCalls: ToolCall[],
  startIdx: number,
  endIdx: number,
  segmentIndex: number,
  boundaryType: DetectedSegment['boundaryType'],
  compactionSummary?: string
): DetectedSegment {
  const slice = toolCalls.slice(startIdx, endIdx);
  const errorCount = slice.filter((tc) => tc.outcome === 'error').length;
  const taskSet = new Set<string>();

  for (const tc of slice) {
    for (const ref of extractTaskRefsFromInput(tc.input)) {
      taskSet.add(ref);
    }
  }

  const startTimestamp = slice[0]?.timestamp ?? '';
  const endTimestamp = slice[slice.length - 1]?.timestamp ?? startTimestamp;

  return {
    index: segmentIndex,
    startToolIndex: startIdx,
    endToolIndex: endIdx,
    startTimestamp,
    endTimestamp,
    boundaryType,
    compactionSummary,
    toolCalls: slice.length,
    errorCount,
    tasksWorked: [...taskSet],
  };
}

export function buildSegments(analytics: SessionAnalytics): DetectedSegment[] {
  if (analytics.toolCalls.length === 0) return [];

  const boundaries = detectSegmentBoundaries(analytics);
  const total = analytics.toolCalls.length;

  if (boundaries.length === 0) {
    return [buildSegmentFromSlice(analytics.toolCalls, 0, total, 0, 'start')];
  }

  const segments: DetectedSegment[] = [];
  let prevIndex = 0;
  let prevBoundaryType: DetectedSegment['boundaryType'] = 'start';
  let prevSummary: string | undefined;

  for (const boundary of boundaries) {
    if (boundary.toolCallIndex > prevIndex) {
      segments.push(
        buildSegmentFromSlice(
          analytics.toolCalls,
          prevIndex,
          boundary.toolCallIndex,
          segments.length,
          prevBoundaryType,
          prevSummary
        )
      );
    }
    prevIndex = boundary.toolCallIndex;
    prevBoundaryType = boundary.boundaryType;
    prevSummary = boundary.compactionSummary;
  }

  // Final segment after last boundary
  segments.push(
    buildSegmentFromSlice(
      analytics.toolCalls,
      prevIndex,
      total,
      segments.length,
      prevBoundaryType,
      prevSummary
    )
  );

  return segments;
}
