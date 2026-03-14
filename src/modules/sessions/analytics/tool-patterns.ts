import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainConfig } from '../../../types.js';
import type { SessionMetadata } from '../types.js';

export interface ToolPattern {
  toolName: string;
  totalCalls: number;
  errorRate: number;
  avgOccurrencesPerSession: number;
}

export interface ToolSequence {
  first: string;
  second: string;
  count: number;
  avgGapMs: number | null;
}

export function extractToolPatterns(
  sessions: SessionMetadata[],
  config: BrainConfig
): ToolPattern[] {
  if (sessions.length === 0) return [];

  const toolStats = new Map<string, { calls: number; errors: number; sessionCount: number }>();

  for (const session of sessions) {
    const perSession = aggregateToolsFromSession(session, config);
    for (const [toolName, stats] of perSession) {
      const existing = toolStats.get(toolName) ?? { calls: 0, errors: 0, sessionCount: 0 };
      existing.calls += stats.calls;
      existing.errors += stats.errors;
      existing.sessionCount += 1;
      toolStats.set(toolName, existing);
    }
  }

  const sessionCount = sessions.length;
  const patterns: ToolPattern[] = [];

  for (const [toolName, stats] of toolStats) {
    patterns.push({
      toolName,
      totalCalls: stats.calls,
      errorRate: stats.calls > 0 ? stats.errors / stats.calls : 0,
      avgOccurrencesPerSession: stats.calls / sessionCount,
    });
  }

  return patterns.sort((a, b) => b.totalCalls - a.totalCalls);
}

function aggregateToolsFromSession(
  session: SessionMetadata,
  config: BrainConfig
): Map<string, { calls: number; errors: number }> {
  const result = new Map<string, { calls: number; errors: number }>();

  if (session.analyticsExt?.top_tools) {
    for (const t of session.analyticsExt.top_tools) {
      result.set(t.name, {
        calls: t.count,
        errors: Math.round(t.error_rate * t.count),
      });
    }
    return result;
  }

  const toolNames = parseToolCallLog(config, session.display_id);
  for (const entry of toolNames) {
    const existing = result.get(entry.name) ?? { calls: 0, errors: 0 };
    existing.calls += 1;
    if (entry.isError) existing.errors += 1;
    result.set(entry.name, existing);
  }

  return result;
}

interface ParsedToolEntry {
  name: string;
  isError: boolean;
  timeStr: string;
}

function parseToolCallLog(config: BrainConfig, displayId: string): ParsedToolEntry[] {
  const l2 = readL2Timeline(config.notesDir, displayId);
  if (!l2) return [];
  return parseToolCallSection(l2);
}

export function parseToolCallSection(l2Content: string): ParsedToolEntry[] {
  const sectionStart = l2Content.indexOf('## Tool Call Log');
  if (sectionStart === -1) return [];

  const afterHeader = l2Content.indexOf('\n', sectionStart);
  if (afterHeader === -1) return [];

  const nextSection = l2Content.indexOf('\n## ', afterHeader + 1);
  const sectionText =
    nextSection > 0 ? l2Content.slice(afterHeader, nextSection) : l2Content.slice(afterHeader);

  const entries: ParsedToolEntry[] = [];
  const linePattern = /^- (\d{2}:\d{2}:\d{2}) (\S+)(.*)/;

  for (const line of sectionText.split('\n')) {
    const match = line.match(linePattern);
    if (match) {
      const rest = match[3];
      entries.push({
        name: match[2],
        isError: rest.includes('ERROR'),
        timeStr: match[1],
      });
    }
  }

  return entries;
}

export function extractToolSequencePatterns(
  sessions: SessionMetadata[],
  config: BrainConfig
): ToolSequence[] {
  const bigramCounts = new Map<string, { count: number; gapMs: number; gapCount: number }>();

  for (const session of sessions) {
    const entries = parseToolCallLog(config, session.display_id);
    for (let i = 0; i < entries.length - 1; i++) {
      const key = `${entries[i].name}|${entries[i + 1].name}`;
      const existing = bigramCounts.get(key) ?? { count: 0, gapMs: 0, gapCount: 0 };
      existing.count += 1;

      const gap = computeTimeGap(entries[i].timeStr, entries[i + 1].timeStr);
      if (gap !== null) {
        existing.gapMs += gap;
        existing.gapCount += 1;
      }

      bigramCounts.set(key, existing);
    }
  }

  const sequences: ToolSequence[] = [];
  for (const [key, stats] of bigramCounts) {
    const [first, second] = key.split('|');
    sequences.push({
      first,
      second,
      count: stats.count,
      avgGapMs: stats.gapCount > 0 ? Math.round(stats.gapMs / stats.gapCount) : null,
    });
  }

  return sequences.sort((a, b) => b.count - a.count).slice(0, 10);
}

function computeTimeGap(time1: string, time2: string): number | null {
  const ms1 = parseTimeToMs(time1);
  const ms2 = parseTimeToMs(time2);
  if (ms1 === null || ms2 === null) return null;
  return ms2 - ms1;
}

function parseTimeToMs(time: string): number | null {
  const parts = time.split(':');
  if (parts.length !== 3) return null;
  const [h, m, s] = parts.map(Number);
  if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
  return (h * 3600 + m * 60 + s) * 1000;
}

function readL2Timeline(notesDir: string, displayId: string): string | null {
  const path = join(notesDir, 'modules', 'sessions', displayId, 'l2-timeline.md');
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
