import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BrainDB } from '../../src/services/brain-db.js';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { BrainConfig, Embedder } from '../../src/types.js';
import type { ModuleRegistry } from '../../src/modules/registry.js';
import { search } from '../../src/services/search.js';
import { loadModules } from '../../src/modules/loader.js';
import { getBuiltinModules } from '../../src/modules/builtins.js';
import { createProject } from '../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../src/modules/pm/data/workstream-ops.js';
import { createBrainMcpServer } from '../../src/server/mcp.js';
import { createTestDb, createMockEmbedder, createTestTask } from '../helpers.js';

const state = vi.hoisted(() => ({
  db: null as unknown as BrainDB,
  embedder: null as unknown as Embedder,
  config: null as unknown as BrainConfig,
  modules: null as unknown as ModuleRegistry,
}));

vi.mock('../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) =>
    fn({ db: state.db, embedder: state.embedder, config: state.config, modules: state.modules })
  ),
}));

let tmpDir: string;

async function searchIds(query: string): Promise<string[]> {
  const { results } = await search(state.db, state.embedder, query, { limit: 5 });
  return results.map((r) => r.noteId);
}

beforeEach(async () => {
  tmpDir = join(tmpdir(), `note-creation-indexing-${randomUUID().slice(0, 8)}`);
  const notesDir = join(tmpDir, 'notes');
  mkdirSync(notesDir, { recursive: true });
  const { dbPath, db } = createTestDb();
  state.db = db;
  state.embedder = createMockEmbedder();
  state.config = { notesDir, dbPath, embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  state.modules = (await loadModules({ modules: getBuiltinModules() })).registry;
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  state.db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('note creation paths leave the note searchable', () => {
  it('pm task add indexes the new task', async () => {
    const { db, config, embedder } = state;
    await createProject(db, config, embedder, { name: 'Demo', prefix: 'DMO' });
    await createWorkstream(db, config, embedder, { project: 'DMO', name: 'Core' });

    const created = await createTestTask(db, config, embedder, {
      project: 'DMO',
      workstream: 1,
      name: 'Calibrate the wobblefrink',
      description: 'Tune the wobblefrink until it hums.',
    });

    expect(created.ok).toBe(true);
    expect(await searchIds('wobblefrink')).toContain('dmo-01.01-task');
  });

  it('import indexes the imported note', async () => {
    const source = join(tmpDir, 'glimmerstone-report.md');
    writeFileSync(source, '# Glimmerstone report\n\nThe glimmerstone survey finished.', 'utf-8');
    const { importCommand } = await import('../../src/commands/import.js');

    await importCommand.parseAsync(['node', 'import', source, '--tier', '1', '--quiet'], {
      from: 'node',
    });

    expect(await searchIds('glimmerstone')).toContain('glimmerstone-report');
  });

  it('MCP brain_note_add indexes the new note', async () => {
    const service = { ...state, isOpen: true } as unknown as BrainServiceClass;
    const server = createBrainMcpServer(service);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await client.callTool({
      name: 'brain_note_add',
      arguments: { title: 'Snarfblat Notes', content: 'All about the snarfblat.' },
    });
    await client.close();
    await server.close();

    expect(await searchIds('snarfblat')).toContain('snarfblat-notes');
  });
});
