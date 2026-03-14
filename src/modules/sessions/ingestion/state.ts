import type { BrainDB } from '../../../services/brain-db.js';

export interface IngestionRecord {
  sessionId: string;
  displayId: string;
  ingestedAt: string;
  filePath: string;
  fileHash: string;
  l2Indexed: boolean;
}

interface IngestionStateData {
  records: Record<string, IngestionRecord>;
}

const STATE_KEY = 'session_ingestion_state';

export class IngestionState {
  private data: IngestionStateData;
  private db: BrainDB;

  constructor(db: BrainDB) {
    this.db = db;
    this.data = this.load();
  }

  private load(): IngestionStateData {
    const raw = this.db.getMetaValue(STATE_KEY);
    if (!raw) return { records: {} };
    try {
      return JSON.parse(raw) as IngestionStateData;
    } catch {
      return { records: {} };
    }
  }

  private save(): void {
    this.db.setMetaValue(STATE_KEY, JSON.stringify(this.data));
  }

  getRecord(sessionId: string): IngestionRecord | null {
    return this.data.records[sessionId] ?? null;
  }

  upsertRecord(record: IngestionRecord): void {
    this.data.records[record.sessionId] = record;
    this.save();
  }

  getAllRecords(): IngestionRecord[] {
    return Object.values(this.data.records);
  }

  hasSession(sessionId: string): boolean {
    return sessionId in this.data.records;
  }
}
