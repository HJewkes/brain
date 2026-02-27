import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';

describe('memories list --limit validation', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('rejects non-numeric --limit with an error', async () => {
    const { memoriesCommand } = await import('../../src/commands/memories.js');
    const program = new Command().exitOverride().addCommand(memoriesCommand);
    await program.parseAsync(['node', 'test', 'memories', 'list', '--limit', 'abc']);

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('--limit must be a positive integer')
    );
  });

  it('rejects zero --limit with an error', async () => {
    const { memoriesCommand } = await import('../../src/commands/memories.js');
    const program = new Command().exitOverride().addCommand(memoriesCommand);
    await program.parseAsync(['node', 'test', 'memories', 'list', '--limit', '0']);

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('--limit must be a positive integer')
    );
  });

  it('rejects negative --limit with an error', async () => {
    const { memoriesCommand } = await import('../../src/commands/memories.js');
    const program = new Command().exitOverride().addCommand(memoriesCommand);
    await program.parseAsync(['node', 'test', 'memories', 'list', '--limit', '-5']);

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('--limit must be a positive integer')
    );
  });
});

describe('inbox mutually exclusive flags', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('rejects --discard and --delete together', async () => {
    const { inboxCommand } = await import('../../src/commands/inbox.js');
    const program = new Command().exitOverride().addCommand(inboxCommand);
    await program.parseAsync([
      'node',
      'test',
      'inbox',
      '--discard',
      'id1',
      '--delete',
      'id2',
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    );
  });

  it('rejects --discard and --count together', async () => {
    const { inboxCommand } = await import('../../src/commands/inbox.js');
    const program = new Command().exitOverride().addCommand(inboxCommand);
    await program.parseAsync([
      'node',
      'test',
      'inbox',
      '--discard',
      'id1',
      '--count',
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    );
  });
});

describe('feed add URL validation', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('rejects invalid URL with a clean error', async () => {
    const { feedCommand } = await import('../../src/commands/feed.js');
    const program = new Command().exitOverride().addCommand(feedCommand);
    await program.parseAsync(['node', 'test', 'feed', 'add', 'not-a-url']);

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid URL: not-a-url')
    );
  });

  it('accepts valid URL without URL validation error', async () => {
    const { feedCommand } = await import('../../src/commands/feed.js');
    const program = new Command().exitOverride().addCommand(feedCommand);
    // This will fail later (no DB), but should NOT fail on URL validation
    try {
      await program.parseAsync(['node', 'test', 'feed', 'add', 'https://example.com/feed.xml']);
    } catch {
      // Expected: withDb will fail without a real config
    }

    // The stderr should NOT contain the URL validation error
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('invalid URL'))).toBe(false);
  });
});

describe('quick command argument', () => {
  it('uses optional variadic argument for stdin fallback', async () => {
    const { quickCommand } = await import('../../src/commands/quick.js');
    const arg = quickCommand.registeredArguments[0];
    expect(arg).toBeDefined();
    expect(arg.required).toBe(false);
    expect(arg.variadic).toBe(true);
  });
});
