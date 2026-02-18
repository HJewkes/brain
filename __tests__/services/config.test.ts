import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  getConfigDir,
  getDataDir,
  getConfigPath,
} from '../../src/services/config.js';

function makeTempDirs() {
  const configDir = mkdtempSync(join(tmpdir(), 'brain-config-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'brain-data-'));
  return { configDir, dataDir };
}

describe('config service', () => {
  let configDir: string;
  let dataDir: string;

  beforeEach(() => {
    const dirs = makeTempDirs();
    configDir = dirs.configDir;
    dataDir = dirs.dataDir;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('getDefaultConfig', () => {
    it('returns sensible defaults', () => {
      const config = getDefaultConfig(dataDir);

      expect(config.notesDir).toBe(join(homedir(), 'brain'));
      expect(config.embedder).toBe('local');
      expect(config.fusionWeights).toEqual({ bm25: 0.3, vector: 0.7 });
      expect(config.dbPath).toBe(join(dataDir, 'brain.db'));
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
      const config = loadConfig(configDir, dataDir);

      expect(config.notesDir).toBe(join(homedir(), 'brain'));
      expect(config.embedder).toBe('local');
      expect(config.fusionWeights).toEqual({ bm25: 0.3, vector: 0.7 });
      expect(config.dbPath).toBe(join(dataDir, 'brain.db'));
    });

    it('merges file contents with defaults', () => {
      const configPath = join(configDir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ notesDir: '/custom/notes' }));

      const config = loadConfig(configDir, dataDir);

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

      saveConfig(saved, configDir, dataDir);
      const loaded = loadConfig(configDir, dataDir);

      expect(loaded).toEqual(saved);
    });

    it('partial updates merge with existing config', () => {
      saveConfig({ notesDir: '/first' }, configDir, dataDir);
      saveConfig({ embedder: 'remote' }, configDir, dataDir);

      const loaded = loadConfig(configDir, dataDir);

      expect(loaded.notesDir).toBe('/first');
      expect(loaded.embedder).toBe('remote');
      expect(loaded.fusionWeights).toEqual({ bm25: 0.3, vector: 0.7 });
    });
  });

  describe('getConfigDir and getDataDir', () => {
    it('getConfigDir returns the config directory path', () => {
      const dir = getConfigDir(configDir);
      expect(dir).toBe(configDir);
    });

    it('getDataDir returns the data directory path', () => {
      const dir = getDataDir(dataDir);
      expect(dir).toBe(dataDir);
    });

    it('getConfigDir creates directory if it does not exist', () => {
      const nested = join(configDir, 'nested', 'deep');
      const dir = getConfigDir(nested);
      expect(dir).toBe(nested);

      // Verify directory was created by writing a file
      writeFileSync(join(nested, 'test.txt'), 'ok');
      expect(readFileSync(join(nested, 'test.txt'), 'utf-8')).toBe('ok');
    });

    it('getDataDir creates directory if it does not exist', () => {
      const nested = join(dataDir, 'nested', 'deep');
      const dir = getDataDir(nested);
      expect(dir).toBe(nested);

      writeFileSync(join(nested, 'test.txt'), 'ok');
      expect(readFileSync(join(nested, 'test.txt'), 'utf-8')).toBe('ok');
    });
  });

  describe('getConfigPath', () => {
    it('returns the path to config.json within config dir', () => {
      const path = getConfigPath(configDir);
      expect(path).toBe(join(configDir, 'config.json'));
    });
  });

  describe('validation', () => {
    it('throws on invalid embedder value', () => {
      expect(() =>
        // @ts-expect-error testing invalid input
        saveConfig({ embedder: 'invalid' }, configDir, dataDir)
      ).toThrow(/invalid embedder/i);
    });

    it('throws when fusion weights do not sum to 1.0', () => {
      expect(() =>
        saveConfig({ fusionWeights: { bm25: 0.5, vector: 0.3 } }, configDir, dataDir)
      ).toThrow(/fusion weights must sum to 1/i);
    });

    it('accepts fusion weights that sum to 1.0 within float tolerance', () => {
      expect(() =>
        saveConfig({ fusionWeights: { bm25: 0.1, vector: 0.9 } }, configDir, dataDir)
      ).not.toThrow();
    });

    it('uses default notesDir when not provided', () => {
      saveConfig({ embedder: 'local' }, configDir, dataDir);
      const loaded = loadConfig(configDir, dataDir);
      expect(loaded.notesDir).toBe(join(homedir(), 'brain'));
    });
  });
});
