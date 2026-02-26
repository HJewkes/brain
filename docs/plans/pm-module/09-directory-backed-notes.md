# Directory-Backed Notes — Brain Core Extension

**Date:** 2026-02-26
**Status:** Draft
**Extends:** 01-brain-module-system.md (Storage Extensibility section)
**Part of:** Task Management Framework — Design Series

---

## Overview

Directory-backed notes extend brain's note primitive with an optional managed directory for workspace artifacts. This is a **brain core feature**, not PM-specific — any module can use it.

The motivation: some notes need more than a title, metadata, and markdown body. A PM task needs a completion summary, reference files, and potentially output logs. A research note might have downloaded PDFs and data extracts. Rather than cramming everything into the note body or creating a parallel file management system, brain manages the directory as part of the note lifecycle.

---

## Design

### Schema Extension

```sql
-- Migration: brain_directory_notes_v1
ALTER TABLE notes ADD COLUMN content_dir TEXT;  -- nullable, relative path
```

When `content_dir` is set:
- Brain manages a directory at `{notesDir}/modules/{module}/{content_dir}/`
- The note's `content` column (markdown body) holds searchable summary text
- The directory holds structured artifacts whose schema is defined by the owning module
- Brain's index pipeline asks the module hook "which files should I FTS-index?"

When `content_dir` is NULL (the default):
- The note behaves exactly as it does today
- No directory management, no overhead
- This preserves full backward compatibility

### Directory Location

```
{notesDir}/
├── notes/                      ← existing brain notes (markdown files)
├── modules/
│   ├── pm/                     ← PM module's managed directories
│   │   ├── WEB-01/03/          ← task WEB-01.03's content directory
│   │   │   ├── summary.md
│   │   │   └── references/
│   │   ├── WEB-02/01/
│   │   │   ├── summary.md
│   │   │   └── references/
│   │   │       └── api-spec.yaml
│   │   └── ...
│   └── crm/                    ← hypothetical CRM module
│       └── ...
└── inbox/                      ← existing brain inbox
```

The `content_dir` value stored in the database is the relative path from `{notesDir}/modules/{module}/` — e.g., `WEB-01/03` for task WEB-01.03 in the PM module.

### Module Hook Contract

Modules that use directory-backed notes register hooks via `ModuleContext`:

```typescript
// Added to ModuleContext (extends doc 01's interface)
export interface ModuleContext {
  // ...existing methods from doc 01...

  /** Register directory schemas for module note types */
  registerDirectorySchemas(schemas: DirectorySchema[]): void;
}

export interface DirectorySchema {
  /** Which note type this schema applies to (e.g., 'task') */
  noteType: string;

  /** Files that must exist in the directory */
  required: string[];

  /** Files that may exist */
  optional: string[];

  /** Subdirectories that may exist */
  optionalDirs: string[];

  /** Which files to feed into brain's FTS index */
  ftsIndexable: string[];

  /** Called when a note with content_dir is created */
  onCreate?(dirPath: string, noteMetadata: Record<string, unknown>): Promise<void>;

  /** Called when a note with content_dir is archived or deleted */
  onLifecycle?(event: 'archive' | 'delete', dirPath: string): Promise<void>;
}
```

### PM Module's Directory Schemas

The PM module registers directory schemas for task notes only:

```typescript
// In PM module's register()
ctx.registerDirectorySchemas([
  {
    noteType: 'task',
    required: [],           // nothing required at creation; summary.md written on completion
    optional: ['summary.md'],
    optionalDirs: ['references'],
    ftsIndexable: ['summary.md'],
    async onCreate(dirPath) {
      // Create the directory structure
      await fs.mkdir(dirPath, { recursive: true });
      await fs.mkdir(path.join(dirPath, 'references'), { recursive: true });
    },
    async onLifecycle(event, dirPath) {
      if (event === 'delete') {
        await fs.rm(dirPath, { recursive: true, force: true });
      }
      // 'archive' — leave directory intact (preserves history)
    },
  },
]);
```

**Why only tasks?**

| PM Note Type | Content Dir? | Reasoning |
|-------------|-------------|-----------|
| Project | No | Project description fits in note body. No output artifacts. |
| Workstream | No | Workstream context fits in note body. Shared context assembled by `brain pm dispatch`. |
| Task | **Yes** | Tasks produce output artifacts (summary.md, reference files, logs). |
| Decision | No | Decision rationale fits in note body. Impact chains are in note_relations. |
| Prompt | No | Prompt instructions fit in note body. Versioned via prompt_status field. |
| Capture | No | Quick captures are short text. Processed into other types. |

### Indexing Integration

When brain indexes a note with a `content_dir`:

```
1. Standard indexing: parse frontmatter → notes table (title, type, module, metadata)
2. Body indexing: note's content field → FTS5 (as usual)
3. Directory indexing (new):
   a. Look up module's DirectorySchema for this note type
   b. For each file in ftsIndexable:
      - Read file content from {notesDir}/modules/{module}/{content_dir}/{file}
      - Append to FTS index entry for this note
   c. This means `brain search "authentication"` can find a task whose
      summary.md mentions authentication, even if the note body doesn't
```

### Lifecycle Management

Brain manages the directory lifecycle in coordination with note operations:

