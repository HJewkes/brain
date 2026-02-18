import { Command } from '@commander-js/extra-typings';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadConfig, saveConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import { getEmbedderInfo } from '../adapters/index.js';
import type { EmbedderBackend } from '../types.js';

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

interface OllamaStatus {
  running: boolean;
  hasModel: boolean;
}

async function checkOllama(url: string, model: string): Promise<OllamaStatus> {
  try {
    const response = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return { running: false, hasModel: false };
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const hasModel = data.models?.some((m) => m.name.startsWith(model)) ?? false;
    return { running: true, hasModel };
  } catch {
    return { running: false, hasModel: false };
  }
}

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

export const initCommand = new Command('init')
  .description('Initialize a new brain workspace')
  .option('--notes-dir <path>', 'path to notes directory')
  .option('--embedder <type>', 'embedding backend (local, ollama, remote)')
  .option('--json', 'output result as JSON')
  .action(async (opts) => {
    const overrides: Record<string, unknown> = {};
    if (opts.notesDir) overrides.notesDir = opts.notesDir;
    if (opts.embedder) overrides.embedder = opts.embedder as EmbedderBackend;

    if (!opts.embedder) {
      const ollamaUrl = 'http://localhost:11434';
      const ollamaModel = 'nomic-embed-text';
      const status = await checkOllama(ollamaUrl, ollamaModel);

      if (status.running) {
        if (!status.hasModel) {
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
          overrides.ollamaUrl = 'http://localhost:11434';
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

    const summary = {
      notesDir: config.notesDir,
      dbPath: config.dbPath,
      embedder: config.embedder,
      dirsCreated: created,
    };

    if (opts.json) {
      process.stdout.write(JSON.stringify(summary) + '\n');
    } else {
      process.stderr.write(`Initialized brain at ${config.notesDir}\n`);
      process.stderr.write(`Database: ${config.dbPath}\n`);
      process.stderr.write(`Embedder: ${config.embedder}\n`);
      if (created.length > 0) {
        process.stderr.write(`Created directories: ${created.join(', ')}\n`);
      }
    }
  });
