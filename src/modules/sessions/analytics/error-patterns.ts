import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainConfig } from '../../../types.js';
import type { SessionMetadata } from '../types.js';

export interface ErrorPattern {
  toolName: string;
  messagePrefix: string;
  occurrences: number;
  sessionCount: number;
}

export interface CorrectionPattern {
  kind: string;
  occurrences: number;
  sessionCount: number;
}

export function extractErrorPatterns(
  sessions: SessionMetadata[],
  config: BrainConfig
): ErrorPattern[] {
  const errorMap = new Map<string, { occurrences: number; sessionIds: Set<string> }>();

  for (const session of sessions) {
    const errors = parseErrorSection(config, session.display_id);
    for (const err of errors) {
      const key = `${err.toolName}|${err.messagePrefix}`;
      const existing = errorMap.get(key) ?? { occurrences: 0, sessionIds: new Set() };
      existing.occurrences += 1;
      existing.sessionIds.add(session.display_id);
      errorMap.set(key, existing);
    }
  }

  const patterns: ErrorPattern[] = [];
  for (const [key, stats] of errorMap) {
    const [toolName, messagePrefix] = key.split('|');
    patterns.push({
      toolName,
      messagePrefix,
      occurrences: stats.occurrences,
      sessionCount: stats.sessionIds.size,
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences);
}

interface ParsedError {
  toolName: string;
  messagePrefix: string;
}

function parseErrorSection(config: BrainConfig, displayId: string): ParsedError[] {
  const l2 = readL2Timeline(config.notesDir, displayId);
  if (!l2) return [];
  return parseErrorsFromL2(l2);
}

export function parseErrorsFromL2(l2Content: string): ParsedError[] {
  const sectionStart = l2Content.indexOf('## Errors');
  if (sectionStart === -1) return [];

  const afterHeader = l2Content.indexOf('\n', sectionStart);
  if (afterHeader === -1) return [];

  const nextSection = l2Content.indexOf('\n## ', afterHeader + 1);
  const sectionText =
    nextSection > 0 ? l2Content.slice(afterHeader, nextSection) : l2Content.slice(afterHeader);

  const errors: ParsedError[] = [];
  const linePattern = /^- \d{2}:\d{2}:\d{2} (\S+): (.+)/;

  for (const line of sectionText.split('\n')) {
    const match = line.match(linePattern);
    if (match) {
      errors.push({
        toolName: match[1],
        messagePrefix: match[2].slice(0, 100),
      });
    }
  }

  return errors;
}

export function extractCorrectionPatterns(
  sessions: SessionMetadata[],
  config: BrainConfig
): CorrectionPattern[] {
  const kindMap = new Map<string, { occurrences: number; sessionIds: Set<string> }>();

  for (const session of sessions) {
    const frictions = parseFrictionSection(config, session.display_id);

    if (frictions.length === 0 && session.analyticsExt?.friction_categories) {
      for (const fc of session.analyticsExt.friction_categories) {
        const existing = kindMap.get(fc.category) ?? { occurrences: 0, sessionIds: new Set() };
        existing.occurrences += fc.count;
        existing.sessionIds.add(session.display_id);
        kindMap.set(fc.category, existing);
      }
      continue;
    }

    for (const kind of frictions) {
      const existing = kindMap.get(kind) ?? { occurrences: 0, sessionIds: new Set() };
      existing.occurrences += 1;
      existing.sessionIds.add(session.display_id);
      kindMap.set(kind, existing);
    }
  }

  const patterns: CorrectionPattern[] = [];
  for (const [kind, stats] of kindMap) {
    patterns.push({
      kind,
      occurrences: stats.occurrences,
      sessionCount: stats.sessionIds.size,
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences);
}

function parseFrictionSection(config: BrainConfig, displayId: string): string[] {
  const l2 = readL2Timeline(config.notesDir, displayId);
  if (!l2) return [];
  return parseFrictionsFromL2(l2);
}

export function parseFrictionsFromL2(l2Content: string): string[] {
  const sectionStart = l2Content.indexOf('## Friction Signals');
  if (sectionStart === -1) return [];

  const afterHeader = l2Content.indexOf('\n', sectionStart);
  if (afterHeader === -1) return [];

  const nextSection = l2Content.indexOf('\n## ', afterHeader + 1);
  const sectionText =
    nextSection > 0 ? l2Content.slice(afterHeader, nextSection) : l2Content.slice(afterHeader);

  const kinds: string[] = [];
  const linePattern = /^- (\S+): /;

  for (const line of sectionText.split('\n')) {
    const match = line.match(linePattern);
    if (match) {
      kinds.push(match[1]);
    }
  }

  return kinds;
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
