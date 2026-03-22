import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder } from '../../../types.js';
import type { ToolCall } from '../types.js';
import type { DetectedSegment } from '../engine/segmenter.js';
import type { SessionAnalytics } from '../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { summarizeInput } from '../ingestion/summarizer.js';

export interface CreateSegmentInput {
  parentDisplayId: string;
  parentSessionId: string;
  segment: DetectedSegment;
  toolCalls: ToolCall[];
  errors: Array<{ timestamp: string; toolName: string; message: string }>;
  notesDir: string;
}

export function buildSegmentMarkdown(input: CreateSegmentInput): string {
  const { parentDisplayId, segment, toolCalls, errors } = input;
  const now = new Date().toISOString().slice(0, 10);
  const segNum = segment.index + 1;
  const segId = `${parentDisplayId.toLowerCase()}-seg-${String(segNum).padStart(2, '0')}`;
  const durationMinutes = computeDurationMinutes(segment.startTimestamp, segment.endTimestamp);

  const lines = buildFrontmatterLines(segId, parentDisplayId, segment, durationMinutes, now);
  lines.push('---', '', `# Segment ${segNum}: ${segment.boundaryType}`, '');

  if (segment.compactionSummary) {
    lines.push('## Compaction Summary', '', segment.compactionSummary, '');
  }

  lines.push('## Tool Call Log', '', ...buildToolCallLogLines(toolCalls), '');

  if (errors.length > 0) {
    lines.push('## Errors', '', ...buildErrorLines(errors), '');
  }

  return lines.join('\n');
}

function buildFrontmatterLines(
  segId: string,
  parentDisplayId: string,
  segment: DetectedSegment,
  durationMinutes: number,
  now: string
): string[] {
  const segNum = segment.index + 1;
  const lines = [
    '---',
    `id: ${segId}`,
    `title: "${parentDisplayId} Segment ${segNum}"`,
    'type: session-segment',
    'tier: slow',
    'module: sessions',
    'visibility: contextual',
    `parent_session: ${parentDisplayId}`,
    `segment_index: ${segment.index}`,
    `started_at: "${segment.startTimestamp}"`,
    `ended_at: "${segment.endTimestamp}"`,
    `duration_minutes: ${durationMinutes}`,
    `boundary_type: ${segment.boundaryType}`,
    `tool_calls: ${segment.toolCalls}`,
    `error_count: ${segment.errorCount}`,
  ];

  if (segment.tasksWorked.length > 0) {
    lines.push('tasks_worked:');
    for (const t of segment.tasksWorked) lines.push(`  - ${t}`);
  }

  if (segment.compactionSummary) {
    lines.push(`compaction_summary: "${segment.compactionSummary.replace(/"/g, '\\"')}"`);
  }

  lines.push(
    `content-dir: modules/sessions/${parentDisplayId}`,
    `created: ${now}`,
    `modified: ${now}`
  );

  return lines;
}

function buildToolCallLogLines(toolCalls: ToolCall[]): string[] {
  const lines: string[] = [];
  for (const tc of toolCalls) {
    const time = tc.timestamp.slice(11, 19);
    const status = tc.outcome === 'error' ? ' ERROR' : tc.outcome === 'pending' ? ' PENDING' : '';
    const duration = tc.durationMs != null ? ` (${tc.durationMs}ms)` : '';
    lines.push(`- ${time} ${tc.toolName}${status}${duration}`);
    const summary = summarizeInput(tc.toolName, tc.input);
    if (summary) lines.push(`  > ${summary}`);
    if (tc.outcome === 'error' && tc.errorMessage) {
      lines.push(`  > error: ${tc.errorMessage.slice(0, 200)}`);
    }
  }
  return lines;
}

function buildErrorLines(
  errors: Array<{ timestamp: string; toolName: string; message: string }>
): string[] {
  return errors.map((err) => {
    const time = err.timestamp.slice(11, 19);
    return `- ${time} ${err.toolName}: ${err.message.slice(0, 200)}`;
  });
}

function computeDurationMinutes(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return 0;
  return Math.round((endMs - startMs) / 60000);
}

function segmentFilePath(notesDir: string, parentDisplayId: string, segmentIndex: number): string {
  const filename = `seg-${String(segmentIndex).padStart(3, '0')}.md`;
  return join(notesDir, 'modules', 'sessions', parentDisplayId, filename);
}

function sliceErrors(
  analytics: SessionAnalytics,
  segment: DetectedSegment
): Array<{ timestamp: string; toolName: string; message: string }> {
  const startTs = segment.startTimestamp;
  const endTs = segment.endTimestamp;
  return analytics.errors
    .filter((e) => e.timestamp >= startTs && e.timestamp <= endTs)
    .map((e) => ({
      timestamp: e.timestamp,
      toolName: e.toolName ?? 'unknown',
      message: e.message,
    }));
}

async function writeAndIndexSegment(
  db: BrainDB,
  embedder: Embedder | null,
  input: CreateSegmentInput
): Promise<string | null> {
  const { parentDisplayId, segment, notesDir } = input;
  const content = buildSegmentMarkdown(input);
  const filePath = segmentFilePath(notesDir, parentDisplayId, segment.index);

  mkdirSync(join(notesDir, 'modules', 'sessions', parentDisplayId), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');

  if (!embedder) return null;

  const hash = createHash('sha256').update(content).digest('hex');
  return indexSingleFile(db, embedder, filePath, content, hash, Date.now());
}

function createSegmentRelations(
  db: BrainDB,
  parentNoteId: string,
  segmentNoteIds: string[],
  segmentIndex: number
): void {
  const segNoteId = segmentNoteIds[segmentIndex];
  if (!segNoteId) return;

  db.upsertRelations(parentNoteId, [
    { sourceId: parentNoteId, targetId: segNoteId, type: 'has-segment' },
  ]);
  db.upsertRelations(segNoteId, [
    { sourceId: segNoteId, targetId: parentNoteId, type: 'segment-of' },
  ]);

  if (segmentIndex > 0) {
    const prevNoteId = segmentNoteIds[segmentIndex - 1];
    if (prevNoteId) {
      db.upsertRelations(prevNoteId, [
        { sourceId: prevNoteId, targetId: segNoteId, type: 'next-segment' },
      ]);
      db.upsertRelations(segNoteId, [
        { sourceId: segNoteId, targetId: prevNoteId, type: 'prev-segment' },
      ]);
    }
  }
}

export async function createSegments(
  db: BrainDB,
  embedder: Embedder | null,
  parentDisplayId: string,
  parentNoteId: string,
  analytics: SessionAnalytics,
  segments: DetectedSegment[],
  notesDir: string
): Promise<void> {
  const segmentNoteIds: string[] = [];

  for (const segment of segments) {
    const toolCalls = analytics.toolCalls.slice(segment.startToolIndex, segment.endToolIndex);
    const errors = sliceErrors(analytics, segment);

    const noteId = await writeAndIndexSegment(db, embedder, {
      parentDisplayId,
      parentSessionId: analytics.sessionId,
      segment,
      toolCalls,
      errors,
      notesDir,
    });

    segmentNoteIds.push(noteId ?? '');
  }

  for (let i = 0; i < segmentNoteIds.length; i++) {
    if (segmentNoteIds[i]) {
      createSegmentRelations(db, parentNoteId, segmentNoteIds, i);
    }
  }
}
