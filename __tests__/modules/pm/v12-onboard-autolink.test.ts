import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { runOnboard } from '../../../src/modules/pm/commands/onboard.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let projectDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  dbPath = tmpDbPath('v12-onboard-autolink');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `v12-onboard-autolink-${randomUUID()}`);
  projectDir = join(tmpdir(), `v12-project-${randomUUID()}`);
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

describe('onboard duplicate-by-name guard', () => {
  it('rejects onboard when project with same name exists under different prefix', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# Test Project\n\n' + 'content '.repeat(100));

    const first = await runOnboard(db, config, embedder, {
      projectName: 'Test Project',
      prefix: 'TST',
      cwd: projectDir,
    });
    expect(first.ok).toBe(true);

    const second = await runOnboard(db, config, embedder, {
      projectName: 'Test Project',
      prefix: 'TST2',
      cwd: projectDir,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.message).toContain('already exists as TST');
    }
  });

  it('allows re-onboard with --reset on same prefix', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# Test\n\n' + 'x'.repeat(600));

    const first = await runOnboard(db, config, embedder, {
      projectName: 'Test Project',
      prefix: 'TST',
      cwd: projectDir,
    });
    expect(first.ok).toBe(true);

    const second = await runOnboard(db, config, embedder, {
      projectName: 'Test Project',
      prefix: 'TST',
      cwd: projectDir,
      reset: true,
    });
    expect(second.ok).toBe(true);
  });

  it('allows same prefix without --reset to be caught by existing guard', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# Test\n\n' + 'x'.repeat(600));

    const first = await runOnboard(db, config, embedder, {
      projectName: 'Test Project',
      prefix: 'TST',
      cwd: projectDir,
    });
    expect(first.ok).toBe(true);

    const second = await runOnboard(db, config, embedder, {
      projectName: 'Test Project',
      prefix: 'TST',
      cwd: projectDir,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('PROJECT_EXISTS');
    }
  });
});

describe('Phase 5: two-pass auto-linking', () => {
  it('runs auto-linking phase and records edge count in manifest', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    // Create docs with related content so auto-links may form
    writeFileSync(
      join(projectDir, 'README.md'),
      '# Architecture\n\nThis document describes the authentication architecture and login flow.\n\n' +
        'The authentication system uses JWT tokens for session management. ' +
        'Users authenticate via the login endpoint which validates credentials.\n'.repeat(10)
    );
    writeFileSync(
      join(projectDir, 'CONTRIBUTING.md'),
      '# Authentication Guide\n\nHow to set up authentication and login for development.\n\n' +
        'The authentication module handles JWT token generation and validation. ' +
        'See the login flow documentation for details on the credential check.\n'.repeat(10)
    );
    mkdirSync(join(projectDir, 'docs'), { recursive: true });
    writeFileSync(
      join(projectDir, 'docs', 'login.md'),
      '# Login Flow\n\nThe login flow uses authentication tokens.\n\n' +
        'JWT tokens are issued after credential validation. ' +
        'The authentication architecture supports multiple identity providers.\n'.repeat(10)
    );

    const result = await runOnboard(db, config, embedder, {
      projectName: 'AuthApp',
      prefix: 'AUTH',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const manifest = result.data;
      expect(manifest.phases.autoLink).toBeDefined();
      expect(manifest.phases.autoLink!.edgesCreated).toBeTypeOf('number');
    }
  });
});

describe('activity note creation during onboard', () => {
  it('onboard creates an activity note with created_notes list', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# App\n\n' + 'content '.repeat(100));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'ACT',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);

    const activityNotes = getPmNotes(db, 'activity', { project: 'ACT' });
    expect(activityNotes.length).toBe(1);

    const meta = JSON.parse(activityNotes[0].metadata!) as Record<string, unknown>;
    expect(meta.activity_type).toBe('onboard');
    expect(meta.project).toBe('ACT');
    expect(Array.isArray(meta.created_notes)).toBe(true);
    const createdNotes = meta.created_notes as string[];
    expect(createdNotes.length).toBeGreaterThan(0);
  });

  it('activity note records auto-link edge count', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# App\n\n' + 'content '.repeat(100));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'EDGC',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);

    const activityNotes = getPmNotes(db, 'activity', { project: 'EDGC' });
    expect(activityNotes.length).toBe(1);

    const meta = JSON.parse(activityNotes[0].metadata!) as Record<string, unknown>;
    expect(typeof meta.created_relations).toBe('number');
    expect((meta.created_relations as number)).toBeGreaterThanOrEqual(0);
  });

  it('activity note includes project note ID in created_notes', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# App\n\n' + 'content '.repeat(100));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'PNID',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);

    const activityNotes = getPmNotes(db, 'activity', { project: 'PNID' });
    expect(activityNotes.length).toBe(1);

    const meta = JSON.parse(activityNotes[0].metadata!) as Record<string, unknown>;
    const createdNotes = meta.created_notes as string[];

    // Should include project note
    const projectNotes = getPmNotes(db, 'project', { prefix: 'PNID' });
    expect(projectNotes.length).toBe(1);
    expect(createdNotes).toContain(projectNotes[0].id);
  });
});
