import { Command } from '@commander-js/extra-typings'
import { renameSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { loadConfig } from '../services/config.js'
import { BrainDB } from '../services/brain-db.js'

export const archiveCommand = new Command('archive')
  .description('Move expired fast-tier notes to archive')
  .option('--dry-run', 'List files that would be archived without moving them')
  .action((opts) => {
    const config = loadConfig()
    const db = new BrainDB(config.dbPath)

    try {
      const notes = db.getAllNotes()
      const now = Date.now()

      const expired = notes.filter((n) => {
        if (n.tier !== 'fast') return false
        if (!n.expires) return false
        return new Date(n.expires).getTime() < now
      })

      if (expired.length === 0) {
        console.log('No expired notes to archive.')
        return
      }

      for (const note of expired) {
        const expiresDate = new Date(note.expires!)
        const yyyy = String(expiresDate.getFullYear())
        const archiveDir = join(config.notesDir, 'archive', yyyy)
        const filename = basename(note.filePath)
        const archivePath = join(archiveDir, filename)

        if (opts.dryRun) {
          console.log(`Would archive: ${note.filePath} → ${archivePath}`)
          continue
        }

        if (!existsSync(archiveDir)) {
          mkdirSync(archiveDir, { recursive: true })
        }

        if (existsSync(note.filePath)) {
          renameSync(note.filePath, archivePath)
        }

        db.upsertNote({ ...note, filePath: archivePath })
      }

      const verb = opts.dryRun ? 'Would archive' : 'Archived'
      console.log(`${verb} ${expired.length} note${expired.length === 1 ? '' : 's'}.`)
    } finally {
      db.close()
    }
  })
