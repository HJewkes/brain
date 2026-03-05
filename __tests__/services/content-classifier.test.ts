import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifySection,
  classifySectionWithEmbedding,
  classifyTableWithLlm,
  clearClassificationCache,
} from '../../src/services/content-classifier.js';
import { clearArchetypeCache } from '../../src/services/content-archetypes.js';
import type { OllamaClient } from '../../src/services/ollama.js';
import type { Embedder } from '../../src/types.js';

describe('classifySection — deterministic', () => {
  describe('task detection', () => {
    it('detects a markdown table with Status + Priority columns', () => {
      const text =
        '| Title | Status | Priority | Assignee |\n| --- | --- | --- | --- |\n| Fix bug | Open | High | Alice |';
      const result = classifySection(text, 'Tasks');
      expect(result.contentClass).toBe('task');
      expect(result.method).toBe('deterministic');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects checkbox lists as task', () => {
      const text = '- [ ] Ship feature A\n- [x] Write tests\n- [ ] Deploy to prod';
      const result = classifySection(text, null);
      expect(result.contentClass).toBe('task');
    });
  });

  describe('bug-report detection maps to task', () => {
    it('detects steps to reproduce pattern', () => {
      const text =
        '## Steps to Reproduce\n1. Open the app\n2. Click submit\n\n## Expected Behavior\nForm submits\n\n## Actual Behavior\nCrash';
      const result = classifySection(text, 'Bug Report');
      expect(result.contentClass).toBe('task');
    });

    it('detects bug bash content', () => {
      const text =
        'During the bug bash session, we found:\n- Table border disappears on scroll\n- severity: high';
      const result = classifySection(text, 'Bug Bash Results');
      expect(result.contentClass).toBe('task');
    });
  });

  describe('architecture detection maps to research', () => {
    it('detects architecture heading', () => {
      const text = 'The system uses a microservice architecture with three layers.';
      const result = classifySection(text, 'System Architecture');
      expect(result.contentClass).toBe('research');
    });

    it('detects content with code blocks and design terminology', () => {
      const text =
        'The data flow works as follows:\n```\nAPI → Queue → Worker → DB\n```\nEach component is independently scalable.';
      const result = classifySection(text, 'Overview');
      expect(result.contentClass).toBe('research');
    });
  });

  describe('requirements detection maps to guide', () => {
    it('detects PRD-style content', () => {
      const text =
        'Users must be able to:\n- Create an account\n- Reset their password\n- The system shall support 1000 concurrent users';
      const result = classifySection(text, 'Product Requirements');
      expect(result.contentClass).toBe('guide');
    });
  });

  describe('meeting-notes detection maps to meeting', () => {
    it('detects attendees and action items', () => {
      const text =
        'Attendees: Alice, Bob, Carol\n\nDiscussed:\n- Launch timeline\n\nAction items:\n- Alice: finalize spec by Friday';
      const result = classifySection(text, null);
      expect(result.contentClass).toBe('meeting');
    });
  });

  describe('reference detection maps to note', () => {
    it('detects large non-task tables as note', () => {
      const rows = Array.from(
        { length: 15 },
        (_, i) => `| Config ${i} | Value ${i} | Default ${i} |`
      ).join('\n');
      const text = `| Setting | Value | Default |\n| --- | --- | --- |\n${rows}`;
      const result = classifySection(text, 'Configuration');
      expect(result.contentClass).toBe('note');
    });
  });

  describe('general fallback maps to note', () => {
    it('returns note for unrecognized content', () => {
      const text = 'Just some random thoughts about the project direction.';
      const result = classifySection(text, null);
      expect(result.contentClass).toBe('note');
    });
  });
});

