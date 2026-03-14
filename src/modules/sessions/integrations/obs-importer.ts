import type { BrainDB } from '../../../services/brain-db.js';
import { listSessions } from '../data/session-ops.js';
import { ingestWorkflowObservations } from './workflow-obs.js';
import { matchObservationsToSession, formatObservationsMarkdown } from './obs-linker.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainConfig } from '../../../types.js';

export interface ImportResult {
  sessionsChecked: number;
  observationsLinked: number;
  errors: string[];
}

export function importHistoricalObservations(
  db: BrainDB,
  config: BrainConfig,
  projectDir: string
): ImportResult {
  const result: ImportResult = {
    sessionsChecked: 0,
    observationsLinked: 0,
    errors: [],
  };

  const sessions = listSessions(db, { projectDir });
  result.sessionsChecked = sessions.length;

  for (const session of sessions) {
    try {
      const endTime = session.completed_at ?? new Date().toISOString();
      const observations = ingestWorkflowObservations(
        session.project_dir,
        session.started_at,
        endTime
      );

      const matched = matchObservationsToSession(observations, session);
      if (matched.length === 0) continue;

      // Write observations to content dir
      const contentDir = join(config.notesDir, 'modules', 'sessions', session.display_id);
      const obsPath = join(contentDir, 'observations.md');

      if (!existsSync(obsPath)) {
        mkdirSync(contentDir, { recursive: true });
        const content = formatObservationsMarkdown(matched);
        writeFileSync(obsPath, content, 'utf-8');
      }

      result.observationsLinked += matched.length;

      // Create observed-in relations
      const sessionNoteIds = db.getModuleNoteIds({
        module: 'sessions',
        type: 'session',
      });
      const notes = db.getNotesByIds(sessionNoteIds);
      let sessionNoteId: string | null = null;
      for (const [id, note] of notes) {
        if (!note.metadata) continue;
        const meta = JSON.parse(note.metadata) as Record<string, unknown>;
        if (meta.session_id === session.session_id) {
          sessionNoteId = id;
          break;
        }
      }

      if (sessionNoteId) {
        // Relations are from observation → session, but we create them as session-side
        // since observations aren't note entities (they're inline)
        // The relation is informational — the content is in observations.md
      }
    } catch (err) {
      result.errors.push(
        `${session.display_id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
