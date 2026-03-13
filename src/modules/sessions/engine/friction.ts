import { createHash } from 'node:crypto';
import type { FrictionSignal } from '../types.js';

const CORRECTION_PATTERNS = [
  /\bno[,.]\s/i,
  /\bdon't\b/i,
  /\bstop\b/i,
  /\bwait\b/i,
  /\bactually\b/i,
  /\bthat's wrong\b/i,
  /\brevert\b/i,
  /\bundo\b/i,
];

function hashInput(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input ?? {}))
    .digest('hex');
}

export class FrictionDetector {
  private signals: FrictionSignal[] = [];
  private lastTool: { toolName: string; inputHash: string; count: number } | null = null;
  private consecutiveErrorCount = 0;

  onToolUse(toolName: string, input: unknown, timestamp: string): void {
    const h = hashInput(input);
    if (this.lastTool?.toolName === toolName && this.lastTool.inputHash === h) {
      this.lastTool.count++;
      if (this.lastTool.count === 2) {
        this.signals.push({
          kind: 'consecutive_identical_tool',
          timestamp,
          detail: `${toolName} called ${this.lastTool.count}+ times with identical input`,
          toolName,
          count: this.lastTool.count,
        });
      }
    } else {
      this.lastTool = { toolName, inputHash: h, count: 1 };
    }
  }

  onToolResult(isError: boolean, timestamp: string, toolName?: string): void {
    if (isError) {
      this.consecutiveErrorCount++;
      if (this.consecutiveErrorCount === 3) {
        this.signals.push({
          kind: 'error_loop',
          timestamp,
          detail: `${this.consecutiveErrorCount} consecutive tool errors`,
          toolName,
          count: this.consecutiveErrorCount,
        });
      }
    } else {
      this.consecutiveErrorCount = 0;
    }
  }

  onUserMessage(text: string, timestamp: string): void {
    for (const pattern of CORRECTION_PATTERNS) {
      if (pattern.test(text)) {
        this.signals.push({
          kind: 'user_correction',
          timestamp,
          detail: `User correction detected: "${text.slice(0, 80)}"`,
        });
        return;
      }
    }
  }

  onHookPrevention(timestamp: string, detail: string): void {
    this.signals.push({
      kind: 'hook_prevention',
      timestamp,
      detail,
    });
  }

  flush(): FrictionSignal[] {
    return [...this.signals];
  }
}
