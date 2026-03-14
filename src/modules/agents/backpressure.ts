export interface BackpressureState {
  mergeQueueDepth: number;
  stallRate: number;
  conflictRate: number;
  recentMergeResults: MergeOutcome[];
  recentStalls: StallRecord[];
}

interface MergeOutcome {
  timestamp: number;
  success: boolean;
  hadConflict: boolean;
}

interface StallRecord {
  timestamp: number;
  workstream: string;
}

export interface WipAdjustment {
  effectiveWip: number;
  reason: string;
}

const MERGE_QUEUE_THRESHOLD = 2;
const HIGH_CONFLICT_RATE = 0.3;
const HIGH_STALL_RATE = 0.5;
const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const MIN_WIP = 1;

export class BackpressureController {
  private state: BackpressureState;
  private baseWip: number;

  constructor(baseWip: number) {
    this.baseWip = baseWip;
    this.state = {
      mergeQueueDepth: 0,
      stallRate: 0,
      conflictRate: 0,
      recentMergeResults: [],
      recentStalls: [],
    };
  }

  recordMerge(success: boolean, hadConflict: boolean): void {
    this.state.recentMergeResults.push({
      timestamp: Date.now(),
      success,
      hadConflict,
    });
    this.pruneOldRecords();
    this.recalculateRates();
  }

  recordStall(workstream: string): void {
    this.state.recentStalls.push({
      timestamp: Date.now(),
      workstream,
    });
    this.pruneOldRecords();
    this.recalculateRates();
  }

  setMergeQueueDepth(depth: number): void {
    this.state.mergeQueueDepth = depth;
  }

  computeEffectiveWip(): WipAdjustment {
    let wip = this.baseWip;
    const reasons: string[] = [];

    if (this.state.mergeQueueDepth > MERGE_QUEUE_THRESHOLD) {
      const reduction = this.state.mergeQueueDepth - MERGE_QUEUE_THRESHOLD;
      wip = Math.max(MIN_WIP, wip - reduction);
      reasons.push(`merge queue depth ${this.state.mergeQueueDepth}`);
    }

    if (this.state.conflictRate > HIGH_CONFLICT_RATE) {
      wip = Math.max(MIN_WIP, Math.floor(wip * 0.5));
      reasons.push(`high conflict rate ${Math.round(this.state.conflictRate * 100)}%`);
    }

    if (this.state.stallRate > HIGH_STALL_RATE) {
      wip = Math.max(MIN_WIP, wip - 1);
      reasons.push(`high stall rate ${Math.round(this.state.stallRate * 100)}%`);
    }

    return {
      effectiveWip: wip,
      reason: reasons.length > 0 ? reasons.join(', ') : 'nominal',
    };
  }

  getState(): Readonly<BackpressureState> {
    return { ...this.state };
  }

  private pruneOldRecords(): void {
    const cutoff = Date.now() - WINDOW_MS;
    this.state.recentMergeResults = this.state.recentMergeResults.filter(
      (r) => r.timestamp > cutoff
    );
    this.state.recentStalls = this.state.recentStalls.filter(
      (r) => r.timestamp > cutoff
    );
  }

  private recalculateRates(): void {
    const merges = this.state.recentMergeResults;
    if (merges.length > 0) {
      const conflicts = merges.filter((m) => m.hadConflict).length;
      this.state.conflictRate = conflicts / merges.length;
    } else {
      this.state.conflictRate = 0;
    }

    const total = merges.length + this.state.recentStalls.length;
    if (total > 0) {
      this.state.stallRate = this.state.recentStalls.length / total;
    } else {
      this.state.stallRate = 0;
    }
  }
}
