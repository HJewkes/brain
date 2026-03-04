import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { initLocalBrain } from '../../src/commands/init.js';

describe('init --local', () => {
  let projectDir: string;
  let globalDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'brain-init-local-'));
    globalDir = mkdtempSync(join(tmpdir(), 'brain-global-'));
    writeFileSync(join(globalDir, 'config.json'), JSON.stringify({ embedder: 'local' }));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  it('creates .brain/ directory structure', () => {
    initLocalBrain({ projectDir, globalDir });

    expect(existsSync(join(projectDir, '.brain'))).toBe(true);
    expect(existsSync(join(projectDir, '.brain', 'config.json'))).toBe(true);
    expect(existsSync(join(projectDir, '.brain', 'brain.db'))).toBe(true);
    expect(existsSync(join(projectDir, '.brain', 'notes'))).toBe(true);
  });

  it('creates minimal config that inherits from global', () => {
    initLocalBrain({ projectDir, globalDir });

    const config = JSON.parse(readFileSync(join(projectDir, '.brain', 'config.json'), 'utf-8'));
    expect(config).toEqual({});
  });

  it('uses custom notes dir when specified', () => {
    const customNotesDir = join(projectDir, 'docs', 'knowledge');
    initLocalBrain({ projectDir, globalDir, notesDir: customNotesDir });

    const config = JSON.parse(readFileSync(join(projectDir, '.brain', 'config.json'), 'utf-8'));
    expect(config.notesDir).toBe(customNotesDir);
    expect(existsSync(customNotesDir)).toBe(true);
  });

  it('registers instance in global registry', () => {
    initLocalBrain({ projectDir, globalDir });

    const registry = JSON.parse(readFileSync(join(globalDir, 'instances.json'), 'utf-8'));
    expect(registry.instances).toHaveLength(1);
    expect(registry.instances[0].path).toBe(join(projectDir, '.brain'));
    expect(registry.instances[0].name).toBe(basename(projectDir));
  });

  it('does not overwrite existing .brain/', () => {
    mkdirSync(join(projectDir, '.brain'));
    writeFileSync(
      join(projectDir, '.brain', 'config.json'),
      JSON.stringify({ embedder: 'ollama' })
    );

    expect(() => initLocalBrain({ projectDir, globalDir })).toThrow(/already exists/i);
  });
});
