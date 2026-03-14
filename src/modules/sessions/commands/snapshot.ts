import { Command } from '@commander-js/extra-typings';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface SnapshotInput {
  session_id: string;
  cwd: string;
  git_branch?: string;
  message_count?: number;
}

export function createSessionSnapshotCommand(): Command {
  return new Command('snapshot')
    .description('Create a PreCompact session snapshot (called from hooks)')
    .option('--from-hook', 'Read snapshot data from stdin')
    .action(async (opts: { fromHook?: boolean }) => {
      if (!opts.fromHook) {
        process.stderr.write('Usage: brain session snapshot --from-hook < input.json\n');
        process.exitCode = 1;
        return;
      }

      const input = await readStdin();
      if (!input) {
        process.stderr.write('No input received on stdin\n');
        process.exitCode = 1;
        return;
      }

      let data: SnapshotInput;
      try {
        data = JSON.parse(input) as SnapshotInput;
      } catch {
        process.stderr.write('Invalid JSON on stdin\n');
        process.exitCode = 1;
        return;
      }

      if (!data.session_id || !data.cwd) {
        process.stderr.write('Missing required fields: session_id, cwd\n');
        process.exitCode = 1;
        return;
      }

      const snapshotDir = join(homedir(), '.claude', 'session-snapshots');
      mkdirSync(snapshotDir, { recursive: true });

      const snapshot = {
        session_id: data.session_id,
        project_dir: data.cwd,
        git_branch: data.git_branch ?? null,
        snapshot_at: new Date().toISOString(),
        message_count: data.message_count ?? 0,
        open_items: [],
        active_files: [],
      };

      const snapshotPath = join(snapshotDir, `${data.session_id}.json`);
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
      process.stderr.write(`Snapshot saved: ${snapshotPath}\n`);
    });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: string[] = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', () => resolve(''));
  });
}
