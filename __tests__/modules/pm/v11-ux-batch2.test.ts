import { describe, it, expect } from 'vitest';

describe('UX batch 2', () => {
  describe('task done help text', () => {
    it('includes low-level hint referencing brain pm complete', async () => {
      const { createTaskCommands } = await import('../../../src/modules/pm/commands/task.js');
      const taskCmd = createTaskCommands();
      const doneCmd = taskCmd.commands.find((c) => c.name() === 'done');
      expect(doneCmd).toBeDefined();
      expect(doneCmd!.description()).toContain('brain pm complete');
      expect(doneCmd!.description()).toContain('low-level');
    });
  });

  describe('notes parent command --module passthrough', () => {
    it('accepts --module flag on parent command', async () => {
      const { notesCommand } = await import('../../../src/commands/notes.js');
      const moduleOpt = notesCommand.options.find((o) => o.long === '--module');
      expect(moduleOpt).toBeDefined();
    });
  });
});
