import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveHookConfig, DEFAULT_HOOK_CONFIG } from '../../src/hooks/config.js';
import type { BrainConfig } from '../../src/types.js';

// deepMerge is not exported, but we test its behaviour via resolveHookConfig

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `hooks-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('DEFAULT_HOOK_CONFIG', () => {
  it('has all enforcement fields set to their off-state defaults', () => {
    const e = DEFAULT_HOOK_CONFIG.enforcement;
    expect(e.ownership).toBe(false);
    expect(e.dod).toBe(false);
    expect(e.wipLimit).toBe(0);
    expect(e.workspaceClean).toBe(false);
    expect(e.gitSafety).toBe(false);
    expect(e.gitSafetyBlockOnce).toBe(true);
    expect(e.brainResources).toBe(false);
  });

  it('uses .claude/ownership.json as the default ownership manifest path', () => {
    expect(DEFAULT_HOOK_CONFIG.ownershipManifest).toBe('.claude/ownership.json');
  });
});

describe('resolveHookConfig', () => {
  it('returns defaults when no config files exist', () => {
    const config = resolveHookConfig('/nonexistent/path/that/does/not/exist');
    expect(config.enforcement.wipLimit).toBe(0);
    expect(config.enforcement.ownership).toBe(false);
    expect(config.enforcement.dod).toBe(false);
  });

  it('returns gitSafety defaults when no config files exist', () => {
    const config = resolveHookConfig('/nonexistent/path/that/does/not/exist');
    expect(config.enforcement.gitSafety).toBe(false);
    expect(config.enforcement.gitSafetyBlockOnce).toBe(true);
  });

  describe('project-level ao.config.json', () => {
    let tmpDir: string;
    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('merges project config over defaults', () => {
      tmpDir = makeTmpDir();
      writeFileSync(
        join(tmpDir, 'ao.config.json'),
        JSON.stringify({ enforcement: { wipLimit: 3 } })
      );

      const config = resolveHookConfig(tmpDir);
      expect(config.enforcement.wipLimit).toBe(3);
      // Other fields keep their defaults
      expect(config.enforcement.ownership).toBe(false);
    });

    it('enables enforcement flags from project config', () => {
      tmpDir = makeTmpDir();
      writeFileSync(
        join(tmpDir, 'ao.config.json'),
        JSON.stringify({ enforcement: { gitSafety: true, ownership: true } })
      );

      const config = resolveHookConfig(tmpDir);
      expect(config.enforcement.gitSafety).toBe(true);
      expect(config.enforcement.ownership).toBe(true);
      expect(config.enforcement.wipLimit).toBe(0); // unchanged default
    });

    it('merges nested objects without clobbering sibling fields', () => {
      tmpDir = makeTmpDir();
      writeFileSync(
        join(tmpDir, 'ao.config.json'),
        JSON.stringify({ enforcement: { wipLimit: 5 } })
      );

      const config = resolveHookConfig(tmpDir);
      // enforcement.gitSafetyBlockOnce should still be true (the default)
      expect(config.enforcement.gitSafetyBlockOnce).toBe(true);
    });

    it('overrides ownershipManifest from project config', () => {
      tmpDir = makeTmpDir();
      writeFileSync(
        join(tmpDir, 'ao.config.json'),
        JSON.stringify({ ownershipManifest: '.custom/manifest.json' })
      );

      const config = resolveHookConfig(tmpDir);
      expect(config.ownershipManifest).toBe('.custom/manifest.json');
    });
  });

  describe('overrides parameter', () => {
    it('applies overrides on top of config file values', () => {
      const config = resolveHookConfig('/nonexistent', {
        enforcement: { wipLimit: 2 },
      });
      expect(config.enforcement.wipLimit).toBe(2);
      expect(config.enforcement.ownership).toBe(false); // still default
    });

    it('overrides take precedence over project config file', () => {
      const tmpDir = makeTmpDir();
      try {
        writeFileSync(
          join(tmpDir, 'ao.config.json'),
          JSON.stringify({ enforcement: { wipLimit: 3 } })
        );

        const config = resolveHookConfig(tmpDir, { enforcement: { wipLimit: 99 } });
        expect(config.enforcement.wipLimit).toBe(99);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('undefined override values do not overwrite existing values', () => {
      const config = resolveHookConfig('/nonexistent', {
        enforcement: { wipLimit: undefined as unknown as number },
      });
      // wipLimit should stay at 0 (default) since the override is undefined
      expect(config.enforcement.wipLimit).toBe(0);
    });
  });

  describe('brainConfig parameter', () => {
    it('applies hook settings from BrainConfig', () => {
      const brainConfig: BrainConfig = {
        notesDir: '/tmp',
        dbPath: '/tmp/brain.db',
        embedder: 'local',
        fusionWeights: { bm25: 0.3, vector: 0.7 },
        hooks: {
          enforcement: { ownership: true, wipLimit: 6 },
          ownershipManifest: '.brain/ownership.json',
        },
      };

      const config = resolveHookConfig('/nonexistent', undefined, brainConfig);
      expect(config.enforcement.ownership).toBe(true);
      expect(config.enforcement.wipLimit).toBe(6);
      expect(config.ownershipManifest).toBe('.brain/ownership.json');
    });

    it('brainConfig takes precedence over ao.config.json', () => {
      const tmpDir = makeTmpDir();
      try {
        writeFileSync(
          join(tmpDir, 'ao.config.json'),
          JSON.stringify({ enforcement: { wipLimit: 3 } })
        );

        const brainConfig: BrainConfig = {
          notesDir: '/tmp',
          dbPath: '/tmp/brain.db',
          embedder: 'local',
          fusionWeights: { bm25: 0.3, vector: 0.7 },
          hooks: { enforcement: { wipLimit: 8 } },
        };

        const config = resolveHookConfig(tmpDir, undefined, brainConfig);
        expect(config.enforcement.wipLimit).toBe(8);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('explicit overrides take precedence over brainConfig', () => {
      const brainConfig: BrainConfig = {
        notesDir: '/tmp',
        dbPath: '/tmp/brain.db',
        embedder: 'local',
        fusionWeights: { bm25: 0.3, vector: 0.7 },
        hooks: { enforcement: { wipLimit: 8 } },
      };

      const config = resolveHookConfig(
        '/nonexistent',
        { enforcement: { wipLimit: 99 } },
        brainConfig
      );
      expect(config.enforcement.wipLimit).toBe(99);
    });

    it('ignores brainConfig with no hooks field', () => {
      const brainConfig: BrainConfig = {
        notesDir: '/tmp',
        dbPath: '/tmp/brain.db',
        embedder: 'local',
        fusionWeights: { bm25: 0.3, vector: 0.7 },
      };

      const config = resolveHookConfig('/nonexistent', undefined, brainConfig);
      expect(config.enforcement.wipLimit).toBe(0); // default
    });
  });

  describe('deepMerge behaviour (via resolveHookConfig)', () => {
    it('top-level scalar overrides replace defaults', () => {
      const config = resolveHookConfig('/nonexistent', {
        ownershipManifest: 'custom.json',
      });
      expect(config.ownershipManifest).toBe('custom.json');
    });

    it('nested object overrides are merged, not replaced', () => {
      const config = resolveHookConfig('/nonexistent', {
        enforcement: { gitSafety: true },
      });
      // gitSafetyBlockOnce should still have its default value
      expect(config.enforcement.gitSafetyBlockOnce).toBe(true);
      // gitSafety should be overridden
      expect(config.enforcement.gitSafety).toBe(true);
    });

    it('multiple sources are applied left-to-right (later wins)', () => {
      const tmpDir = makeTmpDir();
      try {
        // project config sets wipLimit: 3
        writeFileSync(
          join(tmpDir, 'ao.config.json'),
          JSON.stringify({ enforcement: { wipLimit: 3 } })
        );

        // override sets wipLimit: 10 — should win
        const config = resolveHookConfig(tmpDir, { enforcement: { wipLimit: 10 } });
        expect(config.enforcement.wipLimit).toBe(10);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
