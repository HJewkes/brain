import Database from 'better-sqlite3';
import type { InboxItem, InboxSource, InboxStatus, FeedRecord } from '../../types.js';

// --- Row Types (snake_case from SQLite) ---

interface InboxRow {
  id: string;
  content: string;
  title: string | null;
  source: string;
  source_url: string | null;
  source_meta: string | null;
  status: string;
  created_at: string;
  processed_at: string | null;
}

interface FeedRow {
  id: string;
  url: string;
  name: string;
  container_tag: string;
  filter_prompt: string | null;
  last_polled: string | null;
  created_at: string;
}

// --- Row Mappers ---

function rowToInboxItem(row: InboxRow): InboxItem {
  return {
    id: row.id,
    content: row.content,
    title: row.title,
    source: row.source as InboxSource,
    sourceUrl: row.source_url,
    sourceMeta: row.source_meta,
    status: row.status as InboxStatus,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

function rowToFeedRecord(row: FeedRow): FeedRecord {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    containerTag: row.container_tag,
    filterPrompt: row.filter_prompt,
    lastPolled: row.last_polled,
    createdAt: row.created_at,
  };
}

export class CaptureRepo {
  constructor(private db: Database.Database) {}

  // --- Inbox ---

  addInboxItem(item: InboxItem): void {
    this.db
      .prepare(
        `INSERT INTO inbox (id, content, title, source, source_url, source_meta, status, created_at, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.content,
        item.title,
        item.source,
        item.sourceUrl,
        item.sourceMeta,
        item.status,
        item.createdAt,
        item.processedAt
      );
  }

  getInboxItems(status?: InboxStatus): InboxItem[] {
    if (status) {
      const rows = this.db
        .prepare('SELECT * FROM inbox WHERE status = ? ORDER BY created_at DESC')
        .all(status) as InboxRow[];
      return rows.map(rowToInboxItem);
    }
    const rows = this.db
      .prepare('SELECT * FROM inbox ORDER BY created_at DESC')
      .all() as InboxRow[];
    return rows.map(rowToInboxItem);
  }

  getInboxItem(id: string): InboxItem | null {
    const row = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as
      | InboxRow
      | undefined;
    return row ? rowToInboxItem(row) : null;
  }

  updateInboxStatus(id: string, status: InboxStatus): void {
    const processedAt = status === 'indexed' || status === 'failed' ? new Date().toISOString() : null;
    this.db
      .prepare('UPDATE inbox SET status = ?, processed_at = COALESCE(?, processed_at) WHERE id = ?')
      .run(status, processedAt, id);
  }

  deleteInboxItem(id: string): void {
    this.db.prepare('DELETE FROM inbox WHERE id = ?').run(id);
  }

  // --- Feeds ---

  addFeed(feed: FeedRecord): void {
    this.db
      .prepare(
        `INSERT INTO feeds (id, url, name, container_tag, filter_prompt, last_polled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        feed.id,
        feed.url,
        feed.name,
        feed.containerTag,
        feed.filterPrompt,
        feed.lastPolled,
        feed.createdAt
      );
  }

  getFeeds(): FeedRecord[] {
    const rows = this.db.prepare('SELECT * FROM feeds ORDER BY name').all() as FeedRow[];
    return rows.map(rowToFeedRecord);
  }

  getFeedById(id: string): FeedRecord | null {
    const row = this.db.prepare('SELECT * FROM feeds WHERE id = ?').get(id) as
      | FeedRow
      | undefined;
    return row ? rowToFeedRecord(row) : null;
  }

  removeFeed(id: string): void {
    this.db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
  }

  updateFeedLastPolled(id: string, lastPolled: string): void {
    this.db.prepare('UPDATE feeds SET last_polled = ? WHERE id = ?').run(lastPolled, id);
  }
}
