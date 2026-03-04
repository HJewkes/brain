import { Command } from '@commander-js/extra-typings';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import type { Result } from '../errors.js';
import type { OnboardManifest } from '../data/onboard-types.js';
import { ok, fail, formatError } from '../errors.js';
import { detectComponents } from '../engine/detect.js';
import { discoverDocs } from '../engine/doc-scanner.js';
import { createProject } from '../data/project-ops.js';
import { getPmNotes, setActiveProject } from '../data/queries.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { slugify } from '../../../utils.js';
import { withBrain } from '../../../services/brain-service.js';
import { computeAutoLinks } from '../../../services/graph.js';
import type { DetectedComponent, ScoredDoc } from '../data/onboard-types.js';

export function onboardSlug(title: string, component?: string, usedSlugs?: Set<string>): string {
  const base = slugify(title);
  let slug: string;

  if (!component || slugify(component) === base) {
    slug = base;
  } else {
    slug = `${slugify(component)}-${base}`;
  }

  if (usedSlugs) {
    if (usedSlugs.has(slug)) {
      let suffix = 2;
      while (usedSlugs.has(`${slug}-${suffix}`)) suffix++;
      slug = `${slug}-${suffix}`;
    }
    usedSlugs.add(slug);
  }

  return slug;
}

export function synthesizeProjectBody(
  name: string,
  components: DetectedComponent[],
  docs: ScoredDoc[]
): string {
  const lines: string[] = [];
  lines.push(`## Overview`);
  lines.push(`${name} — ${components.length} component(s), ${docs.length} doc(s) discovered`);
  lines.push('');

  if (components.length > 0) {
    lines.push('## Components');
    for (const c of components) {
      lines.push(`- **${c.name}** (${c.type}) — ${c.docCount} docs`);
    }
    lines.push('');
  }

  if (docs.length > 0) {
    lines.push('## Key Documentation');
    const top = docs.slice(0, 10);
    for (const d of top) {
      const title = basename(d.path, '.md');
      const component = d.component ? ` (${d.component})` : '';
      lines.push(`- ${title}${component}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

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
  opts: OnboardOptions
): Promise<Result<OnboardManifest>> {
  const now = () => new Date().toISOString();

  // Check for existing project (fail unless --reset)
  const existing = getPmNotes(db, 'project', { prefix: opts.prefix });
  if (existing.length > 0 && !opts.reset) {
    return fail(
      'PROJECT_EXISTS',
      `Project "${opts.prefix}" already exists. Use --reset to re-onboard.`
    );
  }

  // Check for duplicate project name (different prefix, same name)
  const allProjects = getPmNotes(db, 'project');
  for (const projNote of allProjects) {
    const projMeta = JSON.parse(projNote.metadata ?? '{}') as Record<string, unknown>;
    const projTitle = ((projMeta.title as string) ?? '').replace(/^Project\s+/i, '');
    if (
      projTitle.toLowerCase() === opts.projectName.toLowerCase() &&
      (projMeta.prefix as string) !== opts.prefix
    ) {
      return fail(
        'PROJECT_EXISTS',
        `A project named "${opts.projectName}" already exists as ${projMeta.prefix}. ` +
          `Use --prefix ${projMeta.prefix} --reset to re-onboard, or brain pm use ${projMeta.prefix}.`
      );
    }
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

  // Phase 2: Discover docs (moved before create so we have data for body)
  const componentPaths = components.map((c) =>
    c.path === '.' ? opts.cwd : join(opts.cwd, c.path)
  );
  const scoredDocs = discoverDocs(componentPaths, { maxDocs: opts.maxDocs ?? 20 });

  // Assign component names to discovered docs
  for (const doc of scoredDocs) {
    for (const comp of components) {
      const compDir = comp.path === '.' ? opts.cwd : join(opts.cwd, comp.path);
      if (doc.path.startsWith(compDir + '/') || doc.path === compDir) {
        doc.component = comp.name;
        break;
      }
    }
  }
  const discoverPhase = { completedAt: now(), docsFound: scoredDocs.length };

  // Phase 3: Create project (with synthesized body)
  let projectCreated = false;
  if (existing.length === 0) {
    const projectResult = await createProject(db, config, embedder, {
      name: opts.projectName,
      prefix: opts.prefix,
    });
    if (!projectResult.ok) return projectResult as Result<never>;
    projectCreated = true;
    setActiveProject(db, opts.prefix);

    // Append synthesized body to project note
    const projectFilePath = join(config.notesDir, 'modules', 'pm', opts.prefix, 'project.md');
    if (existsSync(projectFilePath)) {
      const existing = readFileSync(projectFilePath, 'utf-8');
      const body = synthesizeProjectBody(opts.projectName, components, scoredDocs);
      const updated = existing + body + '\n';
      writeFileSync(projectFilePath, updated, 'utf-8');
      const hash = createHash('sha256').update(updated).digest('hex');
      await indexSingleFile(db, embedder, projectFilePath, updated, hash, Date.now());
    }
  }
  const createPhase = { completedAt: now(), projectCreated };

  // Phase 4: Ingest
  let ingestedCount = 0;
  const ingestErrors: string[] = [];
  const usedSlugs = new Set<string>();
  if (!opts.skipIngest) {
    const outDir = join(config.notesDir, 'modules', 'pm', opts.prefix, 'docs');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    for (const doc of scoredDocs) {
      try {
        let content = readFileSync(doc.path, 'utf-8');
        const title = basename(doc.path, '.md');
        const slug = onboardSlug(title, doc.component, usedSlugs);

        // Dedup: check if note with this slug already exists
        const existingNote = db.getNoteById(slug);
        if (existingNote) {
          doc.ingested = true;
          doc.noteSlug = slug;
          ingestedCount++;
          continue;
        }

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

  // Sync project→workstream parent edges for any workstreams that exist
  syncProjectHierarchyEdges(db, opts.prefix);

  // Phase 5: Two-pass auto-linking (all docs now in vector store)
  const AUTO_LINK_THRESHOLD = 0.6;
  let autoLinkCount = 0;
  const createdNoteIds: string[] = [];

  // Collect all ingested note IDs
  for (const doc of scoredDocs) {
    if (doc.ingested && doc.noteSlug) {
      createdNoteIds.push(doc.noteSlug);
    }
  }

  // Also include project note ID
  if (projectCreated) {
    const projectNotes = getPmNotes(db, 'project', { prefix: opts.prefix });
    if (projectNotes.length > 0) {
      createdNoteIds.push(projectNotes[0].id);
    }
  }

  // Run auto-linking for each ingested note
  for (const noteId of createdNoteIds) {
    const autoLinks = computeAutoLinks(db, noteId, AUTO_LINK_THRESHOLD, 5);
    if (autoLinks.length > 0) {
      const existingRels = db.getRelationsFrom(noteId);
      const newLinks = autoLinks.filter(
        (link) => !existingRels.some((e) => e.targetId === link.targetId && e.type === link.type)
      );
      if (newLinks.length > 0) {
        db.upsertRelations(noteId, [...existingRels, ...newLinks]);
        autoLinkCount += newLinks.length;
      }
    }
  }

  const autoLinkPhase = { completedAt: now(), edgesCreated: autoLinkCount };
  process.stderr.write(
    `  Auto-linked: ${autoLinkCount} edges across ${createdNoteIds.length} notes (threshold: ${AUTO_LINK_THRESHOLD})\n`
  );

  // Create activity note
  const activitySlug = `${opts.prefix.toLowerCase()}-onboard-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const activityPath = join(config.notesDir, 'modules', 'pm', opts.prefix, `${activitySlug}.md`);
  const activityDir = dirname(activityPath);
  if (!existsSync(activityDir)) mkdirSync(activityDir, { recursive: true });

  const activityFm = [
    '---',
    `id: ${activitySlug}`,
    `title: "Onboard: ${opts.projectName} → ${opts.prefix}"`,
    'type: activity',
    'tier: slow',
    'module: pm',
    `project: ${opts.prefix}`,
    'activity_type: onboard',
    `created: ${now()}`,
    `modified: ${now()}`,
    `created_notes:`,
    ...createdNoteIds.map((id) => `  - "${id}"`),
    `created_relations: ${autoLinkCount}`,
    '---',
    '',
    `# Onboard Activity: ${opts.projectName}`,
    '',
    `- **Source:** ${opts.cwd}`,
    `- **Components:** ${components.length}`,
    `- **Docs ingested:** ${ingestedCount}`,
    `- **Auto-link edges:** ${autoLinkCount} (threshold: ${AUTO_LINK_THRESHOLD})`,
    `- **Notes created:** ${createdNoteIds.length}`,
  ].join('\n');

  writeFileSync(activityPath, activityFm, 'utf-8');
  const activityHash = createHash('sha256').update(activityFm).digest('hex');
  await indexSingleFile(db, embedder, activityPath, activityFm, activityHash, Date.now());

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
      autoLink: autoLinkPhase,
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

export function syncProjectHierarchyEdges(db: BrainDB, prefix: string): void {
  const projectNotes = getPmNotes(db, 'project', { prefix });
  if (projectNotes.length === 0) return;

  const projectNoteId = projectNotes[0].id;
  const wsNotes = getPmNotes(db, 'workstream', { project: prefix });
  if (wsNotes.length === 0) return;

  const existingRels = db.getRelationsFrom(projectNoteId);
  const existingTargets = new Set(existingRels.map((r) => r.targetId));

  const relations: Relation[] = [...existingRels];
  for (const ws of wsNotes) {
    if (!existingTargets.has(ws.id)) {
      relations.push({ sourceId: projectNoteId, targetId: ws.id, type: 'parent' });
    }
  }

  if (relations.length > existingRels.length) {
    db.upsertRelations(projectNoteId, relations);
  }
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
    ...manifest.components.map((c) => `| ${c.name} | ${c.path} | ${c.type} | ${c.docCount} |`),
    '',
    '## Documentation',
    '',
    `${manifest.docs.ingested} of ${manifest.docs.discovered} discovered docs ingested.`,
    '',
  ];

  const ingested = manifest.docs.items.filter((d) => d.ingested);
  if (ingested.length > 0) {
    lines.push('### Ingested');
    for (const doc of ingested) {
      lines.push(`- \`${doc.noteSlug}\` (score: ${doc.score}) — ${basename(doc.path)}`);
    }
    lines.push('');
  }

  lines.push('## Phase Log', '');
  if (manifest.phases.detect)
    lines.push(`- **Detect:** ${manifest.phases.detect.componentCount} components found`);
  if (manifest.phases.create)
    lines.push(
      `- **Create:** Project ${manifest.phases.create.projectCreated ? 'created' : 'already existed'}`
    );
  if (manifest.phases.discover)
    lines.push(`- **Discover:** ${manifest.phases.discover.docsFound} docs found`);
  if (manifest.phases.ingest)
    lines.push(`- **Ingest:** ${manifest.phases.ingest.docsIngested} docs ingested`);
  if (manifest.phases.autoLink)
    lines.push(`- **Auto-link:** ${manifest.phases.autoLink.edgesCreated} edges created`);
  lines.push('');

  return lines.join('\n');
}

export function createOnboardCommand(): Command {
  const cmd = new Command('onboard');
  cmd
    .description('Set up a PM project from a codebase')
    .argument('<project-name>', 'Project name')
    .option(
      '--prefix <prefix>',
      'Project prefix (2-5 uppercase chars, derived from name if omitted)'
    )
    .option('--max-docs <n>', 'Max docs to ingest (default: 20)', parseInt)
    .option('--skip-ingest', 'Skip doc ingestion phase')
    .option('--reset', 'Wipe existing onboard data and start fresh')
    .option('--cwd <path>', 'Project directory (defaults to current working directory)')
    .option('--json', 'Output JSON')
    .action(async (projectName, opts) => {
      await withBrain(async (svc) => {
        const prefix =
          opts.prefix ??
          projectName
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 5);
        if (prefix.length < 2 || prefix.length > 5) {
          process.stderr.write(
            'Error: prefix must be 2-5 uppercase alphanumeric chars. Use --prefix to specify.\n'
          );
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
          process.stdout.write(
            `  Components: ${m.components.length} (${m.components.map((c) => c.name).join(', ')})\n`
          );
          process.stdout.write(`  Docs: ${m.docs.ingested}/${m.docs.discovered} ingested\n`);
          process.stdout.write(`  Manifest note: ${m.project.toLowerCase()}-onboard-manifest\n`);
        }
      });
    });

  return cmd;
}
