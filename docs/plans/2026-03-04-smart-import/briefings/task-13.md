# Task 13: Doctor FS Diff + Provenance

## Architectural Context

`brain doctor` currently checks database, embedder, LLM, inbox, and stale notes. This task adds a filesystem sync check that compares files on disk against the DB index, surfacing unindexed files and orphaned DB records. It also adds provenance tracking so imported notes carry metadata about their source format and original path.

The health check system lives in `src/services/health.ts` with `runAllChecks` as the orchestrator. The doctor command in `src/commands/doctor.ts` uses `withDb` (not `withBrain`) — it only needs `db` and `config`. The new check needs `config.notesDir` to walk the filesystem.

## File Ownership

**May modify:**
- `src/services/health.ts` (add `checkFilesystemSync`, update `runAllChecks` signature)
- `src/commands/doctor.ts` (pass `notesDir`, add FS fix)
- `__tests__/services/health.test.ts` (add FS sync tests)

**Must not touch:**
- `src/services/indexing.ts` — only read for context
- `src/services/file-scanner.ts` — Task 04 owns this

**Read for context (do not modify):**
- `src/services/health.ts` — `runAllChecks` signature (L119-124), existing check patterns
- `src/commands/doctor.ts` — command structure (L50-83), `withDb` usage
- `src/services/brain-db.ts` — `getAllFiles()` returns `Map<string, FileRecord>` (L519)
- `src/services/file-scanner.ts` — `INDEXABLE_EXTENSIONS` (Task 04), `scanForChanges`

## Steps

### Step 1: Write failing tests

