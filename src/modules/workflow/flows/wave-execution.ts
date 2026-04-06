/**
 * Wave execution workflow — executes PM tasks in dependency-ordered waves.
 *
 * Calls computeWaves() to determine execution order, then dispatches
 * tasks sequentially within each wave. A gate check (typecheck + tests)
 * runs after each wave completes.
 *
 * Parameters:
 *   workstream: REQUIRED — workstream number
 *   project: REQUIRED — project prefix (e.g., 'VNM')
 *   wipLimit: max tasks per wave (default 3)
 *   template: agent template name (default 'implementation-compact')
 *   gateCommand: shell command for gate checks (default 'npm run typecheck && npm test')
 */

import { execSync } from 'node:child_process';
import type { WorkflowFn } from '../runtime/types.js';
import type { WaveAssignment } from '../../pm/engine/dependency.js';

export const waveExecutionWorkflow: WorkflowFn = async (ctx) => {
  const workstream = ctx.param('workstream');
  const project = ctx.param('project');
  if (!workstream || !project) {
    throw new Error(
      'Wave execution workflow requires "workstream" and "project" context parameters.'
    );
  }

  const wipLimit = parseInt(ctx.param('wipLimit') ?? '3', 10);
  const template = ctx.param('template') ?? 'implementation-compact';
  const gateCommand = ctx.param('gateCommand') ?? 'npm run typecheck && npm test';

  // Step 1: Compute dependency-ordered waves
  await ctx.seed('compute-waves', async () => {
    if (!ctx.db) {
      throw new Error('Wave execution requires database access (ctx.db).');
    }

    const { computeWaves } = await import('../../pm/engine/dependency.js');
    const waves: WaveAssignment[] = computeWaves(ctx.db, project);

    const totalTasks = waves.reduce((sum, w) => sum + w.taskIds.length, 0);

    // Apply wipLimit per wave
    const trimmedWaves = waves.map((w) => ({
      wave: w.wave,
      taskIds: w.taskIds.slice(0, wipLimit),
    }));

    return {
      data: {
        waveCount: String(trimmedWaves.length),
        totalTasks: String(totalTasks),
        waveStructure: JSON.stringify(trimmedWaves),
      },
      output: `Computed ${trimmedWaves.length} wave(s) with ${totalTasks} total task(s).`,
    };
  });

  const waveStructure: WaveAssignment[] = JSON.parse(ctx.param('waveStructure') ?? '[]');

  if (waveStructure.length === 0) {
    await ctx.seed('summary', async () => ({
      data: {},
      output: 'No pending tasks found. Workstream is empty or fully complete.',
    }));
    return;
  }

  // Step 2-3: Execute each wave, then gate check
  let completedCount = 0;
  let failedCount = 0;

  for (const wave of waveStructure) {
    // Dispatch each task in the wave sequentially
    for (const taskId of wave.taskIds) {
      const stepId = `wave-${wave.wave}-task-${taskId}`;
      try {
        await ctx.dispatch(stepId, template);
        completedCount++;
      } catch {
        failedCount++;
      }
    }

    // Gate check after each wave
    const gateStepId = `gate-wave-${wave.wave}`;
    await ctx.seed(gateStepId, async () => {
      try {
        execSync(gateCommand, {
          cwd: ctx.projectDir,
          stdio: 'pipe',
          timeout: 300_000,
        });
        return {
          data: { [`gate_wave_${wave.wave}`]: 'passed' },
          output: `Gate check passed for wave ${wave.wave}.`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          data: { [`gate_wave_${wave.wave}`]: 'failed' },
          output: `Gate check FAILED for wave ${wave.wave}: ${message}`,
        };
      }
    });

    // If gate failed, pause for intervention
    const gateResult = ctx.param(`gate_wave_${wave.wave}`);
    if (gateResult === 'failed') {
      await ctx.assisted(`intervention-wave-${wave.wave}`, template);
    }
  }

  // Step 4: Summary
  await ctx.seed('summary', async () => ({
    data: {
      completedTasks: String(completedCount),
      failedTasks: String(failedCount),
    },
    output: [
      `Wave execution complete.`,
      `Waves: ${waveStructure.length}`,
      `Completed: ${completedCount}`,
      `Failed: ${failedCount}`,
    ].join('\n'),
  }));
};
