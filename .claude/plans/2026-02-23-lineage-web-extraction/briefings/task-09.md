# Task 09: brain add --url + ingest --urls

## Architectural Context

Brain's `add` command (`src/commands/add.ts`) creates notes from files or stdin with frontmatter generation. The `ingest` command (`src/commands/ingest.ts`) bulk-imports files into the inbox. This task adds `--url` to `add` (fetch a URL, extract content, create a note with `sources` frontmatter) and `--urls` to `ingest` (read a file of URLs, create inbox items for each). Both use the `fetchAndExtract` service from Task 8.

## File Ownership

**May modify:**
- `src/commands/add.ts`
- `src/commands/ingest.ts`
- `__tests__/commands/add.test.ts` (create if needed)

**Must not touch:**
- `src/services/web-extract.ts` — Task 8 owns extraction
- `src/services/brain-db.ts` — other tasks own
- `src/services/indexing.ts` — Task 2/5 own

**Read for context (do not modify):**
- `src/services/web-extract.ts` — understand `fetchAndExtract` and `WebExtractResult` interfaces
- `src/services/brain-service.ts` — understand `withBrain` helper
- `src/commands/add.ts` — understand existing `buildFrontmatter` and `resolveOutputPath` patterns

## Steps

### Step 1: Add --url flag to add command

In `src/commands/add.ts`, add a new option:

```typescript
.option('--url <url>', 'Fetch URL and create note from extracted content')
```

### Step 2: Implement URL handling in add action

In the action handler of `src/commands/add.ts`, add URL handling before the existing file/stdin logic:

```typescript
if (opts.url) {
  const { fetchAndExtract } = await import('../services/web-extract.js');
  const result = await fetchAndExtract(opts.url);

  if (!result.markdown.trim()) {
    process.stderr.write('Could not extract content from URL.\n');
    process.exitCode = 1;
    return;
  }

  const title = opts.title ?? result.metadata.title ?? 'Web capture';
  const type = (opts.type ?? 'research') as NoteType;
  const tier = (opts.tier ?? 'fast') as NoteTier;
  const now = new Date().toISOString().slice(0, 10);
  const id = slugify(title);

  const frontmatterLines = [
    '---',
    `id: ${id}`,
    `title: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `type: ${type}`,
    `tier: ${tier}`,
  ];
  if (opts.tags) {
    const tagList = opts.tags.split(',').map((t: string) => t.trim());
    frontmatterLines.push(`tags: [${tagList.join(', ')}]`);
  }
  if (opts.summary) frontmatterLines.push(`summary: "${opts.summary}"`);
  if (opts.confidence) frontmatterLines.push(`confidence: ${opts.confidence}`);
  if (opts.status) frontmatterLines.push(`status: ${opts.status ?? 'draft'}`);
  if (opts.category) frontmatterLines.push(`category: ${opts.category}`);
  if (opts.reviewInterval) frontmatterLines.push(`review-interval: ${opts.reviewInterval}`);

  // Sources frontmatter
  frontmatterLines.push('sources:');
  frontmatterLines.push(`  - url: "${result.normalizedUrl}"`);
  frontmatterLines.push(`    accessed: "${now}"`);
  frontmatterLines.push('    type: "web"');

  if (opts.related) {
    const relatedList = opts.related.split(',').map((r: string) => r.trim());
    frontmatterLines.push('related:');
    for (const r of relatedList) {
      frontmatterLines.push(`  - ${r}`);
    }
  }

  frontmatterLines.push(`created: ${opts.created ?? now}`);
  frontmatterLines.push(`modified: ${now}`);
  frontmatterLines.push('---');

  const markdown = frontmatterLines.join('\n') + '\n\n' + result.markdown;

  // Use existing resolveOutputPath and write logic
  await withBrain(async ({ db, embedder, config }) => {
    const outPath = resolveOutputPath(config.notesDir, tier, type, id);
    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, markdown, 'utf-8');

    const hash = createHash('sha256').update(markdown).digest('hex');
    await indexSingleFile(db, embedder, outPath, markdown, hash, Date.now());
    process.stdout.write(`Created: ${outPath}\n`);
  });

  return;
}
```

Import `fetchAndExtract` dynamically, and add necessary imports for `createHash`, `dirname`, `existsSync`, `mkdirSync`, `writeFileSync`, `indexSingleFile`.

### Step 3: Add --urls flag to ingest command

In `src/commands/ingest.ts`, add a new option:

```typescript
.option('--urls <file>', 'File containing URLs to import (one per line)')
```

### Step 4: Implement --urls handling in ingest action

Add URL file handling in the ingest action. When `--urls` is provided, read the file, create inbox items for each URL:

```typescript
if (opts.urls) {
  const urlFile = resolve(opts.urls);
  const content = readFileSync(urlFile, 'utf-8');
  const urls = content.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  await withDb(({ db }) => {
    let ingested = 0;
    for (const url of urls) {
      const item: InboxItem = {
        id: randomUUID(),
        content: `Pending URL fetch: ${url}`,
        title: url,
        source: 'crawler' as InboxSource,
        sourceUrl: url,
        sourceMeta: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        processedAt: null,
      };
      db.addInboxItem(item);
      ingested++;
    }
    process.stdout.write(`Queued ${ingested} URL(s) for processing.\n`);
    process.stdout.write('Run "brain index --inbox" to fetch and index them.\n');
  });
  return;
}
```

### Step 5: Write tests

Create or update `__tests__/commands/add.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { addCommand } from '../../src/commands/add.js';

describe('add command', () => {
  it('exports a Commander command', () => {
    expect(addCommand.name()).toBe('add');
  });

  it('has --url option', () => {
    const opts = addCommand.options.map((o) => o.long);
    expect(opts).toContain('--url');
  });
});
```

### Step 6: Run tests

Run: `npm test && npm run typecheck`
Expected: All pass

### Step 7: Commit

```bash
git add src/commands/add.ts src/commands/ingest.ts __tests__/commands/add.test.ts
git commit -m "Add --url flag to brain add and --urls to brain ingest"
```

## Success Criteria

- [ ] Tests pass: `npm test`
- [ ] Types check: `npm run typecheck`
- [ ] `brain add --url <url>` fetches URL, extracts content, creates note with `sources` frontmatter
- [ ] `brain ingest --urls <file>` creates inbox items for each URL in the file
- [ ] URL notes default to `type: research`, `tier: fast`
- [ ] Source URL preserved in structured `sources` YAML frontmatter

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT add network-calling tests — keep tests as smoke/unit tests for command structure
- Do NOT modify the web extraction service — use it as-is from Task 8
