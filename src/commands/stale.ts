import { Command } from '@commander-js/extra-typings'
import { loadConfig } from '../services/config.js'
import { BrainDB } from '../services/brain-db.js'
import { parseIntervalDays } from '../utils.js'
import type { NoteRecord, NoteTier } from '../types.js'

interface StaleNote {
  noteId: string
  lastReviewed: string
  reviewInterval: string
  daysOverdue: number
}

function computeDaysOverdue(note: NoteRecord, overrideDays?: number): number | null {
  const now = Date.now()
  const lastReviewed = note.lastReviewed ? new Date(note.lastReviewed).getTime() : null
  if (!lastReviewed) return null

  if (overrideDays !== undefined) {
    const daysSince = Math.floor((now - lastReviewed) / (1000 * 60 * 60 * 24))
    return daysSince > overrideDays ? daysSince - overrideDays : null
  }

  const interval = note.reviewInterval ? parseIntervalDays(note.reviewInterval) : 90
  const dueDate = lastReviewed + interval * 24 * 60 * 60 * 1000
  if (now < dueDate) return null

  return Math.floor((now - dueDate) / (1000 * 60 * 60 * 24))
}

export const staleCommand = new Command('stale')
  .description('Find notes needing review')
  .option('--days <n>', 'Show notes not reviewed in N days', parseInt)
  .option('--tier <tier>', 'Filter by tier (slow, fast)')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const config = loadConfig()
    const db = new BrainDB(config.dbPath)

    try {
      let notes = db.getAllNotes()

      if (opts.tier) {
        notes = notes.filter((n) => n.tier === (opts.tier as NoteTier))
      }

      const staleNotes: StaleNote[] = []
      for (const note of notes) {
        const overdue = computeDaysOverdue(note, opts.days)
        if (overdue !== null && overdue >= 0) {
          staleNotes.push({
            noteId: note.id,
            lastReviewed: note.lastReviewed ?? 'never',
            reviewInterval: note.reviewInterval ?? '90d',
            daysOverdue: overdue,
          })
        }
      }

      staleNotes.sort((a, b) => b.daysOverdue - a.daysOverdue)

      if (opts.json) {
        console.log(JSON.stringify(staleNotes, null, 2))
      } else if (staleNotes.length === 0) {
        console.log('No stale notes found.')
      } else {
        for (const s of staleNotes) {
          console.log(
            `${s.noteId} — last reviewed ${s.lastReviewed}, interval ${s.reviewInterval}, ${s.daysOverdue} days overdue`,
          )
        }
      }
    } finally {
      db.close()
    }
  })
