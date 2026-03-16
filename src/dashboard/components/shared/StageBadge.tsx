import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './colors.js';

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
  const dotColor = ageColor(ageMinutes, p50, p85);
  const bgColor = dotColor === C.success
    ? 'rgba(20,184,166,0.12)'
    : dotColor === C.warning
    ? 'rgba(255,176,32,0.12)'
    : dotColor === C.error
    ? 'rgba(209,67,67,0.12)'
    : 'rgba(107,114,128,0.12)';

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.label, { color: dotColor }]}>
        {stage}{ageMinutes !== undefined ? ` · ${fmtAge(ageMinutes)}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
});
