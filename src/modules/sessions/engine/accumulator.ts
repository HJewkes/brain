import type {
  ToolCall,
  ErrorEvent,
  TokenTotals,
  SessionAnalytics,
  MessageContent,
  TokenUsage,
  PrLink,
} from '../types.js';
import { FrictionDetector } from './friction.js';

const COMPACTION_MARKER = 'This session is being continued from a previous conversation';
const COMPACTION_CLOSING = /The conversation may now continue|Please continue/i;
const TASK_REF_PATTERN = /\b([A-Z]{2,6}-\d{2,3}\.\d{2,3})\b/g;
const GIT_CMD_PATTERN = /\bgit\s/;
const GIT_COMMIT_PATTERN = /\bgit\s+commit\b/;

/** Extract the human-readable summary from a compaction message. Returns null if not a compaction. */
export function extractCompactionSummary(content: string): string | null {
  const markerIndex = content.indexOf(COMPACTION_MARKER);
  if (markerIndex < 0) return null;

  const afterMarker = content.slice(markerIndex + COMPACTION_MARKER.length);
  const lines = afterMarker.split('\n');

  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (lines[i].includes('Here is a summary') || lines[i].includes('ran out of context')) continue;
    startIdx = i;
    break;
  }

  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (COMPACTION_CLOSING.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const summary = lines.slice(startIdx, endIdx).join('\n').trim();
  return summary || null;
}

interface PendingToolUse {
  toolName: string;
  input: Record<string, unknown>;
  timestamp: string;
  isSidechain: boolean;
  byteOffset?: number;
}

export class AnalyticsAccumulator {
  private sessionId = '';
  private projectDir = '';
  private gitBranch: string | null = null;
  private model: string | null = null;
  private claudeVersion: string | null = null;
  private startTime = '';
  private endTime = '';
  private slug: string | null = null;

  private userTurns = 0;
  private assistantTurns = 0;
  private compactionCount = 0;
  private compactionTimestamps: string[] = [];
  private compactionSummaries: string[] = [];
  private compactionByteOffsets: number[] = [];
  private tokenSnapshots: Array<{ timestamp: string; cumulativeInput: number; cumulativeOutput: number }> = [];
  private assistantTexts: string[] = [];
  private userTexts: string[] = [];
  private logicalParentUuid: string | null = null;
  private sidechainEventCount = 0;
  private hookEventCount = 0;
  private hookPreventionCount = 0;
  private thinkingBlockCount = 0;
  private planPresent = false;
  private permissionMode: string | null = null;
  private serviceTier: string | null = null;
  private gitCommandCount = 0;
  private commitCount = 0;
  private subagentCount = 0;

  private toolCalls: ToolCall[] = [];
  private errors: ErrorEvent[] = [];
  private tokens: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  private modelCounts = new Map<string, number>();
  private pendingToolUses = new Map<string, PendingToolUse>();
  private filesTouched = new Map<string, Set<string>>();
  private prLinks: PrLink[] = [];
  private taskRefs = new Set<string>();
  private skillUsage = new Map<string, number>();
  private friction = new FrictionDetector();

