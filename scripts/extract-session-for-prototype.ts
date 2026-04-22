#!/usr/bin/env tsx
/**
 * Extract structured session data from a Claude JSONL file for HTML prototype consumption.
 * Usage: npx tsx scripts/extract-session-for-prototype.ts <jsonl-path> <output-path>
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const TASK_REF_RE = /\b([A-Z]{2,6}-\d{1,3}\.\d{1,3})\b/g;
const MAX_USER_MSG = 500;
const MAX_CMD = 100;
const MAX_AGENT_PROMPT = 80;
const MAX_ERROR = 200;
const MAX_COMPACTION_SUMMARY = 1000;
const MAX_SUBAGENT_TOOL_CALLS = 30;
const MAX_SUBAGENT_PROMPT = 300;
const MAX_SUBAGENT_USER_MSGS = 3;
// Shorten file paths for subagent tool calls to save space
const PATH_PREFIX_RE = /\/Users\/[^/]+\/Documents\/projects\/brain\//g;

interface RawEvent {
  type: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  toolUseResult?: { status?: string };
  gitBranch?: string;
  sessionId?: string;
  // progress event fields
  data?: {
    type?: string;
    agentId?: string;
  };
  toolUseID?: string;
  parentToolUseID?: string;
  agentId?: string;
}

interface ToolCall {
  timestamp: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, string>;
  outcome: 'success' | 'error' | 'pending';
  durationMs: number | null;
  errorMessage: string | null;
  agentId?: string;
}

interface UserMessage {
  timestamp: string;
  content: string;
}

interface Compaction {
  timestamp: string;
  summary: string;
  lineNumber: number;
}

interface TokenTimelineEntry {
  timestamp: string;
  cumulativeInput: number;
  cumulativeOutput: number;
  cacheRead: number;
  cacheWrite: number;
  messageInput: number;
  messageOutput: number;
  isCompaction: boolean;
  isUser: boolean;
}

interface AssistantMessage {
  timestamp: string;
  content: string;
  toolCalls: number;
}

interface SubagentToolCall {
  timestamp: string;
  toolName: string;
  input: Record<string, string>;
  outcome: 'success' | 'error' | 'pending';
  durationMs: number | null;
  errorMessage: string | null;
}

interface SubagentSummary {
  agentId: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  model: string;
  toolCallCount: number;
  errors: number;
  tokensIn: number;
  tokensOut: number;
  prompt: string;
  toolBreakdown: Record<string, number>;
  userMessages: UserMessage[];
  toolCalls: SubagentToolCall[];
}

const MAX_ASSISTANT_CONTENT = 2000;

function extractKeyInput(name: string, input: Record<string, unknown>): Record<string, string> {
  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    return { file_path: String(input.file_path ?? '') };
  }
  if (name === 'Bash') {
    return { command: String(input.command ?? '').slice(0, MAX_CMD) };
  }
  if (name === 'Grep') {
    return { pattern: String(input.pattern ?? '') };
  }
  if (name === 'Glob') {
    return { pattern: String(input.pattern ?? '') };
  }
  if (name === 'Agent') {
    return { prompt: String(input.prompt ?? '').slice(0, MAX_AGENT_PROMPT) };
  }
  return {};
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === 'text') return String(b.text ?? '');
    }
  }
  return '';
}

function extractToolResults(content: unknown): Map<string, { isError: boolean; text: string; timestamp: string }> {
  const results = new Map<string, { isError: boolean; text: string; timestamp: string }>();
  if (!Array.isArray(content)) return results;
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const rawContent = b.content;
        const text = typeof rawContent === 'string' ? rawContent : extractTextContent(rawContent);
        results.set(b.tool_use_id, {
          isError: Boolean(b.is_error),
          text,
          timestamp: '',
        });
      }
    }
  }
  return results;
}

function extractCompactionSummary(text: string): string | null {
  const marker = 'This session is being continued from a previous conversation';
  if (!text.includes(marker)) return null;
  const start = text.indexOf('Summary:');
  const end = text.indexOf('The conversation may now continue');
  if (start === -1) return text.slice(text.indexOf(marker)).slice(0, MAX_COMPACTION_SUMMARY);
  const raw = end !== -1 ? text.slice(start, end) : text.slice(start);
  return raw.trim().slice(0, MAX_COMPACTION_SUMMARY);
}

function extractAssistantText(content: unknown[]): string {
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
    }
  }
  return '';
}

function collectTaskRefs(str: string, refs: Set<string>): void {
  for (const match of str.matchAll(TASK_REF_RE)) {
    refs.add(match[1]);
  }
}

function toolCatName(name: string): string {
  const n = (name || '').toLowerCase();
  if (n === 'read' || n === 'grep' || n === 'glob') return 'Read';
  if (n === 'write' || n === 'multiedit') return 'Write';
  if (n === 'edit') return 'Edit';
  if (n === 'bash') return 'Bash';
  if (n === 'agent' || n === 'task') return 'Agent';
  return 'Other';
}

async function parseSubagentJsonl(jsonlPath: string): Promise<SubagentSummary | null> {
  if (!existsSync(jsonlPath)) return null;

  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });

  let agentId = '';
  let startedAt = '';
  let endedAt = '';
  let model = '';

  const userMessages: UserMessage[] = [];
  const allToolCalls: (SubagentToolCall & { callTimestamp: string; toolUseId: string })[] = [];
  const pendingToolCalls = new Map<string, SubagentToolCall & { callTimestamp: string; toolUseId: string }>();
  const toolBreakdown: Record<string, number> = {};
  let errors = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  // Extract agentId from filename
  const fname = jsonlPath.split('/').pop() ?? '';
  const m = fname.match(/agent-([a-f0-9]+)\.jsonl/);
  if (m) agentId = m[1];

  for await (const line of rl) {
    let obj: RawEvent;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp ?? '';
    if (!startedAt && ts) startedAt = ts;
    if (ts) endedAt = ts;

    // Subagent files have isSidechain=true; skip non-sidechain events
    if (!obj.isSidechain) continue;

    if (obj.type === 'user') {
      const content = obj.message?.content;
      const text = extractTextContent(content);

      if (text && !text.startsWith('<task-notification>') && !text.startsWith('[Request interrupted')) {
        if (userMessages.length < MAX_SUBAGENT_USER_MSGS) {
          userMessages.push({ timestamp: ts, content: text.slice(0, MAX_USER_MSG) });
        }
      }

      const toolResults = extractToolResults(content);
      for (const [toolUseId, result] of toolResults) {
        const pending = pendingToolCalls.get(toolUseId);
        if (pending) {
          const callMs = new Date(pending.callTimestamp).getTime();
          const resultMs = new Date(ts).getTime();
          pending.outcome = result.isError ? 'error' : 'success';
          pending.durationMs = resultMs > callMs ? resultMs - callMs : null;
          if (result.isError) {
            pending.errorMessage = result.text.slice(0, MAX_ERROR);
            errors++;
          }
          pendingToolCalls.delete(toolUseId);
          allToolCalls.push(pending);
          const cat = toolCatName(pending.toolName);
          toolBreakdown[cat] = (toolBreakdown[cat] ?? 0) + 1;
        }
      }
    }

    if (obj.type === 'assistant') {
      const msg = obj.message;
      if (!model && msg?.model) model = msg.model;

      const usage = msg?.usage;
      if (usage) {
        tokensIn += (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        tokensOut += usage.output_tokens ?? 0;
      }

      const content = msg?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b.type !== 'tool_use') continue;

        const toolName = String(b.name ?? '');
        const toolUseId = String(b.id ?? '');
        const rawInput = (b.input ?? {}) as Record<string, unknown>;
        const keyInput = extractKeyInput(toolName, rawInput);

        const tc: SubagentToolCall & { callTimestamp: string; toolUseId: string } = {
          timestamp: ts,
          callTimestamp: ts,
          toolUseId,
          toolName,
          input: keyInput,
          outcome: 'pending',
          durationMs: null,
          errorMessage: null,
        };
        pendingToolCalls.set(toolUseId, tc);
      }
    }
  }

  // Flush still-pending
  for (const pending of pendingToolCalls.values()) {
    pending.outcome = 'pending';
    allToolCalls.push(pending);
    const cat = toolCatName(pending.toolName);
    toolBreakdown[cat] = (toolBreakdown[cat] ?? 0) + 1;
  }

  const durationMs = startedAt && endedAt
    ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
    : 0;

  const prompt = (userMessages[0]?.content ?? '').replace(PATH_PREFIX_RE, '').slice(0, MAX_SUBAGENT_PROMPT);

  // Select tool calls: all errors + first/last subset (deduplicated, capped at MAX)
  const half = Math.floor((MAX_SUBAGENT_TOOL_CALLS - 0) / 2);
  const errorCalls = allToolCalls.filter(tc => tc.outcome === 'error');
  const nonErrorCalls = allToolCalls.filter(tc => tc.outcome !== 'error');
  let selectedCalls: typeof allToolCalls;
  if (allToolCalls.length <= MAX_SUBAGENT_TOOL_CALLS) {
    selectedCalls = allToolCalls;
  } else {
    const head = nonErrorCalls.slice(0, half);
    const tail = nonErrorCalls.slice(-half);
    const seen = new Set<string>();
    selectedCalls = [];
    for (const tc of [...errorCalls, ...head, ...tail]) {
      if (!seen.has(tc.toolUseId)) {
        seen.add(tc.toolUseId);
        selectedCalls.push(tc);
      }
    }
    selectedCalls.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // Strip project path prefix and use short HH:MM timestamps to save space
  const toolCallList: SubagentToolCall[] = selectedCalls.map(({ callTimestamp: _, toolUseId: __, ...rest }) => {
    const fp = rest.input.file_path;
    if (fp) rest.input = { ...rest.input, file_path: fp.replace(PATH_PREFIX_RE, '') };
    const ts = rest.timestamp;
    rest.timestamp = ts ? ts.slice(11, 16) : ts; // "HH:MM" only
    return rest;
  });

  return {
    agentId,
    startedAt: startedAt.slice(0, 16), // "YYYY-MM-DDTHH:MM"
    endedAt: endedAt.slice(0, 16),
    durationMinutes: Math.round(durationMs / 60000),
    model: model.replace('claude-', '').replace('-latest', ''), // shorten model name
    toolCallCount: allToolCalls.length,
    errors,
    tokensIn,
    tokensOut,
    prompt,
    toolBreakdown,
    userMessages: userMessages.slice(0, MAX_SUBAGENT_USER_MSGS).map(m => ({
      timestamp: m.timestamp.slice(11, 16),
      content: m.content.slice(0, 200).replace(PATH_PREFIX_RE, ''),
    })),
    // Only include tool call list for agents with enough calls to be interesting
    toolCalls: allToolCalls.length >= 3 ? toolCallList : [],
  };
}

async function parseJsonl(jsonlPath: string) {
  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });

  let sessionId = '';
  let startedAt = '';
  let endedAt = '';
  let branch = '';
  let model = '';
  let lineNumber = 0;

  const userMessages: UserMessage[] = [];
  const toolCalls: (ToolCall & { callTimestamp: string })[] = [];
  const compactions: Compaction[] = [];
  const tokenTimeline: TokenTimelineEntry[] = [];
  const assistantMessages: AssistantMessage[] = [];
  const pendingToolCalls = new Map<string, ToolCall & { callTimestamp: string }>();
  const filesTouched: Record<string, Set<string>> = {};
  const taskRefs = new Set<string>();
  const totals = { toolCalls: 0, errors: 0, userTurns: 0, assistantTurns: 0, tokensIn: 0, tokensOut: 0 };
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  // Map from Agent tool_use id -> agentId (extracted from progress events)
  const agentToolIdMap = new Map<string, string>();

  for await (const line of rl) {
    lineNumber++;
    let obj: RawEvent;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp ?? '';
    if (!startedAt && ts) startedAt = ts;
    if (ts) endedAt = ts;

    if (!sessionId && obj.sessionId) sessionId = obj.sessionId;
    if (!branch && obj.gitBranch) branch = obj.gitBranch;

    // Extract agentId mapping from progress events
    if (obj.type === 'progress' && !obj.isSidechain && obj.data?.agentId && obj.parentToolUseID) {
      agentToolIdMap.set(obj.parentToolUseID, obj.data.agentId);
    }

    if (obj.type === 'user' && !obj.isSidechain) {
      const content = obj.message?.content;
      const text = extractTextContent(content);

      if (text && !text.startsWith('<task-notification>') && !text.startsWith('[Request interrupted')) {
        const compactionSummary = extractCompactionSummary(text);
        const isCompaction = compactionSummary !== null;
        if (isCompaction) {
          compactions.push({ timestamp: ts, summary: compactionSummary!, lineNumber });
        } else {
          userMessages.push({ timestamp: ts, content: text.slice(0, MAX_USER_MSG) });
          collectTaskRefs(text, taskRefs);
        }
        tokenTimeline.push({
          timestamp: ts,
          cumulativeInput,
          cumulativeOutput,
          cacheRead: 0,
          cacheWrite: 0,
          messageInput: 0,
          messageOutput: 0,
          isCompaction,
          isUser: true,
        });
        totals.userTurns++;
      }

      const toolResults = extractToolResults(content);
      for (const [toolUseId, result] of toolResults) {
        const pending = pendingToolCalls.get(toolUseId);
        if (pending) {
          const callMs = new Date(pending.callTimestamp).getTime();
          const resultMs = new Date(ts).getTime();
          pending.outcome = result.isError ? 'error' : 'success';
          pending.durationMs = resultMs > callMs ? resultMs - callMs : null;
          if (result.isError) {
            pending.errorMessage = result.text.slice(0, MAX_ERROR);
            totals.errors++;
          }
          pendingToolCalls.delete(toolUseId);
          toolCalls.push(pending);
          totals.toolCalls++;
        }
      }
    }

    if (obj.type === 'assistant' && !obj.isSidechain) {
      totals.assistantTurns++;
      const msg = obj.message;
      if (!model && msg?.model) model = msg.model;

      const usage = msg?.usage;
      const msgInput = usage?.input_tokens ?? 0;
      const msgOutput = usage?.output_tokens ?? 0;
      const cacheRead = usage?.cache_read_input_tokens ?? 0;
      const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
      if (usage) {
        totals.tokensIn += msgInput + cacheRead + cacheWrite;
        totals.tokensOut += msgOutput;
        cumulativeInput += msgInput + cacheRead + cacheWrite;
        cumulativeOutput += msgOutput;
        tokenTimeline.push({
          timestamp: ts,
          cumulativeInput,
          cumulativeOutput,
          cacheRead,
          cacheWrite,
          messageInput: msgInput,
          messageOutput: msgOutput,
          isCompaction: false,
          isUser: false,
        });
      }

      const content = msg?.content;
      if (!Array.isArray(content)) continue;

      const textContent = extractAssistantText(content);
      const toolCallCount = content.filter(
        (b): b is Record<string, unknown> => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_use'
      ).length;
      if (textContent) {
        assistantMessages.push({
          timestamp: ts,
          content: textContent.slice(0, MAX_ASSISTANT_CONTENT),
          toolCalls: toolCallCount,
        });
      }

      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b.type !== 'tool_use') continue;

        const toolName = String(b.name ?? '');
        const toolUseId = String(b.id ?? '');
        const rawInput = (b.input ?? {}) as Record<string, unknown>;
        const keyInput = extractKeyInput(toolName, rawInput);

        // Track files touched
        const fp = rawInput.file_path as string | undefined;
        if (fp && typeof fp === 'string') {
          if (!filesTouched[fp]) filesTouched[fp] = new Set();
          filesTouched[fp].add(toolName);
        }

        // Collect task refs from inputs
        collectTaskRefs(JSON.stringify(rawInput), taskRefs);

        const tc: ToolCall & { callTimestamp: string } = {
          timestamp: ts,
          callTimestamp: ts,
          toolName,
          toolUseId,
          input: keyInput,
          outcome: 'pending',
          durationMs: null,
          errorMessage: null,
        };
        pendingToolCalls.set(toolUseId, tc);
      }
    }
  }

  // Any still-pending calls didn't get results (likely session ended)
  for (const pending of pendingToolCalls.values()) {
    pending.outcome = 'pending';
    toolCalls.push(pending);
    totals.toolCalls++;
  }

  // Attach agentId to Agent tool calls using the progress event mapping
  for (const tc of toolCalls) {
    if ((tc.toolName === 'Agent' || tc.toolName === 'Task') && agentToolIdMap.has(tc.toolUseId)) {
      tc.agentId = agentToolIdMap.get(tc.toolUseId);
    }
  }

  const durationMs = startedAt && endedAt
    ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
    : 0;

  const filesTouchedFinal: Record<string, string[]> = {};
  for (const [fp, ops] of Object.entries(filesTouched)) {
    filesTouchedFinal[fp] = Array.from(ops);
  }

  return {
    sessionId,
    startedAt,
    endedAt,
    durationMinutes: Math.round(durationMs / 60000),
    branch,
    model,
    userMessages,
    toolCalls: toolCalls.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(({ callTimestamp: _, ...rest }) => rest),
    compactions,
    totals,
    filesTouched: filesTouchedFinal,
    taskRefs: Array.from(taskRefs).sort(),
    tokenTimeline: tokenTimeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    assistantMessages,
  };
}

async function loadSubagents(jsonlPath: string): Promise<Record<string, SubagentSummary>> {
  // Subagents live in <parent-session-dir>/subagents/agent-<id>.jsonl
  const parentDir = jsonlPath.replace(/\.jsonl$/, '');
  const subagentsDir = join(parentDir, 'subagents');

  if (!existsSync(subagentsDir)) return {};

  const files = readdirSync(subagentsDir).filter(f => f.match(/^agent-[a-f0-9]+\.jsonl$/));
  console.log(`Found ${files.length} subagent JSONL files`);

  const result: Record<string, SubagentSummary> = {};
  let processed = 0;

  for (const file of files) {
    const fullPath = join(subagentsDir, file);
    const summary = await parseSubagentJsonl(fullPath);
    if (summary && summary.agentId) {
      result[summary.agentId] = summary;
    }
    processed++;
    if (processed % 20 === 0) {
      process.stdout.write(`  Processed ${processed}/${files.length} subagents...\r`);
    }
  }

  process.stdout.write('\n');
  return result;
}

async function main() {
  const [, , jsonlPath, outputPath] = process.argv;
  if (!jsonlPath || !outputPath) {
    console.error('Usage: npx tsx scripts/extract-session-for-prototype.ts <jsonl-path> <output-path>');
    process.exit(1);
  }

  // Expand ~ in paths
  const expandedJsonlPath = jsonlPath.startsWith('~/') ? join(homedir(), jsonlPath.slice(2)) : jsonlPath;

  console.log(`Parsing ${expandedJsonlPath}...`);
  const data = await parseJsonl(expandedJsonlPath);

  console.log(`Parsed: ${data.totals.toolCalls} tool calls, ${data.userMessages.length} user messages, ${data.compactions.length} compactions`);

  console.log('Loading subagent data...');
  const subagents = await loadSubagents(expandedJsonlPath);
  const subagentCount = Object.keys(subagents).length;
  console.log(`Loaded ${subagentCount} subagents`);

  const { tokenTimeline: tt, assistantMessages: am, toolCalls: tc, ...rest } = data;
  // Columnar encoding for token timeline — saves ~50% vs row-per-object JSON
  const ttCols = {
    fields: ['timestamp','cumulativeInput','cumulativeOutput','cacheRead','cacheWrite','messageInput','messageOutput','isCompaction','isUser'] as const,
    rows: tt.map(e => [e.timestamp,e.cumulativeInput,e.cumulativeOutput,e.cacheRead,e.cacheWrite,e.messageInput,e.messageOutput,e.isCompaction,e.isUser]),
  };
  // Strip toolUseId and sparse-encode optional fields to reduce size
  const tcCompact = tc.map(({ toolUseId: _id, errorMessage, durationMs, agentId, ...t }) => ({
    ...t,
    ...(durationMs !== null ? { durationMs } : {}),
    ...(errorMessage !== null ? { errorMessage } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
  }));
  const compactArrays = [
    `"toolCalls":${JSON.stringify(tcCompact)}`,
    `"tokenTimeline":${JSON.stringify(ttCols)}`,
    `"assistantMessages":${JSON.stringify(am)}`,
    `"subagents":${JSON.stringify(subagents)}`,
  ].join(',');
  const js = `window.SESSION_DATA = ${JSON.stringify(rest, null, 2).replace(/\}$/, `,${compactArrays}}`)};\n`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, js, 'utf-8');

  const sizeKb = Math.round(Buffer.byteLength(js) / 1024);
  console.log(`Wrote ${outputPath} (${sizeKb} KB)`);

  if (sizeKb > 1000) {
    console.warn(`WARNING: Output exceeds 1MB budget (${sizeKb}KB). Consider reducing subagent data.`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
