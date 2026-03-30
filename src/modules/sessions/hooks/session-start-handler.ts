import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow, hookAllowJson } from '../../../hooks/types.js';
import { loadConfig, resolveInstance } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import {
  generateSessionBriefing,
  renderBriefingXml,
  type SessionBriefing,
} from '../engine/session-briefing.js';
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

      const instance = resolveInstance({ cwd: input.cwd });
      const config = loadConfig(instance);
      db = new BrainDB(config.dbPath);

      const projectPrefix = getActiveProject(db);
      if (projectPrefix) {
        process.env.BRAIN_PM_PROJECT = projectPrefix;
      }

      writeEnvFile(sessionId, projectPrefix);

      // Start brain serve in background if not already running
      tryStartBrainServe();

      const briefing = generateSessionBriefing(db, config, input.cwd);
      if (!briefing.project && briefing.sections.length === 0) {
        return hookAllowJson(`<session-start session_id="${sessionId}" />`);
      }

      // Return both: plain text briefing (visible to user) + XML in additionalContext (structured data for Claude)
      const xml = renderBriefingXml(briefing);
      const plainBriefing = renderBriefingPlain(briefing, sessionId);
      return hookAllowJson(`${plainBriefing}\n\n${xml}`);
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};

function renderBriefingPlain(briefing: SessionBriefing, sessionId: string): string {
  const lines: string[] = [];
  lines.push(`<session-briefing>`);
  lines.push(
    `IMPORTANT: At the start of this conversation, briefly present this project status to the user BEFORE responding to their question. Use brain PM commands (not git log) for any project status queries.`
  );
  lines.push('');
  lines.push(`Project: ${briefing.project ?? 'none'} | Session: ${sessionId.slice(0, 8)}`);
  lines.push('');

  for (const section of briefing.sections) {
    lines.push(`${section.heading}:`);
    for (const item of section.items) {
      lines.push(`  • ${item}`);
    }
    lines.push('');
  }

  if (briefing.suggestedFocus.length > 0) {
    lines.push('Suggested focus:');
    for (const focus of briefing.suggestedFocus) {
      lines.push(`  → ${focus}`);
    }
  }

  lines.push('</session-briefing>');
  return lines.join('\n');
}

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

/**
 * Start brain serve in the background if not already running.
 * Fire-and-forget — never blocks session start.
 */
function tryStartBrainServe(): void {
  try {
    // Quick health check — is server already running?
    const http = require('node:http') as typeof import('node:http'); // eslint-disable-line @typescript-eslint/no-require-imports
    const req = http.get('http://localhost:7800/api/status', { timeout: 500 }, (res) => {
      // Server is already running, nothing to do
      res.resume();
    });
    req.on('error', () => {
      // Server not running — start it in the background
      const brainPath = findBrainBinary();
      if (!brainPath) return;

      const child = spawn(brainPath, ['serve', '--port', '7800'], {
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
    });
    req.end();
  } catch {
    // Non-fatal
  }
}

import { findBrainBinary } from '../../../hooks/utils.js';
