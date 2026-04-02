import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../../src/adapters/index.js', () => ({
  createEmbedder: vi.fn().mockResolvedValue({
    embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    model: 'mock-model',
    dimensions: 3,
  }),
}));

vi.mock('../../src/services/search.js', () => ({
  search: vi.fn().mockResolvedValue({
    results: [
      {
        noteId: 'note-1',
        filePath: '/notes/test.md',
        score: 0.95,
        excerpt: 'Test excerpt',
        tier: 'slow',
        tags: ['test'],
        matchSource: 'both',
      },
    ],
    tokenUsage: { queryEmbedTokens: 5, rerankTokens: 0, intentFilterTokens: 0, totalTokens: 5 },
  }),
}));

describe('MCP server', () => {
  let projectDir: string;
  let brainDir: string;
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'brain-mcp-'));
    brainDir = join(projectDir, '.brain');
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, 'config.json'), JSON.stringify({}));

    const { createMcpServer } = await import('../../src/commands/mcp.js');
    const server = createMcpServer({ cwd: projectDir });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('lists all five tools', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(['add_memory', 'context', 'list_memories', 'quick', 'search']);
  });

  it('search tool returns results', async () => {
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'test query' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');

    const parsed = JSON.parse(content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].noteId).toBe('note-1');
    expect(parsed[0].score).toBe(0.95);
  });

  it('quick tool captures to inbox', async () => {
    const result = await client.callTool({
      name: 'quick',
      arguments: { text: 'Remember this thought' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/^Captured to inbox: /);
  });

  it('add_memory tool creates a memory', async () => {
    const result = await client.callTool({
      name: 'add_memory',
      arguments: { content: 'TypeScript is great' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/^Memory created: /);
  });

  it('add_memory tool returns error for nonexistent source note', async () => {
    const result = await client.callTool({
      name: 'add_memory',
      arguments: { content: 'A fact', source: 'nonexistent-note' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('not found');
  });

  it('list_memories tool returns memories after adding one', async () => {
    const addResult = await client.callTool({
      name: 'add_memory',
      arguments: { content: 'Listed memory test' },
    });
    const addContent = addResult.content as Array<{ type: string; text: string }>;
    expect(addContent[0].text).toMatch(/^Memory created: /);

    const result = await client.callTool({
      name: 'list_memories',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    const found = parsed.find((m: { memory: string }) => m.memory === 'Listed memory test');
    expect(found).toBeDefined();
  });

  it('context tool returns error for unknown note', async () => {
    const result = await client.callTool({
      name: 'context',
      arguments: { noteId: 'nonexistent-note' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('not found');
  });

  it('list_memories tool respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await client.callTool({
        name: 'add_memory',
        arguments: { content: `Memory number ${i}` },
      });
    }

    const result = await client.callTool({
      name: 'list_memories',
      arguments: { limit: 2 },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toHaveLength(2);
  });
});
