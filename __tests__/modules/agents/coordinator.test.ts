import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderCoordinatorPrompt } from '../../../src/modules/agents/coordinator.js';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `brain-coordinator-${Date.now()}`);
  mkdirSync(join(testDir, 'templates', 'agents'), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('renderCoordinatorPrompt', () => {
  it('renders coordinator template with variables', () => {
    const template = [
      '# Coordinator',
      'Team: {TEAM_NAME}',
      'Dir: {PROJECT_DIR}',
      'CLI: {BRAIN_CLI}',
    ].join('\n');
    writeFileSync(join(testDir, 'templates', 'agents', 'coordinator.md'), template);

    const result = renderCoordinatorPrompt({
      projectDir: testDir,
      teamName: 'burndown-vnm',
      wipLimit: 4,
      templateName: 'coordinator',
    });

    expect(result).not.toBeNull();
    expect(result!.prompt).toContain('burndown-vnm');
    expect(result!.prompt).toContain(testDir);
    expect(result!.prompt).toContain('npx tsx src/cli.ts');
    expect(result!.teamName).toBe('burndown-vnm');
    expect(result!.wipLimit).toBe(4);
  });

  it('returns null when template is missing', () => {
    const result = renderCoordinatorPrompt({
      projectDir: testDir,
      teamName: 'test',
      wipLimit: 2,
      templateName: 'nonexistent',
    });

    expect(result).toBeNull();
  });

  it('renders with real coordinator template', () => {
    // Copy the actual coordinator template
    const realTemplatePath = join(
      __dirname,
      '..',
      '..',
      '..',
      'templates',
      'agents',
      'coordinator.md'
    );
    if (!existsSync(realTemplatePath)) return;

    const content = readFileSync(realTemplatePath, 'utf-8');
    writeFileSync(join(testDir, 'templates', 'agents', 'coordinator.md'), content);

    const result = renderCoordinatorPrompt({
      projectDir: testDir,
      teamName: 'burndown-test',
      wipLimit: 3,
      templateName: 'coordinator',
    });

    expect(result).not.toBeNull();
    expect(result!.prompt).toContain('burndown-test');
    expect(result!.prompt).not.toMatch(/\{[A-Z][A-Z0-9_]*\}/);
  });
});
