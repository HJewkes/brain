import type { DispatchExtension, DispatchExtensionInput } from '../dispatch-extensions.js';
import type { BreakingChange } from '../breaking-changes.js';
import { detectBreakingChanges, formatBreakingChangesBrief } from '../breaking-changes.js';

export const breakingChangesExtension: DispatchExtension = {
  name: 'breakingChanges',

  compute(input: DispatchExtensionInput): BreakingChange[] | undefined {
    if (!input.options?.projectDir) return undefined;
    try {
      const detected = detectBreakingChanges(input.options.projectDir);
      return detected.length > 0 ? detected : undefined;
    } catch {
      return undefined;
    }
  },

  format(data: unknown): string | null {
    const changes = data as BreakingChange[];
    if (!changes || changes.length === 0) return null;
    return formatBreakingChangesBrief(changes);
  },
};