| Note Operation | Directory Effect |
|---------------|-----------------|
| Create note with content_dir | Call module's `onCreate` hook → scaffold directory |
| Index note | Read ftsIndexable files → update FTS |
| Archive note | Call module's `onLifecycle('archive')` → module decides (PM: keep) |
| Delete note | Call module's `onLifecycle('delete')` → module decides (PM: remove) |
| Move/rename note | Update `content_dir` column; move directory if needed |

### Creating a Task with Content Dir

When `brain pm task add` creates a task note:

```typescript
// In PM module's task add command
const displayId = `${project}-${workstream}.${number}`;  // e.g., WEB-01.03
const contentDir = `${project}-${workstream}/${number}`;  // WEB-01/03

// 1. Create the brain note with content_dir set
await db.createNote({
  title,
  type: 'task',
  module: 'pm',
  moduleInstance: projectInstance,
  metadata: { displayId, status: 'pending', priority, mode, category, ... },
  content: taskDescription,
  contentDir: contentDir,
});

// 2. The module's onCreate hook scaffolds the directory
// → creates {notesDir}/modules/pm/WEB-01/03/
// → creates {notesDir}/modules/pm/WEB-01/03/references/
```

### Accessing Content Dir Files

The content directory is a standard filesystem directory. Agents and humans can read/write files directly:

```bash
# Agent writes a summary after completing work
cat > "$(brain config get notesDir)/modules/pm/WEB-01/03/summary.md" << 'EOF'
# Summary: WEB-01.03 — Implement User Auth

Status: COMPLETED

## Deliverables
| Artifact | Location | Verified |
|----------|----------|----------|
| Auth middleware | src/middleware/auth.ts | yes — tests pass |
| Login endpoint | src/routes/login.ts | yes — manual test |

## Verification Report
```
$ npm test -- auth
✓ 12 tests passed, 0 failed
```

## Key Decisions
- Chose JWT over session cookies for stateless API compatibility

## Follow-Up Items
- → backlog: Add refresh token rotation
EOF
```

Brain doesn't need to mediate file access — the directory is just a managed location on the filesystem. The value of `content_dir` is that brain knows it exists, indexes its contents, and manages its lifecycle.

### Resolving the Path

```typescript
// Utility: resolve content_dir to absolute path
function resolveContentDir(note: NoteRecord, config: BrainConfig): string | null {
  if (!note.contentDir || !note.module) return null;
  return path.join(config.notesDir, 'modules', note.module, note.contentDir);
}
```

---

## Summary File Conventions

The `summary.md` file in a task's content directory follows a standard structure. This is a **convention**, not enforced by brain — but the PM module's orchestrator validates summaries on completion.

### Template

```markdown
# Summary: {display_id} — {title}

Status: COMPLETED | PARTIAL | BLOCKED

## Deliverables
| Artifact | Location | Verified |
|----------|----------|----------|
| {description} | {file path or URL} | {yes/no — cite evidence} |

## Verification Report
{Paste actual command output. Not "tests pass" — show the output.}

## Key Decisions
- Chose {X} over {Y} because {Z}
{Each decision here should also be recorded via `brain pm decision add`}

## Learnings
- What went well: {observation}
- What was harder than expected: {observation}
- What to do differently: {recommendation}

## Follow-Up Items
- → {future task | backlog | human review}: {description}
```

### Why Summaries Matter

Summaries serve four purposes:
1. **Cross-session continuity** — The next session's briefing can reference what was actually done, not just that a task is "done"
2. **Decision capture** — Decisions made during execution are recorded here and promoted to decision notes
3. **Prompt improvement** — High-rework tasks with poor summaries indicate prompt quality issues
4. **Knowledge accumulation** — Brain's memory extraction can pull learnings from summaries into the knowledge graph

### Summary Validation

The PM module can validate summary quality:

```bash
brain pm verify WEB-01.03 --summary
# Checks:
#   - summary.md exists in content_dir
#   - Has required sections (Deliverables, Verification Report)
#   - Verification Report contains code blocks (actual output, not claims)
#   - Deliverables table has locations and verification status
```

This is part of the broader verification system described in doc 10.

---

## Migration

### Database Migration

```sql
-- Migration: brain_content_dir_v1
-- Adds nullable content_dir column to notes table
ALTER TABLE notes ADD COLUMN content_dir TEXT;

-- No index needed — queries on content_dir are rare (only on note creation/deletion)
-- The module + module_instance index handles scoped queries
```

### Directory Structure

The `{notesDir}/modules/` directory is created on first use by any module. No upfront scaffolding needed.

### Backward Compatibility

- Existing notes get `NULL` for `content_dir` — no behavioral change
- `brain search`, `brain index`, and all existing commands work identically
- The FTS directory indexing only runs for notes with non-NULL `content_dir` and a registered schema
- Modules that don't use directory-backed notes are completely unaffected

---

## Open Questions

1. **Should content_dir files be git-tracked?** If `{notesDir}` is a git repo (common for brain), the module directories will be tracked automatically. This is probably desirable (version history for summaries) but could bloat the repo with reference files. Consider `.gitignore` rules for `modules/*/references/` if needed.

2. **Maximum directory size?** No enforcement for v1. If reference files get large, consider a separate `attachments/` convention outside the content_dir.

3. **Cross-module directory references?** Not supported in v1. Each module manages its own directory namespace. If needed later, use brain note references (note_relations) to link across modules.

---

## References

- Doc 01 (Brain Module System) — ModuleContext interface, storage extensibility
- Doc 02 (PM Module Design) — Task note type, prompt lifecycle
- Doc 10 (Orchestration Enhancements) — Summary validation, verification agents
