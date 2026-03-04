import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  getConfigDir,
  getDataDir,
  getConfigPath,
  resolveInstance,
  migrateFromEnvPaths,
} from '../../src/services/config.js';
import type { InstancePaths } from '../../src/services/config.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'brain-test-'));
}

function makeLocalInstance(root: string): InstancePaths {
  return { root, isLocal: true, source: `local:${root}` };
}

describe('config service', () => {
  let instanceRoot: string;

  beforeEach(() => {
    instanceRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(instanceRoot, { recursive: true, force: true });
  });

  describe('getDefaultConfig', () => {
    it('returns sensible defaults', () => {
      const config = getDefaultConfig(instanceRoot);

      expect(config.notesDir).toBe(join(homedir(), 'brain'));
      expect(config.embedder).toBe('local');
      expect(config.fusionWeights).toEqual({ bm25: 0.3, vector: 0.7 });
      expect(config.dbPath).toBe(join(instanceRoot, 'brain.db'));
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
      const instance = makeLocalInstance(instanceRoot);
      const config = loadConfig(instance);

      expect(config.embedder).toBe('local');
      expect(config.fusionWeights).toEqual({ bm25: 0.3, vector: 0.7 });
      expect(config.dbPath).toBe(join(instanceRoot, 'brain.db'));
      expect(config.notesDir).toBe(join(instanceRoot, 'notes'));
    });

    it('merges file contents with defaults', () => {
      writeFileSync(
        join(instanceRoot, 'config.json'),
        JSON.stringify({ notesDir: '/custom/notes' })
      );

      const instance = makeLocalInstance(instanceRoot);
      const config = loadConfig(instance);

      expect(config.notesDir).toBe('/custom/notes');
      expect(config.embedder).toBe('local');
      expect(config.fusionWeights).toEqual({ bm25: 0.3, vector: 0.7 });
    });
  });

  describe('saveConfig and loadConfig round-trip', () => {
    it('persists full config and loads it back', () => {
      const saved = {
        notesDir: '/my/notes',
        dbPath: '/my/db.sqlite',
        embedder: 'ollama' as const,
        fusionWeights: { bm25: 0.5, vector: 0.5 },
      };

      saveConfig(saved, instanceRoot);
      const instance = makeLocalInstance(instanceRoot);
      const loaded = loadConfig(instance);

      expect(loaded).toEqual(saved);
    });

    it('partial updates merge with existing config', () => {
      saveConfig({ notesDir: '/first' }, instanceRoot);
      saveConfig({ embedder: 'remote' }, instanceRoot);

      const instance = makeLocalInstance(instanceRoot);
      const loaded = loadConfig(instance);

      expect(loaded.notesDir).toBe('/first');
      expect(loaded.embedder).toBe('remote');
      expect(loaded.fusionWeights).toEqual({ bm25: 0.3, vector: 0.7 });
    });
  });

  describe('getConfigDir and getDataDir', () => {
    it('getConfigDir returns the directory path', () => {
      const dir = getConfigDir(instanceRoot);
      expect(dir).toBe(instanceRoot);
    });

    it('getDataDir returns the directory path', () => {
      const dir = getDataDir(instanceRoot);
      expect(dir).toBe(instanceRoot);
    });

    it('getConfigDir creates directory if it does not exist', () => {
      const nested = join(instanceRoot, 'nested', 'deep');
      const dir = getConfigDir(nested);
      expect(dir).toBe(nested);

      writeFileSync(join(nested, 'test.txt'), 'ok');
      expect(readFileSync(join(nested, 'test.txt'), 'utf-8')).toBe('ok');
    });

    it('getDataDir creates directory if it does not exist', () => {
      const nested = join(instanceRoot, 'nested', 'deep');
      const dir = getDataDir(nested);
      expect(dir).toBe(nested);

      writeFileSync(join(nested, 'test.txt'), 'ok');
      expect(readFileSync(join(nested, 'test.txt'), 'utf-8')).toBe('ok');
    });
  });

  describe('getConfigPath', () => {
    it('returns the path to config.json within instance root', () => {
      const path = getConfigPath(instanceRoot);
      expect(path).toBe(join(instanceRoot, 'config.json'));
    });
  });

  describe('validation', () => {
    it('throws on invalid embedder value', () => {
      expect(() =>
        // @ts-expect-error testing invalid input
        saveConfig({ embedder: 'invalid' }, instanceRoot)
      ).toThrow(/invalid embedder/i);
    });

    it('throws when fusion weights do not sum to 1.0', () => {
      expect(() => saveConfig({ fusionWeights: { bm25: 0.5, vector: 0.3 } }, instanceRoot)).toThrow(
        /fusion weights must sum to 1/i
      );
    });

    it('accepts fusion weights that sum to 1.0 within float tolerance', () => {
      expect(() =>
        saveConfig({ fusionWeights: { bm25: 0.1, vector: 0.9 } }, instanceRoot)
      ).not.toThrow();
    });

    it('uses local default notesDir when no local config exists', () => {
      const instance = makeLocalInstance(instanceRoot);
      const loaded = loadConfig(instance);
      expect(loaded.notesDir).toBe(join(instanceRoot, 'notes'));
    });

    it('uses global default notesDir when saving without explicit notesDir', () => {
      saveConfig({ embedder: 'local' }, instanceRoot);
      const instance = makeLocalInstance(instanceRoot);
      const loaded = loadConfig(instance);
      expect(loaded.notesDir).toBe(join(homedir(), 'brain'));
    });
  });
});

