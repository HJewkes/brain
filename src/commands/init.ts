import { Command } from '@commander-js/extra-typings';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadConfig, saveConfig, GLOBAL_BRAIN_DIR } from '../services/config.js';
import { isJsonFormat } from './format.js';
import { registerInstance } from '../services/instance-registry.js';
import { BrainDB } from '../services/brain-db.js';
import { getEmbedderInfo } from '../adapters/index.js';
import { checkOllamaHealth, hasModel } from '../services/ollama.js';
import { indexSingleFile } from '../services/indexing.js';
import type { BrainConfig, Embedder, EmbedderBackend } from '../types.js';

const SUBDIRS = [
  'notes',
  'decisions',
  'research',
  'patterns',
  'logs',
  'inbox',
  'archive',
  '_templates',
];

const TEMPLATES: Record<string, string> = {
  'note.md': `---
title: ""
type: note
tier: slow
category: ""
tags: []
summary: ""
confidence: medium
status: draft
created: "{{date}}"
---

# {{title}}

`,
  'decision.md': `---
title: ""
type: decision
tier: slow
category: ""
tags: []
summary: ""
confidence: high
status: current
created: "{{date}}"
---

# {{title}}

## Context

## Decision

## Consequences

`,
  'session-log.md': `---
title: ""
type: session-log
tier: fast
category: ""
tags: []
summary: ""
date: "{{date}}"
---

# {{title}}

## What I Did

## What I Learned

## Next Steps

`,
};

function pullOllamaModel(model: string): boolean {
  try {
    process.stderr.write(`Pulling ${model}...\n`);
    execSync(`ollama pull ${model}`, { stdio: 'inherit', timeout: 120_000 });
    return true;
  } catch {
    process.stderr.write(
      `Warning: could not pull ${model}. Run "ollama pull ${model}" manually.\n`
    );
    return false;
  }
}

async function isLocalEmbedderAvailable(): Promise<boolean> {
  try {
    await import('@huggingface/transformers');
    return true;
  } catch {
    return false;
  }
}

