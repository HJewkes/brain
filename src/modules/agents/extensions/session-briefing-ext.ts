import type { DispatchExtension, DispatchExtensionInput } from '../dispatch-extensions.js';
import type { SessionBriefing } from '../../sessions/engine/session-briefing.js';
import { generateSessionBriefing } from '../../sessions/engine/session-briefing.js';
import { formatSessionBriefing } from '../dispatch-context.js';

export const sessionBriefingExtension: DispatchExtension = {
  name: 'sessionBriefing',

  compute(input: DispatchExtensionInput): SessionBriefing | undefined {
    if (!input.options?.config || !input.options?.projectDir) return undefined;
    try {
      return generateSessionBriefing(input.db, input.options.config, input.options.projectDir);
    } catch {
      return undefined;
    }
  },

  format(data: unknown): string | null {
    if (!data) return null;
    return formatSessionBriefing(data as SessionBriefing);
  },
};