  ingest(raw: unknown, byteOffset?: number): void {
    const event = raw as Record<string, unknown>;
    if (!event || typeof event !== 'object') return;

    const type = event.type as string | undefined;
    if (!type) return;

    // Extract common metadata from any event
    const timestamp = event.timestamp as string | undefined;
    if (timestamp) {
      if (!this.startTime || timestamp < this.startTime) this.startTime = timestamp;
      if (!this.endTime || timestamp > this.endTime) this.endTime = timestamp;
    }

    if (!this.sessionId && event.sessionId) {
      this.sessionId = event.sessionId as string;
    }
    if (!this.projectDir && event.cwd) {
      this.projectDir = event.cwd as string;
    }
    if (!this.gitBranch && event.gitBranch) {
      this.gitBranch = event.gitBranch as string;
    }
    if (!this.claudeVersion && event.version) {
      this.claudeVersion = event.version as string;
    }
    if (!this.slug && event.slug) {
      this.slug = event.slug as string;
    }

    if (event.isSidechain) this.sidechainEventCount++;

    switch (type) {
      case 'assistant':
        this.handleAssistant(event, timestamp ?? '', byteOffset);
        break;
      case 'user':
        this.handleUser(event, timestamp ?? '', byteOffset);
        break;
      case 'system':
        this.handleSystem(event, timestamp ?? '');
        break;
      case 'pr-link':
        this.handlePrLink(event, timestamp ?? '');
        break;
      case 'file-history-snapshot':
        // Count snapshots but don't extract content
        break;
      case 'queue-operation':
        // No useful signals tracked currently
        break;
      case 'progress':
        // Skip high-volume agent_progress; hook_progress has low signal for ingestion
        break;
    }
  }

  private handleAssistant(
    event: Record<string, unknown>,
    timestamp: string,
    byteOffset?: number
  ): void {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    const model = message.model as string | undefined;
    if (model) {
      if (!this.model) this.model = model;
      this.modelCounts.set(model, (this.modelCounts.get(model) ?? 0) + 1);
    }

    const usage = message.usage as (TokenUsage & Record<string, unknown>) | undefined;
    if (usage) {
      this.tokens.inputTokens += usage.input_tokens ?? 0;
      this.tokens.outputTokens += usage.output_tokens ?? 0;
      this.tokens.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      this.tokens.cacheReadTokens += usage.cache_read_input_tokens ?? 0;

      if (!this.serviceTier && usage.service_tier) {
        this.serviceTier = usage.service_tier as string;
      }
      // Record token snapshot for context window chart
      this.tokenSnapshots.push({
        timestamp,
        cumulativeInput: this.tokens.inputTokens,
        cumulativeOutput: this.tokens.outputTokens,
      });
    }

    const content = message.content as MessageContent[] | undefined;
    if (!Array.isArray(content)) return;

    let hasSubstantiveContent = false;
    let assistantText = '';
    const isSidechain = !!event.isSidechain;

    for (const block of content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        this.pendingToolUses.set(block.id, {
          toolName: block.name,
          input: block.input ?? {},
          timestamp,
          isSidechain,
          byteOffset,
        });
        this.friction.onToolUse(block.name, block.input, timestamp);
        this.trackToolInput(block.name, block.input ?? {});
        hasSubstantiveContent = true;
      } else if (block.type === 'text' && block.text) {
        hasSubstantiveContent = true;
        assistantText += block.text;
      } else if (block.type === 'thinking') {
        this.thinkingBlockCount++;
      }
    }
    if (assistantText) {
      this.assistantTexts.push(assistantText.slice(0, 2000));
    }

