# Task 03: Knowledge Module

## Architectural Context

Currently, core brain note types (`note`, `research`, `meeting`, `guide`, `pattern`, `session-log`, `decision`) are hardcoded in `src/types.ts` as the `CoreNoteType` union. The content archetype texts used for embedding-based classification are hardcoded in `src/services/content-archetypes.ts`. This task creates a `knowledge` module that registers these types via the module system with `importHints`, moving archetype text ownership from core to the module. The module also provides a `ContentHandler` (v2 interface) that materializes knowledge notes into the right directories.

The module loader discovers modules from `src/modules/` — this module will be a directory at `src/modules/knowledge/`.

## File Ownership

**May modify:**
- `src/modules/knowledge/index.ts` (new file)
- `__tests__/modules/knowledge/index.test.ts` (new file)

**Must not touch:**
- `src/types.ts` (Task 1)
- `src/services/content-archetypes.ts` (Task 5 removes this)
- `src/modules/pm/` (Task 4)

**Read for context (do not modify):**
- `src/modules/types.ts` — `BrainModule`, `ModuleContext`, `ModuleNoteType` interfaces
- `src/modules/pm/index.ts` — example module registration pattern
- `src/services/content-archetypes.ts` — archetype texts to migrate
- `src/types.ts` — `CoreNoteType`, `VALID_CORE_NOTE_TYPES`
- `src/commands/add.ts` — `TYPE_DIRS` mapping shows where each type's notes go

## Steps

### Step 1: Write the module

Create `src/modules/knowledge/index.ts`:

```typescript
import type { BrainModule } from '../types.js';

export const knowledgeModule: BrainModule = {
  name: 'knowledge',
  version: '1.0.0',
  description: 'Core knowledge note types and content handling',
  register(ctx) {
    ctx.registerNoteType({
      name: 'note',
      description: 'General knowledge note',
      tier: 'slow',
      importHints: {
        archetypeText: 'General knowledge notes, observations, ideas, and reference material. Information worth remembering but not fitting a specific category.',
      },
    });

    ctx.registerNoteType({
      name: 'research',
      description: 'In-depth research or analysis',
      tier: 'slow',
      importHints: {
        tableColumnAliases: {
          topic: ['topic', 'subject', 'area'],
          source: ['source', 'reference', 'url', 'link'],
          findings: ['findings', 'results', 'conclusions'],
        },
        archetypeText: 'System architecture documentation describing components, data flow, deployment topology, infrastructure, microservices, APIs, and technical design decisions. Also in-depth research, analysis, and investigation documents.',
      },
    });

    ctx.registerNoteType({
      name: 'meeting',
      description: 'Meeting notes with attendees and action items',
      tier: 'fast',
      importHints: {
        tableColumnAliases: {
          date: ['date', 'when', 'meeting_date'],
          attendees: ['attendees', 'participants', 'people', 'who'],
          agenda: ['agenda', 'topics', 'items'],
        },
        archetypeText: 'Meeting notes with attendees, agenda, discussion points, decisions made, and action items. Standup notes, retrospectives, and planning session summaries.',
      },
    });

    ctx.registerNoteType({
      name: 'guide',
      description: 'How-to guide or tutorial',
      tier: 'slow',
      importHints: {
        tableColumnAliases: {
          topic: ['topic', 'subject'],
          audience: ['audience', 'for'],
          prerequisites: ['prerequisites', 'requirements', 'needs'],
        },
        archetypeText: 'Product requirements document with user stories, acceptance criteria, functional and non-functional requirements. PRDs, specs, feature requests. Also how-to guides, tutorials, and walkthroughs.',
      },
    });

    ctx.registerNoteType({
      name: 'pattern',
      description: 'Recurring pattern or best practice',
      tier: 'slow',
      importHints: {
        tableColumnAliases: {
          context: ['context', 'when'],
          problem: ['problem', 'issue', 'challenge'],
          solution: ['solution', 'fix', 'approach', 'resolution'],
        },
        archetypeText: 'Reference material such as configuration tables, API documentation, glossaries, lookup tables, and comparison matrices. Recurring patterns, best practices, and lessons learned.',
      },
    });

    ctx.registerNoteType({
      name: 'session-log',
      description: 'Work session log entry',
      tier: 'fast',
    });

    ctx.registerNoteType({
      name: 'decision',
      description: 'Decision record',
      tier: 'slow',
    });
  },
};

export default knowledgeModule;
```

### Step 2: Write tests

Create `__tests__/modules/knowledge/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { knowledgeModule } from '../../../src/modules/knowledge/index.js';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';

describe('knowledge module', () => {
  it('registers all core note types', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(knowledgeModule);
    const ctx = createModuleContext(registry, 'knowledge');
    knowledgeModule.register(ctx);

    const types = registry.getAllNoteTypes();
    const names = types.map(t => t.noteType.name);
    expect(names).toContain('note');
    expect(names).toContain('research');
    expect(names).toContain('meeting');
    expect(names).toContain('guide');
    expect(names).toContain('pattern');
    expect(names).toContain('session-log');
    expect(names).toContain('decision');
  });

  it('provides importHints with archetypeText for classifiable types', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(knowledgeModule);
    const ctx = createModuleContext(registry, 'knowledge');
    knowledgeModule.register(ctx);

    const research = registry.getNoteType('research');
    expect(research?.importHints?.archetypeText).toBeDefined();
    expect(research?.importHints?.tableColumnAliases).toBeDefined();
  });

  it('provides tableColumnAliases for structured types', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(knowledgeModule);
    const ctx = createModuleContext(registry, 'knowledge');
    knowledgeModule.register(ctx);

    const meeting = registry.getNoteType('meeting');
    expect(meeting?.importHints?.tableColumnAliases?.attendees).toContain('participants');
  });
});
```

### Step 3: Run tests

Run: `npm test -- __tests__/modules/knowledge/index.test.ts`
Expected: PASS

### Step 4: Commit

```bash
git add src/modules/knowledge/index.ts __tests__/modules/knowledge/index.test.ts
git commit -m "feat: add knowledge module with core note type registrations"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/modules/knowledge/index.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] All 7 core note types registered with correct tiers
- [ ] `note`, `research`, `meeting`, `guide`, `pattern` have `archetypeText`
- [ ] `research`, `meeting`, `guide`, `pattern` have `tableColumnAliases`

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add a content handler to this module yet — that comes after Task 6
- Do NOT remove `CoreNoteType` from `src/types.ts` — Task 5 handles cleanup
- Note type `decision` is also registered by PM module — this will need conflict resolution. For now register it here without a schema (PM's schema takes precedence). Task 5 will sort out the duplicate.
