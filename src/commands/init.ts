import { Command } from '@commander-js/extra-typings';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadConfig, saveConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import { getEmbedderInfo } from '../adapters/index.js';
import { checkOllamaHealth, hasModel } from '../services/ollama.js';
import { slugify } from '../utils.js';
import type { BrainConfig, EmbedderBackend } from '../types.js';

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

export async function ingestBrainReferenceDocs(config: BrainConfig): Promise<void> {
  const pmDocsDir = join(
    dirname(new URL(import.meta.url).pathname),
    '..', 'modules', 'pm', 'docs'
  );

  // Fallback: try the source tree path (docs/pm-module)
  const sourceDocsDir = join(
    dirname(new URL(import.meta.url).pathname),
    '..', '..', 'docs', 'pm-module'
  );

  const docsDir = existsSync(pmDocsDir) ? pmDocsDir : existsSync(sourceDocsDir) ? sourceDocsDir : null;
  if (!docsDir) return;

  const refDocs = ['commands.md', 'architecture.md'];

  for (const refDoc of refDocs) {
    const refPath = join(docsDir, refDoc);
    if (!existsSync(refPath)) continue;

    let content = readFileSync(refPath, 'utf-8');
    const title = basename(refPath, '.md');
    const slug = `pm-ref-${slugify(title)}`;

    if (!content.trimStart().startsWith('---')) {
      const fmNow = new Date().toISOString().slice(0, 10);
      const fm = [
        '---',
        `id: ${slug}`,
        `title: "PM Reference: ${title}"`,
        'type: research',
        'tier: slow',
        'module: pm',
        `created: ${fmNow}`,
        `modified: ${fmNow}`,
        '---',
      ].join('\n');
      content = fm + '\n\n' + content;
    }

    const outDir = join(config.notesDir, 'modules', 'pm', 'reference');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${slug}.md`);

    const hash = createHash('sha256').update(content).digest('hex');
    if (existsSync(outPath)) {
      const existing = readFileSync(outPath, 'utf-8');
      if (createHash('sha256').update(existing).digest('hex') === hash) continue;
    }

    writeFileSync(outPath, content, 'utf-8');
  }
}

export const initCommand = new Command('init')
  .description('Initialize a new brain workspace')
  .option('--notes-dir <path>', 'path to notes directory')
  .option('--embedder <type>', 'embedding backend (local, ollama, remote)')
  .option('--json', 'output result as JSON')
  .option('--verbose', 'show technical details')
  .action(async (opts) => {
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
    db.close();

    // Ingest brain's own PM reference docs (best-effort)
    await ingestBrainReferenceDocs(config);

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

    if (opts.json) {
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
      }

      process.stderr.write('\nNext steps:\n');
      process.stderr.write('  brain index          Index your existing notes\n');
      process.stderr.write('  brain quick "idea"   Capture a thought\n');
      process.stderr.write('  brain pm init        Set up project management\n');
    }
  });
