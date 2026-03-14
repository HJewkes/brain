import type { DispatchExtension, DispatchExtensionInput } from '../dispatch-extensions.js';
import type { CompletionCheck } from '../dispatch-guard.js';
import { checkAlreadyCompleted } from '../dispatch-guard.js';

export const completionCheckExtension: DispatchExtension = {
  name: 'alreadyCompleted',

  compute(input: DispatchExtensionInput): CompletionCheck | undefined {
    const check = checkAlreadyCompleted(input.taskDisplayId, input.options?.projectDir);
    return check.alreadyDone ? check : undefined;
  },

  format(data: unknown): string | null {
    const check = data as CompletionCheck;
    if (!check) return null;
    return `Already Completed: commit ${check.commitHash} — ${check.commitMessage}`;
  },
};
