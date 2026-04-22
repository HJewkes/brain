import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AoConfigWatcher,
  getAoConfigWatcher,
  resetAoConfigWatcherForTests,
} from '../../src/services/ao-config-watcher.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ao-config-watcher-'));
}

function writeConfig(dir: string, body: Record<string, unknown>): string {
  const path = join(dir, 'ao.config.json');
  writeFileSync(path, JSON.stringify(body), 'utf-8');
  return path;
}

describe('AoConfigWatcher', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
    resetAoConfigWatcherForTests();
  });

  afterEach(() => {
    resetAoConfigWatcherForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined defaults when file is missing', () => {
    const watcher = new AoConfigWatcher(join(dir, 'ao.config.json'));
    expect(watcher.snapshot).toEqual({
      maxBudgetUsd: undefined,
      wipLimit: undefined,
      reviewThreshold: undefined,
    });
  });

  it('reads defaults from the defaults section', () => {
    const path = writeConfig(dir, {
      defaults: { maxBudgetUsd: 12.5, wipLimit: 6, reviewThreshold: 8 },
    });
    const watcher = new AoConfigWatcher(path);
    expect(watcher.snapshot).toEqual({
      maxBudgetUsd: 12.5,
      wipLimit: 6,
      reviewThreshold: 8,
    });
  });

  it('falls back to enforcement.wipLimit when defaults.wipLimit is absent', () => {
    const path = writeConfig(dir, { enforcement: { wipLimit: 4 } });
    const watcher = new AoConfigWatcher(path);
    expect(watcher.snapshot.wipLimit).toBe(4);
  });

  it('prefers defaults.wipLimit over enforcement.wipLimit', () => {
    const path = writeConfig(dir, {
      enforcement: { wipLimit: 4 },
      defaults: { wipLimit: 9 },
    });
    const watcher = new AoConfigWatcher(path);
    expect(watcher.snapshot.wipLimit).toBe(9);
  });

  it('reload() picks up edits made after construction', () => {
    const path = writeConfig(dir, { defaults: { maxBudgetUsd: 1 } });
    const watcher = new AoConfigWatcher(path);
    expect(watcher.snapshot.maxBudgetUsd).toBe(1);

    writeConfig(dir, { defaults: { maxBudgetUsd: 2 } });
    watcher.reload();
    expect(watcher.snapshot.maxBudgetUsd).toBe(2);
    expect(watcher.reloads).toBe(1);
  });

  it('invokes onReload callback with fresh values', () => {
    const path = writeConfig(dir, { defaults: { reviewThreshold: 3 } });
    let observed: number | undefined;
    const watcher = new AoConfigWatcher(path, (next) => {
      observed = next.reviewThreshold;
    });
    writeConfig(dir, { defaults: { reviewThreshold: 7 } });
    watcher.reload();
    expect(observed).toBe(7);
  });

  it('keeps previous defaults when file becomes invalid JSON', () => {
    const path = writeConfig(dir, { defaults: { wipLimit: 5 } });
    const watcher = new AoConfigWatcher(path);
    writeFileSync(path, '{ not valid json', 'utf-8');
    watcher.reload();
    expect(watcher.snapshot).toEqual({
      maxBudgetUsd: undefined,
      wipLimit: undefined,
      reviewThreshold: undefined,
    });
  });

  it('getAoConfigWatcher returns the same instance across calls', () => {
    writeConfig(dir, { defaults: { maxBudgetUsd: 3 } });
    const a = getAoConfigWatcher(dir);
    const b = getAoConfigWatcher(dir);
    expect(a).toBe(b);
    expect(a.snapshot.maxBudgetUsd).toBe(3);
  });

  it('start() is idempotent and stop() clears resources', () => {
    const path = writeConfig(dir, { defaults: { maxBudgetUsd: 1 } });
    const watcher = new AoConfigWatcher(path);
    watcher.start();
    watcher.start();
    expect(() => watcher.stop()).not.toThrow();
    expect(() => watcher.stop()).not.toThrow();
  });
});
