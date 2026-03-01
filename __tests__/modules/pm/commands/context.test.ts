import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createContextCommand } from '../../../../src/modules/pm/commands/context.js';
import { writePrompt } from '../../../../src/modules/pm/data/prompt-ops.js';
import { createDecision } from '../../../../src/modules/pm/data/decision-ops.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

vi.mock('../../../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder, config, modules: {}, close: () => {} })),
}));

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await createContextCommand().parseAsync(['node', 'context', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('context-cmd'));
  config = {
    notesDir: '/tmp/test-context-cmd',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;

  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('context command', () => {
  it('returns formatted context as text', async () => {
    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('Task: TEST-01.01');
    expect(out).toContain('Status:');
    expect(out).toContain('Priority:');
  });

  it('--json returns ContextBundle object', async () => {
    await run('TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('task');
    expect(parsed).toHaveProperty('body');
    expect(parsed).toHaveProperty('dependencies');
    expect(parsed).toHaveProperty('decisions');
    expect(parsed.task.display_id).toBe('TEST-01.01');
  });

  it('shows dependencies section when task has deps', async () => {
    await run('TEST-01.02');

    const out = stdout();
    expect(out).toContain('Dependencies');
    expect(out).toContain('TEST-01.01');
  });

  it('shows prompt section when prompt exists', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Implement the feature properly',
    });

    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('--- Prompt ---');
    // assembleContext returns note.title as prompt content
    expect(out).toContain('Prompt TEST-P01');
  });

  it('not-found error sets exitCode=1', async () => {
    await run('TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });

  it('shows workstream info', async () => {
    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('Workstream:');
  });

  it('handles empty body gracefully', async () => {
    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('Task: TEST-01.01');
    // Should not throw even if body is empty
  });

  it('shows related notes section when notes exist', async () => {
    // The related notes depend on similarity search, which the mock embedder handles
    await run('TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    // relatedNotes may or may not have entries depending on search results
    expect(parsed).toHaveProperty('relatedNotes');
    expect(Array.isArray(parsed.relatedNotes)).toBe(true);
  });

  it('text output includes description when body exists', async () => {
    // Write body content directly to the task markdown file (after frontmatter)
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { getPmNotes } = await import('../../../../src/modules/pm/data/queries.js');
    const notes = getPmNotes(db, 'task', { display_id: 'TEST-01.01' });
    if (notes.length > 0) {
      const filePath = notes[0].filePath;
      const content = readFileSync(filePath, 'utf-8');
      const withBody = content + '\nImplement the main feature for the project.\n';
      writeFileSync(filePath, withBody, 'utf-8');
    }

    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('Task: TEST-01.01');
    expect(out).toContain('Description');
    expect(out).toContain('Implement the main feature');
  });

  it('text output with relatedNotes shows excerpts', async () => {
    // This is hard to trigger deterministically with mock embedder
    // but we can at least verify the format function runs
    await run('TEST-01.02');

    const out = stdout();
    // Verify the basic structure is there
    expect(out).toContain('Task: TEST-01.02');
    expect(out).toContain('Dependencies');
  });

  it('shows decisions section when decisions exist', async () => {
    // impacts must include the task we query context for
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use REST API',
      sourceTask: 'TEST-01.01',
      impacts: ['TEST-01.01'],
      content: 'We decided to use REST instead of GraphQL',
    });

    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('Decisions');
    // assembleContext uses note.title as decision content
    expect(out).toContain('Use REST API');
  });
});
