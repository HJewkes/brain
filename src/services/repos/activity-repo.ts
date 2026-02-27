import Database from 'better-sqlite3';
import type { ActivityRecord } from '../../types.js';

interface ActivityRow {
  id: string;
  note_ids: string | null;
  module: string | null;
  module_instance: string | null;
  activity_type: string | null;
  actor_type: string | null;
  actor_id: string | null;
  session_id: string | null;
  metadata: string | null;
  outcome: string | null;
  started_at: string | null;
  completed_at: string | null;
}

function rowToActivityRecord(row: ActivityRow): ActivityRecord {
  return {
    id: row.id,
    noteIds: row.note_ids,
    module: row.module,
    moduleInstance: row.module_instance,
    activityType: row.activity_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    sessionId: row.session_id,
    metadata: row.metadata,
    outcome: row.outcome,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export class ActivityRepo {
  constructor(private db: Database.Database) {}

  addActivity(record: ActivityRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO activities
          (id, note_ids, module, module_instance, activity_type, actor_type, actor_id, session_id, metadata, outcome, started_at, completed_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.noteIds,
        record.module,
        record.moduleInstance,
        record.activityType,
        record.actorType,
        record.actorId,
        record.sessionId,
        record.metadata,
        record.outcome,
        record.startedAt,
        record.completedAt
      );
  }

  getActivity(id: string): ActivityRecord | null {
    const row = this.db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as
      | ActivityRow
      | undefined;
    return row ? rowToActivityRecord(row) : null;
  }

  getActivities(opts?: {
    module?: string;
    moduleInstance?: string;
    activityType?: string;
  }): ActivityRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.module) {
      conditions.push('module = ?');
      params.push(opts.module);
    }
    if (opts?.moduleInstance) {
      conditions.push('module_instance = ?');
      params.push(opts.moduleInstance);
    }
    if (opts?.activityType) {
      conditions.push('activity_type = ?');
      params.push(opts.activityType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM activities ${where}`)
      .all(...params) as ActivityRow[];
    return rows.map(rowToActivityRecord);
  }

  getActivitiesByNoteId(noteId: string): ActivityRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM activities WHERE note_ids LIKE '%' || ? || '%'`)
      .all(noteId) as ActivityRow[];
    return rows.map(rowToActivityRecord).filter((a) => {
      if (!a.noteIds) return false;
      try {
        const ids = JSON.parse(a.noteIds) as string[];
        return ids.includes(noteId);
      } catch {
        return false;
      }
    });
  }

  getActivitiesBySession(sessionId: string): ActivityRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM activities WHERE session_id = ?')
      .all(sessionId) as ActivityRow[];
    return rows.map(rowToActivityRecord);
  }
}
