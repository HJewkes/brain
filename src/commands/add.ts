import { Command } from '@commander-js/extra-typings'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { loadConfig } from '../services/config.js'
import { parseMarkdown } from '../services/markdown-parser.js'
import type { NoteType, NoteTier } from '../types.js'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildFrontmatter(opts: {
  title?: string
  type?: string
  tier?: string
  tags?: string
}): string {
  const now = new Date().toISOString().slice(0, 10)
  const title = opts.title ?? 'Untitled'
  const type = opts.type ?? 'note'
  const tier = opts.tier ?? 'slow'
  const lines = [
    '---',
    `id: ${slugify(title)}`,
    `title: ${title}`,
    `type: ${type}`,
    `tier: ${tier}`,
  ]
  if (opts.tags) {
    const tagList = opts.tags.split(',').map((t) => t.trim())
    lines.push(`tags: [${tagList.join(', ')}]`)
  }
  lines.push(`created: ${now}`)
  lines.push(`modified: ${now}`)
  lines.push('---')
  return lines.join('\n')
}

function hasFrontmatter(content: string): boolean {
  return content.trimStart().startsWith('---')
}

function resolveOutputPath(
  notesDir: string,
  tier: NoteTier,
  type: NoteType,
  id: string,
): string {
  if (tier === 'fast') {
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    return join(notesDir, 'logs', yyyy, mm, `${yyyy}-${mm}-${dd}-${id}.md`)
  }

  const TYPE_DIRS: Record<NoteType, string> = {
    note: 'notes',
    decision: 'decisions',
    research: 'research',
    pattern: 'patterns',
    meeting: 'logs',
    'session-log': 'logs',
    guide: 'notes',
  }
  const typeDir = TYPE_DIRS[type]
  return join(notesDir, typeDir, `${id}.md`)
}

export const addCommand = new Command('add')
  .description('Create a new note from file or stdin')
  .argument('[file]', 'Input file path')
  .option('--title <title>', 'Note title')
  .option('--type <type>', 'Note type (note, decision, pattern, research, meeting, session-log, guide)')
  .option('--tier <tier>', 'Note tier (slow, fast)')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (file, opts) => {
    const VALID_TYPES: NoteType[] = ['note', 'decision', 'pattern', 'research', 'meeting', 'session-log', 'guide']
    const VALID_TIERS: NoteTier[] = ['slow', 'fast']

    if (opts.type && !VALID_TYPES.includes(opts.type as NoteType)) {
      console.error(`Error: invalid type "${opts.type}". Valid types: ${VALID_TYPES.join(', ')}`)
      process.exitCode = 1
      return
    }

    if (opts.tier && !VALID_TIERS.includes(opts.tier as NoteTier)) {
      console.error(`Error: invalid tier "${opts.tier}". Valid tiers: ${VALID_TIERS.join(', ')}`)
      process.exitCode = 1
      return
    }

    let content: string

    if (file) {
      content = readFileSync(resolve(file), 'utf-8')
    } else if (!process.stdin.isTTY) {
      content = readFileSync(0, 'utf-8')
    } else {
      console.error('Error: provide a file argument or pipe content to stdin')
      process.exitCode = 1
      return
    }

    if (!hasFrontmatter(content)) {
      const fm = buildFrontmatter(opts)
      content = fm + '\n\n' + content
    }

    const parsed = parseMarkdown(file ?? 'untitled.md', content)
    const id = parsed.id
    const tier = (opts.tier ?? parsed.frontmatter.tier ?? 'slow') as NoteTier
    const type = (opts.type ?? parsed.frontmatter.type ?? 'note') as NoteType

    const config = loadConfig()
    const outPath = resolveOutputPath(config.notesDir, tier, type, id)
    const dir = dirname(outPath)

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(outPath, content, 'utf-8')
    console.log(outPath)
  })
