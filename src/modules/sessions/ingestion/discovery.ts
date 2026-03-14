import { readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

export interface DiscoveredSession {
  filePath: string;
  sessionId: string;
  projectDir: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export interface DiscoveryOptions {
  projectDir?: string;
  since?: Date;
  claudeProjectsDir?: string;
}

export function discoverSessions(opts?: DiscoveryOptions): DiscoveredSession[] {
  const claudeDir = opts?.claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  if (!existsSync(claudeDir)) return [];

  const results: DiscoveredSession[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(claudeDir).map((d) => join(claudeDir, d));
  } catch {
    return [];
  }

  for (const projDir of projectDirs) {
    const dirName = basename(projDir);
    let files: string[];
    try {
      files = readdirSync(projDir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    // Derive projectDir from directory name as fallback
    const dirFallback = cwdFromDirName(dirName);

    for (const file of files) {
      const filePath = join(projDir, file);
      const sessionId = basename(file, '.jsonl');

      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }

      if (opts?.since && stat.mtimeMs < opts.since.getTime()) continue;

      // Skip trivial files
      if (stat.size < 100) continue;

      const cwdFromFile = peekCwd(filePath) ?? dirFallback;
      if (!cwdFromFile) continue;

      if (opts?.projectDir && cwdFromFile !== opts.projectDir) continue;

      results.push({
        filePath,
        sessionId,
        projectDir: cwdFromFile,
        fileSizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  return results.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function peekCwd(filePath: string): string | null {
  try {
    // Read only first 32KB to avoid loading multi-MB files
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(32768);
    const bytesRead = readSync(fd, buf, 0, 32768, 0);
    closeSync(fd);

    const chunk = buf.subarray(0, bytesRead).toString('utf-8');
    const lines = chunk.split('\n').slice(0, 20);

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { cwd?: string };
        if (event.cwd) return event.cwd;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function cwdFromDirName(dirName: string): string | null {
  // Directory names like "-Users-hjewkes-Documents-projects-brain" → "/Users/hjewkes/Documents/projects/brain"
  if (!dirName.startsWith('-')) return null;
  return dirName.replace(/-/g, '/');
}