    if (hasSubstantiveContent) this.assistantTurns++;
  }

  private trackToolInput(toolName: string, input: Record<string, unknown>): void {
    // Track file paths touched
    const filePath = (input.file_path as string | undefined) ?? (input.path as string | undefined);
    if (filePath) {
      const ops = this.filesTouched.get(filePath) ?? new Set<string>();
      ops.add(toolName);
      this.filesTouched.set(filePath, ops);
    }

    // Track skill usage
    if (toolName === 'Skill' && input.skill) {
      const skillName = input.skill as string;
      this.skillUsage.set(skillName, (this.skillUsage.get(skillName) ?? 0) + 1);
    }

    // Count agent delegations
    if (toolName === 'Task' || toolName === 'TaskCreate') {
      this.subagentCount++;
    }

    // Count git commands and commits
    if (toolName === 'Bash' && input.command) {
      const cmd = input.command as string;
      if (GIT_CMD_PATTERN.test(cmd)) this.gitCommandCount++;
      if (GIT_COMMIT_PATTERN.test(cmd)) this.commitCount++;
    }
  }

  private handleUser(event: Record<string, unknown>, timestamp: string, byteOffset?: number): void {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    const content = message.content;
    const isSidechain = !!event.isSidechain;

    // Capture plan content and permission mode from top-level event fields
    if (event.planContent && !this.planPresent) {
      this.planPresent = true;
    }
    if (event.permissionMode && !this.permissionMode) {
      this.permissionMode = event.permissionMode as string;
    }

    if (typeof content === 'string') {
      if (content.startsWith(COMPACTION_MARKER)) {
        this.compactionCount++;
        this.compactionTimestamps.push(timestamp);
        if (byteOffset !== undefined) this.compactionByteOffsets.push(byteOffset);
        const summary = extractCompactionSummary(content);
        if (summary) this.compactionSummaries.push(summary);
      }
      this.extractTaskRefs(content);
      this.friction.onUserMessage(content, timestamp);
      this.userTurns++;
      this.userTexts.push(content.slice(0, 2000));
      return;
    }

    if (!Array.isArray(content)) return;

    let hasTextContent = false;
    let userText = '';
    for (const block of content as MessageContent[]) {
      if (block.type === 'text' && block.text) {
        hasTextContent = true;
        userText += block.text;
        if (block.text.startsWith(COMPACTION_MARKER)) {
          this.compactionCount++;
          this.compactionTimestamps.push(timestamp);
          if (byteOffset !== undefined) this.compactionByteOffsets.push(byteOffset);
          const summary = extractCompactionSummary(block.text);
          if (summary) this.compactionSummaries.push(summary);
        }
        this.extractTaskRefs(block.text);
        this.friction.onUserMessage(block.text, timestamp);
      }

      if (block.type === 'tool_result' && block.tool_use_id) {
        const pending = this.pendingToolUses.get(block.tool_use_id);
        if (pending) {
          this.pendingToolUses.delete(block.tool_use_id);

          const isError = !!block.is_error;
          const toolCall: ToolCall = {
            toolUseId: block.tool_use_id,
            toolName: pending.toolName,
            input: pending.input,
            timestamp: pending.timestamp,
            outcome: isError ? 'error' : 'success',
            durationMs: this.computeDuration(pending.timestamp, timestamp),
            isSidechain: pending.isSidechain,
            byteOffset: pending.byteOffset,
          };

          if (isError) {
            const errorMsg = this.extractErrorMessage(block);
            toolCall.errorMessage = errorMsg;
            this.errors.push({
              timestamp,
              toolName: pending.toolName,
              toolUseId: block.tool_use_id,
              message: errorMsg,
              isSidechain,
            });
          }

          this.toolCalls.push(toolCall);
          this.friction.onToolResult(isError, timestamp, pending.toolName);
        }
      }
    }

    if (hasTextContent) {
      this.userTurns++;
      if (userText) this.userTexts.push(userText.slice(0, 2000));
    }
  }

  private handleSystem(event: Record<string, unknown>, timestamp: string): void {
    this.hookEventCount++;
    if (event.preventedContinuation) {
      this.hookPreventionCount++;
      const hookInfos = event.hookInfos as Array<{ command: string }> | undefined;
      const detail = hookInfos?.map((h) => h.command).join(', ') ?? 'unknown hook';
      this.friction.onHookPrevention(timestamp, `Hook prevented continuation: ${detail}`);
    }

    const subtype = event.subtype as string | undefined;
    if (subtype === 'compact_boundary') {
      this.compactionCount++;
      this.compactionTimestamps.push(timestamp);
      const meta = event.compactMetadata as Record<string, unknown> | undefined;
      if (meta?.logicalParentUuid && !this.logicalParentUuid) {
        this.logicalParentUuid = meta.logicalParentUuid as string;
      }
    }

    if (event.logicalParentUuid && !this.logicalParentUuid) {
      this.logicalParentUuid = event.logicalParentUuid as string;
    }
  }

  private handlePrLink(event: Record<string, unknown>, timestamp: string): void {
    if (event.prNumber != null && event.prUrl) {
      this.prLinks.push({
        number: event.prNumber as number,
        url: event.prUrl as string,
        repo: (event.prRepository as string | undefined) ?? '',
        timestamp,
      });
    }
  }

  private extractTaskRefs(text: string): void {
    TASK_REF_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TASK_REF_PATTERN.exec(text)) !== null) {
      this.taskRefs.add(match[1]);
    }
  }

  private computeDuration(start: string, end: string): number | undefined {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (isNaN(s) || isNaN(e)) return undefined;
    return e - s;
  }

  private extractErrorMessage(block: MessageContent): string {
    if (typeof block.content === 'string') return block.content.slice(0, 500);
    if (Array.isArray(block.content)) {
      const textBlock = block.content.find((b) => b.type === 'text' && b.text);
      if (textBlock?.text) return textBlock.text.slice(0, 500);
    }
    return 'Unknown error';
  }

  finalize(): SessionAnalytics {
    // Emit pending tool uses as outcome:'pending'
    for (const [id, pending] of this.pendingToolUses) {
      this.toolCalls.push({
        toolUseId: id,
        toolName: pending.toolName,
        input: pending.input,
        timestamp: pending.timestamp,
        outcome: 'pending',
        isSidechain: pending.isSidechain,
        byteOffset: pending.byteOffset,
      });
    }
    this.pendingToolUses.clear();

    const toolCallsByName: Record<string, number> = {};
    for (const tc of this.toolCalls) {
      toolCallsByName[tc.toolName] = (toolCallsByName[tc.toolName] ?? 0) + 1;
    }

    const durationMs =
      this.startTime && this.endTime
        ? new Date(this.endTime).getTime() - new Date(this.startTime).getTime()
        : 0;

    // Build files-written list (Write and Edit targets)
    const filesWritten: string[] = [];
    for (const [path, ops] of this.filesTouched) {
      if (ops.has('Write') || ops.has('Edit')) {
        filesWritten.push(path);
      }
    }

    return {
      sessionId: this.sessionId,
      projectDir: this.projectDir,
      gitBranch: this.gitBranch,
      model: this.model,
      claudeVersion: this.claudeVersion,
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs,
      userTurns: this.userTurns,
      assistantTurns: this.assistantTurns,
      isCompacted: this.compactionCount > 0,
      compactionCount: this.compactionCount,
      sidechainEventCount: this.sidechainEventCount,
      toolCalls: this.toolCalls,
      toolCallsByName,
      uniqueToolsUsed: [...new Set(this.toolCalls.map((t) => t.toolName))],
      errors: this.errors,
      errorCount: this.errors.length,
      errorRate: this.toolCalls.length > 0 ? this.errors.length / this.toolCalls.length : 0,
      tokens: this.tokens,
      frictionSignals: this.friction.flush(),
      hookEventCount: this.hookEventCount,
      hookPreventionCount: this.hookPreventionCount,
      capturedViaHooks: false,
      capturedViaJsonl: true,

      // Extended signals
      slug: this.slug,
      prLinks: this.prLinks,
      filesTouched: this.filesTouched,
      filesWritten,
      modelCounts: this.modelCounts,
      taskRefs: [...this.taskRefs],
      compactionTimestamps: this.compactionTimestamps,
      compactionSummaries: this.compactionSummaries,
      compactionByteOffsets: this.compactionByteOffsets,
      tokenSnapshots: this.tokenSnapshots,
      assistantTexts: this.assistantTexts,
      userTexts: this.userTexts,
      logicalParentUuid: this.logicalParentUuid,
      thinkingBlockCount: this.thinkingBlockCount,
      skillUsage: this.skillUsage,
      planPresent: this.planPresent,
      permissionMode: this.permissionMode,
      serviceTier: this.serviceTier,
      gitCommandCount: this.gitCommandCount,
      commitCount: this.commitCount,
      subagentCount: this.subagentCount,
    };
  }
}
