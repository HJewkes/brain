import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { runOnboard, onboardSlug, synthesizeProjectBody } from '../../../../src/modules/pm/commands/onboard.js';
import { getPmNotes } from '../../../../src/modules/pm/data/queries.js';
import type { DetectedComponent, ScoredDoc } from '../../../../src/modules/pm/data/onboard-types.js';

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
  it('creates project without auto-Triage workstream', async () => {
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

    // Verify no workstreams created automatically
    const workstreams = getPmNotes(db, 'workstream', { project: 'TST' });
    expect(workstreams).toHaveLength(0);
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

  it('re-onboards with --reset by deleting existing manifest', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));

    // First onboard
    const r1 = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });
    expect(r1.ok).toBe(true);

    // Re-onboard with reset
    const r2 = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
      reset: true,
    });
    expect(r2.ok).toBe(true);

    // Should still have exactly one manifest note (old one deleted)
    const manifestNotes = getPmNotes(db, 'onboard-manifest', { project: 'TST' });
    expect(manifestNotes).toHaveLength(1);
  });

  it('ingests docs under project-namespaced directory', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# Test App\n\n' + 'x'.repeat(600));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify doc was written under modules/pm/TST/docs/
    const docsDir = join(notesDir, 'modules', 'pm', 'TST', 'docs');
    expect(existsSync(docsDir)).toBe(true);
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

  it('component-aware slug includes component prefix', async () => {
    const slug = onboardSlug('README', 'node-sdk');
    expect(slug).toBe('node-sdk-readme');
  });

  it('doc without component keeps simple slug', () => {
    const slug = onboardSlug('architecture');
    expect(slug).toBe('architecture');
  });

  it('doc where title equals component name uses simple slug', () => {
    const slug = onboardSlug('node-sdk', 'node-sdk');
    expect(slug).toBe('node-sdk');
  });

  it('collision within batch appends suffix', () => {
    const used = new Set<string>();
    const slug1 = onboardSlug('readme', 'api', used);
    const slug2 = onboardSlug('readme', 'api', used);
    expect(slug1).toBe('api-readme');
    expect(slug2).toBe('api-readme-2');
  });

  it('project note body includes component inventory', async () => {
    // Set up monorepo with two components
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: ['packages/*'],
    }));
    const pkgA = join(projectDir, 'packages', 'api');
    const pkgB = join(projectDir, 'packages', 'web');
    mkdirSync(pkgA, { recursive: true });
    mkdirSync(pkgB, { recursive: true });
    writeFileSync(join(pkgA, 'package.json'), JSON.stringify({ name: 'api' }));
    writeFileSync(join(pkgB, 'package.json'), JSON.stringify({ name: 'web' }));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'Mono',
      prefix: 'MON',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Read the project note body
    const projectNotes = getPmNotes(db, 'project', { prefix: 'MON' });
    expect(projectNotes).toHaveLength(1);
    const noteRecord = db.getNoteById(projectNotes[0].id);
    expect(noteRecord).toBeDefined();
    const content = readFileSync(noteRecord!.filePath, 'utf-8');
    expect(content).toContain('## Components');
    expect(content).toContain('api');
    expect(content).toContain('web');
  });

  it('project note body includes doc list', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# Test App\n\n' + 'x'.repeat(600));
    writeFileSync(join(projectDir, 'ARCHITECTURE.md'), '# Arch\n\n' + 'x'.repeat(600));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const projectNotes = getPmNotes(db, 'project', { prefix: 'TST' });
    const noteRecord = db.getNoteById(projectNotes[0].id);
    const content = readFileSync(noteRecord!.filePath, 'utf-8');
    expect(content).toContain('## Key Documentation');
    expect(content).toContain('README');
  });

  it('multiple READMEs from different components get unique slugs', async () => {
    // Set up monorepo with two components each having a README
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: ['packages/*'],
    }));
    const pkgA = join(projectDir, 'packages', 'api');
    const pkgB = join(projectDir, 'packages', 'web');
    mkdirSync(pkgA, { recursive: true });
    mkdirSync(pkgB, { recursive: true });
    writeFileSync(join(pkgA, 'package.json'), JSON.stringify({ name: 'api' }));
    writeFileSync(join(pkgB, 'package.json'), JSON.stringify({ name: 'web' }));
    writeFileSync(join(pkgA, 'README.md'), '# API Readme\n\n' + 'x'.repeat(600));
    writeFileSync(join(pkgB, 'README.md'), '# Web Readme\n\n' + 'x'.repeat(600));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'Mono',
      prefix: 'MON',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ingestedDocs = result.data.docs.items.filter(d => d.ingested);
    const slugs = ingestedDocs.map(d => d.noteSlug);
    // All slugs should be unique
    expect(new Set(slugs).size).toBe(slugs.length);
    // Both should have been ingested
    expect(ingestedDocs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('onboardSlug', () => {
  it('returns base slug for undefined component', () => {
    expect(onboardSlug('getting-started')).toBe('getting-started');
  });

  it('prefixes with component when different from title', () => {
    expect(onboardSlug('README', 'core')).toBe('core-readme');
  });

  it('avoids redundant prefix when component matches title', () => {
    expect(onboardSlug('Core', 'core')).toBe('core');
  });

  it('handles collision suffixes correctly', () => {
    const used = new Set<string>();
    expect(onboardSlug('readme', undefined, used)).toBe('readme');
    expect(onboardSlug('readme', undefined, used)).toBe('readme-2');
    expect(onboardSlug('readme', undefined, used)).toBe('readme-3');
  });
});

describe('synthesizeProjectBody', () => {
  it('includes component list', () => {
    const components: DetectedComponent[] = [
      { name: 'api', path: 'packages/api', type: 'node', entryPoints: [], docPaths: [], docCount: 3 },
      { name: 'web', path: 'packages/web', type: 'node', entryPoints: [], docPaths: [], docCount: 1 },
    ];
    const body = synthesizeProjectBody('Mono', components, []);
    expect(body).toContain('## Components');
    expect(body).toContain('**api**');
    expect(body).toContain('**web**');
    expect(body).toContain('2 component(s)');
  });

  it('includes doc list', () => {
    const docs: ScoredDoc[] = [
      { path: '/tmp/README.md', score: 50, ingested: false },
      { path: '/tmp/ARCHITECTURE.md', score: 40, ingested: false },
    ];
    const body = synthesizeProjectBody('App', [], docs);
    expect(body).toContain('## Key Documentation');
    expect(body).toContain('README');
    expect(body).toContain('ARCHITECTURE');
  });

  it('limits to top 10 docs', () => {
    const docs: ScoredDoc[] = Array.from({ length: 15 }, (_, i) => ({
      path: `/tmp/doc-${i}.md`,
      score: 100 - i,
      ingested: false,
    }));
    const body = synthesizeProjectBody('App', [], docs);
    expect(body).toContain('doc-0');
    expect(body).toContain('doc-9');
    expect(body).not.toContain('doc-10');
  });
});
