import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { mergeHooksIntoSettings } from '../../src/commands/hook-install.js';
import { hookInstallCommand } from '../../src/commands/hook-install.js';
import { hookCommand } from '../../src/commands/hook.js';

describe('hook install', () => {
  describe('mergeHooksIntoSettings', () => {
    it('should produce all five hook events from empty settings', () => {
      const result = mergeHooksIntoSettings({});

      expect(result.hooks).toBeDefined();
      const events = Object.keys(result.hooks!);
      expect(events).toContain('PreToolUse');
      expect(events).toContain('PostToolUse');
      expect(events).toContain('Notification');
      expect(events).toContain('SessionStart');
      expect(events).toContain('Stop');
    });

    it('should set correct brain dispatch commands', () => {
      const result = mergeHooksIntoSettings({});
      const hooks = result.hooks!;

      expect(hooks.PreToolUse[0].hooks[0].command).toBe('brain hook dispatch pre-tool-use');
      expect(hooks.PostToolUse[0].hooks[0].command).toBe('brain hook dispatch post-tool-use');
      expect(hooks.Notification[0].hooks[0].command).toBe('brain hook dispatch notification');
      expect(hooks.SessionStart[0].hooks[0].command).toBe('brain hook dispatch session-start');
      expect(hooks.Stop[0].hooks[0].command).toBe('brain hook dispatch agent-done');
    });

    it('should use empty matcher and command type', () => {
      const result = mergeHooksIntoSettings({});

      for (const matchers of Object.values(result.hooks!)) {
        expect(matchers[0].matcher).toBe('');
        expect(matchers[0].hooks[0].type).toBe('command');
      }
    });

    it('should preserve existing non-hook settings', () => {
      const existing = {
        allowedTools: ['Read', 'Write'],
        model: 'opus',
      };

      const result = mergeHooksIntoSettings(existing);

      expect(result.allowedTools).toEqual(['Read', 'Write']);
      expect(result.model).toBe('opus');
      expect(result.hooks).toBeDefined();
    });

    it('should preserve existing hooks for other tools', () => {
      const existing = {
        hooks: {
          PreToolUse: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'other-tool pre-check' }],
            },
          ],
        },
      };

      const result = mergeHooksIntoSettings(existing);
      const preToolUse = result.hooks!.PreToolUse;

      expect(preToolUse).toHaveLength(2);
      expect(preToolUse[0].hooks[0].command).toBe('other-tool pre-check');
      expect(preToolUse[1].hooks[0].command).toBe('brain hook dispatch pre-tool-use');
    });

    it('should not duplicate brain hooks if already installed', () => {
      const existing = {
        hooks: {
          PreToolUse: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'brain hook dispatch pre-tool-use' }],
            },
          ],
        },
      };

      const result = mergeHooksIntoSettings(existing);

      expect(result.hooks!.PreToolUse).toHaveLength(1);
    });

    it('should add missing events while keeping existing ones', () => {
      const existing = {
        hooks: {
          PreToolUse: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'brain hook dispatch pre-tool-use' }],
            },
          ],
        },
      };

      const result = mergeHooksIntoSettings(existing);

      expect(result.hooks!.PreToolUse).toHaveLength(1);
      expect(result.hooks!.PostToolUse).toHaveLength(1);
      expect(result.hooks!.SessionStart).toHaveLength(1);
      expect(result.hooks!.Stop).toHaveLength(1);
      expect(result.hooks!.Notification).toHaveLength(1);
    });
  });

  describe('hookInstallCommand structure', () => {
    it('should be named install', () => {
      expect(hookInstallCommand.name()).toBe('install');
    });

    it('should have --user, --project, and --dry-run options', () => {
      const optionNames = hookInstallCommand.options.map((o) => o.long);
      expect(optionNames).toContain('--user');
      expect(optionNames).toContain('--project');
      expect(optionNames).toContain('--dry-run');
    });
  });

  describe('hookCommand integration', () => {
    it('should include install as a subcommand', () => {
      const subcommands = hookCommand.commands.map((c) => c.name());
      expect(subcommands).toContain('install');
    });
  });

  describe('dry-run mode', () => {
    let tmpDir: string;
    let originalCwd: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'hook-install-'));
      originalCwd = process.cwd();
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should output merged settings without writing file', async () => {
      process.chdir(tmpDir);

      await hookInstallCommand.parseAsync(['--dry-run', '--project'], { from: 'user' });

      const settingsPath = join(tmpDir, '.claude', 'settings.local.json');
      expect(existsSync(settingsPath)).toBe(false);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('PreToolUse'));
    });
  });

  describe('file writing', () => {
    let tmpDir: string;
    let originalCwd: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'hook-install-'));
      originalCwd = process.cwd();
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      stderrSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should write project-level settings', async () => {
      process.chdir(tmpDir);

      await hookInstallCommand.parseAsync(['--project'], { from: 'user' });

      const settingsPath = join(tmpDir, '.claude', 'settings.local.json');
      expect(existsSync(settingsPath)).toBe(true);

      const written = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      expect(written.hooks.PreToolUse).toBeDefined();
      expect(written.hooks.Stop).toBeDefined();
    });

    it('should merge into existing project settings', async () => {
      process.chdir(tmpDir);
      const claudeDir = join(tmpDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        join(claudeDir, 'settings.local.json'),
        JSON.stringify({ allowedTools: ['Read'] }, null, 2),
        'utf-8'
      );

      await hookInstallCommand.parseAsync(['--project'], { from: 'user' });

      const settingsPath = join(claudeDir, 'settings.local.json');
      const written = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      expect(written.allowedTools).toEqual(['Read']);
      expect(written.hooks.PreToolUse).toBeDefined();
    });

    it('should not duplicate hooks on repeated install', async () => {
      process.chdir(tmpDir);

      await hookInstallCommand.parseAsync(['--project'], { from: 'user' });
      await hookInstallCommand.parseAsync(['--project'], { from: 'user' });

      const settingsPath = join(tmpDir, '.claude', 'settings.local.json');
      const written = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      expect(written.hooks.PreToolUse).toHaveLength(1);
      expect(written.hooks.Stop).toHaveLength(1);
    });
  });
});
