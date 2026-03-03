I just installed brain (npm install -g @titan-design/brain). Help me set up project management for ~/Documents/projects/voltras-workspace

First, run `brain init --notes-dir ~/brain --embedder local` to initialize the database and index reference documentation (including PM command docs). Wait for it to complete before proceeding.

Then use `brain pm onboard "voltras-workspace" --prefix VOLT` — always pass `--prefix VOLT` explicitly. Do not omit the --prefix flag or let it auto-derive.

## Important Quality Requirements

### Task Bodies Are Required

For every task created with `brain pm task add`, you MUST include a `--description` flag with rich body content:

1. A 2-3 sentence "done" description — what does complete look like?
2. Acceptance criteria as a bullet list (3-5 items)
3. References to relevant docs, files, or code locations discovered during your analysis

Example:
```
brain pm task add "Implement ReplayBLEAdapter for deterministic session replay" \
  --workstream 1 --priority critical --category implementation \
  --description "The node-sdk needs a ReplayBLEAdapter that replays recorded BLE sessions for deterministic testing without hardware. Done: adapter loads session recordings from JSON fixtures and replays characteristic notifications with original timing.\n\nAcceptance criteria:\n- Implements BLEAdapter interface from platform-adapters.ts\n- Loads recorded sessions from JSON fixture files\n- Replays notifications with configurable timing (real-time or instant)\n- Unit tests cover: load, replay, error on missing fixture\n\nRef: packages/node-sdk/src/ble-adapter.ts, docs/platform-adapters.md §ReplayBLEAdapter"
```

### Task Numbering

Number tasks sequentially within each workstream with NO gaps. Workstream 1 tasks: .01, .02, .03, etc.

### Task Mode

Set `--mode manual` for tasks that require physical hardware, vendor accounts, or human interaction. All other tasks should be `--mode auto`.

### Project Note

When creating the project with `brain pm onboard`, write a meaningful project-level note body (not just the title). Include: project purpose, key repos/packages, tech stack, and current development phase.

### Doc-First Discovery

Before creating tasks, thoroughly scan the `docs/` directories in each package/repo to understand existing architecture, specs, and plans. Reference these docs in task descriptions.
