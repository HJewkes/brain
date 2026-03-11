import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Gate } from '../types.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface GateResult {
  gate: Gate;
  passed: boolean;
  reason?: string;
}

async function evaluateTaskComplete(gate: Gate, db: BrainDB): Promise<boolean> {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  if (noteIds.length === 0) return false;

  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as { display_id?: string; status?: string };
    if (meta.display_id === gate.target && meta.status === 'done') {
      return true;
    }
  }
  return false;
}

function evaluateCliPass(gate: Gate): boolean {
  const command = gate.command ?? gate.target ?? 'true';
  const timeout = gate.timeout ?? DEFAULT_TIMEOUT_MS;
  try {
    execSync(command, { timeout, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function evaluateGate(
  gate: Gate,
  db: BrainDB,
  _config: BrainConfig,
  taskMetadata?: Record<string, unknown>
): Promise<GateResult> {
  switch (gate.type) {
    case 'task-complete': {
      const passed = await evaluateTaskComplete(gate, db);
      return { gate, passed, reason: passed ? undefined : `Task "${gate.target}" not done` };
    }
    case 'file-exists': {
      const passed = gate.target ? existsSync(gate.target) : false;
      return { gate, passed, reason: passed ? undefined : `File "${gate.target}" not found` };
    }
    case 'cli-pass': {
      const passed = evaluateCliPass(gate);
      return { gate, passed, reason: passed ? undefined : `Command failed` };
    }
    case 'human-approval':
      return { gate, passed: false, reason: 'Human approval required' };
    case 'approval': {
      const passed = taskMetadata?.gate_status === 'passed';
      return {
        gate,
        passed,
        reason: passed ? undefined : 'Approval gate not yet passed',
      };
    }
    case 'iteration': {
      const max = gate.maxIterations ?? Infinity;
      const count = (taskMetadata?.iteration_count as number) ?? 0;
      const passed = count < max;
      return {
        gate,
        passed,
        reason: passed ? undefined : `Iteration limit reached (${count}/${max})`,
      };
    }
    case 'custom': {
      const passed = evaluateCliPass(gate);
      return { gate, passed, reason: passed ? undefined : `Custom command failed` };
    }
  }
}

export async function evaluateGates(
  gates: Gate[],
  db: BrainDB,
  config: BrainConfig,
  taskMetadata?: Record<string, unknown>
): Promise<{ allPassed: boolean; results: GateResult[] }> {
  if (gates.length === 0) {
    return { allPassed: true, results: [] };
  }

  const results: GateResult[] = [];
  for (const gate of gates) {
    const result = await evaluateGate(gate, db, config, taskMetadata);
    results.push(result);
  }

  const allPassed = results.every((r) => r.passed);
  return { allPassed, results };
}
