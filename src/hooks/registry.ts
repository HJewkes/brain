import type { HookEvent, HookInput, HookHandler, HookConfig, HookResult } from './types.js';
import { hookAllow, hookAllowJson } from './types.js';

export class HookRegistry {
  private handlers: HookHandler[] = [];

  register(handler: HookHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  getHandlers(event?: HookEvent): HookHandler[] {
    if (!event) return [...this.handlers];
    return this.handlers.filter((h) => h.event === event);
  }

  dispatch(event: HookEvent, input: HookInput, config: HookConfig): HookResult {
    const active = this.handlers.filter((h) => h.event === event && h.enabled(config));

    const contexts: string[] = [];

    for (const handler of active) {
      const result = handler.run(input, config);
      if (result.exitCode !== 0) return result;
      if (result.stdout) {
        try {
          const parsed = JSON.parse(result.stdout) as { additionalContext?: string };
          if (parsed.additionalContext) contexts.push(parsed.additionalContext);
        } catch {
          // non-JSON stdout, ignore
        }
      }
    }

    if (contexts.length === 0) return hookAllow();
    return hookAllowJson(contexts.join('\n'));
  }
}
