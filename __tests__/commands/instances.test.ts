import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  registerInstance,
  listInstances,
} from '../../src/services/instance-registry.js';

describe('instances command data layer', () => {
  let registryDir: string;

  beforeEach(() => {
    registryDir = mkdtempSync(join(tmpdir(), 'brain-inst-cmd-'));
  });

  afterEach(() => {
    rmSync(registryDir, { recursive: true, force: true });
  });

  it('lists registered instances', () => {
    registerInstance(registryDir, '/projects/a/.brain', 'project-a');
    registerInstance(registryDir, '/projects/b/.brain', 'project-b');

    const instances = listInstances(registryDir);
    expect(instances).toHaveLength(2);
    expect(instances.map(i => i.name)).toEqual(['project-a', 'project-b']);
  });

  it('returns empty list when no instances registered', () => {
    const instances = listInstances(registryDir);
    expect(instances).toHaveLength(0);
  });
});
