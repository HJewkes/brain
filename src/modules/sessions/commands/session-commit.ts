import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { requireOllama } from '../../../services/ollama.js';
import { commitSession } from '../engine/commit.js';
import { listSessions } from '../data/session-ops.js';
import type { SessionListFilters } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSessionCommitCommand(): Command<any> {
  return new Command('commit')
    .description('Commit current session: ingest, summarize, link, extract')
    .argument('[session-id]', 'Session UUID (defaults to $BRAIN_PM_SESSION)')
    .option('--skip-summaries', 'Skip LLM summary generation')
    .option('--skip-extraction', 'Skip memory extraction from session chunks')
    .option('--json', 'Output JSON')
    .action(
      async (
        sessionIdArg: string | undefined,
        opts: { skipSummaries?: boolean; skipExtraction?: boolean; json?: boolean }
      ) => {
        const sessionId = sessionIdArg ?? process.env.BRAIN_PM_SESSION;
        if (!sessionId) {
          process.stderr.write(
            'No session ID provided. Pass as argument or set BRAIN_PM_SESSION.\n'
          );
          process.exitCode = 1;
          return;
        }

        await withBrain(async (svc) => {
          const needsOllama = !opts.skipSummaries || !opts.skipExtraction;
          const ollama = needsOllama ? await safeRequireOllama() : null;

          const result = await commitSession(svc.db, svc.config, svc.embedder, sessionId, ollama, {
            skipSummaries: opts.skipSummaries,
            skipExtraction: opts.skipExtraction,
          });

          if (!result.ok) {
            if (opts.json) {
              process.stdout.write(
                JSON.stringify({ ok: false, error: result.error }, null, 2) + '\n'
              );
            } else {
              process.stderr.write(`Error: ${result.error.message}\n`);
            }
            process.exitCode = 1;
            return;
          }

          const session = result.data;

          // Detect continued-from: find a prior session on same branch+projectDir within 1h
          if (session.branch && session.project_dir) {
            const oneHourBefore = new Date(
              new Date(session.started_at).getTime() - 3600000
            ).toISOString();
            const filters: SessionListFilters = {
              projectDir: session.project_dir,
              since: oneHourBefore,
            };
            const candidates = listSessions(svc.db, filters);
            const prior = candidates.find(
              (s) =>
                s.session_id !== session.session_id &&
                s.branch === session.branch &&
                s.started_at < session.started_at
            );

            if (prior) {
              try {
                const sessionNoteIds = svc.db.getModuleNoteIds({
                  module: 'sessions',
                  type: 'session',
                });
                const notes = svc.db.getNotesByIds(sessionNoteIds);
                let currentNoteId: string | null = null;
                let priorNoteId: string | null = null;
                for (const [id, note] of notes) {
                  if (!note.metadata) continue;
                  const meta = JSON.parse(note.metadata) as Record<string, unknown>;
                  if (meta.session_id === session.session_id) currentNoteId = id;
                  if (meta.session_id === prior.session_id) priorNoteId = id;
                }
                if (currentNoteId && priorNoteId) {
                  svc.db.upsertRelations(currentNoteId, [
                    {
                      sourceId: currentNoteId,
                      targetId: priorNoteId,
                      type: 'continued-from',
                    },
                  ]);
                }
              } catch {
                // Non-fatal: relation creation failure shouldn't block commit
              }
            }
          }

          if (opts.json) {
            process.stdout.write(JSON.stringify({ ok: true, session }, null, 2) + '\n');
          } else {
            process.stdout.write(
              `Session committed: ${session.display_id} (${session.session_id})\n`
            );
            if (session.summary) {
              process.stdout.write(`  Summary: ${session.summary}\n`);
            }
            if (session.memories_extracted) {
              process.stdout.write(`  Memories extracted: ${session.memories_extracted}\n`);
            }
          }
        });
      }
    );
}

async function safeRequireOllama() {
  try {
    return await requireOllama();
  } catch {
    return null;
  }
}
