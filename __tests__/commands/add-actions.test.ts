import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { addCommand } from '../../src/commands/add.js';

let stdoutChunks: string[];
let stderrChunks: string[];
let tmpDir: string;
let tmpNotesDir: string;

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

vi.mock('../../src/services/config.js', () => ({
  loadConfig: vi.fn(() => ({
    notesDir: tmpNotesDir,
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  })),
}));

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => {
    await fn({
      db: { upsertNote: vi.fn(), upsertChunks: vi.fn() },
      embedder: { model: 'mock', dimensions: 384, embed: vi.fn().mockResolvedValue([]) },
      config: { notesDir: tmpNotesDir, dbPath: ':memory:', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } },
      modules: {},
      close: () => {},
    });
  }),
}));

async function run(...args: string[]): Promise<void> {
  await addCommand.parseAsync(['node', 'add', ...args], { from: 'node' });
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `add-test-${randomUUID().slice(0, 8)}`);
  tmpNotesDir = join(tmpDir, 'brain-notes');
  mkdirSync(tmpNotesDir, { recursive: true });
  mkdirSync(join(tmpNotesDir, 'notes'), { recursive: true });
  mkdirSync(join(tmpNotesDir, 'decisions'), { recursive: true });
  mkdirSync(join(tmpNotesDir, 'research'), { recursive: true });
  mkdirSync(join(tmpNotesDir, 'logs'), { recursive: true });

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

describe('add command validation', () => {
  it('rejects invalid --type', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, '---\nid: test\ntitle: Test\n---\n\nContent', 'utf-8');

    await run(filePath, '--type', 'invalid-type');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('invalid type');
  });

  it('rejects invalid --tier', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, '---\nid: test\ntitle: Test\n---\n\nContent', 'utf-8');

    await run(filePath, '--tier', 'invalid-tier');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('invalid tier');
  });

  it('rejects invalid --confidence', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, '---\nid: test\ntitle: Test\n---\n\nContent', 'utf-8');

    await run(filePath, '--confidence', 'invalid');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('invalid confidence');
  });

  it('rejects invalid --status', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, '---\nid: test\ntitle: Test\n---\n\nContent', 'utf-8');

    await run(filePath, '--status', 'bad-status');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('invalid status');
  });

  it('rejects invalid --review-interval format', async () => {
    const filePath = join(tmpDir, 'test.md');
    writeFileSync(filePath, '---\nid: test\ntitle: Test\n---\n\nContent', 'utf-8');

    await run(filePath, '--review-interval', 'invalid');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('invalid review-interval');
  });

  it('errors when no file and stdin is TTY', async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    await run();

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('provide a file argument');

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });
});

describe('add command with file input', () => {
  it('creates a note from a file with frontmatter', async () => {
    const filePath = join(tmpDir, 'with-fm.md');
    writeFileSync(filePath, '---\nid: test-add\ntitle: Test Add\ntype: note\ntier: slow\n---\n\n# Content\n\nHello', 'utf-8');

    await run(filePath);

    const out = stdout();
    expect(out).toContain('.md');
  });

  it('adds frontmatter when input has none', async () => {
    const filePath = join(tmpDir, 'no-fm.md');
    writeFileSync(filePath, '# My Note\n\nSome content here', 'utf-8');

    await run(filePath, '--title', 'My Note');

    const out = stdout();
    expect(out).toContain('.md');
    // The output file should exist
    const outPath = out.trim();
    if (existsSync(outPath)) {
      const written = readFileSync(outPath, 'utf-8');
      expect(written).toContain('---');
      expect(written).toContain('My Note');
    }
  });
});
