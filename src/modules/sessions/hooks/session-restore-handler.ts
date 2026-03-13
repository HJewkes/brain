import { readFileSync } from 'node:fs';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow, hookAllowJson } from '../../../hooks/types.js';
import { detectResumableSession } from '../engine/session-restore.js';

let hasRun = false;

function renderSnapshotContext(snapshotPath: string): string | null {
  let snapshot: {
    session_id: string;
    project_dir: string;
    git_branch: string | null;
    snapshot_at: string;
    open_items: string[];
    active_files: string[];
  };
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as typeof snapshot;
  } catch {
    return null;
  }

  const lines: string[] = [];
  lines.push(`<session uuid="${snapshot.session_id}">`);
  lines.push(`  <project_dir>${snapshot.project_dir}</project_dir>`);
  if (snapshot.git_branch) lines.push(`  <branch>${snapshot.git_branch}</branch>`);
  lines.push(`  <snapshot_at>${snapshot.snapshot_at}</snapshot_at>`);
  if (snapshot.open_items.length > 0) {
    lines.push('  <open_items>');
    for (const item of snapshot.open_items) lines.push(`    <item>${item}</item>`);
    lines.push('  </open_items>');
  }
  if (snapshot.active_files.length > 0) {
    lines.push('  <active_files>');
    for (const f of snapshot.active_files) lines.push(`    <file>${f}</file>`);
    lines.push('  </active_files>');
  }
  lines.push('</session>');
  return lines.join('\n');
}

export const sessionRestoreHandler: HookHandler = {
  name: 'sessions:restore',
  event: 'prompt-submit',
  priority: 50,

  enabled(_config: HookConfig): boolean {
    return !hasRun;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    hasRun = true;

    const resumable = detectResumableSession(input.cwd);
    if (!resumable) return hookAllow();

    const context = renderSnapshotContext(resumable.snapshotPath);
    if (!context) return hookAllow();

    return hookAllowJson(
      `<session-restore>\n${context}\n</session-restore>`
    );
  },
};

/** Reset the one-shot guard (for testing). */
export function resetSessionRestoreHandler(): void {
  hasRun = false;
}
