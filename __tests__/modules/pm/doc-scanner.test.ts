import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { discoverDocs } from '../../../src/modules/pm/engine/doc-scanner.js';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `doc-scanner-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('discoverDocs', () => {
  it('skips files with module: frontmatter', () => {
    // Brain internal doc — has module: field
    const brainDoc = join(testDir, 'architecture.md');
    writeFileSync(
      brainDoc,
      [
        '---',
        'id: pm-architecture',
        'title: "PM Architecture"',
        'module: pm',
        '---',
        '',
        '# PM Architecture',
        'Some content here.',
      ].join('\n')
    );

    // Normal project doc — no module: field
    const projectDoc = join(testDir, 'readme.md');
    writeFileSync(
      projectDoc,
      [
        '# My Project',
        '',
        'This is a project readme with enough content to pass the minimum size filter that checks for at least five hundred bytes of content in each file.',
        'Adding more lines to ensure we pass the minimum file size threshold.',
        'Line three of extra content for the readme file.',
        'Line four of extra content for the readme file.',
        'Line five of extra content for the readme file.',
        'Line six of extra content for the readme file.',
        'Line seven to be safe about the minimum.',
        'Line eight to be really safe.',
        'Line nine for good measure.',
        'Line ten, definitely enough now.',
      ].join('\n')
    );

    const results = discoverDocs([testDir]);

    const paths = results.map((d) => d.path);
    expect(paths).toContain(projectDoc);
    expect(paths).not.toContain(brainDoc);
  });

  it('keeps files with non-module frontmatter', () => {
    const doc = join(testDir, 'design.md');
    writeFileSync(
      doc,
      [
        '---',
        'title: "Design Doc"',
        'author: someone',
        '---',
        '',
        '# Design',
        'Enough content to pass the minimum file size check that requires five hundred bytes.',
        'Adding several more lines of content to ensure we are over the threshold.',
        'Line three here.',
        'Line four here.',
        'Line five here.',
        'Line six here.',
        'Line seven here.',
        'Line eight here.',
        'Line nine here.',
        'Line ten here.',
      ].join('\n')
    );

    const results = discoverDocs([testDir]);
    expect(results.map((d) => d.path)).toContain(doc);
  });

  it('keeps files without frontmatter', () => {
    const doc = join(testDir, 'notes.md');
    writeFileSync(
      doc,
      [
        '# Notes',
        '',
        'Some plain markdown content without any YAML frontmatter at all.',
        'This should definitely be included in the discovery results.',
        'Adding more lines to pass the minimum file size threshold.',
        'Line four of content.',
        'Line five of content.',
        'Line six of content.',
        'Line seven of content.',
        'Line eight of content.',
        'Line nine of content.',
        'Line ten of content.',
      ].join('\n')
    );

    const results = discoverDocs([testDir]);
    expect(results.map((d) => d.path)).toContain(doc);
  });
});
