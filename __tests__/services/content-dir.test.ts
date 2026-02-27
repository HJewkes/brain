import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  resolveContentDir,
  createContentDir,
  archiveContentDir,
  deleteContentDir,
  readIndexableContent,
} from '../../src/services/content-dir.js';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `brain-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('resolveContentDir', () => {
  it('returns path with .d suffix', () => {
    const result = resolveContentDir('/notes', 'my-note');
    expect(result).toBe(join('/notes', 'my-note.d'));
  });
});

describe('createContentDir', () => {
  it('creates directory and returns path', () => {
    const dir = createContentDir(testDir, 'test-note');
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(testDir, 'test-note.d'));
  });

  it('is idempotent', () => {
    const dir1 = createContentDir(testDir, 'test-note');
    const dir2 = createContentDir(testDir, 'test-note');
    expect(dir1).toBe(dir2);
    expect(existsSync(dir1)).toBe(true);
  });
});

describe('archiveContentDir', () => {
  it('moves directory to .archive/', () => {
    const dir = createContentDir(testDir, 'test-note');
    writeFileSync(join(dir, 'file.txt'), 'hello');

    const archivePath = archiveContentDir(testDir, 'test-note');
    expect(archivePath).toBe(join(testDir, '.archive', 'test-note.d'));
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(archivePath!, 'file.txt'))).toBe(true);
  });

  it('returns null if content dir does not exist', () => {
    const result = archiveContentDir(testDir, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('deleteContentDir', () => {
  it('removes directory and returns true', () => {
    const dir = createContentDir(testDir, 'test-note');
    writeFileSync(join(dir, 'file.txt'), 'hello');

    const result = deleteContentDir(testDir, 'test-note');
    expect(result).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('returns false if directory does not exist', () => {
    const result = deleteContentDir(testDir, 'nonexistent');
    expect(result).toBe(false);
  });
});

describe('readIndexableContent', () => {
  it('reads .md, .txt, and .json files', () => {
    const dir = createContentDir(testDir, 'test-note');
    writeFileSync(join(dir, 'a.md'), 'markdown content');
    writeFileSync(join(dir, 'b.txt'), 'text content');
    writeFileSync(join(dir, 'c.json'), '{"key": "value"}');

    const result = readIndexableContent(dir);
    expect(result).toContain('markdown content');
    expect(result).toContain('text content');
    expect(result).toContain('{"key": "value"}');
  });

  it('reads .yaml and .yml files', () => {
    const dir = createContentDir(testDir, 'test-note');
    writeFileSync(join(dir, 'config.yaml'), 'key: value');
    writeFileSync(join(dir, 'data.yml'), 'items: []');

    const result = readIndexableContent(dir);
    expect(result).toContain('key: value');
    expect(result).toContain('items: []');
  });

  it('skips non-indexable files like .png and .bin', () => {
    const dir = createContentDir(testDir, 'test-note');
    writeFileSync(join(dir, 'image.png'), 'binary data');
    writeFileSync(join(dir, 'data.bin'), 'more binary');
    writeFileSync(join(dir, 'readme.md'), 'readable');

    const result = readIndexableContent(dir);
    expect(result).toBe('readable');
    expect(result).not.toContain('binary data');
  });

  it('returns empty string for non-existent directory', () => {
    const result = readIndexableContent(join(testDir, 'does-not-exist'));
    expect(result).toBe('');
  });

  it('concatenates files in sorted order', () => {
    const dir = createContentDir(testDir, 'test-note');
    writeFileSync(join(dir, 'z.txt'), 'last');
    writeFileSync(join(dir, 'a.txt'), 'first');

    const result = readIndexableContent(dir);
    expect(result).toBe('first\n\nlast');
  });
});
