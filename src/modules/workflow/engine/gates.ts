import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Gate } from '../types.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

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
  const command = gate.command ?? gate.target;
  const timeout = gate.timeout ?? DEFAULT_TIMEOUT_MS;
  try {
    execSync(command, { timeout, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function evaluateGate(gate: Gate, db: BrainDB, _config: BrainConfig): Promise<boolean> {
  switch (gate.type) {
    case 'task-complete':
      return evaluateTaskComplete(gate, db);
    case 'file-exists':
      return existsSync(gate.target);
    case 'cli-pass':
      return evaluateCliPass(gate);
    case 'human-approval':
      return false;
    case 'custom':
      return evaluateCliPass(gate);
  }
}

export async function evaluateGates(
  gates: Gate[],
  db: BrainDB,
  config: BrainConfig,
): Promise<{ allPassed: boolean; results: Array<{ gate: Gate; passed: boolean }> }> {
  if (gates.length === 0) {
    return { allPassed: true, results: [] };
  }

  const results: Array<{ gate: Gate; passed: boolean }> = [];
  for (const gate of gates) {
    const passed = await evaluateGate(gate, db, config);
    results.push({ gate, passed });
  }

  const allPassed = results.every((r) => r.passed);
  return { allPassed, results };
}
