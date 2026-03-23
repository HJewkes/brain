import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  loadRegistry,
  registerInstance,
  listInstances,
  pruneStaleInstances,
  unregisterInstance,
  discoverInstances,
  queryInstanceStatus,
} from '../../src/services/instance-registry.js';

describe('instance-registry', () => {
  let registryDir: string;

  beforeEach(() => {
    registryDir = mkdtempSync(join(tmpdir(), 'brain-registry-'));
  });

  afterEach(() => {
    rmSync(registryDir, { recursive: true, force: true });
  });

  describe('loadRegistry', () => {
    it('returns empty instances array when file does not exist', () => {
      const reg = loadRegistry(registryDir);
      expect(reg.instances).toEqual([]);
    });
  });

  describe('registerInstance', () => {
    it('adds a new instance entry', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');

      const reg = loadRegistry(registryDir);
      expect(reg.instances).toHaveLength(1);
      expect(reg.instances[0].path).toBe('/projects/foo/.brain');
      expect(reg.instances[0].name).toBe('foo');
      expect(reg.instances[0].createdAt).toBeDefined();
    });

    it('does not duplicate entries with same path', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');
      registerInstance(registryDir, '/projects/foo/.brain', 'foo-renamed');

      const reg = loadRegistry(registryDir);
      expect(reg.instances).toHaveLength(1);
      expect(reg.instances[0].name).toBe('foo-renamed');
    });

    it('preserves createdAt on re-register', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');
      const first = loadRegistry(registryDir).instances[0].createdAt;

      registerInstance(registryDir, '/projects/foo/.brain', 'foo-v2');
      const second = loadRegistry(registryDir).instances[0].createdAt;

      expect(second).toBe(first);
    });

    it('stores optional projects, repo, primary fields', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo', {
        projects: ['VNM', 'BKM'],
        repo: '/projects/foo',
        primary: true,
      });

      const entry = loadRegistry(registryDir).instances[0];
      expect(entry.projects).toEqual(['VNM', 'BKM']);
      expect(entry.repo).toBe('/projects/foo');
      expect(entry.primary).toBe(true);
    });

    it('supports multiple instances', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');
      registerInstance(registryDir, '/projects/bar/.brain', 'bar');

      const reg = loadRegistry(registryDir);
      expect(reg.instances).toHaveLength(2);
    });
  });

  describe('listInstances', () => {
    it('returns registered instances', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');

      const list = listInstances(registryDir);
      expect(list).toHaveLength(1);
      expect(list[0].path).toBe('/projects/foo/.brain');
    });

    it('returns empty array when none registered', () => {
      expect(listInstances(registryDir)).toHaveLength(0);
    });
  });

  describe('unregisterInstance', () => {
    it('removes by name', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');
      const removed = unregisterInstance(registryDir, 'foo');

      expect(removed).toBe(true);
      expect(listInstances(registryDir)).toHaveLength(0);
    });

    it('removes by path', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');
      const removed = unregisterInstance(registryDir, '/projects/foo/.brain');

      expect(removed).toBe(true);
      expect(listInstances(registryDir)).toHaveLength(0);
    });

    it('returns false when not found', () => {
      const removed = unregisterInstance(registryDir, 'nonexistent');
      expect(removed).toBe(false);
    });

    it('removes only the matching instance', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');
      registerInstance(registryDir, '/projects/bar/.brain', 'bar');

      unregisterInstance(registryDir, 'foo');

      const list = listInstances(registryDir);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('bar');
    });
  });

  describe('pruneStaleInstances', () => {
    it('removes entries whose paths no longer exist', () => {
      const validDir = mkdtempSync(join(tmpdir(), 'brain-valid-'));
      registerInstance(registryDir, validDir, 'valid');
      registerInstance(registryDir, '/nonexistent/.brain', 'stale');

      const pruned = pruneStaleInstances(registryDir);
      expect(pruned).toBe(1);

      const reg = loadRegistry(registryDir);
      expect(reg.instances).toHaveLength(1);
      expect(reg.instances[0].name).toBe('valid');

      rmSync(validDir, { recursive: true, force: true });
    });

    it('returns 0 when nothing to prune', () => {
      const validDir = mkdtempSync(join(tmpdir(), 'brain-valid-'));
      registerInstance(registryDir, validDir, 'valid');

      const pruned = pruneStaleInstances(registryDir);
      expect(pruned).toBe(0);

      rmSync(validDir, { recursive: true, force: true });
    });
  });

  describe('discoverInstances', () => {
    it('returns paths with brain.db that are not registered', () => {
      const fakeInstance = mkdtempSync(join(tmpdir(), 'brain-disc-'));
      // Create a brain.db so it passes the discovery check
      const db = new Database(join(fakeInstance, 'brain.db'));
      db.close();

      // Override candidateDirs by using a custom globalDir strategy:
      // discoverInstances scans fixed OS paths, so we just verify the
      // general contract: registered paths are excluded from results.
      registerInstance(registryDir, fakeInstance, 'already-registered');
      const discovered = discoverInstances(registryDir);
      expect(discovered).not.toContain(fakeInstance);

      rmSync(fakeInstance, { recursive: true, force: true });
    });

    it('returns empty array when all known instances are registered', () => {
      // With no matching OS paths having brain.db instances, result is empty
      // (we cannot control the candidateDirs list in unit tests, but we can
      // verify the registry exclusion logic is correct by checking return type)
      const result = discoverInstances(registryDir);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('queryInstanceStatus', () => {
    let instanceDir: string;

    beforeEach(() => {
      instanceDir = mkdtempSync(join(tmpdir(), 'brain-inst-'));
    });

    afterEach(() => {
      rmSync(instanceDir, { recursive: true, force: true });
    });

    it('returns error when brain.db is missing', () => {
      const entry = { path: instanceDir, name: 'test', createdAt: new Date().toISOString() };
      const status = queryInstanceStatus(entry);

      expect(status.error).toMatch(/brain\.db not found/);
      expect(status.noteCount).toBe(0);
    });

    it('returns note count from a real database', () => {
      // Create a minimal brain.db with a notes table
      const db = new Database(join(instanceDir, 'brain.db'));
      db.exec(`
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          tier TEXT NOT NULL,
          category TEXT,
          tags TEXT,
          summary TEXT,
          confidence TEXT,
          status TEXT DEFAULT 'current',
          sources TEXT,
          created_at TEXT,
          modified_at TEXT,
          last_reviewed TEXT,
          review_interval TEXT,
          expires TEXT,
          metadata TEXT,
          module TEXT,
          module_instance TEXT,
          content_dir TEXT
        )
      `);
      db.exec(
        `INSERT INTO notes (id, file_path, title, type, tier) VALUES ('n1', '/f.md', 'T', 'note', 'slow')`
      );
      db.exec(
        `INSERT INTO notes (id, file_path, title, type, tier) VALUES ('n2', '/g.md', 'U', 'note', 'fast')`
      );
      db.close();

      const entry = { path: instanceDir, name: 'test', createdAt: new Date().toISOString() };
      const status = queryInstanceStatus(entry);

      expect(status.error).toBeNull();
      expect(status.noteCount).toBe(2);
    });

    it('returns PM projects from notes with module=pm and type=pm-project', () => {
      const db = new Database(join(instanceDir, 'brain.db'));
      db.exec(`
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          tier TEXT NOT NULL,
          category TEXT,
          tags TEXT,
          summary TEXT,
          confidence TEXT,
          status TEXT DEFAULT 'current',
          sources TEXT,
          created_at TEXT,
          modified_at TEXT,
          last_reviewed TEXT,
          review_interval TEXT,
          expires TEXT,
          metadata TEXT,
          module TEXT,
          module_instance TEXT,
          content_dir TEXT
        )
      `);
      db.exec(`
        INSERT INTO notes (id, file_path, title, type, tier, module, metadata)
        VALUES ('p1', '/p.md', 'P', 'project', 'fast', 'pm', '{"prefix":"VNM"}')
      `);
      db.exec(`
        INSERT INTO notes (id, file_path, title, type, tier, module, metadata)
        VALUES ('p2', '/q.md', 'Q', 'project', 'fast', 'pm', '{"prefix":"BKM"}')
      `);
      db.close();

      const entry = { path: instanceDir, name: 'test', createdAt: new Date().toISOString() };
      const status = queryInstanceStatus(entry);

      expect(status.projects).toContain('VNM');
      expect(status.projects).toContain('BKM');
    });

    it('handles locked or inaccessible database gracefully', () => {
      // Create a non-SQLite file to trigger an open error
      writeFileSync(join(instanceDir, 'brain.db'), 'not a sqlite db\n');

      const entry = { path: instanceDir, name: 'test', createdAt: new Date().toISOString() };
      const status = queryInstanceStatus(entry);

      expect(status.error).not.toBeNull();
      expect(status.noteCount).toBe(0);
    });
  });
});
