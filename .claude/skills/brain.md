# Brain Knowledge Base

Interact with the brain — a searchable knowledge base for the Voltras ecosystem.

**CLI**: `npx tsx src/cli.ts` from `/Users/hjewkes/Documents/projects/brain`
**Data**: `~/brain/`

## When to Use

- **Before work**: Search for prior decisions, patterns, and research on your topic.
- **After work**: Deposit findings, decisions, and patterns for future agents.

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
```

## Add Notes

```bash
brain add <file> [options]
  --title <title>               Note title (required)
  --type <type>                 note|decision|pattern|research|meeting|session-log|guide
  --tier <tier>                 slow|fast
  --tags <tags>                 Comma-separated tags
  --summary <text>              One-line summary for search excerpts
  --confidence <level>          high|medium|low|speculative
  --status <status>             current|outdated|deprecated|draft
  --category <cat>              Project category
  --related <ids>               Comma-separated related note IDs
  --review-interval <interval>  e.g. 30d, 60d, 90d, 180d
  --created <date>              YYYY-MM-DD (defaults to today)
```

## Other Commands

| Command | Purpose |
|---------|---------|
| `brain status` | Overview of knowledge base |
| `brain graph <note-id>` | Show note's connections |
| `brain stale` | List notes past review interval |
| `brain index` | Rebuild search index |
| `brain template <type>` | Generate template for a note type |

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

## Workflow Patterns

**Context pull** — before planning or brainstorming:
```bash
brain search "topic" --category mobile --min-score 0.4 --expand
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
