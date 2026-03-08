import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  readResourceFastPath,
  listResourcesFastPath,
} from '../../../../src/modules/workflow/engine/fast-path.js';
import type { FastPathResource } from '../../../../src/modules/workflow/types.js';

let resourceDir: string;

beforeEach(() => {
  resourceDir = join(tmpdir(), `wf-fastpath-${randomUUID()}`);
  mkdirSync(join(resourceDir, 'modules', 'workflow', 'resources'), { recursive: true });
});

afterEach(() => {
  if (existsSync(resourceDir)) {
    rmSync(resourceDir, { recursive: true, force: true });
  }
});

function resourcePath(): string {
  return join(resourceDir, 'modules', 'workflow', 'resources');
}

function writeResource(id: string, data: FastPathResource): void {
  writeFileSync(join(resourcePath(), `${id}.json`), JSON.stringify(data));
}

function makeFastPathResource(overrides: Partial<FastPathResource> = {}): FastPathResource {
  return {
    id: overrides.id ?? `res-${randomUUID().slice(0, 8)}`,
    type: overrides.type ?? 'worktree',
    project: overrides.project ?? 'SDK',
    status: overrides.status ?? 'active',
    data: overrides.data ?? { path: '/tmp/sdk-worktree', branch: 'feat/mock-infra' },
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

// --- AC-12: Fast-Path Hook Access ---

describe('readResourceFastPath', () => {
  test('AC-12: returns resource data without opening SQLite database', () => {
    const resource = makeFastPathResource({ id: 'res-001' });
    writeResource('res-001', resource);

    const result = readResourceFastPath(resourceDir, 'res-001');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('res-001');
    expect(result!.type).toBe('worktree');
    expect(result!.project).toBe('SDK');
  });

  test('AC-12: returns null when no sidecar file exists (graceful degradation)', () => {
    const result = readResourceFastPath(resourceDir, 'nonexistent');
    expect(result).toBeNull();
  });

  test('AC-12: returns null for corrupted JSON without throwing', () => {
    const corruptPath = join(resourcePath(), 'corrupt.json');
    writeFileSync(corruptPath, '{invalid json!!!');

    const result = readResourceFastPath(resourceDir, 'corrupt');
    expect(result).toBeNull();
  });
});

describe('listResourcesFastPath', () => {
  test('AC-12: returns all resources when no type filter specified', () => {
    writeResource('r1', makeFastPathResource({ id: 'r1', type: 'worktree' }));
    writeResource('r2', makeFastPathResource({ id: 'r2', type: 'branch' }));

    const results = listResourcesFastPath(resourceDir);
    expect(results).toHaveLength(2);
  });

  test('AC-12: filters resources by type when specified', () => {
    writeResource('r1', makeFastPathResource({ id: 'r1', type: 'worktree' }));
    writeResource('r2', makeFastPathResource({ id: 'r2', type: 'branch' }));
    writeResource('r3', makeFastPathResource({ id: 'r3', type: 'worktree' }));

    const results = listResourcesFastPath(resourceDir, 'worktree');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.type === 'worktree')).toBe(true);
  });

  test('AC-12: returns empty array when no sidecar files exist', () => {
    const emptyDir = join(tmpdir(), `wf-empty-${randomUUID()}`);
    mkdirSync(join(emptyDir, 'modules', 'workflow', 'resources'), { recursive: true });

    const results = listResourcesFastPath(emptyDir);
    expect(results).toEqual([]);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  test('AC-12: skips corrupted files and returns valid resources', () => {
    writeResource('good', makeFastPathResource({ id: 'good' }));
    writeFileSync(join(resourcePath(), 'bad.json'), 'not valid json');

    const results = listResourcesFastPath(resourceDir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('good');
  });
});

// --- AC-NF2: Fast-Path Performance ---

describe('fast-path performance', () => {
  test('AC-NF2: reads 50 resource files in under 50ms', () => {
    for (let i = 0; i < 50; i++) {
      writeResource(`perf-${i}`, makeFastPathResource({ id: `perf-${i}` }));
    }

    const start = performance.now();
    const results = listResourcesFastPath(resourceDir);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(50);
    expect(elapsed).toBeLessThan(50);
  });
});
