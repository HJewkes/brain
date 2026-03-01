import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { templateCommand } from '../../src/commands/template.js';

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await templateCommand.parseAsync(['node', 'template', ...args], { from: 'node' });
}

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('template command', () => {
  it('generates a note template with frontmatter', async () => {
    await run('note');

    const out = stdout();
    expect(out).toContain('---');
    expect(out).toContain('type: note');
    expect(out).toContain('tier: slow');
    expect(out).toContain('## Overview');
  });

  it('generates a decision template', async () => {
    await run('decision');

    const out = stdout();
    expect(out).toContain('type: decision');
    expect(out).toContain('confidence: high');
    expect(out).toContain('## Context');
    expect(out).toContain('## Decision');
    expect(out).toContain('## Consequences');
  });

  it('generates a meeting template', async () => {
    await run('meeting');

    const out = stdout();
    expect(out).toContain('type: meeting');
    expect(out).toContain('tier: fast');
    expect(out).toContain('participants: []');
    expect(out).toContain('## Agenda');
    expect(out).toContain('## Action Items');
  });

  it('generates a research template', async () => {
    await run('research');

    const out = stdout();
    expect(out).toContain('type: research');
    expect(out).toContain('## Question');
    expect(out).toContain('## Findings');
    expect(out).toContain('## Conclusion');
  });

  it('generates a pattern template', async () => {
    await run('pattern');

    const out = stdout();
    expect(out).toContain('type: pattern');
    expect(out).toContain('## Problem');
    expect(out).toContain('## Solution');
    expect(out).toContain('## Examples');
  });

  it('generates a session-log template', async () => {
    await run('session-log');

    const out = stdout();
    expect(out).toContain('type: session-log');
    expect(out).toContain('tier: fast');
    expect(out).toContain('## Goal');
    expect(out).toContain('## Log');
    expect(out).toContain('## Outcome');
  });

  it('generates a guide template', async () => {
    await run('guide');

    const out = stdout();
    expect(out).toContain('type: guide');
    expect(out).toContain('## Purpose');
    expect(out).toContain('## Steps');
    expect(out).toContain('## Tips');
  });

  it('errors for invalid type', async () => {
    await run('invalid-type');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('unknown type');
    expect(stderr()).toContain('Valid types:');
  });

  it('includes current date in template', async () => {
    await run('note');

    const out = stdout();
    const today = new Date().toISOString().slice(0, 10);
    expect(out).toContain(`created: ${today}`);
  });
});
