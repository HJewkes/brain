# Brain v0.2 Publishing Design

> Publish brain as a globally installable npm package with Ollama auto-detection and a bundled Claude Code skill.

## Context

Brain v0.1 is a working CLI with 10 commands, hybrid RAG search, and 3 embedding backends. It's currently `"private": true` and installed only from source. The goal is to make it installable via `npm install -g` with minimal friction for a developer audience (friends/team), and ship a Claude Code skill that lets Claude search and manage the knowledge base.

## Package Distribution

**Package:** `@titan-design/brain` on npm (titan-design org as catch-all for personal projects)

**Install:** `npm install -g @titan-design/brain`

**Key changes to package.json:**
- Remove `"private": true`
- Rename to `@titan-design/brain`
- Bump to `0.2.0`
- Move `@huggingface/transformers` to `optionalDependencies` — local embedder still works if installed, not required
- `better-sqlite3` and `sqlite-vec` remain regular dependencies (both ship prebuilds for macOS arm64/x64, Linux x64/arm64, Windows x64)
- Add `"files": ["dist", "skill", "scripts"]` to control what ships
- Add `postinstall`/`preuninstall` scripts for skill management
- Add `publishConfig: { "access": "public", "provenance": true }`

## Init Flow with Ollama Auto-Detection

Current init eagerly imports the heavy local embedder just for model/dimensions. The review fixes already add `getEmbedderInfo()` for static lookup. The new init flow builds on that:

1. **Check for Ollama:** Fetch `http://localhost:11434/api/tags` with 3s timeout
2. **If Ollama running:**
   - Check if `nomic-embed-text` is in the model list
   - If missing, print "Pulling nomic-embed-text..." and run `ollama pull nomic-embed-text`
   - Set config: `embedder: 'ollama'`, `ollamaUrl: 'http://localhost:11434'`
3. **If Ollama not running:**
   - Check if `@huggingface/transformers` is importable (dynamic import, try/catch)
   - If available: set `embedder: 'local'`
   - If not available: present interactive choice via readline:
     - **Install Ollama** — open `https://ollama.com` in browser, wait for user to press enter, re-check
     - **Use local embeddings** — run `npm install -g @huggingface/transformers`, set `embedder: 'local'`
     - **Exit** — exit with message to run `brain init` again later
4. **CLI flags override:** `--embedder ollama|local|remote` skips auto-detection entirely

## Bundled Claude Code Skill

### Delivery

A `postinstall` script (`scripts/postinstall.js`) runs on `npm install -g`:
1. Resolve `~/.claude/skills/brain/`
2. Create directory if missing
3. Copy `skill/SKILL.md` into it
4. Print: "Installed brain skill to ~/.claude/skills/brain/"

If `~/.claude/` doesn't exist (user doesn't use Claude Code), skip silently.

A `preuninstall` script removes `~/.claude/skills/brain/` on uninstall.

### Skill Content

Lean ~50-80 line `SKILL.md` with YAML frontmatter. No `references/` directory — all logic lives in the CLI.

```yaml
---
name: brain
description: Search and manage your second brain knowledge base.
---
```

Body covers:
- **What brain is:** One-liner description
- **Core workflow:** search, add, status, stale
- **Command reference:** Compact table of commands Claude would use, all with `--json` for structured output
- **Note conventions:** Frontmatter fields (type, tier, tags, confidence), tier system (slow = permanent, fast = ephemeral)
- **Rules:** Always use `--json` when processing. Don't run `brain index` unless asked. Search before claiming info isn't in the KB.

## Publishing Infrastructure

**GitHub Actions workflow** (`release.yml`):
- Trigger: push tag `v*`
- Steps: checkout, Node 22, `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, publish
- OIDC trusted publishing (no NPM_TOKEN secret)
- npm provenance enabled

**Release process:**
1. Bump version in `package.json`
2. `git tag v0.2.0 && git push --tags`
3. Actions builds, tests, publishes

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Rename, unprivate, version bump, files, scripts, publishConfig, move HF to optional |
| `scripts/postinstall.js` | New — copy skill to ~/.claude/skills/brain/ |
| `scripts/preuninstall.js` | New — remove skill on uninstall |
| `skill/SKILL.md` | New — Claude Code skill content |
| `src/commands/init.ts` | Ollama auto-detection, interactive fallback |
| `.github/workflows/release.yml` | New — OIDC publish workflow |
