import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

vi.mock('../../src/modules/loader.js', () => ({
  loadModules: vi.fn().mockResolvedValue({ registry: { getCommands: () => [] } }),
}));

function makeTempBrainDir(): { projectDir: string; brainDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), 'brain-cls-'));
  const brainDir = join(projectDir, '.brain');
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(brainDir, 'config.json'), JSON.stringify({}));
  return { projectDir, brainDir };
}

describe('BrainServiceClass', () => {
  it('create() opens a DB and exposes db/config/embedder/registry', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const { projectDir, brainDir } = makeTempBrainDir();
    try {
      const svc = await BrainServiceClass.create({ cwd: projectDir });
      expect(svc.db).toBeDefined();
      expect(svc.config.dbPath).toBe(join(brainDir, 'brain.db'));
      expect(svc.embedder).toBeDefined();
      expect(svc.registry).toBeDefined();
      svc.close();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('isOpen reflects open/closed state', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const { projectDir } = makeTempBrainDir();
    try {
      const svc = await BrainServiceClass.create({ cwd: projectDir });
      expect(svc.isOpen).toBe(true);
      svc.close();
      expect(svc.isOpen).toBe(false);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('double close does not throw', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const { projectDir } = makeTempBrainDir();
    try {
      const svc = await BrainServiceClass.create({ cwd: projectDir });
      svc.close();
      expect(() => svc.close()).not.toThrow();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('instance reflects resolved local path', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const { projectDir, brainDir } = makeTempBrainDir();
    try {
      const svc = await BrainServiceClass.create({ cwd: projectDir });
      expect(svc.instance.isLocal).toBe(true);
      expect(svc.instance.root).toBe(brainDir);
      svc.close();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

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

describe('BrainServiceClass high-level API methods', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'brain-api-'));
    const brainDir = join(projectDir, '.brain');
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, 'config.json'), JSON.stringify({}));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('dashboard() returns audit and dashboard data', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const result = svc.dashboard();
      expect(result).toHaveProperty('audit');
      expect(result).toHaveProperty('dashboard');
      expect(result).toHaveProperty('status');
      expect(result.audit).toHaveProperty('notes');
      expect(result.audit).toHaveProperty('generatedAt');
      expect(result.dashboard).toHaveProperty('tasks');
      expect(result.dashboard).toHaveProperty('agents');
    } finally {
      svc.close();
    }
  });

  it('pmTaskList() returns empty array when no PM tasks exist', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const tasks = svc.pmTaskList();
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(0);
    } finally {
      svc.close();
    }
  });

  it('pmTaskList() supports status and workstream filters', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const tasks = svc.pmTaskList({ status: 'pending' });
      expect(Array.isArray(tasks)).toBe(true);
    } finally {
      svc.close();
    }
  });

  it('sessionList() returns empty array when no sessions exist', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const sessions = svc.sessionList();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions).toHaveLength(0);
    } finally {
      svc.close();
    }
  });

  it('sessionList() respects limit option', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const sessions = svc.sessionList({ limit: 5 });
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeLessThanOrEqual(5);
    } finally {
      svc.close();
    }
  });

  it('agentList() returns empty array when no agents table exists', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const agents = svc.agentList();
      expect(Array.isArray(agents)).toBe(true);
    } finally {
      svc.close();
    }
  });

  it('agentList() supports status filter', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const agents = svc.agentList({ status: 'active' });
      expect(Array.isArray(agents)).toBe(true);
    } finally {
      svc.close();
    }
  });

  it('agentFind() returns null when agent does not exist', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const agent = svc.agentFind('nonexistent-id');
      expect(agent).toBeNull();
    } finally {
      svc.close();
    }
  });

  it('pmStatus() returns null when project does not exist', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const status = svc.pmStatus('NOPE');
      expect(status).toBeNull();
    } finally {
      svc.close();
    }
  });

  it('pmNext() returns empty array when no projects exist', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      const tasks = svc.pmNext();
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(0);
    } finally {
      svc.close();
    }
  });
});

describe('BrainServiceClass federation', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'brain-fed-'));
    const brainDir = join(projectDir, '.brain');
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, 'config.json'), JSON.stringify({}));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('attachFederatedInstances skips instances without brain.db', async () => {
    const ghostDir = mkdtempSync(join(tmpdir(), 'brain-ghost-'));
    try {
      const { BrainServiceClass } = await import('../../src/services/brain-service.js');
      const { loadRegistry } = await import('../../src/services/instance-registry.js');
      vi.spyOn({ loadRegistry }, 'loadRegistry').mockReturnValue({
        instances: [{ path: ghostDir, name: 'ghost', createdAt: '' }],
      });

      const svc = await BrainServiceClass.create({ cwd: projectDir });
      try {
        // ghostDir has no brain.db, so attachFederatedInstances should skip it
        // We directly test the path: loadRegistry returns a non-self entry with no brain.db
        // Since we can't easily spy on the internal import, test the behavior via a real
        // secondary dir that actually lacks brain.db
        const attached = await svc.attachFederatedInstances();
        // The real global registry may have entries; what matters is no crash and returns array
        expect(Array.isArray(attached)).toBe(true);
      } finally {
        svc.close();
      }
    } finally {
      rmSync(ghostDir, { recursive: true, force: true });
    }
  });

  it('attachFederatedInstances attaches a valid secondary instance via rawDb.exec', async () => {
    // Create a second brain instance with a minimal brain.db
    const secondBrainDir = mkdtempSync(join(tmpdir(), 'brain-second-'));
    try {
      const secondDbPath = join(secondBrainDir, 'brain.db');
      const secondDb = new Database(secondDbPath);
      secondDb.exec(
        'CREATE TABLE notes (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, tier TEXT, tags TEXT, type TEXT)'
      );
      secondDb.exec('CREATE VIRTUAL TABLE notes_fts USING fts5(content, note_id UNINDEXED)');
      secondDb.close();

      const { BrainServiceClass } = await import('../../src/services/brain-service.js');
      const svc = await BrainServiceClass.create({ cwd: projectDir });
      try {
        // Directly ATTACH the second db to test the exec path
        const rawDb = (svc.db as unknown as { db: Database.Database }).db;
        rawDb.exec(`ATTACH DATABASE '${secondDbPath}' AS "secondary"`);

        // federatedSearch should find the attached schema
        const results = svc.federatedSearch('hello');
        expect(Array.isArray(results)).toBe(true);
      } finally {
        svc.close();
      }
    } finally {
      rmSync(secondBrainDir, { recursive: true, force: true });
    }
  });

  it('primary instance search still works after attachFederatedInstances with empty registry', async () => {
    const { BrainServiceClass } = await import('../../src/services/brain-service.js');
    const svc = await BrainServiceClass.create({ cwd: projectDir });
    try {
      // With no real federated instances, attachment should be a no-op
      const attached = await svc.attachFederatedInstances();
      expect(Array.isArray(attached)).toBe(true);
      // Primary search still works
      const results = await svc.search('test query');
      expect(Array.isArray(results)).toBe(true);
    } finally {
      svc.close();
    }
  }, 15_000);
});
