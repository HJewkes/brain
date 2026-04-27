# Codebase Indexing Quick Start

The codebase module scans TypeScript source files and generates architecture notes — one per module — stored in brain as `type: architecture` notes. These notes make code structure searchable alongside your regular knowledge, and the post-merge hook keeps them automatically up-to-date.

## Prerequisites

- brain initialized and indexed
- A TypeScript project to index

---

## 1. What Problem It Solves

Understanding a large codebase requires reading files one by one. The codebase module extracts module purpose, exports, and dependencies into structured notes so you can search the architecture ("what handles webhook routing?"), ask brain about dependencies, or get a map of the codebase without opening an IDE.

---

## 2. Index the Codebase

Run the indexer from the project root:

```bash
brain codebase index
```

Output:

```
Scanning: src/**/*.ts
Files found: 87
Modules analyzed: 87
  Changed: 12
  Unchanged: 75
Notes written: 12
```

Only modules with changed exports are re-indexed on subsequent runs (hash-based change detection).

---

## 3. Index a Different Project

```bash
brain codebase index --project-dir /path/to/project --output-dir ~/brain/architecture/my-project
```

---

## 4. Search Architecture Notes

Once indexed, architecture notes are searchable with the standard brain search:

```bash
brain search "webhook routing"
brain search "database migrations" --type architecture
```

Or via MCP:

```
brain_search  query="search orchestration"  type="architecture"
```

---

## 5. Install the Post-Merge Hook

Keep architecture notes current by installing a post-merge git hook:

```bash
brain codebase install-hook
```

This writes a hook to `.git/hooks/post-merge` that runs `brain codebase index` automatically after each `git merge` or `git pull`.

---

## What Each Architecture Note Contains

For each module (`src/services/search.ts` → note `Architecture: src/services/search`):

- **Purpose** — extracted from the module's leading JSDoc comment
- **Exports** — function/class/type signatures
- **Internal dependencies** — other src modules it imports
- **External dependencies** — npm packages it uses
- **Export hash** — SHA256 of the exports signature (used for change detection)

Frontmatter example:

```yaml
title: "Architecture: src/services/search"
type: architecture
tier: slow
module: codebase
module-path: src/services/search
language: typescript
exports-hash: "a1b2c3..."
tags: [architecture, typescript]
```

---

## How It Works

`discoverFiles` (`src/modules/codebase/scanner.ts`) glob-matches source files. `scanModules` parses each file's AST via `src/modules/codebase/extractors/typescript-extractor.ts`, extracting exports and dependencies. Modules whose `exports-hash` has changed since the last run are re-indexed. `generateNotes` (`src/modules/codebase/note-generator.ts`) writes the markdown notes into the brain workspace.

---

## Related

- Scanner: `src/modules/codebase/scanner.ts`
- Note generator: `src/modules/codebase/note-generator.ts`
- TypeScript extractor: `src/modules/codebase/extractors/typescript-extractor.ts`
- Hook installer: `src/modules/codebase/commands/install-hook.ts`
