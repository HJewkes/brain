import type { SessionDetailData, SessionToolCall } from '../../types.js';

export interface AgentEntry {
  agentId: string;
  spawnTs: number;
  completeTs: number;
  label: string;
  isMain: boolean;
}

export interface FileEntry {
  timestamp: number;
  path: string;
  type: 'read' | 'write';
}

export type ToolCategory = 'Read' | 'Write' | 'Bash' | 'Agent';

export interface PrecomputedTimelines {
  agentTimeline: AgentEntry[];
  filesTimeline: FileEntry[];
  toolTimestamps: Record<ToolCategory, number[]>;
  toolTotals: Record<ToolCategory, number>;
  errorTimestamps: number[];
  allToolTs: number[];
  totalReadFiles: number;
  totalWriteFiles: number;
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const WRITE_TOOLS = new Set(['Write', 'Edit']);
const AGENT_TOOLS = new Set(['Agent', 'Task', 'Skill']);

function toolCat(name: string): ToolCategory {
  if (READ_TOOLS.has(name)) return 'Read';
  if (WRITE_TOOLS.has(name)) return 'Write';
  if (AGENT_TOOLS.has(name)) return 'Agent';
  return 'Bash';
}

function extractFilePath(tc: SessionToolCall): string | null {
  const summary = tc.inputSummary;
  if (!summary) return null;
  const m = summary.match(/(?:file_path|path|pattern)[:=]\s*"?([^\s"]+)/);
  return m?.[1] ?? null;
}

export function buildTimelines(data: SessionDetailData): PrecomputedTimelines {
  const allTc = flattenToolCalls(data);
  return {
    agentTimeline: buildAgentTimeline(data),
    filesTimeline: buildFilesTimeline(allTc),
    ...buildToolTimestamps(allTc),
    errorTimestamps: buildErrorTimestamps(allTc),
    allToolTs: allTc.map((tc) => new Date(tc.timestamp).getTime()).sort((a, b) => a - b),
    ...computeFileTotals(allTc),
  };
}

function flattenToolCalls(data: SessionDetailData): SessionToolCall[] {
  return data.turns.flatMap((t) => t.toolCalls);
}

function buildAgentTimeline(data: SessionDetailData): AgentEntry[] {
  const startMs = new Date(data.session.startedAt).getTime();
  const endMs = data.session.completedAt
    ? new Date(data.session.completedAt).getTime()
    : startMs + (data.session.durationMinutes ?? 60) * 60_000;

  const mainEntry: AgentEntry = {
    agentId: 'main',
    spawnTs: startMs,
    completeTs: endMs,
    label: 'Main session',
    isMain: true,
  };

  const subEntries = data.agentEvents
    .filter((e) => e.action === 'spawned')
    .map((spawn) => {
      const complete = data.agentEvents.find(
        (e) => e.agentId === spawn.agentId && e.action === 'completed'
      );
      const completeTs = complete
        ? new Date(complete.timestamp).getTime()
        : new Date(spawn.timestamp).getTime() + 60_000;
      return {
        agentId: spawn.agentId,
        spawnTs: new Date(spawn.timestamp).getTime(),
        completeTs,
        label: truncate(spawn.taskId ?? spawn.agentId, 40),
        isMain: false,
      };
    })
    .sort((a, b) => a.spawnTs - b.spawnTs);

  return [mainEntry, ...subEntries];
}

function buildFilesTimeline(tcs: SessionToolCall[]): FileEntry[] {
  const seen = new Set<string>();
  const entries: FileEntry[] = [];
  for (const tc of tcs) {
    const path = extractFilePath(tc);
    if (!path) continue;
    const type: 'read' | 'write' = WRITE_TOOLS.has(tc.toolName) ? 'write' : 'read';
    const key = `${type}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ timestamp: new Date(tc.timestamp).getTime(), path, type });
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

function buildToolTimestamps(tcs: SessionToolCall[]) {
  const cats: ToolCategory[] = ['Read', 'Write', 'Bash', 'Agent'];
  const toolTimestamps: Record<ToolCategory, number[]> = {
    Read: [],
    Write: [],
    Bash: [],
    Agent: [],
  };
  const toolTotals: Record<ToolCategory, number> = {
    Read: 0,
    Write: 0,
    Bash: 0,
    Agent: 0,
  };

  for (const tc of tcs) {
    const cat = toolCat(tc.toolName);
    toolTimestamps[cat].push(new Date(tc.timestamp).getTime());
  }

  for (const cat of cats) {
    toolTimestamps[cat].sort((a, b) => a - b);
    toolTotals[cat] = toolTimestamps[cat].length;
  }

  return { toolTimestamps, toolTotals };
}

function buildErrorTimestamps(tcs: SessionToolCall[]): number[] {
  return tcs
    .filter((tc) => tc.outcome === 'error')
    .map((tc) => new Date(tc.timestamp).getTime())
    .sort((a, b) => a - b);
}

function computeFileTotals(tcs: SessionToolCall[]) {
  const readPaths = new Set<string>();
  const writePaths = new Set<string>();
  for (const tc of tcs) {
    const path = extractFilePath(tc);
    if (!path) continue;
    if (WRITE_TOOLS.has(tc.toolName)) writePaths.add(path);
    else if (READ_TOOLS.has(tc.toolName)) readPaths.add(path);
  }
  return { totalReadFiles: readPaths.size, totalWriteFiles: writePaths.size };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}
