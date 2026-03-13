import { describe, it, expect } from 'vitest';
import { renderSessionContext } from '../../../src/modules/sessions/engine/render.js';
import type { SessionContextBundle } from '../../../src/modules/sessions/engine/context-bundle.js';
import type { SessionMetadata } from '../../../src/modules/sessions/types.js';

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    display_id: 'SNS-001',
    project_dir: '/projects/brain',
    status: 'completed',
    started_at: '2026-03-13T09:00:00.000Z',
    summary: 'Implemented hybrid search with BM25 and vector fusion.',
    branch: 'feat/hybrid-search',
    duration_minutes: 90,
    ...overrides,
  };
}

function makeBundle(overrides: Partial<SessionContextBundle> = {}): SessionContextBundle {
  return {
    session: makeSession(),
    overview: '## Overview\nThis session focused on search improvements.',
    openItems: ['Write regression tests', 'Update docs'],
    activeFiles: ['src/services/search.ts', 'src/services/indexing.ts'],
    taskStatus: [{ taskId: 'VNM-01.02', status: 'in-progress' }],
    gitState: { branch: 'feat/hybrid-search', uncommittedFiles: [] },
    microSummaries: [],
    truncated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Markdown format
// ---------------------------------------------------------------------------

describe('renderSessionContext — markdown', () => {
  it('includes a session header with the display_id', () => {
    const output = renderSessionContext(makeBundle(), 'markdown');

    expect(output).toContain('# Session SNS-001');
  });

  it('renders the summary as a blockquote', () => {
    const output = renderSessionContext(makeBundle(), 'markdown');

    expect(output).toContain('> Implemented hybrid search with BM25 and vector fusion.');
  });

  it('includes a Task Status section with task entries', () => {
    const output = renderSessionContext(makeBundle(), 'markdown');

    expect(output).toContain('## Task Status');
    expect(output).toContain('VNM-01.02: in-progress');
  });

  it('omits Task Status section when there are no tasks', () => {
    const output = renderSessionContext(makeBundle({ taskStatus: [] }), 'markdown');

    expect(output).not.toContain('## Task Status');
  });

  it('renders open items as unchecked checkboxes', () => {
    const output = renderSessionContext(makeBundle(), 'markdown');

    expect(output).toContain('## Open Items');
    expect(output).toContain('- [ ] Write regression tests');
    expect(output).toContain('- [ ] Update docs');
  });

  it('omits Open Items section when the list is empty', () => {
    const output = renderSessionContext(makeBundle({ openItems: [] }), 'markdown');

    expect(output).not.toContain('## Open Items');
  });

  it('includes an Active Files section', () => {
    const output = renderSessionContext(makeBundle(), 'markdown');

    expect(output).toContain('## Active Files');
    expect(output).toContain('- src/services/search.ts');
    expect(output).toContain('- src/services/indexing.ts');
  });

  it('omits Active Files section when the list is empty', () => {
    const output = renderSessionContext(makeBundle({ activeFiles: [] }), 'markdown');

    expect(output).not.toContain('## Active Files');
  });

  it('includes a truncation notice when truncated is true', () => {
    const output = renderSessionContext(makeBundle({ truncated: true }), 'markdown');

    expect(output).toContain('Context truncated to fit token budget');
  });

  it('omits the truncation notice when truncated is false', () => {
    const output = renderSessionContext(makeBundle({ truncated: false }), 'markdown');

    expect(output).not.toContain('truncated');
  });
});

// ---------------------------------------------------------------------------
// JSON format
// ---------------------------------------------------------------------------

describe('renderSessionContext — json', () => {
  it('returns valid JSON', () => {
    const output = renderSessionContext(makeBundle(), 'json');

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('serialises the full bundle', () => {
    const bundle = makeBundle();
    const parsed = JSON.parse(renderSessionContext(bundle, 'json')) as SessionContextBundle;

    expect(parsed.session.display_id).toBe('SNS-001');
    expect(parsed.openItems).toEqual(bundle.openItems);
    expect(parsed.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// XML format
// ---------------------------------------------------------------------------

describe('renderSessionContext — xml', () => {
  it('wraps output in a session_context root element', () => {
    const output = renderSessionContext(makeBundle(), 'xml');

    expect(output).toContain('<session_context>');
    expect(output).toContain('</session_context>');
  });

  it('includes the session display_id as an attribute', () => {
    const output = renderSessionContext(makeBundle(), 'xml');

    expect(output).toContain('id="SNS-001"');
  });

  it('escapes ampersands in text content', () => {
    const bundle = makeBundle({
      session: makeSession({ summary: 'BM25 & vector fusion' }),
    });

    const output = renderSessionContext(bundle, 'xml');

    expect(output).toContain('BM25 &amp; vector fusion');
    expect(output).not.toContain('BM25 & vector');
  });

  it('escapes less-than and greater-than in text content', () => {
    const bundle = makeBundle({
      openItems: ['Fix <critical> bug > threshold'],
    });

    const output = renderSessionContext(bundle, 'xml');

    expect(output).toContain('Fix &lt;critical&gt; bug &gt; threshold');
  });

  it('escapes double quotes in attribute values', () => {
    const bundle = makeBundle({
      taskStatus: [{ taskId: 'VNM-"01".02', status: 'done' }],
    });

    const output = renderSessionContext(bundle, 'xml');

    expect(output).toContain('&quot;01&quot;');
  });

  it('includes task entries inside a tasks element', () => {
    const output = renderSessionContext(makeBundle(), 'xml');

    expect(output).toContain('<tasks>');
    expect(output).toContain('id="VNM-01.02"');
    expect(output).toContain('status="in-progress"');
  });
});
