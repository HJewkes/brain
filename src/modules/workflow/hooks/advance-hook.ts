import {
  hookAllow,
  type HookHandler,
  type HookInput,
  type HookConfig,
} from '../../../hooks/types.js';

export const advanceHook: HookHandler = {
  name: 'workflow:advance',
  event: 'agent-done',
  priority: 80,

  enabled(_config: HookConfig): boolean {
    return true;
  },

  run(_input: HookInput, _config: HookConfig): ReturnType<typeof hookAllow> {
    // V2 runtime handles workflow advancement in-process; hook is a no-op
    return hookAllow();
  },
};
