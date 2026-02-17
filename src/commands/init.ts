import { Command } from '@commander-js/extra-typings'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, saveConfig } from '../services/config.js'
import { BrainDB } from '../services/brain-db.js'
import { getEmbedderInfo } from '../adapters/index.js'
import type { EmbedderBackend } from '../types.js'

const SUBDIRS = [
  'notes',
  'decisions',
  'research',
  'patterns',
  'logs',
  'inbox',
  'archive',
  '_templates',
]

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
}

export const initCommand = new Command('init')
  .description('Initialize a new brain workspace')
  .option('--notes-dir <path>', 'path to notes directory')
  .option('--embedder <type>', 'embedding backend (local, ollama, remote)')
  .option('--json', 'output result as JSON')
  .action(async (opts) => {
    const overrides: Record<string, unknown> = {}
    if (opts.notesDir) overrides.notesDir = opts.notesDir
    if (opts.embedder) overrides.embedder = opts.embedder as EmbedderBackend

    saveConfig(overrides)
    const config = loadConfig()

    const created: string[] = []
    for (const sub of SUBDIRS) {
      const dir = join(config.notesDir, sub)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
        created.push(sub)
      }
    }

    const templatesDir = join(config.notesDir, '_templates')
    for (const [filename, content] of Object.entries(TEMPLATES)) {
      const filePath = join(templatesDir, filename)
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content, 'utf-8')
      }
    }

    const db = new BrainDB(config.dbPath)
    const info = getEmbedderInfo(config.embedder)
    db.setEmbeddingModel(info.model, info.dimensions)
    db.close()

    const summary = {
      notesDir: config.notesDir,
      dbPath: config.dbPath,
      embedder: config.embedder,
      dirsCreated: created,
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(summary) + '\n')
    } else {
      process.stderr.write(`Initialized brain at ${config.notesDir}\n`)
      process.stderr.write(`Database: ${config.dbPath}\n`)
      process.stderr.write(`Embedder: ${config.embedder}\n`)
      if (created.length > 0) {
        process.stderr.write(`Created directories: ${created.join(', ')}\n`)
      }
    }
  })
