import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow, hookAllowJson } from '../../../hooks/types.js';

const BUFFER_SIZE = 20;
const REPEATED_FAILURE_THRESHOLD = 3;
const RAPID_RETRY_THRESHOLD = 3;

interface ToolEvent {
  toolName: string;
  timestamp: number;
  outcome: 'success' | 'error';
}

const ringBuffer: ToolEvent[] = [];

export function getBuffer(): readonly ToolEvent[] {
  return ringBuffer;
}

export function clearBuffer(): void {
  ringBuffer.length = 0;
}

function pushEvent(event: ToolEvent): void {
  if (ringBuffer.length >= BUFFER_SIZE) {
    ringBuffer.shift();
  }
  ringBuffer.push(event);
}

function extractToolName(parsed: Record<string, unknown>): string {
  return (parsed.tool ?? parsed.name ?? 'unknown') as string;
}

function extractOutcome(parsed: Record<string, unknown>): 'success' | 'error' {
  if (parsed.error || parsed.exitCode === 2) return 'error';
  return 'success';
}

function detectRepeatedFailures(): string | null {
  const failCounts = new Map<string, number>();

  for (const event of ringBuffer) {
    if (event.outcome !== 'error') continue;
    const count = (failCounts.get(event.toolName) ?? 0) + 1;
    failCounts.set(event.toolName, count);
  }

  for (const [tool, count] of failCounts) {
    if (count >= REPEATED_FAILURE_THRESHOLD) {
      return `Tool "${tool}" has failed ${count} times in the last ${ringBuffer.length} calls. Consider a different approach.`;
    }
  }

  return null;
}

function detectRapidRetries(): string | null {
  if (ringBuffer.length < RAPID_RETRY_THRESHOLD) return null;

  const tail = ringBuffer.slice(-RAPID_RETRY_THRESHOLD);
  const sameTool = tail.every((e) => e.toolName === tail[0].toolName);
  if (!sameTool) return null;

  const allErrors = tail.every((e) => e.outcome === 'error');
  if (!allErrors) return null;

  return `"${tail[0].toolName}" has failed ${RAPID_RETRY_THRESHOLD} times consecutively. Stop and reassess your strategy.`;
}

function checkFrictionPatterns(): string | null {
  return detectRapidRetries() ?? detectRepeatedFailures();
}

export const frictionHook: HookHandler = {
  name: 'workflow:friction',
  event: 'pre-tool-use',
  priority: 90,

  enabled(_config: HookConfig): boolean {
    return true;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const toolName = extractToolName(input.parsed);
    const outcome = extractOutcome(input.parsed);

    pushEvent({ toolName, timestamp: Date.now(), outcome });

    const warning = checkFrictionPatterns();
    if (warning) {
      process.stderr.write(`[friction] ${warning}\n`);
      return hookAllowJson(warning);
    }

    return hookAllow();
  },
};
