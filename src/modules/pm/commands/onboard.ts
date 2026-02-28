import { Command } from '@commander-js/extra-typings';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { Result } from '../errors.js';
import type { OnboardManifest } from '../data/onboard-types.js';
import { ok, fail, formatError } from '../errors.js';
import { detectComponents } from '../engine/detect.js';
import { discoverDocs } from '../engine/doc-scanner.js';
import { createProject } from '../data/project-ops.js';
import { createWorkstream } from '../data/workstream-ops.js';
import { getPmNotes, setActiveProject } from '../data/queries.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { slugify } from '../../../utils.js';
import { withBrain } from '../../../services/brain-service.js';

export interface OnboardOptions {
  projectName: string;
  prefix: string;
  cwd: string;
  maxDocs?: number;
  skipIngest?: boolean;
  reset?: boolean;
}

export async function runOnboard(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  opts: OnboardOptions,
): Promise<Result<OnboardManifest>> {
  const now = () => new Date().toISOString();

  // Check for existing project (fail unless --reset)
  const existing = getPmNotes(db, 'project', { prefix: opts.prefix });
  if (existing.length > 0 && !opts.reset) {
    return fail('PROJECT_EXISTS', `Project "${opts.prefix}" already exists. Use --reset to re-onboard.`);
  }

  // If --reset, delete existing onboard-manifest note
  if (opts.reset && existing.length > 0) {
    const manifestNotes = getPmNotes(db, 'onboard-manifest', { project: opts.prefix });
    for (const note of manifestNotes) {
      const noteRecord = db.getNoteById(note.id);
      if (noteRecord?.filePath && existsSync(noteRecord.filePath)) {
        unlinkSync(noteRecord.filePath);
      }
      db.deleteNote(note.id);
    }
  }

  // Phase 1: Detect
  const components = detectComponents(opts.cwd);
  const detectPhase = { completedAt: now(), componentCount: components.length };

  // Phase 2: Create project
  let projectCreated = false;
  if (existing.length === 0) {
    const projectResult = await createProject(db, config, embedder, {
      name: opts.projectName,
      prefix: opts.prefix,
    });
    if (!projectResult.ok) return projectResult as Result<never>;
    projectCreated = true;
    setActiveProject(db, opts.prefix);
  }
  const createPhase = { completedAt: now(), projectCreated };

  // Phase 3: Discover docs
  const componentPaths = components.map(c =>
    c.path === '.' ? opts.cwd : join(opts.cwd, c.path)
  );
  const scoredDocs = discoverDocs(componentPaths, { maxDocs: opts.maxDocs ?? 20 });
  const discoverPhase = { completedAt: now(), docsFound: scoredDocs.length };

  // Phase 4: Ingest
  let ingestedCount = 0;
  const ingestErrors: string[] = [];
  if (!opts.skipIngest) {
    const outDir = join(config.notesDir, 'modules', 'pm', opts.prefix, 'docs');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    for (const doc of scoredDocs) {
      try {
        let content = readFileSync(doc.path, 'utf-8');
        const title = basename(doc.path, '.md');
        const slug = slugify(title);

        // Add frontmatter if missing
        if (!content.trimStart().startsWith('---')) {
          const fmNow = new Date().toISOString().slice(0, 10);
          const fm = [
            '---',
            `id: ${slug}`,
            `title: "${title}"`,
            'type: research',
            'tier: slow',
            'module: pm',
            `project: ${opts.prefix}`,
            `created: ${fmNow}`,
            `modified: ${fmNow}`,
            '---',
          ].join('\n');
          content = fm + '\n\n' + content;
        }

        const outPath = join(outDir, `${slug}.md`);
        writeFileSync(outPath, content, 'utf-8');

        const hash = createHash('sha256').update(content).digest('hex');
        await indexSingleFile(db, embedder, outPath, content, hash, Date.now());

        doc.ingested = true;
        doc.noteSlug = slug;
        ingestedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ingestErrors.push(`${basename(doc.path)}: ${msg}`);
      }
    }
  }
  if (ingestErrors.length > 0) {
    process.stderr.write(`Warning: ${ingestErrors.length} doc(s) failed to ingest:\n`);
    for (const e of ingestErrors) process.stderr.write(`  - ${e}\n`);
  }
  const ingestPhase = { completedAt: now(), docsIngested: ingestedCount };

  // Phase 4b: Ingest PM reference docs
  if (!opts.skipIngest) {
    const pmDocsDir = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', 'docs', 'pm-module');
    const refDocs = ['commands.md', 'architecture.md'];

    for (const refDoc of refDocs) {
      const refPath = join(pmDocsDir, refDoc);
      if (!existsSync(refPath)) continue;

      try {
        let content = readFileSync(refPath, 'utf-8');
        const title = basename(refPath, '.md');
        const slug = `pm-ref-${slugify(title)}`;

        // Add frontmatter if missing
        if (!content.trimStart().startsWith('---')) {
          const fmNow = new Date().toISOString().slice(0, 10);
          const fm = [
            '---',
            `id: ${slug}`,
            `title: "PM Reference: ${title}"`,
            'type: research',
            'tier: slow',
            'module: pm',
            `project: ${opts.prefix}`,
            `created: ${fmNow}`,
            `modified: ${fmNow}`,
            '---',
          ].join('\n');
          content = fm + '\n\n' + content;
        }

        const outDir = join(config.notesDir, 'modules', 'pm', opts.prefix, 'docs');
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        const outPath = join(outDir, `${slug}.md`);

        // Skip if already ingested (same hash)
        const hash = createHash('sha256').update(content).digest('hex');
        if (existsSync(outPath)) {
          const existing = readFileSync(outPath, 'utf-8');
          const existingHash = createHash('sha256').update(existing).digest('hex');
          if (hash === existingHash) continue;
        }

        writeFileSync(outPath, content, 'utf-8');
        await indexSingleFile(db, embedder, outPath, content, hash, Date.now());
      } catch {
        // Reference doc ingestion is best-effort — don't fail onboard
      }
    }
  }

  // Build manifest
  const manifest: OnboardManifest = {
    version: 1,
    project: opts.prefix,
    createdAt: now(),
    cwd: opts.cwd,
    components,
    docs: {
      discovered: scoredDocs.length,
      ingested: ingestedCount,
      items: scoredDocs,
    },
    phases: {
      detect: detectPhase,
      create: createPhase,
      discover: discoverPhase,
      ingest: ingestPhase,
    },
  };

  // Write manifest as PM module note
  const manifestSlug = `${opts.prefix.toLowerCase()}-onboard-manifest`;
  const manifestPath = join(config.notesDir, 'modules', 'pm', opts.prefix, `${manifestSlug}.md`);
  const manifestDir = dirname(manifestPath);
  if (!existsSync(manifestDir)) mkdirSync(manifestDir, { recursive: true });

  const manifestMd = buildManifestNote(manifest, manifestSlug, opts.projectName);
  writeFileSync(manifestPath, manifestMd, 'utf-8');

  const manifestHash = createHash('sha256').update(manifestMd).digest('hex');
  await indexSingleFile(db, embedder, manifestPath, manifestMd, manifestHash, Date.now());

  return ok(manifest);
}

