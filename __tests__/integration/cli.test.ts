import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const CLI = `npx tsx ${join(PROJECT_ROOT, 'src', 'cli.ts')}`;

let tmpDir: string;
let notesDir: string;
let dbPath: string;
let fakeHome: string;

function cli(args: string, options?: { input?: string }): string {
  return execSync(`${CLI} ${args}`, {
    cwd: tmpDir,
    encoding: 'utf-8',
    timeout: 30_000,
    input: options?.input,
    env: { ...process.env, HOME: fakeHome, NODE_NO_WARNINGS: '1' },
  }).trim();
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'brain-integration-'));
  notesDir = join(tmpDir, 'notes');
  dbPath = join(tmpDir, 'brain.db');
  fakeHome = join(tmpDir, 'home');
  mkdirSync(fakeHome, { recursive: true });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('CLI integration', () => {
  it('init creates directory structure and database', () => {
    const output = cli(`init --notes-dir "${notesDir}" --embedder local --json`);
    const result = JSON.parse(output);

    expect(result.notesDir).toBe(notesDir);
    expect(result.embedder).toBe('local');
    expect(existsSync(notesDir)).toBe(true);
    expect(existsSync(join(notesDir, 'notes'))).toBe(true);
    expect(existsSync(join(notesDir, 'decisions'))).toBe(true);
    expect(existsSync(join(notesDir, 'research'))).toBe(true);
    expect(existsSync(join(notesDir, '_templates'))).toBe(true);

    // Update dbPath to match what init actually created
    dbPath = result.dbPath;
    expect(existsSync(dbPath)).toBe(true);
  });

  it('add creates a note file from stdin', () => {
    const content = [
      '---',
      'id: test-note-one',
      'title: Test Note One',
      'type: note',
      'tier: slow',
      'tags: [testing, integration]',
      'summary: A test note for integration testing',
      'confidence: high',
      'status: current',
      'created: "2024-01-01"',
      'modified: "2024-01-01"',
      'last-reviewed: "2024-01-01"',
      'review-interval: "90d"',
      '---',
      '',
      '# Test Note One',
      '',
      '## Overview',
      '',
      'This is a test note for integration testing.',
    ].join('\n');

    const outputPath = cli('add --type note --tier slow', {
      input: content,
    });

    expect(existsSync(outputPath)).toBe(true);
    const written = readFileSync(outputPath, 'utf-8');
    expect(written).toContain('Test Note One');
  });

  it('add creates a second note with relations', () => {
    const content = [
      '---',
      'id: test-note-two',
      'title: Test Note Two',
      'type: research',
      'tier: slow',
      'tags: [testing]',
      'summary: A related research note',
      'confidence: medium',
      'status: draft',
      'created: "2024-06-01"',
      'modified: "2024-06-01"',
      'last-reviewed: "2024-06-01"',
      'review-interval: "90d"',
      'related: [test-note-one]',
      '---',
      '',
      '# Test Note Two',
      '',
      '## Question',
      '',
      'How does integration testing work?',
      '',
      '## Findings',
      '',
      'It works by exercising the full CLI pipeline.',
    ].join('\n');

    const outputPath = cli('add --type research --tier slow', {
      input: content,
    });

    expect(existsSync(outputPath)).toBe(true);
  });

  it('index processes notes into the database', () => {
    const output = cli('index --json');
    const result = JSON.parse(output);

    expect(result.indexed).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('search returns results with correct shape (FTS)', () => {
    const output = cli('search "integration testing" --json --limit 5');
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty('notes');
    expect(parsed).toHaveProperty('memories');
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(Array.isArray(parsed.memories)).toBe(true);
    expect(parsed.notes.length).toBeGreaterThan(0);

    const first = parsed.notes[0];
    expect(first).toHaveProperty('score');
    expect(first).toHaveProperty('filePath');
    expect(first).toHaveProperty('noteId');
    expect(first).toHaveProperty('excerpt');
    expect(first).toHaveProperty('tier');
    expect(first).toHaveProperty('tags');
    expect(typeof first.score).toBe('number');
  });

  it('stale identifies notes needing review', () => {
    const output = cli('stale --json');
    const results = JSON.parse(output);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const staleNote = results.find((r: { noteId: string }) => r.noteId === 'test-note-one');
    expect(staleNote).toBeDefined();
    expect(staleNote.daysOverdue).toBeGreaterThan(0);
  });

  it('graph shows relations for a note', () => {
    const output = cli('graph test-note-two --json');
    const result = JSON.parse(output);

    expect(result).toHaveProperty('root');
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(result.root.id).toBe('test-note-two');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  it('template outputs valid YAML frontmatter', () => {
    const output = cli('template note');

    expect(output).toContain('---');
    expect(output).toContain('type: note');
    expect(output).toContain('tier: slow');
    expect(output).toContain('confidence: medium');
    expect(output).toContain('status: draft');

    const fmMatch = output.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
  });

  it('status returns stats object with correct shape', () => {
    const output = cli('status --json');
    const result = JSON.parse(output);

    expect(result).toHaveProperty('totalNotes');
    expect(result).toHaveProperty('totalChunks');
    expect(result).toHaveProperty('byTier');
    expect(result).toHaveProperty('byType');
    expect(result).toHaveProperty('embeddingModel');
    expect(result).toHaveProperty('lastIndexed');
    expect(result).toHaveProperty('staleNotes');
    expect(typeof result.totalNotes).toBe('number');
    expect(result.totalNotes).toBeGreaterThanOrEqual(2);
  });
});
