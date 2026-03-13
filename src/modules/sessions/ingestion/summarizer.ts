import { relative } from 'node:path';
import type { SessionAnalytics, ToolCall } from '../types.js';
import type { OllamaClient } from '../../../services/ollama.js';
import { formatDuration } from '../utils.js';

export function buildSummaryDigest(analytics: SessionAnalytics): string {
  const lines: string[] = [];
  lines.push(`Session: ${analytics.sessionId}`);
  lines.push(`Project: ${analytics.projectDir}`);
  if (analytics.gitBranch) lines.push(`Branch: ${analytics.gitBranch}`);
  if (analytics.model) lines.push(`Model: ${analytics.model}`);
  lines.push(`Duration: ${formatDuration(analytics.durationMs)}`);
  lines.push(`Turns: ${analytics.userTurns} user, ${analytics.assistantTurns} assistant`);
  lines.push(
    `Tool calls: ${analytics.toolCalls.length} (${analytics.errorCount} errors, ${(analytics.errorRate * 100).toFixed(1)}% error rate)`
  );

  if (analytics.uniqueToolsUsed.length > 0) {
    lines.push(`Tools used: ${analytics.uniqueToolsUsed.join(', ')}`);
  }

  if (analytics.isCompacted) {
    lines.push(`Compactions: ${analytics.compactionCount}`);
  }

  if (analytics.frictionSignals.length > 0) {
    lines.push(`Friction signals: ${analytics.frictionSignals.length}`);
    for (const s of analytics.frictionSignals.slice(0, 5)) {
      lines.push(`  - ${s.kind}: ${s.detail}`);
    }
  }

  const topTools = Object.entries(analytics.toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topTools.length > 0) {
    lines.push('Top tools:');
    for (const [name, count] of topTools) {
      lines.push(`  - ${name}: ${count} calls`);
    }
  }

  return lines.join('\n');
}

export async function generateSummaries(
  analytics: SessionAnalytics,
  ollama: OllamaClient | null
): Promise<{ l0: string; l1: string }> {
  const digest = buildSummaryDigest(analytics);
  const l0Fallback = buildL0Fallback(analytics);

  if (!ollama) {
    return { l0: l0Fallback, l1: digest };
  }

  try {
    const l0 = await ollama.generate(
      `Summarize this coding session in ONE sentence (max 200 chars). Focus on what was accomplished.\n\n${digest}`,
      'You are a concise technical summarizer. Output only the summary sentence, nothing else.'
    );
    const trimmedL0 = l0.trim().slice(0, 200);

    const l1 = await ollama.generate(
      `Create a structured summary of this coding session. Use these sections:\n## What Was Accomplished\n## Key Decisions\n## Errors and Resolutions\n## Open Items\n\nKeep each section to 2-4 bullet points. Skip empty sections.\n\n${digest}`,
      'You are a technical session summarizer. Output structured markdown.'
    );

    return {
      l0: trimmedL0 || l0Fallback,
      l1: l1.trim() || digest,
    };
  } catch {
    return { l0: l0Fallback, l1: digest };
  }
}

function buildL0Fallback(analytics: SessionAnalytics): string {
  const branch = analytics.gitBranch ?? 'unknown branch';
  const duration = formatDuration(analytics.durationMs);
  const toolCount = analytics.toolCalls.length;
  return `${branch} — ${toolCount} tool calls — ${duration}`.slice(0, 200);
}

interface ActiveFileEntry {
  path: string;
  relativePath: string;
  operations: string[];
  lastTimestamp: string;
}

export function generateL2Timeline(analytics: SessionAnalytics): string {
  const lines: string[] = [];
  lines.push('# Session Timeline', '');

  // Active Files section (C3 fix)
  const activeFiles = extractActiveFilesFromToolCalls(analytics.toolCalls, analytics.projectDir);
  if (activeFiles.length > 0) {
    lines.push('## Active Files', '');
    for (const f of activeFiles) {
      const ops = [...new Set(f.operations)].join(', ');
      const time = f.lastTimestamp.slice(11, 19);
      lines.push(`- ${f.relativePath}  [${ops}]  (last: ${time})`);
    }
    lines.push('');
  }

  // Tool Call Log
  lines.push('## Tool Call Log', '');
  for (const tc of analytics.toolCalls) {
    const time = tc.timestamp.slice(11, 19);
    const status = tc.outcome === 'error' ? ' ERROR' : tc.outcome === 'pending' ? ' PENDING' : '';
    const duration = tc.durationMs != null ? ` (${tc.durationMs}ms)` : '';
    const sidechain = tc.isSidechain ? ' [sidechain]' : '';
    lines.push(`- ${time} ${tc.toolName}${status}${duration}${sidechain}`);
  }
  lines.push('');

  // Error Summary
  if (analytics.errors.length > 0) {
    lines.push('## Errors', '');
    for (const err of analytics.errors) {
      const time = err.timestamp.slice(11, 19);
      lines.push(`- ${time} ${err.toolName ?? 'unknown'}: ${err.message.slice(0, 200)}`);
    }
    lines.push('');
  }

  // Friction Signals
  if (analytics.frictionSignals.length > 0) {
    lines.push('## Friction Signals', '');
    for (const s of analytics.frictionSignals) {
      lines.push(`- ${s.kind}: ${s.detail}`);
    }
    lines.push('');
  }

  // Session Metadata
  lines.push('## Metadata', '');
  lines.push(`- Session ID: ${analytics.sessionId}`);
  lines.push(`- Project: ${analytics.projectDir}`);
  if (analytics.gitBranch) lines.push(`- Branch: ${analytics.gitBranch}`);
  if (analytics.model) lines.push(`- Model: ${analytics.model}`);
  lines.push(`- Duration: ${formatDuration(analytics.durationMs)}`);
  lines.push(`- Turns: ${analytics.userTurns} user / ${analytics.assistantTurns} assistant`);
  lines.push(`- Tool calls: ${analytics.toolCalls.length} (${analytics.errorCount} errors)`);
  lines.push(`- Tokens: ${analytics.tokens.inputTokens} in / ${analytics.tokens.outputTokens} out`);
  if (analytics.isCompacted) lines.push(`- Compactions: ${analytics.compactionCount}`);
  lines.push('');

  return lines.join('\n');
}

function extractActiveFilesFromToolCalls(
  toolCalls: ToolCall[],
  projectDir: string
): ActiveFileEntry[] {
  const fileMap = new Map<string, ActiveFileEntry>();
  const fileTools = new Set(['Read', 'Write', 'Edit']);

  for (const tc of toolCalls) {
    if (!fileTools.has(tc.toolName)) continue;
    const filePath = (tc.input as { file_path?: string }).file_path;
    if (!filePath) continue;

    const existing = fileMap.get(filePath);
    if (existing) {
      existing.operations.push(tc.toolName);
      if (tc.timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = tc.timestamp;
      }
    } else {
      const rel = projectDir ? relative(projectDir, filePath) : filePath;
      fileMap.set(filePath, {
        path: filePath,
        relativePath: rel.startsWith('.') ? rel : rel,
        operations: [tc.toolName],
        lastTimestamp: tc.timestamp,
      });
    }
  }

  return [...fileMap.values()].sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
}
