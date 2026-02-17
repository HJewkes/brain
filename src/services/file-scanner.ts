import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { glob } from 'glob'
import type { FileRecord } from '../types.js'

export interface ScanResult {
  new: Array<{ path: string; hash: string; mtime: number }>
  modified: Array<{ path: string; hash: string; mtime: number }>
  deleted: string[]
  unchanged: number
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function scanForChanges(
  rootDir: string,
  knownFiles: Map<string, FileRecord>,
): Promise<ScanResult> {
  const result: ScanResult = {
    new: [],
    modified: [],
    deleted: [],
    unchanged: 0,
  }

  const files = await glob('**/*.md', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  })

  const seen = new Set<string>()

  for (const filePath of files) {
    seen.add(filePath)
    const fileStat = await stat(filePath)
    const mtime = fileStat.mtimeMs
    const known = knownFiles.get(filePath)

    if (!known) {
      const content = await readFile(filePath, 'utf-8')
      const hash = hashContent(content)
      result.new.push({ path: filePath, hash, mtime })
      continue
    }

    if (mtime === known.mtime) {
      result.unchanged++
      continue
    }

    const content = await readFile(filePath, 'utf-8')
    const hash = hashContent(content)

    if (hash === known.hash) {
      result.unchanged++
    } else {
      result.modified.push({ path: filePath, hash, mtime })
    }
  }

  for (const [path] of knownFiles) {
    if (!seen.has(path)) {
      result.deleted.push(path)
    }
  }

  return result
}