describe('resolveInstance', () => {
  it('returns global instance when no .brain/ found in ancestors', () => {
    const instance = resolveInstance({ cwd: tmpdir() });
    expect(instance.root).toBe(join(homedir(), '.brain'));
    expect(instance.isLocal).toBe(false);
    expect(instance.source).toBe('global');
  });

  it('finds .brain/ in CWD', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'brain-proj-'));
    const brainDir = join(projectDir, '.brain');
    mkdirSync(brainDir);

    const instance = resolveInstance({ cwd: projectDir });
    expect(instance.root).toBe(brainDir);
    expect(instance.isLocal).toBe(true);
    expect(instance.source).toBe(`local:${brainDir}`);

    rmSync(projectDir, { recursive: true, force: true });
  });

  it('finds .brain/ in ancestor directory', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'brain-proj-'));
    const brainDir = join(projectDir, '.brain');
    mkdirSync(brainDir);
    const subDir = join(projectDir, 'src', 'deep');
    mkdirSync(subDir, { recursive: true });

    const instance = resolveInstance({ cwd: subDir });
    expect(instance.root).toBe(brainDir);
    expect(instance.isLocal).toBe(true);

    rmSync(projectDir, { recursive: true, force: true });
  });

  it('respects forceGlobal option', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'brain-proj-'));
    mkdirSync(join(projectDir, '.brain'));

    const instance = resolveInstance({ cwd: projectDir, forceGlobal: true });
    expect(instance.root).toBe(join(homedir(), '.brain'));
    expect(instance.isLocal).toBe(false);
    expect(instance.source).toBe('flag:--global');

    rmSync(projectDir, { recursive: true, force: true });
  });

  it('respects instancePath option', () => {
    const customDir = mkdtempSync(join(tmpdir(), 'brain-custom-'));

    const instance = resolveInstance({ instancePath: customDir });
    expect(instance.root).toBe(customDir);
    expect(instance.isLocal).toBe(true);
    expect(instance.source).toBe('flag:--instance');

    rmSync(customDir, { recursive: true, force: true });
  });

  it('instancePath takes priority over forceGlobal', () => {
    const customDir = mkdtempSync(join(tmpdir(), 'brain-custom-'));

    const instance = resolveInstance({ instancePath: customDir, forceGlobal: true });
    expect(instance.root).toBe(customDir);

    rmSync(customDir, { recursive: true, force: true });
  });
});

describe('migrateFromEnvPaths', () => {
  it('migrates config and db from old locations', () => {
    const oldConfigDir = mkdtempSync(join(tmpdir(), 'brain-old-config-'));
    const oldDataDir = mkdtempSync(join(tmpdir(), 'brain-old-data-'));
    const newGlobalDir = mkdtempSync(join(tmpdir(), 'brain-new-global-'));

    writeFileSync(join(oldConfigDir, 'config.json'), JSON.stringify({ embedder: 'ollama' }));
    writeFileSync(join(oldDataDir, 'brain.db'), 'fake-db-content');

    const migrated = migrateFromEnvPaths(oldConfigDir, oldDataDir, newGlobalDir);

    expect(migrated).toBe(true);
    expect(existsSync(join(newGlobalDir, 'config.json'))).toBe(true);
    expect(existsSync(join(newGlobalDir, 'brain.db'))).toBe(true);

    const config = JSON.parse(readFileSync(join(newGlobalDir, 'config.json'), 'utf-8'));
    expect(config.embedder).toBe('ollama');
    expect(config.dbPath).toBe(join(newGlobalDir, 'brain.db'));

    rmSync(oldConfigDir, { recursive: true, force: true });
    rmSync(oldDataDir, { recursive: true, force: true });
    rmSync(newGlobalDir, { recursive: true, force: true });
  });

  it('returns false when no old data exists', () => {
    const result = migrateFromEnvPaths(
      '/nonexistent/config',
      '/nonexistent/data',
      '/nonexistent/global'
    );
    expect(result).toBe(false);
  });

  it('migrates only config when db does not exist', () => {
    const oldConfigDir = mkdtempSync(join(tmpdir(), 'brain-old-config-'));
    const newGlobalDir = mkdtempSync(join(tmpdir(), 'brain-new-global-'));

    writeFileSync(join(oldConfigDir, 'config.json'), JSON.stringify({ notesDir: '/my/notes' }));

    const migrated = migrateFromEnvPaths(oldConfigDir, '/nonexistent/data', newGlobalDir);

    expect(migrated).toBe(true);
    expect(existsSync(join(newGlobalDir, 'config.json'))).toBe(true);
    expect(existsSync(join(newGlobalDir, 'brain.db'))).toBe(false);

    rmSync(oldConfigDir, { recursive: true, force: true });
    rmSync(newGlobalDir, { recursive: true, force: true });
  });

  it('migrates only db when config does not exist', () => {
    const oldDataDir = mkdtempSync(join(tmpdir(), 'brain-old-data-'));
    const newGlobalDir = mkdtempSync(join(tmpdir(), 'brain-new-global-'));

    writeFileSync(join(oldDataDir, 'brain.db'), 'fake-db-content');

    const migrated = migrateFromEnvPaths('/nonexistent/config', oldDataDir, newGlobalDir);

    expect(migrated).toBe(true);
    expect(existsSync(join(newGlobalDir, 'brain.db'))).toBe(true);
    expect(existsSync(join(newGlobalDir, 'config.json'))).toBe(false);

    rmSync(oldDataDir, { recursive: true, force: true });
    rmSync(newGlobalDir, { recursive: true, force: true });
  });
});
