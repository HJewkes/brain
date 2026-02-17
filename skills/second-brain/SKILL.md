---
name: second-brain
description: Search, add, and manage notes in the developer knowledge base
---

# Second Brain

## When to Use
- User asks about past research, decisions, or notes
- User wants to save findings from this session
- User asks "what do I know about X"
- User wants to check for stale knowledge

## Commands

**Search** (returns JSON by default):
```bash
brain search "query" --json --limit 5
```

**Search with filters:**
```bash
brain search "query" --json --tier slow --tags "tag1" --category "frontend"
```

**Add a note** (pipe content via stdin):
```bash
brain add --title "Title" --type note --tier slow --tags "tag1,tag2" <<'EOF'
## Content here
EOF
```

**Add from file:**
```bash
brain add /path/to/file.md
```

**Check stale notes:**
```bash
brain stale --json
```

**Re-index after file changes:**
```bash
brain index --quiet
```

## Output Format

Search returns JSON array:
```json
[{ "score": 0.85, "filePath": "...", "noteId": "...", "heading": "...", "excerpt": "...", "tier": "slow", "tags": ["..."] }]
```

Non-zero exit = error. Error messages on stderr. Stdout is always valid JSON when invoked with --json.
