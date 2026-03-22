import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seekJsonlFile } from '../../src/utils/jsonl-seek.js';

const event1 = { uuid: 'aaa', type: 'user', timestamp: '2026-01-01T00:00:00Z' };
const event2 = { uuid: 'bbb', type: 'assistant', timestamp: '2026-01-01T00:01:00Z' };
const event3 = { uuid: 'ccc', type: 'system', timestamp: '2026-01-01T00:02:00Z' };

function makeJsonl(...events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

describe('seekJsonlFile', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jsonl-seek-'));
    filePath = join(tmpDir, 'session.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns NOT_FOUND for missing file', () => {
    const result = seekJsonlFile(join(tmpDir, 'nonexistent.jsonl'), 0, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.value.code).toBe('NOT_FOUND');
  });

  it('reads the first event at offset 0', () => {
    writeFileSync(filePath, makeJsonl(event1, event2, event3));
    const result = seekJsonlFile(filePath, 0, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]).toMatchObject({ uuid: 'aaa' });
      expect(result.value.nextOffset).toBeGreaterThan(0);
    }
  });

  it('reads multiple events when lines > 1', () => {
    writeFileSync(filePath, makeJsonl(event1, event2, event3));
    const result = seekJsonlFile(filePath, 0, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(3);
      expect(result.value.events[2]).toMatchObject({ uuid: 'ccc' });
    }
  });

  it('seeks to a mid-file offset and reads the correct event', () => {
    const line1 = JSON.stringify(event1) + '\n';
    const line2 = JSON.stringify(event2) + '\n';
    writeFileSync(filePath, line1 + line2 + JSON.stringify(event3) + '\n');
    const midOffset = Buffer.byteLength(line1, 'utf-8');

    const result = seekJsonlFile(filePath, midOffset, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]).toMatchObject({ uuid: 'bbb' });
    }
  });

  it('returns OFFSET_OUT_OF_RANGE when offset is past end of file', () => {
    writeFileSync(filePath, makeJsonl(event1));
    const stat = Buffer.byteLength(makeJsonl(event1), 'utf-8');
    const result = seekJsonlFile(filePath, stat + 100, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.value.code).toBe('OFFSET_OUT_OF_RANGE');
  });

  it('caps lines at 50 regardless of requested count', () => {
    const manyEvents = Array.from({ length: 60 }, (_, i) => ({ uuid: `e${i}`, type: 'user' }));
    writeFileSync(filePath, makeJsonl(...manyEvents));
    const result = seekJsonlFile(filePath, 0, 100);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events.length).toBeLessThanOrEqual(50);
    }
  });

  it('nextOffset advances correctly for chained reads', () => {
    writeFileSync(filePath, makeJsonl(event1, event2, event3));
    const first = seekJsonlFile(filePath, 0, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = seekJsonlFile(filePath, first.value.nextOffset, 1);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.events[0]).toMatchObject({ uuid: 'bbb' });
    }
  });
});