function buildManifestNote(manifest: OnboardManifest, slug: string, projectName: string): string {
  const now = new Date().toISOString().slice(0, 10);

  const lines = [
    '---',
    `id: ${slug}`,
    `title: "${projectName} Onboard Manifest"`,
    'type: onboard-manifest',
    'tier: slow',
    'module: pm',
    `project: ${manifest.project}`,
    `created: ${now}`,
    `modified: ${now}`,
    '---',
    '',
    `# ${projectName} — Onboard Manifest`,
    '',
    '## Components',
    '',
    '| Component | Path | Type | Docs |',
    '|-----------|------|------|------|',
    ...manifest.components.map(c => `| ${c.name} | ${c.path} | ${c.type} | ${c.docCount} |`),
    '',
    '## Documentation',
    '',
    `${manifest.docs.ingested} of ${manifest.docs.discovered} discovered docs ingested.`,
    '',
  ];

  const ingested = manifest.docs.items.filter(d => d.ingested);
  if (ingested.length > 0) {
    lines.push('### Ingested');
    for (const doc of ingested) {
      lines.push(`- \`${doc.noteSlug}\` (score: ${doc.score}) — ${basename(doc.path)}`);
    }
    lines.push('');
  }

  lines.push('## Phase Log', '');
  if (manifest.phases.detect) lines.push(`- **Detect:** ${manifest.phases.detect.componentCount} components found`);
  if (manifest.phases.create) lines.push(`- **Create:** Project ${manifest.phases.create.projectCreated ? 'created' : 'already existed'}`);
  if (manifest.phases.discover) lines.push(`- **Discover:** ${manifest.phases.discover.docsFound} docs found`);
  if (manifest.phases.ingest) lines.push(`- **Ingest:** ${manifest.phases.ingest.docsIngested} docs ingested`);
  lines.push('');

  return lines.join('\n');
}

export function createOnboardCommand(): Command {
  const cmd = new Command('onboard');
  cmd.description('Set up a PM project from a codebase')
    .argument('<project-name>', 'Project name')
    .option('--prefix <prefix>', 'Project prefix (2-5 uppercase chars, derived from name if omitted)')
    .option('--max-docs <n>', 'Max docs to ingest (default: 20)', parseInt)
    .option('--skip-ingest', 'Skip doc ingestion phase')
    .option('--reset', 'Wipe existing onboard data and start fresh')
    .option('--cwd <path>', 'Project directory (defaults to current working directory)')
    .option('--json', 'Output JSON')
    .action(async (projectName, opts) => {
      await withBrain(async (svc) => {
        const prefix = opts.prefix ?? projectName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (prefix.length < 2 || prefix.length > 5) {
          process.stderr.write('Error: prefix must be 2-5 uppercase alphanumeric chars. Use --prefix to specify.\n');
          process.exitCode = 1;
          return;
        }

        const result = await runOnboard(svc.db, svc.config, svc.embedder, {
          projectName,
          prefix,
          cwd: opts.cwd ?? process.cwd(),
          maxDocs: opts.maxDocs,
          skipIngest: opts.skipIngest,
          reset: opts.reset,
        });

        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          const m = result.data;
          process.stdout.write(`Onboarded "${projectName}" (${m.project})\n`);
          process.stdout.write(`  Components: ${m.components.length} (${m.components.map(c => c.name).join(', ')})\n`);
          process.stdout.write(`  Docs: ${m.docs.ingested}/${m.docs.discovered} ingested\n`);
          process.stdout.write(`  Manifest note: ${m.project.toLowerCase()}-onboard-manifest\n`);
        }
      });
    });

  return cmd;
}
