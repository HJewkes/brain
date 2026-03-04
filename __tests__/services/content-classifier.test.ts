import { describe, it, expect } from 'vitest';
import { classifySection } from '../../src/services/content-classifier.js';

describe('classifySection — deterministic', () => {
  describe('task-list detection', () => {
    it('detects a markdown table with Status + Priority columns', () => {
      const text = '| Title | Status | Priority | Assignee |\n| --- | --- | --- | --- |\n| Fix bug | Open | High | Alice |';
      const result = classifySection(text, 'Tasks');
      expect(result.contentClass).toBe('task-list');
      expect(result.method).toBe('deterministic');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects checkbox lists as task-list', () => {
      const text = '- [ ] Ship feature A\n- [x] Write tests\n- [ ] Deploy to prod';
      const result = classifySection(text, null);
      expect(result.contentClass).toBe('task-list');
    });
  });

  describe('bug-report detection', () => {
    it('detects steps to reproduce pattern', () => {
      const text = '## Steps to Reproduce\n1. Open the app\n2. Click submit\n\n## Expected Behavior\nForm submits\n\n## Actual Behavior\nCrash';
      const result = classifySection(text, 'Bug Report');
      expect(result.contentClass).toBe('bug-report');
    });

    it('detects bug bash content', () => {
      const text = 'During the bug bash session, we found:\n- Table border disappears on scroll\n- severity: high';
      const result = classifySection(text, 'Bug Bash Results');
      expect(result.contentClass).toBe('bug-report');
    });
  });

  describe('architecture detection', () => {
    it('detects architecture heading', () => {
      const text = 'The system uses a microservice architecture with three layers.';
      const result = classifySection(text, 'System Architecture');
      expect(result.contentClass).toBe('architecture');
    });

    it('detects content with code blocks and design terminology', () => {
      const text = 'The data flow works as follows:\n```\nAPI → Queue → Worker → DB\n```\nEach component is independently scalable.';
      const result = classifySection(text, 'Overview');
      expect(result.contentClass).toBe('architecture');
    });
  });

  describe('requirements detection', () => {
    it('detects PRD-style content', () => {
      const text = 'Users must be able to:\n- Create an account\n- Reset their password\n- The system shall support 1000 concurrent users';
      const result = classifySection(text, 'Product Requirements');
      expect(result.contentClass).toBe('requirements');
    });
  });

  describe('meeting-notes detection', () => {
    it('detects attendees and action items', () => {
      const text = 'Attendees: Alice, Bob, Carol\n\nDiscussed:\n- Launch timeline\n\nAction items:\n- Alice: finalize spec by Friday';
      const result = classifySection(text, null);
      expect(result.contentClass).toBe('meeting-notes');
    });
  });

  describe('reference detection', () => {
    it('detects large non-task tables as reference', () => {
      const rows = Array.from({ length: 15 }, (_, i) => `| Config ${i} | Value ${i} | Default ${i} |`).join('\n');
      const text = `| Setting | Value | Default |\n| --- | --- | --- |\n${rows}`;
      const result = classifySection(text, 'Configuration');
      expect(result.contentClass).toBe('reference');
    });
  });

  describe('general fallback', () => {
    it('returns general for unrecognized content', () => {
      const text = 'Just some random thoughts about the project direction.';
      const result = classifySection(text, null);
      expect(result.contentClass).toBe('general');
    });
  });
});
