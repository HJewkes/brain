import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow, hookAllowJson } from '../../../hooks/types.js';
import { loadConfig } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { generateSessionBriefing, renderBriefingXml } from '../engine/session-briefing.js';
import { getActiveProject } from '../../pm/data/queries.js';

let hasRun = false;

export const sessionStartHandler: HookHandler = {
  name: 'sessions:start',
  event: 'session-start',
  priority: 10,

  enabled(_config: HookConfig): boolean {
    return !hasRun;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    hasRun = true;

    let db: BrainDB | null = null;
    try {
      const sessionId = process.env.BRAIN_PM_SESSION || randomUUID();
      process.env.BRAIN_PM_SESSION = sessionId;

      const config = loadConfig();
      db = new BrainDB(config.dbPath);

      const projectPrefix = getActiveProject(db);
      if (projectPrefix) {
        process.env.BRAIN_PM_PROJECT = projectPrefix;
      }

      writeEnvFile(sessionId, projectPrefix);

      const briefing = generateSessionBriefing(db, config, input.cwd);
      if (!briefing.project && briefing.sections.length === 0) {
        return hookAllowJson(`<session-start session_id="${sessionId}" />`);
      }

      const xml = renderBriefingXml(briefing);
      return hookAllowJson(`<session-start session_id="${sessionId}">\n${xml}\n</session-start>`);
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};

function writeEnvFile(sessionId: string, project: string | null): void {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) return;

  try {
    const lines: string[] = [`BRAIN_PM_SESSION=${sessionId}`];
    if (project) lines.push(`BRAIN_PM_PROJECT=${project}`);
    appendFileSync(envFile, lines.join('\n') + '\n');
  } catch {
    // Best-effort — do not block session start
  }
}

export function resetSessionStartHandler(): void {
  hasRun = false;
}
