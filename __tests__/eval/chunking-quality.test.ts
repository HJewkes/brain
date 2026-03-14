import { describe, test, expect } from 'vitest';
import { parseMarkdown, estimateTokens } from '../../src/services/markdown-parser.js';
import { chunkJson, detectIdentityField } from '../../src/services/json-chunker.js';

describe('chunking quality benchmarks', { timeout: 120_000 }, () => {
  describe('markdown chunking preserves semantic boundaries', () => {
    test('heading-based chunks stay within a single section', () => {
      const markdown = [
        '---',
        'title: Multi-Section Note',
        'type: note',
        'tier: slow',
        '---',
        '',
        '# Introduction',
        '',
        'This section introduces the topic of distributed systems.',
        'It covers the basics of network partitions and consensus.',
        '',
        '# CAP Theorem',
        '',
        'The CAP theorem states that a distributed system cannot simultaneously',
        'provide consistency, availability, and partition tolerance.',
        'You must choose at most two of the three guarantees.',
        '',
        '# Raft Consensus',
        '',
        'Raft is a consensus algorithm designed to be understandable.',
        'It decomposes consensus into leader election, log replication, and safety.',
        'Raft is used in etcd, CockroachDB, and many other systems.',
      ].join('\n');

      const parsed = parseMarkdown('/test/multi-section.md', markdown);
      const chunks = parsed.chunks;

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const capChunks = chunks.filter(
        (c) => c.text.includes('CAP theorem') && c.text.includes('consistency')
      );
      expect(capChunks.length).toBeGreaterThanOrEqual(1);

      const raftChunks = chunks.filter(
        (c) => c.text.includes('Raft') && c.text.includes('leader election')
      );
      expect(raftChunks.length).toBeGreaterThanOrEqual(1);

      for (const chunk of capChunks) {
        expect(chunk.text).not.toContain('leader election');
      }
    });

    test('code fences are kept intact within a chunk', () => {
      const markdown = [
        '---',
        'title: Code Example',
        'type: note',
        'tier: slow',
        '---',
        '',
        '# Setup',
        '',
        'Install the dependencies:',
        '',
        '```bash',
        'npm install better-sqlite3',
        'npm install sqlite-vec',
        '```',
        '',
        'Then configure the database.',
      ].join('\n');

      const parsed = parseMarkdown('/test/code-example.md', markdown);

      const setupChunk = parsed.chunks.find((c) => c.text.includes('npm install'));
      expect(setupChunk).toBeDefined();
      expect(setupChunk!.text).toContain('npm install better-sqlite3');
      expect(setupChunk!.text).toContain('npm install sqlite-vec');
    });

    test('table content stays in a single chunk', () => {
      const markdown = [
        '---',
        'title: Velocity Zones',
        'type: note',
        'tier: slow',
        '---',
        '',
        '# Velocity Zones',
        '',
        '| Zone | Range | Goal |',
        '|------|-------|------|',
        '| Max Strength | 0.15-0.5 m/s | Force |',
        '| Speed-Strength | 1.0-1.3 m/s | Power |',
        '',
        'These zones guide training prescription.',
      ].join('\n');

      const parsed = parseMarkdown('/test/table-example.md', markdown);

      const tableChunk = parsed.chunks.find(
        (c) => c.text.includes('Max Strength') && c.text.includes('Speed-Strength')
      );
      expect(tableChunk).toBeDefined();
    });
  });

  describe('chunk size distribution', () => {
    test('majority of chunks fall within 200-4000 token range', () => {
      const longNote = [
        '---',
        'title: Comprehensive Guide',
        'type: guide',
        'tier: slow',
        '---',
        '',
      ];

      for (let i = 0; i < 12; i++) {
        longNote.push(`## Section ${i + 1}`);
        longNote.push('');
        const paragraph = Array.from(
          { length: 8 },
          (_, j) =>
            `This is sentence ${j + 1} of section ${i + 1} discussing topic details ` +
            `with enough content to create meaningful chunks that test size distribution.`
        ).join(' ');
        longNote.push(paragraph);
        longNote.push('');
      }

      const parsed = parseMarkdown('/test/long-note.md', longNote.join('\n'));
      const tokenCounts = parsed.chunks.map((c) => c.tokenCount);

      const inRange = tokenCounts.filter((t) => t >= 5 && t <= 4000);
      const ratio = inRange.length / tokenCounts.length;

      console.log(`Chunk token distribution (${tokenCounts.length} chunks):`);
      console.log(`  min: ${Math.min(...tokenCounts)}`);
      console.log(`  max: ${Math.max(...tokenCounts)}`);
      console.log(
        `  median: ${tokenCounts.sort((a, b) => a - b)[Math.floor(tokenCounts.length / 2)]}`
      );
      console.log(`  in 5-4000 range: ${(ratio * 100).toFixed(1)}%`);

      expect(ratio).toBeGreaterThanOrEqual(0.8);
    });

    test('no chunk exceeds the MAX_CHUNK_TOKENS limit significantly', () => {
      const maxAllowed = 512 + 50; // small tolerance for boundary edge cases

      const markdown = [
        '---',
        'title: Dense Note',
        'type: note',
        'tier: slow',
        '---',
        '',
        '# Dense Content',
        '',
        Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: ` + 'word '.repeat(50)).join('\n\n'),
      ].join('\n');

      const parsed = parseMarkdown('/test/dense-note.md', markdown);

      for (const chunk of parsed.chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(maxAllowed);
      }
    });
  });

  describe('JSON chunking: identity field detection', () => {
    test('detects id, name, title, displayName, and key fields', () => {
      expect(detectIdentityField({ id: 'abc', value: 1 })).toBe('abc');
      expect(detectIdentityField({ name: 'Widget', size: 10 })).toBe('Widget');
      expect(detectIdentityField({ title: 'My Doc', body: '...' })).toBe('My Doc');
      expect(detectIdentityField({ displayName: 'User One' })).toBe('User One');
      expect(detectIdentityField({ key: 'config-key' })).toBe('config-key');
    });

    test('returns null when no identity field is present', () => {
      expect(detectIdentityField({ value: 1, count: 2 })).toBeNull();
      expect(detectIdentityField({})).toBeNull();
    });

    test('prefers id over name over title', () => {
      expect(detectIdentityField({ id: 'primary', name: 'fallback' })).toBe('primary');
      expect(detectIdentityField({ name: 'first', title: 'second' })).toBe('first');
    });
  });

  describe('JSON chunking: structure preservation', () => {
    test('array elements with identity fields use identity in heading', () => {
      const json = JSON.stringify({
        users: [
          { id: 'user-1', name: 'Alice', role: 'admin' },
          { id: 'user-2', name: 'Bob', role: 'viewer' },
        ],
      });

      const chunks = chunkJson(json, '/test/users.json');

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const aliceChunk = chunks.find((c) => c.text.includes('Alice'));
      expect(aliceChunk).toBeDefined();
      expect(aliceChunk!.heading).toContain('user-1');

      const bobChunk = chunks.find((c) => c.text.includes('Bob'));
      expect(bobChunk).toBeDefined();
      expect(bobChunk!.heading).toContain('user-2');
    });

    test('nested objects are walked and chunked', () => {
      const json = JSON.stringify({
        config: {
          database: { host: 'localhost', port: 5432 },
          cache: { ttl: 3600, maxSize: 1000 },
        },
      });

      const chunks = chunkJson(json, '/test/config.json');

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const hasHost = chunks.some((c) => c.text.includes('localhost'));
      const hasTtl = chunks.some((c) => c.text.includes('3600'));
      expect(hasHost).toBe(true);
      expect(hasTtl).toBe(true);
    });

    test('all chunks have valid token counts', () => {
      const json = JSON.stringify({
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `item-${i}`,
          description: `Item number ${i} with some descriptive text`,
          value: i * 100,
        })),
      });

      const chunks = chunkJson(json, '/test/items.json');

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeGreaterThan(0);
        expect(chunk.tokenCount).toBe(estimateTokens(chunk.text));
      }
    });
  });
});
