export interface WipAdjustment {
  effectiveWip: number;
  reason: string;
}

export class BackpressureController {
  constructor(private readonly baseWip: number) {}

  computeEffectiveWip(): WipAdjustment {
    return { effectiveWip: this.baseWip, reason: 'nominal' };
  }
}
