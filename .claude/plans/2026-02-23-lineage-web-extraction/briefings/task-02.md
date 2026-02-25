# Task 02: Fix Inbox Source Preservation

## Architectural Context

Brain's `inboxItemToMarkdown()` in `src/services/indexing.ts` converts inbox items to markdown notes. Currently, when an inbox item has a `sourceUrl`, it appends `Source: {url}` as plain text at the bottom. This loses structured source information. The fix converts it to proper `sources` YAML frontmatter matching the existing `NoteSource` interface (`url`, `accessed`, `type`).

## File Ownership

**May modify:**
- `src/services/indexing.ts`
- `__tests__/services/indexing.test.ts`

**Must not touch:**
- `src/types.ts` — Task 1 owns types
- `src/services/brain-db.ts` — Task 1 owns schema
- `src/commands/add.ts` — Task 9 owns CLI changes

**Read for context (do not modify):**
- `src/types.ts` — understand `NoteSource` interface and `InboxItem`
- `src/services/markdown-parser.ts` — understand how `sources` frontmatter is parsed

## Steps

### Step 1: Write failing test for source preservation

In `__tests__/services/indexing.test.ts`, add or update tests for `inboxItemToMarkdown`:

```typescript
describe('inboxItemToMarkdown', () => {
  it('produces sources frontmatter when sourceUrl is present', () => {
    const item: InboxItem = {
      id: 'test-123',
      content: 'Some captured content',
      title: 'Test Item',
      source: 'cli',
      sourceUrl: 'https://example.com/article',
      sourceMeta: null,
      status: 'pending',
      createdAt: '2026-02-23T00:00:00Z',
      processedAt: null,
    };

    const md = inboxItemToMarkdown(item);

    // Should have sources in frontmatter, not as plain text
    expect(md).toContain('sources:');
    expect(md).toContain('url: "https://example.com/article"');
    expect(md).toContain('type: "web"');
    expect(md).not.toContain('Source: https://example.com/article');
  });

  it('omits sources frontmatter when no sourceUrl', () => {
    const item: InboxItem = {
      id: 'test-456',
      content: 'Just a note',
      title: 'Plain Item',
      source: 'cli',
      sourceUrl: null,
      sourceMeta: null,
      status: 'pending',
      createdAt: '2026-02-23T00:00:00Z',
      processedAt: null,
    };

    const md = inboxItemToMarkdown(item);

    expect(md).not.toContain('sources:');
    expect(md).not.toContain('Source:');
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- __tests__/services/indexing.test.ts`
Expected: FAIL — the first test should fail because current implementation appends `Source:` as plain text.

### Step 3: Update inboxItemToMarkdown

In `src/services/indexing.ts`, modify `inboxItemToMarkdown` to include `sources` in the YAML frontmatter:

```typescript
export function inboxItemToMarkdown(item: InboxItem): string {
  const now = new Date().toISOString().slice(0, 10);
  const title = item.title ?? 'Inbox capture';
  const id = slugify(title) || item.id.slice(0, 8);
  const lines = [
    '---',
    `id: ${id}`,
    `title: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    'type: note',
    'tier: fast',
    `status: draft`,
    `created: ${now}`,
    `modified: ${now}`,
  ];
  if (item.sourceUrl) {
    lines.push('sources:');
    lines.push(`  - url: "${item.sourceUrl}"`);
    lines.push(`    accessed: "${now}"`);
    lines.push('    type: "web"');
  }
  lines.push('---');
  lines.push('');
  lines.push(item.content);
  return lines.join('\n');
}
```

### Step 4: Run tests to verify they pass

Run: `npm test -- __tests__/services/indexing.test.ts`
Expected: PASS

### Step 5: Verify sources are parsed correctly through the full pipeline

If there's an existing integration test for `processInbox`, verify it still passes. Otherwise, verify with:

Run: `npm test`
Expected: All tests pass

### Step 6: Commit

```bash
git add src/services/indexing.ts __tests__/services/indexing.test.ts
git commit -m "Fix inbox source preservation: use sources frontmatter instead of plain text"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/indexing.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] `inboxItemToMarkdown` with `sourceUrl` produces `sources:` YAML frontmatter
- [ ] `inboxItemToMarkdown` without `sourceUrl` omits sources entirely
- [ ] No `Source: {url}` plain text in output

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT change `processInbox` behavior — only `inboxItemToMarkdown` output format changes