Add to `__tests__/services/health.test.ts` (create if it doesn't exist):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { checkFilesystemSync } from '../../src/services/health.js';

describe('checkFilesystemSync', () => {
  it('returns ok when DB and disk are in sync', () => {
    const dbFiles = new Map([
      ['notes/foo.md', { filePath: 'notes/foo.md', hash: 'abc', mtime: 1 }],
    ]);
    const diskFiles = new Set(['notes/foo.md']);

    const result = checkFilesystemSync(dbFiles, diskFiles);
    expect(result.status).toBe('ok');
  });

  it('warns about files on disk not in DB', () => {
    const dbFiles = new Map([
      ['notes/foo.md', { filePath: 'notes/foo.md', hash: 'abc', mtime: 1 }],
    ]);
    const diskFiles = new Set(['notes/foo.md', 'notes/bar.md', 'notes/baz.csv']);

    const result = checkFilesystemSync(dbFiles, diskFiles);
    expect(result.status).toBe('warning');
    expect(result.message).toContain('2 unindexed');
  });

  it('warns about DB records with no file on disk', () => {
    const dbFiles = new Map([
      ['notes/foo.md', { filePath: 'notes/foo.md', hash: 'abc', mtime: 1 }],
      ['notes/gone.md', { filePath: 'notes/gone.md', hash: 'def', mtime: 1 }],
    ]);
    const diskFiles = new Set(['notes/foo.md']);

    const result = checkFilesystemSync(dbFiles, diskFiles);
    expect(result.status).toBe('warning');
    expect(result.message).toContain('1 orphaned');
  });

  it('reports both unindexed and orphaned', () => {
    const dbFiles = new Map([
      ['notes/gone.md', { filePath: 'notes/gone.md', hash: 'def', mtime: 1 }],
    ]);
    const diskFiles = new Set(['notes/new.md']);

    const result = checkFilesystemSync(dbFiles, diskFiles);
    expect(result.status).toBe('warning');
    expect(result.message).toContain('1 unindexed');
    expect(result.message).toContain('1 orphaned');
  });
});
```

### Step 2: Implement checkFilesystemSync

Add to `src/services/health.ts`:

```typescript
import type { FileRecord } from '../types.js';

export function checkFilesystemSync(
  dbFiles: Map<string, FileRecord>,
  diskFiles: Set<string>
): HealthCheckResult {
  const dbPaths = new Set(dbFiles.keys());

  const unindexed: string[] = [];
  for (const path of diskFiles) {
    if (!dbPaths.has(path)) unindexed.push(path);
  }

  const orphaned: string[] = [];
  for (const path of dbPaths) {
    if (!diskFiles.has(path)) orphaned.push(path);
  }

  if (unindexed.length === 0 && orphaned.length === 0) {
    return {
      name: 'Filesystem sync',
      status: 'ok',
      message: `${dbPaths.size} file(s) in sync`,
    };
  }

  const parts: string[] = [];
  if (unindexed.length > 0) parts.push(`${unindexed.length} unindexed`);
  if (orphaned.length > 0) parts.push(`${orphaned.length} orphaned`);

  return {
    name: 'Filesystem sync',
    status: 'warning',
    message: parts.join(', '),
    detail: unindexed.length > 0
      ? `Run 'brain import' to index new files`
      : `Run 'brain doctor --fix' to clean orphaned records`,
  };
}
```

### Step 3: Update runAllChecks

Update `runAllChecks` in `src/services/health.ts` to accept an optional `notesDir` parameter:

```typescript
export async function runAllChecks(
  db: BrainDB,
  embedderBackend: EmbedderBackend,
  ollamaUrl?: string,
  ollamaModel?: string,
  notesDir?: string
): Promise<HealthReport> {
  const ollamaHealth = await checkOllamaHealth(ollamaUrl);

  const checks: HealthCheckResult[] = [
    checkDatabase(db),
    checkEmbedder(embedderBackend),
    checkLlm(ollamaHealth, ollamaModel),
    checkInbox(db),
    checkStaleNotes(db),
  ];

  if (notesDir) {
    const { readdirSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const { INDEXABLE_EXTENSIONS } = await import('./file-scanner.js');

    const diskFiles = new Set<string>();
    try {
      const entries = readdirSync(notesDir, { recursive: true }) as string[];
      for (const entry of entries) {
        const full = join(notesDir, entry);
        try {
          if (statSync(full).isFile()) {
            const ext = full.slice(full.lastIndexOf('.')).toLowerCase();
            if (INDEXABLE_EXTENSIONS.has(ext)) {
              diskFiles.add(full);
            }
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* notesDir not accessible */ }

    if (diskFiles.size > 0 || db.getAllFiles().size > 0) {
      checks.push(checkFilesystemSync(db.getAllFiles(), diskFiles));
    }
  }

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warnings: checks.filter((c) => c.status === 'warning').length,
    errors: checks.filter((c) => c.status === 'error').length,
  };

  return { checks, summary };
}
```

### Step 4: Update doctor command

In `src/commands/doctor.ts`, pass `config.notesDir` to `runAllChecks`:

```typescript
const report = await runAllChecks(db, config.embedder, config.ollamaUrl, config.ollamaModel, config.notesDir);
```

In the `--fix` block, add orphaned record cleanup:

```typescript
const fsCheck = report.checks.find((c) => c.name === 'Filesystem sync');
if (fsCheck?.status === 'warning' && fsCheck.message.includes('orphaned')) {
  const dbFiles = db.getAllFiles();
  const { existsSync } = await import('node:fs');
  let cleaned = 0;
  for (const [path] of dbFiles) {
    if (!existsSync(path)) {
      db.deleteFileRecord(path);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    process.stderr.write(`Cleaned ${cleaned} orphaned file record(s).\n`);
  }
}
```

### Step 5: Run tests

Run: `npm run typecheck && npm test -- __tests__/services/health.test.ts`
Expected: PASS

### Step 6: Commit

```bash
git add src/services/health.ts src/commands/doctor.ts __tests__/services/health.test.ts
git commit -m "Add filesystem sync check to brain doctor"
```

## Success Criteria

- [ ] Types check: `npm run typecheck`
- [ ] Tests pass: `npm test -- __tests__/services/health.test.ts`
- [ ] No new lint warnings: `npm run lint`
- [ ] `brain doctor` reports unindexed files on disk
- [ ] `brain doctor` reports orphaned DB records
- [ ] `brain doctor --fix` cleans orphaned records
- [ ] Existing `runAllChecks` callers unaffected (new param is optional)

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT touch the indexing pipeline — this is diagnostic only
- Do NOT add provenance to `indexSingleFile` — keep this task focused on doctor
