import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROMPTS_DIR = join(__dirname, '../../../docs/pm-module/diagnostic/prompts');
const SETUP_FILE = join(PROMPTS_DIR, 'setup.md');
const TEST_BENCH_DIR = join(PROMPTS_DIR, 'test-bench');

describe('prompt drift guard', () => {
  describe('setup.md', () => {
    it('is at most 5 lines', () => {
      const content = readFileSync(SETUP_FILE, 'utf-8');
      const lineCount = content.trim().split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(5);
    });

    it('does not contain quality requirement keywords', () => {
      const content = readFileSync(SETUP_FILE, 'utf-8').toLowerCase();
      const bannedKeywords = ['category', 'priority', 'acceptance', 'description', 'example'];
      for (const keyword of bannedKeywords) {
        expect(content, `setup.md should not contain "${keyword}"`).not.toContain(keyword);
      }
    });
  });

  describe('test bench prompts', () => {
    it('each P-*.md is at most 50 lines', () => {
      if (!existsSync(TEST_BENCH_DIR)) return; // test-bench is gitignored; skip in CI
      const files = readdirSync(TEST_BENCH_DIR).filter((f) => f.match(/^P-\d{2}\.md$/));
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const content = readFileSync(join(TEST_BENCH_DIR, file), 'utf-8');
        const lineCount = content.trim().split('\n').length;
        expect(lineCount, `${file} exceeds 50 lines (has ${lineCount})`).toBeLessThanOrEqual(50);
      }
    });
  });
});
