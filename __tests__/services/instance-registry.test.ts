import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadRegistry,
  registerInstance,
  listInstances,
  pruneStaleInstances,
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

    it('supports multiple instances', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');
      registerInstance(registryDir, '/projects/bar/.brain', 'bar');

      const reg = loadRegistry(registryDir);
      expect(reg.instances).toHaveLength(2);
    });
  });

  describe('listInstances', () => {
    it('includes global instance and registered locals', () => {
      registerInstance(registryDir, '/projects/foo/.brain', 'foo');

      const list = listInstances(registryDir);
      expect(list).toHaveLength(1);
      expect(list[0].path).toBe('/projects/foo/.brain');
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
});
