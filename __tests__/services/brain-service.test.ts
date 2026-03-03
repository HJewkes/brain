import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/modules/loader.js', () => ({
  loadModules: vi.fn().mockResolvedValue({ registry: { getCommands: () => [] } }),
}));

describe('brain-service instance wiring', () => {
  let projectDir: string;
  let localBrainDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'brain-svc-'));
    localBrainDir = join(projectDir, '.brain');
    mkdirSync(localBrainDir, { recursive: true });
    writeFileSync(join(localBrainDir, 'config.json'), JSON.stringify({}));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('withDb resolves local instance when cwd has .brain', async () => {
    const { withDb } = await import('../../src/services/brain-service.js');

    const result = await withDb(
      (svc) => ({
        dbPath: svc.config.dbPath,
        isLocal: svc.instance.isLocal,
        source: svc.instance.source,
        root: svc.instance.root,
      }),
      { cwd: projectDir }
    );

    expect(result.isLocal).toBe(true);
    expect(result.root).toBe(localBrainDir);
    expect(result.dbPath).toBe(join(localBrainDir, 'brain.db'));
    expect(result.source).toContain('local:');
  });

  it('withDb falls back to global when no local .brain exists', async () => {
    const noLocalDir = mkdtempSync(join(tmpdir(), 'brain-svc-nope-'));
    try {
      const { withDb } = await import('../../src/services/brain-service.js');

      const result = await withDb(
        (svc) => ({
          isLocal: svc.instance.isLocal,
          source: svc.instance.source,
        }),
        { cwd: noLocalDir }
      );

      expect(result.isLocal).toBe(false);
      expect(result.source).toBe('global');
    } finally {
      rmSync(noLocalDir, { recursive: true, force: true });
    }
  });

  it('withDb respects forceGlobal option', async () => {
    const { withDb } = await import('../../src/services/brain-service.js');

    const result = await withDb(
      (svc) => ({
        isLocal: svc.instance.isLocal,
        source: svc.instance.source,
      }),
      { cwd: projectDir, forceGlobal: true }
    );

    expect(result.isLocal).toBe(false);
    expect(result.source).toBe('flag:--global');
  });

  it('withBrain exposes instance on the service', async () => {
    const { withBrain } = await import('../../src/services/brain-service.js');

    const result = await withBrain(
      (svc) => ({
        hasInstance: svc.instance !== undefined,
        isLocal: svc.instance.isLocal,
        root: svc.instance.root,
      }),
      { cwd: projectDir }
    );

    expect(result.hasInstance).toBe(true);
    expect(result.isLocal).toBe(true);
    expect(result.root).toBe(localBrainDir);
  });

  it('withDb with no args defaults to CWD-based resolution', async () => {
    const { withDb } = await import('../../src/services/brain-service.js');

    const result = await withDb((svc) => ({
      hasInstance: svc.instance !== undefined,
      hasSource: typeof svc.instance.source === 'string',
    }));

    expect(result.hasInstance).toBe(true);
    expect(result.hasSource).toBe(true);
  });
});
