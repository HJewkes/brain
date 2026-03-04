import { vi, describe, it, expect } from 'vitest';
import { importCommand } from '../../src/commands/import.js';

describe('import command actions', () => {
  it('errors when no paths or --urls provided', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;

    await importCommand.parseAsync(['node', 'import'], { from: 'node' });

    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join('')).toContain('provide file/directory arguments');

    vi.restoreAllMocks();
  });
});