describe('classifyTableWithLlm', () => {
  const mockClient: OllamaClient = {
    model: 'test',
    generate: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(mockClient.generate).mockReset();
    clearClassificationCache();
  });

  it('returns decompose=true for task tables', async () => {
    vi.mocked(mockClient.generate).mockResolvedValue(
      JSON.stringify({
        decompose: true,
        noteType: 'task',
        schemaMapping: { Title: 'title', Status: 'status', Priority: 'priority' },
        reason: 'Independent actionable items with status tracking',
      })
    );

    const result = await classifyTableWithLlm(
      mockClient,
      ['Title', 'Status', 'Priority'],
      [
        ['Fix bug', 'Open', 'High'],
        ['Add test', 'Done', 'Low'],
      ],
      [{ name: 'task', fields: ['title', 'status', 'priority'] }]
    );

    expect(result.decompose).toBe(true);
    expect(result.noteType).toBe('task');
    expect(result.schemaMapping).toEqual({
      Title: 'title',
      Status: 'status',
      Priority: 'priority',
    });
  });

  it('returns decompose=false for comparison tables', async () => {
    vi.mocked(mockClient.generate).mockResolvedValue(
      JSON.stringify({
        decompose: false,
        noteType: 'reference',
        suggestedTitle: 'Feature Comparison Matrix',
        reason: 'Rows represent options for comparison, not independent items',
      })
    );

    const result = await classifyTableWithLlm(
      mockClient,
      ['Feature', 'Option A', 'Option B', 'Notes'],
      [['Auth', 'OAuth', 'JWT', 'Prefer OAuth for SSO']],
      []
    );

    expect(result.decompose).toBe(false);
    expect(result.suggestedTitle).toBe('Feature Comparison Matrix');
  });

  it('caches results by table signature', async () => {
    vi.mocked(mockClient.generate).mockResolvedValue(
      JSON.stringify({
        decompose: true,
        noteType: 'task',
        schemaMapping: {},
        reason: 'test',
      })
    );

    await classifyTableWithLlm(mockClient, ['A', 'B'], [['1', '2']], []);
    await classifyTableWithLlm(mockClient, ['A', 'B'], [['1', '2']], []);

    expect(mockClient.generate).toHaveBeenCalledTimes(1);
  });

  it('includes registered type schemas in prompt', async () => {
    vi.mocked(mockClient.generate).mockResolvedValue(
      JSON.stringify({
        decompose: false,
        noteType: 'general',
        reason: 'test',
      })
    );

    await classifyTableWithLlm(
      mockClient,
      ['Name', 'Value'],
      [['a', '1']],
      [{ name: 'config', fields: ['key', 'value', 'default'] }]
    );

    const promptArg = vi.mocked(mockClient.generate).mock.calls[0][0];
    expect(promptArg).toContain('config');
    expect(promptArg).toContain('key, value, default');
  });

  it('treats tables with same headers in different order as same signature', async () => {
    vi.mocked(mockClient.generate).mockResolvedValue(
      JSON.stringify({
        decompose: false,
        noteType: 'general',
        reason: 'test',
      })
    );

    await classifyTableWithLlm(mockClient, ['B', 'A'], [['1', '2']], []);
    await classifyTableWithLlm(mockClient, ['A', 'B'], [['1', '2']], []);

    expect(mockClient.generate).toHaveBeenCalledTimes(1);
  });
});

describe('classifySectionWithEmbedding', () => {
  beforeEach(() => clearArchetypeCache());

  it('returns note when no archetype exceeds threshold', async () => {
    // All zeros = no similarity to any archetype
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue([[0, 0, 0, 0, 0]]),
      model: 'test',
      dimensions: 5,
    };
    const result = await classifySectionWithEmbedding('random text', null, embedder);
    expect(result.contentClass).toBe('note');
    expect(result.method).toBe('embedding');
  });

  it('returns best matching archetype when above threshold', async () => {
    // First call: archetype embeddings (5 archetypes: task, research, guide, meeting, note)
    // Second call: text embedding that is identical to the first archetype (task)
    const archetypeVecs = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0.5, 0],
      [0, 0.5, 0.5],
    ];
    const textVec = [[1, 0, 0]]; // identical to task archetype

    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValueOnce(archetypeVecs).mockResolvedValueOnce(textVec),
      model: 'test',
      dimensions: 3,
    };

    const result = await classifySectionWithEmbedding('some task text', 'Tasks', embedder);
    expect(result.contentClass).toBe('task');
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.method).toBe('embedding');
  });

  it('preserves heading in result', async () => {
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue([[0, 0, 0]]),
      model: 'test',
      dimensions: 3,
    };
    const result = await classifySectionWithEmbedding('text', 'My Heading', embedder);
    expect(result.heading).toBe('My Heading');
  });

  it('returns confidence of 0.5 when falling back to note', async () => {
    const embedder: Embedder = {
      embed: vi.fn().mockResolvedValue([[0, 0, 0, 0, 0]]),
      model: 'test',
      dimensions: 5,
    };
    const result = await classifySectionWithEmbedding('text', null, embedder);
    expect(result.confidence).toBe(0.5);
  });
});
