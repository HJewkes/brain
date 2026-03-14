import Database from 'better-sqlite3';
import { extractTerms, scoreTerm, type VocabEntry } from '../vocabulary.js';

const VOCAB_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS vocabulary (
    term           TEXT PRIMARY KEY,
    doc_frequency  INTEGER NOT NULL DEFAULT 1,
    score          REAL NOT NULL DEFAULT 0
  )
`;

export class VocabularyRepo {
  private initialized = false;

  constructor(private db: Database.Database) {}

  private ensureTable(): void {
    if (this.initialized) return;
    this.db.exec(VOCAB_TABLE_DDL);
    this.initialized = true;
  }

  /**
   * Update vocabulary for a single note's content.
   * Increments doc_frequency for each term found in the text.
   */
  updateForNote(title: string, content: string, totalDocs: number): void {
    this.ensureTable();
    const terms = extractTerms(`${title} ${content}`);

    const upsert = this.db.prepare(
      `INSERT INTO vocabulary (term, doc_frequency, score)
       VALUES (?, 1, ?)
       ON CONFLICT(term) DO UPDATE SET
         doc_frequency = doc_frequency + 1,
         score = ?`
    );

    const txn = this.db.transaction(() => {
      for (const term of terms) {
        const score = scoreTerm(term, 1, totalDocs);
        upsert.run(term, score, score);
      }
    });
    txn();
  }

  /**
   * Rebuild all vocabulary scores based on current doc frequencies.
   */
  rebuildScores(totalDocs: number): void {
    this.ensureTable();

    const rows = this.db.prepare('SELECT term, doc_frequency FROM vocabulary').all() as Array<{
      term: string;
      doc_frequency: number;
    }>;

    const update = this.db.prepare('UPDATE vocabulary SET score = ? WHERE term = ?');

    const txn = this.db.transaction(() => {
      for (const row of rows) {
        const score = scoreTerm(row.term, row.doc_frequency, totalDocs);
        update.run(score, row.term);
      }
    });
    txn();
  }

  /**
   * Get all vocabulary entries for fuzzy matching.
   * Results are ordered by score descending for efficient matching.
   */
  getVocabulary(): VocabEntry[] {
    this.ensureTable();

    return this.db
      .prepare(
        'SELECT term, doc_frequency as docFrequency, score FROM vocabulary ORDER BY score DESC'
      )
      .all() as VocabEntry[];
  }

  /**
   * Clear all vocabulary data (for full reindex).
   */
  clear(): void {
    this.ensureTable();
    this.db.exec('DELETE FROM vocabulary');
  }

  /**
   * Get vocabulary count.
   */
  count(): number {
    this.ensureTable();
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM vocabulary').get() as { cnt: number };
    return row.cnt;
  }
}
