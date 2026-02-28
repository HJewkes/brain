import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { runOnboard } from '../../../../src/modules/pm/commands/onboard.js';
import { getPmNotes } from '../../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let projectDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  dbPath = tmpDbPath('pm-onboard');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-onboard-notes-${randomUUID()}`);
  projectDir = join(tmpdir(), `pm-onboard-project-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
});

describe('runOnboard', () => {
  it('creates project and triage workstream', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify project exists
    const projects = getPmNotes(db, 'project', { prefix: 'TST' });
    expect(projects).toHaveLength(1);

    // Verify triage workstream exists
    const workstreams = getPmNotes(db, 'workstream', { project: 'TST' });
    expect(workstreams).toHaveLength(1);
  });

  it('detects components and stores in manifest', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    mkdirSync(join(projectDir, 'src'));
    writeFileSync(join(projectDir, 'src', 'index.ts'), 'export {}');

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.components).toHaveLength(1);
    expect(result.data.components[0].type).toBe('node');
    expect(result.data.phases.detect).toBeDefined();
    expect(result.data.phases.detect!.componentCount).toBe(1);
  });

  it('discovers and ingests docs', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# Test App\n\nA test application for onboarding.\n\n' + 'x'.repeat(600));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.docs.discovered).toBeGreaterThanOrEqual(1);
    expect(result.data.docs.ingested).toBeGreaterThanOrEqual(1);

    // Verify the doc was ingested as a research note
    const ingestedItem = result.data.docs.items.find(d => d.ingested);
    expect(ingestedItem).toBeDefined();
    expect(ingestedItem!.noteSlug).toBeDefined();
  });

  it('creates onboard manifest note', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify manifest note exists
    const manifestNotes = getPmNotes(db, 'onboard-manifest', { project: 'TST' });
    expect(manifestNotes).toHaveLength(1);
  });

  it('returns PROJECT_EXISTS when project already exists', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));

    // Create project first
    const { createProject } = await import('../../../../src/modules/pm/data/project-ops.js');
    await createProject(db, config, embedder, { name: 'TestApp', prefix: 'TST' });

    // Try to onboard — should fail without --reset
    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROJECT_EXISTS');
  });

  it('respects maxDocs option', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(projectDir, `doc-${i}.md`), `# Doc ${i}\n\n` + 'x'.repeat(600));
    }

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
      maxDocs: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.docs.ingested).toBeLessThanOrEqual(2);
  });

  it('skips ingestion when skipIngest is true', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# App\n\n' + 'x'.repeat(600));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
      skipIngest: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.docs.discovered).toBeGreaterThanOrEqual(1);
    expect(result.data.docs.ingested).toBe(0);
  });
});
