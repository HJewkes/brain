import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { getSession, listSessions } from '../data/session-ops.js';
import { runPostExecutionAnalysis } from '../analytics/post-execution-analyzer.js';

function fmtScore(v: number | null): string {
  return v != null ? v.toFixed(1) : 'N/A';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSessionAnalyzeCommand(): Command<any> {
  return new Command('analyze')
    .description('Run GPA post-execution analysis on a session')
    .argument('[session-id]', 'Session display ID (e.g. SNS-001)')
    .option('--all', 'Analyze all sessions with JSONL data')
    .option('--force', 'Overwrite existing analysis note')
    .action(async (sessionId: string | undefined, opts: { all?: boolean; force?: boolean }) => {
      await withBrain(async (svc) => {
        if (opts.all) {
          const sessions = listSessions(svc.db).filter((s) => s.jsonl_path != null);
          let count = 0;

          for (const session of sessions) {
            try {
              const result = await runPostExecutionAnalysis(
                svc,
                session.session_id,
                session.tasks_worked?.join(', '),
                { force: opts.force }
              );
              if (!result.skipped) count++;
            } catch (err) {
              process.stderr.write(`Failed to analyze ${session.display_id}: ${String(err)}\n`);
            }
          }

          process.stdout.write(`Analyzed ${count} sessions\n`);
          return;
        }

        if (!sessionId) {
          process.stderr.write('Error: session-id required unless --all is specified\n');
          process.exit(1);
        }

        const session = getSession(svc.db, sessionId);
        if (!session) {
          process.stderr.write(`Session ${sessionId} not found\n`);
          process.exit(1);
        }

        const taskDescription = session.tasks_worked?.join(', ');
        const result = await runPostExecutionAnalysis(svc, session.session_id, taskDescription, {
          force: opts.force,
        });

        if (result.skipped) {
          process.stdout.write(`Already analyzed — use --force to re-run\n`);
          return;
        }

        const { score } = result;
        process.stdout.write('\n');
        process.stdout.write(`GPA Score:  ${fmtScore(score.gpa)}\n`);
        process.stdout.write(`  Goal:     ${fmtScore(score.dimensions.goal)}\n`);
        process.stdout.write(`  Plan:     ${fmtScore(score.dimensions.plan)}\n`);
        process.stdout.write(`  Action:   ${fmtScore(score.dimensions.action)}\n`);
        if (result.notePath) {
          process.stdout.write(`Note:       ${result.notePath}\n`);
        }
      });
    });
}
