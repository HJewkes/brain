import { describe, it, expect } from 'vitest';
import { chunkJson, detectIdentityField, buildKeyPath } from '../../src/services/json-chunker.js';

describe('buildKeyPath', () => {
  it('returns key when path is empty', () => {
    expect(buildKeyPath('', 'host')).toBe('host');
  });

  it('joins path and key with dot', () => {
    expect(buildKeyPath('config.database', 'host')).toBe('config.database.host');
  });
});

describe('detectIdentityField', () => {
  it('returns id when present', () => {
    expect(detectIdentityField({ id: 'abc', name: 'Thing' })).toBe('abc');
  });

  it('returns name when id is absent', () => {
    expect(detectIdentityField({ name: 'Widget', title: 'My Widget' })).toBe('Widget');
  });

  it('returns title when id and name are absent', () => {
    expect(detectIdentityField({ title: 'Report', other: 'val' })).toBe('Report');
  });

  it('returns displayName after title', () => {
    expect(detectIdentityField({ displayName: 'Admin Panel' })).toBe('Admin Panel');
  });

  it('returns key as last resort', () => {
    expect(detectIdentityField({ key: 'main-key' })).toBe('main-key');
  });

  it('returns null when no identity fields present', () => {
    expect(detectIdentityField({ value: 42, data: 'stuff' })).toBeNull();
  });

  it('handles numeric id values', () => {
    expect(detectIdentityField({ id: 123 })).toBe('123');
  });

  it('skips empty string id', () => {
    expect(detectIdentityField({ id: '', name: 'Fallback' })).toBe('Fallback');
  });
});

describe('chunkJson', () => {
  it('returns empty for non-JSON content', () => {
    expect(chunkJson('not json at all', 'file.json')).toEqual([]);
  });

  it('returns empty for null JSON', () => {
    expect(chunkJson('null', 'file.json')).toEqual([]);
  });

  it('chunks a simple flat object with key-path titles', () => {
    const json = JSON.stringify({ host: 'localhost', port: 3000 });
    const chunks = chunkJson(json, 'config.json');

    expect(chunks.length).toBe(2);
    expect(chunks[0].heading).toBe('host');
    expect(chunks[0].text).toContain('localhost');
    expect(chunks[1].heading).toBe('port');
    expect(chunks[1].text).toContain('3000');
  });

  it('chunks nested objects with dot-notation key paths', () => {
    const json = JSON.stringify({
      config: {
        database: {
          host: 'localhost',
          port: 5432,
        },
      },
    });
    const chunks = chunkJson(json, 'app.json');

    const headings = chunks.map((c) => c.heading);
    expect(headings).toContain('config.database.host');
    expect(headings).toContain('config.database.port');
  });

  it('chunks arrays with identity field detection', () => {
    const json = JSON.stringify({
      users: [
        { id: 'u1', name: 'Alice', role: 'admin' },
        { id: 'u2', name: 'Bob', role: 'user' },
      ],
    });
    const chunks = chunkJson(json, 'data.json');

    expect(chunks.length).toBe(2);
    expect(chunks[0].heading).toBe('users > u1');
    expect(chunks[1].heading).toBe('users > u2');
  });

  it('falls back to index for array elements without identity fields', () => {
    const json = JSON.stringify({
      items: [
        { value: 10, data: 'x' },
        { value: 20, data: 'y' },
      ],
    });
    const chunks = chunkJson(json, 'data.json');

    expect(chunks[0].heading).toBe('items[0]');
    expect(chunks[1].heading).toBe('items[1]');
  });

  it('respects 4KB chunk size cap', () => {
    const largeValue = 'x'.repeat(5000);
    const json = JSON.stringify({ big: { nested: { data: largeValue } } });
    const chunks = chunkJson(json, 'big.json');

    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096);
    }
  });

  it('assigns sequential positions', () => {
    const json = JSON.stringify({ a: 1, b: 2, c: 3 });
    const chunks = chunkJson(json, 'file.json');

    expect(chunks.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it('uses section chunk type and semantic_split cut type', () => {
    const json = JSON.stringify({ key: 'value' });
    const chunks = chunkJson(json, 'file.json');

    expect(chunks[0].chunkType).toBe('section');
    expect(chunks[0].cutType).toBe('semantic_split');
    expect(chunks[0].contentType).toBe('code');
  });

  it('identity field priority: id > name > title', () => {
    const json = JSON.stringify({
      items: [{ title: 'T', name: 'N', id: 'I' }],
    });
    const chunks = chunkJson(json, 'file.json');
    expect(chunks[0].heading).toBe('items > I');

    const json2 = JSON.stringify({
      items: [{ title: 'T', name: 'N' }],
    });
    const chunks2 = chunkJson(json2, 'file.json');
    expect(chunks2[0].heading).toBe('items > N');

    const json3 = JSON.stringify({
      items: [{ title: 'T' }],
    });
    const chunks3 = chunkJson(json3, 'file.json');
    expect(chunks3[0].heading).toBe('items > T');
  });

  it('handles top-level arrays', () => {
    const json = JSON.stringify([
      { name: 'First', value: 1 },
      { name: 'Second', value: 2 },
    ]);
    const chunks = chunkJson(json, 'list.json');

    expect(chunks[0].heading).toBe(' > First');
    expect(chunks[1].heading).toBe(' > Second');
  });

  it('handles deeply nested structures', () => {
    const json = JSON.stringify({
      level1: {
        level2: {
          level3: {
            value: 'deep',
          },
        },
      },
    });
    const chunks = chunkJson(json, 'deep.json');

    expect(chunks[0].heading).toBe('level1.level2.level3.value');
  });

  it('sets headingAncestry equal to heading', () => {
    const json = JSON.stringify({ key: 'value' });
    const chunks = chunkJson(json, 'file.json');

    expect(chunks[0].headingAncestry).toBe(chunks[0].heading);
  });
});
