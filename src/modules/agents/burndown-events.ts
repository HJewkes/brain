import { randomUUID } from 'node:crypto';
import type { ActiveAgent, TickResult } from './burndown.js';
import type { MergeResult } from './auto-merge.js';
import type { StalledTaskInfo } from './stall-detector.js';
import { hashEvent, EventBuffer } from '../sessions/structural-events.js';
import type { StructuralEvent } from '../sessions/structural-events.js';

export interface BurndownSession {
  sessionId: string;
  startedAt: string;
  project: string;
  events: EventBuffer;
  stats: BurndownStats;
}

export interface BurndownStats {
  tickCount: number;
  totalSpawned: number;
  totalMerged: number;
  totalStalled: number;
  startedAt: string;
}

export function createBurndownSession(project: string): BurndownSession {
  const now = new Date().toISOString();
  return {
    sessionId: randomUUID(),
    startedAt: now,
    project,
    events: new EventBuffer(200),
    stats: {
      tickCount: 0,
      totalSpawned: 0,
      totalMerged: 0,
      totalStalled: 0,
      startedAt: now,
    },
  };
}

export function recordTick(session: BurndownSession, result: TickResult): void {
  session.stats.tickCount++;
  session.stats.totalSpawned += result.spawned.length;
  session.stats.totalStalled += result.stalled.length;

  for (const agent of result.spawned) {
    recordSpawn(session, agent);
  }

  for (const stalled of result.stalled) {
    recordStall(session, stalled);
  }
}

export function recordSpawn(session: BurndownSession, agent: ActiveAgent): void {
  const detail = `agent_spawn: ${agent.taskId} (${agent.routing.model})`;
  const event: StructuralEvent = {
    id: hashEvent('decision', detail + agent.startedAt),
    sessionId: session.sessionId,
    eventType: 'decision',
    detail,
    timestamp: agent.startedAt,
  };
  session.events.add(event);
}

export function recordMerge(session: BurndownSession, result: MergeResult): void {
  if (result.merged) session.stats.totalMerged++;
  const status = result.merged ? 'merged' : `failed: ${result.error}`;
  const detail = `merge: PR#${result.prNumber} for ${result.taskId} — ${status}`;
  const event: StructuralEvent = {
    id: hashEvent('git_op', detail),
    sessionId: session.sessionId,
    eventType: 'git_op',
    detail,
    timestamp: new Date().toISOString(),
  };
  session.events.add(event);
}

export function recordStall(session: BurndownSession, stalled: StalledTaskInfo): void {
  const detail = `stall: ${stalled.displayId} (${Math.round(stalled.lastCommitAge)}m idle)`;
  const event: StructuralEvent = {
    id: hashEvent('error', detail),
    sessionId: session.sessionId,
    eventType: 'error',
    detail,
    timestamp: stalled.stalledSince,
  };
  session.events.add(event);
}

export function formatSessionSummary(session: BurndownSession): string {
  const duration = Date.now() - new Date(session.startedAt).getTime();
  const minutes = Math.round(duration / 60_000);
  const events = session.events.getEvents(session.sessionId);

  const lines = [
    `Burndown session ${session.sessionId}`,
    `Project: ${session.project}`,
    `Duration: ${minutes}m`,
    `Ticks: ${session.stats.tickCount}`,
    `Spawned: ${session.stats.totalSpawned}`,
    `Merged: ${session.stats.totalMerged}`,
    `Stalled: ${session.stats.totalStalled}`,
    `Events: ${events.length}`,
  ];

  return lines.join('\n');
}
