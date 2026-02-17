import { Command } from '@commander-js/extra-typings'
import type { NoteType } from '../types.js'

const VALID_TYPES = new Set<NoteType>([
  'note', 'decision', 'meeting', 'research', 'pattern', 'session-log',
])

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function titleCase(s: string): string {
  return s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function generateTemplate(type: NoteType): string {
  const today = todayISO()

  const base = [
    '---',
    `id: untitled-${type}`,
    `title: Untitled ${titleCase(type)}`,
    `type: ${type}`,
  ]

  switch (type) {
    case 'note':
      return lines(
        ...base,
        'tier: slow', 'category: ""', 'tags: []', 'summary: ""',
        'confidence: medium', 'status: draft',
        `created: ${today}`, `modified: ${today}`,
        `last-reviewed: ${today}`, 'review-interval: 90d',
        'sources: []', 'related: []', '---', '',
        '## Overview', '',
      )

    case 'decision':
      return lines(
        ...base,
        'tier: slow', 'category: ""', 'tags: []', 'summary: ""',
        'confidence: high', 'status: current',
        `created: ${today}`, `modified: ${today}`,
        `last-reviewed: ${today}`, 'review-interval: 180d',
        'sources: []', 'related: []', '---', '',
        '## Context', '', '## Decision', '', '## Consequences', '',
      )

    case 'meeting':
      return lines(
        ...base,
        'tier: fast', `date: ${today}`, 'participants: []',
        'project: ""', 'tags: []', 'summary: ""', 'outcome: ""',
        `created: ${today}`, `modified: ${today}`,
        'review-interval: 30d', 'related: []', '---', '',
        '## Agenda', '', '## Notes', '', '## Action Items', '',
      )

    case 'research':
      return lines(
        ...base,
        'tier: slow', 'category: ""', 'tags: []', 'summary: ""',
        'confidence: medium', 'status: draft',
        `created: ${today}`, `modified: ${today}`,
        `last-reviewed: ${today}`, 'review-interval: 90d',
        'sources: []', 'related: []', '---', '',
        '## Question', '', '## Findings', '', '## Conclusion', '',
      )

    case 'pattern':
      return lines(
        ...base,
        'tier: slow', 'category: ""', 'tags: []', 'summary: ""',
        'confidence: high', 'status: current',
        `created: ${today}`, `modified: ${today}`,
        `last-reviewed: ${today}`, 'review-interval: 180d',
        'sources: []', 'related: []', '---', '',
        '## Problem', '', '## Solution', '', '## Examples', '',
      )

    case 'session-log':
      return lines(
        ...base,
        'tier: fast', `date: ${today}`, 'project: ""',
        'tags: []', 'summary: ""',
        `created: ${today}`, `modified: ${today}`,
        'expires: ""', 'related: []', '---', '',
        '## Goal', '', '## Log', '', '## Outcome', '',
      )

    default:
      return ''
  }
}

function lines(...parts: string[]): string {
  return parts.join('\n')
}

export const templateCommand = new Command('template')
  .description('Output a frontmatter template for a note type')
  .argument('<type>', 'Note type (note, decision, meeting, research, pattern, session-log)')
  .action((type) => {
    if (!VALID_TYPES.has(type as NoteType)) {
      console.error(
        `Error: unknown type "${type}". Valid types: ${[...VALID_TYPES].join(', ')}`,
      )
      process.exitCode = 1
      return
    }

    process.stdout.write(generateTemplate(type as NoteType))
  })
