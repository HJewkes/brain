import { createHash } from 'node:crypto';

export type StructuralEventType =
  | 'file_touch'
  | 'git_op'
  | 'error'
  | 'decision'
  | 'search'
  | 'edit';

export interface StructuralEvent {
  id: string;
  sessionId: string;
  eventType: StructuralEventType;
  detail: string;
  filePath?: string;
  timestamp: string;
}

export function hashEvent(eventType: string, detail: string): string {
  return createHash('sha256').update(`${eventType}:${detail}`).digest('hex');
}

export function extractStructuralEvents(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  sessionId: string,
  timestamp: string
): StructuralEvent[] {
  const events: StructuralEvent[] = [];
  const lower = toolName.toLowerCase();

  if (isFileToolCall(lower)) {
    const event = buildFileEvent(lower, toolInput, sessionId, timestamp);
    if (event) events.push(event);
  }

  if (lower === 'bash' || lower === 'execute') {
    const cmd = String(toolInput.command ?? toolInput.cmd ?? '');
    extractBashEvents(cmd, toolOutput, sessionId, timestamp, events);
  }

  if (isSearchToolCall(lower)) {
    const event = buildSearchEvent(toolInput, sessionId, timestamp);
    if (event) events.push(event);
  }

  return events;
}

function isFileToolCall(name: string): boolean {
  return ['read', 'write', 'edit'].includes(name);
}

function isSearchToolCall(name: string): boolean {
  return ['search', 'grep', 'glob'].includes(name);
}

function buildFileEvent(
  toolName: string,
  input: Record<string, unknown>,
  sessionId: string,
  timestamp: string
): StructuralEvent | null {
  const filePath = String(input.file_path ?? input.path ?? '');
  if (!filePath) return null;

  const action = toolName === 'edit' ? 'edit' : toolName;
  const eventType: StructuralEventType = toolName === 'edit' ? 'edit' : 'file_touch';
  const detail = `${action}: ${filePath}`;
  const id = hashEvent(eventType, detail);

  return { id, sessionId, eventType, detail, filePath, timestamp };
}

function extractBashEvents(
  cmd: string,
  output: string,
  sessionId: string,
  timestamp: string,
  events: StructuralEvent[]
): void {
  if (isGitCommand(cmd)) {
    const detail = summarizeGitCommand(cmd);
    const id = hashEvent('git_op', detail);
    events.push({ id, sessionId, eventType: 'git_op', detail, timestamp });
  }

  if (hasErrorIndicators(output)) {
    const detail = extractErrorSummary(output, cmd);
    const id = hashEvent('error', detail);
    events.push({ id, sessionId, eventType: 'error', detail, timestamp });
  }
}

function isGitCommand(cmd: string): boolean {
  return /\bgit\s+/.test(cmd);
}

function summarizeGitCommand(cmd: string): string {
  const match = cmd.match(/\bgit\s+(\S+(?:\s+\S+)?)/);
  return match ? `git ${match[1]}` : 'git operation';
}

function hasErrorIndicators(output: string): boolean {
  return /(?:error|Error|ERROR|fatal|FATAL|panic|PANIC)[\s:]/m.test(output);
}

function extractErrorSummary(output: string, cmd: string): string {
  const lines = output.split('\n');
  const errorLine = lines.find((l) => /(?:error|Error|ERROR|fatal|FATAL|panic|PANIC)[\s:]/.test(l));
  const summary = errorLine?.trim().slice(0, 120) ?? 'unknown error';
  const cmdPrefix = cmd.slice(0, 60);
  return `${cmdPrefix}: ${summary}`;
}

function buildSearchEvent(
  input: Record<string, unknown>,
  sessionId: string,
  timestamp: string
): StructuralEvent | null {
  const query = String(input.query ?? input.pattern ?? input.glob ?? '');
  if (!query) return null;

  const detail = `search: ${query.slice(0, 120)}`;
  const id = hashEvent('search', detail);

  return { id, sessionId, eventType: 'search', detail, timestamp };
}

const DEFAULT_CAPACITY = 100;

export class EventBuffer {
  private events: Map<string, StructuralEvent> = new Map();
  private insertOrder: string[] = [];
  private capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  add(event: StructuralEvent): boolean {
    if (this.events.has(event.id)) return false;

    while (this.insertOrder.length >= this.capacity) {
      const evictId = this.insertOrder.shift()!;
      this.events.delete(evictId);
    }

    this.events.set(event.id, event);
    this.insertOrder.push(event.id);
    return true;
  }

  getEvents(sessionId?: string): StructuralEvent[] {
    const all = Array.from(this.events.values());
    if (!sessionId) return all;
    return all.filter((e) => e.sessionId === sessionId);
  }

  clear(sessionId?: string): void {
    if (!sessionId) {
      this.events.clear();
      this.insertOrder = [];
      return;
    }

    const toRemove = new Set<string>();
    for (const [id, event] of this.events) {
      if (event.sessionId === sessionId) toRemove.add(id);
    }
    for (const id of toRemove) this.events.delete(id);
    this.insertOrder = this.insertOrder.filter((id) => !toRemove.has(id));
  }

  get size(): number {
    return this.events.size;
  }
}