async function promptEmbedderChoice(): Promise<'ollama' | 'local' | null> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'No embedding backend detected and stdin is not interactive.\n' +
        'Install Ollama (https://ollama.com) or run with --embedder local.\n'
    );
    return null;
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  process.stderr.write('\nNo embedding backend detected.\n');
  process.stderr.write('  1. Install Ollama (opens ollama.com)\n');
  process.stderr.write('  2. Use local embeddings (installs @huggingface/transformers)\n');
  process.stderr.write('  3. Exit\n');

  const choice = await ask('\nChoice [1/2/3]: ');
  rl.close();

  switch (choice.trim()) {
    case '1': {
      const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      try {
        execSync(`${openCmd} https://ollama.com`, { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
      process.stderr.write('After installing Ollama, run "brain init" again.\n');
      return null;
    }
    case '2': {
      process.stderr.write('Installing @huggingface/transformers...\n');
      try {
        execSync('npm install -g @huggingface/transformers', {
          stdio: 'inherit',
          timeout: 120_000,
        });
        return 'local';
      } catch {
        process.stderr.write(
          'Failed to install. Run "npm install -g @huggingface/transformers" manually.\n'
        );
        return null;
      }
    }
    default:
      return null;
  }
}

function installSkills(): string[] {
  const brainSkillsDir = join(
    dirname(new URL(import.meta.url).pathname),
    '..',
    '..',
    '.claude',
    'skills'
  );
  const globalSkillsDir = join(homedir(), '.claude', 'skills');

  if (!existsSync(brainSkillsDir)) return [];
  if (!existsSync(globalSkillsDir)) mkdirSync(globalSkillsDir, { recursive: true });

  const installed: string[] = [];
  const entries = readdirSync(brainSkillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(brainSkillsDir, entry.name);
    const linkPath = join(globalSkillsDir, entry.name);

    // Skip if already linked correctly
    if (existsSync(linkPath)) {
      try {
        const stat = lstatSync(linkPath);
        if (stat.isSymbolicLink()) continue;
      } catch {
        continue;
      }
    }

    try {
      symlinkSync(skillPath, linkPath);
      installed.push(entry.name);
    } catch {
      // Non-fatal — skill won't be globally available
    }
  }

  return installed;
}

export async function ingestBrainReferenceDocs(
  config: BrainConfig,
  db?: BrainDB,
  embedder?: Embedder
): Promise<void> {
  // Stub: golden dataset path (V14)
  // if (goldenDatasetExists(config)) return seedFromGolden(db, config);

  const sourceDocsDir = join(
    dirname(new URL(import.meta.url).pathname),
    '..',
    '..',
    'docs',
    'pm-module'
  );
  const commandsDir = join(sourceDocsDir, 'commands');

  const refDocs: Array<{ slug: string; sourcePath: string; title: string }> = [];

  // Decomposed command files
  if (existsSync(commandsDir)) {
    const files = readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const name = basename(file, '.md');
      const slug = `pm-ref-${name === '_index' ? 'overview' : name}`;
      const title = name === '_index' ? 'PM Commands Overview' : `PM Commands: ${name}`;
      refDocs.push({ slug, sourcePath: join(commandsDir, file), title });
    }
  }

  // Also ingest architecture.md if it exists
  const archPath = join(sourceDocsDir, 'architecture.md');
  if (existsSync(archPath)) {
    refDocs.push({ slug: 'pm-ref-architecture', sourcePath: archPath, title: 'PM Architecture' });
  }

  if (refDocs.length === 0) return;

  const outDir = join(config.notesDir, 'modules', 'pm', 'reference');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const createdNoteIds: string[] = [];

  for (const doc of refDocs) {
    let content = readFileSync(doc.sourcePath, 'utf-8');

    if (!content.trimStart().startsWith('---')) {
      const fmNow = new Date().toISOString().slice(0, 10);
      const fm = [
        '---',
        `id: ${doc.slug}`,
        `title: "${doc.title}"`,
        'type: reference',
        'tier: slow',
        'module: pm',
        'embed_status: queued',
        `created: ${fmNow}`,
        `modified: ${fmNow}`,
        '---',
      ].join('\n');
      content = fm + '\n\n' + content;
    }

    const outPath = join(outDir, `${doc.slug}.md`);
    const hash = createHash('sha256').update(content).digest('hex');

    // Skip if unchanged
    if (existsSync(outPath)) {
      const existing = readFileSync(outPath, 'utf-8');
      if (createHash('sha256').update(existing).digest('hex') === hash) continue;
    }

    writeFileSync(outPath, content, 'utf-8');

    // Index into SQLite (THE BUG FIX)
    if (db && embedder) {
      try {
        const noteId = await indexSingleFile(db, embedder, outPath, content, hash, Date.now());
        createdNoteIds.push(noteId);
      } catch {
        // Auto-link may hit unique constraint with similar reference docs;
        // note/FTS/chunks are already persisted, just track the slug
        createdNoteIds.push(doc.slug);
      }
    }
  }

  // Create relations between reference notes (overview -> children)
  if (db && createdNoteIds.length > 1) {
    const overviewId = createdNoteIds.find((id) => id.includes('pm-ref-overview'));
    if (overviewId) {
      const existingRelations = db.getRelationsFrom(overviewId);
      const newRelations = createdNoteIds
        .filter((id) => id !== overviewId)
        .map((targetId) => ({ sourceId: overviewId, targetId, type: 'parent' as const }));
      db.upsertRelations(overviewId, [...existingRelations, ...newRelations]);
    }
  }
}

export interface InitLocalOptions {
  projectDir: string;
  globalDir?: string;
  notesDir?: string;
}

export function initLocalBrain(opts: InitLocalOptions): void {
  const brainDir = join(opts.projectDir, '.brain');

  if (existsSync(brainDir) && existsSync(join(brainDir, 'config.json'))) {
    throw new Error(`Local brain already exists at ${brainDir}`);
  }

  mkdirSync(brainDir, { recursive: true });
  mkdirSync(join(brainDir, 'notes'), { recursive: true });

  const localConfig: Record<string, unknown> = {};
  if (opts.notesDir) {
    localConfig.notesDir = opts.notesDir;
    mkdirSync(opts.notesDir, { recursive: true });
  }
  writeFileSync(
    join(brainDir, 'config.json'),
    JSON.stringify(localConfig, null, 2) + '\n',
    'utf-8'
  );

  const globalConfig = loadConfig();
  const dbPath = join(brainDir, 'brain.db');
  const db = new BrainDB(dbPath);
  const info = getEmbedderInfo(globalConfig.embedder);
  db.setEmbeddingModel(info.model, info.dimensions);
  db.close();

  const globalDir = opts.globalDir ?? GLOBAL_BRAIN_DIR;
  const name = basename(opts.projectDir);
  registerInstance(globalDir, brainDir, name);
}

export const initCommand = new Command('init')
  .description('Initialize a new brain workspace')
  .option('--local', 'create a project-local brain instance in CWD')
  .option('--notes-dir <path>', 'path to notes directory')
  .option('--embedder <type>', 'embedding backend (local, ollama, remote)')
  .option('--json', 'output result as JSON')
  .option('--verbose', 'show technical details')
  .action(async (opts, cmd) => {
    if (opts.local) {
      try {
        initLocalBrain({
          projectDir: process.cwd(),
          notesDir: opts.notesDir ? join(process.cwd(), opts.notesDir) : undefined,
        });
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
        return;
      }

      const brainDir = join(process.cwd(), '.brain');

      if (!isJsonFormat(opts, cmd) && existsSync(join(process.cwd(), '.git'))) {
        const gitignorePath = join(process.cwd(), '.gitignore');
        const gitignoreContent = existsSync(gitignorePath)
          ? readFileSync(gitignorePath, 'utf-8')
          : '';

        if (!gitignoreContent.includes('.brain/')) {
          if (process.stdin.isTTY) {
            const rl = createInterface({ input: process.stdin, output: process.stderr });
            const answer = await new Promise<string>((resolve) =>
              rl.question('Add .brain/ to .gitignore? [Y/n] ', resolve)
            );
            rl.close();

            if (!answer || answer.toLowerCase().startsWith('y')) {
              const newContent =
                gitignoreContent.endsWith('\n') || gitignoreContent === ''
                  ? gitignoreContent + '.brain/\n'
                  : gitignoreContent + '\n.brain/\n';
              writeFileSync(gitignorePath, newContent, 'utf-8');
              process.stderr.write('Added .brain/ to .gitignore\n');
            }
          }
        }
      }

      if (isJsonFormat(opts, cmd)) {
        process.stdout.write(
          JSON.stringify({
            type: 'local',
            brainDir,
            notesDir: opts.notesDir ? join(process.cwd(), opts.notesDir) : join(brainDir, 'notes'),
            dbPath: join(brainDir, 'brain.db'),
          }) + '\n'
        );
      } else {
        process.stderr.write('Local brain initialized!\n\n');
        process.stderr.write(`Instance: ${brainDir}\n`);
        process.stderr.write(
          `Notes: ${opts.notesDir ? join(process.cwd(), opts.notesDir) : join(brainDir, 'notes')}\n`
        );
        process.stderr.write(`Database: ${join(brainDir, 'brain.db')}\n`);
        process.stderr.write(
          '\nAll brain commands in this directory will use the local instance.\n'
        );
      }
      return;
    }

    const overrides: Record<string, unknown> = {};
    if (opts.notesDir) overrides.notesDir = opts.notesDir;
    if (opts.embedder) overrides.embedder = opts.embedder as EmbedderBackend;

    // Single Ollama health check — reused for both embedder and LLM setup
    const ollamaUrl = 'http://localhost:11434';
    const ollamaHealth = await checkOllamaHealth(ollamaUrl);

    if (!opts.embedder) {
      const ollamaModel = 'nomic-embed-text';

      if (ollamaHealth.running) {
        if (!hasModel(ollamaHealth, ollamaModel)) {
          pullOllamaModel(ollamaModel);
        }
        overrides.embedder = 'ollama';
        overrides.ollamaUrl = ollamaUrl;
      } else if (await isLocalEmbedderAvailable()) {
        overrides.embedder = 'local';
      } else {
        const choice = await promptEmbedderChoice();
        if (!choice) {
          process.exitCode = 1;
          return;
        }
        overrides.embedder = choice;
        if (choice === 'ollama') {
          overrides.ollamaUrl = ollamaUrl;
        }
      }
    }

    saveConfig(overrides);
    const config = loadConfig();

    // Install brain skills globally for agent accessibility
    const installedSkills = installSkills();

    const created: string[] = [];
    for (const sub of SUBDIRS) {
      const dir = join(config.notesDir, sub);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        created.push(sub);
      }
    }

    const templatesDir = join(config.notesDir, '_templates');
    for (const [filename, content] of Object.entries(TEMPLATES)) {
      const filePath = join(templatesDir, filename);
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content, 'utf-8');
      }
    }

    const db = new BrainDB(config.dbPath);
    const info = getEmbedderInfo(config.embedder);
    db.setEmbeddingModel(info.model, info.dimensions);

    // Ingest brain's own PM reference docs (best-effort, with indexing)
    try {
      const { createEmbedder } = await import('../adapters/index.js');
      const embedder = await createEmbedder(config);
      await ingestBrainReferenceDocs(config, db, embedder);
    } catch {
      // Fall back to write-only (no indexing) if embedder fails
      await ingestBrainReferenceDocs(config);
    }

    db.close();

    // LLM setup — reuses the Ollama health check from above
    const llmModel = config.ollamaModel ?? 'qwen2.5:3b';
    let llmReady = false;
    if (ollamaHealth.running) {
      if (hasModel(ollamaHealth, llmModel)) {
        llmReady = true;
      } else {
        llmReady = pullOllamaModel(llmModel);
      }
    }

    const embInfo = getEmbedderInfo(config.embedder);
    const features = {
      search: true,
      extract: llmReady,
      tidy: llmReady,
    };

    const summary = {
      notesDir: config.notesDir,
      dbPath: config.dbPath,
      embedder: config.embedder,
      embedderModel: embInfo.model,
      llmModel: llmReady ? llmModel : null,
      features,
      dirsCreated: created,
    };

    if (isJsonFormat(opts, cmd)) {
      process.stdout.write(JSON.stringify(summary) + '\n');
    } else {
      process.stderr.write('Brain initialized successfully!\n\n');
      process.stderr.write(`Notes directory: ${config.notesDir}\n`);
      process.stderr.write('Search: ready (hybrid BM25 + vector)\n');
      if (llmReady) {
        process.stderr.write('Memory extraction: ready\n');
      } else {
        process.stderr.write('Memory extraction: not configured (needs Ollama)\n');
      }

      if (opts.verbose) {
        process.stderr.write(`\nDatabase: ${config.dbPath}\n`);
        process.stderr.write(`Embedder: ${config.embedder} (${embInfo.model})\n`);
        if (llmReady) {
          process.stderr.write(`LLM: ollama (${llmModel})\n`);
        }
        process.stderr.write(
          `Features: search ${features.search ? '+' : '-'}  extract ${features.extract ? '+' : '-'}  tidy ${features.tidy ? '+' : '-'}\n`
        );
        if (created.length > 0) {
          process.stderr.write(`Created directories: ${created.join(', ')}\n`);
        }
        if (installedSkills.length > 0) {
          process.stderr.write(`Installed skills: ${installedSkills.join(', ')}\n`);
        }
      }

      process.stderr.write('\nNext steps:\n');
      process.stderr.write('  brain index          Index your existing notes\n');
      process.stderr.write('  brain quick "idea"   Capture a thought\n');
      process.stderr.write('  brain pm init        Set up project management\n');
    }
  });
