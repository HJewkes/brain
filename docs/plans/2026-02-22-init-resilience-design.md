# Init & Resilience Design — Hook-Triggered Processing

**Date:** 2026-02-22
**Branch:** `feat/init-setup`
**Status:** Approved

## Problem

Brain's CLI has gaps in setup and resilience:

1. **`brain init` skips LLM setup** — handles embedder auto-detection but not the `qwen2.5:3b` model needed for `extract` and `tidy`. Clean installs discover this at runtime.
2. **No health diagnostics** — no single command to check if everything is working (DB, embedder, Ollama, inbox backlog, stale notes).
3. **Ollama failures crash commands** — `extract`, `tidy`, and `index --extract` throw unhandled fetch errors when Ollama is down.
4. **Inbox items pile up** — nothing triggers `brain index --inbox` automatically. Users forget.

## Decision

**Approach B: Hook-Triggered Processing** — enhance the CLI with opportunistic health checks, a dedicated `doctor` command, and OS-native scheduled processing via launchd (macOS) / systemd (Linux). No daemon.

### Why not a daemon?

- Zero overhead when idle — no persistent process consuming memory
- Crash-resilient by design — OS scheduler restarts on next interval
- Simpler architecture — no PID management, IPC, or socket lifecycle
- launchd/systemd are battle-tested schedulers

## Design

### 1. Enhanced `brain init` — LLM Setup + Validation

Add a third setup phase after embedder configuration:

1. **Workspace setup** (existing) — directories, templates, config, DB
2. **Embedder setup** (existing) — auto-detect Ollama → local → prompt
3. **LLM setup** (new) — if Ollama is available:
   - Check if `qwen2.5:3b` is already pulled
   - If not, offer to pull it (same UX pattern as embedder model pull)
   - If Ollama isn't running, skip with message pointing to `brain doctor`
4. **Capabilities summary** (new) — print what's available:
   ```
   Initialized brain at ~/brain
   Embedder: ollama (nomic-embed-text) ✓
   LLM: ollama (qwen2.5:3b) ✓
   Features: search ✓  extract ✓  tidy ✓
   ```

### 2. `brain doctor` — Health Check + Self-Healing

New command: `brain doctor [--fix] [--json]`

Checks run in order:

| Check | What it verifies | Auto-fix (`--fix`) |
|-------|-----------------|-------------------|
| Database | Opens DB, schema version, `PRAGMA integrity_check` | None (manual) |
| Embedder | Embeds a probe string, verifies model loaded | Re-pull Ollama model |
| LLM | Pings Ollama `/api/tags`, checks model present | `ollama pull qwen2.5:3b` |
| Inbox | Counts pending and failed items | Reset failed → pending |
| Stale notes | Counts notes past review interval | None (user decision) |
| Index freshness | Checks for unindexed file changes | Run `brain index` |
| Hooks | Checks if scheduled processing is installed | Offer to install |

Text output:
```
brain doctor
  Database ............. ok (v5, 42 notes, 186 chunks)
  Embedder ............. ok (local, all-MiniLM-L6-v2)
  LLM .................. warning (Ollama running, model not found)
  Inbox ................ ok (0 pending, 0 failed)
  Stale notes .......... warning (3 notes past review)
  Index ................ ok (last indexed 2h ago)
  Scheduled processing . not installed

  1 warning, 0 errors
  Run "brain doctor --fix" to auto-repair warnings
```

**Architecture:** `src/services/health.ts` contains pure check logic (returns structured results, no I/O). `src/commands/doctor.ts` handles display and `--fix` orchestration.

### 3. Graceful Degradation in Ollama-Dependent Commands

**New helper in `ollama.ts`:**
```typescript
export async function checkOllamaHealth(url?: string): Promise<{
  running: boolean;
  models: string[];
}>;
```

**Error improvements in `OllamaClient.generate()`:**
- `ECONNREFUSED` → "Ollama is not running. Start with `ollama serve` or check `brain doctor`."
- Timeout → "Ollama request timed out (120s). The model may be loading."
- 404 → "Model not found. Run `ollama pull <model>`."

**Per-command changes:**
- **`extract`** — pre-check Ollama health. Clear error + exit code 1 if unavailable.
- **`tidy`** — same pre-check pattern.
- **`index --extract`** — if Ollama unavailable, proceed with indexing but skip extraction with warning.

### 4. `brain install-hooks` — Scheduled Processing

New command: `brain install-hooks [--interval <minutes>] [--uninstall] [--status] [--json]`

**Default interval:** 360 minutes (6 hours)

**Hook command:**
```bash
brain index --inbox --extract --quiet 2>> ~/brain/.brain-hook.log
```

**macOS (launchd):**
- Plist at `~/Library/LaunchAgents/com.brain.index.plist`
- `StartInterval` for repeat schedule
- `StandardErrorPath` for logging
- Install via `launchctl load`, uninstall via `launchctl unload`

**Linux (systemd user timer):**
- Service + timer at `~/.config/systemd/user/brain-index.{service,timer}`
- Install via `systemctl --user enable --now brain-index.timer`

**Lock file:** `~/brain/.brain-hook.lock` with PID check to prevent overlapping runs.

**Status output:**
```
Scheduled processing: active
  Platform: macOS (launchd)
  Interval: every 6 hours
  Last run: 2026-02-22 14:30:00
  Log: ~/brain/.brain-hook.log (2.1 KB)
```

## Files Changed

| File | Change |
|------|--------|
| `src/commands/doctor.ts` | New — `brain doctor` command |
| `src/commands/install-hooks.ts` | New — `brain install-hooks` command |
| `src/services/health.ts` | New — pure health check logic |
| `src/services/ollama.ts` | Add `checkOllamaHealth()`, improve error messages |
| `src/commands/init.ts` | Add LLM model setup + capabilities summary |
| `src/commands/extract.ts` | Add Ollama pre-check |
| `src/commands/tidy.ts` | Add Ollama pre-check |
| `src/commands/index-cmd.ts` | Graceful degradation for `--extract` |
| `src/cli.ts` | Register new commands |
| `src/types.ts` | Add health check types |

## Skipped

- **Daemon/service process** — OS schedulers handle this better with less code
- **Extracting hooks to shared package** — too thin an abstraction (<150 LOC), would add dependency management overhead. Revisit if a third project needs it.
- **HTTP health endpoint** — no daemon means no server to expose endpoints. `brain doctor --json` serves the same purpose for programmatic consumers.
