/**
 * Startup smoke test: verify brain serve --mcp boots watchdog within 5s
 *
 * Spawns the MCP server in a child process and verifies that the
 * MergeLifecycleReconciler heartbeat message appears within 5 seconds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The checkout under test, so a worktree runs its own CLI and native modules.
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = join(PROJECT_ROOT, 'src', 'cli.ts');

let tmpDir: string;
let notesDir: string;
let fakeHome: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'brain-mcp-startup-'));
  notesDir = join(tmpDir, 'notes');
  fakeHome = join(tmpDir, 'home');

  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(notesDir, { recursive: true });

  // Initialize a brain workspace (needed for the MCP server to function)
  const initProcess = spawn(
    TSX_BIN,
    [CLI, 'init', '--notes-dir', notesDir, '--embedder', 'local', '--json'],
    {
      cwd: tmpDir,
      timeout: 30_000,
      env: { ...process.env, HOME: fakeHome, NODE_NO_WARNINGS: '1' },
    }
  );

  await new Promise<void>((resolve, reject) => {
    initProcess.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`init failed with code ${code}`));
    });
    initProcess.on('error', reject);
  });
}, 60_000);

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP server startup', { timeout: 15_000 }, () => {
  it('boots watchdog within 5 seconds', async () => {
    let output = '';
    let watchdogReady = false;
    let error: Error | null = null;

    const childProcess = spawn(TSX_BIN, [CLI, 'serve', '--mcp'], {
      cwd: tmpDir,
      timeout: 8_000,
      env: { ...process.env, HOME: fakeHome, NODE_NO_WARNINGS: '1' },
    });

    const startTime = Date.now();
    const maxWaitMs = 5_000;

    const stderr = childProcess.stderr;
    if (!stderr) throw new Error('stderr not available');

    const timeoutHandle = setTimeout(() => {
      if (!watchdogReady) {
        error = new Error(`Watchdog did not start within 5 seconds. Output:\n${output}`);
      }
      childProcess.kill();
    }, maxWaitMs);

    try {
      await new Promise<void>((resolve, reject) => {
        stderr.on('data', (chunk: Buffer) => {
          output += chunk.toString();

          // Check for either reconciler message
          if (
            output.includes('Merge-lifecycle reconciler active') ||
            output.includes('Workflow runtime active')
          ) {
            watchdogReady = true;
            clearTimeout(timeoutHandle);
            childProcess.kill();
            resolve();
          }
        });

        stderr.on('error', (err) => {
          clearTimeout(timeoutHandle);
          reject(err);
        });

        childProcess.on('error', (err) => {
          clearTimeout(timeoutHandle);
          reject(err);
        });

        childProcess.on('close', () => {
          clearTimeout(timeoutHandle);
          if (!watchdogReady && !error) {
            error = new Error(`Process exited before watchdog message. Output:\n${output}`);
          }
          if (error) reject(error);
          else resolve();
        });
      });

      const elapsedMs = Date.now() - startTime;
      expect(watchdogReady).toBe(true);
      expect(elapsedMs).toBeLessThan(maxWaitMs);
    } finally {
      try {
        childProcess.kill();
      } catch {
        // ignore if already killed
      }
    }
  });
});
