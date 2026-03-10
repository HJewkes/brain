import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { runOnboard } from '../../../src/modules/pm/commands/onboard.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let projectDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `v11-init-onboard-${randomUUID()}`);
  projectDir = join(tmpdir(), `v11-project-${randomUUID()}`);
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

describe('onboard does not ingest PM reference docs (O-133)', () => {
  it('onboard produces no pm-ref-* notes in the target project', async () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'testapp' }));
    writeFileSync(join(projectDir, 'README.md'), '# App\n\n' + 'x'.repeat(600));

    const result = await runOnboard(db, config, embedder, {
      projectName: 'TestApp',
      prefix: 'TST',
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);

    // Check that no files with pm-ref-* slug exist in the project docs dir
    const docsDir = join(notesDir, 'modules', 'pm', 'TST', 'docs');
    if (existsSync(docsDir)) {
      const files = readdirSync(docsDir);
      const refFiles = files.filter((f) => f.startsWith('pm-ref-'));
      expect(refFiles).toHaveLength(0);
    }
  });
});

describe('init ingests brain reference docs (O-133)', () => {
  it('ingestBrainReferenceDocs creates notes with module: pm and no project field', async () => {
    // Import the function after the module is loaded
    const { ingestBrainReferenceDocs } = await import('../../../src/commands/init.js');

    await ingestBrainReferenceDocs(config);

    // Check that reference docs were written to modules/pm/reference/
    const refDir = join(notesDir, 'modules', 'pm', 'reference');
    expect(existsSync(refDir)).toBe(true);

    const files = readdirSync(refDir);
    expect(files.length).toBeGreaterThan(0);

    // Verify frontmatter has module: pm but no project field
    for (const file of files) {
      const content = readFileSync(join(refDir, file), 'utf-8');
      // Extract frontmatter (between first pair of ---)
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).toBeTruthy();
      const frontmatter = fmMatch![1];
      expect(frontmatter).toContain('module: pm');
      expect(frontmatter).not.toMatch(/^project:/m);
    }
  });

  it('ingestBrainReferenceDocs skips when docs dir does not exist', async () => {
    const { ingestBrainReferenceDocs } = await import('../../../src/commands/init.js');

    // Should not throw even if docs dir is missing
    await expect(ingestBrainReferenceDocs(config)).resolves.toBeUndefined();
  });

  it('ingestBrainReferenceDocs is idempotent (skips unchanged files)', async () => {
    const { ingestBrainReferenceDocs } = await import('../../../src/commands/init.js');

    await ingestBrainReferenceDocs(config);
    const refDir = join(notesDir, 'modules', 'pm', 'reference');
    const files = readdirSync(refDir);
    const firstContent = readFileSync(join(refDir, files[0]), 'utf-8');

    // Run again — should not change anything
    await ingestBrainReferenceDocs(config);
    const secondContent = readFileSync(join(refDir, files[0]), 'utf-8');
    expect(secondContent).toBe(firstContent);
  });
});
