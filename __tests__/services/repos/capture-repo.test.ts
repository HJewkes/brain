import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { unlinkSync } from 'node:fs';
import type { InboxItem, FeedRecord } from '../../../src/types.js';
import { tmpDbPath } from '../../helpers.js';

describe('CaptureRepo', () => {
  let db: BrainDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  describe('inbox CRUD', () => {
    const makeItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
      id: 'test-inbox-1',
      content: 'Some captured thought',
      title: null,
      source: 'cli',
      sourceUrl: null,
      sourceMeta: null,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00Z',
      processedAt: null,
      ...overrides,
    });

    it('adds and retrieves inbox items', () => {
      db.addInboxItem(makeItem());
      const items = db.getInboxItems();
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Some captured thought');
      expect(items[0].status).toBe('pending');
    });

    it('filters by status', () => {
      db.addInboxItem(makeItem({ id: 'a', status: 'pending' }));
      db.addInboxItem(makeItem({ id: 'b', status: 'indexed' }));
      expect(db.getInboxItems('pending')).toHaveLength(1);
      expect(db.getInboxItems('indexed')).toHaveLength(1);
    });

    it('gets single item by id', () => {
      db.addInboxItem(makeItem());
      expect(db.getInboxItem('test-inbox-1')).not.toBeNull();
      expect(db.getInboxItem('nonexistent')).toBeNull();
    });

    it('updates status with processed_at for terminal states', () => {
      db.addInboxItem(makeItem());
      db.updateInboxStatus('test-inbox-1', 'indexed');
      const item = db.getInboxItem('test-inbox-1')!;
      expect(item.status).toBe('indexed');
      expect(item.processedAt).not.toBeNull();
    });

    it('deletes inbox items', () => {
      db.addInboxItem(makeItem());
      db.deleteInboxItem('test-inbox-1');
      expect(db.getInboxItem('test-inbox-1')).toBeNull();
    });
  });

  describe('feed CRUD', () => {
    const makeFeed = (overrides: Partial<FeedRecord> = {}): FeedRecord => ({
      id: 'feed-1',
      url: 'https://example.com/feed.xml',
      name: 'Example Feed',
      containerTag: 'default',
      filterPrompt: null,
      lastPolled: null,
      createdAt: '2026-01-01T00:00:00Z',
      ...overrides,
    });

    it('adds and lists feeds', () => {
      db.addFeed(makeFeed());
      const feeds = db.getFeeds();
      expect(feeds).toHaveLength(1);
      expect(feeds[0].name).toBe('Example Feed');
    });

    it('gets feed by id', () => {
      db.addFeed(makeFeed());
      expect(db.getFeedById('feed-1')).not.toBeNull();
      expect(db.getFeedById('nonexistent')).toBeNull();
    });

    it('enforces unique URLs', () => {
      db.addFeed(makeFeed());
      expect(() => db.addFeed(makeFeed({ id: 'feed-2' }))).toThrow();
    });

    it('removes feeds', () => {
      db.addFeed(makeFeed());
      db.removeFeed('feed-1');
      expect(db.getFeeds()).toHaveLength(0);
    });

    it('updates last polled timestamp', () => {
      db.addFeed(makeFeed());
      db.updateFeedLastPolled('feed-1', '2026-02-01T00:00:00Z');
      const feed = db.getFeedById('feed-1')!;
      expect(feed.lastPolled).toBe('2026-02-01T00:00:00Z');
    });
  });
});
