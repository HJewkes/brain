import { describe, it, expect } from 'vitest';
import {
  extractStructuralEvents,
  hashEvent,
  EventBuffer,
  type StructuralEvent,
} from '../../../src/modules/sessions/structural-events.js';

const SESSION_ID = 'test-session-001';
const TIMESTAMP = '2026-03-13T10:00:00Z';

function makeEvent(overrides: Partial<StructuralEvent> = {}): StructuralEvent {
  const eventType = overrides.eventType ?? 'file_touch';
  const detail = overrides.detail ?? 'read: /src/foo.ts';
  return {
    id: overrides.id ?? hashEvent(eventType, detail),
    sessionId: overrides.sessionId ?? SESSION_ID,
    eventType,
    detail,
    filePath: overrides.filePath,
    timestamp: overrides.timestamp ?? TIMESTAMP,
  };
}

describe('hashEvent', () => {
  it('produces a SHA256 hex string', () => {
    const hash = hashEvent('file_touch', 'read: /src/foo.ts');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the same hash for identical inputs', () => {
    const a = hashEvent('file_touch', 'read: /src/foo.ts');
    const b = hashEvent('file_touch', 'read: /src/foo.ts');
    expect(a).toBe(b);
  });

  it('returns different hashes for different inputs', () => {
    const a = hashEvent('file_touch', 'read: /src/foo.ts');
    const b = hashEvent('error', 'read: /src/foo.ts');
    expect(a).not.toBe(b);
  });
});

describe('extractStructuralEvents', () => {
  it('extracts file_touch from Read tool', () => {
    const events = extractStructuralEvents(
      'Read',
      { file_path: '/src/types.ts' },
      'file contents...',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('file_touch');
    expect(events[0].filePath).toBe('/src/types.ts');
    expect(events[0].detail).toContain('/src/types.ts');
  });

  it('extracts file_touch from Write tool', () => {
    const events = extractStructuralEvents(
      'Write',
      { file_path: '/src/new-file.ts' },
      'ok',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('file_touch');
    expect(events[0].filePath).toBe('/src/new-file.ts');
  });

  it('extracts edit event from Edit tool', () => {
    const events = extractStructuralEvents(
      'Edit',
      { file_path: '/src/index.ts' },
      'ok',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('edit');
    expect(events[0].filePath).toBe('/src/index.ts');
  });

  it('extracts git_op from bash git commands', () => {
    const events = extractStructuralEvents(
      'Bash',
      { command: 'git commit -m "fix bug"' },
      'committed',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('git_op');
    expect(events[0].detail).toContain('git commit');
  });

  it('extracts error from bash output with error indicators', () => {
    const events = extractStructuralEvents(
      'Bash',
      { command: 'npm test' },
      'Error: module not found\nsome other output',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('error');
    expect(events[0].detail).toContain('npm test');
    expect(events[0].detail).toContain('Error: module not found');
  });

  it('extracts both git_op and error when bash git command fails', () => {
    const events = extractStructuralEvents(
      'Bash',
      { command: 'git push origin main' },
      'fatal: remote origin already exists',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(2);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('git_op');
    expect(types).toContain('error');
  });

  it('extracts search event from Grep tool', () => {
    const events = extractStructuralEvents(
      'Grep',
      { pattern: 'function\\s+main' },
      'found matches',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('search');
    expect(events[0].detail).toContain('function\\s+main');
  });

  it('extracts search event from Glob tool', () => {
    const events = extractStructuralEvents(
      'Glob',
      { glob: '**/*.ts' },
      'files found',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('search');
    expect(events[0].detail).toContain('**/*.ts');
  });

  it('returns empty array for unrecognized tools', () => {
    const events = extractStructuralEvents(
      'UnknownTool',
      { foo: 'bar' },
      'output',
      SESSION_ID,
      TIMESTAMP
    );
    expect(events).toHaveLength(0);
  });

  it('returns empty array when file path is missing', () => {
    const events = extractStructuralEvents('Read', {}, 'output', SESSION_ID, TIMESTAMP);
    expect(events).toHaveLength(0);
  });

  it('sets sessionId and timestamp on extracted events', () => {
    const events = extractStructuralEvents(
      'Read',
      { file_path: '/src/x.ts' },
      'ok',
      'my-session',
      '2026-01-01T00:00:00Z'
    );
    expect(events[0].sessionId).toBe('my-session');
    expect(events[0].timestamp).toBe('2026-01-01T00:00:00Z');
  });
});

describe('EventBuffer', () => {
  it('adds events and retrieves them', () => {
    const buf = new EventBuffer();
    const e = makeEvent();
    const added = buf.add(e);
    expect(added).toBe(true);
    expect(buf.getEvents()).toEqual([e]);
  });

  it('deduplicates by hash — same event twice is stored once', () => {
    const buf = new EventBuffer();
    const e = makeEvent();
    buf.add(e);
    const added = buf.add(e);
    expect(added).toBe(false);
    expect(buf.size).toBe(1);
  });

  it('allows events with different hashes', () => {
    const buf = new EventBuffer();
    buf.add(makeEvent({ detail: 'read: /a.ts', id: hashEvent('file_touch', 'read: /a.ts') }));
    buf.add(makeEvent({ detail: 'read: /b.ts', id: hashEvent('file_touch', 'read: /b.ts') }));
    expect(buf.size).toBe(2);
  });

  it('FIFO evicts oldest when at capacity', () => {
    const buf = new EventBuffer(3);
    const events = [1, 2, 3, 4].map((i) =>
      makeEvent({ detail: `file ${i}`, id: hashEvent('file_touch', `file ${i}`) })
    );
    for (const e of events) buf.add(e);

    expect(buf.size).toBe(3);
    const stored = buf.getEvents();
    expect(stored.map((e) => e.detail)).toEqual(['file 2', 'file 3', 'file 4']);
  });

  it('filters by sessionId', () => {
    const buf = new EventBuffer();
    buf.add(makeEvent({ sessionId: 'a', detail: 'a1', id: hashEvent('file_touch', 'a1') }));
    buf.add(makeEvent({ sessionId: 'b', detail: 'b1', id: hashEvent('file_touch', 'b1') }));
    buf.add(makeEvent({ sessionId: 'a', detail: 'a2', id: hashEvent('file_touch', 'a2') }));

    const aEvents = buf.getEvents('a');
    expect(aEvents).toHaveLength(2);
    expect(aEvents.every((e) => e.sessionId === 'a')).toBe(true);
  });

  it('clears all events when no sessionId provided', () => {
    const buf = new EventBuffer();
    buf.add(makeEvent({ detail: 'x', id: hashEvent('file_touch', 'x') }));
    buf.add(makeEvent({ detail: 'y', id: hashEvent('file_touch', 'y') }));
    buf.clear();
    expect(buf.size).toBe(0);
  });

  it('clears only events for the given sessionId', () => {
    const buf = new EventBuffer();
    buf.add(makeEvent({ sessionId: 'a', detail: 'a1', id: hashEvent('file_touch', 'a1') }));
    buf.add(makeEvent({ sessionId: 'b', detail: 'b1', id: hashEvent('file_touch', 'b1') }));

    buf.clear('a');
    expect(buf.size).toBe(1);
    expect(buf.getEvents()[0].sessionId).toBe('b');
  });

  it('uses default capacity of 100', () => {
    const buf = new EventBuffer();
    for (let i = 0; i < 110; i++) {
      buf.add(makeEvent({ detail: `e${i}`, id: hashEvent('file_touch', `e${i}`) }));
    }
    expect(buf.size).toBe(100);
  });
});
