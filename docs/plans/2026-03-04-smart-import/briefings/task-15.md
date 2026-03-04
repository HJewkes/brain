# Task 15: Import Report

## Architectural Context

Task 10 created `src/commands/import.ts` with basic output (file count, derived count, skipped count on stderr). This task replaces that with a structured import report showing: format breakdown, classification results, derived notes created, content handler dispatches, and skipped files with reasons. Supports `--json` for machine-readable output and `--quiet` for silent operation.

## File Ownership

**May modify:**
- `src/commands/import.ts` (replace output section)

**Must not touch:**
- `src/services/document-splitter.ts`
- `src/services/content-classifier.ts`
- `src/modules/pm/content-handler.ts`

**Read for context (do not modify):**
- `src/commands/import.ts` — `ImportStats` interface (L50-55), output section (L202-210)
- `src/commands/ingest.ts` — existing output format (for reference, already removed by Task 10)

## Steps

### Step 1: Extend ImportStats

In `src/commands/import.ts`, update the `ImportStats` interface to track more detail:

```typescript
interface ImportStats {
  imported: Map<string, number>;          // format → count
  classified: Map<string, number>;        // contentClass → count
  derived: number;
  handlerDispatches: Map<string, number>; // handler module → count
  skipped: Array<{ path: string; reason: string }>;
  noteIds: string[];
}
```

Update the stats initialization in the action handler:

```typescript
const stats: ImportStats = {
  imported: new Map(),
  classified: new Map(),
  derived: 0,
  handlerDispatches: new Map(),
  skipped: [],
  noteIds: [],
};
```

### Step 2: Track classification and handler stats

In the file processing loop, after classifying sections in `splitDocument`, track content classes:

```typescript
// After splitResult = await splitDocument(...)
for (const derived of splitResult.derivedNotes) {
  stats.classified.set(
    derived.contentClass,
    (stats.classified.get(derived.contentClass) ?? 0) + 1
  );
}
```

When a content handler is dispatched, track it:

```typescript
// After handler.handler.materialize(...)
stats.handlerDispatches.set(
  handler.module,
  (stats.handlerDispatches.get(handler.module) ?? 0) + 1
);
```

### Step 3: Replace output section

Replace the output section (after the file processing loop, around L202-210) with:

```typescript
// Output
if (opts.json) {
  const report = {
    imported: Object.fromEntries(stats.imported),
    classified: Object.fromEntries(stats.classified),
    derived: stats.derived,
    handlers: Object.fromEntries(stats.handlerDispatches),
    skipped: stats.skipped,
    noteIds: stats.noteIds,
  };
  process.stdout.write(JSON.stringify(report) + '\n');
} else if (!opts.quiet) {
  const total = [...stats.imported.values()].reduce((a, b) => a + b, 0);

  // Format breakdown
  const formats = [...stats.imported.entries()]
    .map(([fmt, count]) => `${count} ${fmt}`)
    .join(', ');
  process.stderr.write(`Imported ${total} file(s) (${formats})\n`);

  // Classification breakdown
  if (stats.classified.size > 0) {
    const classes = [...stats.classified.entries()]
      .map(([cls, count]) => `${count} ${cls}`)
      .join(', ');
    process.stderr.write(`  Classified: ${classes}\n`);
  }

  // Derived notes
  if (stats.derived > 0) {
    process.stderr.write(`  Derived: ${stats.derived} note(s)\n`);
  }

  // Handler dispatches
  if (stats.handlerDispatches.size > 0) {
    const handlers = [...stats.handlerDispatches.entries()]
      .map(([mod, count]) => `${count} via ${mod}`)
      .join(', ');
    process.stderr.write(`  Handlers: ${handlers}\n`);
  }

  // Skipped files
  if (stats.skipped.length > 0) {
    process.stderr.write(`  Skipped: ${stats.skipped.length} file(s)\n`);
    for (const s of stats.skipped.slice(0, 5)) {
      process.stderr.write(`    ${s.path}: ${s.reason}\n`);
    }
    if (stats.skipped.length > 5) {
      process.stderr.write(`    ... and ${stats.skipped.length - 5} more\n`);
    }
  }
}
```

### Step 4: Run typecheck and tests

Run: `npm run typecheck && npm test`
Expected: PASS

### Step 5: Commit

```bash
git add src/commands/import.ts
git commit -m "Add structured import report with format and classification breakdown"
```

## Success Criteria

- [ ] Types check: `npm run typecheck`
- [ ] Tests pass: `npm test`
- [ ] No new lint warnings: `npm run lint`
- [ ] `brain import <files> --json` outputs structured JSON report
- [ ] `brain import <files>` shows human-readable breakdown on stderr
- [ ] `brain import <files> --quiet` produces no output
- [ ] Format breakdown shows count per format (markdown, csv, etc.)
- [ ] Classification breakdown shows count per content class
- [ ] Skipped files show path and reason (max 5, then "... and N more")

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT add color/emoji to output — keep it plain text
- Do NOT write to stdout for human output — use stderr (stdout is for `--json`)
