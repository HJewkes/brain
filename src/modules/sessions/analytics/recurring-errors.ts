import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import type { SessionMetadata } from '../types.js';

export interface RecurringError {
  pattern: string;
  toolName: string;
  occurrences: number;
  sessionIds: string[];
  firstSeen: string;
  lastSeen: string;
  suggestion: string;
}

interface ParsedError {
  timestamp: string;
  toolName: string;
  message: string;
}

function normalizeMessage(msg: string): string {
  return msg.trim().toLowerCase().slice(0, 80);
}

function parseErrorsSection(content: string): ParsedError[] {
  const errors: ParsedError[] = [];
  const lines = content.split('\n');
  let inErrorSection = false;

  for (const line of lines) {
    if (line.startsWith('## Errors')) {
      inErrorSection = true;
      continue;
    }
    if (inErrorSection && line.startsWith('## ')) {
      break;
    }
    if (!inErrorSection) continue;

    // Match: - HH:MM:SS toolName: message
    const match = line.match(/^- (\d{2}:\d{2}:\d{2})\s+(\S+):\s+(.+)$/);
    if (match) {
      errors.push({
        timestamp: match[1],
        toolName: match[2],
        message: match[3],
      });
    }
  }

  return errors;
}

export function detectRecurringErrors(
  sessions: SessionMetadata[],
  _db: BrainDB,
  config: BrainConfig
): RecurringError[] {
  // Key: "toolName|normalizedMessage"
  const errorGroups = new Map<
    string,
    {
      toolName: string;
      pattern: string;
      sessionIds: Set<string>;
      occurrences: number;
      firstSeen: string;
      lastSeen: string;
    }
  >();

  for (const session of sessions) {
    const l2Path = join(
      config.notesDir,
      'modules',
      'sessions',
      session.display_id,
      'l2-timeline.md'
    );
    if (!existsSync(l2Path)) continue;

    let content: string;
    try {
      content = readFileSync(l2Path, 'utf-8');
    } catch {
      continue;
    }

    const errors = parseErrorsSection(content);
    for (const err of errors) {
      const normalized = normalizeMessage(err.message);
      const key = `${err.toolName}|${normalized}`;
      const existing = errorGroups.get(key);

      if (existing) {
        existing.occurrences++;
        existing.sessionIds.add(session.display_id);
        if (session.started_at < existing.firstSeen) existing.firstSeen = session.started_at;
        if (session.started_at > existing.lastSeen) existing.lastSeen = session.started_at;
      } else {
        errorGroups.set(key, {
          toolName: err.toolName,
          pattern: normalized,
          sessionIds: new Set([session.display_id]),
          occurrences: 1,
          firstSeen: session.started_at,
          lastSeen: session.started_at,
        });
      }
    }
  }

  // Only return errors appearing in 2+ sessions
  const results: RecurringError[] = [];
  for (const group of errorGroups.values()) {
    if (group.sessionIds.size < 2) continue;
    results.push({
      pattern: group.pattern,
      toolName: group.toolName,
      occurrences: group.occurrences,
      sessionIds: [...group.sessionIds],
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
      suggestion: `Check ${group.toolName} inputs before use — this error has occurred in ${group.sessionIds.size} sessions`,
    });
  }

  return results.sort((a, b) => b.occurrences - a.occurrences);
}
