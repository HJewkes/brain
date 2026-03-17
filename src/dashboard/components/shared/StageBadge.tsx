import React from 'react';
import { C } from './colors.js';
import { Badge } from './Badge.js';

interface Props {
  stage: string;
  ageMinutes?: number;
  p50?: number;
  p85?: number;
}

function ageColor(age: number | undefined, p50: number | undefined, p85: number | undefined): string {
  if (age === undefined || p50 === undefined || p85 === undefined) return C.textTertiary;
  if (age < p50) return C.success;
  if (age < p85) return C.warning;
  return C.error;
}

function fmtAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function StageBadge({ stage, ageMinutes, p50, p85 }: Props) {
  const color = ageColor(ageMinutes, p50, p85);
  const label = `${stage}${ageMinutes !== undefined ? ` · ${fmtAge(ageMinutes)}` : ''}`;
  return <Badge label={label} color={color} dot />;
}
