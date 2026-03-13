import type {
  ToolCall,
  ErrorEvent,
  TokenTotals,
  SessionAnalytics,
  MessageContent,
  TokenUsage,
} from '../types.js';
import { FrictionDetector } from './friction.js';

const COMPACTION_MARKER = 'This session is being continued from a previous conversation';

interface PendingToolUse {
  toolName: string;
  input: Record<string, unknown>;
  timestamp: string;
  isSidechain: boolean;
}

export class AnalyticsAccumulator {
  private sessionId = '';
  private projectDir = '';
  private gitBranch: string | null = null;
  private model: string | null = null;
  private claudeVersion: string | null = null;
  private startTime = '';
  private endTime = '';

  private userTurns = 0;
  private assistantTurns = 0;
  private compactionCount = 0;
  private sidechainEventCount = 0;
  private hookEventCount = 0;
  private hookPreventionCount = 0;

  private toolCalls: ToolCall[] = [];
  private errors: ErrorEvent[] = [];
  private tokens: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  private pendingToolUses = new Map<string, PendingToolUse>();
  private friction = new FrictionDetector();

  ingest(raw: unknown): void {
    const event = raw as Record<string, unknown>;
    if (!event || typeof event !== 'object') return;

    const type = event.type as string | undefined;
    if (!type) return;

    // Skip high-volume noise
    if (
      type === 'progress' ||
      type === 'file-history-snapshot' ||
      type === 'pr-link' ||
      type === 'queue-operation'
    ) {
      return;
    }

    // Extract common metadata from first event
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

    if (event.isSidechain) this.sidechainEventCount++;

    switch (type) {
      case 'assistant':
        this.handleAssistant(event, timestamp ?? '');
        break;
      case 'user':
        this.handleUser(event, timestamp ?? '');
        break;
      case 'system':
        this.handleSystem(event, timestamp ?? '');
        break;
    }
  }

  private handleAssistant(event: Record<string, unknown>, timestamp: string): void {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    if (!this.model && message.model) {
      this.model = message.model as string;
    }

    const usage = message.usage as TokenUsage | undefined;
    if (usage) {
      this.tokens.inputTokens += usage.input_tokens ?? 0;
      this.tokens.outputTokens += usage.output_tokens ?? 0;
      this.tokens.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      this.tokens.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    }

    const content = message.content as MessageContent[] | undefined;
    if (!Array.isArray(content)) return;

    let hasSubstantiveContent = false;
    const isSidechain = !!event.isSidechain;

    for (const block of content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        this.pendingToolUses.set(block.id, {
          toolName: block.name,
          input: block.input ?? {},
          timestamp,
          isSidechain,
        });
        this.friction.onToolUse(block.name, block.input, timestamp);
        hasSubstantiveContent = true;
      } else if (block.type === 'text' && block.text) {
        hasSubstantiveContent = true;
      }
    }

    if (hasSubstantiveContent) this.assistantTurns++;
  }

  private handleUser(event: Record<string, unknown>, timestamp: string): void {
    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return;

    const content = message.content;
    const isSidechain = !!event.isSidechain;

    if (typeof content === 'string') {
      if (content.startsWith(COMPACTION_MARKER)) {
        this.compactionCount++;
      }
      this.friction.onUserMessage(content, timestamp);
      this.userTurns++;
      return;
    }

    if (!Array.isArray(content)) return;

    let hasTextContent = false;
    for (const block of content as MessageContent[]) {
      if (block.type === 'text' && block.text) {
        hasTextContent = true;
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

    if (hasTextContent) this.userTurns++;
  }

  private handleSystem(event: Record<string, unknown>, timestamp: string): void {
    this.hookEventCount++;
    if (event.preventedContinuation) {
      this.hookPreventionCount++;
      const hookInfos = event.hookInfos as Array<{ command: string }> | undefined;
      const detail = hookInfos?.map((h) => h.command).join(', ') ?? 'unknown hook';
      this.friction.onHookPrevention(timestamp, `Hook prevented continuation: ${detail}`);
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
    };
  }
}
