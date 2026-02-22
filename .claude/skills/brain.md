# Brain Knowledge Base

Interact with the brain — a searchable knowledge base with memory extraction and temporal intelligence.

**CLI**: `npx tsx src/cli.ts` from `/Users/hjewkes/Documents/projects/brain`
**Data**: `~/brain/`

## When to Use

- **Before work**: Search for prior decisions, patterns, and research on your topic.
- **After work**: Deposit findings, decisions, and patterns for future agents.
- **For context**: Pull memories, related notes, and agent profiles.

## Search

```bash
brain search "<query>" [options]
  --json                    JSON output
  --limit <n>               Max results (default 10)
  --min-score <score>       Minimum relevance 0-1 (use 0.4 for broad queries)
  --category <cat>          Filter by category
  --tier <tier>             slow|fast
  --tags <tags>             Comma-separated tag filter
  --confidence <level>      high|medium|low|speculative
  --since <date>            Notes modified after YYYY-MM-DD
  --expand                  Include graph-connected notes
  --memories                Include extracted memory results
  --rerank                  Apply cross-encoder reranking
  --container <tag>         Scope to memory container
```

## Capture

```bash
brain quick "thought or link"       # Zero-friction inbox capture
brain add <file> [options]          # Add note with frontmatter
brain ingest --dir <path>           # Bulk import files
```

## Memory Commands

```bash
brain extract --all                 # Extract memories from all notes (requires Ollama)
brain extract --note <id>           # Extract from specific note
brain memories list --json          # List active memories
brain memories history <id>         # Version chain for a memory
brain memories stats                # Count + expiry sweep
brain context <id> --json           # Note context (relations + memories)
brain profile --format json         # Agent context profile
```

## Other Commands

| Command | Purpose |
|---------|---------|
| `brain status` | Overview of knowledge base |
| `brain graph <note-id>` | Show note's connections |
| `brain stale` | List notes past review interval |
| `brain index` | Rebuild search index |
| `brain template <type>` | Generate template for a note type |
| `brain tidy` | LLM-powered note cleanup suggestions |

## Categories

Always use one of: `brain`, `titan-design`, `voltra-sdk`, `mobile`, `workout`, `skills`

## Quality Rules

When **adding** notes:
- ALWAYS include `--category`, `--tags` (2-3 minimum), and `--summary`
- Include `--related` when the note references existing notes
- Set `--confidence` to signal how proven the content is
- Set `--review-interval` by type: decisions=180d, research=90d, patterns=60d, guides=90d

When **searching**:
- Use `--category` to scope queries to the relevant project
- Use `--min-score 0.4` to filter noise on broad queries
- Use `--expand` when you need the full context graph around a result
- Use `--memories` to include extracted facts alongside note results

## Workflow Patterns

**Context pull** — before planning or brainstorming:
```bash
brain search "topic" --category mobile --min-score 0.4 --expand --memories
```

**Research deposit** — after completing research:
```bash
brain add research.md --title "Finding title" --type research \
  --category voltra-sdk --tags "ble,protocol" --confidence medium \
  --summary "One-line finding" --review-interval 90d
```

**Decision record** — after an architectural decision:
```bash
brain add decision.md --title "Use X over Y" --type decision \
  --category mobile --tags "architecture,state" --confidence high \
  --summary "Chose X because..." --review-interval 180d --related abc123
```
