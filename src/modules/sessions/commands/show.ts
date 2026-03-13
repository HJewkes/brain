import { Command } from '@commander-js/extra-typings';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { withDb } from '../../../services/brain-service.js';
import { getSession, getSessionBySessionId } from '../data/session-ops.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSessionShowCommand(): Command<any> {
  return new Command('show')
    .description('Show session details')
    .argument('<id>', 'Session display ID (SNS-NNN) or UUID')
    .option('--level <n>', 'Detail level: 0 (summary), 1 (overview), 2 (full)', '1')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: { level?: string; json?: boolean }) => {
      await withDb(async (svc) => {
        // Resolve by display_id or session_id (UUID)
        let session = getSession(svc.db, id);
        if (!session) {
          session = getSessionBySessionId(svc.db, id);
        }

        if (!session) {
          process.stderr.write(`Session "${id}" not found\n`);
          process.exitCode = 1;
          return;
        }

        const level = parseInt(opts.level ?? '1', 10);

        if (opts.json) {
          const result: Record<string, unknown> = { ...session };
          if (level >= 1) {
            result.l1 = readContentFile(svc.config.notesDir, session.display_id, 'l1-overview.md');
          }
          if (level >= 2) {
            result.l2 = readContentFile(svc.config.notesDir, session.display_id, 'l2-timeline.md');
          }
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }

        // Human-readable output
        process.stdout.write(`Session ${session.display_id}\n`);
        process.stdout.write(`  UUID: ${session.session_id}\n`);
        process.stdout.write(`  Status: ${session.status}\n`);
        process.stdout.write(`  Started: ${session.started_at}\n`);
        if (session.completed_at) process.stdout.write(`  Completed: ${session.completed_at}\n`);
        if (session.duration_minutes != null)
          process.stdout.write(`  Duration: ${session.duration_minutes}m\n`);
        if (session.branch) process.stdout.write(`  Branch: ${session.branch}\n`);
        if (session.agent_model) process.stdout.write(`  Model: ${session.agent_model}\n`);
        if (session.summary) process.stdout.write(`  Summary: ${session.summary}\n`);

        if (session.tool_calls != null) {
          process.stdout.write(
            `  Tool calls: ${session.tool_calls} (${session.error_count ?? 0} errors)\n`
          );
        }
        if (session.tasks_worked?.length) {
          process.stdout.write(`  Tasks worked: ${session.tasks_worked.join(', ')}\n`);
        }
        if (session.commits?.length) {
          process.stdout.write(`  Commits: ${session.commits.length}\n`);
        }

        if (level >= 1) {
          const l1 = readContentFile(svc.config.notesDir, session.display_id, 'l1-overview.md');
          if (l1) {
            process.stdout.write('\n--- L1 Overview ---\n');
            process.stdout.write(l1 + '\n');
          }
        }

        if (level >= 2) {
          const l2 = readContentFile(svc.config.notesDir, session.display_id, 'l2-timeline.md');
          if (l2) {
            process.stdout.write('\n--- L2 Timeline ---\n');
            process.stdout.write(l2 + '\n');
          }
        }
      });
    });
}

function readContentFile(notesDir: string, displayId: string, filename: string): string | null {
  const path = join(notesDir, 'modules', 'sessions', displayId, filename);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
