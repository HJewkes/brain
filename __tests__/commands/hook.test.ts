import { describe, it, expect } from 'vitest';
import { HookRegistry } from '../../src/hooks/registry.js';
import { ownershipCheck } from '../../src/hooks/checks/ownership.js';
import { gitSafetyCheck } from '../../src/hooks/checks/git-safety.js';
import { workspaceCheck } from '../../src/hooks/checks/workspace.js';
import { dodCheck } from '../../src/hooks/checks/dod.js';
import { wipCheck } from '../../src/hooks/checks/wip.js';
import { hookCommand } from '../../src/commands/hook.js';

describe('hook command', () => {
  describe('createRegistry', () => {
    it('should register all core checks', () => {
      const registry = new HookRegistry();
      registry.register(gitSafetyCheck);
      registry.register(ownershipCheck);
      registry.register(workspaceCheck);
      registry.register(dodCheck);
      registry.register(wipCheck);

      const handlers = registry.getHandlers();
      expect(handlers).toHaveLength(5);
      expect(handlers.map((h) => h.name)).toContain('git-safety');
      expect(handlers.map((h) => h.name)).toContain('ownership');
      expect(handlers.map((h) => h.name)).toContain('workspace');
      expect(handlers.map((h) => h.name)).toContain('dod');
      expect(handlers.map((h) => h.name)).toContain('wip');
    });

    it('should sort handlers by priority', () => {
      const registry = new HookRegistry();
      registry.register(ownershipCheck);
      registry.register(gitSafetyCheck);

      const handlers = registry.getHandlers('pre-tool-use');
      expect(handlers[0].name).toBe('git-safety');
      expect(handlers[1].name).toBe('ownership');
    });
  });

  describe('hookCommand structure', () => {
    it('should be named hook', () => {
      expect(hookCommand.name()).toBe('hook');
    });

    it('should have dispatch and status subcommands', () => {
      const subcommands = hookCommand.commands.map((c) => c.name());
      expect(subcommands).toContain('dispatch');
      expect(subcommands).toContain('status');
    });

    it('dispatch subcommand accepts event argument', () => {
      const dispatch = hookCommand.commands.find((c) => c.name() === 'dispatch');
      expect(dispatch).toBeDefined();
      expect(dispatch!.description()).toContain('hook event');
    });

    it('status subcommand has --json option', () => {
      const status = hookCommand.commands.find((c) => c.name() === 'status');
      expect(status).toBeDefined();
      const jsonOpt = status!.options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });
});
