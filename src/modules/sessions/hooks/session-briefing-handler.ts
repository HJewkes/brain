import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow, hookAllowJson } from '../../../hooks/types.js';
import { loadConfig } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { generateSessionBriefing, renderBriefingXml } from '../engine/session-briefing.js';

let hasRun = false;

export const sessionBriefingHandler: HookHandler = {
  name: 'sessions:briefing',
  event: 'prompt-submit',
  priority: 51, // just after sessions:restore (50)

  enabled(_config: HookConfig): boolean {
    return !hasRun;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    hasRun = true;

    let db: BrainDB | null = null;
    try {
      const config = loadConfig();
      db = new BrainDB(config.dbPath);
      const briefing = generateSessionBriefing(db, config, input.cwd);

      if (!briefing.project && briefing.sections.length === 0) return hookAllow();

      const xml = renderBriefingXml(briefing);
      return hookAllowJson(xml);
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};

export function resetSessionBriefingHandler(): void {
  hasRun = false;
}
